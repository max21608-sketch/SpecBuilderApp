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
    section: null,
    waiting: null,
    contactId: "c-1",
    audience: over.audience ?? (over.requirementKind === "readiness" ? "in_house" : "client"),
    seedAudience: over.seedAudience ?? over.audience ?? (over.requirementKind === "readiness" ? "in_house" : "client"),
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

  it("never ticks a project-wide question: it is answered once on the project (2026-10-12)", () => {
    // "Is access ok?" on thirty items is one question, asked thirty times.
    // The record's "Chase the n" counts `inChaseAsk`, which leaves it out, so
    // the preselection must too or the button lands on more ticks than it said.
    const access = question({ section: "Project / commercial" });
    expect(defaultSelection([access], "c-1").size).toBe(0);
    expect(selectionSummary([access], "c-1").preselected).toBe(0);
  });

  // CHASE REVIEW A3, 2026-11-21: a CAM question a person sent to the client
  // ("Ask the client") is IN the next chase. All five CAM questions are
  // project-wide, which is never preselected, so "Moved to the chase" put it
  // in no chase. A person's explicit decision outranks that default, at any
  // tier — and a reply already awaited still holds it back.
  it("ticks a CAM question a person moved to the client, though it is project-wide and not TGQ", () => {
    const moved = question({
      requirementKind: "readiness",
      audience: "client",
      seedAudience: "cam",
      section: "Project / commercial",
      tier: "later",
    });
    expect(keys(defaultSelection([moved], "c-1"))).toEqual([selectionKey(moved.recordId, moved.requirementId)]);
    expect(selectionSummary([moved], "c-1")).toMatchObject({ preselected: 1, alsoOutstanding: 0, awaitingReply: 0 });
    // Not for somebody else's chase, and not when a reply is already awaited.
    expect(defaultSelection([moved], "c-2").size).toBe(0);
    const asked = { ...moved, waiting: { draftId: "d-1", sentAt: null, contactName: "Claire" } };
    expect(defaultSelection([asked], "c-1").size).toBe(0);
    expect(selectionSummary([asked], "c-1")).toMatchObject({ preselected: 0, awaitingReply: 1 });
  });

  it("never ticks a question somebody is already waiting on a reply for", () => {
    const waiting = question({ waiting: { draftId: "d-1", sentAt: null, contactName: "Claire" } });
    expect(defaultSelection([waiting], "c-1").size).toBe(0);
  });

  it("ticks only a CLIENT question: an in-house spec field is never preselected (0062, decision D)", () => {
    // "Assembly guide required" fills a BWS field and is ours. Chaseable was
    // `kind = 'spec_field'`; it is the audience now.
    expect(defaultSelection([question({ audience: "in_house" })], "c-1").size).toBe(0);
    expect(defaultSelection([question({ audience: "cam" })], "c-1").size).toBe(0);
    expect(selectionSummary([question({ audience: "in_house", tier: "later" })], "c-1").alsoOutstanding).toBe(0);
  });

  it("ticks a CLIENT readiness question: \"Floor plans\" has no BWS column and is the client's to give", () => {
    const plans = question({ requirementKind: "readiness", audience: "client" });
    expect(keys(defaultSelection([plans], "c-1"))).toEqual([selectionKey(plans.recordId, plans.requirementId)]);
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
    expect(summary).toEqual({ contactChosen: true, preselected: 2, alsoOutstanding: 3, awaitingReply: 0 });
  });

  it("counts neither half for a question the preselection could not consider", () => {
    // Readiness, awaiting a reply, somebody else's, no tier: all excluded from
    // BOTH numbers, because "also outstanding" would say it had been weighed.
    const summary = selectionSummary(
      [
        question({ requirementKind: "readiness", tier: "later" }),
        question({ contactId: "c-2", tier: "later" }),
        question({ tier: null }),
      ],
      "c-1",
    );
    expect(summary).toEqual({ contactChosen: true, preselected: 0, alsoOutstanding: 0, awaitingReply: 0 });
  });

  it("says no contact is chosen rather than counting everybody's", () => {
    expect(selectionSummary([question(), question({ contactId: "c-2" })], "")).toEqual({
      contactChosen: false,
      preselected: 0,
      alsoOutstanding: 0,
      awaitingReply: 0,
    });
  });

  // ---- the third bucket ----------------------------------------------------
  //
  // Chasing Priya Raman on the sandbox demo project, the lines' to-quote column
  // summed to 71 and the button said 70 (found-in-use 2026-09-20). The one was
  // a to-quote question already asked: the line counts it because it is still
  // outstanding, the preselection excludes it because asking again by default
  // is not what anybody meant. Both right; only two of the three sets were
  // named.
  it("counts a question already awaiting a reply as its own bucket", () => {
    const summary = selectionSummary(
      [
        question(),
        question({ waiting: { draftId: "d-1", sentAt: null, contactName: "Claire" } }),
        question({ tier: "later", waiting: { draftId: "d-2" } }),
      ],
      "c-1",
    );
    expect(summary).toEqual({ contactChosen: true, preselected: 1, alsoOutstanding: 0, awaitingReply: 2 });
  });

  it("makes the three numbers add up to every tiered question this contact owes", () => {
    const questions = [
      question(),
      question(),
      question({ tier: "later" }),
      question({ waiting: { draftId: "d-1" } }),
      // Not this contact's, not a specification question, and not tiered: none
      // of the three counts it, and the lines do not attribute it here either.
      question({ contactId: "c-2" }),
      question({ requirementKind: "readiness" }),
      question({ tier: null }),
    ];
    const summary = selectionSummary(questions, "c-1");
    expect(summary.preselected + summary.alsoOutstanding + summary.awaitingReply).toBe(4);
  });

  it("does not count a readiness question or somebody else's as awaiting a reply", () => {
    const summary = selectionSummary(
      [
        question({ requirementKind: "readiness", waiting: { draftId: "d-1" } }),
        question({ contactId: "c-2", waiting: { draftId: "d-2" } }),
        question({ tier: null, waiting: { draftId: "d-3" } }),
      ],
      "c-1",
    );
    expect(summary.awaitingReply).toBe(0);
  });

  it("still ticks nothing that is awaiting a reply — the counts changed, the selection did not", () => {
    const waiting = question({ waiting: { draftId: "d-1" } });
    expect(defaultSelection([waiting], "c-1").size).toBe(0);
  });
});
