// Matching a revised bill against the run it revises. Pure, so no database.
import { describe, it, expect } from "vitest";
import {
  reconcileSheet,
  lineDeltas,
  effectiveArea,
  configurationRange,
  type ExistingRecord,
  type RevisedLine,
} from "@/lib/boq-reconcile";

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

// ---- audit 2026-11-06, 1.2: a configuration follows its line (C1), and a
// retired record whose code comes back is offered, never paired (C14).
describe("reconcileSheet — configurations and retired records", () => {
  it("names the configurations a line that will be retired takes with it", () => {
    const result = reconcileSheet(
      [line({ code: "S-999" })],
      [record({ configurations: ["14.1", "14.2"] })],
    );
    expect(result.missing[0]!.configurations).toEqual(["14.1", "14.2"]);
  });

  it("offers a retired record whose code comes back as a restore, and pairs nothing", () => {
    const retired = record({ id: "rec-old", recordNo: 9, label: "P17726-009", codes: ["S-300"] });
    const result = reconcileSheet([line({ code: "S-300" })], [record()], [retired]);
    const only = result.lines[0]!;
    // Never auto-paired: the line stays new until a person chooses.
    expect(only.status).toBe("new");
    expect(only.suggestedRecordId).toBeNull();
    expect(only.restoreCandidates).toEqual(["rec-old"]);
    expect(result.counts).toMatchObject({ new: 1, restored: 0 });
  });

  it("offers both, and pairs neither, when two retired records carry the code (SX11A)", () => {
    const result = reconcileSheet(
      [line({ code: "S-300" })],
      [],
      [record({ id: "rec-a", codes: ["S-300"] }), record({ id: "rec-b", codes: ["S.300"] })],
    );
    expect(result.lines[0]!.status).toBe("new");
    expect(result.lines[0]!.restoreCandidates).toEqual(["rec-a", "rec-b"]);
  });

  it("offers no restore where a live record already carries the code", () => {
    const result = reconcileSheet([line()], [record()], [record({ id: "rec-old" })]);
    expect(result.lines[0]!.status).toBe("paired");
    expect(result.lines[0]!.restoreCandidates).toEqual([]);
  });

  it("reads a reviewer's restore as a restore, with its deltas against the retired record", () => {
    const retired = record({ id: "rec-old", qty: 2, codes: ["S-300"] });
    const result = reconcileSheet(
      [line({ code: "S-300", qty: 5, replaces: { recordId: "rec-old", recordVersion: 3, restore: true } })],
      [],
      [retired],
    );
    expect(result.lines[0]!.status).toBe("restore");
    expect(result.lines[0]!.suggestedRecordId).toBe("rec-old");
    expect(result.lines[0]!.deltas).toEqual([{ field: "qty", label: "Quantity", was: "2", now: "5" }]);
    expect(result.counts).toMatchObject({ restored: 1, new: 0, paired: 0 });
  });
});

describe("configurationRange", () => {
  it("writes a run of consecutive configurations as a range", () => {
    expect(configurationRange(["12.1", "12.2", "12.3", "12.4", "12.5"])).toBe("12.1–12.5");
  });
  it("lists them where there is a gap, or only two", () => {
    expect(configurationRange(["12.1", "12.3"])).toBe("12.1 and 12.3");
    expect(configurationRange(["12.1", "12.2"])).toBe("12.1 and 12.2");
    expect(configurationRange(["12.1", "12.3", "12.4"])).toBe("12.1, 12.3 and 12.4");
    expect(configurationRange(["12.1"])).toBe("12.1");
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
