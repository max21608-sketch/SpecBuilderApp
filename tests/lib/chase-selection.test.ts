// Pure tier. What a chase arrives TICKED.
//
// The screen used to seed every spec-field question across every contact, and
// Max said so on the real project: "it's still selecting all of them, when in
// fact it should have just selected [the four]." Each test below is one of the
// reasons a question is or is not in that four.
import { describe, expect, it } from "vitest";
import { defaultSelection, selectionKey, selectionSummary, type SelectableQuestion } from "@/lib/chase-selection";

let n = 0;
function question(over: Partial<SelectableQuestion> = {}): SelectableQuestion {
  n += 1;
  return {
    recordId: "rec-1",
    requirementId: `req-${n}`,
    requirementKind: "spec_field",
    tier: "to_quote",
    waiting: null,
    contactId: "c-1",
    ...over,
  };
}

const keys = (set: Set<string>) => [...set].sort();

describe("defaultSelection", () => {
  it("ticks the to-quote questions and leaves the rest", () => {
    const blocking = question();
    const later = question({ tier: "later" });
    const selected = defaultSelection([blocking, later], "c-1");
    expect(keys(selected)).toEqual([selectionKey(blocking.recordId, blocking.requirementId)]);
  });

  it("ticks nothing for a contact whose to-quote set is empty", () => {
    // A real state, not a fault: everything blocking a quote has been answered
    // and what is left is "also outstanding". The screen says so in words.
    expect(defaultSelection([question({ tier: "later" })], "c-1").size).toBe(0);
  });

  it("never ticks a question somebody is already waiting on a reply for", () => {
    const waiting = question({ waiting: { draftId: "d-1", sentAt: null, contactName: "Claire" } });
    expect(defaultSelection([waiting], "c-1").size).toBe(0);
  });

  it("never ticks a readiness question", () => {
    // Deposit status and the COM payment plan are Ben Whistler's own
    // commercial checklist. Choosable, never by accident — decision 19.
    expect(defaultSelection([question({ requirementKind: "readiness" })], "c-1").size).toBe(0);
  });

  it("ticks only the chosen contact's questions", () => {
    const hers = question();
    const his = question({ contactId: "c-2" });
    expect(keys(defaultSelection([hers, his], "c-1"))).toEqual([selectionKey(hers.recordId, hers.requirementId)]);
  });

  it("ticks nothing at all with no contact chosen", () => {
    // The Everyone tab lists several people's questions and one press would
    // draft an email to each of them.
    expect(defaultSelection([question(), question({ contactId: "c-2" })], "").size).toBe(0);
  });

  it("leaves a question with NO TIER out, because nobody can say what it is", () => {
    // A record with no level on a category the matrix does not cover. The
    // screen lists it as a blocker with a level picker; a default cannot decide
    // what only a person can.
    expect(defaultSelection([question({ tier: null })], "c-1").size).toBe(0);
  });

  it("keys a question the way the selection is held", () => {
    const one = question({ recordId: "rec-9", requirementId: "req-9" });
    expect(keys(defaultSelection([one], "c-1"))).toEqual(["rec-9:req-9"]);
  });
});

describe("selectionSummary", () => {
  it("counts what was ticked and what was deliberately left", () => {
    const summary = selectionSummary(
      [question(), question(), question({ tier: "later" }), question({ tier: "later" }), question({ tier: "later" })],
      "c-1",
    );
    expect(summary).toEqual({ contactChosen: true, preselected: 2, alsoOutstanding: 3 });
  });

  it("counts neither half for a question the preselection could not consider", () => {
    // Readiness, awaiting a reply, somebody else's, no tier: all excluded from
    // BOTH numbers, because "also outstanding" would say it had been weighed.
    const summary = selectionSummary(
      [
        question({ requirementKind: "readiness", tier: "later" }),
        question({ waiting: { draftId: "d-1" }, tier: "later" }),
        question({ contactId: "c-2", tier: "later" }),
        question({ tier: null }),
      ],
      "c-1",
    );
    expect(summary).toEqual({ contactChosen: true, preselected: 0, alsoOutstanding: 0 });
  });

  it("says no contact is chosen rather than counting everybody's", () => {
    expect(selectionSummary([question(), question({ contactId: "c-2" })], "")).toEqual({
      contactChosen: false,
      preselected: 0,
      alsoOutstanding: 0,
    });
  });
});
