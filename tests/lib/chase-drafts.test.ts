// Pure unit tests for the chase domain logic: who gets asked, and whether a
// sent draft still describes reality.
//
// These are deliberately in the pure tier. The db tier skips silently without
// DATABASE_URL — and CI has none — so the rules that decide whether a question
// reads as "waiting for a reply" must be provable without a database.
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  contextSnapshot,
  coverageStaleReasons,
  designerKey,
  groupByContact,
  isCoverageFresh,
  recordLabel,
  waitingByQuestion,
  type CoverageSnapshot,
  type OutstandingQuestion,
  type ProjectContact,
} from "@/lib/chase-drafts";

function question(overrides: Partial<OutstandingQuestion> = {}): OutstandingQuestion {
  return {
    projectId: "proj-1",
    recordId: "rec-1",
    recordNo: 7,
    recordLabel: "P17231-007",
    recordShortLabel: "7",
    recordNoLabel: "P17231-007",
    recordStatus: "active",
    recordVersion: 3,
    itemDescription: "Armchair",
    area: "Signature Suite",
    designer: "LCS",
    refs: "SX11A",
    categoryId: "cat-1",
    categoryName: "Armchairs, Benches, Stools, Sofas",
    level: "complex",
    tgqLevels: ["simple", "complex", "hero"],
    tier: "to_quote",
    requirementId: "req-1",
    requirementKind: "spec_field",
    prompt: "Seat height (SH)?",
    section: "Dimensions",
    sortOrder: 10,
    fieldLabel: "Dimensions",
    jsonId: 3,
    localKey: null,
    answerId: "ans-1",
    answerVersion: 2,
    state: "tbc",
    currentValue: null,
    // Where the row sits in the bill. Display grouping for the chase screen;
    // none of it reaches a context snapshot.
    qty: 2,
    runId: "run-1",
    runName: "MAIN RUN",
    parentId: null,
    variantLabel: null,
    parentRefs: "",
    parentQty: null,
    groupNo: 7,
    groupLabel: "P17231-007",
    variantCount: 0,
    variantOrdinal: null,
    ...overrides,
  };
}

function contact(overrides: Partial<ProjectContact> = {}): ProjectContact {
  return {
    id: "c-lcs",
    name: "Lecoadic Scotto",
    email: "lcs@example.test",
    organisation: "LCS",
    role: "designer",
    designerCode: "LCS",
    version: 1,
    ...overrides,
  };
}

function coverageFor(q: OutstandingQuestion, overrides: Partial<CoverageSnapshot> = {}): CoverageSnapshot {
  return {
    recordId: q.recordId,
    requirementId: q.requirementId,
    revisionNo: 0,
    answerId: q.answerId,
    snapshotAnswerVersion: q.answerVersion,
    recordVersion: q.recordVersion,
    context: contextSnapshot(q),
    ...overrides,
  };
}

describe("designerKey", () => {
  it("folds the BOQ's free text onto one comparable key", () => {
    expect(designerKey(" lcs ")).toBe("LCS");
    expect(designerKey("LCS")).toBe("LCS");
    expect(designerKey("Lcs")).toBe("LCS");
  });

  it("treats blank and absent as no designer, not as a designer named ''", () => {
    expect(designerKey(null)).toBeNull();
    expect(designerKey("   ")).toBeNull();
    expect(designerKey(undefined)).toBeNull();
  });
});

describe("recordLabel", () => {
  it("zero-pads so labels sort and read consistently", () => {
    expect(recordLabel("P17231", 7)).toBe("P17231-007");
    expect(recordLabel("P17231", 123)).toBe("P17231-123");
  });
});

describe("groupByContact", () => {
  it("groups a designer's questions onto their contact", () => {
    const { groups, blocked } = groupByContact(
      [question(), question({ requirementId: "req-2" })],
      [contact()],
    );
    expect(blocked).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.contact.id).toBe("c-lcs");
    expect(groups[0]?.questions).toHaveLength(2);
  });

  it("matches a contact regardless of how the BOQ cased the designer", () => {
    const { groups, blocked } = groupByContact([question({ designer: " lcs " })], [contact()]);
    expect(blocked).toEqual([]);
    expect(groups[0]?.questions).toHaveLength(1);
  });

  it("splits two designers into two drafts", () => {
    const { groups } = groupByContact(
      [question(), question({ recordId: "rec-2", designer: "TA" })],
      [contact(), contact({ id: "c-ta", name: "Tristan Auer", designerCode: "TA" })],
    );
    expect(groups.map((g) => g.contact.id).sort()).toEqual(["c-lcs", "c-ta"]);
  });

  // A record with nobody to ask must be reported, not quietly left out of the
  // drafts and therefore out of sight.
  it("blocks a record whose designer has no contact, naming why", () => {
    const { groups, blocked } = groupByContact([question({ designer: "TA" })], [contact()]);
    expect(groups).toEqual([]);
    expect(blocked).toEqual([
      expect.objectContaining({ recordLabel: "P17231-007", reason: "no contact for this designer", questionCount: 1 }),
    ]);
  });

  it("distinguishes 'no designer at all' from 'designer with no contact'", () => {
    const { blocked } = groupByContact([question({ designer: null })], [contact()]);
    expect(blocked[0]?.reason).toBe("no designer on the record");
  });

  it("counts every blocked question but reports the record once", () => {
    const { blocked } = groupByContact(
      [question({ designer: null }), question({ designer: null, requirementId: "req-2" })],
      [],
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.questionCount).toBe(2);
  });

  it("ignores a contact with no designer code when matching automatically", () => {
    const { groups, blocked } = groupByContact(
      [question()],
      [contact({ id: "c-client", name: "Argenta", role: "client", designerCode: null })],
    );
    expect(groups).toEqual([]);
    expect(blocked).toHaveLength(1);
  });

  it("still groups a contact who has no email yet — the block belongs at send, not here", () => {
    const { groups, blocked } = groupByContact([question()], [contact({ email: null })]);
    expect(blocked).toEqual([]);
    expect(groups[0]?.contact.email).toBeNull();
  });
});

// ===========================================================================
// A CHASE NEED NOT BE EXTERNAL
//
// Matthew, 2026-09-18: "You can send it to the CAM or to the sales system or
// to production… It doesn't have to be an external e-mail." A colleague is not
// on a bill line and carries no designer code, so routing them the way a
// designer is routed would leave every one of them with an empty chase.
// ===========================================================================
describe("groupByContact — a colleague", () => {
  const colleague = (overrides: Partial<ProjectContact> = {}) =>
    contact({ id: "c-cam", name: "Ana Whitcombe", role: "internal", designerCode: null, ...overrides });

  it("receives every outstanding question on the project, whoever the designer is", () => {
    const { groups } = groupByContact(
      [
        question(),
        question({ recordId: "rec-2", requirementId: "req-2", designer: "TA" }),
        question({ recordId: "rec-3", requirementId: "req-3", designer: null }),
      ],
      [contact(), colleague()],
    );
    const internal = groups.find((g) => g.contact.id === "c-cam");
    expect(internal?.questions).toHaveLength(3);
    // The designer still receives only the lines carrying their own code.
    expect(groups.find((g) => g.contact.id === "c-lcs")?.questions).toHaveLength(1);
  });

  it("still needs a level, because the email could not say what blocks the quote", () => {
    const { groups, blocked } = groupByContact(
      [question({ level: null, tier: null })],
      [contact(), colleague()],
    );
    expect(groups.find((g) => g.contact.id === "c-cam")).toBeUndefined();
    expect(blocked[0]?.reason).toBe("no level on the record");
  });

  it("does not empty the blocked list — a colleague being askable is not a designer", () => {
    // The Nobody assigned tab is about the DESIGNER routing. Hiding 31
    // unrouted questions behind a colleague's availability would lose the one
    // screen that says a bill line has nobody on it.
    const { blocked } = groupByContact([question({ designer: null })], [colleague()]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.reason).toBe("no designer on the record");
  });

  it("sorts colleagues after the designers", () => {
    const { groups } = groupByContact(
      [question(), question({ recordId: "rec-2", requirementId: "req-2", designer: "TA" })],
      [colleague({ name: "Ana Whitcombe" }), contact(), contact({ id: "c-ta", name: "Tristan Auer", designerCode: "TA" })],
    );
    expect(groups.map((g) => g.contact.name)).toEqual([
      "Lecoadic Scotto",
      "Tristan Auer",
      "Ana Whitcombe",
    ]);
  });

  it("lists a question once for a colleague who also carries a designer code", () => {
    const { groups } = groupByContact(
      [question()],
      [colleague({ designerCode: "LCS" })],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.questions).toHaveLength(1);
  });
});

describe("coverageStaleReasons", () => {
  it("is fresh when nothing has moved", () => {
    const q = question();
    expect(coverageStaleReasons(coverageFor(q), q)).toEqual([]);
    expect(isCoverageFresh(coverageFor(q), q)).toBe(true);
  });

  it("is stale when the answer version moved", () => {
    const q = question();
    const stale = coverageStaleReasons(coverageFor(q), question({ answerVersion: 3 }));
    expect(stale).toContain("answerChanged");
  });

  // The common real case: the email asked about a question with no answer row
  // at all, and somebody has since answered it.
  it("is stale when an answer row appeared after the email was sent", () => {
    const asked = question({ answerId: null, answerVersion: null, state: "missing" });
    const cover = coverageFor(asked);
    const now = question({ answerId: "ans-9", answerVersion: 1, state: "tbc" });
    expect(coverageStaleReasons(cover, now)).toContain("answerAppeared");
  });

  it("is stale when the answer row was removed", () => {
    const q = question();
    const now = question({ answerId: null, answerVersion: null, state: "missing" });
    expect(coverageStaleReasons(coverageFor(q), now)).toContain("answerRemoved");
  });

  it("is stale when the question has been settled — that is the point of asking", () => {
    const q = question();
    const now = question({ state: "confirmed", currentValue: "450mm", answerVersion: 3 });
    expect(coverageStaleReasons(coverageFor(q), now)).toContain("answerSettled");
  });

  it("is stale when the record was retired", () => {
    const q = question();
    expect(coverageStaleReasons(coverageFor(q), question({ recordStatus: "retired" }))).toContain("recordRetired");
  });

  it("reports the question as gone when it no longer exists at all", () => {
    expect(coverageStaleReasons(coverageFor(question()), null)).toEqual(["questionGone"]);
  });

  // requirements and spec_record_refs carry no version, so a version-only
  // check would miss all of these. This is why the context snapshot exists.
  describe("unversioned context", () => {
    it("catches an edited requirement prompt", () => {
      const q = question();
      const now = question({ prompt: "Seat height from finished floor (SH)?" });
      expect(coverageStaleReasons(coverageFor(q), now)).toContain("contextChanged");
    });

    it("catches a corrected client ref", () => {
      const q = question();
      expect(coverageStaleReasons(coverageFor(q), question({ refs: "SX11B" }))).toContain("contextChanged");
    });

    it("catches the record moving to a different area", () => {
      const q = question();
      expect(coverageStaleReasons(coverageFor(q), question({ area: "Individuelle" }))).toContain("contextChanged");
    });

    it("does not fire on whitespace-only differences", () => {
      const q = question();
      const now = question({ prompt: "  Seat height (SH)?  ", refs: "SX11A", area: " Signature Suite " });
      expect(coverageStaleReasons(coverageFor(q), now)).toEqual([]);
    });
  });
});

describe("waitingByQuestion", () => {
  const q = question();

  function sent(overrides: Partial<CoverageSnapshot> & { draftId: string; sentAt: string; contactName?: string }) {
    return { ...coverageFor(q), contactName: "Lecoadic Scotto", ...overrides };
  }

  it("marks a question waiting when its send is still valid", () => {
    const waiting = waitingByQuestion([q], [sent({ draftId: "d1", sentAt: "2026-09-10T09:00:00Z" })]);
    expect(waiting.get("rec-1:req-1:0")?.draftId).toBe("d1");
  });

  it("does not mark it waiting when the send is stale", () => {
    const waiting = waitingByQuestion(
      [question({ answerVersion: 9 })],
      [sent({ draftId: "d1", sentAt: "2026-09-10T09:00:00Z" })],
    );
    expect(waiting.size).toBe(0);
  });

  // Coverage arrives newest-first. Two chases must not count twice, and the
  // newest valid one is the one whose date the screen shows.
  it("counts a question once and reports the newest valid send", () => {
    const waiting = waitingByQuestion([q], [
      sent({ draftId: "newest", sentAt: "2026-09-12T09:00:00Z" }),
      sent({ draftId: "older", sentAt: "2026-09-01T09:00:00Z" }),
    ]);
    expect(waiting.size).toBe(1);
    expect(waiting.get("rec-1:req-1:0")?.draftId).toBe("newest");
  });

  // Voiding the newest send must fall back to an earlier one that still
  // holds, rather than dropping the question out of Waiting entirely. The
  // caller excludes voided drafts, so this is that list minus the newest.
  it("falls back to an earlier valid send when the newest is voided away", () => {
    const waiting = waitingByQuestion([q], [sent({ draftId: "older", sentAt: "2026-09-01T09:00:00Z" })]);
    expect(waiting.get("rec-1:req-1:0")?.draftId).toBe("older");
  });

  it("ignores coverage for a question that is no longer outstanding", () => {
    const waiting = waitingByQuestion([], [sent({ draftId: "d1", sentAt: "2026-09-10T09:00:00Z" })]);
    expect(waiting.size).toBe(0);
  });
});

describe("canonicalJson", () => {
  // The bug this exists for: Postgres jsonb does not preserve key insertion
  // order, so a plain JSON.stringify comparison of a stored context snapshot
  // against a freshly computed one never matched — and every draft read as
  // stale the instant it was generated.
  it("is insensitive to key order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("still distinguishes different values", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it("keeps array order, which is meaningful", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("sorts nested keys too", () => {
    expect(canonicalJson({ x: { b: 1, a: 2 } })).toBe(canonicalJson({ x: { a: 2, b: 1 } }));
  });

  it("treats null and missing consistently", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson({ a: undefined })).toBe("{}");
  });
});

describe("groupByContact — the item level", () => {
  const contact: ProjectContact = {
    id: "c1",
    name: "Tristan Auer",
    email: "t@example.test",
    organisation: null,
    role: "designer",
    designerCode: "LCS",
    version: 1,
  };

  // A record with no level has no tier, so an email about it could not say
  // which half it belonged in — which is the whole point of the message.
  it("blocks a record with no level, even when there is somebody to ask", () => {
    const { groups, blocked } = groupByContact([question({ level: null, tier: null })], [contact]);
    expect(groups).toEqual([]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.reason).toBe("no level on the record");
  });

  it("counts every blocked question but reports the record once", () => {
    const { blocked } = groupByContact(
      [
        question({ level: null, tier: null }),
        question({ level: null, tier: null, requirementId: "req-2" }),
      ],
      [contact],
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.questionCount).toBe(2);
  });

  it("reports the missing contact first when both are missing", () => {
    // Nobody to ask is the more basic problem: setting a level on a record
    // nobody can be asked about changes nothing.
    const { blocked } = groupByContact([question({ level: null, tier: null, designer: null })], [contact]);
    expect(blocked[0]?.reason).toBe("no designer on the record");
  });

  it("groups a record that has a level, as before", () => {
    const { groups, blocked } = groupByContact([question()], [contact]);
    expect(blocked).toEqual([]);
    expect(groups).toHaveLength(1);
  });
});

describe("coverageStaleReasons — the tier", () => {
  // The tier lives in its own column precisely so this is true: applying the
  // TGQ workbook re-tiers hundreds of questions at once, and if that read as
  // staleness every draft would 409 and Waiting would empty, for a reason that
  // has nothing to do with any answer.
  it("does not fire when a question changes which half of the email it is in", () => {
    const live = question({ tier: "later", tgqLevels: [] });
    const coverage: CoverageSnapshot = {
      recordId: live.recordId,
      requirementId: live.requirementId,
      revisionNo: 0,
      answerId: live.answerId,
      snapshotAnswerVersion: live.answerVersion,
      recordVersion: live.recordVersion,
      // Snapshotted while the question still counted as blocking.
      context: contextSnapshot(question({ tier: "to_quote" })),
    };
    expect(coverageStaleReasons(coverage, live)).toEqual([]);
  });
});
