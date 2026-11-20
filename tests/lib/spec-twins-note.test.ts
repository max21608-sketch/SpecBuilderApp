// The twins sentence describes its own phase's lines (prod-ready review F3,
// 2026-11-20). Pure: no database, no model.
//
// ============================================================================
// THE DEFECT. `landOnTwins` built ONE sentence per statement and attached it to
// every row the statement produced — rows on phases with no twins included —
// so a code on a twin pair in each of two phases read "A and B and C and D are
// twins: the bill lists one item on 4 lines": two items, two lines each, and a
// third phase whose single line has no twin at all told the same. Wording only:
// where each row lands is unchanged. Proved here: one sentence per phase's twin
// group, on that group's rows only.
// ============================================================================
import { describe, expect, it } from "vitest";
import { resolveProposals, type RecordEntry, type Registers } from "@/lib/spec-document";
import type { RawProposal } from "@/lib/extraction-schema";

let counter = 0;
const ids = () => `p${++counter}`;

function line(id: string, recordNo: number, runId: string, runName: string, twinIds?: string[]): RecordEntry {
  return {
    id,
    recordNo,
    label: `T90000-${String(recordNo).padStart(3, "0")}`,
    itemDescription: "Lounge chair",
    categoryId: "cat-uph",
    categoryName: "Armchairs, Benches, Stools, Sofas",
    refs: ["QA-CH-02"],
    boqCodes: ["QA-CH-02"],
    runId,
    runName,
    parentId: null,
    variantLabel: null,
    version: 1,
    ...(twinIds ? { twinIds } : {}),
  };
}

const records = [
  line("gr-a", 2, "run-gr", "Guest Rooms", ["gr-b"]),
  line("gr-b", 3, "run-gr", "Guest Rooms", ["gr-a"]),
  line("su-a", 12, "run-su", "Suites", ["su-b"]),
  line("su-b", 13, "run-su", "Suites", ["su-a"]),
  line("lo-a", 22, "run-lo", "Lobby"),
];

const registers: Registers = {
  records,
  requirements: [
    { id: "req-swivel", categoryId: "cat-uph", prompt: "Does it swivel?", kind: "spec_field", section: "Frame", specFieldName: null, aliases: [] },
  ],
  answers: [],
  documentKind: "email",
};

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

const GUEST_ROOMS =
  "T90000-002 and T90000-003 are twins: the bill lists one item on 2 lines, so this goes on each. Ignore it on a line whose spec differs.";
const SUITES =
  "T90000-012 and T90000-013 are twins: the bill lists one item on 2 lines, so this goes on each. Ignore it on a line whose spec differs.";

describe("a code on a twin pair in each of two phases, and one line of a third", () => {
  const lines = resolveProposals([statement], registers, ids);
  const on = (recordId: string) => lines.find((proposal) => proposal.recordId === recordId)!;

  it("still lands on every line", () => {
    expect(lines.map((proposal) => proposal.recordId).sort()).toEqual(["gr-a", "gr-b", "lo-a", "su-a", "su-b"]);
  });

  it("says each phase's twins on that phase's rows, and nothing about twins on a line that has none", () => {
    expect(on("gr-a").readingNote).toBe(GUEST_ROOMS);
    expect(on("gr-b").readingNote).toBe(GUEST_ROOMS);
    expect(on("su-a").readingNote).toBe(SUITES);
    expect(on("su-b").readingNote).toBe(SUITES);
    expect(on("lo-a").readingNote ?? null).toBeNull();
  });
});
