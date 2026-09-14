// Pure tier. Synthetic fixtures shaped like an FF&E preamble's numbered
// clauses; no client wording is in this repo.
import { describe, it, expect } from "vitest";
import { stagePreamble, assertStagedPreamble, preambleNoteBlockers, hasPendingNotes } from "@/lib/preamble-document";

const raw = [
  { topicRaw: "SECTION 4 SEATING", titleRaw: "Flameproofing", bodyRaw: "All public areas to be flameproofed to the local standard, with a certificate provided.", page: 14 },
  { topicRaw: "SECTION 4 SEATING", titleRaw: "Samples", bodyRaw: "Samples of all fabrics and finishes submitted for approval prior to purchase.", page: 14 },
];

describe("stagePreamble", () => {
  it("gives every note its own id and version, and copies the document's words as the editable text", () => {
    const doc = stagePreamble(raw, "preamble.pdf", "Covers five trades.");
    expect(doc.notes).toHaveLength(2);
    expect(new Set(doc.notes.map((note) => note.id)).size).toBe(2);
    expect(doc.notes[0]).toMatchObject({
      version: 1,
      page: 14,
      title: "Flameproofing",
      body: raw[0]!.bodyRaw,
      bodyRaw: raw[0]!.bodyRaw,
      reviewStatus: "pending",
    });
    expect(doc.documentNotes).toBe("Covers five trades.");
  });

  it("keeps the original wording beside the reviewer's edit", () => {
    // The edited text is what reaches the project; the raw text is what the
    // document said, so a value can always be traced back.
    const doc = stagePreamble(raw, null, null);
    doc.notes[0]!.body = "Edited by a human";
    expect(doc.notes[0]!.bodyRaw).toBe(raw[0]!.bodyRaw);
  });
});

describe("preambleNoteBlockers", () => {
  it("blocks a note the reviewer has emptied", () => {
    const doc = stagePreamble(raw, null, null);
    doc.notes[0]!.body = "   ";
    const blockers = preambleNoteBlockers(doc);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.noteId).toBe(doc.notes[0]!.id);
  });

  it("ignores a note that is no longer pending", () => {
    const doc = stagePreamble(raw, null, null);
    doc.notes[0]!.body = "";
    doc.notes[0]!.reviewStatus = "ignored";
    expect(preambleNoteBlockers(doc)).toEqual([]);
  });
});

describe("hasPendingNotes", () => {
  it("is false once every note is reviewed", () => {
    const doc = stagePreamble(raw, null, null);
    expect(hasPendingNotes(doc)).toBe(true);
    for (const note of doc.notes) note.reviewStatus = "applied";
    expect(hasPendingNotes(doc)).toBe(false);
  });
});

describe("assertStagedPreamble", () => {
  it("refuses a run staged as something else", () => {
    expect(() => assertStagedPreamble({ kind: "shop_drawings", items: [] })).toThrow(/not staged as a preamble/);
  });
});
