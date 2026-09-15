#!/usr/bin/env tsx
// A ONE-OFF pass: fill checklist answers from attributes that were confirmed
// before anything carried them through.
//
//   npm run db:backfill-answers                 -- dry run, writes nothing
//   npm run db:backfill-answers -- --apply      -- writes
//   npm run db:backfill-answers -- --project=<uuid>
//
// ============================================================================
// WHY THIS EXISTS AND WHY IT IS NOT A MIGRATION.
//
// `record_attributes` gathered what the drawings said for weeks before
// confirm-drawings started writing the answer each one implies. Those records
// read 0 of 20 spec fields settled while showing a full dimensions cell on
// screen -- the data was there and the checklist could not see it.
//
// Not a numbered migration, for one reason: the composition is
// composeDimensionCell, and rebuilding that in SQL -- slot order, a diameter
// replacing width and depth, the millimetre conversion, the verbatim fallback
// for a figure it could not derive -- is the second composer the whole
// dimensions design exists to prevent. So this runs the SAME functions the
// confirm route runs, and there is exactly one set of rules.
//
// It is SAFE TO RE-RUN. applyAnswerFills only touches an answer still
// `missing` or one a shop-drawings run wrote, so a second pass over unchanged
// attributes writes the same values and a person's answer is never in scope.
// Running it twice is not a way to lose work.
//
// DRY RUN IS THE DEFAULT, because this writes to real spec records in bulk and
// the useful thing to see first is which ones and what to.
// ============================================================================
import pg from "pg";
import { applyAnswerFills, planAnswerFills, type PromotableAttribute } from "../src/lib/promote-answers";

const DATABASE_ENVIRONMENTS = ["sandbox", "production"];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with: node --env-file=.env.local ...");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (!DATABASE_ENVIRONMENTS.includes(environment)) {
  console.error(`DATABASE_ENVIRONMENT must be one of: ${DATABASE_ENVIRONMENTS.join(", ")}.`);
  process.exit(1);
}
let host = "unknown host";
try {
  host = new URL(databaseUrl).host;
} catch {
  /* connect will report it better */
}
// Printed BEFORE anything happens. DATABASE_ENVIRONMENT is a declaration, not
// a probe: a human reading this line is what catches a mismatch.
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})`);

const apply = process.argv.includes("--apply");
if (environment === "production" && !process.argv.includes("--yes-production")) {
  console.error("Refusing to run against the production database without --yes-production.");
  process.exit(1);
}
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1] ?? null;

const actor = "system:backfill-answers";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  // Only records that HAVE a category: without one there are no questions and
  // no answer rows, and this pass deliberately creates neither. Setting a
  // category later makes them `missing`, and a re-run picks them up.
  const records = await client.query(
    `select r.id, r.record_no, r.item_description, p.bws_project_number, p.name as project_name, run.name as run_name
       from spec_records r
       join projects p on p.id = r.project_id
       join spec_runs run on run.id = r.run_id
      where r.status = 'active'
        and r.category_id is not null
        and ($1::uuid is null or r.project_id = $1::uuid)
        and exists (select 1 from record_attributes a where a.record_id = r.id and a.status = 'active')
      order by p.bws_project_number, run.sort_order, r.record_no`,
    [projectArg],
  );

  console.log(`${records.rows.length} categorised record(s) with attributes to consider.\n`);

  let planned = 0;
  let wouldWrite = 0;
  let written = 0;
  let untouched = 0;

  for (const record of records.rows) {
    const attributeRows = await client.query(
      `select attr_group, dimension_slot, spec_field_id, value, unit, state, sort_order, source_run_id
         from record_attributes where record_id = $1 and status = 'active' order by sort_order`,
      [record.id],
    );
    const promotable: PromotableAttribute[] = attributeRows.rows.map((row) => ({
      attrGroup: String(row.attr_group),
      dimensionSlot: row.dimension_slot ? String(row.dimension_slot) : null,
      specFieldId: row.spec_field_id ? String(row.spec_field_id) : null,
      value: row.value === null ? null : String(row.value),
      unit: row.unit === null ? null : String(row.unit),
      state: String(row.state) as PromotableAttribute["state"],
      sortOrder: Number(row.sort_order),
      sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
    }));

    const fills = planAnswerFills(promotable);
    if (fills.length === 0) {
      untouched += 1;
      continue;
    }
    planned += fills.length;

    const label = `${record.bws_project_number}-${String(record.record_no).padStart(3, "0")} · ${record.run_name} · ${record.item_description}`;

    if (!apply) {
      // Count what a write WOULD move, using the same predicate the writer
      // uses, so the dry run cannot promise more than the apply delivers.
      for (const fill of fills) {
        const eligible = await client.query(
          `select a.id, a.state
             from spec_answers a
             join requirements q on q.id = a.requirement_id
             left join spec_fields f on f.id = q.spec_field_id
            where a.record_id = $1
              and a.revision_no = 0
              and (a.state = 'missing'
                   or (a.source_kind = 'document'
                       and exists (select 1 from intake_runs ir
                                    where ir.id = a.source_id and ir.document_kind = 'shop_drawings')))
              and ($2::int is null or f.json_id = $2::int)
              and ($3::uuid is null or q.spec_field_id = $3::uuid)`,
          [record.id, fill.jsonId, fill.specFieldId],
        );
        if (eligible.rows.length > 0) {
          wouldWrite += eligible.rows.length;
          console.log(`  ${label}`);
          console.log(`    ${fill.state.toUpperCase().padEnd(9)} ${fill.value}`);
        }
      }
      continue;
    }

    // One transaction per record, so a failure leaves a record whole rather
    // than half-answered. The record is the unit of commit here too.
    await client.query("begin");
    try {
      const txn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
        let text = "";
        strings.forEach((part, index) => {
          text += part;
          if (index < values.length) text += `$${index + 1}`;
        });
        const result = await client.query(text, values as unknown[]);
        return result.rows;
      }) as Parameters<typeof applyAnswerFills>[0];

      // One fill at a time, so the log says which ones actually MOVED rather
      // than which were planned. The first version printed every planned fill
      // under a smaller count, which reads as though answers went somewhere
      // they did not -- the exact kind of report this pass exists to replace.
      let count = 0;
      const landed: typeof fills = [];
      for (const fill of fills) {
        // No fallback run: every fill carries the document its value came from.
        const moved = await applyAnswerFills(txn, String(record.id), null, actor, [fill]);
        count += moved;
        if (moved > 0) landed.push(fill);
      }
      await client.query("commit");
      if (count > 0) {
        written += count;
        console.log(`  ${label} — ${count} answer(s)`);
        for (const fill of landed) console.log(`    ${fill.state.toUpperCase().padEnd(9)} ${fill.value}`);
      }
    } catch (cause) {
      await client.query("rollback");
      console.error(`  FAILED ${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
      throw cause;
    }
  }

  console.log("");
  console.log(`Records with nothing promotable: ${untouched}`);
  console.log(`Answers planned from attributes: ${planned}`);
  if (apply) {
    console.log(`Answers written: ${written}`);
  } else {
    console.log(`Answers a run would move: ${wouldWrite}`);
    console.log("\nDRY RUN — nothing was written. Re-run with --apply to write.");
  }
} finally {
  await client.end();
}
