#!/usr/bin/env tsx
// A ONE-OFF pass: build each project's finishes library from the codes its
// drawings already carry, and link every attribute to its entry.
//
//   npm run db:backfill-finishes                      dry run
//   npm run db:backfill-finishes -- --apply           writes
//   npm run db:backfill-finishes -- --project=<uuid>
//
// ============================================================================
// WHAT IT DOES NOT DO, AND WHY.
//
// It does NOT guess a `kind`. classifyGroup already guesses an attr_group from
// words in the label ("fabric" → material, "oak" → finish), and stacking a
// second guess on top would produce a register full of confident mistakes
// about what CH-01.1 is. Null until somebody says.
//
// It does NOT resolve a CONFLICT. Where one code carries two different values
// across the project's items, it picks NOTHING: the finish is created with no
// description and the disagreement is reported, because either value could be
// the right one and a wrong description now propagates to every linked item.
// house/conventions.md §5: "Anything unresolvable becomes a visible flag,
// never a plausible-looking wrong answer."
//
// Every finish it creates is `tbc`. The drawings named a code; nobody has
// confirmed what it is. A `tbc` finish reaches the export as TBC and can never
// promote a confirmed checklist answer, which is exactly right for a value
// read off a page and not yet checked.
//
// SAFE TO RE-RUN: a code that already has a finish is skipped, and an
// attribute that is already linked is left alone.
// ============================================================================
//
// ============================================================================
// HISTORICAL (audit B9, 2026-11-06). Kept, not deleted, because the finishes
// library's banner for unlinked codes names it as the one way to bring them
// in (FinishesLibrary.tsx) and nothing in the app links an attribute. But it
// predates two things, and a person running it today should know both:
//
//   * THE ZONE-TWIN LOOKUP (`findFinishByCode`, 2026-10-13). This matches a
//     code to the library by `code_norm` alone, so a bare `MTL-01` beside the
//     library's `GR-MTL-01` is created as a second finish. Run
//     `npm run db:backfill-finish-twins` after it, which merges them.
//   * THE CHECKLIST. It links attributes and takes a version, and recomposes
//     no answer, so a checklist answer composed from a spec it links goes on
//     holding the drawing's words, not the library's, until something next
//     recomposes that record (any confirm, correction or finish edit on it).
//     No script does that today.
//
// A rebuild on the single paths (`resolveFinishCode`, `recomposeAnswers`) is
// the fix, and a decision for whoever next needs it.
// ============================================================================
import pg from "pg";
import { requireScriptEnvironment } from "./script-env.mjs";
import { normaliseFinishCode } from "../src/lib/finishes";
import { snapshotRecords } from "../src/lib/record-snapshot";
import type { TxnSql } from "../src/lib/db-transaction";

// The environment guard is db/script-env.mjs's, the one every db script uses:
// the resolved host printed first, pilot behind --yes-pilot and production
// behind --yes-production, separate flags on purpose.
const { databaseUrl } = requireScriptEnvironment("backfill-finishes.ts", [
  "npm run db:backfill-finishes           (reads .env.local)",
  "Add -- --apply to write; without it this is a dry run.",
]);
console.warn(
  "HISTORICAL: this pass predates the zone-twin lookup and recomposes no checklist answer. Read its header, then run npm run db:backfill-finish-twins after it.",
);
const apply = process.argv.includes("--apply");
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1] ?? null;

const actor = "system:backfill-finishes";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

// The same tagged-template shape snapshotRecords expects, over this client.
const txn: TxnSql = async (strings, ...values) => {
  let text = "";
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i] ?? "";
    if (i < values.length) text += `$${i + 1}`;
  }
  const result = await client.query(text, values);
  return result.rows as Record<string, unknown>[];
};

try {
  const projects = await client.query(
    `select p.id, p.bws_project_number, p.name from projects p
      where ($1::uuid is null or p.id = $1::uuid)
        and exists (
          select 1 from record_attributes a
          join spec_records r on r.id = a.record_id
          where r.project_id = p.id and a.status = 'active'
            and a.material_code is not null and btrim(a.material_code) <> ''
            and a.finish_id is null
        )
      order by p.bws_project_number`,
    [projectArg],
  );

  if (projects.rows.length === 0) {
    console.log("No project has unlinked finish codes. Nothing to do.");
    process.exit(0);
  }

  let created = 0;
  let linked = 0;
  let conflicts = 0;

  for (const project of projects.rows) {
    // Every distinct code, with the values the drawings gave it and how often.
    const codes = await client.query(
      `select upper(btrim(a.material_code)) as code_norm,
              min(btrim(a.material_code)) as code,
              count(*)::int as uses,
              count(distinct coalesce(btrim(a.value), '')) as distinct_values,
              (array_agg(btrim(a.value) order by btrim(a.value)))[1] as sample_value,
              array_agg(distinct btrim(a.value)) as values
         from record_attributes a
         join spec_records r on r.id = a.record_id
        where r.project_id = $1
          and a.status = 'active'
          and a.material_code is not null and btrim(a.material_code) <> ''
          and a.finish_id is null
        group by upper(btrim(a.material_code))
        order by 1`,
      [project.id],
    );

    console.log(`\n${String(project.bws_project_number)} ${String(project.name)}: ${codes.rows.length} code(s)`);

    for (const row of codes.rows) {
      const conflicted = Number(row.distinct_values) > 1;
      if (conflicted) conflicts += 1;
      const description = conflicted ? null : (row.sample_value as string | null) || null;
      console.log(
        `  ${String(row.code)} — ${row.uses} use(s)` +
          (conflicted
            ? `  ⚠ ${row.distinct_values} different values across items; left blank for a person: ${(row.values as string[]).filter(Boolean).slice(0, 3).join(" | ")}`
            : description
              ? `  → ${description}`
              : "  (no value on the drawing)"),
      );
      if (!apply) continue;

      await client.query("begin");
      try {
        const change = await client.query(
          `insert into change_sets (project_id, kind, reason, closed_at, actor)
           values ($1, 'finish_link', $2, now(), $3) returning id`,
          [
            project.id,
            `Built the finishes library from the codes the drawings already carried. ${String(row.code)}: ${row.uses} item spec(s).`,
            actor,
          ],
        );
        await client.query(`select set_config('app.change_set_id', $1, true)`, [change.rows[0].id]);

        const finish = await client.query(
          `insert into project_finishes (project_id, code, code_norm, description, state, created_by, updated_by)
           values ($1, $2, $3, $4, 'tbc', $5, $5)
           on conflict do nothing
           returning id`,
          [project.id, String(row.code), normaliseFinishCode(String(row.code)), description, actor],
        );
        let finishId: string;
        if (finish.rows[0]) {
          finishId = finish.rows[0].id;
          created += 1;
        } else {
          const existing = await client.query(
            `select id from project_finishes where project_id = $1 and code_norm = $2 and status = 'active'`,
            [project.id, normaliseFinishCode(String(row.code))],
          );
          finishId = existing.rows[0].id;
        }

        const links = await client.query(
          `update record_attributes a
              set finish_id = $1, updated_by = $2
             from spec_records r
            where r.id = a.record_id
              and r.project_id = $3
              and a.status = 'active'
              and a.finish_id is null
              and upper(btrim(a.material_code)) = $4
            returning a.id, a.record_id`,
          [finishId, actor, project.id, String(row.code_norm)],
        );
        linked += links.rows.length;

        // A VERSION OF EVERY RECORD TOUCHED. Linking changes what the item's
        // export cell renders from — the library rather than the page's own
        // words — so it is a change to the record and has to be visible as
        // one. The db-tier coverage assertion caught this being missing.
        await snapshotRecords(
          txn,
          links.rows.map((link) => String(link.record_id)),
          change.rows[0].id,
        );
        await client.query("commit");
      } catch (cause) {
        await client.query("rollback").catch(() => undefined);
        throw cause;
      }
    }
  }

  console.log(
    apply
      ? `\nDone. ${created} finish(es) created, ${linked} item spec(s) linked, ${conflicts} left blank for a person to decide.`
      : `\nDRY RUN — nothing was written. Re-run with -- --apply`,
  );
  if (conflicts > 0) {
    console.log(
      "A code with several different values is NOT resolved here: either value could be the right one, and a wrong\n" +
        "description propagates to every linked item. Fill those in on the project's finishes page.",
    );
  }
  console.log("\nNothing is promoted to the checklist by this script. Every finish is TBC until somebody confirms it.");
} finally {
  await client.end();
}
