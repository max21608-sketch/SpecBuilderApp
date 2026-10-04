// The drawings golden and its scorer. PURE: no database, no model, no files.
//
// ============================================================================
// WHAT THIS MEASURES, AND WHY IT GOES THROUGH THE APP'S OWN CODE.
//
// A golden file says what a person reading a drawing set would write down:
// which pages are one item, its codes, its configurations, its overall size in
// millimetres, its finish codes. The real ones live OUTSIDE the repo
// (`~/dev/localstack/drawings-golden/`, real client values) and the format is
// described in that directory's README. Nothing here holds a real value.
//
// A READ is scored as the REVIEW SCREEN would show it, not as the model
// returned it: the raw output goes through `stageDrawings`, then through
// `assertStagedDrawings` (the same read-time pipeline every screen calls),
// then is reduced with the app's OWN grouping (`groupItemsByCode`,
// `codesOfItem`, `namedConfigurationsByCode`, `variantLettersByItem`) and its
// OWN conversion (`toMillimetres`, `composeDimensionCell`). A scorer with its
// own copy of any of those would report a read getting better while the card
// got worse — the `foldableRow` rule, one layer out.
//
// Items are matched golden <-> read by CODE: `normaliseRef` equality first,
// then the resolver's end-of-code rule (`endsOnSegment`, either direction),
// because the Aman title blocks print `FUR-08` where the drawing number and
// the bill say `PL-FUR-08`.
//
// ONLY VERIFIED ENTRIES ARE THE SCORE. A golden drafted by a model and not yet
// ticked by a person is reported beside the verified total, never inside it.
// ============================================================================
import {
  assertStagedDrawings,
  codesOfItem,
  drawingNumberOf,
  foldableRow,
  groupItemsByCode,
  namedConfigurationsByCode,
  resolveDrawingTargets,
  stageDrawings,
  variantLettersByItem,
  type DrawingItem,
  type DrawingObservation,
  type StagedDrawings,
} from "../src/lib/drawing-document";
import { composeDimensionCell, toMillimetres, type DimensionRow } from "../src/lib/dimensions";
import { endsOnSegment, normaliseRef, type RecordEntry } from "../src/lib/record-refs";
import { normaliseFinishCode } from "../src/lib/finishes";
import { normaliseVariantLabel } from "../src/lib/record-variants";
import type { DrawingsOutput } from "../src/lib/extraction-schema";
import type { DimensionSlot } from "../src/lib/spec-vocab";

// ---- the golden ------------------------------------------------------------

export const GOLDEN_SLOTS = ["W", "D", "H", "SH", "Dia"] as const;
export type GoldenSlotKey = (typeof GOLDEN_SLOTS)[number];

const APP_SLOT: Record<GoldenSlotKey, DimensionSlot> = { W: "W", D: "D", H: "H", SH: "SH", Dia: "DIA" };

export type GoldenSlot = {
  printed?: string | null;
  unit?: string | null;
  /** Whole millimetres. The only field scored. */
  mm: number;
  view?: string | null;
  page?: number | null;
} | null;

export type GoldenItem = {
  codes: string[];
  billCode?: string | null;
  name?: string | null;
  pages: number[];
  configurations: string[];
  overall: Partial<Record<GoldenSlotKey, GoldenSlot>>;
  finishCodes: string[];
  confidence?: string | null;
  why?: string | null;
  /** Overrides the document's `verified` for this one entry. */
  verified?: boolean;
};

export type GoldenDocument = {
  file: string;
  pack?: string;
  pageCount?: number;
  verified: boolean;
  items: GoldenItem[];
  nonItemPages: { page: number; why?: string | null }[];
  draftNotes?: string | null;
};

/** A golden file, checked enough that the scorer cannot crash on it. Throws in words. */
export function parseGolden(json: unknown, source = "golden"): GoldenDocument {
  const doc = json as Partial<GoldenDocument> | null;
  if (!doc || typeof doc !== "object") throw new Error(`${source}: not a JSON object`);
  if (typeof doc.file !== "string" || !doc.file) throw new Error(`${source}: "file" is missing`);
  if (!Array.isArray(doc.items)) throw new Error(`${source}: "items" is not a list`);
  const items = doc.items.map((item, index) => {
    const where = `${source}: item ${index + 1}`;
    if (!item || typeof item !== "object") throw new Error(`${where} is not an object`);
    if (!Array.isArray(item.codes)) throw new Error(`${where}: "codes" is not a list`);
    if (!Array.isArray(item.pages)) throw new Error(`${where}: "pages" is not a list`);
    const overall: Partial<Record<GoldenSlotKey, GoldenSlot>> = {};
    for (const key of GOLDEN_SLOTS) {
      const slot = (item.overall ?? {})[key];
      if (slot === undefined || slot === null) {
        overall[key] = null;
        continue;
      }
      if (typeof slot !== "object" || typeof slot.mm !== "number" || !Number.isFinite(slot.mm)) {
        throw new Error(`${where}: overall.${key} has no numeric "mm"`);
      }
      overall[key] = slot;
    }
    return {
      ...item,
      codes: item.codes.filter((code): code is string => typeof code === "string" && code.trim() !== ""),
      pages: item.pages.filter((page): page is number => Number.isInteger(page)),
      configurations: Array.isArray(item.configurations)
        ? item.configurations.filter((name): name is string => typeof name === "string" && name.trim() !== "")
        : [],
      finishCodes: Array.isArray(item.finishCodes)
        ? item.finishCodes.filter((code): code is string => typeof code === "string" && code.trim() !== "")
        : [],
      overall,
    } as GoldenItem;
  });
  return {
    file: doc.file,
    pack: doc.pack,
    pageCount: doc.pageCount,
    verified: doc.verified === true,
    items,
    nonItemPages: Array.isArray(doc.nonItemPages)
      ? doc.nonItemPages.filter((entry) => entry && Number.isInteger(entry.page))
      : [],
    draftNotes: doc.draftNotes ?? null,
  };
}

// ---- the read, reduced -----------------------------------------------------

/** One item as the review screen would show it. */
export type ReadItem = {
  /** Every code the document gave it, canonical first. Empty for a codeless page. */
  codes: string[];
  pages: number[];
  /** The configuration names that would become records, folded as `variant_label` stores them. */
  configurations: string[];
  /** Per slot, the DISTINCT millimetre figures on the card's slotted rows. */
  overall: Record<GoldenSlotKey, number[]>;
  /** Per slot, figures that could not be converted (no unit, not numeric), verbatim. */
  unconverted: Record<GoldenSlotKey, string[]>;
  /** The composed BWS cell, as the card previews it. */
  cell: string;
  finishCodes: string[];
  /** Rows the card shows inline (not folded), still pending. */
  rowsToReview: number;
  /** Of those, how many are flagged yellow or amber (a guessed slot, unit or group). */
  rowsFlagged: number;
};

export type DrawingRead = {
  filename: string | null;
  items: ReadItem[];
};

function emptySlots<T>(make: () => T): Record<GoldenSlotKey, T> {
  return { W: make(), D: make(), H: make(), SH: make(), Dia: make() };
}

const uniqueSorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

/** A staged document, reduced to what the review screen would show per item. */
export function reduceStagedDrawings(stagedInput: StagedDrawings): DrawingRead {
  // Through the read-time pipeline every screen calls. With no spec-field
  // register: nothing scored here depends on which BWS field a callout lands on.
  const staged = assertStagedDrawings(JSON.parse(JSON.stringify(stagedInput)));
  const byCode = groupItemsByCode(staged.items, staged);
  const named = namedConfigurationsByCode(staged.items, staged);
  const letters = variantLettersByItem(staged.items, staged);

  const groups: { code: string | null; pages: DrawingItem[] }[] = [...byCode].map(([code, pages]) => ({ code, pages }));
  for (const item of staged.items) {
    if (!normaliseRef(item.itemCodeRaw ?? "")) groups.push({ code: null, pages: [item] });
  }

  const items = groups.map(({ code, pages }): ReadItem => {
    const codes: string[] = [];
    const addCode = (raw: string | null | undefined) => {
      const text = (raw ?? "").trim();
      if (text && !codes.some((kept) => normaliseRef(kept) === normaliseRef(text))) codes.push(text);
    };
    for (const page of pages) {
      for (const entry of codesOfItem(staged, page.itemCodeRaw)) addCode(entry);
      addCode(page.itemCodeRaw);
    }

    const configurations = code && named.has(code)
      ? (named.get(code) ?? []).map((entry) => entry.label)
      : [...new Set(pages.map((page) => letters.get(page.id)).filter((letter): letter is string => Boolean(letter)))];

    const overall = emptySlots<number[]>(() => []);
    const unconverted = emptySlots<string[]>(() => []);
    const rows: DimensionRow[] = [];
    const finishCodes: string[] = [];
    let rowsToReview = 0;
    let rowsFlagged = 0;
    let order = 0;

    const live = (observation: DrawingObservation) => observation.reviewStatus !== "ignored";
    for (const page of pages) {
      for (const observation of page.observations.filter(live)) {
        if (observation.reviewStatus === "pending" && !foldableRow(observation)) {
          rowsToReview += 1;
          if (observation.slotSuggested || observation.unitSuggested || observation.groupSuggested) rowsFlagged += 1;
        }
        const code = (observation.materialCodeRaw ?? "").trim();
        if (code && !finishCodes.some((kept) => normaliseFinishCode(kept) === normaliseFinishCode(code))) {
          finishCodes.push(code);
        }
        const slot = observation.attrGroup === "dimension" ? observation.dimensionSlot : null;
        if (!slot) continue;
        const key = GOLDEN_SLOTS.find((entry) => APP_SLOT[entry] === slot);
        if (!key) continue;
        const value = observation.value ?? observation.valueRaw;
        rows.push({
          slot,
          value,
          unit: observation.unit,
          state: observation.state ?? "confirmed",
          sortOrder: order++,
        });
        const mm = observation.unit ? toMillimetres(value, observation.unit) : null;
        if (mm && mm.ok) overall[key].push(mm.mm);
        else if (value) unconverted[key].push(observation.unit ? `${value} ${observation.unit}` : `${value} (no unit)`);
      }
    }
    for (const key of GOLDEN_SLOTS) overall[key] = uniqueSorted(overall[key]);

    return {
      codes,
      pages: [...new Set(pages.map((page) => page.page).filter((page): page is number => page !== null))].sort(
        (a, b) => a - b,
      ),
      configurations,
      overall,
      unconverted,
      cell: composeDimensionCell(rows).text,
      finishCodes,
      rowsToReview,
      rowsFlagged,
    };
  });

  return { filename: staged.filename, items };
}

/**
 * A raw model output, staged with the CURRENT code and reduced. No project
 * default unit: a harness reading a document cold has none, and the score is
 * what the page itself settles.
 */
export function readFromModelOutput(output: DrawingsOutput, filename: string | null): DrawingRead {
  const staged = stageDrawings(output.items, [], filename, output.documentNotes, null, output.codeGroups ?? []);
  return reduceStagedDrawings(staged);
}

// ---- matching --------------------------------------------------------------

/** 2 = the same code folded, 1 = one ends the other on a segment, 0 = unrelated. */
function codeAffinity(golden: GoldenItem, read: ReadItem): number {
  const goldenCodes = [...golden.codes, ...(golden.billCode ? [golden.billCode] : [])];
  let best = 0;
  for (const g of goldenCodes) {
    for (const r of read.codes) {
      if (normaliseRef(g) !== "" && normaliseRef(g) === normaliseRef(r)) return 2;
      if (endsOnSegment(g, r) || endsOnSegment(r, g)) best = 1;
    }
  }
  return best;
}

/**
 * Which read items each golden item matched. Exact matches are taken first,
 * then end-of-code ones, and a read item is claimed by one golden item only —
 * the strongest, then the earliest — so a suffix cannot be counted twice.
 */
export function matchItems(golden: GoldenDocument, read: DrawingRead): Map<number, number[]> {
  const claimed = new Map<number, number>();
  for (const strength of [2, 1]) {
    golden.items.forEach((item, goldenIndex) => {
      read.items.forEach((candidate, readIndex) => {
        if (claimed.has(readIndex)) return;
        if (codeAffinity(item, candidate) === strength) claimed.set(readIndex, goldenIndex);
      });
    });
  }
  const out = new Map<number, number[]>();
  golden.items.forEach((_, index) => out.set(index, []));
  for (const [readIndex, goldenIndex] of claimed) out.get(goldenIndex)?.push(readIndex);
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

// ---- the score -------------------------------------------------------------

export const SLOT_OUTCOMES = [
  "correct",
  "wrong_slot",
  "wrong_value",
  "unconverted",
  "missing",
  "extra",
  "absent_ok",
] as const;
export type SlotOutcome = (typeof SLOT_OUTCOMES)[number];

export type SlotTally = Record<SlotOutcome, number>;

export type ItemScore = {
  goldenCodes: string[];
  verified: boolean;
  /** Read items it matched, by their first code (or "page n" for a codeless one). */
  matched: string[];
  /** Exactly one read item, carrying exactly the golden's pages. */
  groupingExact: boolean;
  /** The app's resolver lands this item on the golden's bill code. Null when the golden names none. */
  billCodeResolved: boolean | null;
  slots: Record<GoldenSlotKey, { outcome: SlotOutcome; golden: number | null; read: number[]; note: string | null }>;
  configurations: { golden: string[]; read: string[]; countExact: boolean; namesExact: boolean };
  finishes: { golden: number; found: number; missing: string[] };
  rowsToReview: number;
  rowsFlagged: number;
  cell: string | null;
};

export type DocumentScore = {
  file: string;
  verified: boolean;
  items: ItemScore[];
  /** Read items no golden item claimed. */
  extraItems: string[];
  /** Golden non-item pages the read put a coded item on. */
  nonItemPagesWithItems: number[];
};

const TOLERANCE_MM = 1;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE_MM;

function slotOutcome(
  key: GoldenSlotKey,
  golden: GoldenSlot | undefined,
  read: Record<GoldenSlotKey, number[]>,
  unconverted: Record<GoldenSlotKey, string[]>,
): { outcome: SlotOutcome; note: string | null } {
  const values = read[key];
  if (!golden) {
    if (values.length > 0 || unconverted[key].length > 0) {
      return { outcome: "extra", note: `read ${[...values, ...unconverted[key]].join(" / ")} where the golden has none` };
    }
    return { outcome: "absent_ok", note: null };
  }
  if (values.length === 1 && near(values[0]!, golden.mm)) return { outcome: "correct", note: null };
  const elsewhere = GOLDEN_SLOTS.filter((other) => other !== key && read[other].some((value) => near(value, golden.mm)));
  if (elsewhere.length > 0 && !values.some((value) => near(value, golden.mm))) {
    return { outcome: "wrong_slot", note: `${golden.mm} read as ${elsewhere.join("/")}` };
  }
  if (values.length > 0) {
    return {
      outcome: "wrong_value",
      note:
        values.length > 1
          ? `${values.length} figures in one slot (${values.join(", ")}), golden ${golden.mm}`
          : `read ${values[0]}, golden ${golden.mm}`,
    };
  }
  if (unconverted[key].length > 0) {
    return { outcome: "unconverted", note: `read ${unconverted[key].join(" / ")}, golden ${golden.mm}` };
  }
  return { outcome: "missing", note: null };
}

function readLabel(item: ReadItem): string {
  return item.codes[0] ?? `page ${item.pages.join(",") || "?"} (no code)`;
}

/** Does the app's own resolver land this read on the golden's bill code? */
function resolvesToBill(golden: GoldenItem, reads: ReadItem[], filename: string | null): boolean | null {
  if (!golden.billCode) return null;
  const records: RecordEntry[] = [
    {
      id: "golden",
      recordNo: 1,
      label: "GOLDEN-001",
      itemDescription: golden.name ?? "",
      categoryId: null,
      categoryName: null,
      refs: [golden.billCode],
      boqCodes: [golden.billCode],
      runId: "golden-run",
      runName: "golden",
      parentId: null,
      variantLabel: null,
      version: 1,
    },
  ];
  return reads.some((read) => {
    const resolution = resolveDrawingTargets(read.codes[0] ?? null, records, {
      codes: read.codes,
      drawingNumber: drawingNumberOf(filename),
    });
    return resolution.suggested.includes("golden");
  });
}

export function scoreDrawingRead(golden: GoldenDocument, read: DrawingRead): DocumentScore {
  const matches = matchItems(golden, read);
  const claimed = new Set<number>();
  const items = golden.items.map((item, goldenIndex): ItemScore => {
    const indices = matches.get(goldenIndex) ?? [];
    indices.forEach((index) => claimed.add(index));
    const reads = indices.map((index) => read.items[index]!);

    // The slots are scored over everything the matched reads say: an item the
    // read split in two still shows its figures, and the split is the
    // grouping score's to report.
    const merged = emptySlots<number[]>(() => []);
    const unconverted = emptySlots<string[]>(() => []);
    for (const entry of reads) {
      for (const key of GOLDEN_SLOTS) {
        merged[key] = uniqueSorted([...merged[key], ...entry.overall[key]]);
        unconverted[key] = [...unconverted[key], ...entry.unconverted[key]];
      }
    }
    const slots = {} as ItemScore["slots"];
    for (const key of GOLDEN_SLOTS) {
      const goldenSlot = item.overall[key] ?? null;
      const { outcome, note } = slotOutcome(key, goldenSlot, merged, unconverted);
      slots[key] = { outcome, golden: goldenSlot ? goldenSlot.mm : null, read: merged[key], note };
    }

    const goldenPages = [...new Set(item.pages)].sort((a, b) => a - b);
    const groupingExact =
      reads.length === 1 && reads[0]!.pages.length === goldenPages.length && reads[0]!.pages.every((page, i) => page === goldenPages[i]);

    const goldenConfigurations = item.configurations.map(normaliseVariantLabel).sort();
    const readConfigurations = [...new Set(reads.flatMap((entry) => entry.configurations))].sort();

    const readFinishes = reads.flatMap((entry) => entry.finishCodes).map(normaliseFinishCode);
    const missingFinishes = item.finishCodes.filter((code) => !readFinishes.includes(normaliseFinishCode(code)));

    return {
      goldenCodes: item.codes,
      verified: item.verified ?? golden.verified,
      matched: reads.map(readLabel),
      groupingExact,
      billCodeResolved: resolvesToBill(item, reads, read.filename),
      slots,
      configurations: {
        golden: goldenConfigurations,
        read: readConfigurations,
        countExact: goldenConfigurations.length === readConfigurations.length,
        namesExact:
          goldenConfigurations.length === readConfigurations.length &&
          goldenConfigurations.every((name, index) => name === readConfigurations[index]),
      },
      finishes: {
        golden: item.finishCodes.length,
        found: item.finishCodes.length - missingFinishes.length,
        missing: missingFinishes,
      },
      rowsToReview: reads.reduce((total, entry) => total + entry.rowsToReview, 0),
      rowsFlagged: reads.reduce((total, entry) => total + entry.rowsFlagged, 0),
      cell: reads.length === 1 ? reads[0]!.cell : null,
    };
  });

  const nonItemPages = new Set(golden.nonItemPages.map((entry) => entry.page));
  const nonItemPagesWithItems = [
    ...new Set(
      read.items
        .filter((entry) => entry.codes.length > 0)
        .flatMap((entry) => entry.pages)
        .filter((page) => nonItemPages.has(page)),
    ),
  ].sort((a, b) => a - b);

  return {
    file: golden.file,
    verified: golden.verified,
    items,
    // A codeless read item is a page the card would show with nothing to
    // match on; it is extra only when it is not a page the golden calls a
    // non-item page.
    extraItems: read.items
      .filter((_, index) => !claimed.has(index))
      .filter((entry) => entry.codes.length > 0 || !entry.pages.every((page) => nonItemPages.has(page)))
      .map(readLabel),
    nonItemPagesWithItems,
  };
}

// ---- totals ----------------------------------------------------------------

export type ScoreTotals = {
  documents: number;
  items: number;
  groupingExact: number;
  billCodes: number;
  billCodesResolved: number;
  slots: SlotTally;
  configurationCountExact: number;
  configurationNamesExact: number;
  finishesGolden: number;
  finishesFound: number;
  rowsToReview: number;
  rowsFlagged: number;
  extraItems: number;
  nonItemPagesWithItems: number;
};

export function emptyTotals(): ScoreTotals {
  return {
    documents: 0,
    items: 0,
    groupingExact: 0,
    billCodes: 0,
    billCodesResolved: 0,
    slots: Object.fromEntries(SLOT_OUTCOMES.map((outcome) => [outcome, 0])) as SlotTally,
    configurationCountExact: 0,
    configurationNamesExact: 0,
    finishesGolden: 0,
    finishesFound: 0,
    rowsToReview: 0,
    rowsFlagged: 0,
    extraItems: 0,
    nonItemPagesWithItems: 0,
  };
}

/**
 * Totals over many documents, VERIFIED and UNVERIFIED kept apart. An item's
 * own `verified` decides which side it counts on; a document's extras count
 * with the document.
 */
export function totalScores(scores: DocumentScore[]): { verified: ScoreTotals; unverified: ScoreTotals } {
  const verified = emptyTotals();
  const unverified = emptyTotals();
  for (const score of scores) {
    (score.verified ? verified : unverified).documents += 1;
    const docSide = score.verified ? verified : unverified;
    docSide.extraItems += score.extraItems.length;
    docSide.nonItemPagesWithItems += score.nonItemPagesWithItems.length;
    for (const item of score.items) {
      const side = item.verified ? verified : unverified;
      side.items += 1;
      if (item.groupingExact) side.groupingExact += 1;
      if (item.billCodeResolved !== null) {
        side.billCodes += 1;
        if (item.billCodeResolved) side.billCodesResolved += 1;
      }
      for (const key of GOLDEN_SLOTS) side.slots[item.slots[key].outcome] += 1;
      if (item.configurations.countExact) side.configurationCountExact += 1;
      if (item.configurations.namesExact) side.configurationNamesExact += 1;
      side.finishesGolden += item.finishes.golden;
      side.finishesFound += item.finishes.found;
      side.rowsToReview += item.rowsToReview;
      side.rowsFlagged += item.rowsFlagged;
    }
  }
  return { verified, unverified };
}
