// Pointing at a figure the read already found, and giving it a slot (brief F).
//
// Pure. The PATCH route plans the swap with `planSlotSwap` inside its locked
// write; the cards build the request with `swapSlotRequest`; nothing else
// decides which row a swap displaces.
//
// ============================================================================
// WHY A SWAP AND NOT A SELECT.
//
// Sebastian, 2026-10-01 (42:10): "you might as well use that full list … so
// that it ties up with something … you're telling it, that's the measurement I
// want you to look at." The room corrected a card by scrolling fifty-seven
// folded figures to find SECTION B and giving it the depth — and the row's
// slot select did that while LEAVING the old depth where it was, so the card
// then read "Two of these are the depth" and the reviewer had a second row to
// find and demote. Pointing at a figure is one act; this makes it one write.
//
// ONE LOCKED WRITE, EVERY ROW VERSION-CHECKED. The mover is checked by the
// request's own `expectedVersion`, and every row it displaces must be one the
// screen SAW, at the version it saw: a row that took the slot since the card
// was drawn is a 409, not a silent demotion of something nobody looked at.
//
// A CONFIGURATION'S SLOT DISPLACES ONLY WITHIN ITS SCOPE. Type 2's own width
// does not take the width away from Type 1. A shared row holding the slot is
// NARROWED off the mover's configurations and keeps the rest — the rule
// staging already uses ("a configuration's own figure REPLACES the item's for
// that configuration") — and becomes a note only where nothing is left.
// ============================================================================
import { normaliseRef } from "@/lib/record-refs";
import {
  isMeasuredRow,
  splitFigureAndUnit,
  type DrawingItem,
  type DrawingObservation,
  type NamedConfigurationPlan,
} from "@/lib/drawing-document";
import { imperialCompound, parseDimensionFigure, toMillimetres, valueCarriesItsUnit } from "@/lib/dimensions";
import { DIMENSION_SLOT_LABELS, type AttributeUnit, type DimensionSlot } from "@/lib/spec-vocab";

/** What one swap does to the row that held the slot. */
export type Displacement =
  | { observationId: string; to: "note" }
  | { observationId: string; to: "narrowed"; configurations: string[] };

export type SlotSwapPlan =
  | { ok: true; displaced: Displacement[] }
  | { ok: false; code: string; message: string; status: 400 | 409 };

/** Can a person point at this row and give it a slot? A pending figure, and nothing else. */
export function canTakeSlot(observation: DrawingObservation): boolean {
  if (observation.reviewStatus !== "pending") return false;
  if (observation.attrGroup === "dimension") return true;
  return isMeasuredRow(observation);
}

/**
 * The configurations a row lands on, by folded label — `[""]`, one unnamed
 * scope, on an item that names none. Read off the SAME plan the confirm writes
 * by, so the swap displaces exactly the rows that would otherwise collide.
 */
function scopeOf(observation: DrawingObservation, plan: NamedConfigurationPlan | null): string[] {
  if (!plan) return [""];
  return plan.rows[observation.id] ?? plan.labels;
}

/**
 * Which rows a swap of `moverId` into `slot` displaces, and how.
 *
 * Every OTHER pending dimension on the item holding `slot` whose scope meets
 * the mover's. A holder wholly inside the mover's scope becomes a note; one
 * that reaches further is narrowed to the configurations the mover does not
 * reach. A holder in no shared scope is left alone.
 */
export function planSlotSwap(
  item: DrawingItem,
  moverId: string,
  slot: DimensionSlot,
  plan: NamedConfigurationPlan | null,
): SlotSwapPlan {
  const mover = item.observations.find((row) => row.id === moverId);
  if (!mover) return { ok: false, code: "observation_missing", message: "That figure is no longer part of this item. Reload.", status: 409 };
  if (!canTakeSlot(mover)) {
    return {
      ok: false,
      code: "not_a_figure",
      message: "Only a figure can fill a size slot. This row states no measurement.",
      status: 400,
    };
  }
  const moverScope = scopeOf(mover, plan);
  if (moverScope.length === 0) {
    return {
      ok: false,
      code: "configuration_undecided",
      message: "This figure lands on no configuration. Say which configurations it applies to first.",
      status: 400,
    };
  }
  const displaced: Displacement[] = [];
  for (const holder of item.observations) {
    if (holder.id === mover.id || holder.reviewStatus !== "pending") continue;
    if (holder.attrGroup !== "dimension" || holder.dimensionSlot !== slot) continue;
    const holderScope = scopeOf(holder, plan);
    const shared = holderScope.filter((label) => moverScope.includes(label));
    if (shared.length === 0) continue;
    const rest = holderScope.filter((label) => !moverScope.includes(label));
    displaced.push(rest.length === 0 ? { observationId: holder.id, to: "note" } : { observationId: holder.id, to: "narrowed", configurations: rest });
  }
  return { ok: true, displaced };
}

/**
 * The PATCH a card sends for "Use as W".
 *
 * `displaces` lists every pending row on the item holding that slot, at the
 * version the card is showing — a SUPERSET of what the server will displace,
 * because which of them a configuration's scope reaches is the server's to
 * decide (`planSlotSwap`), not the card's. The server refuses the swap when a
 * row it would displace is missing from this list or has moved since.
 */
export function swapSlotRequest(
  item: Pick<DrawingItem, "observations">,
  mover: Pick<DrawingObservation, "id">,
  slot: DimensionSlot,
): { swapSlot: { slot: DimensionSlot; displaces: { id: string; version: number }[] } } {
  return {
    swapSlot: {
      slot,
      displaces: item.observations
        .filter(
          (row) =>
            row.id !== mover.id && row.reviewStatus === "pending" && row.attrGroup === "dimension" && row.dimensionSlot === slot,
        )
        .map((row) => ({ id: row.id, version: row.version })),
    },
  };
}

type Candidate = NonNullable<DrawingObservation["candidates"]>[number];

/**
 * A candidate as the read writes it in the schema's flat shape — one line,
 * "740 (SIDE ELEVATION, page 2)" — taken apart into its figure, its view and
 * its page. A structured candidate (view or page already given) is returned
 * as it is. The figure keeps its marks and any printed unit; the split into
 * figure and unit is `splitFigureAndUnit`'s, at the caller.
 *
 * Only a TRAILING bracket is read, and only "page N" / "p N" counts as a page:
 * anything else inside the bracket is the view, in the page's own words.
 */
export function readCandidateLine(candidate: Pick<Candidate, "valueRaw" | "view" | "page">): {
  figure: string;
  view: string | null;
  page: number | null;
} {
  if (candidate.view || candidate.page) {
    return { figure: candidate.valueRaw.trim(), view: candidate.view?.trim() || null, page: candidate.page ?? null };
  }
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(candidate.valueRaw.trim());
  if (!match || !match[1]!.trim()) return { figure: candidate.valueRaw.trim(), view: null, page: null };
  const parts = match[2]!.split(",").map((part) => part.trim()).filter(Boolean);
  let page: number | null = null;
  const last = parts[parts.length - 1];
  const pageMatch = last ? /^(?:page|p\.?)\s*(\d+)$/i.exec(last) : null;
  if (pageMatch) {
    page = Number(pageMatch[1]);
    parts.pop();
  }
  return { figure: match[1]!.trim(), view: parts.join(", ") || null, page };
}

/** Case, spaces and punctuation folded off a view's name: `ELEVATION 1` = `Elevation-1`. */
function foldView(view: string | null | undefined): string {
  return normaliseRef(view ?? "");
}

/**
 * The measured row a slot's candidate IS, or null.
 *
 * By the id staging recorded where there is one. A run staged before brief F
 * carries none, and the row is found by what the candidate says about itself —
 * the same figure, on the same page, off the same view where it names one.
 * Two rows matching is no answer: the button is not offered rather than
 * pointing at one of them.
 */
export function candidateRowFor(
  item: Pick<DrawingItem, "observations">,
  holder: Pick<DrawingObservation, "id" | "page">,
  candidate: Candidate,
): DrawingObservation | null {
  if (candidate.observationId) {
    const row = item.observations.find((entry) => entry.id === candidate.observationId) ?? null;
    return row && row.id !== holder.id && canTakeSlot(row) ? row : null;
  }
  const read = readCandidateLine(candidate);
  const figure = parseDimensionFigure(splitFigureAndUnit(read.figure).value).figure;
  if (figure === null) return null;
  const page = read.page ?? holder.page ?? null;
  const matches = item.observations.filter(
    (row) =>
      row.id !== holder.id &&
      canTakeSlot(row) &&
      parseDimensionFigure(row.value ?? row.valueRaw).figure === figure &&
      (page === null || row.page === undefined || row.page === null || row.page === page) &&
      (!read.view || foldView(row.view ?? row.labelRaw) === foldView(read.view)),
  );
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * A figure as millimetres, for the card's "Show in mm" (brief F, 2026-10-01 D3).
 *
 * DISPLAY ONLY. Nothing stored changes: the unit control states what the page
 * PRINTED and the composer converts. Matthew, 45:03: "You change it to
 * millimeters, it doesn't convert it" — correct, and a person checking
 * `5'-7"` against a millimetre bill wanted to SEE the conversion. So this
 * prints `1702 mm (5'-7")`, through `toMillimetres`, the composer's own step.
 *
 * A figure that cannot be converted says why IN THE COMPOSER'S WORDS — the
 * bracket `composeDimensionCell` writes in BWS field 3 — so the card and the
 * cell never give one figure two different excuses.
 */
export function millimetreReading(
  value: string | null,
  unit: AttributeUnit | null,
): { ok: true; text: string } | { ok: false; text: string } {
  const text = (value ?? "").trim();
  const { figure, tbcInline, imperial } = parseDimensionFigure(text);
  if (figure === null) {
    if (tbcInline || /^tbc\.?$/i.test(text)) return { ok: false, text: "TBC — no figure to convert" };
    return { ok: false, text: imperialCompound(text) ? "imperial, not converted" : "not a number" };
  }
  if (imperial && unit !== null && unit !== "in") return { ok: false, text: `feet and inches, recorded as ${unit}` };
  if (!unit && !imperial) return { ok: false, text: "no unit" };
  const converted = toMillimetres(text, unit ?? "in");
  if (!converted.ok) return { ok: false, text: converted.reason === "unit_conflict" ? `feet and inches, recorded as ${unit}` : "not a number" };
  if (unit === "mm") return { ok: true, text: `${converted.mm} mm` };
  const printed = valueCarriesItsUnit(text) ? text : `${text} ${unit ?? "in"}`;
  return { ok: true, text: `${converted.mm} mm (${printed})` };
}

/** "the width", for a sentence. */
export function slotWords(slot: DimensionSlot): string {
  return `the ${DIMENSION_SLOT_LABELS[slot].toLowerCase()}`;
}
