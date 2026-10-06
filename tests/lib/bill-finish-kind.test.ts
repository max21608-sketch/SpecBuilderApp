// A bill's finish line is filed by KIND: fabric to COM, timber and metal to
// their own fields, and a line with nowhere to go is kept with none — never a
// refused bill (2026-10-06).
//
// Pure tier. Every code, supplier, reference and colour is INVENTED; the
// SHAPES are a specifier's bill (an item, then one coded finish per line
// under it) and a contractor's (an uncoded fabric or leather line under its
// item).
import { describe, expect, it } from "vitest";
import {
  billFinishLineKind,
  billFinishShape,
  decideBillFinishSlot,
  describeBillFinishSlot,
  heldBillFinishKind,
  readBillFinishKind,
} from "@/lib/bill-finish-kind";
import { billFinishCodeKind } from "@/lib/material-words";
import { classifyCallout } from "@/lib/drawing-document";
import { planBillFabrics } from "@/lib/bill-fabric-filing";
import { planSheetDescriptions } from "@/lib/bill-description";
import type { SpecFieldEntry } from "@/lib/drawing-document";

describe("readBillFinishKind — the code, then the words, else nothing", () => {
  it("reads the bill's F-<KIND>-n code by its second group", () => {
    expect(readBillFinishKind({ code: "F-FA-05", words: "EXAMPLE MILL | ZX-1 / ALPHA | MOHAIR | IVORY" })).toEqual({
      kind: "fabric",
      reason: "the code F-FA-05 says so",
    });
    expect(readBillFinishKind({ code: "F-FA-07", words: "EXAMPLE TANNERY | ZX-2 | LEATHER | OXBLOOD" }).kind).toBe("fabric");
    expect(readBillFinishKind({ code: "F-MT-03", words: "TO ELECT | POLISHED NICKEL | CLEAR LACQUERED" }).kind).toBe("metal");
    // A timber nothing in the words names: the code is the only evidence.
    expect(readBillFinishKind({ code: "F-WD-02", words: "EXAMPLE SAPELE, SATIN" }).kind).toBe("timber");
    expect(readBillFinishKind({ code: "F-TR-01", words: "EXAMPLE TRIMS | ZX-9 CORD WITH TAPE | CORD" }).kind).toBe("trim");
  });

  it("lets the code beat the words: a trim in velvet is a trim", () => {
    expect(readBillFinishKind({ code: "F-TR-02", words: "EXAMPLE TRIMS | VELVET RIBBON" }).kind).toBe("trim");
  });

  it("reads an uncoded contractor's line by its words, as before", () => {
    for (const words of ["CLUB CHAIR FABRIC", "BED - LEATHER BW", "BAR STOOLS - COM", "DESK - COL"]) {
      expect(readBillFinishKind({ code: null, words }).kind, words).toBe("fabric");
    }
  });

  it("goes through the drawings path's reading for every other code", () => {
    expect(readBillFinishKind({ code: "ZZ-TIM-03", words: "Example ash" }).kind).toBe("timber");
    expect(readBillFinishKind({ code: "MT-04", words: "Example finish" }).kind).toBe("metal");
    expect(readBillFinishKind({ code: null, words: "Example castors, black" }).kind).toBe("hardware");
  });

  it("never infers a kind: a line that does not say is no kind", () => {
    expect(readBillFinishKind({ code: null, words: "Example colourway 12" })).toEqual({ kind: null, reason: null });
    expect(readBillFinishKind({ code: "F-ST-01", words: "Example honed" }).kind).toBeNull();
  });

  it("reads the code off the staged line, the item's own code taken off", () => {
    expect(
      billFinishLineKind({ code: "F-WD-02", itemDescription: "EXAMPLE SAPELE", finishFor: { code: "ZZ-SE-03.A" } }).kind,
    ).toBe("timber");
    // A finish line whose code IS its item's names nothing by its code.
    expect(billFinishLineKind({ code: "ZZ-SE-03.A", itemDescription: "Example plain", finishFor: { code: "ZZ-SE-03.A" } }).kind).toBeNull();
  });
});

describe("the bill's code shape is BILL-ONLY", () => {
  it("fires on exactly the F-<group>-n shape", () => {
    expect(billFinishCodeKind("F-FA-18")).toBe("fabric");
    expect(billFinishCodeKind("f-mt-03")).toBe("metal");
    expect(billFinishCodeKind("F-FAB-01")).toBe("fabric");
    expect(billFinishCodeKind("FA-05")).toBeNull();
    expect(billFinishCodeKind("GR-FAB-13")).toBeNull();
    expect(billFinishCodeKind("F-WD-02 walnut")).toBeNull();
  });

  it("leaves a drawing's reading of the same code exactly as it was", () => {
    // classifyCallout is what upgradeCalloutGuesses re-runs at read time over
    // every staged pack: an F- code it never read must stay unread there.
    expect(classifyCallout({ labelRaw: "SIDE PANEL", valueRaw: "Example sapele", materialCodeRaw: "F-WD-02" }).kind).toBeNull();
    expect(classifyCallout({ labelRaw: null, valueRaw: "Example", materialCodeRaw: "F-FA-05" }).kind).toBeNull();
    expect(classifyCallout({ labelRaw: null, valueRaw: "DESK - COL" }).kind).toBeNull();
  });
});

describe("decideBillFinishSlot — the next slot of the line's kind, or kept with none", () => {
  const taken = (...ids: number[]) => new Set(ids);

  it("fills fabric COM 1, 2, 3 and then keeps the fourth with no field", () => {
    expect(decideBillFinishSlot("fabric", taken()).jsonId).toBe(1);
    expect(decideBillFinishSlot("fabric", taken(1)).jsonId).toBe(2);
    expect(decideBillFinishSlot("fabric", taken(1, 2)).jsonId).toBe(14);
    expect(decideBillFinishSlot("fabric", taken(1, 2, 14))).toEqual({
      kind: "fabric",
      attrGroup: "material",
      label: "Fabric",
      jsonId: null,
      kept: "full",
    });
  });

  it("puts a metal and a timber in their own fields, whatever the COMs hold", () => {
    expect(decideBillFinishSlot("metal", taken(1, 2, 14))).toMatchObject({ jsonId: 5, attrGroup: "finish", label: "Metal" });
    expect(decideBillFinishSlot("metal", taken(5)).jsonId).toBe(35);
    expect(decideBillFinishSlot("metal", taken(5, 35)).kept).toBe("full");
    expect(decideBillFinishSlot("timber", taken())).toMatchObject({ jsonId: 4, attrGroup: "finish", label: "Timber" });
    expect(decideBillFinishSlot("timber", taken(4, 31)).jsonId).toBe(143);
  });

  it("keeps a trim, hardware and an unsaid line with no field", () => {
    expect(decideBillFinishSlot("trim", taken())).toMatchObject({ jsonId: null, kept: "no_field", attrGroup: "other", label: "Trim" });
    expect(decideBillFinishSlot("hardware", taken())).toMatchObject({ jsonId: null, kept: "no_field", attrGroup: "hardware" });
    expect(decideBillFinishSlot(null, taken())).toMatchObject({ jsonId: null, kept: "no_field", attrGroup: "other", label: "Finish" });
  });

  it("says where each goes, in the review's words", () => {
    expect(describeBillFinishSlot(decideBillFinishSlot("fabric", taken(1, 2)))).toBe("→ COM 3");
    expect(describeBillFinishSlot(decideBillFinishSlot("metal", taken()))).toBe("→ Main metal finish");
    expect(describeBillFinishSlot(decideBillFinishSlot("timber", taken(4)))).toBe("→ Timber Finish 2");
    expect(describeBillFinishSlot(decideBillFinishSlot("fabric", taken(1, 2, 14)))).toBe("→ kept, COM 1–3 are full");
    expect(describeBillFinishSlot(decideBillFinishSlot("metal", taken(5, 35)))).toBe("→ kept, both metal finishes are full");
    expect(describeBillFinishSlot(decideBillFinishSlot("trim", taken()))).toBe("→ kept, no BWS field (trim)");
    expect(describeBillFinishSlot(decideBillFinishSlot(null, taken()))).toBe(
      "→ kept, no BWS field (its code and words do not say what it is)",
    );
  });

  it("reads a held row's kind back off its group and label", () => {
    for (const kind of ["fabric", "timber", "metal", "hardware", "trim", null] as const) {
      expect(heldBillFinishKind(billFinishShape(kind))).toBe(kind);
    }
    // A material row is a fabric whatever its label — the rule before kinds.
    expect(heldBillFinishKind({ attrGroup: "material", label: "COM" })).toBe("fabric");
    // A description's own finish row, labelled as printed, is no finish line's.
    expect(heldBillFinishKind({ attrGroup: "finish", label: "Wood" })).toBeUndefined();
    expect(heldBillFinishKind({ attrGroup: "dimension", label: "Width" })).toBeUndefined();
  });
});

describe("planBillFabrics says where every finish line under one item goes", () => {
  type Line = Parameters<typeof planBillFabrics>[0]["sheets"][number]["lines"][number];
  const item: Line = { index: 0, lineNo: 2, code: "ZZ-SE-03.A", itemDescription: "BANQUETTE", ignored: false, rowKind: "item" };
  const finish = (index: number, code: string, words: string): Line => ({
    index,
    lineNo: index + 2,
    code,
    itemDescription: words,
    ignored: false,
    rowKind: "finish_for",
    finishFor: { row: 2, code: "ZZ-SE-03.A" },
  });
  const lines = [
    item,
    finish(1, "F-FA-05", "EXAMPLE MILL | ZX-1 / ALPHA | MOHAIR | IVORY"),
    finish(2, "F-FA-07", "EXAMPLE TANNERY | ZX-2 | LEATHER | OXBLOOD"),
    finish(3, "F-MT-03", "TO ELECT | POLISHED NICKEL"),
    finish(4, "F-FA-08", "EXAMPLE TANNERY | ZX-3 | LEATHER | SAND"),
    finish(5, "F-WD-02", "EXAMPLE SAPELE"),
    finish(6, "F-FA-18", "EXAMPLE MILL | ZX-4 / BETA | FABRIC | STONE"),
    finish(7, "F-TR-01", "EXAMPLE TRIMS | ZX-9 CORD WITH TAPE | CORD"),
  ];
  const plan = (heldSlots: readonly number[] = []) =>
    planBillFabrics({
      sheets: [{ sheetName: "Bill", ignored: false, lines }],
      rowImages: null,
      library: [],
      heldSwatches: new Set(),
      prefix: "ZZA",
      descriptionCodes: () => [],
      heldFabric: () => [],
      heldSlots: (_sheet, line) => (line === 0 ? heldSlots : []),
    });

  it("files fabrics to COM in order, the metal and the timber to theirs, and keeps the rest", () => {
    const out = plan();
    expect([1, 2, 3, 4, 5, 6, 7].map((index) => out.get(`0:${index}`)?.goesTo)).toEqual([
      "→ COM 1",
      "→ COM 2",
      "→ Main metal finish",
      "→ COM 3",
      "→ Main timber finish",
      "→ kept, COM 1–3 are full",
      "→ kept, no BWS field (trim)",
    ]);
    // Every coded line is filed in the library, kept-with-no-field ones too.
    expect(out.get("0:6")?.filing).toBe("new library entry F-FA-18");
    expect(out.get("0:7")?.filing).toBe("new library entry F-TR-01");
  });

  it("decides against what the item already holds", () => {
    const out = plan([4, 1]);
    expect(out.get("0:1")?.goesTo).toBe("→ COM 2");
    expect(out.get("0:5")?.goesTo).toBe("→ Timber Finish 2");
  });
});

describe("a description's fabric is a note only where a FABRIC line takes the COM", () => {
  const FIELDS: SpecFieldEntry[] = [
    { id: "f-com1", jsonId: 1, name: "COM 1" },
    { id: "f-com2", jsonId: 2, name: "COM 2" },
    { id: "f-com3", jsonId: 14, name: "COM 3" },
    { id: "f-mtl1", jsonId: 5, name: "Main metal finish" },
  ];
  const coms = (lines: Parameters<typeof planSheetDescriptions>[0]) =>
    (planSheetDescriptions(lines, FIELDS).get(0)?.attributes ?? []).filter((attribute) => attribute.specFieldName === "COM 1").length;

  it("leaves the COM to the description when the only line under the item is a metal", () => {
    const item = { index: 0, lineNo: 9, code: "ZZ-FUR-01", itemDescription: "Chair", itemDescriptionRaw: "Chair\nCOM: ZZ-FAB-04" };
    const metal = {
      index: 1,
      lineNo: 10,
      code: "F-MT-01",
      itemDescription: "TO ELECT | EXAMPLE BRASS",
      rowKind: "finish_for",
      finishFor: { row: 9, code: "ZZ-FUR-01" },
    };
    const fabric = { ...metal, code: "F-FA-01", itemDescription: "EXAMPLE MILL | VELVET" };
    expect(coms([item, metal])).toBe(1);
    expect(coms([item, fabric])).toBe(0);
  });
});
