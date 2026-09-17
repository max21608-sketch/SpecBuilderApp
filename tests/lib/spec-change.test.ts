// What a document DOES to a spec — the verb the review table leads with.
//
// The rule under test is that the verb comes from the RECORD's state, not from
// the model's reading of the wording. A reviewer acts on what is about to be
// written.
import { describe, expect, it } from "vitest";
import { describeChange } from "@/lib/spec-change";
import type { Proposal, TargetSnapshot } from "@/lib/spec-document";
import type { AnswerState } from "@/lib/spec-vocab";

function target(overrides: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return {
    recordId: "rec-1",
    recordLabel: "AP364c-011",
    recordVersion: 3,
    requirementId: "req-1",
    requirementPrompt: "Seat height",
    requirementKind: "spec_field",
    answerExists: true,
    answerId: "ans-1",
    answerVersion: 1,
    answerState: "missing",
    answerValue: null,
    ...overrides,
  };
}

function proposal(
  answerState: AnswerState | null,
  answerValue: string | null,
  proposedState: AnswerState | null,
  proposedValue: string | null,
): Proposal {
  return {
    id: "p1",
    sourceOrdinal: 0,
    version: 1,
    raw: { refRaw: "S-201", attributeRaw: "Seat height", valueRaw: proposedValue } as Proposal["raw"],
    recordCandidates: [],
    requirementCandidates: [],
    recordId: "rec-1",
    requirementId: "req-1",
    target: answerState === null ? null : target({ answerState, answerValue, answerExists: true }),
    proposedValue,
    proposedState,
    stateReason: null,
    overwriteAcknowledged: false,
    reviewStatus: "pending",
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
  };
}

describe("describeChange", () => {
  it("calls a value nobody had answered 'provides'", () => {
    const change = describeChange(proposal("missing", null, "confirmed", "445mm"));
    expect(change.kind).toBe("provides");
    expect(change.label).toBe("Provides");
    expect(change.notable).toBe(false);
  });

  it("calls settling an actively-undecided answer 'confirms', and says it was TBC", () => {
    const change = describeChange(proposal("tbc", null, "confirmed", "445mm"));
    expect(change.kind).toBe("confirms");
    expect(change.was).toBe("TBC");
    expect(change.notable).toBe(false);
  });

  it("calls a different value over a settled one 'changes', and shows what it was", () => {
    const change = describeChange(proposal("confirmed", "440mm", "confirmed", "445mm"));
    expect(change.kind).toBe("changes");
    expect(change.was).toBe("440mm");
    // Notable, and separately blocked: proposalBlockers still demands the
    // overwrite acknowledgement. This label never stands in for that.
    expect(change.notable).toBe(true);
  });

  it("does not report a change when the email restates what we already hold", () => {
    // "as before" / "stays in" wording is common and must not read as an edit.
    const change = describeChange(proposal("confirmed", "UPH-07", "confirmed", " uph-07 "));
    expect(change.kind).toBe("repeats");
    expect(change.notable).toBe(false);
  });

  it("names a settled value being withdrawn back to undecided", () => {
    const change = describeChange(proposal("confirmed", "CLO003 A", "tbc", "CLO003 A"));
    expect(change.kind).toBe("withdraws");
    expect(change.label).toBe("Puts back to TBC");
    expect(change.was).toBe("CLO003 A");
    expect(change.notable).toBe(true);
  });

  it("reads the record, not the model's intent, when the two disagree", () => {
    // The model said `confirms_tbc`; the record holds a settled value. What is
    // about to happen is an overwrite, and the verb has to say so.
    const row = proposal("confirmed", "440mm", "confirmed", "445mm");
    row.raw = { ...row.raw, changeIntent: "confirms_tbc" };
    expect(describeChange(row).kind).toBe("changes");
  });

  it("separates 'no item' from 'item found, question not matched'", () => {
    // Two different jobs for the reviewer, and one row saying "3 runs" beside
    // "not placed" is a row contradicting itself.
    const noQuestion = proposal(null, null, "confirmed", "445mm");
    expect(describeChange(noQuestion).kind).toBe("no_question");

    const noItem = proposal(null, null, "confirmed", "445mm");
    noItem.recordId = null;
    expect(describeChange(noItem).kind).toBe("unplaced");
  });

  it("names a not-applicable separately from an empty one", () => {
    expect(describeChange(proposal("missing", null, "na", null)).kind).toBe("not_applicable");
  });

  it("does not call an unchanged TBC a confirmation", () => {
    expect(describeChange(proposal("tbc", null, "tbc", "TBC")).kind).toBe("repeats");
  });
});
