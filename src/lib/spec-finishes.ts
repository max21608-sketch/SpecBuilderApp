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
import { COM_ONLY_VALUES, NO_FIELD_CODE_PREFIXES, ZONED_CODE } from "@/lib/spec-reading-vocab";

export type FinishReading = {
  /**
   * What the finish is, as `classifyCallout` read it. NULL for a statement this
   * app keeps against the item and places in NO field — a stone code, and
   * "Fabric: COM" — which is why `noField` says so in words.
   */
  kind: Exclude<CalloutKind, null> | null;
  group: AttributeGroup;
  /** The client's own code, exactly as written. Null on the TBC path. */
  codeRaw: string | null;
  /**
   * The code as `classifyCallout` reads it: `GR-TIM-09` is read as `TIM-09`,
   * because the leading `GR-` is the document's own zone and says nothing about
   * the material. Null where there is no code.
   */
  kindCodeRaw: string | null;
  /** Why, in the reviewer's words. */
  reason: string | null;
  /** True when the value states no substance, only that it is undecided. */
  tbc: boolean;
  /**
   * The part of the value this statement is. The whole value, except where one
   * value names several codes — "STN-02, MTL-01, TIM-03" is three statements,
   * one per code, and each is written as what it says.
   */
  value: string | null;
  /**
   * Why this statement fills NO BWS field, whatever slots are free. Null for an
   * ordinary finish. Kept against the item as the document wrote it, never
   * dropped and never pushed into the nearest field.
   */
  noField: string | null;
};

/**
 * A client finish code at the START of a value: `UPH-07`, `WD-05`, `CLO003`,
 * `CH-01.1`, `MT 01`, and a code under a zone of the document's own —
 * `GR-TIM-09`, `GR-MTL-03`.
 *
 * Anchored, so "oak, see UPH-07 for the seat" does not read as a fabric: a
 * code mentioned in passing is a cross-reference, and the value's own subject
 * is what this row records.
 */
export function leadingFinishCode(valueRaw: string | null): string | null {
  const value = (valueRaw ?? "").trim();
  if (!value) return null;
  // Ends where the digits end, not at a word boundary: a bill cell run
  // together, "GR-MTL-01ANTIQUE BRONZE", still leads with GR-MTL-01.
  const match = /^((?:[A-Za-z]{2,4}-)?[A-Za-z]{2,4}[-\s.]?\d{1,4}(?:[.\-]\d{1,3})?)(?![0-9])/.exec(value);
  return match?.[1]?.trim() ?? null;
}

/** `GR-TIM-09` → `TIM-09`; a code with no zone comes back as it is. */
export function kindCode(code: string): string {
  return ZONED_CODE.exec(code)?.[1] ?? code;
}

/**
 * "COM" as a fabric's whole value: customer's own material. The CLIENT
 * supplies the cloth, so the statement names no fabric — and reading the word
 * COM as a fabric (it is in the callout word list, rightly, for a drawing's
 * "COM 1" caption) would claim COM 1 on an item whose actual fabric the bill
 * gives on its own line.
 */
const COM_ONLY = new Set(COM_ONLY_VALUES);

function isTbc(valueRaw: string | null): boolean {
  const norm = normaliseName(valueRaw ?? "");
  if (!norm) return false;
  return TBC_TOKENS.includes(norm) || TBC_TOKENS.some((token) => containsPhrase(norm, token));
}

/**
 * Every finish one value states, in printed order. Empty where it states none.
 *
 * Several codes in one value — "STN-02, MTL-01, TIM-03" — are several
 * statements, split only where EVERY piece leads with a code: "oak, limed" is
 * one statement with a comma in it.
 */
export function readFinishes(attributeRaw: string | null, valueRaw: string | null): FinishReading[] {
  const value = (valueRaw ?? "").trim();
  if (!value) return [];

  if (COM_ONLY.has(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())) {
    const noField =
      "COM is customer's own material: the client supplies the fabric, and this names none. Kept as a note on the item; it fills no COM slot.";
    return [{ kind: null, group: "note", codeRaw: null, kindCodeRaw: null, reason: noField, tbc: false, value, noField }];
  }

  // A NEW LINE separates statements too: a bill's cell writes "GR-TIM-07
  // LIME WASHED OAK" over "GR-MTL-01 ANTIQUE BRONZE", and read as one value the
  // word "bronze" made the timber a metal.
  const pieces = value.split(/\s*[,;&+\n]\s*|\s+and\s+/i).map((piece) => piece.trim()).filter(Boolean);
  const several = pieces.length >= 2 && pieces.every((piece) => leadingFinishCode(piece) !== null);
  const statements = several ? pieces : [value];
  return statements
    .map((statement) => readOne(attributeRaw, statement))
    .filter((reading): reading is FinishReading => reading !== null);
}

/** The first finish a value states, or null. `readFinishes` is the whole reading. */
export function readFinish(attributeRaw: string | null, valueRaw: string | null): FinishReading | null {
  return readFinishes(attributeRaw, valueRaw)[0] ?? null;
}

function readOne(attributeRaw: string | null, valueRaw: string): FinishReading | null {
  const code = leadingFinishCode(valueRaw);
  const tbc = isTbc(valueRaw);
  if (!code && !tbc) return null;
  const readAs = code ? kindCode(code) : null;

  if (readAs) {
    const letters = normaliseName(readAs).replace(/[^a-z]/g, "");
    const unplaced = NO_FIELD_CODE_PREFIXES.find((entry) => letters.startsWith(entry.prefix));
    if (unplaced) {
      const noField = `${code} ${unplaced.what ? `is a ${unplaced.what} code` : "is a finish code"} and no BWS field holds it. Kept against the item as the bill wrote it; it fills no field.`;
      return { kind: null, group: "finish", codeRaw: code, kindCodeRaw: readAs, reason: noField, tbc, value: valueRaw, noField };
    }
  }

  const callout = classifyCallout({
    labelRaw: attributeRaw,
    valueRaw,
    materialCodeRaw: readAs,
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
    kindCodeRaw: readAs,
    // The reason names the code as the document printed it, zone and all.
    reason: code && readAs && callout.reason ? callout.reason.replace(readAs, code) : callout.reason,
    tbc,
    value: valueRaw,
    noField: null,
  };
}
