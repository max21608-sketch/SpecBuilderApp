// Pure unit tests for the proposal resolver. No DB, no network, no clock.
//
// This is the tier that matters most for M2: the db tier skips silently without
// DATABASE_URL, and every rule below is one where being wrong means writing a
// confident wrong answer into a client's specification record.
import { describe, expect, it } from "vitest";
import {
  classifyProposal,
  findRecordsByRef,
  groupByRecord,
  normaliseRef,
  proposalBlockers,
  resolveProposals,
  suggestState,
  type AnswerEntry,
  type Proposal,
  type RecordEntry,
  type Registers,
  type RequirementEntry,
} from "@/lib/spec-document";
import type { RawProposal } from "@/lib/extraction-schema";

let counter = 0;
const ids = () => `p${++counter}`;

function record(overrides: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id: "rec-1",
    recordNo: 14,
    label: "P17231-014",
    itemDescription: "Armchair",
    categoryId: "cat-uph",
    categoryName: "Armchairs, Benches, Stools, Sofas",
    refs: ["SX11A"],
    boqCodes: ["SX11A"],
    runId: "run-1",
    runName: "Main run",
    version: 3,
    ...overrides,
  };
}

function requirement(overrides: Partial<RequirementEntry> = {}): RequirementEntry {
  return {
    id: "req-leg",
    categoryId: "cat-uph",
    prompt: "What is the frame/leg finish?",
    kind: "spec_field",
    section: "Frame",
    specFieldName: "Leg Finish",
    aliases: [],
    ...overrides,
  };
}

function registers(overrides: Partial<Registers> = {}): Registers {
  return {
    records: [record()],
    requirements: [requirement()],
    answers: [],
    ...overrides,
  };
}

function observation(overrides: Partial<RawProposal> = {}): RawProposal {
  return {
    refRaw: "SX11A",
    attributeRaw: "Leg Finish",
    valueRaw: "Antique brass",
    page: 14,
    sourceSheet: null,
    sourceRow: null,
    confidence: "high",
    note: null,
    ...overrides,
  };
}

const resolve = (raw: RawProposal[], regs: Registers = registers()) => resolveProposals(raw, regs, ids);

describe("normaliseRef", () => {
  it("ignores punctuation and case", () => {
    expect(normaliseRef("fu-209-15")).toBe("FU20915");
    expect(normaliseRef("FU 209 15")).toBe("FU20915");
  });
});

describe("findRecordsByRef", () => {
  // The single most important rule in this file. SX11A appears twice in the
  // pilot BOQ with different quantities, BY DESIGN.
  it("returns BOTH records when one ref belongs to two, exact match or not", () => {
    const records = [record({ id: "a" }), record({ id: "b", recordNo: 15, label: "P17231-015" })];
    expect(findRecordsByRef("SX11A", records).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("prefers an exact ref over a normalised one", () => {
    const records = [
      record({ id: "exact", refs: ["FU-209-15"] }),
      record({ id: "loose", refs: ["FU 209 15"] }),
    ];
    expect(findRecordsByRef("FU-209-15", records).map((r) => r.id)).toEqual(["exact"]);
  });

  it("falls back to a normalised match", () => {
    const records = [record({ id: "loose", refs: ["FU 209 15"] })];
    expect(findRecordsByRef("FU-209-15", records).map((r) => r.id)).toEqual(["loose"]);
  });

  it("returns nothing for a missing or unknown ref", () => {
    expect(findRecordsByRef(null, [record()])).toEqual([]);
    expect(findRecordsByRef("  ", [record()])).toEqual([]);
    expect(findRecordsByRef("ZZ99", [record()])).toEqual([]);
  });
});

describe("suggestState", () => {
  it("settles a concrete value", () => {
    expect(suggestState("Antique brass")).toMatchObject({ state: "confirmed", value: "Antique brass" });
  });

  // The rule the whole gate model rests on.
  it("never turns a literal TBC into a settled answer", () => {
    for (const wording of ["TBC", "tbc", "To be confirmed", "TBA", "to follow"]) {
      expect(suggestState(wording).state).toBe("tbc");
    }
  });

  it("reads not-applicable as na, with no value", () => {
    expect(suggestState("N/A")).toMatchObject({ state: "na", value: null });
    expect(suggestState("Not applicable")).toMatchObject({ state: "na", value: null });
  });

  it("does NOT read 'None' as not-applicable", () => {
    // "None" for a piping fabric is a real decision somebody made.
    expect(suggestState("None").state).toBe("confirmed");
  });

  it("refuses to choose when the document says both", () => {
    const result = suggestState("Antique brass, finish TBC");
    expect(result.state).toBeNull();
    expect(result.reason).toMatch(/not settled/);
  });

  it("refuses to choose when there is no value", () => {
    expect(suggestState(null).state).toBeNull();
    expect(suggestState("   ").state).toBeNull();
  });

  it("settles 'Design to suggest', and says that is what it is doing", () => {
    // CLAUDE.md: at TG0 this is an acceptable dimension answer and TBC is not.
    const result = suggestState("Design to suggest");
    expect(result.state).toBe("confirmed");
    expect(result.reason).toMatch(/answer, not a deferral/);
  });
});

describe("resolveProposals", () => {
  it("resolves a clean observation to one record and one question", () => {
    const [proposal] = resolve([observation()]);
    expect(proposal?.recordId).toBe("rec-1");
    expect(proposal?.requirementId).toBe("req-leg");
    expect(proposal?.proposedState).toBe("confirmed");
    expect(classifyProposal(proposal as Proposal)).toBe("pending");
  });

  it("keeps the document's own wording untouched", () => {
    const [proposal] = resolve([observation({ valueRaw: "  Antique Brass (RAL 1036)  " })]);
    expect(proposal?.raw.valueRaw).toBe("  Antique Brass (RAL 1036)  ");
  });

  it("chooses NEITHER record when one ref matches two", () => {
    const regs = registers({
      records: [record({ id: "a" }), record({ id: "b", label: "P17231-015" })],
    });
    const [proposal] = resolve([observation()], regs);
    expect(proposal?.recordId).toBeNull();
    expect(proposal?.recordCandidates).toHaveLength(2);
    expect(classifyProposal(proposal as Proposal)).toBe("ambiguous");
  });

  it("leaves a record with no category unchosen", () => {
    const regs = registers({ records: [record({ categoryId: null, categoryName: null })] });
    const [proposal] = resolve([observation()], regs);
    expect(proposal?.recordId).toBeNull();
    expect(proposal?.requirementId).toBeNull();
  });

  it("matches an attribute only within the record's own category", () => {
    const regs = registers({
      requirements: [
        requirement({ id: "req-other", categoryId: "cat-cab", prompt: "Leg Finish", specFieldName: "Leg Finish" }),
      ],
    });
    const [proposal] = resolve([observation()], regs);
    expect(proposal?.requirementId).toBeNull();
    expect(proposal?.requirementCandidates).toEqual([]);
  });

  it("matches through an alias the document actually uses", () => {
    const regs = registers({
      requirements: [requirement({ specFieldName: null, aliases: ["Leg finish"] })],
    });
    const [proposal] = resolve([observation({ attributeRaw: "Leg finish" })], regs);
    expect(proposal?.requirementId).toBe("req-leg");
  });

  it("treats several terms pointing at ONE requirement as agreement, not ambiguity", () => {
    const regs = registers({
      requirements: [requirement({ specFieldName: "Leg Finish", aliases: ["Leg Finish", "leg finish"] })],
    });
    const [proposal] = resolve([observation()], regs);
    expect(proposal?.requirementId).toBe("req-leg");
  });

  it("keeps every tied requirement rather than picking one", () => {
    const regs = registers({
      requirements: [
        requirement({ id: "req-a", prompt: "Frame finish", specFieldName: null }),
        requirement({ id: "req-b", prompt: "Frame finish", specFieldName: null }),
      ],
    });
    const [proposal] = resolve([observation({ attributeRaw: "Frame finish" })], regs);
    expect(proposal?.requirementId).toBeNull();
    expect(proposal?.requirementCandidates.map((c) => c.id).sort()).toEqual(["req-a", "req-b"]);
  });

  it("keeps BOTH observations when the document contradicts itself", () => {
    const proposals = resolve([
      observation({ valueRaw: "Antique brass" }),
      observation({ valueRaw: "Polished nickel" }),
    ]);
    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.proposedValue)).toEqual(["Antique brass", "Polished nickel"]);
  });

  it("snapshots an existing answer, and an absent one explicitly", () => {
    const answer: AnswerEntry = {
      id: "ans-1", recordId: "rec-1", requirementId: "req-leg", version: 7, state: "confirmed", value: "Chrome",
    };
    const [withAnswer] = resolve([observation()], registers({ answers: [answer] }));
    expect(withAnswer?.target).toMatchObject({ answerExists: true, answerVersion: 7, answerState: "confirmed" });

    const [without] = resolve([observation()]);
    // Explicit absence, NOT an invented version 0.
    expect(without?.target).toMatchObject({ answerExists: false, answerVersion: null, answerId: null });
  });

  it("gives every proposal a distinct id and preserves source order", () => {
    const proposals = resolve([observation(), observation(), observation()]);
    expect(new Set(proposals.map((p) => p.id)).size).toBe(3);
    expect(proposals.map((p) => p.sourceOrdinal)).toEqual([0, 1, 2]);
  });
});

describe("proposalBlockers", () => {
  const pending = (overrides: Partial<Proposal> = {}): Proposal => ({
    ...(resolve([observation()])[0] as Proposal),
    ...overrides,
  });

  it("passes a clean proposal", () => {
    expect(proposalBlockers(pending(), [])).toEqual([]);
  });

  it("blocks an unassigned proposal", () => {
    const proposal = pending({ recordId: null, requirementId: null, target: null });
    expect(proposalBlockers(proposal, []).map((b) => b.code)).toEqual(["unassigned"]);
  });

  it("blocks a missing state", () => {
    const proposal = pending({ proposedState: null, stateReason: "why" });
    expect(proposalBlockers(proposal, []).map((b) => b.code)).toContain("no_state");
  });

  it("blocks a confirmed answer with no value", () => {
    const proposal = pending({ proposedState: "confirmed", proposedValue: "  " });
    expect(proposalBlockers(proposal, []).map((b) => b.code)).toContain("empty_value");
  });

  it("blocks an N/A answer carrying a value", () => {
    const proposal = pending({ proposedState: "na", proposedValue: "Antique brass" });
    expect(proposalBlockers(proposal, []).map((b) => b.code)).toContain("na_with_value");
  });

  it("blocks overwriting a settled answer until it is acknowledged", () => {
    const answer: AnswerEntry = {
      id: "ans-1", recordId: "rec-1", requirementId: "req-leg", version: 7, state: "confirmed", value: "Chrome",
    };
    const [proposal] = resolve([observation()], registers({ answers: [answer] }));
    expect(proposalBlockers(proposal as Proposal, []).map((b) => b.code)).toContain("overwrite");
    expect(
      proposalBlockers({ ...(proposal as Proposal), overwriteAcknowledged: true }, []).map((b) => b.code),
    ).not.toContain("overwrite");
  });

  it("does not demand acknowledgement to overwrite a TBC or missing answer", () => {
    const answer: AnswerEntry = {
      id: "ans-1", recordId: "rec-1", requirementId: "req-leg", version: 2, state: "tbc", value: "TBC",
    };
    const [proposal] = resolve([observation()], registers({ answers: [answer] }));
    expect(proposalBlockers(proposal as Proposal, []).map((b) => b.code)).not.toContain("overwrite");
  });

  it("blocks two pending proposals aimed at one target", () => {
    const proposals = resolve([observation({ valueRaw: "Antique brass" }), observation({ valueRaw: "Chrome" })]);
    for (const proposal of proposals) {
      expect(proposalBlockers(proposal, proposals).map((b) => b.code)).toContain("duplicate_target");
    }
  });

  it("clears the clash once one of them is ignored", () => {
    const proposals = resolve([observation({ valueRaw: "Antique brass" }), observation({ valueRaw: "Chrome" })]);
    const after = [proposals[0] as Proposal, { ...(proposals[1] as Proposal), reviewStatus: "ignored" as const }];
    expect(proposalBlockers(after[0] as Proposal, after).map((b) => b.code)).not.toContain("duplicate_target");
  });

  it("has nothing to say about a reviewed proposal", () => {
    const proposal = pending({ reviewStatus: "applied", recordId: null, target: null });
    expect(proposalBlockers(proposal, [])).toEqual([]);
  });
});

describe("classifyProposal", () => {
  it("places every proposal in exactly one section", () => {
    const [clean] = resolve([observation()]);
    const [unassigned] = resolve([observation({ refRaw: "ZZ99" })]);
    const cases: [Proposal, string][] = [
      [clean as Proposal, "pending"],
      [unassigned as Proposal, "unassigned"],
      [{ ...(clean as Proposal), reviewStatus: "ignored" }, "ignored"],
      [{ ...(clean as Proposal), reviewStatus: "applied" }, "applied"],
    ];
    for (const [proposal, section] of cases) expect(classifyProposal(proposal)).toBe(section);
  });
});

describe("groupByRecord", () => {
  it("groups assigned proposals by record and leaves unassigned ones out", () => {
    const proposals = resolve([observation(), observation({ refRaw: "ZZ99" })]);
    const groups = groupByRecord(proposals);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.proposals).toHaveLength(1);
  });
});
