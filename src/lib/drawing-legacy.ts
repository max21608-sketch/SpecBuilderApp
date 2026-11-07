// THE FROZEN READS: what a shop-drawings run staged as schemaVersion 1, 2 or 3
// needs and a version 4 run never reaches. Moved out of
// src/lib/drawing-document.ts and src/lib/dimension-guess.ts on 2026-11-07
// (audit 5.3, cut D); the code is unchanged.
//
// ============================================================================
// WHO REACHES THIS FILE, AND WHO MAY NOT.
//
//   stageDrawings          the page-centric staging (schemaVersion 1 to 3).
//                          Nothing in the app asks the v3 tool any more; a
//                          harness re-read can, and the tools and fixtures do.
//   applyViewGuesses       a version 1 run's slot guess, at read time, from
//                          `assertStagedDrawings` (`!readByModel`).
//   dedupeMeasured         the cross-view de-duplication, at read time, for
//                          versions 1 to 3 (`!readAsItems`).
//   variantLettersByItem   page lettering. Called on every version, and a
//                          version 4 run letters nothing.
//   guessSlotsFromViews    the view-repetition slot guess a version 1 card
//                          re-runs (`!wasReadByModel`), and its helpers.
//
// NOTHING NEW MAY CALL INTO THIS FILE. A run staged as version 4 is read
// without any of it, and `tests/lib/drawings-v3-frozen.test.ts` holds what a
// v1 to v3 run reads as against a file written before version 4 existed: a
// change here is a pack somebody has already paid to read changing under its
// reviewer. The whole file goes when the last v1 to v3 run has been re-read.
//
// A CYCLE, KNOWINGLY: this file imports drawing-document.ts and
// drawing-document.ts imports `applyViewGuesses`, `dedupeMeasured` and
// `variantLettersByItem` from it. It holds only because NEITHER FILE READS THE OTHER AT IMPORT
// TIME: every use is inside a function. A top-level constant here built from a
// drawing-document value, or the reverse, is undefined in whichever module
// loads second.
// ============================================================================
//
// ---- the view-repetition slot guess (was src/lib/dimension-guess.ts) ----
//
// Which of a page's figures are the overall W, D and H.
//
// ============================================================================
// THE PROBLEM THIS SOLVES, IN THE PACK'S OWN NUMBERS.
//
// The Panther shop-drawing set labels its figures by the VIEW they are drawn
// on, not by what they measure. S-200 carries twenty-four of them:
//
//   FRONT         110 100 460 125 240 420 520 720 50 5 840
//   SIDE          650 790
//   BACK          520 840
//   TOP           540 790 840
//   SIDE SECTION  540 720 300 460 650 790
//
// `normaliseDimensionSlot` cannot place any of those, correctly: "FRONT" is not
// a width. So all twenty-four staged as notes, and the item's Dimensions
// question stayed empty on a page that states its size four times over.
//
// WHAT MAKES A GUESS POSSIBLE IS THE REPETITION, NOT THE SIZE.
//
// An overall dimension is drawn on every view that shows it, and that is a fact
// about orthographic projection rather than about furniture:
//
//   WIDTH  appears on the front, the back AND the plan  -> 840 (all three)
//   DEPTH  appears on the side, the section AND the plan -> 790 (all three)
//   HEIGHT appears on the front AND the side, never the plan -> 720 (both)
//
// So the slots fall out of which views a figure appears on. Nothing here looks
// at whether a number is "about right for an armchair", because that is the
// reasoning that turns an 8-metre sofa into a plausible one.
//
// IT IS A SUGGESTION, AND IT SAYS SO. Every slot it assigns is marked
// `slotSuggested`, which the card already renders as an amber select with the
// composed cell beside it — the same treatment `parseCombinedDimensions` gets
// for reading "80 x 70 x 90" positionally. A reviewer who can see
// `W840 x D790 x H720 x SH460mm` next to the page can accept or reject it in a
// second, which is the only reason guessing is allowed here at all.
//
// WHERE IT CANNOT TELL, IT STILL GUESSES, AND SAYS SO LOUDLY. Asked for by Max
// on 2026-09-16 after walking the real set: an empty Dimensions question is no
// use to anybody, and a wrong one he can see is. So a page that labels no view
// — the S-100 sofa sheet's eight bare figures — falls back to the only reading
// left, the three largest distinct figures as W >= D >= H, and the card marks
// the guess as weak: a KEY MEASUREMENT DISPUTE panel with the page rendered
// beside it, and every guessed row highlighted yellow in the table.
//
// The two paths are not equally good and the screen must not present them as
// though they were. A cross-view agreement is the page saying the same number
// three times; a magnitude ordering is an assumption that furniture is wider
// than it is deep and deeper than it is tall, which is false for a desk chair
// and a headboard. `dispute` carries that difference, and it is always set on
// the fallback path.
// ============================================================================
import { normaliseRef } from "@/lib/record-refs";
import {
  DIMENSION_SLOT_LABELS,
  normaliseDimensionSlot,
  normaliseUnit,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { parseCombinedDimensions, parseDimensionFigure, sharesAScale } from "@/lib/dimensions";
import { type RawCodeGroup, type RawDrawingItem, slotFromModel } from "@/lib/extraction-schema";
import { nextVariantLabel } from "@/lib/record-variants";
import {
  type DrawingItem,
  type DrawingObservation,
  ScopedClaims,
  type SpecFieldEntry,
  type StagedCodeGroup,
  type StagedDrawings,
  type UnitSource,
  classifyCallout,
  codeGroupsOf,
  fieldClaimScopes,
  groupItemsByCode,
  isMeasuredRow,
  isOverallRow,
  measuredKey,
  measuredRows,
  mergeNoteBlocks,
  namedConfigurationsByCode,
  nextId,
  pickItemView,
  printedImperialUnit,
  readAsItems,
  readByModel,
  rejoinInchMark,
  resolveDimensionUnit,
  reviewerOverride,
  splitFigureAndUnit,
  suggestAttributeState,
  suggestSpecField,
  suggestUnit,
  unitSourceOf,
  usableViews,
} from "@/lib/drawing-document";

/**
 * The views a figure can be drawn on, grouped by what they can measure.
 *
 * `front` holds the BACK elevation too: a back view shows the same width and
 * the same height as the front, which is exactly what makes it evidence. A
 * section is grouped with the side for the same reason — "SIDE SECTION" is a
 * cut through the side elevation and carries depth and height.
 */
export type ViewFamily = "front" | "side" | "plan" | "unknown";

const FAMILY_WORDS: [ViewFamily, string[]][] = [
  ["plan", ["plan", "top", "birdseye", "bird's eye", "above"]],
  ["side", ["side", "section", "profile", "end", "lateral"]],
  ["front", ["front", "back", "rear", "elevation", "face"]],
];

/**
 * Which family a drawing's own view label belongs to.
 *
 * WHOLE WORDS, never substrings. `end` and `face` are both in the side and
 * front lists, and a substring test put `LEGEND` on the side elevation and
 * `SURFACE` on the front — two labels a real specification sheet prints. A
 * wrongly-familied label is worse than an unknown one: `guessSlotsFromViews`
 * reads agreement ACROSS families as its evidence, so one mis-sorted label
 * invents a second view that agrees with nothing, and the whole page falls to
 * the weak fallback.
 *
 * This is `normaliseDimensionSlot`'s rule in a second place: it matches the
 * whole folded label and never a substring, because `WIDTH SEAT` is not a
 * width.
 */
export function viewFamily(labelRaw: string | null): ViewFamily {
  const label = (labelRaw ?? "").toLowerCase();
  if (!label) return "unknown";
  // Split on anything that is not a letter or an apostrophe, so "SIDE SECTION",
  // "SIDE-SECTION" and "BIRD'S EYE" all read as the words they are.
  const words = label.split(/[^a-z']+/).filter(Boolean);
  const phrase = words.join(" ");
  for (const [family, keywords] of FAMILY_WORDS) {
    // A multi-word keyword ("bird's eye") is matched against the whole phrase;
    // a single word against the word list.
    if (keywords.some((keyword) => (keyword.includes(" ") ? phrase.includes(keyword) : words.includes(keyword)))) {
      return family;
    }
  }
  return "unknown";
}

/** A staged measured figure, as much of one as this needs. */
export type MeasuredRow = {
  id: string;
  labelRaw: string | null;
  value: string | null;
};

export type GuessedSlot = {
  observationId: string;
  slot: DimensionSlot;
  /** In the page's own terms, so a reviewer can check the claim. */
  why: string;
};

export type DimensionGuess = {
  guesses: GuessedSlot[];
  /**
   * Why this guess is WEAK, when it is. Null means the views agreed, which is
   * the page stating the same figure on two or three of them.
   *
   * Never a reason to withhold the guess — the slots are filled either way and
   * every one of them is marked suggested. It is the reason the card shows the
   * drawing and turns the rows yellow.
   */
  dispute: string | null;
};

const NOTHING: DimensionGuess = { guesses: [], dispute: null };

/** A seat height is a fraction of the overall height, never an absolute range.
 *  An absolute range would have to know whether the page is in mm or cm, and
 *  the unit is exactly what these pages do not state. */
const SEAT_MIN = 0.45;
const SEAT_MAX = 0.78;
/** Where a seat actually sits, used to choose between candidates. */
const SEAT_TYPICAL = 0.6;

/**
 * Items that HAVE a seat, by the drawing's own name for them.
 *
 * Read off `itemNameRaw` — what the page called it — and not off the record's
 * category, which is a decision somebody makes later and which an
 * uncategorised record does not have at all. An armchair with no seat height
 * is a missing measurement, not a design choice, and a card that stays silent
 * about it makes a reviewer prove a negative.
 */
const SEATING_WORDS = [
  "chair",
  "armchair",
  "sofa",
  "settee",
  "bench",
  "stool",
  "ottoman",
  "pouf",
  "pouffe",
  "banquette",
  "seat",
  "seating",
  "footstool",
  "daybed",
];

/** Does the page's own name for this item say it has a seat? */
export function hasASeat(itemName: string | null): boolean {
  const name = (itemName ?? "").toLowerCase();
  return name !== "" && SEATING_WORDS.some((word) => name.includes(word));
}

/**
 * The seat height, from the best evidence available.
 *
 * TWO TIERS, because they are not equally good and S-201 proved it. A figure
 * BOTH elevations state is strong — S-200's 460 is on the front and the
 * section. A figure only ONE view states is weak, and the original rule threw
 * those away: S-201 prints 465 on the front elevation alone, its front and
 * side share nothing in the seat window, and the card came back with no seat
 * height at all on an armchair. Asked for on 2026-09-16: assign it and flag
 * it, do not go quiet.
 *
 * Among candidates, the one nearest 60% of the overall height, then the larger
 * — never the first found, which would make the answer depend on the order the
 * model happened to report its figures in.
 */
function seatHeight(
  shared: number[],
  all: number[],
  height: number,
  used: number[],
): { figure: number; shared: boolean } | null {
  const inWindow = (figures: number[]) =>
    figures
      .filter((figure) => !used.includes(figure))
      .filter((figure) => figure / height >= SEAT_MIN && figure / height <= SEAT_MAX)
      .sort(
        (a, b) =>
          Math.abs(a - height * SEAT_TYPICAL) - Math.abs(b - height * SEAT_TYPICAL) || b - a,
      );
  const strong = inWindow(shared)[0];
  if (strong !== undefined) return { figure: strong, shared: true };
  const weak = inWindow(all)[0];
  return weak === undefined ? null : { figure: weak, shared: false };
}

/**
 * Read the overall dimensions off a page that labels its figures by view.
 *
 * Deterministic, and dependent on nothing but the rows passed in. Call it with
 * every MEASURED row on one item — a figure with a number — and it returns at
 * most one row per slot.
 */
/** No guess at all: what a version 2 item needs, and what a card with no rows gets. */
export const EMPTY_GUESS: DimensionGuess = { guesses: [], dispute: null };

export function guessSlotsFromViews(rows: MeasuredRow[], itemName: string | null = null): DimensionGuess {
  // One entry per distinct figure: which families draw it, and the first row
  // on each family that does. The FIRST is deliberate — a figure drawn twice on
  // one view is one measurement reported twice, and either row is the same
  // claim about the page.
  const byFigure = new Map<number, { families: Set<ViewFamily>; rows: MeasuredRow[] }>();
  for (const row of rows) {
    const figure = parseDimensionFigure(row.value).figure;
    if (figure === null) continue;
    const entry = byFigure.get(figure) ?? { families: new Set<ViewFamily>(), rows: [] };
    entry.families.add(viewFamily(row.labelRaw));
    entry.rows.push(row);
    byFigure.set(figure, entry);
  }
  if (byFigure.size === 0) return NOTHING;

  const on = (family: ViewFamily) =>
    [...byFigure.entries()].filter(([, entry]) => entry.families.has(family)).map(([figure]) => figure);

  const front = on("front");
  const side = on("side");
  const plan = on("plan");

  // A page that labels no view at all cannot be read this way, and there is no
  // convention that puts a bare column of eight figures in order — that is the
  // S-100 sofa sheet, and it needs a person. It is only worth SAYING so once
  // there are enough figures that the overall size is certainly among them.
  if (front.length === 0 && side.length === 0 && plan.length === 0) {
    return fromMagnitudes(
      byFigure,
      "The page labels none of its figures with a view, so this is the three largest read as width, then depth, then height. That ordering is an assumption about the item, not something the page says — check all four against the drawing.",
      itemName,
    );
  }

  const largest = (figures: number[]) => (figures.length === 0 ? null : Math.max(...figures));
  const shared = (a: number[], b: number[]) => a.filter((figure) => b.includes(figure));

  // HEIGHT FIRST, because it is the one an elevation and a section must agree
  // on, and because W and D are then read excluding it.
  const heightCandidates = shared(front, side);
  const height = largest(heightCandidates);

  // ==========================================================================
  // A CONFIRMED CANDIDATE STILL HAS TO BE AT THE PAGE'S SCALE.
  //
  // Two views stating the same figure is strong evidence that the figure is
  // real. It is NOT evidence that the figure is an overall dimension: a shop
  // drawing prints its gaps, reveals and radii on every view too, and a plan
  // that the model read thinly can easily share nothing with the side
  // elevation except a 42mm reveal.
  //
  // That is what happened on the real S-201 armchair. Its plan and its side
  // elevation had exactly one figure in common, 42, so the "a depth appears on
  // the side, the section and the plan" rule returned 42 as the depth of an
  // item 680 high — and because 42 and 680 cannot be in the same unit, the
  // whole row set then failed `suggestUnit`, every placed row came back with no
  // unit, and the card carried four `unit_missing` blockers and could not be
  // confirmed at all. A bad guess that also blocks the card is the worst of
  // both outcomes.
  //
  // So a confirmed candidate is taken only if it SHARES A SCALE with the
  // height, which is the same test `suggestUnit` applies to the page and is
  // about the figures rather than about furniture: nothing here asks whether a
  // number is about right for an armchair, which is the reasoning that turns an
  // 8-metre sofa into a plausible one. Where it does not, the elevation's own
  // largest figure is used instead — the fallback this rule already had for a
  // page with no plan at all.
  //
  // If neither candidate shares the height's scale, the first is kept and the
  // set fails coherence downstream exactly as it did before: the page has not
  // been read well enough to place anything, and `fromMagnitudes` says so.
  // ==========================================================================
  const atHeightScale = (candidates: (number | null)[]): number | null => {
    const offered = candidates.filter((figure): figure is number => figure !== null);
    return offered.find((figure) => sharesAScale([figure, height ?? figure])) ?? offered[0] ?? null;
  };

  // WIDTH from the front and the plan where there is a plan; a plan is a second
  // independent statement of the same number.
  const widthFromPlan = largest(shared(front, plan));
  const widthFromFront = largest(front.filter((figure) => figure !== height));
  const width = atHeightScale([widthFromPlan, widthFromFront]);

  const depthFromPlan = largest(shared(side, plan));
  const depthFromSide = largest(side.filter((figure) => figure !== height));
  const depth = atHeightScale([depthFromPlan, depthFromSide]);

  if (width === null || depth === null || height === null) {
    const missing = [
      width === null ? "the width" : null,
      depth === null ? "the depth" : null,
      height === null ? "the height" : null,
    ].filter((part): part is string => part !== null);
    return fromMagnitudes(
      byFigure,
      `The views do not agree on ${missing.join(" or ")}: ${describe(front, side, plan)}. An overall dimension is drawn on every view that shows it, and these do not repeat — so this is the three largest figures read as width, then depth, then height. Check all of them against the drawing.`,
      itemName,
    );
  }

  // A figure cannot be two slots. This fires on a genuinely square item and on
  // a page that has been read wrongly, and neither is ours to decide.
  const chosen = [width, depth, height];
  if (new Set(chosen).size !== chosen.length) {
    return fromMagnitudes(
      byFigure,
      `The views make the same figure read as more than one dimension (width ${width}, depth ${depth}, height ${height}), so this is the three largest instead. Check them against the drawing.`,
      itemName,
    );
  }

  // Where the plan and the front elevation disagree about the width, that is
  // the page contradicting itself and it is worth naming rather than resolving.
  const widthDisagrees =
    widthFromPlan !== null && widthFromFront !== null && widthFromPlan !== widthFromFront
      ? `The plan's largest figure is ${widthFromPlan} and the front elevation's is ${widthFromFront}, and both should be the width. ${width === widthFromPlan ? "The plan's is used here because a plan states width and depth together." : "The front elevation's is used here because the plan's does not sit at the same scale as the height."} Check it against the drawing.`
      : null;

  const seat = seatHeight(heightCandidates, [...byFigure.keys()], height, [width, depth, height]);

  const pick = (figure: number, slot: DimensionSlot, why: string): GuessedSlot | null => {
    const row = byFigure.get(figure)?.rows[0];
    return row ? { observationId: row.id, slot, why } : null;
  };
  const families = (figure: number) => [...(byFigure.get(figure)?.families ?? [])].filter((f) => f !== "unknown");

  return {
    guesses: [
      pick(width, "W", `drawn on the ${families(width).join(" and ")} — ${describeSlotRule("W")}`),
      pick(depth, "D", `drawn on the ${families(depth).join(" and ")} — ${describeSlotRule("D")}`),
      pick(height, "H", `drawn on the ${families(height).join(" and ")} — ${describeSlotRule("H")}`),
      seat === null
        ? null
        : pick(
            seat.figure,
            "SH",
            seat.shared
              ? `both elevations state it, at ${Math.round((seat.figure / height) * 100)}% of the height`
              : `only one view states it, at ${Math.round((seat.figure / height) * 100)}% of the height — a seat height is a guess here`,
          ),
    ].filter((entry): entry is GuessedSlot => entry !== null),
    dispute: seatNote(widthDisagrees, seat, itemName),
  };
}

/**
 * Say so when a seat height is weak or missing on something that has a seat.
 *
 * An armchair whose card shows no seat height reads as an armchair that does
 * not need one. The page's own name for the item is the test — see `hasASeat`.
 */
function seatNote(
  existing: string | null,
  seat: { figure: number; shared: boolean } | null,
  itemName: string | null,
): string | null {
  if (!hasASeat(itemName)) return existing;
  const added =
    seat === null
      ? `No figure on this page sits where a seat height would, and the drawing calls this a ${itemName}. Read the seat height off the page and set it.`
      : seat.shared
        ? null
        : `The seat height is taken from one view only, because the elevations do not state the same figure twice. Check it against the drawing.`;
  return [existing, added].filter(Boolean).join(" ") || null;
}

/**
 * The only reading left when the views do not settle it: the three largest
 * distinct figures as W >= D >= H, and a seat height from what is left.
 *
 * THIS IS THE WEAK PATH AND ITS CALLER ALWAYS PASSES A REASON. It assumes
 * furniture is wider than it is deep and deeper than it is tall, which holds
 * for the S-100 sofa (190 / 79 / 72) and fails for a desk chair and a
 * headboard. It is here because an empty Dimensions question helps nobody and a
 * wrong one a reviewer can SEE does: every row it fills is marked suggested,
 * the card highlights them, and the page is rendered beside the reason.
 *
 * Below three distinct figures it fills nothing. Two figures could be W x H,
 * W x D or Dia x H with nothing to choose between them, and inventing a third
 * slot from two numbers is not a guess a reviewer could check — it is one they
 * would have to undo.
 */
function fromMagnitudes(
  byFigure: Map<number, { families: Set<ViewFamily>; rows: MeasuredRow[] }>,
  dispute: string,
  itemName: string | null = null,
): DimensionGuess {
  const descending = [...byFigure.keys()].sort((a, b) => b - a);
  if (descending.length < 3) return { guesses: [], dispute };
  const [width, depth, height] = descending as [number, number, number];

  // No view said anything here, so there is no strong tier: every candidate is
  // a one-view figure. Same window and same nearest-to-60% choice.
  const seat = seatHeight([], descending, height, [width, depth, height]);

  const pick = (figure: number, slot: DimensionSlot, why: string): GuessedSlot | null => {
    const row = byFigure.get(figure)?.rows[0];
    return row ? { observationId: row.id, slot, why } : null;
  };
  return {
    guesses: [
      pick(width, "W", "the largest figure on the page — no view says so"),
      pick(depth, "D", "the second largest — no view says so"),
      pick(height, "H", "the third largest — no view says so"),
      seat === null
        ? null
        : pick(
            seat.figure,
            "SH",
            `nearest a seat height at ${Math.round((seat.figure / height) * 100)}% of the guessed height`,
          ),
    ].filter((entry): entry is GuessedSlot => entry !== null),
    dispute: seatNote(dispute, seat, itemName),
  };
}

function describeSlotRule(slot: DimensionSlot): string {
  if (slot === "W") return "a width appears on the front, the back and the plan";
  if (slot === "D") return "a depth appears on the side, the section and the plan";
  return "a height appears on the front and the side, never on the plan";
}

function describe(front: number[], side: number[], plan: number[]): string {
  const part = (name: string, figures: number[]) =>
    figures.length === 0 ? `no ${name} figures` : `${name} ${[...figures].sort((a, b) => b - a).join(", ")}`;
  return [part("front", front), part("side", side), part("plan", plan)].join("; ");
}

// ---- moved from src/lib/drawing-document.ts ------------------------------

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
      const split = splitFigureAndUnit(rejoinInchMark(dimension.valueRaw, dimension.unitRaw));
      return {
        ...dimension,
        valueRaw: split.value,
        // A FEET OR INCH MARK IS A UNIT PRINTED ON THE PAGE. `6'-4"` states its
        // unit as plainly as `1800mm` does, so a compound that reads
        // completely is `in`, printed — no project default, no magnitude vote.
        // One that does not read completely gets nothing here, and the card
        // names it as imperial, not converted.
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
        printedUnit: printedUnit ?? printedImperialUnit(part.value),
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
export function dedupeMeasured(observations: DrawingObservation[], readByModel: boolean): DrawingObservation[] {
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
 * Place the overall W, D, H and SH on a page that labels its figures by view.
 *
 * READ TIME, NEVER WRITTEN BACK, exactly like `upgradeDimensionSlots` above and
 * for the same reasons — and with the same consequence, which is the point: the
 * eleven-document pack already staged in the sandbox gets this with no second
 * model call and nothing charged again.
 *
 * Every slot it sets is `slotSuggested: true`, so the card renders it as an
 * amber select with the composed cell beside it. See `guessSlotsFromViews` above
 * for why the repetition across views is evidence and the magnitudes are not.
 *
 * IT NEVER SECOND-GUESSES A PLACED ROW. If any pending measured row on the item
 * already carries a slot — the staging vocabulary recognised a label, a
 * combined line was read, or a person chose one — the whole item is left alone.
 * A guess that filled the gaps around somebody's decision would be a guess
 * wearing their authority.
 */
export function applyViewGuesses(doc: StagedDrawings): StagedDrawings {
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
  // VERSION 4 LETTERS NOTHING. A page count was never evidence of a split, and
  // a version 4 read does not hand over pages to count: an item IS one thing
  // to make, and its configurations are the ones the document names.
  if (readAsItems(doc)) {
    for (const item of items) letters.set(item.id, null);
    return letters;
  }
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
