#!/usr/bin/env tsx
// HOW MUCH OF THE DRAWINGS READING IS THE APP GUESSING, counted across every
// staged run rather than read off one card.
//
//   npm run measure:drawings                     every project
//   npm run measure:drawings -- --project=<id>   one project
//   npm run measure:drawings -- --detail         name every affected item
//
// READ ONLY. No UPDATE, no INSERT, no DELETE, and so no --apply and no
// --yes-production. It prints the resolved host first anyway, because
// `house/conventions.md` §3 is about knowing which database answered.
//
// ============================================================================
// WHY THIS EXISTS
//
// Three defects were reported on one pack in one sitting -- a transposed
// dimension cell, a sprawling card, one armchair split into two BWS jobs -- and
// the reply to each was "how many others?". "Many lines have this issue" is not
// a number, and an overhaul with no before-state cannot be shown to have
// improved anything.
//
// So this calls `assertStagedDrawings`, the SAME function the GET route and
// `dump:drawings` call, and counts what comes back. Nothing here reimplements a
// rule: the slots come from the read-time pipeline, the letters from
// `variantLettersByItem`, the weak-tier detection from `guessSlotsFromViews`
// itself, the unit provenance from `unitSourceOf`. A second implementation
// would be a tool that agrees with itself rather than with the app.
//
// `dump:drawings` answers "what does THIS run reduce to". This answers "how
// often is the app deciding rather than reading", across the lot.
//
// ---- THE VIEW REGIONS (item 1.9) ------------------------------------------
//
// The same pack, the same question, one column further right. *"The picture
// extract hasn't worked very well this time."* Two failures look identical on
// a card — the model reported NOTHING (the whole-page fallback, which is the
// design) and the model reported a box the crop then drew wrong — and they
// have different fixes at very different prices: the first is the PROMPT and
// costs a re-read of every document already read, the second is `pdf-crop.ts`
// and costs nothing. So they are counted apart, before either is touched.
//
// The counting is `src/lib/view-region-measure.ts`, which is pure and tested:
// this file needs a database, and a rule nobody can test is a rule nobody can
// trust.
// ============================================================================
import {
  assertStagedDrawings,
  readByModel,
  groupItemsByCode,
  variantLettersByItem,
  foldableRow,
  measuredRows,
  redundantOverallRows,
  unitSourceOf,
  type DrawingItem,
  type DrawingObservation,
  type StagedDrawings,
} from "../src/lib/drawing-document";
import { guessSlotsFromViews } from "../src/lib/dimension-guess";
import {
  addRegionCounts,
  blankRegionCounts,
  countRegions,
  readViewRegions,
  type RegionCounts,
  type RegionFault,
} from "../src/lib/view-region-measure";
import { parseDimensionFigure } from "../src/lib/dimensions";
import { normaliseDimensionSlot } from "../src/lib/spec-vocab";
import { sql } from "../src/lib/db";

const DATABASE_ENVIRONMENTS = ["sandbox", "pilot", "production"];

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const projectId = arg("project");
const detail = process.argv.includes("--detail");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with: npm run measure:drawings   (reads .env.local)");
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

/**
 * The magnitude tier's own reason strings, as `dimension-guess.ts` writes them.
 *
 * Detected by the SENTENCE rather than re-derived, because re-deriving "was
 * this the weak path" here would be a second copy of the rule -- the thing this
 * whole exercise is about. If those strings change, this stops counting and
 * says so rather than counting the wrong thing.
 */
const MAGNITUDE_MARK = "no view says so";

type Counts = {
  runs: number;
  runsV2: number;
  items: number;
  itemsNoCode: number;
  placedRows: number;
  suggestedRows: number;
  magnitudeItems: number;
  disputeItems: number;
  labelContradictions: number;
  unit: Record<string, number>;
  lettered: number;
  letteredGroups: number;
  falseSplitGroups: number;
  unfoldableDimensionRows: number;
  /**
   * The same printed figure staged TWICE — once slotted with the model's
   * evidence, once as a bare part of the combined line filed as a note. Counted
   * with `redundantOverallRows`, the app's own rule, so this reads what the
   * card drops rather than a second opinion about it.
   */
  duplicateOverallRows: number;
  /** Item 1.9 — see the header. Counted by its own pure module. */
  regions: RegionCounts;
};

function blank(): Counts {
  return {
    runs: 0, runsV2: 0, items: 0, itemsNoCode: 0, placedRows: 0, suggestedRows: 0,
    magnitudeItems: 0, disputeItems: 0, labelContradictions: 0, unit: {},
    lettered: 0, letteredGroups: 0, falseSplitGroups: 0, unfoldableDimensionRows: 0, duplicateOverallRows: 0,
    regions: blankRegionCounts(),
  };
}

/** Sum `from` into `into`. Every field is a count, and `unit` is a count per key. */
function add(into: Counts, from: Counts): void {
  for (const key of Object.keys(from) as (keyof Counts)[]) {
    if (key === "unit" || key === "regions") continue;
    (into[key] as number) += from[key] as number;
  }
  for (const [source, n] of Object.entries(from.unit)) {
    into.unit[source] = (into.unit[source] ?? 0) + n;
  }
  addRegionCounts(into.regions, from.regions);
}

const pending = (item: DrawingItem): DrawingObservation[] =>
  item.observations.filter((o) => o.reviewStatus === "pending");

/**
 * A row a reader would call a dimension that the card nonetheless prints
 * INLINE, between the ones that matter and the fabrics. The S-201 sprawl,
 * counted as the card actually renders it.
 *
 * `foldableRow` is the CARD'S OWN predicate, imported rather than restated: a
 * count taken with its own copy of that rule would happily report a card
 * getting better while the card got worse.
 */
const DIMENSION_WORDS = ["width", "depth", "height", "seat", "back", "dia", "diameter", "length", "arm"];
function unfoldableDimensionRow(o: DrawingObservation): boolean {
  if (o.dimensionSlot || foldableRow(o)) return false;
  if (parseDimensionFigure(o.value ?? o.valueRaw).figure !== null) return false;
  const label = (o.labelRaw ?? "").toLowerCase();
  return label !== "" && DIMENSION_WORDS.some((word) => label.includes(word));
}

/**
 * What an item's finishes SAY, folded — not the codes they are filed under.
 *
 * A PROXY, and a rough one, which is the point of measuring it rather than
 * building a rule on it. S-200 is the case that sets the bar: page 1 states
 * `FABRIC REFERENCE = Tibor Blob Amber Fern` and page 2 states
 * `FABRIC / CLO003 A = Tibor Blob Amber Fern`. Same chair, same cloth, two
 * vocabularies -- so comparing CODES calls them different and comparing the
 * DESCRIPTIONS calls them the same. Neither is reliable enough to decide a
 * split on, and that is the finding: whether two sources are one item is a
 * judgement about the pages, not a string diff.
 */
function finishSignature(item: DrawingItem): string {
  const said = pending(item)
    .filter((o) => o.attrGroup === "material" || o.attrGroup === "finish")
    .map((o) => (o.value ?? o.valueRaw ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .filter((text) => text !== "" && text !== "tbc")
    .sort();
  return JSON.stringify(said);
}

function measure(staged: StagedDrawings, counts: Counts, label: string, notes: string[]): void {
  counts.runs += 1;
  // Version 2 was read by a model that said which figure is which. The guessing
  // pipeline does not run on it, so re-asking `guessSlotsFromViews` below would
  // count a guess the app never made and never showed anybody.
  const guesses = !readByModel(staged);
  if (!guesses) counts.runsV2 += 1;
  const letters = variantLettersByItem(staged.items, staged);
  const groups = groupItemsByCode(staged.items, staged);

  for (const [code, group] of groups) {
    if (group.length < 2) continue;
    counts.letteredGroups += 1;
    // A split the finishes do not support: every member states the same set.
    const sets = new Set(group.map(finishSignature));
    if (sets.size === 1) {
      counts.falseSplitGroups += 1;
      if (detail) notes.push(`  SAME FINISHES  ${label}  ${code} — ${group.length} sources describing one set`);
    }
  }

  for (const item of staged.items) {
    counts.items += 1;
    if (!item.itemCodeRaw) counts.itemsNoCode += 1;
    if (letters.get(item.id)) counts.lettered += 1;

    // WHAT THE PICTURE PANEL HAD TO WORK WITH. Read straight off the staged
    // item, through the same fields `ItemImagePicker` reads.
    const regionReading = readViewRegions(item);
    countRegions(counts.regions, regionReading);
    if (detail) {
      for (const region of regionReading.regions) {
        if (region.faults.length === 0) continue;
        notes.push(
          `  VIEW REGION  ${label}  ${item.itemCodeRaw ?? "(no code)"}  ${region.viewType} p${region.page ?? "?"} ` +
            `[${(region.bbox ?? []).join(", ")}] — ${region.faults.join(", ")}`,
        );
      }
      if (regionReading.reported === 0) {
        notes.push(`  NO REGION    ${label}  ${item.itemCodeRaw ?? "(no code)"} — the card offers the whole page`);
      }
    }

    // Version 2 only, exactly as the read-time pass is gated: a version 1 run
    // never had `isOverall` asked of it, and the combined line's parts were the
    // only reading of the overall size it had.
    if (!guesses) {
      const duplicates = redundantOverallRows(item.observations);
      counts.duplicateOverallRows += duplicates.size;
      if (detail && duplicates.size > 0) {
        for (const row of item.observations.filter((o) => duplicates.has(o.id))) {
          notes.push(
            `  STAGED TWICE ${label}  ${item.itemCodeRaw ?? "(no code)"}  "${row.labelRaw ?? ""}" = ${row.value ?? row.valueRaw ?? ""}${row.unit ?? ""}`,
          );
        }
      }
    }

    const rows = pending(item);
    for (const o of rows) {
      if (o.dimensionSlot) {
        counts.placedRows += 1;
        if (o.slotSuggested) counts.suggestedRows += 1;
        // THE TRANSPOSITION SIGNATURE: the page's own label names one slot and
        // the row carries another. S-203 shows three of these in a row.
        const fromLabel = normaliseDimensionSlot(o.labelRaw);
        if (fromLabel && fromLabel !== o.dimensionSlot) {
          counts.labelContradictions += 1;
          if (detail) {
            notes.push(
              `  LABEL vs SLOT  ${label}  ${item.itemCodeRaw ?? "(no code)"}  "${o.labelRaw}" = ${o.value ?? ""} → ${o.dimensionSlot} (label says ${fromLabel})`,
            );
          }
        }
        const source = unitSourceOf(o) ?? (o.unit === null ? "none" : "chosen");
        counts.unit[source] = (counts.unit[source] ?? 0) + 1;
      }
      if (unfoldableDimensionRow(o)) counts.unfoldableDimensionRows += 1;
    }

    // Re-ask the guess the same way the card does, to see which tier answered.
    if (!guesses) continue;
    const measured = measuredRows(item);
    if (measured.length === 0) continue;
    const guess = guessSlotsFromViews(
      measured.map((o) => ({ id: o.id, labelRaw: o.labelRaw, value: o.value ?? o.valueRaw })),
      item.itemNameRaw,
    );
    if (guess.dispute) counts.disputeItems += 1;
    if (guess.guesses.some((g) => g.why.includes(MAGNITUDE_MARK))) {
      counts.magnitudeItems += 1;
      if (detail) notes.push(`  MAGNITUDE    ${label}  ${item.itemCodeRaw ?? "(no code)"} — slots sorted by size`);
    }
  }
}

function report(title: string, c: Counts): void {
  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);
  console.log("");
  console.log(title);
  console.log(`  runs read                  ${c.runs}   (${c.runsV2} read by the model, ${c.runs - c.runsV2} still guessed)`);
  console.log(`  items staged               ${c.items}   (${c.itemsNoCode} carry no code)`);
  console.log(`  dimension rows placed      ${c.placedRows}   (${c.suggestedRows} suggested, ${pct(c.suggestedRows, c.placedRows)})`);
  console.log("");
  console.log(`  items slotted BY SIZE      ${c.magnitudeItems}   ${pct(c.magnitudeItems, c.items)} of items`);
  console.log(`  items raising a dispute    ${c.disputeItems}   ${pct(c.disputeItems, c.items)} of items`);
  console.log(`  rows whose LABEL disagrees ${c.labelContradictions}   <- the transposition`);
  console.log("");
  console.log(`  code stated on >1 source   ${c.letteredGroups} groups, ${c.lettered} items lettered`);
  console.log(`  ...saying the SAME finishes ${c.falseSplitGroups} groups   <- split on nothing`);
  console.log("");
  console.log(`  dimension rows inline that state no figure  ${c.unfoldableDimensionRows}   <- the sprawl`);
  console.log(`  overall figures staged TWICE                ${c.duplicateOverallRows}   <- the duplicate`);
  console.log("");
  console.log(`  unit provenance on placed rows:`);
  for (const [source, n] of Object.entries(c.unit).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${source.padEnd(18)} ${n}`);
  }
  console.log("");
  // ITEM 1.9. The first two lines answer "which failure is this" and nothing
  // else does: an item with no region falls back to the whole page BY DESIGN,
  // and an item with a faulty proposal is a picture somebody was shown and had
  // to redraw.
  const r = c.regions;
  const mean = r.coverageCount === 0 ? "—" : `${Math.round((r.coverageSum / r.coverageCount) * 100)}% of the page`;
  console.log(`  item pictures:`);
  console.log(`    items reporting a region    ${r.itemsWithRegions}   ${pct(r.itemsWithRegions, c.items)} of items`);
  console.log(`    items reporting NONE        ${r.itemsWithoutRegions}   <- the whole-page fallback, by design`);
  console.log(`    items with no proposal      ${r.itemsFallingBack}   <- what a reviewer had to draw by hand`);
  console.log(`    regions reported            ${r.regions}   (${r.regionsUsable} usable, ${pct(r.regionsUsable, r.regions)})`);
  console.log(`    PROPOSALS that are faulty   ${r.proposalsFaulty}   <- a wrong box somebody was shown`);
  console.log(`    mean region size            ${mean}`);
  const faults = (Object.entries(r.faults) as [RegionFault, number][]).filter(([, n]) => n > 0);
  console.log(`    faults: ${faults.length === 0 ? "none" : faults.map(([fault, n]) => `${fault} ${n}`).join(", ")}`);
  const types = Object.entries(r.byViewType).sort((a, b) => b[1] - a[1]);
  console.log(`    view types: ${types.length === 0 ? "none reported" : types.map(([type, n]) => `${type} ${n}`).join(", ")}`);
  // A CAVEAT THE NUMBER CANNOT CARRY. `viewRegions` is optional on a staged
  // item so a run from before pictures existed keeps reading, and such a run
  // counts under "reporting NONE" — it was never asked rather than asked and
  // silent. `--detail` names each one.
  if (r.itemsWithoutRegions > 0) {
    console.log(`    (a run staged before pictures existed also counts as NONE — use --detail to see which)`);
  }
}

// Two statements rather than one with an interpolated fragment: the HTTP
// driver takes a tagged template per call and cannot nest one inside another.
const runs = projectId
  ? await sql`
      select r.id, r.status, r.parsed, a.filename, p.name as project_name
      from intake_runs r
      left join attachments a on a.id = r.attachment_id
      left join projects p on p.id = r.project_id
      where r.source_kind = 'spec_document' and r.document_kind = 'shop_drawings'
        and r.parsed is not null and r.project_id = ${projectId}
      order by p.name, a.filename
    `
  : await sql`
      select r.id, r.status, r.parsed, a.filename, p.name as project_name
      from intake_runs r
      left join attachments a on a.id = r.attachment_id
      left join projects p on p.id = r.project_id
      where r.source_kind = 'spec_document' and r.document_kind = 'shop_drawings'
        and r.parsed is not null
      order by p.name, a.filename
    `;

const total = blank();
const byProject = new Map<string, Counts>();
const notes: string[] = [];
const unreadable: string[] = [];

for (const row of runs) {
  const project = String(row.project_name ?? "(no project)");
  const label = `${project}/${String(row.filename ?? "?").slice(0, 34)}`;
  let staged: StagedDrawings;
  try {
    staged = assertStagedDrawings(row.parsed);
  } catch (error) {
    unreadable.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  if (!byProject.has(project)) byProject.set(project, blank());
  measure(staged, byProject.get(project) as Counts, label, notes);
}

// Summed, never measured twice: a second pass over the same run would double
// every count and append every note again.
for (const counts of byProject.values()) add(total, counts);

for (const [project, counts] of [...byProject].sort((a, b) => a[0].localeCompare(b[0]))) {
  report(`── ${project}`, counts);
}
report("══ EVERY PROJECT", total);

if (unreadable.length > 0) {
  console.log("");
  console.log(`${unreadable.length} run(s) would not read:`);
  for (const line of unreadable) console.log(`  ${line}`);
}

if (detail) {
  console.log("");
  console.log(`── what is affected (${notes.length})`);
  for (const line of notes) console.log(line);
}
