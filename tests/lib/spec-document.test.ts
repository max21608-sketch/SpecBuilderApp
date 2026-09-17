// Pure unit tests for the proposal resolver. No DB, no network, no clock.
//
// This is the tier that matters most for M2: the db tier skips silently without
// DATABASE_URL, and every rule below is one where being wrong means writing a
// confident wrong answer into a client's specification record.
import { describe, expect, it } from "vitest";
import {
  classifyProposal,
  detectConfiguration,
  rematchProposals,
  findRecordsByRef,
  groupByRecord,
  normaliseRef,
  proposalBlockers,
  resolveProposals,
  suggestState,
  type AnswerEntry,
  type Proposal,
  type StagedSpecDocument,
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
    parentId: null,
    variantLabel: null,
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

  it("chooses NEITHER record when one ref matches two ON THE SAME RUN", () => {
    // The SX11A case. Two lines of ONE bill carrying one code are two
    // different items, and choosing between them is a person's decision. This
    // must survive the run fan-out below, which is the whole reason the
    // fan-out groups by run instead of counting matches.
    const regs = registers({
      records: [record({ id: "a" }), record({ id: "b", label: "P17231-015" })],
    });
    const [proposal] = resolve([observation()], regs);
    expect(proposal?.recordId).toBeNull();
    expect(proposal?.recordCandidates).toHaveLength(2);
    expect(classifyProposal(proposal as Proposal)).toBe("ambiguous");
  });

  it("fans one observation out to the SAME code on every run", () => {
    // `S-201` is on the mock-up, main and VE runs with different quantities,
    // and there is ONE email about it. Three matches is not ambiguity.
    const regs = registers({
      records: [
        record({ id: "mur", runId: "run-mur", runName: "MUR" }),
        record({ id: "main", runId: "run-main", runName: "MAIN RUN" }),
        record({ id: "ve", runId: "run-ve", runName: "VE" }),
      ],
    });
    const proposals = resolve([observation()], regs);

    expect(proposals).toHaveLength(3);
    expect(proposals.map((p) => p.recordId).sort()).toEqual(["main", "mur", "ve"]);
    // Every one of them is committable, and every one names its run.
    for (const proposal of proposals) {
      expect(classifyProposal(proposal)).toBe("pending");
      expect(proposal.target).not.toBeNull();
      expect(proposal.requirementId).toBe("req-leg");
    }
    expect(proposals.map((p) => p.runName)).toEqual(["MAIN RUN", "MUR", "VE"]);
    // They share the ordinal of the observation they came from, which is what
    // lets the screen show one row for "seat height" with three runs beside it.
    expect(new Set(proposals.map((p) => p.sourceOrdinal))).toEqual(new Set([0]));
    // ...and separate ids, or an edit to one would address all three.
    expect(new Set(proposals.map((p) => p.id)).size).toBe(3);
  });

  it("fans out the clean runs and leaves only the colliding run ambiguous", () => {
    // Both rules at once: the main run resolves, and the run carrying the code
    // twice is the only thing the reviewer is asked about.
    const regs = registers({
      records: [
        record({ id: "main", runId: "run-main", runName: "MAIN RUN" }),
        record({ id: "ve-a", runId: "run-ve", runName: "VE" }),
        record({ id: "ve-b", runId: "run-ve", runName: "VE", label: "P17231-015" }),
      ],
    });
    const proposals = resolve([observation()], regs);

    expect(proposals).toHaveLength(2);
    const main = proposals.find((p) => p.runId === "run-main");
    const ve = proposals.find((p) => p.runId === "run-ve");

    expect(main?.recordId).toBe("main");
    expect(classifyProposal(main as Proposal)).toBe("pending");

    expect(ve?.recordId).toBeNull();
    expect(classifyProposal(ve as Proposal)).toBe("ambiguous");
    // The candidates offered are that RUN'S, not the project's: offering the
    // main run's record here would let a reviewer resolve the VE collision
    // onto a record that is already being written by its own proposal.
    expect(ve?.recordCandidates.map((c) => c.id).sort()).toEqual(["ve-a", "ve-b"]);
  });

  it("still produces one unassigned proposal when a ref matches nothing", () => {
    const proposals = resolve([observation({ refRaw: "ZZ99" })]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.runId).toBeNull();
    expect(classifyProposal(proposals[0] as Proposal)).toBe("unassigned");
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

describe("detectConfiguration", () => {
  it("reads the configuration an attribute label names", () => {
    expect(detectConfiguration("Fabric (A configuration)")).toBe("A");
    expect(detectConfiguration("Fabric (B configuration)")).toBe("B");
    expect(detectConfiguration("Fabric - configuration C")).toBe("C");
    expect(detectConfiguration("COM 1 (config D)")).toBe("D");
    expect(detectConfiguration("fabric, variant b")).toBe("B");
  });

  it("refuses a bare letter, which is a grade far more often than a configuration", () => {
    // "Fabric A" on a specification sheet routinely means a grade or a
    // position, not one of 0024's configurations. Reading it as a
    // configuration would send the value to a record the email never named.
    expect(detectConfiguration("Fabric A")).toBeNull();
    expect(detectConfiguration("Grade A fabric")).toBeNull();
    expect(detectConfiguration("Seat height")).toBeNull();
    expect(detectConfiguration(null)).toBeNull();
  });
});

describe("resolveProposals — dimensions", () => {
  const runs = [
    record({ id: "mur", runId: "run-mur", runName: "MUR" }),
    record({ id: "main", runId: "run-main", runName: "MAIN RUN" }),
  ];

  it("turns an overall line into one proposal per slot, per run", () => {
    // Three slots on two runs is six writes, and the screen still shows ONE
    // row because they share the observation's ordinal.
    const proposals = resolve(
      [observation({ attributeRaw: "Overall", valueRaw: "W660 x D685 x H680mm" })],
      registers({ records: runs }),
    );
    expect(proposals).toHaveLength(6);
    expect(new Set(proposals.map((p) => p.sourceOrdinal))).toEqual(new Set([0]));
    expect(new Set(proposals.map((p) => p.dimension?.slot))).toEqual(new Set(["W", "D", "H"]));
    for (const proposal of proposals) {
      // A dimension reaches its field by SLOT, never by matching a question.
      expect(proposal.requirementId).toBeNull();
      expect(proposal.target).toBeNull();
      expect(proposal.dimension?.unit).toBe("mm");
      expect(classifyProposal(proposal)).toBe("pending");
    }
  });

  it("is committable with a record alone, having no question to match", () => {
    const [proposal] = resolve(
      [observation({ attributeRaw: "Seat height", valueRaw: "445mm" })],
      registers({ records: [record()] }),
    );
    expect(proposal?.dimension?.slot).toBe("SH");
    expect(proposalBlockers(proposal as Proposal, [proposal as Proposal])).toEqual([]);
  });

  it("leaves a non-dimension observation on the ordinary path", () => {
    // "Arm height" is a note, not a slot — CLAUDE.md names it as the case a
    // substring rule would destroy.
    const [proposal] = resolve([observation({ attributeRaw: "Arm height", valueRaw: "520mm from FFL" })]);
    expect(proposal?.dimension ?? null).toBeNull();
  });

  it("refuses to retire what a slot already holds until somebody says so", () => {
    const regs = registers({
      records: [record()],
      attributes: [
        { id: "attr-1", recordId: "rec-1", attrGroup: "dimension", slot: "SH", specFieldId: null, label: "SEAT HEIGHT", value: "440", unit: "mm", state: "confirmed", version: 2 },
      ],
    });
    const [proposal] = resolve([observation({ attributeRaw: "Seat height", valueRaw: "445mm" })], regs);
    expect(proposal?.attributeTarget?.attributeId).toBe("attr-1");

    const blockers = proposalBlockers(proposal as Proposal, [proposal as Proposal]);
    expect(blockers.map((blocker) => blocker.code)).toContain("replace");
    expect(blockers[0]?.message).toContain("440mm");

    // Acknowledged, and it clears — the version it was tied to is re-checked
    // by the confirm, not here.
    const acknowledged = { ...(proposal as Proposal), overwriteAcknowledged: true };
    expect(proposalBlockers(acknowledged, [acknowledged])).toEqual([]);
  });

  it("refuses a diameter beside a width", () => {
    const regs = registers({ records: [record()] });
    const proposals = [
      ...resolve([observation({ attributeRaw: "Diameter", valueRaw: "460mm" })], regs),
      ...resolve([observation({ attributeRaw: "Width", valueRaw: "660mm" })], regs),
    ];
    const codes = proposalBlockers(proposals[0] as Proposal, proposals).map((blocker) => blocker.code);
    expect(codes).toContain("dia_conflict");
  });

  it("catches one slot stated twice", () => {
    const regs = registers({ records: [record()] });
    const proposals = [
      ...resolve([observation({ attributeRaw: "Seat height", valueRaw: "445mm" })], regs),
      ...resolve([observation({ attributeRaw: "SH", valueRaw: "450mm" })], regs),
    ];
    const codes = proposalBlockers(proposals[0] as Proposal, proposals).map((blocker) => blocker.code);
    expect(codes).toContain("duplicate_target");
  });
});

describe("rematchProposals", () => {
  const staged = (lines: Proposal[]): StagedSpecDocument => ({
    schemaVersion: 1,
    lines,
    documentNotes: null,
    filename: null,
  });

  it("re-resolves an observation that never placed, without a model call", () => {
    const before = resolveProposals([observation()], { records: [], requirements: [], answers: [] }, ids);
    expect(before[0]?.recordId).toBeNull();

    const result = rematchProposals(staged(before), registers(), ids);
    expect(result.rematched).toBe(1);
    expect(result.lines[0]?.recordId).toBe("rec-1");
  });

  it("does NOT fan an already-fanned observation out again", () => {
    // The trap this function exists around: re-resolving each PROPOSAL would
    // turn three runs into nine, then twenty-seven.
    const regs = registers({
      records: [
        record({ id: "mur", runId: "run-mur", runName: "MUR" }),
        record({ id: "main", runId: "run-main", runName: "MAIN RUN" }),
        record({ id: "ve", runId: "run-ve", runName: "VE" }),
      ],
    });
    const fanned = resolve([observation()], regs);
    expect(fanned).toHaveLength(3);

    const result = rematchProposals(staged(fanned), regs, ids);
    expect(result.lines).toHaveLength(3);
    // Nothing moved, so it is a genuine no-op: same ids, same versions.
    expect(result.rematched).toBe(0);
    expect(result.lines.map((line) => line.id)).toEqual(fanned.map((line) => line.id));
  });

  it("never touches an observation a person has already acted on", () => {
    const before = resolveProposals([observation()], { records: [], requirements: [], answers: [] }, ids);
    const edited = before.map((line) => ({ ...line, version: 2 }));
    expect(rematchProposals(staged(edited), registers(), ids).rematched).toBe(0);

    const ignored = before.map((line) => ({ ...line, reviewStatus: "ignored" as const }));
    expect(rematchProposals(staged(ignored), registers(), ids).rematched).toBe(0);
  });

  it("picks up a rule change that affects an already-resolved observation", () => {
    // The dimension reading landed after this email was read. The row had
    // already resolved to a record, so a guard of "only what never placed"
    // would have left it behind and the only fix would be a billed re-read.
    const regs = registers({ records: [record()] });
    const asAnswer: Proposal[] = [
      {
        ...(resolve([observation({ attributeRaw: "Seat height", valueRaw: "445mm" })], {
          ...regs,
          // Resolved as if the dimension reading did not exist.
        })[0] as Proposal),
        dimension: null,
        requirementId: "req-leg",
      },
    ];
    const result = rematchProposals(staged(asAnswer), regs, ids);
    expect(result.rematched).toBe(1);
    expect(result.lines[0]?.dimension?.slot).toBe("SH");
  });
});

describe("resolveProposals — finishes", () => {
  const regs = () =>
    registers({
      records: [record()],
      specFields: [
        { id: "f-com1", jsonId: 1, name: "COM 1" },
        { id: "f-com2", jsonId: 2, name: "COM 2" },
        { id: "f-com3", jsonId: 14, name: "COM 3" },
      ],
    });

  it("gives two fabrics in one document two different COM slots", () => {
    // Found against the real pilot email, which states three: all three took
    // COM 1, and the confirm would have refused the second on 0007's index.
    const proposals = resolveProposals(
      [
        observation({ attributeRaw: "Outside back", valueRaw: "UPH-07" }),
        observation({ attributeRaw: "Fabric (A configuration)", valueRaw: "CLO003 A (Tibor Blob)" }),
      ],
      regs(),
      ids,
    );
    expect(proposals.map((p) => p.finish?.specFieldName)).toEqual(["COM 1", "COM 2"]);
    expect(proposalBlockers(proposals[0] as Proposal, proposals)).toEqual([]);
  });

  it("does not hand out a slot the record already holds", () => {
    const withHeld = registers({
      records: [record()],
      specFields: [
        { id: "f-com1", jsonId: 1, name: "COM 1" },
        { id: "f-com2", jsonId: 2, name: "COM 2" },
      ],
      attributes: [
        {
          id: "attr-1", recordId: "rec-1", attrGroup: "material", slot: null, specFieldId: "f-com1",
          label: "SEAT", value: "UPH-01", unit: null, state: "confirmed", version: 1,
        },
      ],
    });
    const [proposal] = resolveProposals([observation({ attributeRaw: "Outside back", valueRaw: "UPH-07" })], withHeld, ids);
    expect(proposal?.finish?.specFieldName).toBe("COM 2");
    // Nothing to replace: it took a free slot rather than the occupied one.
    expect(proposal?.attributeTarget).toBeNull();
  });

  it("leaves prose alone, so a build instruction never lands in COM 1", () => {
    const [proposal] = resolveProposals(
      [observation({ attributeRaw: "Seat upholstery build", valueRaw: "loose cushions, feather wrap" })],
      regs(),
      ids,
    );
    expect(proposal?.finish ?? null).toBeNull();
  });
});

describe("rematchProposals — sharing the BWS slots", () => {
  it("does not hand every re-matched fabric the same COM slot", () => {
    // `rematchProposals` re-resolves ONE observation at a time, so a fresh
    // `taken` map per call gave all three of the pilot email's fabrics COM 1.
    // Found by running the real email through, not by a fixture.
    const regs = registers({
      records: [record()],
      specFields: [
        { id: "f-com1", jsonId: 1, name: "COM 1" },
        { id: "f-com2", jsonId: 2, name: "COM 2" },
        { id: "f-com3", jsonId: 14, name: "COM 3" },
      ],
    });
    // Staged as plain answer proposals, as they were before finishes existed.
    const before = resolveProposals(
      [
        observation({ attributeRaw: "Outside back", valueRaw: "UPH-07" }),
        observation({ attributeRaw: "Fabric (A configuration)", valueRaw: "CLO003 A" }),
        observation({ attributeRaw: "Fabric (B configuration)", valueRaw: "CLO004 B" }),
      ],
      { records: regs.records, requirements: [], answers: [] },
      ids,
    ).map((line) => ({ ...line, finish: null }));

    const result = rematchProposals(
      { schemaVersion: 1, lines: before, documentNotes: null, filename: null },
      regs,
      ids,
    );
    expect(result.rematched).toBe(3);
    expect(result.lines.map((line) => line.finish?.specFieldName)).toEqual(["COM 1", "COM 2", "COM 3"]);
  });

  it("sees a finish re-reading as a change, rather than calling it a no-op", () => {
    // `targetKey` left the BWS field out, so an observation that used to be a
    // checklist answer and now reads as a fabric keyed identically both ways —
    // and re-matching silently handed back the originals.
    const regs = registers({
      records: [record()],
      specFields: [{ id: "f-com1", jsonId: 1, name: "COM 1" }],
    });
    // Staged the way it was BEFORE finishes existed: an answer-shaped row.
    const before = resolveProposals(
      [observation({ attributeRaw: "Outside back", valueRaw: "UPH-07" })],
      { records: regs.records, requirements: [], answers: [] },
      ids,
    ).map((line) => ({ ...line, finish: null }));
    expect(before[0]?.finish).toBeNull();

    const result = rematchProposals(
      { schemaVersion: 1, lines: before, documentNotes: null, filename: null },
      regs,
      ids,
    );
    expect(result.rematched).toBe(1);
    expect(result.lines[0]?.finish?.specFieldName).toBe("COM 1");
  });
});
