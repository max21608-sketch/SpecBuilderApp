// The Aman tracker's furniture rows reaching the bill's line items, and a
// disagreement with the bill kept beside it (2026-10-05). Pure: registers are
// fixtures and every code is shaped like the real ones but invented where it
// matters (the bill's GR-FUR-04 / PL-FUR-04 shape is the point of the test).
import { describe, expect, it } from "vitest";
import { PROMPTS } from "@/lib/anthropic";
import { expandZoneList } from "@/lib/record-refs";
import {
  annotateHeld,
  asNoteProposal,
  foldNoteLabel,
  heldReading,
  proposalBlockers,
  rematchProposals,
  resolveProposals,
  sameNoteValue,
  unmatchedBecomesNote,
  type AttributeEntry,
  type Proposal,
  type RecordEntry,
  type Registers,
  type RequirementEntry,
} from "@/lib/spec-document";
import { describeChange } from "@/lib/spec-change";
import { groupIntoSpecRows } from "@/lib/spec-review-rows";
import type { RawProposal } from "@/lib/extraction-schema";

let counter = 0;
const ids = () => `p${++counter}`;

function record(overrides: Partial<RecordEntry>): RecordEntry {
  return {
    id: "rec",
    recordNo: 1,
    label: "P90000-001",
    itemDescription: "Desk chair",
    categoryId: "cat-seat",
    categoryName: "Seating",
    refs: [],
    boqCodes: [],
    runId: "run-main",
    runName: "CASEGOODS+SEATING+TABLES",
    parentId: null,
    variantLabel: null,
    version: 1,
    ...overrides,
  };
}

const gr04 = record({ id: "rec-gr04", label: "P90000-004", refs: ["GR-FUR-04"], boqCodes: ["GR-FUR-04"] });
const pl04 = record({ id: "rec-pl04", label: "P90000-005", refs: ["PL-FUR-04"], boqCodes: ["PL-FUR-04"] });
// GR-FUR-22 on two lines of ONE phase: the SX11A case.
const gr22a = record({ id: "rec-gr22a", label: "P90000-022", refs: ["GR-FUR-22"], boqCodes: ["GR-FUR-22"] });
const gr22b = record({ id: "rec-gr22b", label: "P90000-023", refs: ["GR-FUR-22"], boqCodes: ["GR-FUR-22"] });
const pl22 = record({ id: "rec-pl22", label: "P90000-024", refs: ["PL-FUR-22"], boqCodes: ["PL-FUR-22"] });

const requirementLeg: RequirementEntry = {
  id: "req-leg",
  categoryId: "cat-seat",
  prompt: "What is the frame/leg finish?",
  kind: "spec_field",
  section: "Frame",
  specFieldName: "Leg Finish",
  aliases: [],
};

/** The bill's W, in inches, and its Model Ref note. */
function billAttributes(): AttributeEntry[] {
  return [
    {
      id: "bill-w",
      recordId: "rec-gr04",
      attrGroup: "dimension",
      slot: "W",
      specFieldId: null,
      label: "Sizes (ft-in)",
      value: '21"',
      unit: "in",
      state: "confirmed",
      version: 1,
      fromBill: true,
      sourceRunId: "bill-run",
    },
    {
      id: "bill-model",
      recordId: "rec-gr04",
      attrGroup: "note",
      slot: null,
      specFieldId: null,
      label: "Model Ref:",
      value: "Bespoke",
      unit: null,
      state: "confirmed",
      version: 1,
      fromBill: true,
      sourceRunId: "bill-run",
    },
  ];
}

function registers(overrides: Partial<Registers> = {}): Registers {
  return {
    records: [gr04, pl04, gr22a, gr22b, pl22],
    requirements: [requirementLeg],
    answers: [],
    attributes: [],
    specFields: [],
    billRows: null,
    documentKind: "ffe_schedule",
    ...overrides,
  };
}

function observation(overrides: Partial<RawProposal>): RawProposal {
  return {
    refRaw: "GR / MUR / PL FUR04",
    attributeRaw: "Size",
    valueRaw: "W540 x D610 x SH430 mm",
    page: 9,
    sourceSheet: null,
    sourceRow: null,
    confidence: "high",
    note: null,
    ...overrides,
  };
}

describe("the ffe_schedule prompt reads a tracker's furniture", () => {
  it("leaves a tracker's own finish entries out, keeps the zones with the number, and names the columns", () => {
    expect(PROMPTS.ffe_schedule).toMatch(/those entries are not items/);
    expect(PROMPTS.ffe_schedule).toMatch(/"GR \/ MUR \/ PL\s+FUR04"/);
    expect(PROMPTS.ffe_schedule).toMatch(/Never expand the zones/);
    expect(PROMPTS.ffe_schedule).toMatch(/→ "Model ref"/);
    expect(PROMPTS.ffe_schedule).toMatch(/→ "Comment", verbatim with its date/);
    // The bill path's own rules are still there.
    expect(PROMPTS.ffe_schedule).toMatch(/THE SCHEDULE MAY BE A BILL OF QUANTITIES/);
  });
});

describe("expandZoneList", () => {
  it("reads the tracker's zone lists, one member per zone, in printed order", () => {
    expect(expandZoneList("GR / MUR / PL FUR04")).toEqual(["GR-FUR04", "MUR-FUR04", "PL-FUR04"]);
    expect(expandZoneList("GR / PL FUR23")).toEqual(["GR-FUR23", "PL-FUR23"]);
    expect(expandZoneList("GR / MUR / PL FUR22.1")).toEqual(["GR-FUR22.1", "MUR-FUR22.1", "PL-FUR22.1"]);
    expect(expandZoneList("GR FUR03A")).toEqual(["GR-FUR03A"]);
    // The real read of 2026-10-05 spaced the tracker's boxes: "FUR 04".
    expect(expandZoneList("GR / MUR / PL FUR 04")).toEqual(["GR-FUR 04", "MUR-FUR 04", "PL-FUR 04"]);
    expect(expandZoneList("GR / MUR / PL FUR 22.1")).toEqual(["GR-FUR 22.1", "MUR-FUR 22.1", "PL-FUR 22.1"]);
    expect(expandZoneList("GR / PL FUR ")).toBeNull();
    expect(expandZoneList("  GR / PL-FUR23 ")).toEqual(["GR-FUR23", "PL-FUR23"]);
  });

  it("refuses everything else", () => {
    expect(expandZoneList("FUR22.1")).toBeNull();
    expect(expandZoneList("GR-FUR-04")).toBeNull();
    expect(expandZoneList("S-201")).toBeNull();
    expect(expandZoneList("GR/PL FUR23")).toBeNull();
    expect(expandZoneList("gr / pl fur23")).toBeNull();
    expect(expandZoneList("GR / PL FUR")).toBeNull();
    expect(expandZoneList("")).toBeNull();
    expect(expandZoneList(null)).toBeNull();
  });
});

describe("a ref naming several zones names several items", () => {
  it("fans out to each member that is a line, sharing the observation, and names the one that is not", () => {
    const lines = resolveProposals([observation({})], registers(), ids);
    const widths = lines.filter((line) => line.dimension?.slot === "W");
    expect(widths.map((line) => line.recordId).sort()).toEqual(["rec-gr04", "rec-pl04"]);
    expect(new Set(lines.map((line) => line.sourceOrdinal))).toEqual(new Set([0]));
    // Named in words, and not a blocker: the other two resolved.
    expect(widths[0]?.readingNote).toMatch(/MUR-FUR04 — no line on the bill/);
    for (const line of lines) expect(proposalBlockers(line, lines)).toEqual([]);
    // One screen row, on one phase, two items.
    const [row] = groupIntoSpecRows(lines, lines);
    expect(row?.readingNotes.join(" ")).toMatch(/MUR-FUR04/);
  });

  it("keeps a member's own collision ambiguous, and still lands the members that resolve", () => {
    const lines = resolveProposals(
      [observation({ refRaw: "GR / PL FUR22", attributeRaw: "Status", valueRaw: "APPROVED FOR MUR" })],
      registers({ documentKind: "email" }),
      ids,
    );
    const ambiguous = lines.find((line) => line.recordCandidates.length === 2);
    expect(ambiguous?.recordId).toBeNull();
    expect(ambiguous?.recordCandidates.map((c) => c.id).sort()).toEqual(["rec-gr22a", "rec-gr22b"]);
    expect(lines.some((line) => line.recordCandidates.length === 1 && line.recordCandidates[0]?.id === "rec-pl22")).toBe(true);
  });

  it("is matched whole first: a ref that IS a line never expands", () => {
    const withSpaced = registers({ records: [record({ id: "odd", refs: ["GR / PL FUR23"] })] });
    const lines = resolveProposals([observation({ refRaw: "GR / PL FUR23", attributeRaw: "Status", valueRaw: "x" })], withSpaced, ids);
    expect(lines.map((line) => line.recordId)).toEqual(["odd"]);
  });

  it("is gained by an already-read run on a free re-match", () => {
    // Read before the expansion existed: one unplaced proposal.
    const before: Proposal = {
      ...resolveProposals([observation({ refRaw: "NOT-A-LINE" })], registers(), ids)[0]!,
      raw: observation({}),
    };
    const result = rematchProposals({ schemaVersion: 1, lines: [before], documentNotes: null, filename: "t.pdf" }, registers(), ids);
    expect(result.rematched).toBe(1);
    expect(new Set(result.lines.map((line) => line.recordId))).toEqual(new Set(["rec-gr04", "rec-pl04"]));
  });
});

describe("agrees or disagrees with the BILL", () => {
  const regs = () => registers({ records: [gr04], attributes: billAttributes() });

  it("a different width than the bill's is kept beside it: red, no blocker", () => {
    const [width] = resolveProposals([observation({ refRaw: "GR-FUR-04", valueRaw: "W540 mm" })], regs(), ids);
    expect(width?.attributeTarget?.fromBill).toBe(true);
    expect(heldReading(width!)).toBe("bill_differs");
    expect(proposalBlockers(width!, [width!])).toEqual([]);
    expect(describeChange(width!)).toMatchObject({ kind: "disagrees", label: "Disagrees with the bill", was: 'W 21" (533mm)' });
    // "Use this document's instead" is the replace tick, read as a change.
    const replacing = { ...width!, overwriteAcknowledged: true };
    expect(proposalBlockers(replacing, [replacing])).toEqual([]);
    expect(describeChange(replacing).kind).toBe("changes");
  });

  it("the same width in other units agrees: nothing to write, no blocker", () => {
    // 21" is 533.4mm, which the composed cell writes as 533.
    const [width] = resolveProposals([observation({ refRaw: "GR-FUR-04", valueRaw: "W533 mm" })], regs(), ids);
    expect(heldReading(width!)).toBe("same");
    expect(proposalBlockers(width!, [width!])).toEqual([]);
    expect(describeChange(width!)).toMatchObject({ kind: "agrees", label: "Agrees with the bill" });
  });

  it("over anybody else's value keeps today's replace tick, and the same value asks nothing", () => {
    const drawn = billAttributes().map((attribute) => ({ ...attribute, fromBill: false }));
    const different = resolveProposals([observation({ refRaw: "GR-FUR-04", valueRaw: "W540 mm" })], regs(), ids)[0]!;
    const overDrawing = { ...different, attributeTarget: { ...different.attributeTarget!, fromBill: false } };
    expect(heldReading(overDrawing)).toBe("replace");
    expect(proposalBlockers(overDrawing, [overDrawing]).map((b) => b.code)).toEqual(["replace"]);

    const same = resolveProposals(
      [observation({ refRaw: "GR-FUR-04", valueRaw: "W533 mm" })],
      registers({ records: [gr04], attributes: drawn }),
      ids,
    )[0]!;
    expect(heldReading(same)).toBe("same");
    expect(proposalBlockers(same, [same])).toEqual([]);
    expect(describeChange(same).kind).toBe("repeats");
  });

  it("an older staged row with no live facts reads exactly as before", () => {
    const [width] = resolveProposals([observation({ refRaw: "GR-FUR-04", valueRaw: "W533 mm" })], regs(), ids);
    const old = { ...width!, attributeTarget: { attributeId: "bill-w", attributeVersion: 1, label: "x", value: '21"', unit: "in" as const } };
    expect(heldReading(old)).toBe("replace");
    expect(proposalBlockers(old, [old]).map((b) => b.code)).toEqual(["replace"]);
  });

  it("is re-read live: a held value that moved since is a blocker, and the live facts are applied", () => {
    const [width] = resolveProposals([observation({ refRaw: "GR-FUR-04", valueRaw: "W540 mm" })], regs(), ids);
    const [stale] = annotateHeld([width!], []);
    expect(stale?.attributeTarget?.moved).toBe(true);
    expect(proposalBlockers(stale!, [stale!]).map((b) => b.code)).toEqual(["held_changed"]);

    const corrected = billAttributes().map((attribute) => (attribute.id === "bill-w" ? { ...attribute, fromBill: false } : attribute));
    const [live] = annotateHeld([width!], corrected);
    expect(live?.attributeTarget?.fromBill).toBe(false);
    expect(heldReading(live!)).toBe("replace");
  });
});

describe("a statement no question matches is kept as a note", () => {
  it("only on a schedule, never on an email", () => {
    expect(unmatchedBecomesNote("ffe_schedule")).toBe(true);
    expect(unmatchedBecomesNote("fabric_schedule")).toBe(true);
    expect(unmatchedBecomesNote("spec_bible")).toBe(true);
    expect(unmatchedBecomesNote("other")).toBe(true);
    expect(unmatchedBecomesNote("email")).toBe(false);
    expect(unmatchedBecomesNote(null)).toBe(false);
  });

  it("folds a note's label by case, whitespace and punctuation, and its value by case and whitespace only", () => {
    expect(foldNoteLabel("Model Ref:")).toBe(foldNoteLabel("model  ref"));
    expect(foldNoteLabel("Model ref")).not.toBe(foldNoteLabel("Model"));
    expect(sameNoteValue("WEWOOD — bespoke", " wewood —  Bespoke ")).toBe(true);
    expect(sameNoteValue("WEWOOD — bespoke", "WEWOOD - bespoke")).toBe(false);
    expect(sameNoteValue("", "")).toBe(false);
  });

  it("becomes a note on its item, and disagrees with the bill's note under the same heading", () => {
    const regs = registers({ records: [gr04], attributes: billAttributes() });
    const lines = resolveProposals(
      [
        observation({ refRaw: "GR-FUR-04", attributeRaw: "Model ref", valueRaw: "WEWOOD — Caravela" }),
        observation({ refRaw: "GR-FUR-04", attributeRaw: "Supplier", valueRaw: "WEWOOD, Porto" }),
        observation({ refRaw: "GR-FUR-04", attributeRaw: "Model ref", valueRaw: "bespoke" }),
      ],
      regs,
      ids,
    );
    const [model, supplier, same] = lines;
    expect(model?.note).toEqual({ label: "Model ref", tbc: false });
    expect(model?.recordId).toBe("rec-gr04");
    expect(model?.attributeTarget?.attributeId).toBe("bill-model");
    expect(heldReading(model!)).toBe("bill_differs");
    expect(describeChange(model!).kind).toBe("disagrees");
    expect(proposalBlockers(model!, lines)).toEqual([]);

    expect(supplier?.note?.label).toBe("Supplier");
    expect(supplier?.attributeTarget).toBeNull();
    expect(describeChange(supplier!)).toMatchObject({ kind: "provides", label: "Kept as a note" });

    expect(heldReading(same!)).toBe("same");
    expect(describeChange(same!).kind).toBe("agrees");
  });

  it("an email's unmatched sentence stays a question nobody matched", () => {
    const [line] = resolveProposals(
      [observation({ refRaw: "GR-FUR-04", attributeRaw: "Supplier", valueRaw: "WEWOOD" })],
      registers({ records: [gr04], documentKind: "email" }),
      ids,
    );
    expect(line?.note ?? null).toBeNull();
    expect(describeChange(line!).kind).toBe("no_question");
  });

  it("a statement that answers a question is still an answer, and a blank one is not a note", () => {
    const [answer, blank] = resolveProposals(
      [
        observation({ refRaw: "GR-FUR-04", attributeRaw: "Leg Finish", valueRaw: "Smoked oak" }),
        observation({ refRaw: "GR-FUR-04", attributeRaw: "Link", valueRaw: "  " }),
      ],
      registers({ records: [gr04] }),
      ids,
    );
    expect(answer?.requirementId).toBe("req-leg");
    expect(answer?.note ?? null).toBeNull();
    expect(blank?.note ?? null).toBeNull();
    expect(asNoteProposal(blank!, gr04, registers())).toBeNull();
  });

  it("a run read before notes existed gains them on a free re-match", () => {
    const old = resolveProposals(
      [observation({ refRaw: "GR-FUR-04", attributeRaw: "Supplier", valueRaw: "WEWOOD" })],
      registers({ records: [gr04], documentKind: null }),
      ids,
    );
    expect(old[0]?.note ?? null).toBeNull();
    const result = rematchProposals(
      { schemaVersion: 1, lines: old, documentNotes: null, filename: "t.pdf" },
      registers({ records: [gr04] }),
      ids,
    );
    expect(result.rematched).toBe(1);
    expect(result.lines[0]?.note?.label).toBe("Supplier");
    // Twice is a no-op.
    const again = rematchProposals(
      { schemaVersion: 1, lines: result.lines, documentNotes: null, filename: "t.pdf" },
      registers({ records: [gr04] }),
      ids,
    );
    expect(again.rematched).toBe(0);
  });
});

describe("a note that points elsewhere, or says the bill's words and more", () => {
  it("reads a pointer to the drawing as no statement, anchored at the start", async () => {
    const { pointsElsewhere } = await import("@/lib/spec-vocab");
    for (const value of ["REFER DRAWING", "Refer to drawings", "As per Drawing (To be confirmed on site)", "see the drawing", "As per dwg"]) {
      expect(pointsElsewhere(value), value).toBe(true);
    }
    for (const value of ["Oak, refer drawing for grain", "Stained", "Drawing room", "", null]) {
      expect(pointsElsewhere(value), String(value)).toBe(false);
    }
  });

  it("finds the bill's words whole inside a fuller statement, and nowhere else", async () => {
    const { containsWords } = await import("@/lib/spec-document");
    expect(containsWords("WEWOOD — BESPOKE DESIGN", "BESPOKE DESIGN")).toBe(true);
    expect(containsWords("WEWOOD — BESPOKE DESIGN", "bespoke")).toBe(true);
    expect(containsWords("BESPOKE DESIGN", "BESPOKE DESIGN")).toBe(false); // equal is "same", not "contains"
    expect(containsWords("WEWOOD Caravela", "BESPOKE DESIGN")).toBe(false);
    expect(containsWords("Oakley", "Oak")).toBe(false); // whole words only
    // The other way round is read by heldReading too: the bill's fuller fabric line.
    expect(containsWords("Supplier Own - Teddy 05/10 Beige", "TEDDY 05/10 Beige")).toBe(true);
  });
});

describe("the screen's commit groups hold a record's WHOLE pending set", () => {
  it("keeps a row with no label in its record's group, borrowing a sibling's label", async () => {
    const { commitGroups } = await import("@/lib/spec-review-rows");
    const row = (id: string, recordLabel: string | null) =>
      ({ id, reviewStatus: "pending", recordId: "rec-1", recordLabel, target: null }) as unknown as Proposal;
    // The confirm counts all three; a group of two refused the item as
    // "changed while you were reviewing" (the real tracker, 2026-10-05).
    const groups = commitGroups([row("a", null), row("b", "T18192-013"), row("c", "T18192-013")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.recordLabel).toBe("T18192-013");
    expect(groups[0]!.proposals.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("a figure the tracker printed with no unit", () => {
  it("agrees with the bill's same number and disagrees with a different one, converting nothing", () => {
    const held = { attributeId: "a", attributeVersion: 1, label: "W", value: "660", unit: "mm" as const, state: "confirmed" as const, fromBill: true };
    const proposal = (figure: string) =>
      ({ id: "p", dimension: { slot: "W", figure, unit: null, tbc: false }, raw: { valueRaw: `W: ${figure}` }, attributeTarget: held }) as unknown as Proposal;
    expect(heldReading(proposal("660"))).toBe("same");
    expect(heldReading(proposal("540"))).toBe("bill_differs");
  });
});
