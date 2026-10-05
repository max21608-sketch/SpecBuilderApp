// What a document DOES to a spec, in the words a reviewer thinks in.
//
// ============================================================================
// Asked for on 2026-09-17, on first sight of a real email's review screen:
// "just a table listing each of the specs and then just list the changes. So
// what's happened to the seat height? Okay, they've provided the seat height,
// or maybe they've just confirmed seat height. And then you can say what
// they've confirmed it at."
//
// The screen used to render each proposal as a card carrying the model's own
// reasoning — "Subject line states 'seat height confirmed', and email opens
// with 'we can confirm', indicating this was previously undecided and is now
// settled." That is true, and it is a paragraph per value, and seven of them
// is a page nobody reads to the end. What a reviewer needs first is one verb.
//
// THE VERB IS DERIVED FROM STATE, NOT FROM WORDING. `changeIntent` is what the
// model thought the email was doing; the target snapshot is what the record
// actually holds. Where they disagree the RECORD wins, because the record is
// the thing about to be written and the intent is a reading. The intent is
// kept for one case it alone can carry — a value being withdrawn back to
// undecided, which carries no TBC token in the value — and that case already
// reaches the proposed state through `emailAwareState`, so this only has to
// name it.
//
// Nothing here decides anything or blocks anything. It is a LABEL. Blockers
// are still computed by `proposalBlockers`, and a row that cannot commit still
// says so beside the action.
// ============================================================================
import type { AnswerState } from "@/lib/spec-vocab";
import { heldReading, type HeldTarget, type Proposal } from "@/lib/spec-document";
import { composeDimensionCell } from "@/lib/dimensions";

/**
 * The value an item already holds, as a person reads it. A dimension goes
 * through the one composer's SCREEN mode, so the bill's `21"` reads
 * `W 21" (533mm)` rather than `21"in`; anything else is its value and unit.
 */
function heldText(proposal: Proposal, held: HeldTarget): string {
  if (proposal.dimension) {
    return composeDimensionCell(
      [{ slot: proposal.dimension.slot, value: held.value, unit: held.unit, state: held.state === "tbc" ? "tbc" : "confirmed", sortOrder: 0 }],
      null,
      { mode: "screen" },
    ).text;
  }
  return [held.value, held.unit].filter(Boolean).join(" ");
}

export type ChangeKind =
  | "provides" // nobody had answered this
  | "confirms" // it was TBC, and now it is settled
  | "changes" // it was settled, and this is a different value
  | "repeats" // it was settled, and this says the same thing
  | "agrees" // the BILL says this already: nothing is written
  | "disagrees" // the BILL says something else: kept beside it, in red, until a person decides
  | "withdraws" // it was settled, and this puts it back to undecided
  | "not_applicable" // this says the question does not apply
  | "no_question" // the ITEM is known; which question this answers is not
  | "unplaced"; // no item yet, so there is nothing to compare against

export type ChangeDescription = {
  kind: ChangeKind;
  /** The verb, for the column. Six words at most. */
  label: string;
  /** What it was before, when that is worth showing beside the new value. */
  was: string | null;
  /**
   * Whether this needs a person to look rather than to skim. Drives the amber
   * row, and it is deliberately NOT the same thing as a blocker: `changes`
   * blocks too (the overwrite acknowledgement), but `withdraws` is notable and
   * `repeats` is notable and neither is refused.
   */
  notable: boolean;
};

function describeValue(state: AnswerState | null, value: string | null): string {
  if (state === "na") return "not applicable";
  if (state === "tbc" && !(value ?? "").trim()) return "TBC";
  return (value ?? "").trim() || "—";
}

/** Case- and whitespace-insensitive, because "445mm" and "445 mm " are one answer. */
function sameValue(a: string | null, b: string | null): boolean {
  const norm = (raw: string | null) => (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a) === norm(b) && norm(a) !== "";
}

/**
 * The two verbs a value the BILL already holds gets, ahead of everything else:
 * the bill was there first and the screen says so in its own words. Null where
 * the held value is not the bill's, or nothing is held.
 *
 * `disagrees` with the replace tick set is a CHANGE — the reviewer has chosen
 * this document's value over the bill's, and the row says it replaces it.
 */
function overTheBill(proposal: Proposal, what: string): ChangeDescription | null {
  const held = proposal.attributeTarget;
  if (!held || held.fromBill !== true || held.moved) return null;
  const reading = heldReading(proposal);
  const was = heldText(proposal, held);
  if (reading === "same") return { kind: "agrees", label: "Agrees with the bill", was: null, notable: false };
  if (reading !== "bill_differs") return null;
  return proposal.overwriteAcknowledged
    ? { kind: "changes", label: `Replaces the bill's ${what}`, was, notable: true }
    : { kind: "disagrees", label: "Disagrees with the bill", was, notable: true };
}

export function describeChange(proposal: Proposal): ChangeDescription {
  // A NOTE: a statement no question matched, kept against the item.
  if (proposal.note) {
    if (!proposal.recordId) return { kind: "unplaced", label: "Item not found", was: null, notable: true };
    const bill = overTheBill(proposal, "note");
    if (bill) return bill;
    if (proposal.attributeTarget && heldReading(proposal) === "same") {
      return { kind: "repeats", label: "Repeats the note", was: null, notable: false };
    }
    return { kind: "provides", label: "Kept as a note", was: null, notable: false };
  }

  // A DIMENSION is compared against the attribute it would replace, not
  // against a checklist answer: the answer is composed from every slot the
  // record holds, so "what this says" is about this slot alone.
  if (proposal.dimension) {
    const slot = proposal.dimension.slot;
    const held = proposal.attributeTarget;
    if (!proposal.recordId) {
      return { kind: "unplaced", label: "Item not found", was: null, notable: true };
    }
    const bill = overTheBill(proposal, slot);
    if (bill) return bill;
    if (proposal.dimension.tbc) {
      return held
        ? { kind: "withdraws", label: `${slot} back to TBC`, was: heldText(proposal, held), notable: true }
        : { kind: "provides", label: `Records ${slot} as TBC`, was: null, notable: false };
    }
    if (!held) {
      return { kind: "provides", label: `Provides ${slot}`, was: null, notable: false };
    }
    const heldRaw = [held.value, held.unit].filter(Boolean).join("");
    const newText = [proposal.dimension.figure, proposal.dimension.unit].filter(Boolean).join("");
    // The SAME measurement written differently (55cm over 550mm) repeats it:
    // the comparison the blockers read, so the verb and the blocker agree.
    return sameValue(heldRaw, newText) || heldReading(proposal) === "same"
      ? { kind: "repeats", label: `Repeats ${slot}`, was: null, notable: false }
      : { kind: "changes", label: `Changes ${slot}`, was: heldText(proposal, held), notable: true };
  }

  if (proposal.finish) {
    const what = proposal.finish.specFieldName ?? "finish";
    if (!proposal.recordId) return { kind: "unplaced", label: "Item not found", was: null, notable: true };
    const bill = overTheBill(proposal, what);
    if (bill) return bill;
    const held = proposal.attributeTarget;
    if (proposal.finish.tbc) {
      return held
        ? { kind: "withdraws", label: `${what} back to TBC`, was: held.value, notable: true }
        : { kind: "provides", label: `Records ${what} as TBC`, was: null, notable: false };
    }
    if (!held) return { kind: "provides", label: `Provides ${what}`, was: null, notable: false };
    return sameValue(held.value, proposal.finish.value) || heldReading(proposal) === "same"
      ? { kind: "repeats", label: `Repeats ${what}`, was: null, notable: false }
      : { kind: "changes", label: `Changes ${what}`, was: held.value, notable: true };
  }

  const target = proposal.target;
  if (!target) {
    // TWO DIFFERENT STATES, and collapsing them was a row that contradicted
    // itself: "3 runs" in the Applies to column beside "Not yet placed". Once
    // the run fan-out lands, the item is the half that resolves and the
    // question is the half that does not — `requirement_aliases` is empty, so
    // "Seat height" scores nothing against a category that asks "Dimensions".
    // A reviewer told "not placed" goes looking for the item, which is already
    // right; what they actually have to do is pick the question.
    return proposal.recordId
      ? { kind: "no_question", label: "Question not matched", was: null, notable: true }
      : { kind: "unplaced", label: "Item not found", was: null, notable: true };
  }

  const before = target.answerExists ? target.answerState : "missing";
  const beforeValue = target.answerValue;
  const after = proposal.proposedState;

  if (after === "na") {
    return { kind: "not_applicable", label: "Marks not applicable", was: null, notable: true };
  }

  // Settled, and going back to undecided. The one case the wording alone
  // cannot produce, which is why `changeIntent` exists at all.
  if (after === "tbc" && (before === "confirmed" || before === "na")) {
    return {
      kind: "withdraws",
      label: "Puts back to TBC",
      was: describeValue(before, beforeValue),
      notable: true,
    };
  }

  if (before === "tbc") {
    // It was actively undecided and now it is not. This is the commonest
    // useful thing an email does and it deserves the plainest word.
    return after === "tbc"
      ? { kind: "repeats", label: "Still TBC", was: null, notable: false }
      : { kind: "confirms", label: "Confirms", was: "TBC", notable: false };
  }

  if (before === "confirmed" || before === "na") {
    if (sameValue(beforeValue, proposal.proposedValue)) {
      // Worth its own word. A reviewer skimming for what MOVED should be able
      // to skip it, and a row silently absent would read as a value nobody
      // mentioned rather than one the email restated.
      return { kind: "repeats", label: "Repeats what we hold", was: null, notable: false };
    }
    return {
      kind: "changes",
      label: "Changes",
      was: describeValue(before, beforeValue),
      notable: true,
    };
  }

  // `missing`: nobody has answered it. Max's word for this is "provided".
  return after === "tbc"
    ? { kind: "provides", label: "Records as TBC", was: null, notable: false }
    : { kind: "provides", label: "Provides", was: null, notable: false };
}
