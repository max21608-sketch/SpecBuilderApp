#!/usr/bin/env tsx
// A ONE-OFF pass: re-fold spec_record_refs.ref_value_norm with the one fold
// (audit 5.4 A3, 2026-11-06).
//
//   npm run db:backfill-ref-norm                 dry run
//   npm run db:backfill-ref-norm -- --apply      writes
//   npm run db:backfill-ref-norm:local           the local stack
//
// ============================================================================
// The plan is src/lib/ref-norm-backfill.ts. This file is the guard around it:
// the resolved host printed first, pilot behind --yes-pilot and production
// behind --yes-production (separate flags, db/script-env.mjs), nothing written
// without --apply, every update in ONE transaction.
//
// Two refs on one record that the stricter fold makes equal are NAMED and
// left as they are, both of them: never merged.
//
// Nothing in the app matches on this column (every matcher folds the stored
// ref_value itself), so the rows this leaves behind change no behaviour; the
// pass exists so the column means what it says. SAFE TO RE-RUN. Local first.
// ============================================================================
import pg from "pg";
import { requireScriptEnvironment } from "./script-env.mjs";
import { planRefNormBackfill, type RefRow } from "../src/lib/ref-norm-backfill";

const { databaseUrl } = requireScriptEnvironment("backfill-ref-norm.ts", [
  "npm run db:backfill-ref-norm           (reads .env.local)",
  "npm run db:backfill-ref-norm:local     (the local stack)",
  "Add -- --apply to write; without it this is a dry run.",
]);
const apply = process.argv.includes("--apply");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const rows = (
    await client.query(
      `select id, record_id, ref_system, ref_value, ref_value_norm from spec_record_refs order by record_id, ref_system, ref_value`,
    )
  ).rows.map(
    (row): RefRow => ({
      id: String(row.id),
      recordId: String(row.record_id),
      refSystem: String(row.ref_system),
      refValue: String(row.ref_value),
      refValueNorm: String(row.ref_value_norm),
    }),
  );
  const plan = planRefNormBackfill(rows);
  console.log(`${rows.length} refs: ${plan.updates.length} to re-fold, ${plan.unchanged} already folded, ${plan.collisions.length} collision(s).`);
  for (const collision of plan.collisions) {
    console.log(`  ⚠ left as they are: record ${collision.recordId} ${collision.refSystem} ${collision.values.map((v) => `"${v}"`).join(" and ")} both fold to ${collision.norm}`);
  }
  if (!apply) {
    console.log("\nDRY RUN — nothing was written. Re-run with -- --apply");
  } else {
    await client.query("begin");
    for (const update of plan.updates) {
      await client.query(`update spec_record_refs set ref_value_norm = $2 where id = $1 and ref_value_norm = $3`, [update.id, update.to, update.from]);
    }
    await client.query("commit");
    console.log(`\nWrote ${plan.updates.length} row(s).`);
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
