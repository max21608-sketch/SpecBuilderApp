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
// WHERE IT CANNOT TELL, IT GUESSES NOTHING AND SAYS WHY. A page whose figures
// share no view, or that labels no view at all, produces a DISPUTE: no slots,
// and a message naming what a person has to go and look at. Half a guess is
// worse than none — three slots filled and the fourth silently absent reads as
// a complete answer.
// ============================================================================
import type { DimensionSlot } from "@/lib/spec-vocab";
import { parseDimensionFigure } from "@/lib/dimensions";

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

/** Which family a drawing's own view label belongs to. */
export function viewFamily(labelRaw: string | null): ViewFamily {
  const label = (labelRaw ?? "").toLowerCase();
  if (!label) return "unknown";
  for (const [family, words] of FAMILY_WORDS) {
    if (words.some((word) => label.includes(word))) return family;
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
  /** Empty whenever `dispute` is set: it is all of them or none. */
  guesses: GuessedSlot[];
  /**
   * What a person has to decide, when the views do not settle it. Null when
   * the guess stands, and null when there was nothing to guess about.
   */
  dispute: string | null;
};

const NOTHING: DimensionGuess = { guesses: [], dispute: null };

/** A seat height is a fraction of the overall height, never an absolute range.
 *  An absolute range would have to know whether the page is in mm or cm, and
 *  the unit is exactly what these pages do not state. */
const SEAT_MIN = 0.45;
const SEAT_MAX = 0.78;

/**
 * Read the overall dimensions off a page that labels its figures by view.
 *
 * Deterministic, and dependent on nothing but the rows passed in. Call it with
 * every MEASURED row on one item — a figure with a number — and it returns at
 * most one row per slot.
 */
export function guessSlotsFromViews(rows: MeasuredRow[]): DimensionGuess {
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
    return byFigure.size >= 3
      ? {
          guesses: [],
          dispute:
            "The page labels none of its figures with a view, so nothing here can tell the width from the depth or the height. Read them off the drawing.",
        }
      : NOTHING;
  }

  const largest = (figures: number[]) => (figures.length === 0 ? null : Math.max(...figures));
  const shared = (a: number[], b: number[]) => a.filter((figure) => b.includes(figure));

  // HEIGHT FIRST, because it is the one an elevation and a section must agree
  // on, and because W and D are then read excluding it.
  const heightCandidates = shared(front, side);
  const height = largest(heightCandidates);

  // WIDTH from the front and the plan where there is a plan; a plan is a second
  // independent statement of the same number.
  const widthFromPlan = largest(shared(front, plan));
  const widthFromFront = largest(front.filter((figure) => figure !== height));
  const width = widthFromPlan ?? widthFromFront;

  const depthFromPlan = largest(shared(side, plan));
  const depthFromSide = largest(side.filter((figure) => figure !== height));
  const depth = depthFromPlan ?? depthFromSide;

  if (width === null || depth === null || height === null) {
    const missing = [
      width === null ? "the width" : null,
      depth === null ? "the depth" : null,
      height === null ? "the height" : null,
    ].filter((part): part is string => part !== null);
    return {
      guesses: [],
      dispute: `The views do not agree on ${missing.join(" or ")}: ${describe(front, side, plan)}. An overall dimension is drawn on every view that shows it, and these do not repeat, so somebody has to read the size off the page.`,
    };
  }

  // A figure cannot be two slots. This fires on a genuinely square item and on
  // a page that has been read wrongly, and neither is ours to decide.
  const chosen = [width, depth, height];
  if (new Set(chosen).size !== chosen.length) {
    return {
      guesses: [],
      dispute: `The same figure reads as more than one dimension here (width ${width}, depth ${depth}, height ${height}). Check the page and set them by hand.`,
    };
  }

  // Where the plan and the front elevation disagree about the width, that is
  // the page contradicting itself and it is worth naming rather than resolving.
  if (widthFromPlan !== null && widthFromFront !== null && widthFromPlan !== widthFromFront) {
    return {
      guesses: [],
      dispute: `The plan's largest figure is ${widthFromPlan} and the front elevation's is ${widthFromFront}. Both should be the width. Read it off the page.`,
    };
  }

  // A seat height is the largest remaining figure that both elevations state
  // and that sits in the right proportion to the overall height. Optional: no
  // candidate means the page did not state one twice, not that there isn't one.
  const seat = heightCandidates
    .filter((figure) => figure !== height && figure / height >= SEAT_MIN && figure / height <= SEAT_MAX)
    .sort((a, b) => b - a)[0];

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
      seat === undefined ? null : pick(seat, "SH", `both elevations state it, at ${Math.round((seat / height) * 100)}% of the height`),
    ].filter((entry): entry is GuessedSlot => entry !== null),
    dispute: null,
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
