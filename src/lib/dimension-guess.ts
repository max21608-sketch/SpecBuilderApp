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
import type { DimensionSlot } from "@/lib/spec-vocab";
import { parseDimensionFigure, sharesAScale } from "@/lib/dimensions";

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
