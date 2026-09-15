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
import { containsPhrase, deferredToSomebody, findRecordsByRef, type RecordEntry, TBC_TOKENS } from "@/lib/spec-document";
import { normaliseName } from "@/lib/matching";
import {
  normaliseUnit,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
} from "@/lib/spec-vocab";
import type { RawDrawingItem } from "@/lib/extraction-schema";

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
  specFieldId: string | null;
  state: AttributeState | null;
  stateReason: string | null;
  reviewStatus: "pending" | "ignored" | "applied";
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** One attribute row per target record, once applied. */
  applied: { attributeIds: string[] } | null;
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
};

export type StagedDrawings = {
  schemaVersion: 1;
  kind: "shop_drawings";
  filename: string | null;
  documentNotes: string | null;
  items: DrawingItem[];
};

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
 */
export function suggestUnit(values: (string | null)[]): UnitSuggestion {
  const numbers = values.map(figureOf).filter((n): n is number => n !== null);
  if (numbers.length === 0) return { status: "none" };

  const allSmall = numbers.every((n) => n < 300);
  const allLarge = numbers.every((n) => n >= 300);
  if (allSmall) return { status: "confident", unit: "cm" };
  if (allLarge) return { status: "confident", unit: "mm" };
  return { status: "ambiguous" };
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
  const digits = String(raw ?? "").replace(/[^0-9.]/g, "");
  if (digits === "") return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  if (TBC_TOKENS.includes(norm)) return { state: "tbc", value, reason: null };

  // "Dark tinted wood TBC" states a value AND says it is not settled. Neither
  // this code nor the model decides which one won.
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

const FABRIC_WORDS = ["fabric", "com", "upholstery", "leather", "textile", "weave", "velvet"];
const TIMBER_WORDS = ["wood", "timber", "oak", "walnut", "veneer", "feet", "leg", "legs", "frame"];
const METAL_WORDS = ["metal", "brass", "bronze", "steel", "chrome", "nickel"];

export type SpecFieldEntry = { id: string; jsonId: number; name: string };

function mentions(text: string, words: string[]): boolean {
  const parts = normaliseName(text).split(" ");
  return words.some((word) => parts.includes(word));
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
  observation: { attrGroup: AttributeGroup; labelRaw: string | null; valueRaw: string | null },
  fields: SpecFieldEntry[],
  taken: Set<string>,
): string | null {
  if (observation.attrGroup === "dimension") return null; // many compose into Dimensions
  const text = `${observation.labelRaw ?? ""} ${observation.valueRaw ?? ""}`;

  let slots: readonly number[] | null = null;
  if (mentions(text, FABRIC_WORDS)) slots = FABRIC_SLOTS;
  else if (mentions(text, METAL_WORDS)) slots = METAL_SLOTS;
  else if (mentions(text, TIMBER_WORDS)) slots = TIMBER_SLOTS;
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
  | { code: "slot_taken"; message: string; observationId: string };

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
  occupiedFields: Map<string, Set<string>>,
): DrawingBlocker[] {
  const blockers: DrawingBlocker[] = [];
  const targets = targetRecordIds(item, resolution);
  const pending = item.observations.filter((observation) => observation.reviewStatus === "pending");

  if (targets.length === 0) {
    blockers.push({
      code: "no_targets",
      message: resolution.runs.length
        ? "Every run this item appears in is unticked or unresolved."
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

  for (const observation of pending) {
    if (observation.state === null) {
      blockers.push({
        code: "no_state",
        observationId: observation.id,
        message: observation.stateReason ?? "Say whether this is stated or still TBC.",
      });
    }
    if (observation.state === "confirmed" && !observation.value?.trim()) {
      blockers.push({
        code: "empty_value",
        observationId: observation.id,
        message: "A stated value cannot be blank. Give the value or mark it TBC.",
      });
    }
    if (observation.attrGroup === "dimension" && observation.unit === null && observation.value?.trim()) {
      blockers.push({
        code: "unit_missing",
        observationId: observation.id,
        message: "These drawings do not print their units. Choose millimetres or centimetres.",
      });
    }
    if (observation.specFieldId && observation.attrGroup !== "dimension") {
      // Pre-checked so an occupied slot is a sentence the reviewer can act on,
      // rather than a unique-violation 500 from the database.
      const clash = targets.find((recordId) => occupiedFields.get(recordId)?.has(observation.specFieldId ?? ""));
      if (clash) {
        blockers.push({
          code: "slot_taken",
          observationId: observation.id,
          message: "That BWS field already has a value on one of these records. Choose another field or retire the old value.",
        });
      }
    }
  }

  // Two observations in ONE card claiming one field would satisfy the check
  // above (nothing is written yet) and collide at insert.
  const claimed = new Map<string, string>();
  for (const observation of pending) {
    if (!observation.specFieldId || observation.attrGroup === "dimension") continue;
    const previous = claimed.get(observation.specFieldId);
    if (previous) {
      blockers.push({
        code: "slot_taken",
        observationId: observation.id,
        message: "Two of these specs are assigned to the same BWS field. Move one.",
      });
    } else {
      claimed.set(observation.specFieldId, observation.id);
    }
  }

  return blockers;
}

// ---- warnings --------------------------------------------------------------

export type DrawingWarning = { code: "unit_implausible"; message: string; observationId: string };

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

// ---- staging ---------------------------------------------------------------

/**
 * A group for a callout, from the drawing's own words. Only `dimension` is
 * decided structurally (the model reported it as one); the rest is a display
 * grouping, and `other` is an honest answer rather than a wrong bucket.
 */
export function classifyGroup(labelRaw: string | null, valueRaw: string | null): AttributeGroup {
  const text = `${labelRaw ?? ""} ${valueRaw ?? ""}`;
  if (mentions(text, FABRIC_WORDS)) return "material";
  if (mentions(text, TIMBER_WORDS) || mentions(text, METAL_WORDS)) return "finish";
  if (mentions(text, ["hinge", "hinges", "runner", "runners", "castor", "castors", "mechanism", "glide", "glides"])) {
    return "hardware";
  }
  return "other";
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
export function stageDrawings(
  items: RawDrawingItem[],
  fields: SpecFieldEntry[],
  filename: string | null,
  documentNotes: string | null,
  projectDefaultUnit: AttributeUnit | null = null,
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
    const unitGuess = suggestUnit(dimensions.map((dimension) => dimension.valueRaw));
    const taken = new Set<string>();
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
      observations.push({
        id: nextId(),
        version: 1,
        attrGroup: "dimension",
        labelRaw: dimension.labelRaw ?? `Dimension ${dimensionNo}`,
        valueRaw: dimension.valueRaw,
        materialCodeRaw: null,
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

    let materialNo = 0;
    for (const material of item.materials) {
      materialNo += 1;
      const attrGroup = classifyGroup(material.labelRaw, material.valueRaw);
      const state = suggestAttributeState(material.valueRaw);
      const specFieldId = suggestSpecField({ attrGroup, labelRaw: material.labelRaw, valueRaw: material.valueRaw }, fields, taken);
      if (specFieldId) taken.add(specFieldId);
      observations.push({
        id: nextId(),
        version: 1,
        attrGroup,
        labelRaw: material.labelRaw ?? `Material ${materialNo}`,
        valueRaw: material.valueRaw,
        materialCodeRaw: material.materialCodeRaw,
        value: state.value,
        unit: null,
        unitSuggested: false,
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
      observations,
    };
  });

  return { schemaVersion: 1, kind: "shop_drawings", filename, documentNotes, items: staged };
}

export function assertStagedDrawings(parsed: unknown): StagedDrawings {
  const doc = parsed as Partial<StagedDrawings> | null;
  if (!doc || typeof doc !== "object" || doc.kind !== "shop_drawings" || !Array.isArray(doc.items)) {
    throw new Error("This run was not staged as shop drawings. Upload the drawings again.");
  }
  return doc as StagedDrawings;
}

export function hasPendingObservations(doc: StagedDrawings): boolean {
  return doc.items.some((item) => item.observations.some((o) => o.reviewStatus === "pending"));
}

/** `normaliseUnit` re-exported so a route validates against one implementation. */
export { normaliseUnit };
