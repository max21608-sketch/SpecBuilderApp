// The BW standard: what we will make, held BESIDE what the client specified.
//
// ============================================================================
// ONE COLUMN HAD STARTED MEANING TWO THINGS (0041).
//
// The drawings card offered a BWS palette under a timber callout and picking
// an option wrote the option into the observation's `value`, so after confirm
// "feet dark tinted wood as per approved sample" survived only inside
// `intake_runs.parsed`. The workflow the columns now hold (Max, 2026-09-23):
// the client specifies "30% oak", BW proposes its standard "25% oak", the
// client agrees -- and both stay visible for ever. `record_attributes.value`
// is what the DOCUMENT said, always; the standard is the six `standard_*`
// columns beside it.
//
// ---- WHAT THIS FILE DECIDES, ONCE -----------------------------------------
//
//   * WHICH HALF SHIPS. `composeAttributeStatement` is the single choice
//     between the standard, the finishes library and the page's own words.
//     `renderAttributeValue` (the BWS cell, the quote) and `planAnswerFills`
//     (the checklist answer) both call it, so the file and the checklist
//     cannot disagree about which half a record carries -- the
//     `composeDimensionCell` rule, one layer up.
//   * WHAT A STANDARD DOES TO THE STATE. `stateUnderStandard` is the whole
//     rule and it is a DEFAULT awaiting Max (the plan's question 2): a
//     proposed standard holds the item at TBC until the client agrees. It is
//     one function so that answering the question is a one-line change.
//
// A leaf: nothing here reads a database or renders anything, so the pure
// tier proves it and a client component can import it.
// ============================================================================
import type { AttributeState } from "@/lib/spec-vocab";
import { combineFinishState, composeFinishCell, type Finish } from "@/lib/finishes";

/** Mirrors `record_attributes_standard_state_check` (0041). */
export const STANDARD_STATES = ["proposed", "agreed", "tbc"] as const;
export type StandardState = (typeof STANDARD_STATES)[number];

export function isStandardState(value: unknown): value is StandardState {
  return typeof value === "string" && (STANDARD_STATES as readonly string[]).includes(value);
}

/** Said beside the option on every screen, in the reviewer's words. */
export const STANDARD_STATE_LABELS: Record<StandardState, string> = {
  proposed: "proposed",
  agreed: "agreed by the client",
  tbc: "TBC — BW to propose one",
};

/**
 * A standard as it is held on an attribute, a snapshot and a staged row.
 *
 * `value` and `optionId` are null exactly when the state is `tbc` -- the
 * shape 0041's CHECK enforces, repeated here so a fixture cannot hold one the
 * database would refuse.
 */
export type AttributeStandard = {
  value: string | null;
  optionId: string | null;
  state: StandardState;
};

/** Row columns → the standard, or null where the row carries none. */
export function standardFromRow(row: Record<string, unknown>): AttributeStandard | null {
  if (!isStandardState(row.standard_state)) return null;
  const value = row.standard_value === null || row.standard_value === undefined ? null : String(row.standard_value);
  const optionId =
    row.standard_option_id === null || row.standard_option_id === undefined ? null : String(row.standard_option_id);
  return { value, optionId, state: row.standard_state };
}

/** A finish's own columns (0045), as `loadRecordAtoms` and `loadPromotable` alias them. */
export function finishStandardFromRow(row: Record<string, unknown>): AttributeStandard | null {
  return standardFromRow({
    standard_value: row.finish_standard_value,
    standard_option_id: row.finish_standard_option_id,
    standard_state: row.finish_standard_state,
  });
}

/**
 * WHICH BW STANDARD IS IN FORCE ON AN ATTRIBUTE — the one rule (0045).
 *
 * Max, 2026-10-05: "BW own finishes should be set once per code in the
 * finishes library." Per code only, no per-item override. So:
 *
 *   * LINKED to a finish: the FINISH's standard, and nothing else -- it wins
 *     over any standard the attribute carries from before 0045, and where the
 *     library has set none, none is in force. Falling back to the item's own
 *     there would be the per-item override Max ruled out, arriving by the
 *     back door the day somebody clears the library's.
 *   * UNLINKED: the attribute's own (0041), exactly as before. There is no
 *     code to set it on.
 *
 * Every reader calls this -- the cell (`composeAttributeStatement`), the
 * checklist answer, the check sheet's BW standard column, the quote's
 * metalwork test and a version diff -- so none of them can be the one place
 * the library's choice does not reach. A second precedence rule beside this
 * one is the `composeDimensionCell` failure, one layer up.
 */
export function standardInForce(attribute: {
  standard?: AttributeStandard | Pick<AttributeStandard, "value" | "state"> | null;
  finish?: { standard?: AttributeStandard | null } | null;
}): Pick<AttributeStandard, "value" | "state"> | null {
  if (attribute.finish) return attribute.finish.standard ?? null;
  return attribute.standard ?? null;
}

/**
 * The item's OWN earlier standard that the library now overrides, or null.
 *
 * For the record screen's one sentence under a linked spec: a per-item choice
 * made before 0045 is kept on the row as history and no longer ships, and a
 * reader comparing the item with its old export has to be told why rather
 * than left to find it.
 */
export function replacedItemStandard(attribute: {
  standard?: Pick<AttributeStandard, "value" | "state"> | null;
  finish?: { standard?: AttributeStandard | null } | null;
}): Pick<AttributeStandard, "value" | "state"> | null {
  const own = attribute.standard ?? null;
  if (!attribute.finish || !own) return null;
  const library = attribute.finish.standard ?? null;
  if (library && library.state === own.state && (library.value ?? null) === (own.value ?? null)) return null;
  return own;
}

/** The option a standard names, where it names one that ships. */
export function shippedStandardValue(standard: Pick<AttributeStandard, "value" | "state"> | null | undefined): string | null {
  if (!standard) return null;
  if (standard.state !== "proposed" && standard.state !== "agreed") return null;
  const value = standard.value?.trim();
  return value ? value : null;
}

/**
 * WHAT A STANDARD DOES TO THE ITEM'S STATE — the one rule, awaiting Max.
 *
 * DEFAULT (the plan's question 2, 2026-09-23): a PROPOSED standard holds the
 * answer at `tbc` -- "awaiting client agreement of the BW standard" -- so the
 * chase can ask "Can you accept BW Oak Grey 25% for the 30% oak specified?".
 * An AGREED one settles it at the attribute's own state. A standard that is
 * itself TBC ("BW will propose one") holds it at `tbc` too: nothing has been
 * agreed, and a gate passed over a standard nobody has named is a gate passed
 * by nobody. No standard: exactly as before 0041.
 *
 * If Max answers that a proposal counts as settled, the `proposed` line is
 * the whole change.
 */
export function stateUnderStandard(
  ownState: AttributeState,
  standard: Pick<AttributeStandard, "state"> | null | undefined,
): AttributeState {
  if (!standard) return ownState;
  switch (standard.state) {
    case "proposed":
      return "tbc";
    case "agreed":
      // THE CLIENT'S AGREEMENT IS THE DECISION (Max, 2026-09-23: the client
      // asks for 30% oak, BW offers its 25% standard, the client says "yes,
      // that's fine"). What the client first wrote may well have been TBC —
      // that is why a standard was offered — and holding the answer at TBC
      // after they agreed would put a settled finish back on somebody's desk.
      return "confirmed";
    case "tbc":
      return "tbc";
  }
}

/** Why a standard holds an answer at TBC, for the screens that say so. */
export function standardHoldReason(standard: Pick<AttributeStandard, "state"> | null | undefined): string | null {
  if (!standard) return null;
  if (standard.state === "proposed") return "awaiting client agreement of the BW standard";
  if (standard.state === "tbc") return "awaiting a BW standard";
  return null;
}

/**
 * WHICH HALF A RECORD CARRIES, and in what state. The single choice.
 *
 * In order, stopping at the first that says something:
 *
 *   1. A BW standard that ships (proposed or agreed) -- the one IN FORCE,
 *      which for a linked attribute is the finish's (`standardInForce`,
 *      0045). It is what we will make, and a BWS import is the instruction
 *      to make it.
 *   2. A linked finish, rendered as the LIBRARY says it is -- the finishes
 *      library is the truth and the attribute is the evidence (0018).
 *   3. The page's own words.
 *
 * NO UNIT, NO MARKER, NO QUALIFIER. Those are the cell's business
 * (`renderAttributeValue`), and an answer carries its qualifier in its own
 * column. `fromStandard` says which branch won, so the cell does not append a
 * figure's unit to a BWS option name.
 */
export function composeAttributeStatement(attribute: {
  value: string | null;
  state: AttributeState;
  finish?: Finish | null;
  standard?: Pick<AttributeStandard, "value" | "state"> | null;
}): { value: string; state: AttributeState; fromStandard: boolean } {
  const finish = attribute.finish ?? null;
  const ownState = finish ? combineFinishState(attribute.state, finish) : attribute.state;
  const standard = standardInForce(attribute);
  const state = stateUnderStandard(ownState, standard);
  const standardValue = shippedStandardValue(standard);
  if (standardValue) return { value: standardValue, state, fromStandard: true };
  // An INTERNAL finish composes to its description alone, so where somebody
  // has cleared that description there is nothing to say -- and this page's
  // own words are what the cell said before the library held this fabric.
  const value = (finish ? composeFinishCell(finish) : "") || (attribute.value?.trim() ?? "");
  return { value, state, fromStandard: false };
}

/** "BW Oak Grey - Open grain 10% (proposed)", or null for no standard. */
export function describeStandard(standard: Pick<AttributeStandard, "value" | "state"> | null | undefined): string | null {
  if (!standard) return null;
  if (standard.state === "tbc") return STANDARD_STATE_LABELS.tbc;
  return `${standard.value ?? "—"} (${STANDARD_STATE_LABELS[standard.state]})`;
}

// ---- at intake ----------------------------------------------------------------

/**
 * The standard a reviewer set on a drawings row, before confirm.
 *
 * Only `proposed` or `tbc` at intake: an AGREEMENT is the client's, recorded
 * after confirm with the email that says so. `optionId` is resolved by the
 * server from the field's own palette at the autosave and again at confirm;
 * the client names the option by its value and never by an id.
 */
export type StagedStandard =
  | { state: "proposed"; value: string; optionId: string | null }
  | { state: "tbc"; value: null; optionId: null };
