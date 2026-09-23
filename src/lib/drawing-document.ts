// Turning a shop-drawing page into attributes on the right records.
//
// Pure, and unit-tested against fixtures. Nothing here touches a database, and
// nothing here is stored — every function is called by BOTH the review screen
// and the confirm route, so the two can never disagree about what a card is
// allowed to do.
//
// ============================================================================
// WHY RESOLUTION HAPPENS AT REVIEW TIME, NOT IN THE WORKER
//
// The spec-document pipeline resolves inside the worker because a proposal
// needs a TARGET SNAPSHOT — the existing answer's id, version and value — to
// detect at confirm time that somebody edited it underneath the reviewer.
//
// A drawing observation has no such prior value: it INSERTS a new attribute
// row. The model's output therefore depends on no register at all, which has a
// consequence worth stating plainly: a drawing set can be extracted before its
// BOQ has been confirmed, and the raw output stays valid until it is. Anything
// else would mean either refusing to queue (and making the reviewer do the two
// steps in an order the post never arrives in) or re-extracting later, at the
// price of a second model call for identical output.
//
// ============================================================================
// WHY ONE CODE RESOLVES TO SEVERAL RECORDS ON PURPOSE
//
// `S-100` is in the mock-up run, the main run and the VE run, with different
// quantities. There is ONE drawing of it. Confirming its specs must reach all
// three records, so a code matching one record per run is a FAN-OUT, and the
// reviewer unticks a run where the spec genuinely differs.
//
// The same code matching TWO records in ONE run is the SX11A case and stays
// ambiguous: two lines of one bill with the same code are two different items,
// and picking one is a decision only a person can make. The two cases look
// identical to a matcher that ignores runs, which is why grouping by run is the
// whole of this function.
// ============================================================================
import { findRecordsByRef, normaliseRef, type RecordEntry } from "@/lib/record-refs";
import { containsPhrase, deferredToSomebody, TBC_TOKENS } from "@/lib/spec-vocab";
import { normaliseName } from "@/lib/matching";
// `finishes.ts` is a leaf here and imports nothing from this file.
import { normaliseFinishCode, type FinishFiling } from "@/lib/finishes";
import {
  DIMENSION_SLOT_LABELS,
  normaliseDimensionSlot,
  normaliseUnit,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { parseCombinedDimensions, parseDimensionFigure, sharesAScale, SCALE_BOUNDARY } from "@/lib/dimensions";
import type { RawCodeGroup, RawDrawingItem, RawViewRegion } from "@/lib/extraction-schema";
import { slotFromModel } from "@/lib/extraction-schema";
import { guessSlotsFromViews } from "@/lib/dimension-guess";
import { naturalConfigurationOrder, nextVariantLabel, normaliseVariantLabel, variantLabelProblem } from "@/lib/record-variants";

// ---- the staged shape ------------------------------------------------------

export type DrawingObservation = {
  /** Server-generated. A position is not an address: ignoring one renumbers the rest. */
  id: string;
  /** Per-observation, so two people editing two rows never conflict. */
  version: number;
  attrGroup: AttributeGroup;
  labelRaw: string | null;
  valueRaw: string | null;
  materialCodeRaw: string | null;
  /**
   * What the reviewer said to do with a finish the client gave NO code for
   * (4a.1). Absent on every run staged before this existed, and absent means
   * "nobody has been asked yet" — which is the state the card shows the *file
   * this as…* controls for. Never a decision this app took on its own:
   * `createFinish` is a register write and only a press sets this.
   *
   * OPTIONAL and it must stay optional, for the reason `unitSource` is: a
   * required key would mean rewriting every `schemaVersion: 1` row sitting in
   * `intake_runs.parsed`.
   */
  finishFiling?: FinishFiling | null;
  /** The reviewer's value. Starts as the drawing's own. */
  value: string | null;
  unit: AttributeUnit | null;
  unitSuggested: boolean;
  /**
   * WHERE that unit came from, so the screen can say something true about it.
   *
   * OPTIONAL, and it must stay optional. Runs staged before this existed are
   * `schemaVersion: 1` rows sitting in `intake_runs.parsed`, and a required key
   * would mean rewriting every one of them to add a field the reviewer can see
   * for themselves. Absent means "staged before provenance was tracked" — read
   * it through `unitSourceOf()`, never directly.
   */
  unitSource?: UnitSource;
  /**
   * Which of Matthew's five slots this figure fills, or null.
   *
   * OPTIONAL for the same reason `unitSource` is: `schemaVersion: 1` documents
   * are already sitting in `intake_runs.parsed` and must not need rewriting to
   * be read. Absent and null both mean "no slot yet"; the DB refuses to store a
   * dimension without one, so the gap is closed by a blocker, not by a guess.
   */
  dimensionSlot?: DimensionSlot | null;
  /**
   * True only when the slot was read from printed ORDER ("80 x 70 x 90 cm"),
   * never from a label. The screen badges it, exactly as it badges a guessed
   * unit, because an assumed W x D x H is the one inference here that the page
   * did not actually state.
   */
  slotSuggested?: boolean;
  /**
   * WHY this figure has that slot, in the page's own terms, as the model read
   * it — "labelled WIDTH on the specification table", "spans the whole chair on
   * the front elevation", "second of three in the printed line 80 x 70 x 90".
   *
   * It replaces a sentence this app used to compose about its own reasoning
   * ("the second largest — no view says so"), which told a reviewer what the
   * code did rather than what the drawing shows. A reviewer checks this against
   * the page; that is the whole job, and it cannot be done against a sort order.
   *
   * OPTIONAL, like every field below: `schemaVersion: 1` runs are already
   * sitting in `intake_runs.parsed` and must keep reading.
   */
  slotReason?: string | null;
  /**
   * Whether this figure measures the WHOLE item or a part of it, as the model
   * read it off the page.
   *
   * The card shows the overall figures and folds the parts away. This used to
   * be decided by "does it carry a slot, and is there a figure in the value" —
   * which put five blank `TBC` sub-dimension rows inline on the Panther S-201
   * card, between the four that matter and the fabrics, because a row with no
   * figure is not a measurement and so could never be folded.
   *
   * Absent means a `schemaVersion: 1` run that was never asked. Read it through
   * `isOverallRow()`, never directly.
   */
  isOverall?: boolean;
  /**
   * True when the GROUP and the BWS field were inferred rather than read.
   *
   * Set only by `classifyCallout`'s last-resort step — a caption naming the
   * item itself — never by a word the page actually printed. The card renders
   * such a row yellow with `groupReason` beside it, the same treatment a
   * guessed dimension slot gets, because "this is a guess, confirm it" and
   * "this cannot commit" must not look alike.
   *
   * OPTIONAL, like `unitSource` and `dimensionSlot`: runs staged before this
   * existed sit in `intake_runs.parsed` and must not need rewriting to read.
   */
  groupSuggested?: boolean;
  groupReason?: string | null;
  specFieldId: string | null;
  state: AttributeState | null;
  stateReason: string | null;
  reviewStatus: "pending" | "ignored" | "applied";
  reviewedAt: string | null;
  reviewedBy: string | null;
  /**
   * The rows this observation REPLACES, one per target record.
   *
   * A revised drawing gives a slot a record already holds. That is not an
   * error and it is not something to resolve automatically: the reviewer is
   * shown what is there, on which run, and ticks it — and the confirm then
   * retires that row and inserts the new one in its place.
   *
   * PER (observation, RECORD), and that is the load-bearing part. A card fans
   * out to one record per run, and the mock-up run's COM 1 may hold a
   * different old value from the main run's. An acknowledgement keyed on the
   * observation alone would let the confirm retire a value the reviewer never
   * saw on the VE record.
   *
   * `attributeVersion` is what the reviewer was looking at. If the occupant
   * has changed since, the confirm refuses rather than replacing something
   * else.
   *
   * OPTIONAL, like `unitSource` and `dimensionSlot`, so runs staged before
   * this existed keep reading.
   */
  replaces?: { recordId: string; attributeId: string; attributeVersion: number }[];
  /**
   * WHICH OF THE ITEM'S NAMED CONFIGURATIONS THIS ROW APPLIES TO, as the model
   * read it off the page, by the `name` the item's `configurations` gave them.
   * Empty or absent means shared — every configuration the page depicts.
   *
   * `schemaVersion: 3` only, and OPTIONAL for the reason every field above is.
   * Read it through `namedConfigurationPlan`, never directly: which records a
   * row lands on is one pure function, called by the card and the confirm.
   */
  configurations?: string[];
  /**
   * THE REVIEWER'S answer to which configurations this row applies to (brief
   * C1), by folded label. `[]` means shared by every configuration; absent or
   * null means the model's reading above stands. Kept BESIDE it, never over
   * it, so the card can say "read as TYPE 1 · TYPE 5, you set TYPE 1".
   */
  configurationsByReviewer?: string[] | null;
  /**
   * Why a person ignored this row, where the screen asked (plan any-bill,
   * step 4: "same as page 1", when two pages stated one fabric). Cleared on
   * restore. Absent on every row ignored without one.
   */
  ignoredReason?: string | null;
  /** One attribute row per target record, once applied. */
  applied: {
    attributeIds: string[];
    /**
     * The records where this row wrote NOTHING because the record already held
     * the same dimension — same slot, same figure in millimetres, same state —
     * from another page (`alreadyRecorded`). Its attribute id is in
     * `attributeIds` too. Absent on every row applied before 2026-09-23.
     */
    alreadyRecorded?: { recordId: string; attributeId: string; sourcePage: number | null }[];
  } | null;
};

/** One configuration a page NAMES (`schemaVersion: 3`), as the model read it. */
export type StagedConfiguration = {
  /** One configuration, in the page's own words as the model gave them: `MUR 1`, `Type 1`. */
  name: string;
  /** The page's own words: `Type 1 & 5`, `TYPO 5`. */
  nameRaw: string | null;
  evidence: string | null;
};

export type DrawingItem = {
  id: string;
  version: number;
  page: number | null;
  itemCodeRaw: string | null;
  itemNameRaw: string | null;
  confidence: "high" | "medium" | "low" | null;
  /**
   * The reviewer's decision about where this lands. Null until they touch it,
   * which is how a target that APPEARS later (a BOQ confirmed since the page
   * loaded) can be told apart from one they deliberately unticked.
   */
  targets: { ticked: string[]; unticked: string[] } | null;
  observations: DrawingObservation[];
  /**
   * Every picture of this item the model found, in the order it reported them.
   *
   * OPTIONAL, like `unitSource` and `dimensionSlot`, so `schemaVersion: 1`
   * documents already sitting in `intake_runs.parsed` keep reading. Absent
   * means the run was staged before pictures existed, which is a card where the
   * reviewer drags a box themselves -- not an error.
   */
  viewRegions?: ItemView[];
  /**
   * Which of them `pickItemView` chose, or null when it had nothing to choose
   * from. A SUGGESTION: the reviewer sees the actual crop rendered before
   * anything is saved, and can pick another view or drag their own box.
   */
  imageProposal?: ItemView | null;
  /**
   * The configurations of this item the PAGE NAMES — S-301's sheet lists five
   * room types under one fabric heading. `schemaVersion: 3` only; absent or
   * empty on every other page, which is most of them.
   */
  configurations?: StagedConfiguration[];
  /**
   * Which of them this page SHOWS, by name, where the page says so (a title
   * block `MUR 1 & TYPO 5`). Empty means the page does not restrict itself.
   */
  depictsConfigurations?: string[];
  /**
   * The reviewer's acknowledgement that confirming this page may CREATE a
   * named configuration under a bill line that already has others — one entry
   * per (bill record, folded name). See `newConfigurationBlockers`. Stored
   * because it is a decision; the blocker it answers is computed.
   */
  configurationAcks?: { recordId: string; label: string }[];
  /**
   * THE REVIEWER'S PAIRING (plan step 5): for a configuration this page names
   * that the bill line does not already hold under the page's own words, which
   * of the bill line's live configurations it IS (`pairWith`, folded) or null
   * for "create it as a new configuration". Per (bill record, folded label),
   * written to every page of the code that names it; the model's reading stays
   * beside it. `configurationAcks` (before step 5) reads as "create new".
   */
  configurationPairs?: { recordId: string; label: string; pairWith: string | string[] | null }[];
  /**
   * THE REVIEWER'S list of the CODE's configurations (brief C1), replacing the
   * model's reading for the whole code: each entry's folded `label`, and the
   * model label it stands for (`readAs`) — null for one the reviewer added.
   * A rename keeps `readAs`; a removal drops the entry. An EMPTY list is the
   * reviewer saying the code has none.
   *
   * Written to every page of the code and read from the first page, in page
   * order, that carries it (`reviewerOverride`). Absent or null: the model's
   * reading stands, which is every page nobody has touched.
   */
  configurationsByReviewer?: { label: string; readAs: string | null }[] | null;
  /**
   * The reviewer's answer to `codeGroups.relationship` for the code — the
   * manual version of it, for when the model said `one_item` and the pages are
   * two chairs, or the reverse. Same storage rule. Absent: the model's answer.
   */
  relationshipByReviewer?: "one_item" | "configurations" | null;
};

/** One picture of an item, and where it sits on its page. */
export type ItemView = {
  viewType: ViewType;
  page: number | null;
  /** [x0, y0, x1, y1] as fractions of the page, origin top-left. */
  bbox: [number, number, number, number];
};

/**
 * Whether the pages carrying one code are one item or several things to make,
 * as the MODEL read them — never as a page count.
 *
 * `relationship: "configurations"` is what allocates variant letters and, at
 * confirm, creates a `spec_records` row per letter — which takes the bill line
 * out of the export and ships each letter to BWS as its own job. It is
 * therefore the expensive answer to get wrong, and `unclear` exists so the
 * model can decline rather than guess.
 */
export type StagedCodeGroup = {
  /** Every code its pages title it with; the FIRST is the one the bill uses. */
  itemCodes: string[];
  pages: number[];
  relationship: "one_item" | "configurations" | "unclear";
  evidence: string | null;
};

export type StagedDrawings = {
  /**
   * 1 — the model reported figures and this app worked out which was the width,
   *     by sorting them. Read through the guessing pipeline, which is frozen.
   * 2 — the model reported which figure is which, whether it measures the whole
   *     item, and whether repeated pages are one item. Nothing guesses.
   *
   * 3 — as 2, and the model also reported the configurations a page NAMES
   *     ("as per room type: Type 1 & 5 - …, Type 2 - …") and which rows belong
   *     to which. Everything version 2 does, version 3 does identically.
   *
   * All three are read. An older run is not upgraded into a newer one:
   * inventing the fields it never carried would be one more inference layer,
   * which is the thing version 2 removes — and no string rule parses
   * `- Type 2` out of an old label. It is re-read, or it stays as it is.
   */
  schemaVersion: 1 | 2 | 3;
  kind: "shop_drawings";
  filename: string | null;
  documentNotes: string | null;
  items: DrawingItem[];
  /** Version 2 and later. Absent on every version 1 run. */
  codeGroups?: StagedCodeGroup[];
  /**
   * Where THIS document's configurations already landed, written by the
   * confirm: per (bill record, folded label), the variant it created or paired
   * with. So page 2 of a sheet whose page 1 created `TYPE 1` lands there with
   * no question — the document is not asked to pair with itself. Absent until
   * a named page is confirmed.
   */
  configurationLinks?: ConfigurationLink[];
};

export type ConfigurationLink = { recordId: string; label: string; variantId: string };

/**
 * Was this document read by a model asked which figure is which (version 2 and
 * later)? One test, because `=== 2` was written in five places and a version 3
 * run would otherwise have silently fallen back into the frozen guessing
 * pipeline.
 */
export function readByModel(doc: { schemaVersion?: unknown } | null | undefined): boolean {
  return doc?.schemaVersion === 2 || doc?.schemaVersion === 3;
}

/**
 * Does this figure measure the whole item?
 *
 * Version 1 runs carry no answer, and the honest fallback is "treat it the way
 * the old card did" — a placed slot is overall, anything else is not — rather
 * than folding a whole pack's dimensions out of sight or printing every reveal
 * inline.
 */
export function isOverallRow(observation: DrawingObservation): boolean {
  return observation.isOverall ?? Boolean(observation.dimensionSlot);
}

/**
 * A row the card folds: something the page measured that is not one of the
 * item's overall dimensions — a reveal, a radius, a rail, a gap, an arm height.
 *
 * VERSION 2 STATES IT. `isOverall === false` is the model saying so, and it is
 * set only on rows staged from a page's DIMENSIONS, so a fabric callout or a
 * paragraph of remarks has it `undefined` and is never caught here.
 *
 * VERSION 1 FALLS BACK to the old test: does the value state a figure. That
 * test is why the Panther S-201 card sprawled — its sheet prints a dimensions
 * table whose `WIDTH SEAT`, `DEPTH BACK` and `HEIGHT BACK` rows are all `TBC`,
 * so they state no figure, were not "measurements", could not be folded, and
 * printed inline between the four that matter and the fabrics.
 *
 * HERE RATHER THAN IN THE COMPONENT so the screen and anything measuring the
 * screen ask one function. `npm run measure:drawings` counts the sprawl, and a
 * count taken with its own copy of this rule would report a card getting better
 * while the card got worse.
 */
/**
 * Was this item read by a model that was asked which figure is which?
 *
 * Read off the ITEM rather than the document, because the two card components
 * are handed items and threading a schema version through both to answer one
 * question would be four props for a fact the rows already carry: `isOverall`
 * is set on every dimension row a version 2 read produced, and on none before.
 *
 * It exists because the card RE-RUNS `guessSlotsFromViews` at render time, for
 * the sentence beside a suggested slot and for the "key measurement dispute"
 * banner. On a version 2 item that banner said "the page labels none of its
 * figures with a view, so this is the three largest read as width, then depth,
 * then height" directly above rows reading "first of three in the printed line
 * '80 x 70 x 90 cm'" — the card contradicting itself, and the louder half being
 * the one that was no longer true.
 */
export function wasReadByModel(item: Pick<DrawingItem, "observations">): boolean {
  return item.observations.some((observation) => observation.isOverall !== undefined);
}

export function foldableRow(observation: DrawingObservation): boolean {
  if (observation.dimensionSlot) return false;
  return observation.isOverall === false || (observation.isOverall === undefined && isMeasuredRow(observation));
}

// ---- resolution ------------------------------------------------------------

export type RunResolution =
  | { runId: string; runName: string; status: "matched"; record: RecordEntry }
  | { runId: string; runName: string; status: "ambiguous"; candidates: RecordEntry[] };

export type DrawingResolution = {
  runs: RunResolution[];
  /** Every record a confirm would write to if the reviewer changed nothing. */
  suggested: string[];
};

/**
 * Which records this drawing's item code names, grouped by run.
 *
 * Matching is against `boq_code` refs only, through the same two-pass
 * (exact, then normalised) `findRecordsByRef` the spec-document resolver uses —
 * a third normaliser would eventually disagree with the other two about
 * `FU06C - CG27.2`.
 */
export function resolveDrawingTargets(itemCodeRaw: string | null, records: RecordEntry[]): DrawingResolution {
  const byBoqCode = records.map((record) => ({ ...record, refs: record.boqCodes }));
  const matches = findRecordsByRef(itemCodeRaw, byBoqCode);

  const byRun = new Map<string, RecordEntry[]>();
  for (const match of matches) {
    // findRecordsByRef returned the projected copy; take the original back so
    // callers see the record's real refs.
    const original = records.find((record) => record.id === match.id);
    if (!original) continue;
    const list = byRun.get(original.runId) ?? [];
    list.push(original);
    byRun.set(original.runId, list);
  }

  const runs: RunResolution[] = [];
  for (const [runId, found] of byRun) {
    const runName = found[0]?.runName ?? "";
    if (found.length === 1 && found[0]) {
      runs.push({ runId, runName, status: "matched", record: found[0] });
    } else {
      runs.push({ runId, runName, status: "ambiguous", candidates: found });
    }
  }
  runs.sort((a, b) => a.runName.localeCompare(b.runName));

  return {
    runs,
    suggested: runs.flatMap((run) => (run.status === "matched" ? [run.record.id] : [])),
  };
}

/** The records a confirm would write to, given what the reviewer decided. */
export function targetRecordIds(item: DrawingItem, resolution: DrawingResolution): string[] {
  if (!item.targets) return resolution.suggested;
  const unticked = new Set(item.targets.unticked);
  return item.targets.ticked.filter((id) => !unticked.has(id));
}

// ---- unit suggestion -------------------------------------------------------

export type UnitSuggestion = { status: "confident"; unit: AttributeUnit } | { status: "ambiguous" | "none" };

/**
 * Guesses the unit of a page's dimensions from the size of its figures — and
 * refuses to guess whenever the figures do not agree.
 *
 * Furniture is roughly 300–2500mm, i.e. 30–250cm. A page whose figures are all
 * under 300 is almost certainly centimetres (190 x 79 x 72: a sofa); one whose
 * figures are all 300 or over is almost certainly millimetres (550 x 735: a
 * desk chair). A page carrying both sits in neither range, and gets nothing:
 * a wrong unit reads as a real measurement and nothing downstream questions it,
 * whereas a blank one stops the card.
 *
 * IT COUNTS ONLY VALUES THAT ARE ONE FIGURE, through the same parser the
 * composer uses. Stripping every non-digit instead read "80 x 70 x 90" as
 * 807090 — one value, far over the threshold, enough to carry the whole page's
 * vote to millimetres and record an 80cm armchair as 8 metres. Nothing was
 * reachable that way until a combined line could be staged; it is now, and a
 * silent 10x is not a thing to leave one feature away.
 */
export function suggestUnit(values: (string | null)[]): UnitSuggestion {
  const numbers = values.map(figureOf).filter((n): n is number => n !== null);
  if (numbers.length === 0) return { status: "none" };

  // The boundary lives in dimensions.ts because `guessSlotsFromViews` asks the
  // same question of a candidate set of overall figures. See `SCALE_BOUNDARY`.
  if (!sharesAScale(numbers)) return { status: "ambiguous" };
  return { status: "confident", unit: numbers[0]! < SCALE_BOUNDARY ? "cm" : "mm" };
}

// ---- a unit the page actually printed --------------------------------------

/**
 * Where a staged unit came from. The three are not interchangeable and the
 * screen must not call all of them "guessed":
 *
 *   printed         the page stated it. Not a guess at all.
 *   figures         `suggestUnit` inferred it from the magnitudes on the page.
 *   project_default the project said what its drawings are drawn in, and this
 *                   page offered nothing to go on.
 */
export const UNIT_SOURCES = ["printed", "figures", "project_default"] as const;
export type UnitSource = (typeof UNIT_SOURCES)[number];

/** The numeric part of a drawn figure, or null if there isn't one. */
function figureOf(raw: string | null): number | null {
  return parseDimensionFigure(raw).figure;
}

export type SplitFigure = { value: string | null; unit: AttributeUnit | null };

/**
 * Separates "1800mm" into "1800" and `mm`.
 *
 * The model is asked to keep the figure and the unit apart, and on the Panther
 * specification sheets it can, because the page prints them apart. This exists
 * for when it does not — a sheet whose text layer runs them together, or a
 * model that helpfully combined them.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS: `bws-export.ts` appends the unit to the
 * value with no separator, so a value of "1800" with unit `mm` renders "1800mm"
 * and a value of "1800mm" with unit `mm` renders "1800mmmm". A trailing unit
 * left on the value is not cosmetic; it reaches BWS.
 *
 * Conservative on purpose. It only splits a value that is ENTIRELY a number
 * followed by a recognised unit. "190 x 79 x 72" keeps its wording, and so does
 * "1800mm nominal" — anything with more in it is a sentence a human should read,
 * not a figure this function should take apart.
 */
export function splitFigureAndUnit(valueRaw: string | null): SplitFigure {
  const text = (valueRaw ?? "").trim();
  if (text === "") return { value: valueRaw, unit: null };

  const match = /^([0-9]+(?:[.,][0-9]+)?)\s*([a-zA-Z"']+\.?)$/.exec(text);
  if (!match) return { value: valueRaw, unit: null };

  const unit = normaliseUnit(match[2]);
  // An unrecognised suffix is not a unit we know: "1800off" keeps its wording
  // rather than being silently truncated to "1800".
  if (!unit) return { value: valueRaw, unit: null };

  return { value: match[1] ?? valueRaw, unit };
}

export type ResolvedUnit = { unit: AttributeUnit | null; source: UnitSource | null };

/**
 * Which unit a staged dimension gets, and why. The order is the whole point.
 *
 *   1. PRINTED on the page, whether the model reported it in `unitRaw` or left
 *      it stuck to the figure. A document that states its unit has answered the
 *      question and nothing downstream should second-guess it.
 *   2. The page's own FIGURES agreeing (`suggestUnit`). Evidence from this
 *      page beats a setting about the project: a project is not more
 *      authoritative about a page than the page is.
 *   3. The PROJECT DEFAULT. Reached only when the page states nothing and its
 *      figures do not agree — which, before this existed, was the case that
 *      blocked every dimension on the card and made a reviewer answer the same
 *      question a few hundred times.
 *   4. Nothing, and `unit_missing` still blocks. A project that has not set a
 *      default behaves exactly as it did before.
 */
export function resolveDimensionUnit(input: {
  printed: AttributeUnit | null;
  pageGuess: UnitSuggestion;
  projectDefault: AttributeUnit | null;
}): ResolvedUnit {
  if (input.printed) return { unit: input.printed, source: "printed" };
  if (input.pageGuess.status === "confident") return { unit: input.pageGuess.unit, source: "figures" };
  if (input.projectDefault) return { unit: input.projectDefault, source: "project_default" };
  return { unit: null, source: null };
}

/**
 * The provenance of an already-staged unit, tolerating rows written before
 * `unitSource` existed and rows a human has since edited.
 */
export function unitSourceOf(observation: Pick<DrawingObservation, "unit" | "unitSuggested" | "unitSource">): UnitSource | null {
  if (observation.unit === null) return null;
  if (observation.unitSource) return observation.unitSource;
  // Older staged rows carry only the boolean. `true` meant exactly one thing
  // then: suggestUnit was confident. `false` with a unit present means a human
  // chose it, which has no source and needs no badge.
  return observation.unitSuggested ? "figures" : null;
}

// ---- does this measurement describe real furniture? ------------------------

/** Multipliers to millimetres. `normaliseUnit` guarantees the key exists. */
const TO_MM: Record<AttributeUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

// A drawer pull is about 64mm and a long banquette is about 3.5m. Outside
// 20mm-4000mm we are no longer looking at a piece of furniture or a part of
// one, we are looking at a unit that is wrong by a factor of ten.
const MIN_PLAUSIBLE_MM = 20;
const MAX_PLAUSIBLE_MM = 4000;

/**
 * A sentence to show beside a dimension whose size does not describe furniture,
 * or null.
 *
 * THIS IS A WARNING, NOT A BLOCKER, and the distinction is deliberate. The
 * project default exists so a reviewer stops being asked about every dimension;
 * turning its output into a blocker would ask them about every dimension again.
 * So the card still commits, and this marks the handful worth a second look.
 *
 * WHAT IT CATCHES: a 10x unit error, always — that is the error the project
 * default risks, and it always moves a real object out of this range.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it further than it goes:
 * a cm/inch confusion (2.54x, usually still in range), and a genuinely small
 * component whose figure is correct. It is a smoke alarm, not a proof.
 */
export function implausibleDimension(value: string | null, unit: AttributeUnit | null): string | null {
  if (!unit) return null;
  const figure = figureOf(value);
  // A value that is not a single figure ("190 x 79 x 72", "TBC") is not
  // something this check can reason about, and guessing at it would produce
  // warnings nobody can act on.
  if (figure === null) return null;

  const mm = figure * TO_MM[unit];
  if (mm >= MIN_PLAUSIBLE_MM && mm <= MAX_PLAUSIBLE_MM) return null;

  const asMetres = mm / 1000;
  const rendered = asMetres >= 1 ? `${round(asMetres)}m` : `${round(mm)}mm`;
  return `${value}${unit} is ${rendered} — check the unit on this one.`;
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// ---- state suggestion ------------------------------------------------------

export type AttributeStateSuggestion = {
  state: AttributeState | null;
  value: string | null;
  reason: string | null;
};

/** What `splitTbcMarker` read: the value with the marker taken off, and whether it found one. */
export type TbcSplit = { value: string | null; tbc: boolean; reason: string | null };

/**
 * The punctuation a page puts BETWEEN a marker and the thing it marks.
 *
 * Exactly the four the plan names, and no more. A separator this list does not
 * carry (an em dash, a comma) simply does not fire, and the value falls through
 * to the reviewer question it gets today — a flag, never a wrong answer. Adding
 * one is a deliberate edit, because every character here decides where somebody
 * else's wording is allowed to be cut.
 */
const TBC_SEPARATORS = ["-", "–", ":", "/"];

/**
 * A COLON BINDS A LEADING MARKER ONLY, and that asymmetry is a defect this
 * caught rather than a preference.
 *
 * A colon is this app's own LABEL separator — `splitNotePrefix` reads it that
 * way, because the Panther sheets stamp every line of their general conditions
 * with its field. So in `A: B`, B is the value: `TBC: Yarn Collective` puts the
 * marker in the label position and the fabric in the value, and
 * `SUPPLIER: TO BID` puts the FIELD in the label position and the marker in the
 * value. Treating the second as a trailing marker keeps `SUPPLIER` — a heading
 * with its value thrown away — where the right reading is the one already in
 * the file: a note whose whole value is the marker.
 */
const TBC_SEPARATORS_TRAILING = TBC_SEPARATORS.filter((separator) => separator !== ":");

const BRACKET_PAIRS: [string, string][] = [
  ["(", ")"],
  ["[", "]"],
];

const TBC_MARKER_REASON =
  "The drawing writes TBC beside this value. The marker is recorded as the state; the value is what the drawing said beside it.";

function isTbcToken(raw: string): boolean {
  return TBC_TOKENS.includes(normaliseName(raw));
}

function firstSeparator(text: string): number {
  let found = -1;
  for (const separator of TBC_SEPARATORS) {
    const index = text.indexOf(separator);
    if (index !== -1 && (found === -1 || index < found)) found = index;
  }
  return found;
}

function lastSeparator(text: string): number {
  let found = -1;
  for (const separator of TBC_SEPARATORS_TRAILING) {
    const index = text.lastIndexOf(separator);
    if (index > found) found = index;
  }
  return found;
}

/** `TBC – Yarn Collective` and `(TBC) Yarn Collective` → the remainder, or null if nothing was taken. */
function stripLeadingMarker(value: string): string | null {
  for (const [open, close] of BRACKET_PAIRS) {
    if (!value.startsWith(open)) continue;
    const end = value.indexOf(close);
    if (end === -1) continue;
    if (!isTbcToken(value.slice(1, end))) continue;
    const rest = value.slice(end + 1).trim();
    // "(TBC) - Oak" as well as "(TBC) Oak": the bracket already delimits the
    // marker, so a separator after it is punctuation rather than structure.
    const separator = firstSeparator(rest);
    return separator === 0 ? rest.slice(1).trim() : rest;
  }
  // THE FIRST SEPARATOR ONLY. `TBC - Yarn Collective Tessarae YC04158 - 01`
  // keeps its inner " - 01", because that hyphen is part of the fabric's own
  // reference and the page wrote it.
  const index = firstSeparator(value);
  if (index === -1) return null;
  if (!isTbcToken(value.slice(0, index))) return null;
  return value.slice(index + 1).trim();
}

/** `Yarn Collective – TBC` and `Yarn Collective (TBC)` → what is left, or null. */
function stripTrailingMarker(value: string): string | null {
  for (const [open, close] of BRACKET_PAIRS) {
    if (!value.endsWith(close)) continue;
    const start = value.lastIndexOf(open);
    if (start === -1) continue;
    if (!isTbcToken(value.slice(start + 1, value.length - 1))) continue;
    // A separator abutting the bracket is punctuation, not structure: the
    // bracket already delimited the marker. The full set applies here, colon
    // included, because nothing is being decided by it.
    const head = value.slice(0, start).trim();
    return TBC_SEPARATORS.includes(head.slice(-1)) ? head.slice(0, -1).trim() : head;
  }
  const index = lastSeparator(value);
  if (index === -1) return null;
  if (!isTbcToken(value.slice(index + 1))) return null;
  return value.slice(0, index).trim();
}

/**
 * THE MARKER IS A STATE; THE FABRIC IS THE VALUE.
 *
 * The Panther S-100 sheet prints `TBC – Yarn Collective Tessarae YC04158 - 01`,
 * and both halves landed in the value: the record then read the word TBC inside
 * the name of a fabric, and the export appended a second one. Matthew, on
 * seeing it: *"it shouldn't really be in the name."*
 *
 * So a marker at an EDGE, bound by a separator or by its own brackets, is taken
 * off and returned as `tbc`. Three rules, and each is the trap rather than a
 * preference:
 *
 *   * LEADING OR TRAILING ONLY. `Yarn TBC Collective` is not a marker beside a
 *     value, and stripping it produces `Yarn Collective` — a fabric that reads
 *     as real, is not, and nothing downstream would question. It is left whole
 *     and `suggestAttributeState` goes on asking the reviewer which it is.
 *   * SEPARATOR-BOUND ONLY. `TBC by DLA Projects` is a real BWS Routing value,
 *     and `by` is not a separator; `Dark tinted wood TBC` states a value AND
 *     says it is not settled, which is the existing reviewer question and stays
 *     one. A bare space is not enough to say the page meant two things.
 *   * THE WHOLE VALUE BEING THE TOKEN IS NOT A SPLIT. `TBC` alone has no
 *     remainder, so `value` comes back null and the caller decides what to keep
 *     — `suggestAttributeState` keeps the page's own word, as it always has.
 *
 * Pure, and read by both halves of the pipeline: staging, so a fresh read
 * stages the state and the clean value, and `upgradeTbcMarkers` at read time,
 * so a pack already read gains it with no second model call. `valueRaw` is
 * never touched, and the review card already prints "drawing said: …" beneath
 * any value that differs from it, so the page's exact wording stays on screen.
 */
export function splitTbcMarker(valueRaw: string | null): TbcSplit {
  const value = (valueRaw ?? "").trim();
  if (value === "") return { value: null, tbc: false, reason: null };
  if (isTbcToken(value)) return { value: null, tbc: true, reason: null };

  const leading = stripLeadingMarker(value);
  const afterLeading = leading ?? value;
  const trailing = stripTrailingMarker(afterLeading);
  if (leading === null && trailing === null) return { value, tbc: false, reason: null };

  const remainder = (trailing ?? afterLeading).trim();
  if (remainder === "" || isTbcToken(remainder)) return { value: null, tbc: true, reason: TBC_MARKER_REASON };
  return { value: remainder, tbc: true, reason: TBC_MARKER_REASON };
}

/**
 * Two states only. An attribute exists because the drawing said something, so
 * `missing` cannot arise; `na` is a cheat-sheet answer this table has no
 * question for.
 *
 * "PIPING  TBC" is a real observation — the client has not chosen — and must
 * reach the export as TBC rather than as a blank cell nobody notices.
 */
export function suggestAttributeState(valueRaw: string | null): AttributeStateSuggestion {
  const value = (valueRaw ?? "").trim();
  if (value === "") {
    return { state: "tbc", value: null, reason: "The drawing labels this but gives no value." };
  }

  const norm = normaliseName(value);
  // THE WHOLE VALUE IS THE MARKER, and the page's own word is kept as the
  // value — "PIPING  TBC", "SUPPLIER  TO BID". `splitTbcMarker` would return a
  // null remainder here, which is the same reading said a different way; this
  // branch stays first so the value a reviewer sees is unchanged by the split.
  if (TBC_TOKENS.includes(norm)) return { state: "tbc", value, reason: null };

  // A MARKER AT AN EDGE IS DECIDED, NOT ASKED. `TBC – Yarn Collective Tessarae`
  // is one statement in two parts, and the separator is the page saying so, so
  // the state takes the marker and the value keeps the fabric. Called FIRST of
  // the two TBC branches, because the branch below reads a token ANYWHERE and
  // would otherwise ask the reviewer a question the separator already answers.
  const split = splitTbcMarker(value);
  if (split.tbc) return { state: "tbc", value: split.value, reason: split.reason };

  // "Dark tinted wood TBC" states a value AND says it is not settled. Neither
  // this code nor the model decides which one won. A bare space is deliberately
  // NOT a separator above: this is the reading that would be destroyed.
  //
  // `containsPhrase`, not a word-set test: the multi-word tokens ("to be
  // confirmed") could never match a single-word lookup, so "Oak, finish to be
  // confirmed" was silently reading as a settled value.
  if (TBC_TOKENS.some((token) => containsPhrase(norm, token))) {
    return {
      state: null,
      value,
      reason: "The drawing gives a value and also marks it TBC. Choose which this is.",
    };
  }

  // "Argenta to confirm" names who decides, which is content worth keeping —
  // so it is neither collapsed to TBC nor taken as a settled value. The
  // reviewer is asked, and both readings survive until they answer.
  if (deferredToSomebody(norm)) {
    return {
      state: null,
      value,
      reason: "The drawing says somebody else will confirm this. Record it as TBC, or give the value if you have it.",
    };
  }

  return { state: "confirmed", value, reason: null };
}

// ---- BWS field slots -------------------------------------------------------

/**
 * The BWS fields a drawing callout can claim, in the order they are filled.
 *
 * The COM slot IS the field: the first fabric on a page is COM 1, the second is
 * COM 2. Held as json ids because `spec_fields.column_letter` is positional and
 * shifts if BWS ever inserts a column, while the ids do not.
 */
export const FABRIC_SLOTS = [1, 2, 14] as const; // COM 1, COM 2, COM 3
export const TIMBER_SLOTS = [4, 31, 143] as const; // Main timber finish, Timber Finish 2, 3
export const METAL_SLOTS = [5, 35] as const; // Main metal finish, Metal Finish 2

// The words a drawing uses for each kind of callout.
//
// THE WORD LISTS AND THE CODE PREFIXES NOW LIVE IN `material-words.ts`, moved
// there unedited on 2026-09-18 so the finishes library can read the same
// vocabulary (`suggestFinishKind`). Two copies of these lists is how the
// drawings path and the library start disagreeing about whether `WD-05` is a
// timber — the `composeDimensionCell` rule, applied to a word list.
//
// The names carry `_CALLOUT_` because the library reads a WIDER set: a library
// row has a full description to read and finer kinds to choose between
// (leather apart from fabric, stone, glass, paint). What this file matches on
// is unchanged, which is what keeps a pack already read classifying exactly as
// it did — `upgradeCalloutGuesses` runs at READ time, so a widened list here
// would silently re-classify rows on every existing document.
import {
  CODE_PREFIXES,
  FABRIC_CALLOUT_WORDS,
  HARDWARE_WORDS,
  METAL_WORDS,
  TIMBER_CALLOUT_WORDS,
} from "@/lib/material-words";

/** Re-exported from its old home, so no caller of this module changed. */
export { METAL_WORDS };

const FABRIC_WORDS = FABRIC_CALLOUT_WORDS;
const TIMBER_WORDS = TIMBER_CALLOUT_WORDS;

export type SpecFieldEntry = { id: string; jsonId: number; name: string };

/**
 * The BWS register as the classifier wants it, from a `spec_fields` query.
 *
 * One mapper, because four call sites now read the register to hand it to
 * `assertStagedDrawings` — the review screen, its autosave, the pack screen
 * and the confirm — and a field the confirm resolved differently from the
 * screen is a cell the file would not deliver.
 */
export function specFieldEntries(rows: readonly Record<string, unknown>[]): SpecFieldEntry[] {
  return rows.map((row) => ({
    id: String(row.id),
    jsonId: Number(row.json_id),
    name: String(row.name ?? ""),
  }));
}

function mentions(text: string, words: readonly string[]): boolean {
  const parts = normaliseName(text).split(" ");
  return words.some((word) => parts.includes(word));
}

/** What a material callout turns out to be. Null means the page did not say. */
export type CalloutKind = "fabric" | "timber" | "metal" | "hardware" | null;

export type CalloutReading = {
  kind: CalloutKind;
  group: AttributeGroup;
  /** True only for the last-resort reading, which the card badges. */
  guessed: boolean;
  /** Why, in the reviewer's words. Null when nothing was decided. */
  reason: string | null;
};

/**
 * WHAT A MATERIAL CALLOUT IS — the single reading behind both the group and
 * the BWS field.
 *
 * Evidence runs in a fixed order and stops at the first thing that decides,
 * exactly as the unit rule does:
 *
 *   1. THE WORDS. A callout that names a cloth, a timber, a metal or a piece
 *      of hardware is that thing. Certain, and the common case.
 *   2. THE CLIENT'S OWN CODE. `UPH-07` is the page saying "upholstery" in its
 *      own vocabulary. Certain for the prefixes we have actually seen; `CH` is
 *      not one of them and is not guessed at.
 *   3. THE CAPTION NAMES THE ITEM ITSELF. `SOFA / Tessarae YC04158` pairs the
 *      piece with a specification and names no timber, metal or hardware — a
 *      swatch caption for its upholstery. This is the only step that infers
 *      anything, so it is flagged: the card renders it yellow with this
 *      reason beside it, like a guessed dimension slot.
 *
 * Nothing here reads a brand name or a product code as evidence of a material.
 * "Tessarae" is a fabric because of where it is printed, not because this app
 * has heard of it, and a list of mill names would be wrong within a month.
 */
export function classifyCallout(input: {
  labelRaw: string | null;
  valueRaw: string | null;
  materialCodeRaw?: string | null;
  itemNameRaw?: string | null;
}): CalloutReading {
  const label = input.labelRaw ?? "";
  const value = input.valueRaw ?? "";
  const text = `${label} ${value}`;

  // 1. The words. Fabric first, then metal, then timber -- the order
  //    `suggestSpecField` has always used, so a "metal frame" is metal rather
  //    than timber on the strength of "frame".
  if (mentions(text, FABRIC_WORDS)) return reading("fabric", false, null);
  if (mentions(text, METAL_WORDS)) return reading("metal", false, null);
  if (mentions(text, TIMBER_WORDS)) return reading("timber", false, null);
  if (mentions(text, HARDWARE_WORDS)) return reading("hardware", false, null);

  // 2. The client's own finish code, normalised to its letters.
  const code = normaliseName(input.materialCodeRaw ?? "").replace(/[^a-z]/g, "");
  if (code) {
    const match = CODE_PREFIXES.find((entry) => code.startsWith(entry.prefix));
    if (match) {
      return reading(match.kind, false, `the code ${String(input.materialCodeRaw).trim()} says so`);
    }
  }

  // 3. The caption names the item itself, and carries a specification.
  if (namesTheItem(label, input.itemNameRaw ?? null) && hasSubstance(value)) {
    return reading(
      "fabric",
      true,
      "the caption pairs the item itself with a material, and names no timber, metal or hardware",
    );
  }

  return { kind: null, group: "other", guessed: false, reason: null };
}

function reading(kind: Exclude<CalloutKind, null>, guessed: boolean, reason: string | null): CalloutReading {
  const group: AttributeGroup =
    kind === "fabric" ? "material" : kind === "hardware" ? "hardware" : "finish";
  return { kind, group, guessed, reason };
}

/**
 * Does this label name the item the page is about, rather than a part of it?
 *
 * Every word of the label has to appear in the item's own name, so `SOFA` on a
 * sofa page qualifies and `SOFA FEET` does not -- which is the whole point: a
 * caption naming a PART is about that part, and only a caption naming the
 * WHOLE piece is about its upholstery.
 */
function namesTheItem(labelRaw: string, itemNameRaw: string | null): boolean {
  const label = normaliseName(labelRaw).split(" ").filter(Boolean);
  const name = new Set(normaliseName(itemNameRaw ?? "").split(" ").filter(Boolean));
  if (label.length === 0 || name.size === 0) return false;
  return label.every((word) => name.has(word));
}

/**
 * Does the value say anything, once a TBC marker is set aside?
 *
 * `PIPING / TBC` is a question, not a fabric, and staging has always left it
 * alone. `TBC - Yarn Collective Tessarae` is a fabric nobody has confirmed,
 * which is a different thing and keeps its reading.
 */
function hasSubstance(valueRaw: string): boolean {
  let text = normaliseName(valueRaw);
  for (const token of TBC_TOKENS) text = text.split(token).join(" ");
  return text.split(" ").filter(Boolean).length >= 2;
}

/**
 * Which BWS field an observation should fill, given the ones already taken on
 * the same record.
 *
 * Deterministic and deliberately narrow: it only claims a slot for a callout
 * that plainly names a fabric, a timber or a metal. Anything else gets no
 * field, which is not a failure — the observation is still recorded against the
 * item, and a reviewer can place it. A confidently wrong field is what this
 * refuses to produce, because a fabric written into `Main timber finish`
 * reaches BWS looking exactly like a real answer.
 */
export function suggestSpecField(
  observation: {
    attrGroup: AttributeGroup;
    labelRaw: string | null;
    valueRaw: string | null;
    materialCodeRaw?: string | null;
    itemNameRaw?: string | null;
  },
  fields: SpecFieldEntry[],
  taken: Set<string>,
): string | null {
  if (observation.attrGroup === "dimension") return null; // many compose into Dimensions
  // ONE reading, two callers. The group and the field were derived
  // independently from the same word lists, which is how `SOFA / Yarn
  // Tessarae` managed to lose both at once — and how a widened list could
  // have fixed one and left the other. Same discipline as
  // `composeDimensionCell` being the only composer.
  const kind = classifyCallout(observation).kind;
  const slots =
    kind === "fabric" ? FABRIC_SLOTS : kind === "metal" ? METAL_SLOTS : kind === "timber" ? TIMBER_SLOTS : null;
  if (!slots) return null;

  for (const jsonId of slots) {
    const field = fields.find((entry) => entry.jsonId === jsonId);
    if (field && !taken.has(field.id)) return field.id;
  }
  // Every slot of that kind is full. No field rather than an unrelated one.
  return null;
}

// ---- blockers --------------------------------------------------------------

export type DrawingBlocker =
  | { code: "no_targets"; message: string }
  | { code: "ambiguous_run"; message: string; runId: string }
  | { code: "unit_missing"; message: string; observationId: string }
  | { code: "no_state"; message: string; observationId: string }
  | { code: "empty_value"; message: string; observationId: string }
  | { code: "slot_taken"; message: string; observationId: string; recordId?: string }
  | { code: "dimension_slot_missing"; message: string; observationId: string }
  | { code: "dimension_slot_taken"; message: string; observationId: string; recordId?: string }
  | { code: "dia_conflict"; message: string; observationId: string }
  | { code: "configuration_name"; message: string; label: string; observationId?: undefined }
  | { code: "configuration_undecided"; message: string; observationId: string }
  | { code: "configuration_pair_twice"; message: string; recordId: string; label: string; observationId?: undefined }
  | { code: "field_conflict"; message: string; observationId: string; pairKey: string; clash: FieldClash }
  | {
      code: "configuration_new";
      message: string;
      /** The bill line the configuration would be created under. */
      recordId: string;
      label: string;
      /** The live configurations that bill line already has. */
      existing: string[];
      /** The page's own words for it. */
      namesRaw: string[];
      /** A live configuration already has this label: pairing is the only way on without a rename. */
      collides: boolean;
      observationId?: undefined;
    };

/**
 * What the target records already carry, read live.
 *
 * Both halves travel together so a caller cannot supply one and forget the
 * other: the BWS field slots (COM 1, Timber Finish 2 …) and the five dimension
 * slots. They are separate maps because they are separate uniqueness rules in
 * 0007 and 0011, and a field and a dimension never contend for the same space.
 */
/** What a target record already holds, by the two uniqueness rules. */
export type OccupiedSlot = {
  attributeId: string;
  attributeVersion: number;
  label: string;
  value: string | null;
  unit: string | null;
  /** The occupant's state, for `alreadyRecorded`. Optional: absent means unknown, which is never "the same". */
  state?: string | null;
  /** The client's own material code on the occupant, for `alreadyRecorded`. */
  materialCode?: string | null;
  sourceFilename: string | null;
  sourcePage: number | null;
};

export type OccupiedSlots = {
  fields: Map<string, Map<string, OccupiedSlot>>;
  dimensions: Map<string, Map<DimensionSlot, OccupiedSlot>>;
};

/**
 * IS THIS DIMENSION ALREADY ON THE RECORD — the same slot, the same figure, the
 * same state? Then it is not a replacement, and there is nothing to write.
 *
 * S-301's specification sheet and its shop drawing both state the chair's W, D
 * and H. Confirming the sheet writes them to TYPE 1; confirming the drawing
 * then found an occupant in each slot and asked the reviewer to tick "replace"
 * three times, to replace 550mm with 550mm — a question with no decision in it,
 * which teaches people to tick without reading.
 *
 * COMPARED AS MILLIMETRES, THROUGH THE ONE PARSER, NEVER AS STRINGS: 55 cm and
 * 550 mm are the same width, and `550` against `550.0` is not a disagreement.
 * A figure with no unit on either side is never the same — the unit is what
 * makes it a measurement. The STATE must match too: a confirmed 550 over a TBC
 * 550 is a decision being taken, and the reviewer is asked.
 *
 * A FINISH is the same finish by its code, or by the same words in any order
 * (`sameFinish`). A fabric described in DIFFERENT words is the reviewer's
 * decision about which wording to keep, and stays a blocker.
 *
 * ONE FUNCTION, TWO CALLERS: `drawingItemBlockers` (no blocker) and the confirm
 * (write nothing, mark the row applied naming the existing attribute), so the
 * screen and the confirm cannot disagree — the `proposalBlockers` rule.
 */
export function alreadyRecorded(
  observation: Pick<DrawingObservation, "attrGroup" | "dimensionSlot" | "value" | "valueRaw" | "unit" | "state"> &
    Partial<Pick<DrawingObservation, "specFieldId" | "materialCodeRaw">>,
  occupant: (Pick<OccupiedSlot, "value" | "unit" | "state"> & Partial<Pick<OccupiedSlot, "materialCode">>) | undefined,
): boolean {
  if (!occupant) return false;
  // A FINISH is the same finish by the client's own CODE — WD-01 and WD-01 —
  // or by the SAME WORDS in any order (`sameFinishWords`), and never by words
  // that merely overlap: "Dark tinted wood" and "feet dark tinted wood as per
  // approved sample" may well be one timber, and deciding that is the
  // reviewer's. Same field and same finish: already recorded.
  if (observation.attrGroup !== "dimension") {
    if (!observation.specFieldId) return false;
    return sameFinish(
      { code: observation.materialCodeRaw, words: observation.value ?? observation.valueRaw },
      { code: occupant.materialCode, words: occupant.value },
    );
  }
  if (!observation.dimensionSlot) return false;
  const mine = inMillimetres(observation.value ?? observation.valueRaw, observation.unit);
  const theirs = inMillimetres(occupant.value, occupant.unit);
  if (mine === null || theirs === null) return false;
  if (Math.abs(mine - theirs) > 1e-6) return false;
  return (occupant.state ?? null) !== null && occupant.state === stateToWrite(observation as DrawingObservation);
}

function inMillimetres(value: string | null, unit: string | null): number | null {
  const normalised = normaliseUnit(unit);
  if (!normalised) return null;
  const figure = parseDimensionFigure(value).figure;
  return figure === null ? null : figure * TO_MM[normalised];
}

/**
 * Which occupants an observation is acknowledged to replace, as a lookup.
 *
 * Keyed by record, because the acknowledgement is per (observation, record):
 * ticking "replace the width on MAIN RUN" says nothing about the width on the
 * VE run, and must not.
 */
export function acknowledgedReplacements(observation: DrawingObservation): Map<string, { attributeId: string; attributeVersion: number }> {
  const out = new Map<string, { attributeId: string; attributeVersion: number }>();
  for (const entry of observation.replaces ?? []) {
    out.set(entry.recordId, { attributeId: entry.attributeId, attributeVersion: entry.attributeVersion });
  }
  return out;
}

/**
 * Whether Stated-or-TBC is a question this row can be asked.
 *
 * ============================================================================
 * THE TEST IS WHAT THE ROW REACHES, NOT THE WORD "NOTE".
 *
 * A state is read where it composes into something: `renderAttributeValue`
 * puts a TBC marker into the exported cell of a row carrying a BWS field, and
 * `composeDimensionCell` and `planAnswerFills` read the state behind a
 * dimension slot. A row that carries NEITHER composes into nothing, so its
 * state is written, never read, and asking for it is a question with no
 * consequence. Max on the S-203 card, 2026-09-22: "we don't need a state on
 * the notes, and special manufacturing instructions, and other things that
 * probably don't require it."
 *
 * It bites hardest on a merged block, because `mergeNoteBlocks` takes the most
 * cautious state of the lines it joins — ONE unruled line leaves a fifteen-line
 * general-conditions block unruled, and the card cannot confirm.
 *
 * This is the argument `unit_missing` has carried since the note-block merge —
 * "a note is never ASKED for one … an empty select beside fifteen of them reads
 * as fifteen unanswered questions where there are none" — applied to the other
 * column, where it was always equally true.
 *
 * TWO CLAUSES, AND ONLY TWO. `isMergeableNote` tests five; its other three are
 * about MERGING and mean nothing here. `labelRaw === "Note"` is there for merge
 * idempotence; `unit === null` would excuse exactly the unit-bearing measured
 * rows this must still guard; and `attrGroup === "note"` is weaker than the two
 * that matter, because a note-group row that carries a BWS field reaches the
 * file and must still be asked.
 * ============================================================================
 */
export function asksForState(observation: DrawingObservation): boolean {
  return Boolean(observation.specFieldId) || Boolean(observation.dimensionSlot);
}

/**
 * The state a row is WRITTEN with, which is not always a state anybody chose.
 *
 * `record_attributes.state` is `not null default 'confirmed'` (0007), and the
 * insert in `confirm-drawings.ts` names the column positionally — so a null
 * reaches Postgres as a NULL and violates the constraint rather than falling to
 * the default. A row `asksForState` says nothing about therefore needs the
 * default naming here, in the one place a null can arrive. It is the column's
 * own value, not a decision: the page STATES "SUPPLIER: TO BID", and writing
 * `tbc` over it would claim somebody had deferred it.
 *
 * ONE IMPLEMENTATION, TWO CALLERS: the insert and `empty_value`. The database
 * refuses `state = 'confirmed'` with a null value
 * (`record_attributes_confirmed_has_value`), so a blocker reading a different
 * state from the one the insert writes is a 500 in place of a sentence.
 */
export function stateToWrite(observation: DrawingObservation): AttributeState {
  return observation.state ?? "confirmed";
}

/**
 * Computed on every read, never stored.
 *
 * A stored blocker is stale by the first edit: confirming the BOQ creates the
 * targets, unticking a run removes one, choosing a unit clears another — and
 * the screen and the confirm route would then disagree about whether a card can
 * commit, which is the disagreement that lets a half-reviewed card through.
 */
export function drawingItemBlockers(
  item: DrawingItem,
  resolution: DrawingResolution,
  occupied: OccupiedSlots,
  /**
   * For a page of a code that NAMES its configurations (schemaVersion 3): the
   * plan and the bill lines' live variants. Every record-level check then runs
   * per configuration — a BWS field or a dimension slot collides only with
   * another row written to the SAME record, and Type 2's COM 1 and Type 3's
   * COM 1 are on two different chairs. `occupied` is then keyed by the REAL
   * variant ids (not re-keyed through `occupancyThrough`), and so is every
   * replace acknowledgement.
   *
   * Null or absent: exactly the checks this function has always made.
   */
  named: NamedTargets | null = null,
  /**
   * What OTHER PAGES of the same code claim — `crossPageClaims`, over the
   * staged document. A pending row giving the same BWS field to the same
   * configuration as another page's row, in different words, is a decision the
   * card can see before anything is written, so it is a blocker on BOTH rows
   * now rather than a 409 on the second page after the first was applied.
   */
  crossPage: ReadonlyMap<string, CrossPageClaim> | null = null,
): DrawingBlocker[] {
  const blockers: DrawingBlocker[] = [];
  const occupiedFields = occupied.fields;
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending") continue;
    const claim = crossPage?.get(observation.id);
    if (claim?.kind === "conflict") {
      blockers.push({
        code: "field_conflict",
        observationId: observation.id,
        pairKey: claim.pairKey,
        message: claim.message,
        clash: claim.clash,
      });
    }
  }
  const targets = targetRecordIds(item, resolution);
  // THE MOVE LANDS ON A SLOT FREE ON THE RECORD, not only on the page. The
  // staged claims were counted by `crossPageClaims`; what an earlier document
  // already wrote to the records this row reaches is only known here.
  for (const blocker of blockers) {
    if (blocker.code !== "field_conflict") continue;
    const moving = blocker.clash.move;
    const held = new Set<string>();
    for (const recordId of rowWriteRecords(moving.observationId, targets, named)) {
      for (const fieldId of occupied.fields.get(recordId)?.keys() ?? []) held.add(fieldId);
    }
    const free = moving.candidates.find((candidate) => !held.has(candidate.fieldId)) ?? null;
    blocker.clash = {
      ...blocker.clash,
      move: { ...moving, fieldId: free?.fieldId ?? null, fieldName: free?.fieldName ?? null },
    };
  }
  const pending = item.observations.filter((observation) => observation.reviewStatus === "pending");
  // The records a row reaches that exist today, and the configuration scopes
  // it is written in. One unnamed scope, and the ticked records, for a page
  // that names no configurations.
  const recordsOf = (observation: DrawingObservation) => rowWriteRecords(observation.id, targets, named);
  const scopesOf = (observation: DrawingObservation): string[] =>
    named ? (named.plan.rows[observation.id] ?? named.plan.labels) : [""];
  const scopes: string[] = named ? named.plan.labels : [""];
  const recordsInScope = (scope: string): string[] =>
    named
      ? targets.flatMap((parentId) => {
          const target = configurationTarget(parentId, scope, named);
          return target.kind === "existing" ? target.variantIds : [];
        })
      : targets;

  if (targets.length === 0) {
    blockers.push({
      code: "no_targets",
      // A page with NO code is a different answer from a page whose code
      // matched nothing. The second is waiting for the bill; the first will
      // never match one however many bills are confirmed, so sending its
      // reviewer to the BOQ is advice that cannot work.
      message: resolution.runs.length
        ? "Every phase this item appears in is unticked or unresolved."
        : item.itemCodeRaw === null
          ? "This page carries no item code, so nothing matched it. Say which record it is, or ignore the page."
          : "No record carries this item code yet. Confirm the BOQ for this pack first.",
    });
  }

  for (const run of resolution.runs) {
    if (run.status === "ambiguous") {
      blockers.push({
        code: "ambiguous_run",
        runId: run.runId,
        message: `${run.runName} has ${run.candidates.length} lines with this code. Choose which one this drawing is.`,
      });
    }
  }

  if (named) blockers.push(...namedConfigurationBlockers(item, resolution, targets, named));

  for (const observation of pending) {
    // Only a row that REACHES something is asked — see `asksForState`. A
    // general-conditions block composes into nothing, so nothing reads the
    // answer and the card is no longer held for one.
    if (asksForState(observation) && observation.state === null) {
      blockers.push({
        code: "no_state",
        observationId: observation.id,
        message: observation.stateReason ?? "Say whether this is stated or still TBC.",
      });
    }
    // Read through `stateToWrite`, not off the row: an unasked row is written
    // with the column's default, and the database refuses a confirmed value
    // that is blank. The way out differs, because an unasked row has no state
    // control to reach for.
    if (stateToWrite(observation) === "confirmed" && !observation.value?.trim()) {
      blockers.push({
        code: "empty_value",
        observationId: observation.id,
        message: asksForState(observation)
          ? "A stated value cannot be blank. Give the value or mark it TBC."
          : "This row has nothing to record. Give the value back, or ignore the row.",
      });
    }
    if (observation.attrGroup === "dimension" && observation.unit === null && observation.value?.trim()) {
      blockers.push({
        code: "unit_missing",
        observationId: observation.id,
        message: "These drawings do not print their units. Choose millimetres or centimetres.",
      });
    }
    if (observation.attrGroup === "dimension") {
      // 0011 cannot store a dimension without a slot, so this must be a
      // sentence on the screen rather than a check-constraint violation at
      // confirm. Reachable only by editing a row's group to `dimension`
      // without saying which dimension it is.
      if (!observation.dimensionSlot) {
        blockers.push({
          code: "dimension_slot_missing",
          observationId: observation.id,
          message: "Say which dimension this is — width, depth, height, seat height or diameter — or keep it as a note.",
        });
      } else {
        const slot = observation.dimensionSlot;
        const acknowledged = acknowledgedReplacements(observation);
        // A clash the reviewer has TICKED for that record is a replacement,
        // not a blocker. One they have not seen still is.
        const clash = recordsOf(observation).find((recordId) => {
          const occupant = occupied.dimensions.get(recordId)?.get(slot);
          if (!occupant) return false;
          // The same measurement already recorded is not a replacement —
          // decided PER RECORD, since one fan-out can be a no-op on one record
          // and a real write on another.
          if (alreadyRecorded(observation, occupant)) return false;
          return acknowledged.get(recordId)?.attributeId !== occupant.attributeId;
        });
        if (clash) {
          blockers.push({
            code: "dimension_slot_taken",
            observationId: observation.id,
            recordId: clash,
            message: `One of these records already has a ${DIMENSION_SLOT_LABELS[slot].toLowerCase()} from another page. Tick it to replace it, or make this a note.`,
          });
        }
      }
    }
    if (observation.specFieldId && observation.attrGroup !== "dimension") {
      // Pre-checked so an occupied slot is a sentence the reviewer can act on,
      // rather than a unique-violation 500 from the database.
      const acknowledged = acknowledgedReplacements(observation);
      const clash = recordsOf(observation).find((recordId) => {
        const occupant = occupiedFields.get(recordId)?.get(observation.specFieldId ?? "");
        if (!occupant) return false;
        // The same finish, by the client's code, is not a replacement.
        if (alreadyRecorded(observation, occupant)) return false;
        return acknowledged.get(recordId)?.attributeId !== occupant.attributeId;
      });
      if (clash) {
        blockers.push({
          code: "slot_taken",
          observationId: observation.id,
          recordId: clash,
          message: "That BWS field already has a value on one of these records. Tick it to replace it, choose another field, or make this a note.",
        });
      }
    }
  }

  // Two observations in ONE card claiming one field would satisfy the check
  // above (nothing is written yet) and collide at insert — but only where they
  // land on the SAME record, which for named configurations means sharing one.
  const claimed = new Map<string, string>();
  for (const observation of pending) {
    if (!observation.specFieldId || observation.attrGroup === "dimension") continue;
    const keys = scopesOf(observation).map((scope) => `${scope}\u0000${observation.specFieldId}`);
    if (keys.some((key) => claimed.has(key))) {
      blockers.push({
        code: "slot_taken",
        observationId: observation.id,
        message: named
          ? "Two of these specs are assigned to the same BWS field on the same configuration. Move one."
          : "Two of these specs are assigned to the same BWS field. Move one.",
      });
    } else {
      for (const key of keys) claimed.set(key, observation.id);
    }
  }

  // The same rule for dimension slots: two widths in one card satisfy the
  // live check above (neither is written yet) and collide at insert.
  const claimedSlots = new Map<string, string>();
  for (const observation of pending) {
    if (observation.attrGroup !== "dimension" || !observation.dimensionSlot) continue;
    const keys = scopesOf(observation).map((scope) => `${scope}\u0000${observation.dimensionSlot}`);
    if (keys.some((key) => claimedSlots.has(key))) {
      blockers.push({
        code: "dimension_slot_taken",
        observationId: observation.id,
        message: `Two of these are the ${DIMENSION_SLOT_LABELS[observation.dimensionSlot].toLowerCase()}. Change one, or make it a note.`,
      });
    } else {
      for (const key of keys) claimedSlots.set(key, observation.id);
    }
  }

  // Dia. REPLACES W x D, so a record carrying both would export a cell that
  // silently drops two real measurements. Cross-row, so no check constraint
  // can hold it — it is caught here, against the card AND what the target
  // records already carry, and named on the export cell too. Per scope: a
  // round configuration beside a square one is two different chairs.
  const reported = new Set<string>();
  for (const scope of scopes) {
    const inScope = pending.filter((o) => scopesOf(o).includes(scope));
    const diaHere = inScope.find((o) => o.attrGroup === "dimension" && o.dimensionSlot === "DIA");
    const squareHere = inScope.filter((o) => o.attrGroup === "dimension" && (o.dimensionSlot === "W" || o.dimensionSlot === "D"));
    const records = recordsInScope(scope);
    const squareThere = records.some(
      (recordId) => occupied.dimensions.get(recordId)?.has("W") || occupied.dimensions.get(recordId)?.has("D"),
    );
    const diaThere = records.some((recordId) => occupied.dimensions.get(recordId)?.has("DIA"));
    if (diaHere && (squareHere.length > 0 || squareThere) && !reported.has(diaHere.id)) {
      reported.add(diaHere.id);
      blockers.push({
        code: "dia_conflict",
        observationId: diaHere.id,
        message: "This item has a diameter and a width or depth. A round item is written Dia. instead of W x D — remove one.",
      });
    }
    if (!diaHere && diaThere && squareHere.length > 0 && !reported.has(squareHere[0]!.id)) {
      reported.add(squareHere[0]!.id);
      blockers.push({
        code: "dia_conflict",
        observationId: squareHere[0]!.id,
        message: "One of these records already has a diameter. A round item is written Dia. instead of W x D — make this a note, or retire the diameter.",
      });
    }
  }

  return blockers;
}

/**
 * The two blockers only a page of NAMED configurations can raise.
 *
 *   configuration_name  A name the database will refuse (`VARIANT_LABEL_SHAPE`),
 *                       said in words on the card rather than as a 500 at
 *                       confirm.
 *   configuration_new   Confirming would CREATE a configuration under a bill
 *                       line that already has OTHER live ones. The safety floor
 *                       for cross-document naming, which this app does not
 *                       reconcile: without it the drawing set's `MUR 1`
 *                       silently becomes a sixth configuration beside the
 *                       specification sheet's `TYPE 1`. An exact name is the
 *                       exact step and lands on the existing record with no
 *                       question; anything else waits for the reviewer's tick,
 *                       stored per (bill line, name) in `configurationAcks`.
 *
 * Computed, never stored, and called by the screen and the confirm alike.
 */
export function namedConfigurationBlockers(
  item: DrawingItem,
  resolution: DrawingResolution,
  targets: readonly string[],
  named: NamedTargets,
): DrawingBlocker[] {
  const blockers: DrawingBlocker[] = [];
  // A row whose only configurations a reviewer removed (brief C1).
  for (const observationId of named.plan.undecided ?? []) {
    blockers.push({
      code: "configuration_undecided",
      observationId,
      message:
        "This row belonged only to a configuration that has been removed. Say which configurations it applies to, or make it shared by all of them.",
    });
  }
  const runNameOf = new Map<string, string>();
  for (const run of resolution.runs) if (run.status === "matched") runNameOf.set(run.record.id, run.runName);
  // A NAME is only stored where it is CREATED: one paired with an existing
  // configuration takes that configuration's name.
  const creating = new Set<string>();
  for (const parentId of targets) {
    for (const label of named.plan.labels) {
      const target = configurationTarget(parentId, label, named);
      if (target.kind === "create") creating.add(label);
      if (target.kind !== "ask") continue;
      const where = runNameOf.get(parentId);
      const words = target.namesRaw.filter((raw) => normaliseVariantLabel(raw) !== label);
      const said = words.length > 0 ? `The page says ${words.join(" / ")} (read as ${label})` : `The page names ${label}`;
      blockers.push({
        code: "configuration_new",
        recordId: parentId,
        label,
        existing: target.existing,
        namesRaw: target.namesRaw,
        collides: target.collides,
        message: `${said}, and this item${where ? ` on ${where}` : ""} already has ${target.existing.join(", ")}. Pair it with one of them${
          target.collides ? " (it cannot be created beside one of the same name without a rename)" : ", or create it as a new configuration"
        }.`,
      });
    }
  }
  // Two of this page's configurations paired onto ONE existing record would
  // write every shared row to it twice.
  for (const parentId of targets) {
    const seen = new Map<string, string>();
    for (const label of named.plan.labels) {
      const target = configurationTarget(parentId, label, named);
      if (target.kind !== "existing") continue;
      target.variantIds.forEach((variantId, index) => {
        const other = seen.get(variantId);
        if (other) {
          blockers.push({
            code: "configuration_pair_twice",
            recordId: parentId,
            label,
            message: `${other} and ${label} would both land on ${target.as[index]}. Pair one of them with a different configuration, or create it as a new one.`,
          });
        } else {
          seen.set(variantId, label);
        }
      });
    }
  }
  for (const label of creating) {
    const problem = variantLabelProblem(label);
    if (problem) blockers.push({ code: "configuration_name", label, message: problem });
  }
  return blockers;
}

// ---- warnings --------------------------------------------------------------

export type DrawingWarning = { code: "unit_implausible" | "already_recorded"; message: string; observationId: string };

/**
 * Things worth a second look that must NOT stop a commit.
 *
 * Kept as a separate type from `DrawingBlocker` rather than as a `severity`
 * field on one, because the difference is not presentational. A blocker is
 * re-checked inside the confirm transaction and refuses the write; a warning is
 * never checked there at all. One type with two meanings is how the confirm
 * route eventually starts refusing things the reviewer was only being told
 * about — so the confirm route cannot even name these.
 *
 * Computed on every read, never stored, for the same reason blockers are:
 * choosing a unit clears one, and a stored warning is stale by the first edit.
 */
export function drawingItemWarnings(item: DrawingItem): DrawingWarning[] {
  const warnings: DrawingWarning[] = [];
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending") continue;
    if (observation.attrGroup !== "dimension") continue;
    const message = implausibleDimension(observation.value, observation.unit);
    if (message) warnings.push({ code: "unit_implausible", observationId: observation.id, message });
  }
  return warnings;
}

// ---- which picture of the item to show -------------------------------------

/**
 * The kinds of picture a page carries, in the order we would rather have them.
 *
 * "Prefer the 3D view, fall back to a front view" is the rule this encodes, and
 * a photograph or a render counts as satisfying the first half: on a
 * specification sheet the 3D view IS a photograph or a CGI visual, and it is
 * the most recognisable thing on the page. The elevations come next because a
 * front view still identifies an item; a plan rarely does, and a detail almost
 * never does.
 *
 * The MODEL never sees this order. It reports what each picture is, and the
 * choice happens here, in code, where it can be tested -- house convention 6.
 */
export const VIEW_PREFERENCE = [
  "photo",
  "render",
  "3d",
  "front",
  "side",
  "back",
  "plan",
  "detail",
  "other",
] as const;
export type ViewType = (typeof VIEW_PREFERENCE)[number];

/** A bbox that is the right shape, the right way round, and not a sliver. */
function usableBox(bbox: unknown): [number, number, number, number] | null {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [x0, y0, x1, y1] = bbox.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : NaN));
  if ([x0, y0, x1, y1].some((n) => Number.isNaN(n))) return null;
  // Clamp rather than reject: a model that reports 1.02 for the right edge of a
  // full-width photograph means the edge of the page, and throwing that away
  // would lose a good crop over a rounding error.
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const box: [number, number, number, number] = [clamp(x0!), clamp(y0!), clamp(x1!), clamp(y1!)];
  // Inverted or degenerate. A 1% sliver is not a picture of anything, and
  // rendering one produces a smear the reviewer has to notice to reject.
  if (box[2] - box[0] < 0.02 || box[3] - box[1] < 0.02) return null;
  return box;
}

/** The reported views, cleaned: bad boxes dropped, page defaulted to the item's. */
export function usableViews(raw: readonly RawViewRegion[] | undefined, itemPage: number | null): ItemView[] {
  if (!raw) return [];
  const views: ItemView[] = [];
  for (const region of raw) {
    const bbox = usableBox(region.bbox);
    if (!bbox) continue;
    views.push({
      viewType: (VIEW_PREFERENCE as readonly string[]).includes(region.viewType)
        ? (region.viewType as ViewType)
        : "other",
      // A model that reported the region but not its page almost certainly
      // meant the page the item is on, which is the only page it was shown.
      page: region.page ?? itemPage,
      bbox,
    });
  }
  return views;
}

/**
 * The one picture to propose, or null.
 *
 * Preference order first; among equals, the LARGEST, because on a page with a
 * big 3D view and a small inset the big one is the one somebody drew to be
 * looked at. Ties after that fall to the order the model reported them, which
 * is the order they appear on the page.
 */
export function pickItemView(views: readonly ItemView[]): ItemView | null {
  if (views.length === 0) return null;
  const area = (view: ItemView) => (view.bbox[2] - view.bbox[0]) * (view.bbox[3] - view.bbox[1]);
  const rank = (view: ItemView) => VIEW_PREFERENCE.indexOf(view.viewType);
  return [...views].sort((a, b) => rank(a) - rank(b) || area(b) - area(a))[0] ?? null;
}

// ---- across a whole pack ---------------------------------------------------
//
// One drawing run cannot see these. They exist because a tender pack now
// arrives as SEVERAL drawing documents — the real Panther pack is one combined
// shop-drawing set plus ten per-item specification sheets — and the two things
// that go wrong when it does are only visible from above.

/** One card, wherever it came from. The pack-level functions work on these. */
export type PackCard = {
  importId: string;
  filename: string | null;
  item: DrawingItem;
  targets: string[];
};

export type DuplicateTarget = {
  recordId: string;
  /** Every card that would write to that record, in the order they were read. */
  cards: { importId: string; filename: string | null; itemId: string; itemCodeRaw: string | null }[];
};

/**
 * Records that TWO documents in one pack both describe.
 *
 * `record_attributes_field_slot_key` deliberately excludes dimensions, because
 * many of them compose into the one BWS `Dimensions` field. That exemption is
 * correct and it means nothing stops two documents inserting two full sets of
 * dimensions on the same record — whichever is reviewed second silently doubles
 * them, with no error anywhere.
 *
 * The real pack guarantees this: S-100 is a page of the shop-drawing set AND
 * has its own specification sheet.
 *
 * Reported, never resolved automatically. The two documents may legitimately
 * disagree, and which one wins is a judgement — the specification sheets
 * themselves say the signed shop drawings take precedence over them.
 */
export function duplicateTargets(cards: PackCard[]): DuplicateTarget[] {
  const byRecord = new Map<string, DuplicateTarget["cards"]>();
  for (const card of cards) {
    for (const recordId of card.targets) {
      const list = byRecord.get(recordId) ?? [];
      // One card claiming a record twice is not a duplicate ACROSS documents.
      if (list.some((entry) => entry.itemId === card.item.id)) continue;
      list.push({
        importId: card.importId,
        filename: card.filename,
        itemId: card.item.id,
        itemCodeRaw: card.item.itemCodeRaw,
      });
      byRecord.set(recordId, list);
    }
  }
  return [...byRecord.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([recordId, list]) => ({ recordId, cards: list }));
}

export type RepeatedObservation = {
  /** The shared text, as the first card wrote it. */
  label: string;
  value: string | null;
  attrGroup: AttributeGroup;
  /** Every pending copy of it, so one action can reach them all. */
  occurrences: { importId: string; itemId: string; observationId: string; version: number }[];
};

/**
 * How many cards must share a line before it is boilerplate rather than a
 * coincidence. Two items can genuinely share a fabric; ten cannot genuinely
 * share fourteen paragraphs of manufacturing conditions.
 */
const REPEAT_THRESHOLD = 3;

/**
 * Lines that appear, word for word, on three or more cards in a pack.
 *
 * Every Panther specification sheet carries the same fourteen-bullet REMARKS
 * block: fire and safety codes, mock-up approval, who approves a finish. Staged
 * per item that is ~140 note observations to review one at a time, and they are
 * package conditions rather than facts about any one item.
 *
 * Grouped so the reviewer can ignore or confirm all copies at once. NOT
 * rerouted into `project_notes`: that table is written only by the preamble
 * confirm path, and quietly giving a second document write access to it is a
 * bigger change than a review screen should make on its own.
 *
 * Computed on read like every other diagnostic here — ignoring one copy changes
 * the group, so a stored version would be stale immediately.
 *
 * NOTES ONLY, and that restriction is load-bearing. Ten chairs sharing a fabric
 * and three benches sharing a width are per-item FACTS that happen to coincide;
 * offering "ignore on all" over them invites discarding ten real observations in
 * one click. A note is prose the document stamps on every sheet, and it is the
 * only group where a repeat means boilerplate rather than agreement.
 */
export function repeatedObservations(cards: PackCard[]): RepeatedObservation[] {
  const groups = new Map<string, RepeatedObservation>();

  for (const card of cards) {
    for (const observation of card.item.observations) {
      if (observation.reviewStatus !== "pending") continue;
      if (observation.attrGroup !== "note") continue;
      const label = (observation.labelRaw ?? "").trim();
      const value = (observation.value ?? "").trim();
      // A bare label with no value is not boilerplate worth grouping; it is a
      // callout somebody still has to fill in, per item.
      if (value === "") continue;
      const key = `${observation.attrGroup}\u0000${label.toLowerCase()}\u0000${value.toLowerCase()}`;

      const group = groups.get(key) ?? {
        label: label || observation.attrGroup,
        value: observation.value,
        attrGroup: observation.attrGroup,
        occurrences: [],
      };
      // EVERY copy is listed, including two on one card, because the action
      // this feeds has to reach all of them. How many CARDS share it is what
      // decides whether it is boilerplate, and that is counted below.
      group.occurrences.push({
        importId: card.importId,
        itemId: card.item.id,
        observationId: observation.id,
        version: observation.version,
      });
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .filter((group) => new Set(group.occurrences.map((o) => o.itemId)).size >= REPEAT_THRESHOLD)
    .sort((a, b) => b.occurrences.length - a.occurrences.length);
}

// ---- staging ---------------------------------------------------------------

/**
 * A group for a callout, from the drawing's own words. Only `dimension` is
 * decided structurally (the model reported it as one); the rest is a display
 * grouping, and `other` is an honest answer rather than a wrong bucket.
 */
export function classifyGroup(
  labelRaw: string | null,
  valueRaw: string | null,
  extra?: { materialCodeRaw?: string | null; itemNameRaw?: string | null },
): AttributeGroup {
  return classifyCallout({ labelRaw, valueRaw, ...extra }).group;
}

let stagingCounter = 0;
const nextId = (): string =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `obs-${Date.now()}-${(stagingCounter += 1)}`;

/**
 * Model output to staged items. Deterministic apart from the ids, and it
 * decides NOTHING a human could not check against the page: every unit carries
 * a `unitSource` saying where it came from, and a field slot is only claimed
 * where the wording plainly names one.
 *
 * `projectDefaultUnit` is the project's answer to "what are this project's
 * drawings drawn in", used only where the page states nothing and its figures
 * do not agree. Pass null for a project that has not said, and this behaves
 * exactly as it did before the setting existed.
 */
// ---- the notes a sheet prints as one statement ------------------------------

/**
 * The sheet's own field name at the head of a note line.
 *
 * The Panther specification sheets print their general conditions as a column
 * of lines, each stamped with the field it sits under: `REMARKS: SUBMIT SHOP
 * DRAWINGS FOR REVIEW…`, `SUPPLIER: TO BID`, `REQUIRED SUBMITTALS: …`. Fifteen
 * REMARKS lines are ONE statement the sheet makes about the item.
 *
 * Uppercase only, and the colon must be followed by text: a sentence that
 * happens to contain a colon is not a field name, and neither is a note that
 * opens with a lower-case word.
 */
function splitNotePrefix(text: string): { prefix: string | null; rest: string } {
  const trimmed = text.trim();
  const match = /^([A-Z][A-Z0-9 &/()'\u2019.-]{0,38}):[ \t]+(\S[\s\S]*)$/.exec(trimmed);
  if (!match) return { prefix: null, rest: trimmed };
  return { prefix: match[1]!.trim(), rest: match[2]!.trim() };
}

/** REQUIRED SUBMITTALS -> Required submittals. The page shouted; the screen need not. */
function noteLabel(prefix: string): string {
  const lower = prefix.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Only a row that is still a plain, untouched note off `notesRaw` joins a block.
 *
 * A dimension figure the vocabulary could not place is also a note — `ARM
 * HEIGHT`, `Dimension 3` — and it keeps its own label, its figure and its unit.
 * Merging one of those into a paragraph would destroy a measurement. So the
 * test is narrow on purpose: the staging label, no unit, no slot, no BWS field,
 * and still pending. A row somebody has already merged reads as `Remarks` and
 * is therefore skipped on every later pass, which is what makes this stable to
 * run again on the same document.
 */
function isMergeableNote(observation: DrawingObservation): boolean {
  return (
    observation.reviewStatus === "pending" &&
    observation.attrGroup === "note" &&
    observation.labelRaw === "Note" &&
    observation.unit === null &&
    !observation.dimensionSlot &&
    !observation.specFieldId
  );
}

/**
 * The lines a sheet prints under one heading, as ONE row.
 *
 * Fifteen REMARKS rows are fifteen states to choose and fifteen Ignores, and
 * they bury the four facts on the page a reviewer actually has to decide. Every
 * line survives verbatim, in printed order, one per line inside the value —
 * this joins rows, it never edits, drops or reworders a word. The heading moves
 * to the label, where it stops being repeated down the column.
 *
 * DETERMINISTIC AND ID-STABLE: the block takes the FIRST line's id and version,
 * so the same staged JSON merges to the same ids on every read. That is what
 * lets it run at read time as well as at staging — the screen, the autosave and
 * the confirm route all see the same set — exactly as the dimension-slot
 * upgrade does.
 *
 * The state is the most cautious of the lines it joins: one line nobody has
 * ruled on leaves the whole block unanswered rather than inheriting a
 * confidence none of them had.
 */
export function mergeNoteBlocks(observations: DrawingObservation[]): DrawingObservation[] {
  const members = new Map<string, DrawingObservation[]>();
  const prefixes = new Map<string, string | null>();
  const layout: ({ key: string } | DrawingObservation)[] = [];

  for (const observation of observations) {
    if (!isMergeableNote(observation)) {
      layout.push(observation);
      continue;
    }
    const { prefix } = splitNotePrefix(observation.value ?? observation.valueRaw ?? "");
    const key = prefix ? `p:${prefix.toLowerCase()}` : "plain";
    if (!members.has(key)) {
      members.set(key, []);
      prefixes.set(key, prefix);
      layout.push({ key });
    }
    members.get(key)!.push(observation);
  }

  return layout.map((entry) => {
    if (!("key" in entry)) return entry;
    const group = members.get(entry.key)!;
    const prefix = prefixes.get(entry.key) ?? null;
    // A single unheaded note is already one row saying what the page said.
    if (group.length === 1 && !prefix) return group[0]!;
    const first = group[0]!;
    const state: AttributeState | null = group.some((row) => row.state === null)
      ? null
      : group.some((row) => row.state === "tbc")
        ? "tbc"
        : "confirmed";
    return {
      ...first,
      labelRaw: prefix ? noteLabel(prefix) : "Notes",
      value: group.map((row) => splitNotePrefix(row.value ?? row.valueRaw ?? "").rest).join("\n"),
      valueRaw: group.map((row) => row.valueRaw ?? "").join("\n"),
      state,
      stateReason: group.find((row) => row.state === state)?.stateReason ?? null,
    };
  });
}

/**
 * The configurations a row CLAIMS BWS FIELDS within, on its own page, as
 * folded names — or `[""]`, one unnamed scope, on a page naming none.
 *
 * The row's own names; else the page's `depictsConfigurations`; else every
 * configuration the page names. That is the same order `namedConfigurationPlan`
 * uses for where a row LANDS, narrowed to the page — which is enough, because
 * a BWS field only collides with another row written to the same record, and
 * one page's rows all land together.
 */
function fieldClaimScopes(
  item: Pick<DrawingItem, "configurations" | "depictsConfigurations">,
): (row: { configurations?: string[] }) => string[] {
  const named = itemConfigurationLabels(item);
  const depicted = foldedNames(item.depictsConfigurations);
  const fallback = depicted.length > 0 ? depicted : named.length > 0 ? named : [""];
  return (row) => {
    const own = foldedNames(row.configurations);
    return own.length > 0 ? own : fallback;
  };
}

/** Folded, de-duplicated, in order; tolerant of whatever a staged run holds. */
function foldedNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const out: string[] = [];
  for (const name of names) {
    if (typeof name !== "string" || name.trim() === "") continue;
    const folded = normaliseVariantLabel(name);
    if (!out.includes(folded)) out.push(folded);
  }
  return out;
}

/** The folded names of the configurations a page names, read defensively. */
function itemConfigurationLabels(item: Pick<DrawingItem, "configurations">): string[] {
  return foldedNames(
    (Array.isArray(item.configurations) ? item.configurations : []).map((entry) =>
      entry && typeof entry === "object" ? (entry as { name?: unknown }).name : null,
    ),
  );
}

/** BWS fields taken, per configuration scope. */
class ScopedClaims {
  private readonly byScope = new Map<string, Set<string>>();

  /** Every field taken in ANY of these scopes: a row landing on all of them may use none of those. */
  across(scopes: readonly string[]): Set<string> {
    const union = new Set<string>();
    for (const scope of scopes) for (const field of this.byScope.get(scope) ?? []) union.add(field);
    return union;
  }

  claim(scopes: readonly string[], fieldId: string): void {
    for (const scope of scopes) {
      const set = this.byScope.get(scope) ?? new Set<string>();
      set.add(fieldId);
      this.byScope.set(scope, set);
    }
  }
}

export function stageDrawings(
  items: RawDrawingItem[],
  fields: SpecFieldEntry[],
  filename: string | null,
  documentNotes: string | null,
  projectDefaultUnit: AttributeUnit | null = null,
  codeGroups: RawCodeGroup[] = [],
): StagedDrawings {
  const staged: DrawingItem[] = items.map((item) => {
    // Split before guessing. A page that prints "1800mm" would otherwise have
    // its figures read as 1800/1120/120 — all >= 300, so `mm` by luck here and
    // by coincidence on the next page.
    const dimensions = item.dimensions.map((dimension) => {
      const split = splitFigureAndUnit(dimension.valueRaw);
      return {
        ...dimension,
        valueRaw: split.value,
        printedUnit: normaliseUnit(dimension.unitRaw) ?? split.unit,
      };
    });
    // A specification sheet that gives the overall size as ONE line is read
    // here, and joins the same list. Its parts vote on the unit alongside the
    // separate figures, because they are figures off the same page.
    const combined = (item.dimensionsCombinedRaw ?? []).flatMap((line) => {
      const parsed = parseCombinedDimensions(line);
      const printedUnit = normaliseUnit(parsed.unitRaw);
      return parsed.parts.map((part) => ({
        labelRaw: part.slot && !part.slotSuggested ? DIMENSION_SLOT_LABELS[part.slot] : null,
        valueRaw: part.value,
        printedUnit,
        // A PREFIX THE LINE PRINTED IS THE PAGE SPEAKING AND IS KEPT. A slot
        // the parser worked out from print ORDER is NOT, any more: those three
        // bare figures are reported by the model in `dimensions`, each with the
        // evidence for its slot, and taking a positional read here as well
        // would put two answers on one line and let the weaker one through.
        // `slotSuggested` is exactly the parser's own marker for "I inferred
        // this from the order", which is why it is the test.
        slot: part.slotSuggested ? null : part.slot,
        tbc: part.tbc,
      }));
    });
    // ======================================================================
    // THE UNIT VOTE IS TAKEN OVER THE OVERALL FIGURES WHERE THE MODEL NAMED
    // THEM, AND OVER THE WHOLE PAGE WHERE IT DID NOT.
    //
    // `suggestUnit` abstains on a page whose figures disagree about magnitude,
    // and a shop drawing always disagrees: S-200's second page prints 5, 50,
    // 110 and 125 beside 840 and 790, because most figures on a shop drawing
    // are COMPONENTS and components are small whatever the page is drawn in.
    // So the whole-page vote abstains and every figure came back unitless,
    // which the card reports as four `unit_missing` blockers.
    //
    // CLAUDE.md's resolution order has always had this step -- "the OVERALL
    // figures agreeing, once something knows which they are" -- and until now
    // the only thing that knew was `applyViewGuesses`, at read time, after
    // sorting the figures by size. The model states it outright, so the step
    // moves to staging where it belongs and stops depending on a guess.
    //
    // It is still the page's own figures agreeing, narrowed to the figures the
    // question is about. Where the overall figures do not share a scale the
    // unit stays blank and amber, which is the honest answer and the existing
    // treatment.
    // ======================================================================
    const overallFigures = dimensions.filter((dimension) => dimension.slot !== null || dimension.isOverall === true);
    const unitGuess = suggestUnit(
      overallFigures.length > 0
        ? [...overallFigures.map((dimension) => dimension.valueRaw), ...combined.map((part) => part.valueRaw)]
        : [...dimensions.map((dimension) => dimension.valueRaw), ...combined.map((part) => part.valueRaw)],
    );
    const views = usableViews(item.viewRegions, item.page);
    // BWS FIELDS ARE CLAIMED PER CONFIGURATION, NOT PER PAGE (schemaVersion 3).
    // Type 2's fabric is COM 1 on `S-301 TYPE 2`; claiming across the page
    // handed the four room-type fabrics COM 1, COM 2, COM 3 and nothing, of one
    // record. See `fieldClaimScopes`.
    const scopesOf = fieldClaimScopes(item);
    const taken = new ScopedClaims();
    const observations: DrawingObservation[] = [];

    // A drawing dimensions its views with leader lines and no words: the AP364
    // sofa page carries eight figures and labels none of them. `labelRaw` stays
    // null (that IS what the page said); the display label is positional, so a
    // reviewer can tell the eight apart instead of reading "dimension" eight
    // times.
    let dimensionNo = 0;
    for (const dimension of dimensions) {
      dimensionNo += 1;
      const state = suggestAttributeState(dimension.valueRaw);
      const resolved = resolveDimensionUnit({
        printed: dimension.printedUnit,
        pageGuess: unitGuess,
        projectDefault: projectDefaultUnit,
      });
      // WHICH OF THE FIVE SLOTS, OR NONE — and "none" is not a failure.
      //
      // TWO READINGS, AND WHAT TO DO WHEN THEY DISAGREE.
      //
      // The MODEL says which figure is the overall width, because it can see
      // the page: the figure is labelled, or it spans the object on the front
      // elevation. The LABEL VOCABULARY says what the page's own word means, by
      // exact lookup on the whole folded label. They are independent, and that
      // is what makes them worth having both of:
      //
      //   agree            — two readings, one answer. Not flagged.
      //   only the label   — the page named it and the model did not place it.
      //                      Today's behaviour, unchanged.
      //   only the model   — an unlabelled figure on an elevation, or a part of
      //                      a printed line. Flagged, with the model's own
      //                      evidence beside it.
      //   DISAGREE         — the page's printed word wins, and the row is
      //                      flagged loudly. This is the S-203 signature:
      //                      "Width" = 80 landing in the depth slot. Neither
      //                      reading is allowed to win silently.
      //
      // `normaliseDimensionSlot` is therefore a VALIDATOR now, and keeps its
      // whole-label rule — `WIDTH SEAT` is not a width and `ARM HEIGHT` is not
      // a height, and both are printed beside the figures they would destroy.
      //
      // Everything unplaced stays exactly as the page wrote it and becomes a
      // NOTE, keeping its label, figure and unit; 0011 cannot store a dimension
      // with no slot anyway.
      const fromLabel = normaliseDimensionSlot(dimension.labelRaw);
      const fromModel = slotFromModel(dimension.slot);
      const conflict = fromLabel !== null && fromModel !== null && fromLabel !== fromModel;
      const slot = conflict ? fromLabel : (fromModel ?? fromLabel);
      const slotReason = conflict
        ? `The page labels this "${dimension.labelRaw}". It was read as ${DIMENSION_SLOT_LABELS[fromModel as DimensionSlot].toLowerCase()} instead — ${dimension.slotEvidence ?? "no reason given"}. Check it against the drawing.`
        : fromModel !== null && fromLabel === null
          ? (dimension.slotEvidence ?? null)
          : null;
      observations.push({
        id: nextId(),
        version: 1,
        attrGroup: slot ? "dimension" : "note",
        dimensionSlot: slot,
        // Flagged when the page's own word did not settle it, so the row is
        // yellow and its reason is the model's evidence rather than a sentence
        // about this app's sort order.
        slotSuggested: slot !== null && (conflict || fromLabel === null),
        ...(slotReason === null ? {} : { slotReason }),
        // Version 2 states it; a figure carrying a slot is overall by
        // definition, which is the fallback for a model that omitted it.
        isOverall: dimension.isOverall ?? slot !== null,
        labelRaw: dimension.labelRaw ?? `Dimension ${dimensionNo}`,
        valueRaw: dimension.valueRaw,
        materialCodeRaw: null,
        ...(dimension.configurations?.length ? { configurations: [...dimension.configurations] } : {}),
        value: state.value,
        unit: resolved.unit,
        // Kept in step with `unitSource` rather than replaced by it: the
        // existing screen, the PATCH route and every staged row already read
        // this boolean. A PRINTED unit is not a suggestion and must not read as
        // one, which is the whole reason the two are no longer the same fact.
        unitSuggested: resolved.source === "figures" || resolved.source === "project_default",
        ...(resolved.source ? { unitSource: resolved.source } : {}),
        specFieldId: null,
        state: state.state,
        stateReason: state.reason,
        reviewStatus: "pending",
        reviewedAt: null,
        reviewedBy: null,
        applied: null,
      });
    }

    // The combined line's parts. A part the LINE ITSELF prefixed ("W1520",
    // "Dia.460") keeps that slot, because the page said so. A bare figure gets
    // none and becomes a note — the model reports the same figure in
    // `dimensions` with its slot and the evidence for it, so a reviewer sees
    // one answer with a reason rather than two answers, one of which came from
    // assuming that three numbers are always printed widest first. Reading
    // `80 x 70 x 90 cm` positionally is how S-203 came to say it was 900mm wide.
    for (const part of combined) {
      // NOT through `suggestAttributeState`, and the difference matters. That
      // function refuses to choose when a value both states something and says
      // TBC — right for "Dark tinted wood TBC", where nobody can tell whether
      // the wood is settled. A dimension has no such ambiguity: "1520 TBC" is a
      // figure of 1520 that the client has not signed off, which is Matthew's
      // own worked example. `parseCombinedDimensions` already read it, so the
      // answer is known rather than guessed at.
      const hasFigure = parseDimensionFigure(part.valueRaw).figure !== null;
      const state: AttributeState | null = part.tbc || !hasFigure ? "tbc" : "confirmed";
      const resolved = resolveDimensionUnit({
        printed: part.printedUnit,
        pageGuess: unitGuess,
        projectDefault: projectDefaultUnit,
      });
      dimensionNo += 1;
      observations.push({
        id: nextId(),
        version: 1,
        attrGroup: part.slot ? "dimension" : "note",
        dimensionSlot: part.slot,
        // A printed prefix is a reading, not a suggestion.
        slotSuggested: false,
        // The line states the item's overall size, which is what a combined
        // dimension line is for.
        isOverall: true,
        labelRaw: part.labelRaw ?? `Dimension ${dimensionNo}`,
        valueRaw: part.valueRaw,
        materialCodeRaw: null,
        // The value keeps the TBC the page printed beside the figure.
        // composeDimensionCell reads it back out of the string, so the cell
        // says "W1520 TBC" without a second place recording the same fact.
        value: part.valueRaw,
        unit: resolved.unit,
        unitSuggested: resolved.source === "figures" || resolved.source === "project_default",
        ...(resolved.source ? { unitSource: resolved.source } : {}),
        specFieldId: null,
        state,
        stateReason: null,
        reviewStatus: "pending",
        reviewedAt: null,
        reviewedBy: null,
        applied: null,
      });
    }

    let materialNo = 0;
    for (const material of item.materials) {
      materialNo += 1;
      // The item's own name is part of the evidence: a caption reading
      // `SOFA` on a sofa page is that sofa's upholstery, and nothing else on
      // the line says so.
      const callout = classifyCallout({
        labelRaw: material.labelRaw,
        valueRaw: material.valueRaw,
        materialCodeRaw: material.materialCodeRaw,
        itemNameRaw: item.itemNameRaw,
      });
      const attrGroup = callout.group;
      const state = suggestAttributeState(material.valueRaw);
      const scopes = scopesOf(material);
      const specFieldId = suggestSpecField(
        {
          attrGroup,
          labelRaw: material.labelRaw,
          valueRaw: material.valueRaw,
          materialCodeRaw: material.materialCodeRaw,
          itemNameRaw: item.itemNameRaw,
        },
        fields,
        taken.across(scopes),
      );
      if (specFieldId) taken.claim(scopes, specFieldId);
      observations.push({
        id: nextId(),
        version: 1,
        attrGroup,
        labelRaw: material.labelRaw ?? `Material ${materialNo}`,
        valueRaw: material.valueRaw,
        materialCodeRaw: material.materialCodeRaw,
        ...(material.configurations?.length ? { configurations: [...material.configurations] } : {}),
        value: state.value,
        unit: null,
        unitSuggested: false,
        ...(callout.guessed ? { groupSuggested: true, groupReason: callout.reason } : {}),
        specFieldId,
        state: state.state,
        stateReason: state.reason,
        reviewStatus: "pending",
        reviewedAt: null,
        reviewedBy: null,
        applied: null,
      });
    }

    for (const note of item.notesRaw) {
      const state = suggestAttributeState(note);
      observations.push({
        id: nextId(),
        version: 1,
        attrGroup: "note",
        labelRaw: "Note",
        valueRaw: note,
        materialCodeRaw: null,
        value: state.value,
        unit: null,
        unitSuggested: false,
        specFieldId: null,
        state: state.state,
        stateReason: state.reason,
        reviewStatus: "pending",
        reviewedAt: null,
        reviewedBy: null,
        applied: null,
      });
    }

    return {
      id: nextId(),
      version: 1,
      page: item.page,
      itemCodeRaw: item.itemCodeRaw,
      itemNameRaw: item.itemNameRaw,
      confidence: item.confidence,
      targets: null,
      observations: mergeNoteBlocks(observations),
      ...(views.length > 0 ? { viewRegions: views, imageProposal: pickItemView(views) } : {}),
      // Only where the page names any: an item with none must stage exactly as
      // a version 2 item did, key for key.
      ...(item.configurations?.length
        ? {
            configurations: item.configurations.map((entry) => ({
              name: entry.name,
              nameRaw: entry.nameRaw,
              evidence: entry.evidence,
            })),
          }
        : {}),
      ...(item.depictsConfigurations?.length ? { depictsConfigurations: [...item.depictsConfigurations] } : {}),
    };
  });

  return {
    // VERSION 3: version 2 (the model was asked which figure is which, whether
    // each one measures the whole item, and whether repeated pages are one
    // item) plus the configurations a page names and which rows belong to
    // which. The read-time guessing pipeline is skipped for 2 and 3 alike.
    schemaVersion: 3,
    kind: "shop_drawings",
    filename,
    documentNotes,
    items: staged,
    codeGroups: codeGroups.map((group) => ({
      itemCodes: group.itemCodes,
      pages: group.pages,
      relationship: group.relationship,
      evidence: group.evidence,
    })),
  };
}

/**
 * THE READ-TIME PIPELINE, AND WHICH HALF OF IT A DOCUMENT GETS.
 *
 * `upgradeDimensionSlots` and `upgradeCalloutGuesses` run on everything. Both
 * only ever fill a gap from the page's own words — a label the vocabulary
 * recognises, a caption naming a cloth — and both leave a row a person has
 * touched alone. Running them on every read is what let a corrected word list
 * reach an eleven-document pack with no second model call.
 *
 * `applyViewGuesses` runs on VERSION 1 ONLY, and that is the 2026-09-18 change.
 * It decides which figure is the width by sorting the page's figures by size,
 * which across the sandbox produced 141 guessed slots out of 183 and read a
 * sheet printing `80 x 70 x 90 cm` as a 900mm-wide chair. A version 2 run has
 * been read by a model that could see the page and said which figure is which
 * and why, so there is nothing left to guess and guessing would overwrite it.
 *
 * Version 1 runs keep it, FROZEN. They were staged without the model ever being
 * asked, and inventing the answers they never carried would be one more
 * inference layer — the thing version 2 removes. Re-read a pack to move it
 * forward; nothing upgrades in place. The whole branch goes when the last
 * version 1 run has been re-read.
 */
export function assertStagedDrawings(parsed: unknown, fields?: SpecFieldEntry[]): StagedDrawings {
  const doc = parsed as Partial<StagedDrawings> | null;
  if (!doc || typeof doc !== "object" || doc.kind !== "shop_drawings" || !Array.isArray(doc.items)) {
    throw new Error("This document was not staged as shop drawings. Upload the drawings again.");
  }
  const upgraded = upgradeTbcMarkers(upgradeCalloutGuesses(upgradeDimensionSlots(doc as StagedDrawings), fields ?? []));
  return readByModel(upgraded) ? upgraded : applyViewGuesses(upgraded);
}

/**
 * Take an edge TBC marker out of a value on a pack that was staged before
 * `splitTbcMarker` existed.
 *
 * Same discipline as `upgradeCalloutGuesses`, and for the same reason: the
 * eleven-document Panther pack has already been read and each document was a
 * charged call. A rule that can only reach a re-read is a rule that costs money
 * to fix, so this runs on READ and is NEVER WRITTEN BACK — every reader
 * computes the same answer from the same staged JSON, which is all the screen,
 * the autosave and the confirm route need in order to agree. Ids are untouched.
 *
 * A ROW A PERSON HAS TOUCHED IS NEVER SECOND-GUESSED: `version === 1` says
 * nobody has, and only `pending` rows are in scope.
 *
 * TWO EXCLUSIONS, both traps rather than tidiness:
 *
 *   * A DIMENSION IS LEFT ALONE. `composeDimensionCell` reads the marker back
 *     out of the figure itself (`parseDimensionFigure`'s `tbcInline`), which is
 *     what lets "1520 TBC" compose as `W1520 TBC`. Nothing there is hidden
 *     inside a fabric's name, so there is nothing to recover and a second
 *     rewrite of that string is a second place to get it wrong.
 *   * A MULTI-LINE VALUE IS LEFT ALONE. That is a merged note block, and the
 *     edges of a BLOCK are not the edges of any statement in it: the first
 *     line's opening word and the last line's closing word have nothing to do
 *     with each other. `mergeNoteBlocks` joined rows without editing a word,
 *     and this must not be what starts editing them.
 *
 * The state is set from the marker whatever it was before, which is the one
 * case the item names outright: a row already at `tbc` carrying the word keeps
 * its state and loses the word.
 */
function upgradeTbcMarkers(doc: StagedDrawings): StagedDrawings {
  let anyTouched = false;
  const items = doc.items.map((item) => {
    let touched = false;
    const observations = item.observations.map((observation) => {
      if (observation.reviewStatus !== "pending") return observation;
      if (observation.version !== 1) return observation;
      if (observation.attrGroup === "dimension") return observation;
      const value = observation.value;
      if (!value || value.includes("\n")) return observation;

      const split = splitTbcMarker(value);
      if (!split.tbc || split.value === null || split.value === value) return observation;

      touched = true;
      return { ...observation, value: split.value, state: "tbc" as AttributeState, stateReason: split.reason };
    });
    if (!touched) return item;
    anyTouched = true;
    return { ...item, observations };
  });
  return anyTouched ? { ...doc, items } : doc;
}

/**
 * Re-read a material callout a previous classifier gave up on.
 *
 * The word lists were widened on 2026-09-17 after the real S-100 sheet staged
 * its upholstery as `other` with no BWS field. A prompt is read at call time
 * and a word list is not, so this is the half that can be fixed without
 * re-reading a document: the eleven-page Panther pack gains the corrected
 * reading on its next page load, with no second model call and nothing charged
 * again. Same discipline as `upgradeDimensionSlots` and `mergeNoteBlocks`.
 *
 * A ROW A PERSON HAS TOUCHED IS NEVER SECOND-GUESSED. `version === 1` is what
 * says nobody has: every edit bumps it, so a reviewer who deliberately set a
 * row to `Other` with no field keeps that, for good. Neither is a row that
 * already holds a field, a dimension, or a note — a merged note block is a
 * statement about the item, not a callout, and promoting one to a fabric would
 * destroy the very thing `mergeNoteBlocks` preserved.
 *
 * `fields` may be empty, and then only the GROUP is corrected. That is the
 * honest behaviour for a caller with no register to hand: the next read that
 * has one fills the field in, and until then the screen and the confirm agree
 * about a row with no field rather than disagreeing about which one.
 */
function upgradeCalloutGuesses(doc: StagedDrawings, fields: SpecFieldEntry[]): StagedDrawings {
  let anyTouched = false;
  const items = doc.items.map((item) => {
    // Every field this item's rows already hold, whatever their review state:
    // a COM 1 taken by an applied row is still taken. PER CONFIGURATION, the
    // way staging claimed them — on a page naming none that is one scope and
    // exactly the old behaviour.
    const scopesOf = fieldClaimScopes(item);
    const taken = new ScopedClaims();
    for (const observation of item.observations) {
      if (observation.specFieldId) taken.claim(scopesOf(observation), observation.specFieldId);
    }

    let touched = false;
    const observations = item.observations.map((observation) => {
      if (observation.reviewStatus !== "pending") return observation;
      if (observation.version !== 1) return observation;
      if (observation.specFieldId) return observation;
      if (observation.attrGroup === "dimension" || observation.attrGroup === "note") return observation;

      const callout = classifyCallout({
        labelRaw: observation.labelRaw,
        valueRaw: observation.valueRaw,
        materialCodeRaw: observation.materialCodeRaw,
        itemNameRaw: item.itemNameRaw,
      });
      if (callout.kind === null) return observation;

      const specFieldId = suggestSpecField(
        {
          attrGroup: callout.group,
          labelRaw: observation.labelRaw,
          valueRaw: observation.valueRaw,
          materialCodeRaw: observation.materialCodeRaw,
          itemNameRaw: item.itemNameRaw,
        },
        fields,
        taken.across(scopesOf(observation)),
      );
      if (specFieldId) taken.claim(scopesOf(observation), specFieldId);

      const next: DrawingObservation = {
        ...observation,
        attrGroup: callout.group,
        specFieldId,
        groupSuggested: callout.guessed,
        groupReason: callout.guessed ? callout.reason : null,
      };
      if (
        next.attrGroup === observation.attrGroup &&
        next.specFieldId === observation.specFieldId &&
        Boolean(next.groupSuggested) === Boolean(observation.groupSuggested)
      ) {
        return observation;
      }
      touched = true;
      return next;
    });

    if (!touched) return item;
    anyTouched = true;
    return { ...item, observations };
  });
  return anyTouched ? { ...doc, items } : doc;
}

/**
 * Bring a run staged before slots existed up to the current shape, IN MEMORY.
 *
 * Runs staged before 0011 hold observations with `attrGroup: "dimension"` and
 * no slot — a shape the database now refuses. Without this, every pending
 * dimension on an existing run shows a `dimension_slot_missing` blocker, and a
 * real pack carries hundreds of them: a reviewer would face a screen of errors
 * describing a decision the app used not to ask for.
 *
 * So the same rule staging applies is applied on READ: a label the vocabulary
 * recognises becomes that slot, and everything else becomes a note with its
 * label, figure and unit intact. `Side view width` becomes a note rather than a
 * width, because in a side elevation the horizontal dimension is the DEPTH.
 *
 * NEVER WRITTEN BACK HERE. A read that rewrote `intake_runs.parsed` would bump
 * the run version under whoever else has the page open, and would do it inside
 * a GET. The next autosave persists it; until then every reader computes the
 * same answer from the same input, which is all the screen and the confirm
 * route need in order to agree.
 *
 * An APPLIED observation is left exactly as it is. It is history: its
 * `record_attributes` rows were already migrated by 0011, and rewriting the
 * record of what was reviewed would make the two disagree about what happened.
 */
function upgradeDimensionSlots(doc: StagedDrawings): StagedDrawings {
  // PER ITEM, then per document. A single flag hoisted outside the map made
  // every item after the first changed one return a rebuilt object whether or
  // not anything about it had changed -- harmless only because the rebuilt
  // observations happened to be equivalent, and one edit away from an item
  // inheriting a neighbour's upgrade.
  let anyTouched = false;
  const items = doc.items.map((item) => {
    let touched = false;
    const slotted = item.observations.map((observation) => {
      if (observation.reviewStatus === "applied") return observation;
      if (observation.attrGroup !== "dimension") return observation;
      if (observation.dimensionSlot) return observation;
      touched = true;
      const slot = normaliseDimensionSlot(observation.labelRaw);
      return slot
        ? { ...observation, dimensionSlot: slot, slotSuggested: false }
        : { ...observation, attrGroup: "note" as AttributeGroup, dimensionSlot: null, slotSuggested: false };
    });
    // The same read-time, never-written-back treatment for a sheet's note
    // block: a pack staged before this existed holds fifteen REMARKS rows, and
    // a reviewer would face them a page at a time. Ids are stable, so the
    // screen and the confirm route agree about what the card holds.
    const observations = dedupeMeasured(mergeNoteBlocks(slotted), readByModel(doc));
    // Identity, not length: a lone `SUPPLIER: TO BID` is rewritten in place to
    // a Supplier row, and a length check would throw that away.
    if (observations.length !== slotted.length || observations.some((row, index) => row !== slotted[index])) {
      touched = true;
    }
    if (!touched) return item;
    anyTouched = true;
    return { ...item, observations };
  });
  return anyTouched ? { ...doc, items } : doc;
}

/**
 * The positional label staging gives a figure the page did not label.
 *
 * Generated, not read off the drawing, which is why two rows carrying it are
 * indistinguishable and may be de-duplicated against each other while
 * `FRONT` and `SIDE` may not.
 */
const POSITIONAL_LABEL = /^dimension \d+$/i;

/**
 * One row per measurement the page actually makes.
 *
 * A drawing dimensions the SAME figure on every view that shows it, and often
 * twice on one view — S-201's front elevation prints 5, 5, 27, 27, 42, 42
 * because the chair is symmetrical, and the card came back with forty-three
 * measured rows for one armchair. Forty-three rows is forty-three states to
 * choose and forty-three Ignores, which is the `mergeNoteBlocks` problem again
 * in the dimension column.
 *
 * So a figure repeated ON THE SAME VIEW collapses to one row. ACROSS views it
 * does NOT: `FRONT 640` and `BACK 640` are two statements, and their agreement
 * is the whole evidence `guessSlotsFromViews` reads the overall size from —
 * de-duplicating those would break the guess in order to tidy the table.
 *
 * Keyed on the view label, the figure and the unit, and it keeps the FIRST row
 * of each group, so the same staged JSON reduces to the same ids on every read
 * — the discipline `mergeNoteBlocks` and `upgradeDimensionSlots` both follow,
 * and what lets the screen, the autosave and the confirm route agree. An
 * unlabelled figure is keyed WITHOUT its label, because `Dimension 37` and
 * `Dimension 42` are positions this app invented, not names the page gave.
 *
 * Only PENDING rows. An applied row is history and a reviewer's own edit is
 * theirs; nothing here removes either.
 *
 * The KEY is exported because the configuration card matches one page's rows
 * against another's with it: "the same measurement, on the other page" is the
 * same question as "the same measurement, twice on this one", and two answers
 * to it would let the shared table pair up rows the de-duplicator would not.
 */
export function measuredKey(observation: DrawingObservation): string | null {
  if (!isMeasuredRow(observation)) return null;
  const figure = parseDimensionFigure(observation.value ?? observation.valueRaw).figure;
  const label = (observation.labelRaw ?? "").trim();
  const view = POSITIONAL_LABEL.test(label) ? "" : label.toLowerCase();
  // A unitless figure keys as itself. The unit is part of the key so a page
  // that states 79 in centimetres and 790 in millimetres keeps both rows --
  // they are the same size said twice, and collapsing them would hide the
  // disagreement rather than settle it.
  return `${view}|${figure}|${observation.unit ?? ""}`;
}

/**
 * THE SAME PRINTED FIGURE, STAGED BY BOTH PATHS — the rows to drop.
 *
 * S-203 prints its overall size as ONE line, `80 x 70 x 90 cm`, and a version 2
 * read stages that line twice. The model reports all three figures in
 * `dimensions`, each with its slot and the evidence it read the slot from
 * ("first of three in the printed line 80 x 70 x 90 cm"); `stageDrawings` also
 * walks `dimensionsCombinedRaw` through `parseCombinedDimensions` and pushes
 * each part as its own observation. A part the LINE prefixed (`W1520`) keeps
 * its slot and already collapses against its model twin on `dedupeMeasured`'s
 * slot key. A BARE part is deliberately stripped of its positional slot, so it
 * becomes a note keyed `view|figure|unit` with the view blanked — a different
 * key in a different set, which is why the two paths never met. Six rows on the
 * card for three measurements, and six `record_attributes` rows at confirm.
 *
 * The comment beside that second loop already states the intent — *"the model
 * reports the same figure in `dimensions` with its slot and the evidence for
 * it, so a reviewer sees one answer with a reason rather than two answers"* —
 * and it was only half applied: the bare part was stopped from claiming the
 * SLOT, not from becoming a ROW.
 *
 * Four things this is careful about, each of which a looser rule gets wrong:
 *
 * - **It MATCHES, it does not assume.** A combined line may state a figure the
 *   model never reported, and that figure is the only reading of it there is.
 *   Only a bare part whose figure the item ALREADY states with a slot goes.
 * - **Figures are compared through `parseDimensionFigure`, never as strings.**
 *   The combined path deliberately keeps the page's `TBC` inside `value`
 *   (`composeDimensionCell` reads it back out) while the model path stores the
 *   split figure, so `80` and `80 TBC` are one measurement said twice.
 * - **The unit is half the key**, for `measuredKey`'s own reason: 79 in
 *   centimetres and 790 in millimetres are a disagreement to show, not a
 *   duplicate to hide.
 * - **It is a MULTISET, consumed one for one.** `80 x 80 x 90` places 80 in two
 *   slots, and two bare parts of 80 answer to them one each. A rule that only
 *   asked "is this figure slotted anywhere" would drop a third 80 the item
 *   states once.
 *
 * `isOverallRow` is what keeps `ARM HEIGHT 520` out of it: a row the model said
 * is not overall, and any row on a `schemaVersion: 1` run (where `isOverall`
 * was never asked and falls back to "does it carry a slot"), can never match.
 *
 * Exported so `tools/measure-drawing-reading.ts` counts what the app drops
 * rather than its own idea of it — the rule this whole file is about.
 */
export function redundantOverallRows(observations: DrawingObservation[]): Set<string> {
  const slotted = new Map<string, number>();
  for (const observation of observations) {
    if (!observation.dimensionSlot) continue;
    const key = figureAndUnitKey(observation);
    if (key === null) continue;
    slotted.set(key, (slotted.get(key) ?? 0) + 1);
  }
  const redundant = new Set<string>();
  if (slotted.size === 0) return redundant;
  for (const observation of observations) {
    // A row that carries a slot is the statement being kept.
    if (observation.dimensionSlot) continue;
    if (!isOverallRow(observation)) continue;
    // `isMeasuredRow` is also what keeps an APPLIED row out of this: it is
    // history, its `record_attributes` row already exists, and nothing here
    // removes one.
    if (!isMeasuredRow(observation)) continue;
    const key = figureAndUnitKey(observation);
    if (key === null) continue;
    const remaining = slotted.get(key) ?? 0;
    if (remaining === 0) continue;
    slotted.set(key, remaining - 1);
    redundant.add(observation.id);
  }
  return redundant;
}

/** `figure|unit`, or null where the row states no figure. */
function figureAndUnitKey(observation: DrawingObservation): string | null {
  const figure = parseDimensionFigure(observation.value ?? observation.valueRaw).figure;
  if (figure === null) return null;
  return `${figure}|${observation.unit ?? ""}`;
}

/**
 * One measurement stated twice is one measurement.
 *
 * WITHIN A VIEW this has always collapsed: a front elevation prints 5, 5, 27,
 * 27 because the chair is symmetrical.
 *
 * ACROSS VIEWS IT USED TO KEEP BOTH, DELIBERATELY, and that is now wrong for
 * one specific case. An overall dimension is drawn on every view that shows it,
 * which is a fact about orthographic projection: S-200's width 840 appears on
 * the front, the back and the plan. That REPETITION WAS THE EVIDENCE
 * `guessSlotsFromViews` read the overall size from, so collapsing it would have
 * tidied the table by breaking the guess — and the rule was written down as
 * such.
 *
 * There is no guess left to break. The model states which figure fills which
 * slot, and the first version 2 read of S-200 put ten rows on a card for four
 * measurements: W 840 three times, D 790 three times, H 720 twice, SH 460
 * twice. So where two rows claim the SAME SLOT with the SAME FIGURE, they are
 * one statement made on several views and the first is kept.
 *
 * SAME SLOT, DIFFERENT FIGURE IS NEVER COLLAPSED. That is two views disagreeing
 * about the size of the chair, and it has to reach the card, where
 * `composeDimensionCell` raises `duplicate_slot` and a person decides.
 *
 * AND ONE MEASUREMENT STATED BY BOTH STAGING PATHS IS ALSO ONE MEASUREMENT —
 * `redundantOverallRows`, above, which is why `readByModel` is a parameter. It
 * runs over what this pass already kept, so a bare part answers to a slotted
 * row that survived rather than to one that was itself a repeat. It is gated on
 * `schemaVersion: 2` because version 1 runs are FROZEN: before the model was
 * asked which figure was which, the combined line's parts were the only reading
 * of the overall size there was, and reducing them would delete the only copy.
 */
function dedupeMeasured(observations: DrawingObservation[], readByModel: boolean): DrawingObservation[] {
  const seen = new Set<string>();
  const slotSeen = new Set<string>();
  const kept = observations.filter((observation) => {
    if (observation.dimensionSlot) {
      const figure = parseDimensionFigure(observation.value ?? observation.valueRaw).figure;
      if (figure !== null) {
        const key = `${observation.dimensionSlot}|${figure}|${observation.unit ?? ""}`;
        if (slotSeen.has(key)) return false;
        slotSeen.add(key);
        return true;
      }
    }
    const key = measuredKey(observation);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!readByModel) return kept;
  const redundant = redundantOverallRows(kept);
  return redundant.size === 0 ? kept : kept.filter((observation) => !redundant.has(observation.id));
}

/**
 * IS THIS ROW A MEASUREMENT? ONE DEFINITION, FOR EVERYTHING THAT ASKS.
 *
 * A pending row whose value is a bare figure, in the two groups a figure can
 * arrive in: a `dimension` (the vocabulary recognised its label) or a `note`
 * (it did not, which on a shop drawing is most of them).
 *
 * ============================================================================
 * IT DELIBERATELY DOES NOT ASK FOR A UNIT, AND THAT IS THE WHOLE FIX.
 *
 * Four places each used to decide this for themselves, and all four required
 * `unit !== null`: `measuredRows` (which feeds the view guess), `dedupeMeasured`,
 * the card's fold, and the bulk-unit PATCH. On a page whose figures disagree
 * about magnitude -- S-201 prints 5, 27 and 42 beside 640 and 680, because most
 * figures on a shop drawing are COMPONENTS -- `suggestUnit` abstains, and on a
 * project with no `default_dimension_unit` the row is staged with no unit at
 * all. `unit: null` was then SELF-SEALING:
 *
 *   - no guess ran, so no W/D/H/SH was ever placed;
 *   - nothing was de-duplicated, so the front elevation's 5, 5, 27, 27 all
 *     showed;
 *   - nothing folded, so forty-four figures rendered inline;
 *   - the unit select did not render, the per-item mm/cm control did not
 *     render, and the bulk PATCH skipped the rows -- so there was no way to
 *     supply the unit that would have unlocked all of it.
 *
 * And the one step that exists to rescue a bad unit -- the overall-figures
 * correction inside `applyViewGuesses` -- could only REPLACE a unit, never
 * supply one, so it could not reach these rows either.
 *
 * A figure is a measurement because it is a figure. What unit it is in is the
 * NEXT question, and on these pages it is one only the overall figures can
 * answer. Keeping the two questions apart is what lets the second one be asked.
 * ============================================================================
 *
 * `parseDimensionFigure` accepts only a bare number (with an optional leading
 * or trailing TBC), so `O20`, `Room note: MUR 2 DESK CHAIR` and a merged block
 * of REMARKS are not measurements however they are grouped.
 */
export function isMeasuredRow(observation: DrawingObservation): boolean {
  if (observation.reviewStatus !== "pending") return false;
  if (observation.attrGroup !== "dimension" && observation.attrGroup !== "note") return false;
  return parseDimensionFigure(observation.value ?? observation.valueRaw).figure !== null;
}

/** Every pending row on an item that states a figure. */
export function measuredRows(item: DrawingItem): DrawingObservation[] {
  return item.observations.filter(isMeasuredRow);
}

/**
 * Place the overall W, D, H and SH on a page that labels its figures by view.
 *
 * READ TIME, NEVER WRITTEN BACK, exactly like `upgradeDimensionSlots` above and
 * for the same reasons — and with the same consequence, which is the point: the
 * eleven-document pack already staged in the sandbox gets this with no second
 * model call and nothing charged again.
 *
 * Every slot it sets is `slotSuggested: true`, so the card renders it as an
 * amber select with the composed cell beside it. See src/lib/dimension-guess.ts
 * for why the repetition across views is evidence and the magnitudes are not.
 *
 * IT NEVER SECOND-GUESSES A PLACED ROW. If any pending measured row on the item
 * already carries a slot — the staging vocabulary recognised a label, a
 * combined line was read, or a person chose one — the whole item is left alone.
 * A guess that filled the gaps around somebody's decision would be a guess
 * wearing their authority.
 */
function applyViewGuesses(doc: StagedDrawings): StagedDrawings {
  // Document level only: every early return below leaves its item untouched,
  // so this never has to be read per item the way `upgradeDimensionSlots` does.
  let anyTouched = false;
  const items = doc.items.map((item) => {
    const measured = measuredRows(item);
    if (measured.length === 0) return item;
    // ======================================================================
    // A PERSON'S SLOT IS UNTOUCHABLE. A PERSISTED GUESS IS NOT.
    //
    // This used to skip the item whenever ANY measured row carried a slot,
    // which was wrong for a reason that only shows up in use: the guess is
    // computed on read and never written back, but a PATCH writes the staged
    // doc as the server read it — so the first autosave on any row of the item
    // persists the guess. `S-201` was found holding W/H/D at
    // `slotSuggested: true`, saved by an unrelated edit, and from then on the
    // item was skipped: a corrected rule could never reach it, and the seat
    // height this pass added never appeared.
    //
    // `slotSuggested` is exactly the marker that tells them apart — the PATCH
    // route sets it FALSE whenever a person chooses a slot. So a decision is
    // left alone and a guess is re-made, which is what makes the guess
    // improvable instead of sticky.
    // ======================================================================
    if (measured.some((observation) => observation.dimensionSlot && !observation.slotSuggested)) return item;
    const { guesses } = guessSlotsFromViews(
      measured.map((observation) => ({
        id: observation.id,
        labelRaw: observation.labelRaw,
        value: observation.value ?? observation.valueRaw,
      })),
      // What the PAGE called it. An armchair with no seat height is a missing
      // measurement, and the record's category is a later decision an
      // uncategorised record has not made.
      item.itemNameRaw,
    );
    if (guesses.length === 0) return item;
    const slotOf = new Map(guesses.map((guess) => [guess.observationId, guess.slot]));

    // ======================================================================
    // AND NOW THE UNIT, FROM THE OVERALL FIGURES ONLY.
    //
    // `suggestUnit` abstains on a page whose figures disagree, and on a shop
    // drawing they always disagree: S-200 prints 5, 50, 100 and 125 beside
    // 840 and 790, because most figures on a shop drawing are COMPONENTS and
    // components are small whatever the page is drawn in. So every one of
    // those pages fell through to `projects.default_dimension_unit`, which is
    // `cm` because the specification SHEETS are in centimetres — and the real
    // AP364 set carries both conventions in one PDF.
    //
    // The result was an 840mm armchair recorded as 840cm, which
    // `composeDimensionCell` renders as `W8400mm`. Nothing flagged it: a
    // project default is not a guess the screen apologises for.
    //
    // The overall dimensions are the figures that carry the page's scale, and
    // this is the first point at which anything knows which they are. So
    // `suggestUnit` is asked again over JUST those, and it is the same rule in
    // the same order — the page's own figures agreeing — narrowed to the
    // figures the question is actually about. It only ever OVERRIDES the
    // project default: a unit the page printed is never touched, and neither
    // is one a person chose.
    // ======================================================================
    // WHICH ROWS MAY BE CORRECTED, AND FROM WHAT.
    //
    // Only a WEAK unit is replaced: `project_default` (the project answering a
    // question about a page) and `figures` (suggestUnit over the whole page,
    // where the components outvote the overall size). A unit the page PRINTED,
    // and one a person chose, are never touched — the resolution order in
    // CLAUDE.md, unchanged.
    //
    // It used to require EVERY placed row to be defaulted, and S-201 showed
    // why that is wrong: an earlier pass had already corrected its W, D and H
    // to mm, so when the seat height joined them still carrying the project's
    // `cm`, the all-or-nothing test refused and the cell composed
    // `SH4450mm` — a 4.5-metre seat height, which is the exact failure the
    // unit rule exists to prevent, reappearing through a half-corrected row
    // set. A row set must end up in ONE unit.
    //
    // AND A ROW WITH NO UNIT AT ALL IS THE WEAKEST OF THE LOT.
    //
    // It used to be unreachable instead. `measuredRows` required a unit, so a
    // page whose figures disagree about magnitude on a project with no default
    // never got here: no slots, no fold, no unit select, nothing. Now the
    // figures are placed first and the unit is asked afterwards, which is the
    // order the resolution rule in CLAUDE.md always described -- "the OVERALL
    // figures agreeing, once `applyViewGuesses` knows which they are" -- and
    // the only step that knows which figures are overall is this one.
    //
    // Supplying a unit here is therefore the SAME rule as correcting one, not a
    // new one: the page's own overall figures, agreeing. Where they do not
    // agree the row keeps no unit and the card asks for it in amber, which is
    // the existing `unit_missing` treatment and the honest answer.
    const placed = measured.filter((observation) => slotOf.has(observation.id));
    const weak = (observation: DrawingObservation) => {
      if (observation.unit === null) return true;
      const source = unitSourceOf(observation);
      return source === "project_default" || source === "figures";
    };
    // A printed unit anywhere in the set settles it: the page beats any
    // inference from magnitudes, which is the order the rule already states.
    const printed = placed.find((observation) => unitSourceOf(observation) === "printed")?.unit ?? null;
    const overall = suggestUnit(placed.map((observation) => observation.value ?? observation.valueRaw));
    const unitFix = printed ?? (placed.length > 0 && overall.status === "confident" ? overall.unit : null);

    anyTouched = true;
    return {
      ...item,
      observations: item.observations.map((observation) => {
        const slot = slotOf.get(observation.id);
        if (!slot) {
          // A slot this guess no longer makes, left behind by an earlier one
          // that an autosave persisted. Cleared, or the row would keep a
          // reading nothing now stands behind.
          return observation.dimensionSlot && observation.slotSuggested
            ? { ...observation, attrGroup: "note" as AttributeGroup, dimensionSlot: null, slotSuggested: false }
            : observation;
        }
        return {
          ...observation,
          attrGroup: "dimension" as AttributeGroup,
          dimensionSlot: slot,
          slotSuggested: true,
          ...(unitFix && weak(observation)
            ? { unit: unitFix, unitSuggested: true, unitSource: "figures" as UnitSource }
            : {}),
        };
      }),
    };
  });
  return anyTouched ? { ...doc, items } : doc;
}

/**
 * Which configuration each card is, when a code is drawn more than once.
 *
 * ============================================================================
 * THE SAME CODE ON SEVERAL PAGES IS SEVERAL THINGS TO MAKE.
 *
 * The AP364 set draws S-201 on pages 5 and 6 with identical geometry and
 * different fabric and timber callouts, S-200 on 3 and 4, and S-301 on four
 * pages. The bill has ONE line each. So each page is a CONFIGURATION, and the
 * letter is what a person calls it: S-201 A, S-201 B.
 *
 * DERIVED, NEVER STORED, AND NEVER SENT BY THE CLIENT. The letter is a pure
 * function of the staged document, so the review screen and the confirm route
 * reach the same answer without either telling the other — the same reason
 * `proposalBlockers()` is computed in both places. A letter travelling on the
 * request would be a client saying which record its data belongs to, which is
 * the one thing `blob-source.ts` exists to refuse.
 *
 * ORDER IS PAGE ORDER, and it ignores review state. A page somebody ignored
 * still consumes its letter: if dismissing page 5 turned page 6 from B into A,
 * every letter anybody had written down would mean something else. Same reason
 * `nextVariantLabel` never reuses a retired variant's letter.
 *
 * A code drawn ONCE gets no letter at all, and that is most of any pack — it is
 * one item, it stays one record, and nothing about it changes.
 * ============================================================================
 */
/**
 * The occupancy a card is really writing into, still keyed by the record the
 * reviewer ticked.
 *
 * ============================================================================
 * WHY THE KEYS MUST STAY THE PARENT'S.
 *
 * A card for a code drawn twice writes to a VARIANT (`S-201 A`), but the
 * reviewer ticked a RUN and what they ticked is the bill's record. Every screen
 * contract downstream is keyed on that: the "tick to replace" acknowledgement
 * stored in `observation.replaces`, the run checkboxes, `item.targets.ticked`.
 *
 * So this re-keys rather than re-points: `fields.get(parentId)` returns the
 * VARIANT's occupied slots. `drawingItemBlockers` and `occupantsFor` then work
 * unchanged and keep reporting parent ids, and two things come out right for
 * free — a variant that does not exist yet shows NO occupants (there is
 * nothing there to replace, which is the truth), and re-confirming a page over
 * an existing variant shows that variant's own values rather than the bill
 * record's, which is empty because a split parent is a heading.
 *
 * Passing the variant ids straight through instead would make the card offer to
 * replace a value on a record the reviewer never saw named.
 * ============================================================================
 */
export function occupancyThrough(occupied: OccupiedSlots, writeTo: ReadonlyMap<string, string>): OccupiedSlots {
  if (writeTo.size === 0) return occupied;
  const fields = new Map(occupied.fields);
  const dimensions = new Map(occupied.dimensions);
  for (const [parentId, variantId] of writeTo) {
    if (parentId === variantId) continue;
    const field = occupied.fields.get(variantId);
    if (field) fields.set(parentId, field);
    else fields.delete(parentId);
    const dimension = occupied.dimensions.get(variantId);
    if (dimension) dimensions.set(parentId, dimension);
    else dimensions.delete(parentId);
  }
  return { fields, dimensions };
}

/**
 * The pages of one staged run, grouped by the code they carry.
 *
 * THE SAME FOLD THE RESOLVER MATCHES BY — `spec-document`'s, the one
 * `findRecordsByRef` uses, and NOT `boq-import`'s looser one. Two cards that
 * group here as one code must resolve to the same records, or the grouping
 * would describe something the confirm does not share.
 *
 * EXPORTED because the lettering and the review screen's card grouping are the
 * same question, and they used to answer it differently: the letters folded
 * the code and the screen's heading compared `itemCodeRaw` raw, so `S-201` and
 * `s 201` were lettered A and B and then printed under two separate headings.
 * A code with no letter is one drawn once; a card with no group is one page.
 * Both fall out of this, and neither can drift from the other now.
 *
 * Page order within a group, then id, so two pages reported without a page
 * number still land in a fixed order rather than whatever the model listed.
 * A page with no code at all is not in any group: it is its own card, and it
 * can never commit.
 */
/**
 * The code an item is KNOWN BY, which is not always the code its page is headed
 * with.
 *
 * Panther's S-200 is headed `S-200` on its specification sheet and
 * `MUR.2 ARMCHAIR` in the shop drawing's title block. Both are what the page
 * says and both are staged as such — but the bill of quantities says S-200, so
 * that is the code the two pages group under and the code the records resolve
 * against. A `codeGroup` names every title its pages carry and puts the bill's
 * one first; without that the shop drawing is an item nothing can place, which
 * is what the first version 2 read produced.
 *
 * Version 1 has no groups and every page is known by its own heading.
 */
/**
 * The code groups on a staged document, TOLERANTLY.
 *
 * `assertStagedDrawings` casts rather than validates, so a staged document is
 * whatever was written on the day it was staged — and this one has already
 * changed shape once. The first version 2 read of S-200 stored
 * `{ itemCodeRaw: "S-200 / MLR 2 ARMCHAIR" }`; an hour later the field was
 * `itemCodes: string[]`, because one string cannot name a group whose pages
 * title the item differently. TypeScript says the old rows do not exist and the
 * database says otherwise, and the app crashed reading them.
 *
 * A group this cannot make sense of is DROPPED, not repaired: the consequence
 * is an item left whole and a reviewer asked, which is the safe end of this
 * question. Guessing a code out of a compound string would be a new inference,
 * in the function whose whole point is that there are none left.
 */
function codeGroupsOf(doc: Pick<StagedDrawings, "schemaVersion" | "codeGroups"> | undefined): StagedCodeGroup[] {
  if (!doc || !readByModel(doc)) return [];
  const groups: StagedCodeGroup[] = [];
  for (const group of doc.codeGroups ?? []) {
    const codes = Array.isArray(group?.itemCodes)
      ? group.itemCodes.filter((code): code is string => typeof code === "string" && code.trim() !== "")
      : [];
    if (codes.length === 0) continue;
    groups.push({ ...group, itemCodes: codes });
  }
  return groups;
}

export function canonicalCode(
  doc: Pick<StagedDrawings, "schemaVersion" | "codeGroups"> | undefined,
  itemCodeRaw: string | null,
): string | null {
  const raw = (itemCodeRaw ?? "").trim();
  if (!raw) return null;
  const folded = normaliseRef(raw);
  for (const group of codeGroupsOf(doc)) {
    if (group.itemCodes.some((code) => normaliseRef(code) === folded)) {
      return group.itemCodes[0] ?? raw;
    }
  }
  return raw;
}

export function groupItemsByCode(
  items: readonly DrawingItem[],
  doc?: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
): Map<string, DrawingItem[]> {
  const byCode = new Map<string, DrawingItem[]>();
  for (const item of items) {
    const code = normaliseRef(canonicalCode(doc, item.itemCodeRaw) ?? "");
    if (!code) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), item]);
  }
  for (const [code, group] of byCode) {
    byCode.set(
      code,
      [...group].sort(
        (a, b) => (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
      ),
    );
  }
  return byCode;
}

/**
 * Which pages are CONFIGURATIONS of an item, and which are just more pages
 * about it.
 *
 * ============================================================================
 * THIS USED TO COUNT PAGES, AND A PAGE COUNT IS NOT EVIDENCE OF ANYTHING.
 *
 * Two pages carrying one code became `S-200 A` and `S-200 B`. 0024 then makes
 * the bill line a HEADING that stops exporting and ships each letter to BWS as
 * its own job — so one armchair, drawn on its specification sheet and again on
 * its shop drawing, became two things to manufacture. Measured on the sandbox
 * before this changed: 15 groups, 38 items lettered.
 *
 * It cannot be recovered by comparing the pages afterwards either, and that was
 * measured rather than argued. Panther's S-200 states `Tibor Blob Amber Fern`
 * on one page and `CLO003 A = Tibor Blob Amber Fern` on the other — same chair,
 * same cloth, two vocabularies. Comparing the CODES calls it a split; comparing
 * the DESCRIPTIONS calls it a split too, because one page adds "as per approved
 * sample". Both miss the case a person settles in two seconds by looking.
 *
 * So the MODEL says, with its evidence, and only `configurations` letters
 * anything. `unclear` and `one_item` both letter nothing, because they are the
 * two answers that leave the item whole — and an item wrongly left whole shows
 * up as one card with more specs on it, where an item wrongly split becomes
 * separate jobs in a file that replaces rather than merges.
 *
 * A VERSION 1 RUN HAS NO ANSWER, and keeps the page count until it is re-read.
 * Changing what those runs mean underneath a reviewer would be worse than
 * leaving them as they were staged.
 * ============================================================================
 */
export function variantLettersByItem(
  items: readonly DrawingItem[],
  doc?: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
): Map<string, string | null> {
  const byCode = groupItemsByCode(items, doc);
  const letters = new Map<string, string | null>();
  // Keyed the way the group is — on the canonical code, folded — so `S-201` and
  // `s 201` cannot be looked up differently from the way they were grouped.
  const relationship = new Map<string, StagedCodeGroup["relationship"]>();
  for (const group of codeGroupsOf(doc)) {
    relationship.set(normaliseRef(group.itemCodes[0] ?? ""), group.relationship);
  }
  const version2 = readByModel(doc);
  // A v3 code whose pages NAME configurations is split by those names, not by
  // page — see `namedConfigurationPlans`. Its pages get no letter here.
  const named = namedConfigurationsByCode(items, doc);

  for (const [code, ordered] of byCode) {
    const group = ordered;
    if (named.has(code)) {
      for (const item of group) letters.set(item.id, null);
      continue;
    }
    // THE REVIEWER'S answer first, on any version (brief C1): the manual
    // version of `codeGroups.relationship`, for the pages the model got wrong.
    const byReviewer = reviewerOverride(group, (item) =>
      item.relationshipByReviewer === "one_item" || item.relationshipByReviewer === "configurations"
        ? item.relationshipByReviewer
        : null,
    );
    const splits = byReviewer
      ? byReviewer === "configurations"
      : version2
        ? relationship.get(code) === "configurations"
        : group.length >= 2;
    if (group.length < 2 || !splits) {
      for (const item of group) letters.set(item.id, null);
      continue;
    }
    ordered.forEach((item, index) => {
      letters.set(item.id, nextVariantLabel(ordered.slice(0, index).map((earlier) => letters.get(earlier.id) ?? null)));
    });
  }
  return letters;
}

// ============================================================================
// CONFIGURATIONS A DOCUMENT NAMES (schemaVersion 3, 2026-09-23).
//
// Panther's S-301 sheet prints "FABRIC REFERENCE  As per room type: Type 1 & 5
// - …, Type 2 - …, Type 3 - … ; Type 4 - …" beside ONE set of overall
// dimensions. That is five chairs to make — one per room type, Max's decision
// of 2026-09-23 — sharing a shape and differing in cloth. A page count cannot
// say so (it is one page), and neither can `codeGroups.relationship`, which
// describes PAGES: S-301's sheet and its shop drawing are still `one_item`.
//
// So a v3 code whose pages NAME configurations is split by those names, and
// they REPLACE page lettering for that code: the variants are `S-301 TYPE 1`
// … `S-301 TYPE 5`, never `S-301 A`. Every other code — v1, v2, and a v3 code
// naming none — keeps `variantLettersByItem` exactly as it was.
//
// PURE, NEVER STORED, CALLED BY THE CARD AND THE CONFIRM: which record a row
// lands on is the most consequential thing on the card, and two readings of it
// would be a card promising one set of chairs while the confirm makes another.
//
// READ THROUGH THE THREE ACCESSORS BELOW, NEVER THE FIELDS. A reviewer's own
// correction of a configuration (brief C1) is staged beside the model's
// reading, and these are the one place that decides which of the two counts.
// ============================================================================

/** The configurations a page names, as they count today. */
export function pageConfigurations(item: Pick<DrawingItem, "configurations">): StagedConfiguration[] {
  if (!Array.isArray(item.configurations)) return [];
  return item.configurations.filter(
    (entry): entry is StagedConfiguration =>
      Boolean(entry) && typeof entry === "object" && typeof entry.name === "string" && entry.name.trim() !== "",
  );
}

/** Which configurations a page shows, as they count today. */
export function pageDepicts(item: Pick<DrawingItem, "depictsConfigurations">): string[] {
  return Array.isArray(item.depictsConfigurations)
    ? item.depictsConfigurations.filter((name): name is string => typeof name === "string" && name.trim() !== "")
    : [];
}

/** Which configurations a row names, as they count today. */
export function rowConfigurations(observation: Pick<DrawingObservation, "configurations">): string[] {
  return Array.isArray(observation.configurations)
    ? observation.configurations.filter((name): name is string => typeof name === "string" && name.trim() !== "")
    : [];
}

/** One configuration of a CODE: its stored label, and how the pages named it. */
export type NamedConfiguration = {
  /** Folded, as `spec_records.variant_label` stores it: `TYPE 2`. */
  label: string;
  /** The model's name for it, from the first page that named it: `Type 2`, `MUR 2`. */
  name: string;
  /** Every wording the pages used for it, in page order: `Type 1 & 5`, `TYPO 5`. */
  namesRaw: string[];
  evidence: string | null;
  /** The pages that name it. */
  pages: number[];
  /**
   * The model's label this stands for — itself, unless a reviewer renamed it —
   * or null for one a reviewer added. Optional so a hand-built list reads.
   */
  readAs?: string | null;
};

/**
 * The first page of a code, in page order, that carries a reviewer's value —
 * the one every page reads, so pages that disagree (a save that reached one
 * page and not the next) still agree about what the card says.
 */
function reviewerOverride<T>(pages: readonly DrawingItem[], read: (item: DrawingItem) => T | null | undefined): T | null {
  for (const item of pages) {
    const value = read(item);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/** The reviewer's configuration list, read defensively off staged JSON. */
function reviewerConfigurationList(item: DrawingItem): { label: string; readAs: string | null }[] | null {
  const list = item.configurationsByReviewer;
  if (!Array.isArray(list)) return null;
  const out: { label: string; readAs: string | null }[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || typeof entry.label !== "string") continue;
    const label = normaliseVariantLabel(entry.label);
    if (!label || out.some((kept) => kept.label === label)) continue;
    out.push({ label, readAs: typeof entry.readAs === "string" ? normaliseVariantLabel(entry.readAs) : null });
  }
  return out;
}

/** A code's configurations: what the model read, what counts, and how one maps to the other. */
export type CodeConfigurations = {
  /** As the MODEL read them (schemaVersion 3), or none. */
  read: NamedConfiguration[];
  /** As they count today — the reviewer's list where there is one. */
  effective: NamedConfiguration[];
  /** Model label -> the effective label it became. Absent: it was removed. */
  rename: Map<string, string>;
  /** Model labels the reviewer removed. */
  removed: string[];
  /** Did a reviewer set this list? */
  edited: boolean;
  /**
   * The pages NAME configurations and give them nothing different — every row
   * lands on all of them — so the code is read as ONE ITEM and `effective` is
   * empty. S-100's shop drawing is titled "SOFA MUR 1 & TYPO 5": that says
   * which rooms the drawing is for, not that there are two sofas. A reviewer's
   * own list overrides it.
   */
  undistinguished: boolean;
};

/**
 * DO THESE NAMED CONFIGURATIONS DIFFER IN ANYTHING?
 *
 * A configuration exists only where the document gives it something different.
 * The test is structural and needs no reading of values: at least one row, on
 * any page of the code, lands on a STRICT SUBSET of the named configurations —
 * its own names, or the ones its page depicts. S-301's fabric rows land on
 * {Type 1, Type 5}, {Type 2}, {Type 3} and {Type 4}: five chairs. S-100's rows
 * all land on both names its title block gives: one sofa, and two identical
 * BWS jobs out of it would be the page-count trap in a new form.
 *
 * Every row counts, whatever its review state, so ignoring one cannot turn a
 * split card into one item halfway through a review. ONE FUNCTION, behind
 * `codeConfigurations` — which the grouping, the card, the confirm and
 * `variantLettersByItem` all read.
 */
export function configurationsDistinguishSomething(pages: readonly DrawingItem[], labels: readonly string[]): boolean {
  if (labels.length < 2) return labels.length === 1;
  const known = new Set(labels);
  return pages.some((item) => {
    const depicted = foldedNames(pageDepicts(item)).filter((label) => known.has(label));
    const fallback = depicted.length > 0 ? depicted : labels;
    return item.observations.some((observation) => {
      const own = foldedNames(rowConfigurations(observation)).filter((label) => known.has(label));
      const lands = own.length > 0 ? own : fallback;
      return lands.length > 0 && lands.length < labels.length;
    });
  });
}

/**
 * Per canonical folded code, the configurations as READ and as they COUNT.
 *
 * The model's reading exists only on a version 3 run. A REVIEWER'S list counts
 * on any version (brief C1): a person who knows a v1 or v2 card is five chairs
 * can say so, and the card and the confirm then read it through the same
 * functions as a v3 reading. A v1 or v2 code nobody has touched reads exactly
 * as it always did — nothing here runs for it.
 */
export function codeConfigurations(
  items: readonly DrawingItem[],
  doc?: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
): Map<string, CodeConfigurations> {
  const out = new Map<string, CodeConfigurations>();
  for (const [code, pages] of groupItemsByCode(items, doc)) {
    const read: NamedConfiguration[] = [];
    if (doc?.schemaVersion === 3) {
      const add = (name: string, nameRaw: string | null, evidence: string | null, page: number | null) => {
        const label = normaliseVariantLabel(name);
        if (!label) return;
        let entry = read.find((existing) => existing.label === label);
        if (!entry) {
          entry = { label, name: name.trim(), namesRaw: [], evidence, pages: [], readAs: label };
          read.push(entry);
        }
        const raw = (nameRaw ?? "").trim();
        if (raw && !entry.namesRaw.includes(raw)) entry.namesRaw.push(raw);
        if (!entry.evidence && evidence) entry.evidence = evidence;
        if (page !== null && !entry.pages.includes(page)) entry.pages.push(page);
      };
      for (const item of pages) {
        for (const entry of pageConfigurations(item)) add(entry.name, entry.nameRaw, entry.evidence, item.page);
        // A title block naming the ones it shows is the page naming them too.
        for (const name of pageDepicts(item)) add(name, null, null, item.page);
      }
    }
    const override = reviewerOverride(pages, reviewerConfigurationList);
    if (!override) {
      if (read.length > 0) {
        const distinguished = configurationsDistinguishSomething(
          pages,
          read.map((entry) => entry.label),
        );
        out.set(code, {
          read,
          effective: distinguished ? read : [],
          rename: new Map(read.map((entry) => [entry.label, entry.label])),
          removed: [],
          edited: false,
          undistinguished: !distinguished,
        });
      }
      continue;
    }
    const rename = new Map<string, string>();
    const effective: NamedConfiguration[] = override.map((entry) => {
      const source = entry.readAs ? read.find((model) => model.label === entry.readAs) : undefined;
      if (source) rename.set(source.label, entry.label);
      return {
        label: entry.label,
        name: entry.label,
        namesRaw: source?.namesRaw ?? [],
        evidence: source?.evidence ?? null,
        pages: source?.pages ?? [],
        readAs: source ? source.label : null,
      };
    });
    const removed = read.map((entry) => entry.label).filter((label) => !rename.has(label));
    out.set(code, { read, effective, rename, removed, edited: true, undistinguished: false });
  }
  return out;
}

/**
 * Per canonical folded code, the configurations as they COUNT — the model's
 * reading on a version 3 run, the reviewer's list wherever one is set, in page
 * order. A code with none is absent, and that is the test for "letter by page
 * as before".
 */
export function namedConfigurationsByCode(
  items: readonly DrawingItem[],
  doc?: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
): Map<string, NamedConfiguration[]> {
  const out = new Map<string, NamedConfiguration[]>();
  for (const [code, entry] of codeConfigurations(items, doc)) {
    if (entry.effective.length > 0) out.set(code, entry.effective);
  }
  return out;
}

/**
 * "Read as 4, you set 5 — added TYPE 6; renamed TYP.O to TYPO 5; removed
 * TYPE 9." Null when nobody has edited the list. The model's reading stays in
 * the staged JSON beside the reviewer's; this is how the card says so.
 */
export function configurationEditSummary(entry: CodeConfigurations | undefined): string | null {
  if (!entry?.edited) return null;
  const parts: string[] = [];
  const added = entry.effective.filter((configuration) => configuration.readAs === null).map((c) => c.label);
  const renamed = [...entry.rename].filter(([from, to]) => from !== to).map(([from, to]) => `${from} to ${to}`);
  if (added.length) parts.push(`added ${added.join(", ")}`);
  if (renamed.length) parts.push(`renamed ${renamed.join(", ")}`);
  if (entry.removed.length) parts.push(`removed ${entry.removed.join(", ")}`);
  const head =
    entry.read.length === 0
      ? `The document names no configurations; you set ${entry.effective.length}`
      : `Read as ${entry.read.length}, you set ${entry.effective.length}`;
  return parts.length ? `${head} — ${parts.join("; ")}.` : `${head}.`;
}

/** Where one page of a named code lands, row by row. */
export type NamedConfigurationPlan = {
  /** The folded code. */
  code: string;
  /** Every configuration of the CODE, in page order. */
  configurations: NamedConfiguration[];
  /**
   * The folded labels this PAGE writes to: every configuration one of its
   * pending rows lands on, and every one the page itself names — a
   * configuration with no row of its own still gets the shared geometry, and
   * it is still a thing to make. In the code's order.
   */
  labels: string[];
  /**
   * Per observation on the page: the folded labels it lands on — its own
   * configurations, else the ones the page depicts, else all of the code's.
   * That is the fan-out for one row, per phase.
   */
  rows: Record<string, string[]>;
  /**
   * Pending rows that belonged ONLY to configurations a reviewer removed, and
   * have not been given new ones. They land nowhere, and each is a blocker
   * until somebody says where it goes — never silently shared, never dropped.
   */
  undecided: string[];
};

/**
 * Per item of a v3 run whose code names configurations, the plan. Absent for
 * every other item — which is how every caller tells "named" from "lettered".
 */
export function namedConfigurationPlans(
  items: readonly DrawingItem[],
  doc?: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
): Map<string, NamedConfigurationPlan> {
  const out = new Map<string, NamedConfigurationPlan>();
  const byCode = codeConfigurations(items, doc);
  if (byCode.size === 0) return out;
  for (const [code, pages] of groupItemsByCode(items, doc)) {
    const entry = byCode.get(code);
    if (!entry || entry.effective.length === 0) continue;
    const configurations = entry.effective;
    const order = configurations.map((configuration) => configuration.label);
    const known = new Set(order);
    // In the code's order, whatever order the page listed them in.
    const ordered = (labels: Iterable<string>) => {
      const set = new Set(labels);
      return order.filter((label) => set.has(label));
    };
    // A MODEL label, as it counts today: renamed, or gone.
    const mapped = (labels: readonly string[]) =>
      labels.map((label) => entry.rename.get(label)).filter((label): label is string => Boolean(label));
    for (const item of pages) {
      const depicted = ordered(mapped(foldedNames(pageDepicts(item))));
      const fallback = depicted.length > 0 ? depicted : order;
      const rows: Record<string, string[]> = {};
      const undecided: string[] = [];
      const written = new Set<string>(ordered(mapped(itemConfigurationLabels(item))));
      for (const observation of item.observations) {
        let targets: string[];
        const byReviewer = observation.configurationsByReviewer;
        if (Array.isArray(byReviewer)) {
          // THE REVIEWER SAID. `[]` is "shared by every configuration".
          const own = ordered(foldedNames(byReviewer).filter((label) => known.has(label)));
          targets = byReviewer.length === 0 ? order : own;
        } else {
          const read = foldedNames(rowConfigurations(observation));
          const own = ordered(mapped(read).filter((label) => known.has(label)));
          // A name the code never knew is dropped and the row reads as shared —
          // the schema's own rule, for staged JSON from the past. A name a
          // REVIEWER removed is different: the row was about that chair, and
          // sharing it with the others would put its fabric on them.
          const allRemoved = read.length > 0 && own.length === 0 && read.some((label) => entry.removed.includes(label));
          targets = own.length > 0 ? own : allRemoved ? [] : fallback;
        }
        if (targets.length === 0 && observation.reviewStatus === "pending") undecided.push(observation.id);
        rows[observation.id] = targets;
        if (observation.reviewStatus === "pending") for (const label of targets) written.add(label);
      }
      out.set(item.id, { code, configurations, labels: ordered(written), rows, undecided });
    }
  }
  return out;
}

/**
 * The live configurations of each bill line: parent id -> folded label ->
 * variant id. Active variants only — a retired one is not somewhere to write.
 */
export type ParentVariants = ReadonlyMap<string, ReadonlyMap<string, string>>;

export function parentVariantsOf(records: readonly Pick<RecordEntry, "id" | "parentId" | "variantLabel">[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const record of records) {
    if (!record.parentId || !record.variantLabel) continue;
    const map = out.get(record.parentId) ?? new Map<string, string>();
    map.set(normaliseVariantLabel(record.variantLabel), record.id);
    out.set(record.parentId, map);
  }
  return out;
}

/** What the card needs to hand the blockers for a named page. */
export type NamedTargets = {
  plan: NamedConfigurationPlan;
  variants: ParentVariants;
  /** The page's `configurationPairs` (and legacy acks, as "create new"). */
  pairs?: readonly ConfigurationPair[];
  /** The document's `configurationLinks`. */
  links?: readonly ConfigurationLink[];
  /** THIS PAGE'S own words for each configuration (folded label -> nameRaw). */
  pageNamesRaw?: Readonly<Record<string, string[]>>;
  /**
   * The live variants THIS DOCUMENT already wrote to (its links, and any
   * variant holding an attribute from this run). Creating beside those asks
   * nothing: a document is never asked to pair with itself.
   */
  own?: ReadonlySet<string>;
};

/** A reviewer's pairing, read: the existing configurations it IS (one or more), or null for "a new one". */
export type ConfigurationPair = { recordId: string; label: string; pairWith: string[] | null };

/** A page's pairing decisions, with the pre-step-5 acknowledgements read as "create new". */
export function pairsOf(item: Pick<DrawingItem, "configurationPairs" | "configurationAcks">): ConfigurationPair[] {
  const out: ConfigurationPair[] = [];
  for (const pair of Array.isArray(item.configurationPairs) ? item.configurationPairs : []) {
    if (!pair || typeof pair.recordId !== "string" || typeof pair.label !== "string") continue;
    const raw = (pair as { pairWith?: unknown }).pairWith;
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : null;
    const pairWith = list
      ? [...new Set(list.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map(normaliseVariantLabel))]
      : null;
    out.push({
      recordId: pair.recordId,
      label: normaliseVariantLabel(pair.label),
      pairWith: pairWith && pairWith.length > 0 ? pairWith : null,
    });
  }
  for (const ack of Array.isArray(item.configurationAcks) ? item.configurationAcks : []) {
    if (!ack || typeof ack.recordId !== "string" || typeof ack.label !== "string") continue;
    const label = normaliseVariantLabel(ack.label);
    if (!out.some((pair) => pair.recordId === ack.recordId && pair.label === label)) {
      out.push({ recordId: ack.recordId, label, pairWith: null });
    }
  }
  return out;
}

/**
 * The live variants a document already wrote to: its links, and every variant
 * holding an attribute from this run (`sourcesByVariant`: variant id -> run ids).
 */
export function ownVariantsOf(
  doc: Pick<StagedDrawings, "configurationLinks"> | undefined,
  runId: string | null,
  sourcesByVariant: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): Set<string> {
  const own = new Set<string>();
  for (const link of Array.isArray(doc?.configurationLinks) ? doc!.configurationLinks : []) {
    if (link && typeof link.variantId === "string") own.add(link.variantId);
  }
  if (runId && sourcesByVariant) {
    for (const [variantId, runs] of sourcesByVariant) if (runs.has(runId)) own.add(variantId);
  }
  return own;
}

/** The NamedTargets for one page: its plan, the live variants, its pairings and its document's links. */
export function namedTargetsFor(
  item: DrawingItem,
  plan: NamedConfigurationPlan,
  variants: ParentVariants,
  doc: Pick<StagedDrawings, "configurationLinks"> | undefined,
  own?: ReadonlySet<string>,
): NamedTargets {
  const pageNamesRaw: Record<string, string[]> = {};
  for (const entry of pageConfigurations(item)) {
    const raw = (entry.nameRaw ?? "").trim();
    if (!raw) continue;
    const label = normaliseVariantLabel(entry.name);
    pageNamesRaw[label] = [...(pageNamesRaw[label] ?? []), raw];
  }
  return {
    plan,
    variants,
    pairs: pairsOf(item),
    links: Array.isArray(doc?.configurationLinks) ? doc!.configurationLinks : [],
    pageNamesRaw,
    own: own ?? ownVariantsOf(doc, null, undefined),
  };
}

/**
 * A PAGE LETTER, AS A PLAN OF ONE CONFIGURATION.
 *
 * `S-301 A` on the drawing set is a configuration the confirm would CREATE,
 * exactly as `TYPE 2` is — and the guard against creating one beside a bill
 * line's existing configurations has to cover it: S-301 already held TYPE 1–5
 * from the specification sheet, and "Confirm S-301 (4 configurations)" was
 * enabled with no question, which would have made nine configurations and four
 * duplicate BWS jobs. So a lettered page reads through the same pair-or-create
 * path: one label (its letter), every row landing on it.
 */
export function letteredPlan(item: DrawingItem, letter: string): NamedConfigurationPlan {
  const label = normaliseVariantLabel(letter);
  const rows: Record<string, string[]> = {};
  for (const observation of item.observations) rows[observation.id] = [label];
  return {
    code: normaliseRef(item.itemCodeRaw ?? ""),
    configurations: [{ label, name: label, namesRaw: [], evidence: null, pages: item.page ? [item.page] : [], readAs: label }],
    labels: [label],
    rows,
    undecided: [],
  };
}

/** Where one configuration of a page lands on one bill line. */
export type ConfigurationTarget =
  | {
      kind: "existing";
      /** One or more: a page the reviewer says IS TYPE 1 and TYPE 5 writes to both. */
      variantIds: string[];
      /** The existing configurations' labels — what the records are called. */
      as: string[];
      via: "linked" | "exact" | "paired";
    }
  | { kind: "create"; via: "first" | "chosen" }
  | {
      kind: "ask";
      /** The page's own words for it, and the name it was read as. */
      namesRaw: string[];
      /** The bill line's live configurations, to pair with. */
      existing: string[];
      /** A live configuration already has this label, so "create new" needs a rename first. */
      collides: boolean;
    };

/**
 * WHERE A CONFIGURATION LANDS, when the bill line may already have some (plan
 * step 5). One pure function behind the blockers, the occupancy lookups, the
 * card and the confirm — for a NAMED configuration and a page LETTER alike —
 * in this order:
 *
 *   1. LINKED   this document already created or paired it (page 1 of the same
 *               sheet, or a variant holding this run's attributes): the same
 *               record, no question.
 *   2. PAIRED   the reviewer chose — one or more existing configurations, or
 *               "new".
 *   3. FIRST    the bill line has no configurations from ANOTHER source: create.
 *   4. EXACT    the PAGE'S OWN WORDS, folded for case and whitespace only,
 *               are an existing configuration's name: `Type 3` is `TYPE 3`.
 *   5. ASK      anything else. "MUR 1" read as "Type 1" is NOT exact: the model
 *               translated, and nobody yet knows that MUR 1 is Type 1 — the
 *               app must not decide it. `TYPO 3` is not `TYPE 3` either, and a
 *               page letter matches nothing.
 */
export function configurationTarget(parentId: string, label: string, named: NamedTargets): ConfigurationTarget {
  const live = named.variants.get(parentId) ?? new Map<string, string>();
  const liveIds = new Set(live.values());
  const own = named.own ?? new Set<string>();
  const nameOf = (variantId: string) => [...live].find(([, id]) => id === variantId)?.[0] ?? label;
  const linked = (named.links ?? [])
    .filter((entry) => entry.recordId === parentId && entry.label === label && liveIds.has(entry.variantId))
    .map((entry) => entry.variantId);
  if (linked.length === 0 && live.has(label) && own.has(live.get(label)!)) linked.push(live.get(label)!);
  if (linked.length > 0) {
    const variantIds = [...new Set(linked)];
    return { kind: "existing", variantIds, as: variantIds.map(nameOf), via: "linked" };
  }
  const collides = live.has(label);
  const pair = (named.pairs ?? []).find((entry) => entry.recordId === parentId && entry.label === label);
  if (pair) {
    const chosen = (pair.pairWith ?? []).filter((entry) => live.has(entry));
    if (chosen.length > 0) {
      return { kind: "existing", variantIds: chosen.map((entry) => live.get(entry)!), as: chosen, via: "paired" };
    }
    if (pair.pairWith === null && !collides) return { kind: "create", via: "chosen" };
  }
  // Configurations from ANOTHER source. This document's own are not a reason to ask.
  const others = [...live].filter(([, id]) => !own.has(id));
  if (others.length === 0) return { kind: "create", via: "first" };
  const configuration = named.plan.configurations.find((entry) => entry.label === label);
  // The page's own words where this page gave some; the document's otherwise.
  const namesRaw = named.pageNamesRaw?.[label]?.length ? named.pageNamesRaw[label]! : (configuration?.namesRaw ?? []);
  const exact = namesRaw.map((raw) => normaliseVariantLabel(raw)).find((folded) => live.has(folded));
  if (exact) return { kind: "existing", variantIds: [live.get(exact)!], as: [exact], via: "exact" };
  return { kind: "ask", namesRaw, existing: naturalConfigurationOrder([...live.keys()]), collides };
}

/**
 * The records ONE ROW writes into that exist today: per ticked bill line, the
 * live variant of each configuration the row lands on. A configuration not
 * created yet contributes nothing, which is the truth — there is nothing there
 * to replace.
 *
 * For a page that names no configurations this is simply the ticked records,
 * which is what every blocker and every occupant lookup used before.
 */
export function rowWriteRecords(observationId: string, targets: readonly string[], named: NamedTargets | null): string[] {
  if (!named) return [...targets];
  // `?? labels` only for a row the plan never saw. A row with NO targets (its
  // configurations were removed) lands nowhere, and a blocker says so.
  const labels = named.plan.rows[observationId] ?? named.plan.labels;
  const out: string[] = [];
  for (const parentId of targets) {
    for (const label of labels) {
      const target = configurationTarget(parentId, label, named);
      if (target.kind !== "existing") continue;
      for (const variantId of target.variantIds) if (!out.includes(variantId)) out.push(variantId);
    }
  }
  return out;
}

/** What a page of named configurations will CREATE, per bill line: the labels with no live variant yet. */
export function configurationsToCreate(targets: readonly string[], named: NamedTargets): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const parentId of targets) {
    out.set(
      parentId,
      named.plan.labels.filter((label) => configurationTarget(parentId, label, named).kind === "create"),
    );
  }
  return out;
}

/**
 * A finish's words, folded so that only WHICH words it uses remains: case and
 * punctuation gone, and the words SORTED, as a multiset (a word said twice
 * counts twice). Empty where there are no words.
 *
 * Plan any-bill, step 4. S-301's specification sheet and its shop drawing name
 * one cloth in two orders — "maker, pattern - raffia, col. colour" and "maker
 * colour, raffia, pattern" — and a rule that compared the client's CODE alone
 * called every such pair a clash. Word order and punctuation are how a caption
 * is laid out, not what it says. What is NOT folded is anything that changes a
 * word: one token more, fewer or different is a different statement, and the
 * reviewer decides it — `Ref.` printed on one page and not the other is
 * exactly the near miss that must still ask.
 */
export function finishWordsKey(text: string | null | undefined): string {
  return (text ?? "")
    .toLocaleLowerCase("en-GB")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * ONE FINISH, stated twice? By the client's code where BOTH carry one (and
 * two different codes are two finishes, whatever the words), otherwise by the
 * same words in any order. A code on one side only does not decide it either
 * way: on the Panther pack `CH-01.1` is a POSITION, shared by four cloths.
 *
 * One function, three callers: `crossPageClaims` (the card folds the later
 * row), `alreadyRecorded` (the confirm writes nothing over the same finish),
 * and through them the blockers — so the screen and the confirm agree.
 */
export function sameFinish(
  a: { code: string | null | undefined; words: string | null | undefined },
  b: { code: string | null | undefined; words: string | null | undefined },
): boolean {
  const codeA = normaliseFinishCode(a.code ?? "");
  const codeB = normaliseFinishCode(b.code ?? "");
  if (codeA !== "" && codeB !== "") return codeA === codeB;
  const wordsA = finishWordsKey(a.words);
  return wordsA !== "" && wordsA === finishWordsKey(b.words);
}

/**
 * Two pages giving one configuration the same BWS field, in different words,
 * and what the reviewer can do about it — carried on the blocker so the row
 * can offer the three answers (plan any-bill, step 4).
 */
export type FieldClash = {
  /** The field both rows name: "COM 1". */
  fieldName: string;
  /** A fabric (a COM slot), which is what the buttons call it; otherwise "finish". */
  fabric: boolean;
  /** Both rows, the earlier page first. Either can be the one kept. */
  rows: { observationId: string; itemId: string; page: number | null }[];
  /**
   * The LATER page's row, and the next slot of the same kind free for it —
   * null where every slot is taken, which the button says. `candidates` is
   * every slot of the kind this code's own rows leave free, in order; the
   * blockers pick the first one the RECORD also leaves free.
   */
  move: {
    observationId: string;
    page: number | null;
    fieldId: string | null;
    fieldName: string | null;
    candidates: { fieldId: string; fieldName: string }[];
  };
};

/** What another page of the same code says about one row's BWS field. */
export type CrossPageClaim =
  | {
      /** The same finish, by the client's own code: the later page's row is already recorded. */
      kind: "same_finish";
      /** The earlier page's row it repeats. */
      keptId: string;
      code: string;
      message: string;
    }
  | {
      /** The same field, the same configuration, different words: a person decides. */
      kind: "conflict";
      /** The same for both rows of the pair, so a card can count decisions. */
      pairKey: string;
      message: string;
      clash: FieldClash;
    };

/**
 * TWO PAGES OF ONE CODE GIVING ONE CONFIGURATION THE SAME BWS FIELD.
 *
 * S-301's sheet gives TYPE 1 and TYPE 5 their COM 1 as "…Gorée - Raffia, col.
 * black/straw diamonds" with no code, and its shop drawing gives them COM 1 as
 * "…black/straw diamonds, raffia, Gorée" coded CH-01.1. Pressing Confirm
 * applied the sheet and then refused the drawing with slot_taken — a card half
 * applied, over something it could see before anything was written.
 *
 * So the claims are compared ACROSS PAGES here, per configuration (per record,
 * for a card that writes one; never for page letters, which are separate
 * records by construction), over pending rows only:
 *
 *   the same finish (`sameFinish`: one      the later page's row is already
 *   code on both, or the same words in      recorded, and says so.
 *   any order)
 *   anything else                            a CONFLICT on both rows, asking the
 *                                            real question: the same fabric (keep
 *                                            one page's wording) or two (give the
 *                                            later page the next free slot).
 *
 * THE OLD ADVICE WAS WRONG ON THE CASE THAT PROMPTED IT (plan any-bill, step
 * 4). "Ignore one, or move one to another field" on S-301 — one cloth, words
 * reordered, a code on one page only — put a second, non-existent fabric into
 * COM 2 of the BWS export for anyone who followed it. The clash now carries
 * the three answers as data (`FieldClash`) so the row can offer them.
 *
 * ONE FUNCTION, called by the card (through `resolveStagedRun`) and the confirm.
 */
export function crossPageClaims(
  items: readonly DrawingItem[],
  doc?: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
  fields: readonly SpecFieldEntry[] = [],
): Map<string, CrossPageClaim> {
  const out = new Map<string, CrossPageClaim>();
  const plans = namedConfigurationPlans(items, doc);
  const letters = variantLettersByItem(items, doc);
  const fieldName = (id: string) => fields.find((field) => field.id === id)?.name ?? "the same BWS field";
  type Claim = { item: DrawingItem; observation: DrawingObservation };
  for (const [, pages] of groupItemsByCode(items, doc)) {
    if (pages.length < 2) continue;
    // Page letters are separate records: two pages cannot collide on one.
    if (pages.some((item) => letters.get(item.id))) continue;
    const byKey = new Map<string, { field: string; scope: string; claims: Claim[] }>();
    for (const item of pages) {
      const plan = plans.get(item.id);
      for (const observation of item.observations) {
        if (observation.reviewStatus !== "pending" || !observation.specFieldId || observation.attrGroup === "dimension") continue;
        const scopes = plan ? (plan.rows[observation.id] ?? plan.labels) : [""];
        for (const scope of scopes) {
          const key = `${scope}\u0000${observation.specFieldId}`;
          const entry = byKey.get(key) ?? { field: observation.specFieldId, scope, claims: [] };
          entry.claims.push({ item, observation });
          byKey.set(key, entry);
        }
      }
    }
    // Per pair of rows, which configurations they collide on.
    const pairs = new Map<string, { first: Claim; later: Claim; field: string; scopes: string[] }>();
    for (const { field, scope, claims } of byKey.values()) {
      const ordered = [...claims].sort((a, b) => (a.item.page ?? Number.MAX_SAFE_INTEGER) - (b.item.page ?? Number.MAX_SAFE_INTEGER));
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const first = ordered[i]!;
          const later = ordered[j]!;
          if (first.item.id === later.item.id) continue; // one page twice: the card's own blocker
          const key = `${first.observation.id}|${later.observation.id}`;
          const pair = pairs.get(key) ?? { first, later, field, scopes: [] };
          pair.scopes.push(scope);
          pairs.set(key, pair);
        }
      }
    }
    const words = (claim: Claim) => claim.observation.value ?? claim.observation.valueRaw ?? "";
    for (const [pairKey, { first, later, field, scopes }] of pairs) {
      if (
        sameFinish(
          { code: first.observation.materialCodeRaw, words: words(first) },
          { code: later.observation.materialCodeRaw, words: words(later) },
        )
      ) {
        if (out.get(later.observation.id)?.kind !== "conflict") {
          const code = (later.observation.materialCodeRaw ?? first.observation.materialCodeRaw ?? "").trim();
          const sameCode =
            code !== "" &&
            normaliseFinishCode(later.observation.materialCodeRaw ?? "") ===
              normaliseFinishCode(first.observation.materialCodeRaw ?? "");
          out.set(later.observation.id, {
            kind: "same_finish",
            keptId: first.observation.id,
            code,
            message: sameCode
              ? `Page ${later.item.page ?? "?"} names the same finish, ${code} — already recorded from page ${first.item.page ?? "?"}.`
              : `Page ${later.item.page ?? "?"} names the same finish in the same words — already recorded from page ${first.item.page ?? "?"}.`,
          });
        }
        continue;
      }
      const where = scopes.filter(Boolean).length > 0 ? ` for ${scopes.join(" · ")}` : "";
      const fabric = isFabricSlot(field, fields);
      const noun = fabric ? "fabric" : "finish";
      const message =
        `Page ${first.item.page ?? "?"} and page ${later.item.page ?? "?"} both give ${fieldName(field)}${where}. ` +
        `If they are the same ${noun}, keep one wording; if they are two ${noun}${fabric ? "s" : "es"}, give page ${later.item.page ?? "?"} its own field.`;
      const candidates = freeSlotsOfKind(field, fields, takenFor(pages, later, scopes, plans));
      const next = candidates[0] ?? null;
      const clash: FieldClash = {
        fieldName: fieldName(field),
        fabric,
        rows: [first, later].map((claim) => ({
          observationId: claim.observation.id,
          itemId: claim.item.id,
          page: claim.item.page ?? null,
        })),
        move: {
          observationId: later.observation.id,
          page: later.item.page ?? null,
          fieldId: next?.id ?? null,
          fieldName: next?.name ?? null,
          candidates: candidates.map((entry) => ({ fieldId: entry.id, fieldName: entry.name })),
        },
      };
      out.set(first.observation.id, { kind: "conflict", pairKey, message, clash });
      out.set(later.observation.id, { kind: "conflict", pairKey, message, clash });
    }
  }
  return out;
}

/** The slot list a field belongs to — COM, timber or metal — or null for any other field. */
function slotListOf(fieldId: string, fields: readonly SpecFieldEntry[]): readonly number[] | null {
  const jsonId = fields.find((field) => field.id === fieldId)?.jsonId;
  if (jsonId === undefined) return null;
  for (const list of [FABRIC_SLOTS, TIMBER_SLOTS, METAL_SLOTS] as readonly (readonly number[])[]) {
    if (list.includes(jsonId)) return list;
  }
  return null;
}

function isFabricSlot(fieldId: string, fields: readonly SpecFieldEntry[]): boolean {
  return slotListOf(fieldId, fields) === FABRIC_SLOTS;
}

/**
 * THE `taken` CLAIMS, for the later row of a clash: every BWS field another row
 * of this code already holds in one of its configurations — pending or applied,
 * on any page, excluding the row being moved. A slot free here may still be
 * held on the RECORD by an earlier document; `drawingItemBlockers` narrows it
 * by the occupants, and a slot taken there is the ordinary slot_taken blocker.
 */
function takenFor(
  pages: readonly DrawingItem[],
  moving: { observation: DrawingObservation },
  scopes: readonly string[],
  plans: ReturnType<typeof namedConfigurationPlans>,
): Set<string> {
  const taken = new Set<string>();
  for (const item of pages) {
    const plan = plans.get(item.id);
    for (const observation of item.observations) {
      if (observation.id === moving.observation.id || observation.reviewStatus === "ignored") continue;
      if (!observation.specFieldId || observation.attrGroup === "dimension") continue;
      const rowScopes = plan ? (plan.rows[observation.id] ?? plan.labels) : [""];
      if (rowScopes.some((scope) => scopes.includes(scope))) taken.add(observation.specFieldId);
    }
  }
  return taken;
}

/** The slots of the same kind as `fieldId`, in fill order, that are not in `taken` — never `fieldId` itself. */
export function freeSlotsOfKind(
  fieldId: string,
  fields: readonly SpecFieldEntry[],
  taken: ReadonlySet<string>,
): SpecFieldEntry[] {
  const list = slotListOf(fieldId, fields);
  if (!list) return [];
  const out: SpecFieldEntry[] = [];
  for (const jsonId of list) {
    const field = fields.find((entry) => entry.jsonId === jsonId);
    if (field && field.id !== fieldId && !taken.has(field.id)) out.push(field);
  }
  return out;
}

/** What the model said about a code's pages, or null on a version 1 run. */
export function codeGroupFor(
  doc: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
  itemCodeRaw: string | null,
): StagedCodeGroup | null {
  const code = normaliseRef(itemCodeRaw ?? "");
  if (!code) return null;
  return codeGroupsOf(doc).find((group) => group.itemCodes.some((entry) => normaliseRef(entry) === code)) ?? null;
}

export function hasPendingObservations(doc: StagedDrawings): boolean {
  return doc.items.some((item) => item.observations.some((o) => o.reviewStatus === "pending"));
}

/** `normaliseUnit` re-exported so a route validates against one implementation. */
export { normaliseUnit };
