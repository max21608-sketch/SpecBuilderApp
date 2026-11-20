// An email read BEFORE two lines were linked as twins (prod-ready review F2,
// 2026-11-20). Pure: no database, no model.
//
// ============================================================================
// THE DEFECT. An email about `HH-CH-02`, read while the code's two lines of
// Guest Rooms were not yet linked, staged as the person's question: one
// proposal, two candidates. Once the lines were linked, the screen still said
// "HH-CH-02 is on 2 lines of Guest Rooms — choose which": `linesToChooseFrom`
// never checked the twin links, although the records the screen loads carry
// them. A reviewer who picked one line left the twin without the spec, where a
// free Re-match would have landed it on both — and the page's "did not find an
// item … press Re-match" note left the row out. Proved here:
//
//   LINES THE LINKS NOW MAKE ONE ITEM say so, and say Re-match (free) — on the
//   chip, in the blocker and in the row — by the drawings' own predicate
//   (`everyPairTwinned`), the one a fresh read lands on twins by.
//
//   A RE-MATCH OVER THE LINKED REGISTERS lands it on each line.
//
//   LINES THE LINKS DO NOT WHOLLY COVER are still the person's question.
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  linesToChooseFrom,
  proposalBlockers,
  rematchProposals,
  resolveProposals,
  twinsSinceRead,
  type RecordEntry,
  type Registers,
} from "@/lib/spec-document";
import { describeChange } from "@/lib/spec-change";
import { groupIntoSpecRows } from "@/lib/spec-review-rows";
import type { RawProposal } from "@/lib/extraction-schema";

let counter = 0;
const ids = () => `p${++counter}`;

function line(id: string, recordNo: number, overrides: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id,
    recordNo,
    label: `T90000-${String(recordNo).padStart(3, "0")}`,
    itemDescription: "Lounge chair",
    categoryId: "cat-uph",
    categoryName: "Armchairs, Benches, Stools, Sofas",
    refs: ["QA-CH-02"],
    boqCodes: ["QA-CH-02"],
    runId: "run-gr",
    runName: "Guest Rooms",
    parentId: null,
    variantLabel: null,
    version: 1,
    ...overrides,
  };
}

const registers = (records: RecordEntry[]): Registers => ({
  records,
  requirements: [
    {
      id: "req-swivel",
      categoryId: "cat-uph",
      prompt: "Does it swivel?",
      kind: "spec_field",
      section: "Frame",
      specFieldName: null,
      aliases: [],
    },
  ],
  answers: [],
  documentKind: "email",
});

const statement: RawProposal = {
  refRaw: "QA-CH-02",
  attributeRaw: "Swivel",
  valueRaw: "no swivel",
  page: null,
  sourceSheet: null,
  sourceRow: null,
  confidence: "high",
  note: null,
  quotedText: "QA-CH-02 lounge chair: no swivel.",
};

// The two lines as the email was read: no links yet.
const unlinked = [line("rec-a", 2), line("rec-b", 3)];
// The same two lines after the reviewer linked them as twins (0060).
const linked = [line("rec-a", 2, { twinIds: ["rec-b"] }), line("rec-b", 3, { twinIds: ["rec-a"] })];

const SAYS = "QA-CH-02 is on 2 lines of Guest Rooms, linked as twins since this was read — Re-match (free)";

describe("an email staged before its two lines were linked as twins", () => {
  const staged = resolveProposals([statement], registers(unlinked), ids);

  it("staged as the person's question, as it was read", () => {
    expect(staged).toHaveLength(1);
    expect(staged[0]!.recordId).toBeNull();
    expect(staged[0]!.recordCandidates.map((candidate) => candidate.id)).toEqual(["rec-a", "rec-b"]);
    // With no links to read, the sentence is the one it always was.
    expect(linesToChooseFrom(staged[0]!)).toBe("QA-CH-02 is on 2 lines of Guest Rooms — choose which");
  });

  it("no longer asks which line, now the lines are twins, and says Re-match (free)", () => {
    const proposal = staged[0]!;
    expect(linesToChooseFrom(proposal, linked)).toBeNull();
    expect(twinsSinceRead(proposal, linked)).toBe(SAYS);
    expect(describeChange(proposal, linked).label).toBe(SAYS);
    expect(proposalBlockers(proposal, staged, linked).map((blocker) => blocker.message)).toEqual([
      `${SAYS} to put it on each line.`,
    ]);
    const [row] = groupIntoSpecRows(staged, staged, linked);
    expect(row!.summary.label).toBe(SAYS);
    expect(row!.blockers.map((blocker) => blocker.message)).toEqual([`${SAYS} to put it on each line.`]);
  });

  it("lands on each line at a Re-match over the linked registers, as a fresh read does", () => {
    const { lines, rematched } = rematchProposals(
      { schemaVersion: 1, lines: staged, documentNotes: null, filename: "QA.eml" },
      registers(linked),
      ids,
    );
    expect(rematched).toBe(1);
    expect(lines.map((proposal) => proposal.recordId).sort()).toEqual(["rec-a", "rec-b"]);
  });

  it("still asks which line where the links do not cover every line of the phase", () => {
    const three = [
      line("rec-a", 2, { twinIds: ["rec-b"] }),
      line("rec-b", 3, { twinIds: ["rec-a"] }),
      line("rec-c", 4),
    ];
    const asked = resolveProposals([statement], registers(three.map((entry) => ({ ...entry, twinIds: undefined }))), ids)[0]!;
    expect(asked.recordCandidates).toHaveLength(3);
    expect(twinsSinceRead(asked, three)).toBeNull();
    expect(linesToChooseFrom(asked, three)).toBe("QA-CH-02 is on 3 lines of Guest Rooms — choose which");
    expect(describeChange(asked, three).label).toBe("QA-CH-02 is on 3 lines of Guest Rooms — choose which");
  });
});
