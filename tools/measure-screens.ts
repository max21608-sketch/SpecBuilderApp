// MEASURE BEFORE CHANGING. Read only.
//
// Two screens have a measured complaint against them (found-in-use,
// 2026-09-19 and 2026-09-20): the projects list answers in about two seconds,
// and the 300-line project overview takes 10.4 to render where §7.4a asks for
// under two. Both entries name `loadOutstanding` as the LIKELY weight and
// both say so as a reading rather than a measurement.
//
// This times each loader the two screens call, separately, so the reading can
// be checked rather than believed. It writes nothing and calls no model.
//
//   npx tsx --env-file-if-exists=.env.local tools/measure-screens.ts
//   npx tsx --env-file-if-exists=.env.local tools/measure-screens.ts --project=DEMO-300
import { sql } from "../src/lib/db";
import { loadProjectCompletion } from "../src/lib/project-completion";
import { loadProjectSummaries } from "../src/lib/project-summary";
import { lineIdsForRecords, loadOutstanding, loadSentCoverage, waitingByQuestion } from "../src/lib/chase-drafts";

async function time<T>(label: string, fn: () => Promise<T>): Promise<[string, number, T]> {
  const started = Date.now();
  const value = await fn();
  return [label, Date.now() - started, value];
}

function size(value: unknown): string {
  const bytes = Buffer.byteLength(JSON.stringify(value ?? null));
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--project="));
  const wanted = arg ? arg.slice("--project=".length) : null;

  const rows = await sql`select p.id, p.bws_project_number, p.name,
           (select count(*) from spec_records r where r.project_id = p.id) as record_count
      from projects p where p.status = 'active' order by p.bws_project_number`;
  const ids = rows.map((r) => String(r.id));
  console.log(`\n=== THE PROJECTS LIST — ${ids.length} active projects ===`);

  const listed: [string, number, unknown][] = [];
  listed.push(await time("the header query", () => sql`
    select p.id, p.bws_project_number, p.name, p.client, p.status,
           (select count(*) from spec_runs sr where sr.project_id = p.id and sr.status = 'active') as run_count,
           (select count(*) from spec_records r where r.project_id = p.id) as record_count
      from projects p where p.status = 'active'`));
  listed.push(await time("loadProjectCompletion", () => loadProjectCompletion(ids)));
  listed.push(await time("loadProjectSummaries", () => loadProjectSummaries(ids)));
  const [, outMs, outstanding] = await time("loadOutstanding UNSCOPED (what it used to load)", () =>
    loadOutstanding(ids),
  );
  listed.push(["loadOutstanding UNSCOPED (what it used to load)", outMs, outstanding]);
  listed.push(await time("loadSentCoverage", () => loadSentCoverage(ids)));
  const cov = await loadSentCoverage(ids);
  const [, scopedMs, scoped] = await time("loadOutstanding SCOPED to coverage (what it loads now)", async () => {
    if (cov.length === 0) return [];
    const lines = await lineIdsForRecords([...new Set(cov.map((row) => row.recordId))]);
    return loadOutstanding(ids, {
      lineIds: lines,
      requirementIds: [...new Set(cov.map((row) => row.requirementId))],
    });
  });
  listed.push(["loadOutstanding SCOPED to coverage (what it loads now)", scopedMs, scoped]);
  // The answer must be IDENTICAL, or the scope is an approximation and not a
  // narrowing. This is the assertion, not a comment about one.
  const before = waitingByQuestion(outstanding, cov);
  const after = waitingByQuestion(scoped as typeof outstanding, cov);
  const same =
    before.size === after.size && [...before.keys()].every((k) => after.has(k));
  console.log(`  ${same ? "SAME" : "*** DIFFERENT ***"}: waiting = ${before.size} unscoped, ${after.size} scoped`);

  let total = 0;
  for (const [label, ms, value] of listed) {
    total += ms;
    const extra = Array.isArray(value) ? `  ${value.length} rows, ${size(value)}` : "";
    console.log(`  ${String(ms).padStart(6)} ms  ${label}${extra}`);
  }
  console.log(`  ${String(total).padStart(6)} ms  TOTAL (the route runs some of these in parallel)`);

  const coverage = await loadSentCoverage(ids);
  const [, waitMs] = await time("waitingByQuestion", async () => waitingByQuestion(outstanding as never, coverage));
  console.log(`  ${String(waitMs).padStart(6)} ms  waitingByQuestion (in process, not SQL)`);

  // ---- one project's overview -------------------------------------------
  const target = wanted
    ? rows.find((r) => String(r.bws_project_number).includes(wanted) || String(r.name).includes(wanted))
    : rows.reduce<(typeof rows)[number] | undefined>(
        (big, r) => (big && Number(big.record_count ?? 0) >= Number(r.record_count ?? 0) ? big : r),
        undefined,
      );
  if (!target) {
    console.log("\nNo project matched.");
    return;
  }
  const id = String(target.id);
  const count = await sql`select count(*)::int as n from spec_records where project_id = ${id}`;
  console.log(`\n=== ONE PROJECT'S OVERVIEW — ${target.bws_project_number} ${target.name}, ${count[0]?.n} records ===`);

  const one: [string, number, unknown][] = [];
  one.push(await time("loadProjectCompletion", () => loadProjectCompletion([id])));
  one.push(await time("loadProjectSummaries", () => loadProjectSummaries([id])));
  one.push(await time("loadOutstanding (this project)", () => loadOutstanding([id])));
  one.push(await time("the records query /api/records", () => sql`
    select r.id, r.record_no, r.designer from spec_records r
     where r.project_id = ${id} and r.status = 'active'`));
  let oneTotal = 0;
  for (const [label, ms, value] of one) {
    oneTotal += ms;
    const extra = Array.isArray(value) ? `  ${value.length} rows, ${size(value)}` : "";
    console.log(`  ${String(ms).padStart(6)} ms  ${label}${extra}`);
  }
  console.log(`  ${String(oneTotal).padStart(6)} ms  TOTAL`);
  console.log("");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
