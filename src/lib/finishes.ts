// The project's finishes library: one row per client finish code.
//
// ============================================================================
// THE LIBRARY IS THE TRUTH; THE ATTRIBUTE IS THE EVIDENCE.
//
// `record_attributes.value` keeps what the drawing literally said about THIS
// item, verbatim, because that is what makes a value re-checkable against its
// page. The FINISH holds what the code currently means. A linked attribute
// therefore renders as the finish, and correcting CH-01.1 once corrects every
// item carrying it — which is not a convenience here but the only correction
// mechanism there is: the pilot's finishes schedule is confirmed absent, so
// the codes exist only on the drawings.
//
// ---- ONE COMPOSER, THREE CALLERS ---------------------------------------
//
// `composeFinishCell` is called by the export composer, by the record screen,
// and by promote-answers when it writes the checklist answer. If the export
// rendered the finish and the checklist kept the old attribute text, editing
// the library would silently change forty export cells while every row a
// person can see said something else. That is the failure CLAUDE.md names
// about `composeDimensionCell`, in a second place.
//
// ---- THE STATE RULE ----------------------------------------------------
//
// A cell is only as settled as the weaker of the two: a `tbc` finish can never
// produce a confirmed value, whatever the attribute said. The Panther sofa
// records a fabric reading "TBC – Yarn Collective…", and a gate reporting
// satisfied over a fabric nobody has chosen is the exact trap promote-answers
// was written to avoid.
// ============================================================================
import type { AttributeState } from "@/lib/spec-vocab";

export const FINISH_KINDS = ["fabric", "leather", "timber", "metal", "stone", "glass", "paint", "other"] as const;
export type FinishKind = (typeof FINISH_KINDS)[number];

export const FINISH_KIND_LABELS: Record<FinishKind, string> = {
  fabric: "Fabric",
  leather: "Leather",
  timber: "Timber",
  metal: "Metal",
  stone: "Stone",
  glass: "Glass or mirror",
  paint: "Paint or lacquer",
  other: "Other",
};

export function isFinishKind(value: unknown): value is FinishKind {
  return typeof value === "string" && (FINISH_KINDS as readonly string[]).includes(value);
}

export type Finish = {
  id: string;
  code: string;
  codeNorm: string;
  kind: FinishKind | null;
  description: string | null;
  supplierRaw: string | null;
  reference: string | null;
  colour: string | null;
  state: AttributeState;
};

/**
 * Case and whitespace, and NOTHING ELSE.
 *
 * `CH-01.1` and `CH-01-1` stay two finishes. A normaliser clever enough to
 * merge them is clever enough to merge two codes a client meant to keep apart
 * — and there is no way back from a silent merge, because the two sets of
 * items are now one. Merging is a button somebody presses.
 */
export function normaliseFinishCode(code: string): string {
  return code.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * How a linked finish reads in a BWS cell.
 *
 * Follows FMT-COM-01 from docs/bws-spec-grid.md: the client's own code first,
 * because that is how the fabric is tracked on their schedule, then the
 * supplier's reference, because that is what gets ordered. Dropping either
 * makes the line unorderable or untraceable.
 *
 * The quantity FMT-COM-01 also asks for is not here: nothing in this app knows
 * a fabric's metreage, and inventing a number for a cell somebody orders
 * against would be worse than leaving the gap visible.
 */
export function composeFinishCell(finish: Finish): string {
  const parts = [finish.description, finish.supplierRaw, finish.reference, finish.colour]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const body = parts.join(" ");
  if (!body) return finish.code;
  return `${finish.code}; ${body}`;
}

/**
 * The state a value takes when it comes through a finish: the weaker of the
 * two. Only a confirmed attribute carrying a confirmed finish is confirmed.
 */
export function combineFinishState(attributeState: AttributeState, finish: Finish | null): AttributeState {
  if (!finish) return attributeState;
  return attributeState === "confirmed" && finish.state === "confirmed" ? "confirmed" : "tbc";
}

/**
 * What a drawing's raw code resolves to against the library.
 *
 * `conflict` is the case that must never be resolved automatically: the code
 * exists and says something different from what this page says. Either the
 * library is out of date or this page is, and the reviewer is the only one who
 * can tell. Offered as a choice, never picked.
 */
export type FinishResolution =
  | { status: "none" }
  | { status: "new"; code: string; codeNorm: string }
  | { status: "matched"; finish: Finish }
  | { status: "conflict"; finish: Finish; saysInstead: string };

export function resolveFinishCode(
  materialCodeRaw: string | null,
  observedValue: string | null,
  library: Finish[],
): FinishResolution {
  const raw = materialCodeRaw?.trim();
  if (!raw) return { status: "none" };
  const codeNorm = normaliseFinishCode(raw);
  if (!codeNorm) return { status: "none" };

  const finish = library.find((entry) => entry.codeNorm === codeNorm);
  if (!finish) return { status: "new", code: raw, codeNorm };

  // A conflict only when the library has actually committed to a description.
  // A `tbc` finish with no description is waiting to be told, not disagreeing.
  const described = finish.description?.trim();
  const says = observedValue?.trim();
  if (described && says && described.toLowerCase() !== says.toLowerCase()) {
    return { status: "conflict", finish, saysInstead: says };
  }
  return { status: "matched", finish };
}
