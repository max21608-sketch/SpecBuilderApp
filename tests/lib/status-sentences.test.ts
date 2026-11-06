// A status, as the words a refused request says to a person (audit 2026-11-06,
// G15). The guard in vocabulary-guard.test.ts refuses a status printed any
// other way; this holds what the helpers say for each state, so the words a
// screen prints after "This bill" are a decision rather than whatever the
// CHECK constraint happens to call it.
import { describe, expect, it } from "vitest";
import { documentClosedSentence, documentStateWords, reviewedWord } from "@/lib/intake-status";
import { draftStateWords } from "@/lib/draft-status";

const INTAKE_STATUSES = ["pending", "queued", "parsing", "parsed", "confirmed", "failed"];
const DRAFT_STATUSES = ["draft", "sent", "voided", "superseded"];
// The column's words nobody on a screen ever chose. "Confirmed" and "sent" are
// not among them: a person pressed Confirm, and said "I sent it".
const MACHINE_WORDS = /\b(pending|queued|parsing|parsed|failed|voided|superseded|import|run)\b/i;

describe("a document's state, in a refusal", () => {
  it("never prints the column", () => {
    for (const status of INTAKE_STATUSES) {
      expect(documentClosedSentence(status, { consequence: "it cannot be edited here" })).not.toMatch(MACHINE_WORDS);
    }
  });

  it("says the state, what it stops, and the next step", () => {
    expect(documentClosedSentence("parsing", { consequence: "it cannot be edited here" })).toBe(
      "This document is still being read, so it cannot be edited here. Wait for the read to finish, then reload.",
    );
    expect(documentClosedSentence("confirmed", { noun: "bill", consequence: "its columns can no longer be changed" })).toBe(
      "This bill has already been confirmed, so its columns can no longer be changed. Open its phase to change anything on it.",
    );
    expect(documentClosedSentence("confirmed")).toBe(
      "This document has already been confirmed. Change a value on its record instead.",
    );
  });

  it("reads queued and parsing as the same state", () => {
    expect(documentStateWords("queued")).toBe(documentStateWords("parsing"));
  });

  it("does not guess at a status it does not know", () => {
    // A state the database grows later says nothing it cannot back.
    expect(documentClosedSentence("archived")).toBe("This document is not open for review. Reload to see where it stands.");
  });

  it("names a reviewed row in the screens' two words, and never the third", () => {
    expect(reviewedWord("applied")).toBe("applied");
    expect(reviewedWord("ignored")).toBe("ignored");
    expect(reviewedWord("pending")).toBe("dealt with");
  });
});

describe("a draft's state, in a refusal", () => {
  it("never prints the column", () => {
    for (const status of DRAFT_STATUSES) {
      expect(draftStateWords(status)).not.toMatch(MACHINE_WORDS);
    }
  });

  it("says a superseded draft has a newer one", () => {
    expect(draftStateWords("superseded")).toBe("was replaced by a newer draft for the same contact");
  });
});
