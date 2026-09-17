// Reading a FINISH out of an email — a fabric, a timber, a metal, a piece of
// hardware — and sending it the same way a drawing's callout goes.
//
// ============================================================================
// WHY NOT AN ALIAS VOCABULARY
//
// The first real email stated five specifications this app could not place,
// and the obvious fix was to seed `requirement_aliases` so "Outside back"
// matched the COM 1 question. It is the wrong fix, for the reason dimensions
// were: a finish does not reach its field by matching a question either. It
// carries a BWS FIELD — COM 1, COM 2, Main timber finish — and which slot it
// takes depends on what the record already holds. An alias would have to name
// one slot up front, and "Outside back means COM 1" is a mapping nobody has
// agreed and the next item contradicts.
//
// So a finish becomes a `record_attributes` row carrying its spec field, and
// the checklist answer follows from `promote-answers.ts` — the drawings path,
// unchanged. Two more things come out right for free: the client's own code is
// kept where `project_finishes` can find it, and `classifyCallout` stays the
// SINGLE reading behind both the group and the field.
//
// ============================================================================
// THE GATE: THE DOCUMENT'S OWN CODE
//
// `classifyCallout` reads words as well as codes, and on a DRAWING that is
// right — a callout is a short caption. An email is prose, and "seat
// upholstery build — loose or fixed?" would read as a fabric on the strength
// of one word and land a build instruction in COM 1.
//
// So this refuses anything the document has not put a CODE on. `UPH-07`,
// `WD-05`, `CLO003`, `CH-01.1` are the client speaking, they are unambiguous,
// and every finish the pilot email states carries one. The single exception is
// a material label whose value is TBC — "Fabric (B configuration): TBC" — which
// carries no substance to misread and is worth recording as an undecided
// fabric rather than losing.
//
// Everything else returns null and falls through to requirement matching,
// exactly as before.
// ============================================================================
import { classifyCallout, type CalloutKind } from "@/lib/drawing-document";
import { containsPhrase, TBC_TOKENS, type AttributeGroup } from "@/lib/spec-vocab";
import { normaliseName } from "@/lib/matching";

export type FinishReading = {
  kind: Exclude<CalloutKind, null>;
  group: AttributeGroup;
  /** The client's own code, exactly as written. Null on the TBC path. */
  codeRaw: string | null;
  /** Why, in the reviewer's words. */
  reason: string | null;
  /** True when the value states no substance, only that it is undecided. */
  tbc: boolean;
};

/**
 * A client finish code at the START of a value: `UPH-07`, `WD-05`, `CLO003`,
 * `CH-01.1`, `MT 01`.
 *
 * Anchored, so "oak, see UPH-07 for the seat" does not read as a fabric: a
 * code mentioned in passing is a cross-reference, and the value's own subject
 * is what this row records.
 */
export function leadingFinishCode(valueRaw: string | null): string | null {
  const value = (valueRaw ?? "").trim();
  if (!value) return null;
  const match = /^([A-Za-z]{2,4}[-\s.]?\d{1,4}(?:[.\-]\d{1,3})?)\b/.exec(value);
  return match?.[1]?.trim() ?? null;
}

function isTbc(valueRaw: string | null): boolean {
  const norm = normaliseName(valueRaw ?? "");
  if (!norm) return false;
  return TBC_TOKENS.includes(norm) || TBC_TOKENS.some((token) => containsPhrase(norm, token));
}

export function readFinish(attributeRaw: string | null, valueRaw: string | null): FinishReading | null {
  const code = leadingFinishCode(valueRaw);
  const tbc = isTbc(valueRaw);
  if (!code && !tbc) return null;

  const callout = classifyCallout({
    labelRaw: attributeRaw,
    valueRaw,
    materialCodeRaw: code,
    // Deliberately NOT passed: `itemNameRaw` enables the last-resort "the
    // caption names the item itself" inference, which is a reading of a
    // drawing's layout and means nothing in an email.
  });
  if (!callout.kind) return null;

  // A TBC value is only worth recording where the LABEL named the material.
  // Without a code, the words are all there is, and "TBC" against a label the
  // word list did not recognise is a row this cannot place.
  if (!code && callout.guessed) return null;

  return {
    kind: callout.kind,
    group: callout.group,
    codeRaw: code,
    reason: callout.reason,
    tbc,
  };
}
