#!/usr/bin/env tsx
// What a staged drawing run ACTUALLY reduces to, printed as a table.
//
//   npm run dump:drawings -- --run=<intake_runs.id>
//   npm run dump:drawings -- --project=<projects.id>      every drawings run
//   npm run dump:drawings -- --run=<id> --item=S-201      one code, row by row
//
// READ ONLY. It runs no UPDATE, no INSERT and no DELETE, which is why it has
// no --apply and no --yes-production: there is nothing to guard. It still
// prints the resolved host first, because `house/conventions.md` §3 is about
// knowing which database answered, not only about which one is about to be
// written to.
//
// ============================================================================
// WHY THIS EXISTS
//
// "Verified against the real pack" was prose in CLAUDE.md and nowhere else:
// S-200 `W840 x D790 x H720 x SH460mm`, S-201 `W660 x D685 x H680mm`, and so
// on, written down by hand after somebody read eleven cards on a screen. A
// sentence like that cannot be re-run, cannot be diffed, and goes stale the
// first time a read-time rule changes -- which is exactly when it is worth
// something.
//
// So this calls `assertStagedDrawings`, the SAME function the GET route calls,
// and prints what it returns. Nothing here reimplements a rule: the composed
// cell comes from `composeDimensionCell`, the letters from
// `variantLettersByItem`, the measured-row test from `isMeasuredRow`. A second
// implementation would be a tool that agrees with itself rather than with the
// app.
//
// Run it before and after a change to the read-time pipeline; the diff is the
// change. That is the artefact step 2 of M8 has been missing.
// ============================================================================
import {
  assertStagedDrawings,
  isMeasuredRow,
  variantLettersByItem,
  drawingItemBlockers,
  resolveDrawingTargets,
  targetRecordIds,
  occupancyThrough,
  type DrawingItem,
  type DrawingObservation,
  type StagedDrawings,
} from "../src/lib/drawing-document";
import { composeDimensionCell } from "../src/lib/dimensions";
import type { DimensionSlot } from "../src/lib/spec-vocab";
import { unitSourceOf } from "../src/lib/drawing-document";
import { loadDrawingContext } from "../src/lib/drawing-resolution";
import { sql } from "../src/lib/db";

const DATABASE_ENVIRONMENTS = ["sandbox", "production"];

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const runId = arg("run");
const projectId = arg("project");
const itemFilter = arg("item");

if (!runId && !projectId) {
  console.error("Name what to dump:");
  console.error("  npm run dump:drawings -- --run=<intake_runs.id>");
  console.error("  npm run dump:drawings -- --project=<projects.id>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with: npm run dump:drawings -- --run=<id>   (reads .env.local)");
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
  // A malformed URL fails at connect time with a better message than this one.
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})  [read only]`);

/** The cell BWS would receive, through the composer the export itself calls. */
function composed(item: DrawingItem): string {
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
  return cell.text || "—";
}

/** Every distinct unit + provenance on the item's placed rows. */
function unitSummary(rows: DrawingObservation[]): string {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(`${row.unit ?? "none"} ${unitSourceOf(row) ?? "-"}`.trim());
  }
  return seen.size === 0 ? "—" : [...seen].sort().join(", ");
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

async function dumpRun(row: Record<string, unknown>) {
  const id = String(row.id);
  const filename = row.filename === null || row.filename === undefined ? "(no filename)" : String(row.filename);
  console.log("");
  console.log(`RUN ${id}  ${String(row.status)}  ${filename}`);
  console.log(`  project ${String(row.project_name)}  default dimension unit: ${row.default_dimension_unit ?? "none"}`);

  if (row.parsed === null || row.parsed === undefined) {
    console.log("  nothing staged yet.");
    return;
  }

  let staged: StagedDrawings;
  try {
    staged = assertStagedDrawings(row.parsed);
  } catch (error) {
    console.log(`  NOT READABLE: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const letters = variantLettersByItem(staged.items);
  const context = await loadDrawingContext(String(row.project_id));

  console.log("");
  console.log(
    `  ${pad("page", 5)}${pad("code", 10)}${pad("name", 14)}${pad("cfg", 4)}${pad("meas", 6)}${pad("slot", 5)}${pad("fold", 5)}${pad("unit", 22)}dimension cell`,
  );
  for (const item of staged.items) {
    if (itemFilter && (item.itemCodeRaw ?? "").toLowerCase() !== itemFilter.toLowerCase()) continue;
    const pending = item.observations.filter((o) => o.reviewStatus === "pending");
    const measured = pending.filter(isMeasuredRow);
    const placed = pending.filter((o) => o.dimensionSlot);
    const folded = measured.filter((o) => !o.dimensionSlot);
    console.log(
      `  ${pad(String(item.page ?? "-"), 5)}${pad(item.itemCodeRaw ?? "(no code)", 10)}${pad(item.itemNameRaw ?? "-", 14)}` +
        `${pad(letters.get(item.id) ?? "-", 4)}${pad(String(measured.length), 6)}${pad(String(placed.length), 5)}` +
        `${pad(String(folded.length), 5)}${pad(unitSummary(placed), 22)}${composed(item)}`,
    );

    const resolution = resolveDrawingTargets(item.itemCodeRaw, context.records);
    const targets = targetRecordIds(item, resolution);
    const variantLabel = letters.get(item.id) ?? null;
    const writesTo = new Map<string, string>();
    if (variantLabel) {
      for (const parentId of targets) {
        const variantId = context.variants.get(`${parentId}|${variantLabel}`);
        if (variantId) writesTo.set(parentId, variantId);
      }
    }
    const blockers = drawingItemBlockers(item, resolution, occupancyThrough(context.occupied, writesTo));
    for (const blocker of blockers) {
      console.log(`         ! ${blocker.code}: ${blocker.message}`);
    }

    if (itemFilter) {
      for (const observation of pending) {
        const slot = observation.dimensionSlot ? `${observation.dimensionSlot}${observation.slotSuggested ? "?" : ""}` : "";
        console.log(
          `         ${pad(observation.attrGroup, 10)}${pad(observation.labelRaw ?? "-", 16)}` +
            `${pad((observation.value ?? "").slice(0, 28), 30)}${pad(observation.unit ?? "-", 5)}` +
            `${pad(unitSourceOf(observation) ?? "-", 16)}${slot}`,
        );
      }
    }
  }
}

async function main() {
  const rows = runId
    ? await sql`
        select ir.id, ir.status, ir.parsed, ir.project_id, p.name as project_name,
               p.default_dimension_unit, at.filename
          from intake_runs ir
          join projects p on p.id = ir.project_id
          left join attachments at on at.id = ir.attachment_id
         where ir.id = ${runId} and ir.document_kind = 'shop_drawings'
      `
    : await sql`
        select ir.id, ir.status, ir.parsed, ir.project_id, p.name as project_name,
               p.default_dimension_unit, at.filename
          from intake_runs ir
          join projects p on p.id = ir.project_id
          left join attachments at on at.id = ir.attachment_id
         where ir.project_id = ${projectId} and ir.document_kind = 'shop_drawings'
         order by ir.created_at
      `;

  if (rows.length === 0) {
    console.log("No shop-drawing runs matched.");
    return;
  }
  for (const row of rows) await dumpRun(row);
  console.log("");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
