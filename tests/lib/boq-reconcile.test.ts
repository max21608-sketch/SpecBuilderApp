// Matching a revised bill against the run it revises. Pure, so no database.
import { describe, it, expect } from "vitest";
import { reconcileSheet, lineDeltas, effectiveArea, type ExistingRecord, type RevisedLine } from "@/lib/boq-reconcile";

const record = (over: Partial<ExistingRecord> = {}): ExistingRecord => ({
  id: "rec-1",
  version: 1,
  recordNo: 14,
  label: "P17726-014",
  itemDescription: "Two seat sofa",
  productReference: null,
  qty: 6,
  designer: "LCS",
  area: "Guestrooms",
  boqCategory: "Seating",
  codes: ["S-100"],
  attributeCount: 0,
  hasImage: false,
  settledAnswers: 0,
  ...over,
});

const line = (over: Partial<RevisedLine> = {}): RevisedLine => ({
  index: 0,
  lineNo: 7,
  code: "S-100",
  itemDescription: "Two seat sofa",
  productReference: null,
  qty: 6,
  designer: "LCS",
  area: "Guestrooms",
  boqCategory: "Seating",
  ignored: false,
  replaces: null,
  ...over,
});

describe("reconcileSheet", () => {
  it("pairs a line to the record carrying its code", () => {
    const result = reconcileSheet([line()], [record()]);
    expect(result.lines[0]!.status).toBe("paired");
    expect(result.lines[0]!.suggestedRecordId).toBe("rec-1");
    expect(result.counts).toMatchObject({ paired: 1, changed: 0, new: 0, ambiguous: 0, missing: 0 });
  });

  it("reports the fields a revision changed, and nothing else", () => {
    const result = reconcileSheet([line({ qty: 8 })], [record()]);
    expect(result.lines[0]!.deltas).toEqual([{ field: "qty", label: "Quantity", was: "6", now: "8" }]);
    expect(result.counts.changed).toBe(1);
  });

  it("calls a line with no match new, and an unpaired record missing", () => {
    const result = reconcileSheet([line({ code: "S-999" })], [record()]);
    expect(result.lines[0]!.status).toBe("new");
    expect(result.missing.map((m) => m.recordId)).toEqual(["rec-1"]);
  });

  it("pairs NOTHING when one code matches two records — the SX11A case", () => {
    // The pilot BOQ contains SX11A twice with different quantities. There is
    // no rule saying which revised line continues which record, and guessing
    // moves a drawing onto the wrong item.
    const result = reconcileSheet(
      [line({ code: "SX11A" })],
      [record({ id: "rec-a", codes: ["SX11A"] }), record({ id: "rec-b", codes: ["SX11A"] })],
    );
    expect(result.lines[0]!.status).toBe("ambiguous");
    expect(result.lines[0]!.suggestedRecordId).toBeNull();
    expect(result.lines[0]!.candidates.sort()).toEqual(["rec-a", "rec-b"]);
    // And neither record is claimed, so both show as missing until somebody pairs them.
    expect(result.missing).toHaveLength(2);
  });

  it("pairs nothing when TWO lines carry the same code", () => {
    const result = reconcileSheet(
      [line({ index: 0, code: "SX11A" }), line({ index: 1, lineNo: 8, code: "SX11A" })],
      [record({ codes: ["SX11A"] })],
    );
    expect(result.lines.map((l) => l.status)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("honours a pairing the reviewer made by hand, even where the code is ambiguous", () => {
    const result = reconcileSheet(
      [line({ code: "SX11A", replaces: { recordId: "rec-b", recordVersion: 1 } })],
      [record({ id: "rec-a", codes: ["SX11A"] }), record({ id: "rec-b", codes: ["SX11A"], qty: 2 })],
    );
    expect(result.lines[0]!.status).toBe("paired");
    expect(result.lines[0]!.suggestedRecordId).toBe("rec-b");
    expect(result.lines[0]!.deltas).toEqual([{ field: "qty", label: "Quantity", was: "2", now: "6" }]);
    expect(result.missing.map((m) => m.recordId)).toEqual(["rec-a"]);
  });

  it("never pairs a codeless line", () => {
    // The code is the only identity a bill line carries. A line without one
    // can only be new; a person can still pair it by hand.
    const result = reconcileSheet([line({ code: null })], [record()]);
    expect(result.lines[0]!.status).toBe("new");
  });

  it("matches a code the two sides punctuate differently", () => {
    const result = reconcileSheet([line({ code: " s-100 " })], [record({ codes: ["S-100"] })]);
    expect(result.lines[0]!.status).toBe("paired");
  });

  it("ignores an ignored line completely", () => {
    const result = reconcileSheet([line({ ignored: true })], [record()]);
    expect(result.lines).toHaveLength(0);
    expect(result.missing).toHaveLength(1);
  });

  it("names what a retirement would take out, rather than just counting records", () => {
    const result = reconcileSheet(
      [line({ code: "S-999" })],
      [record({ attributeCount: 14, hasImage: true, settledAnswers: 3 })],
    );
    expect(result.missing[0]).toMatchObject({ attributeCount: 14, hasImage: true, settledAnswers: 3 });
  });
});

describe("effectiveArea", () => {
  it("falls back to the BOQ's own grouping word, the way the confirm writes it", () => {
    // Without this every line whose bill left Area blank reports a phantom
    // change, which on the pilot is most of them.
    expect(effectiveArea({ area: null, boqCategory: "Seating" })).toBe("Seating");
    expect(effectiveArea({ area: "Guestrooms", boqCategory: "Seating" })).toBe("Guestrooms");
    expect(lineDeltas(line({ area: null, boqCategory: "Seating" }), record({ area: "Seating" }))).toEqual([]);
  });
});
