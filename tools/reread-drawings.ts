#!/usr/bin/env tsx
// Read a drawings document AGAIN, under the current tool schema.
//
//   npm run reread:drawings -- --run=<intake_runs.id>            dry run
//   npm run reread:drawings -- --run=<intake_runs.id> --apply     SPENDS MONEY
//
// ============================================================================
// THIS COSTS A CHARGED MODEL CALL EVERY TIME, AND IT OVERWRITES STAGED WORK.
//
// A prompt and a tool schema are read at CALL time, so a document already read
// keeps the output it has. Version 2 of the drawings contract — which figure is
// the width, whether it measures the whole item, whether repeated pages are one
// item — therefore reaches an existing pack only by paying for it again. That
// is the cost of the change and it is why this is a deliberate command with an
// --apply flag rather than anything automatic.
//
// It runs THE WORKER'S OWN PATH: `openAttempt` then `runDocumentExtraction`,
// the same two calls the queue makes. Nothing here reimplements staging, the
// claim protocol or the failure handling, so what lands is what the app would
// have landed.
//
// THE OLD STAGED JSON IS WRITTEN OUT FIRST, outside the repo, because
// `intake_runs.parsed` is overwritten in place and a reviewer may be part way
// through it. house/data-safety.md: preserve the original. The backup is a
// file, not a database row, because this is a one-off and a second staged copy
// would be a shape nothing else reads.
//
// Sandbox only by intent, but the same environment guard as every other db
// script, so running it against production is a deliberate act.
// ============================================================================
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { openAttempt } from "../src/lib/extraction-dispatch";
import { runDocumentExtraction } from "../src/lib/extraction-run";
import { withTransaction } from "../src/lib/db-transaction";
import { assertStagedDrawings } from "../src/lib/drawing-document";
import { composeDimensionCell } from "../src/lib/dimensions";
import type { DimensionSlot } from "../src/lib/spec-vocab";
import { sql } from "../src/lib/db";

const DATABASE_ENVIRONMENTS = ["sandbox", "pilot", "production"];
const ACTOR = "system:reread-drawings";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const runId = arg("run");
const apply = process.argv.includes("--apply");
const backupDir = arg("backup") ?? path.join(process.env.HOME ?? ".", "spec-builder-backups", "reread");

if (!runId) {
  console.error("Name the run: npm run reread:drawings -- --run=<intake_runs.id> [--apply]");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (!DATABASE_ENVIRONMENTS.includes(environment)) {
  console.error(`DATABASE_ENVIRONMENT must be one of: ${DATABASE_ENVIRONMENTS.join(", ")}.`);
  process.exit(1);
}
if (environment === "production" && !process.argv.includes("--yes-production")) {
  console.error("Refusing to re-read against production without --yes-production.");
  process.exit(1);
}
// Pilot is Matthew's own data, not a database anybody can re-seed, and this
// script SPENDS MONEY as well as writing. Its own flag, for the reason
// db/script-env.mjs gives: a flag standing for "any protected environment"
// would let somebody who meant one reach the other.
if (environment === "pilot" && !process.argv.includes("--yes-pilot")) {
  console.error("Refusing to re-read against the pilot database without --yes-pilot.");
  process.exit(1);
}
let host = "unknown host";
try {
  host = new URL(databaseUrl).host;
} catch {
  // A malformed URL fails at connect time with a better message.
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})`);

const rows = await sql`
  select r.id, r.status, r.document_kind, r.parsed, a.filename, p.name as project_name
  from intake_runs r
  left join attachments a on a.id = r.attachment_id
  left join projects p on p.id = r.project_id
  where r.id = ${runId}
`;
const run = rows[0];
if (!run) {
  console.error(`No run ${runId}.`);
  process.exit(1);
}
if (run.document_kind !== "shop_drawings") {
  console.error(`Run ${runId} is ${String(run.document_kind)}, not shop_drawings.`);
  process.exit(1);
}

const before = run.parsed ? assertStagedDrawings(run.parsed) : null;
console.log("");
console.log(`  ${String(run.project_name)} · ${String(run.filename)}`);
console.log(`  status ${String(run.status)} · staged schemaVersion ${before?.schemaVersion ?? "(nothing staged)"}`);

/** What the card's dimension panel would say for each item, through the real composer. */
function cells(doc: Awaited<ReturnType<typeof assertStagedDrawings>> | null): string[] {
  if (!doc) return [];
  return doc.items.map((item) => {
    const cell = composeDimensionCell(
      item.observations
        .filter((o) => o.reviewStatus === "pending" && o.attrGroup === "dimension" && o.dimensionSlot)
        .map((o, index) => ({
          slot: o.dimensionSlot as DimensionSlot,
          value: o.value,
          unit: o.unit,
          state: o.state ?? "confirmed",
          sortOrder: index,
        })),
    );
    return `${item.itemCodeRaw ?? "(no code)"} p${item.page ?? "?"}  ${cell.text || "—"}`;
  });
}

console.log("");
console.log("  BEFORE:");
for (const line of cells(before)) console.log(`    ${line}`);

if (!apply) {
  console.log("");
  console.log("  Dry run. Nothing was sent to the model and nothing was written.");
  console.log("  Re-run with --apply to spend ONE charged model call and replace what is staged.");
  process.exit(0);
}

// The original, kept before anything overwrites it.
await mkdir(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `${runId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(backupPath, JSON.stringify(run.parsed ?? null, null, 2), "utf8");
console.log("");
console.log(`  Staged JSON written to ${backupPath}`);

const attemptId = randomUUID();
const opened = await withTransaction((txn) => openAttempt(txn, runId, attemptId, ACTOR));
if (!opened) {
  console.error("  Could not open an attempt on that run.");
  process.exit(1);
}

console.log("  Reading… (one charged model call)");
const outcome = await runDocumentExtraction({ extractionId: runId, attemptId: opened, actor: ACTOR });
console.log(`  outcome: ${JSON.stringify(outcome)}`);

const after = await sql`select parsed from intake_runs where id = ${runId}`;
const staged = after[0]?.parsed ? assertStagedDrawings(after[0].parsed) : null;
console.log("");
console.log(`  AFTER (schemaVersion ${staged?.schemaVersion ?? "?"}):`);
for (const line of cells(staged)) console.log(`    ${line}`);
if (staged?.codeGroups?.length) {
  console.log("");
  console.log("  code groups:");
  for (const group of staged.codeGroups) {
    console.log(`    ${group.itemCodes.join(" / ")} pages ${group.pages.join(", ")} → ${group.relationship}`);
    console.log(`      ${group.evidence ?? "(no evidence given)"}`);
  }
} else {
  console.log("");
  console.log("  code groups: none reported (no code appears on more than one page).");
}
