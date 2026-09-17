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
import type { Proposal } from "@/lib/spec-document";

export type ChangeKind =
  | "provides" // nobody had answered this
  | "confirms" // it was TBC, and now it is settled
  | "changes" // it was settled, and this is a different value
  | "repeats" // it was settled, and this says the same thing
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

export function describeChange(proposal: Proposal): ChangeDescription {
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
