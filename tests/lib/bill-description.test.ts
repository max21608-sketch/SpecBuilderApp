// A bill line's description cell, read as a name and its specifications.
//
// Every cell here is SYNTHETIC: the SHAPES are the Aman pricing document's
// (2026-09-30), the figures, codes and words are invented. Each case is one of
// the traps `bill-description.ts` names.
import { describe, expect, it } from "vitest";
import {
  billItemName,
  billReadsDescriptions,
  planBillDescription,
  planSheetDescriptions,
  readBillDescription,
  revisionDescriptionRefusal,
  type PlannedAttribute,
} from "@/lib/bill-description";
import type { SpecFieldEntry } from "@/lib/drawing-document";

const FIELDS: SpecFieldEntry[] = [
  { id: "f-com1", jsonId: 1, name: "COM 1" },
  { id: "f-com2", jsonId: 2, name: "COM 2" },
  { id: "f-com3", jsonId: 14, name: "COM 3" },
  { id: "f-tim1", jsonId: 4, name: "Main timber finish" },
  { id: "f-tim2", jsonId: 31, name: "Timber Finish 2" },
  { id: "f-tim3", jsonId: 143, name: "Timber Finish 3" },
  { id: "f-mtl1", jsonId: 5, name: "Main metal finish" },
  { id: "f-mtl2", jsonId: 35, name: "Metal Finish 2" },
];

const plan = (cell: string, hasFabricLine = false) => {
  const result = planBillDescription(cell, { fields: FIELDS, hasFabricLine });
  if (!result) throw new Error("expected a plan");
  return result;
};
const slots = (attributes: PlannedAttribute[]) =>
  attributes.filter((attribute) => attribute.slot).map((attribute) => `${attribute.slot} ${attribute.value}${attribute.unit}`);
const notes = (attributes: PlannedAttribute[]) =>
  attributes.filter((attribute) => attribute.attrGroup === "note").map((attribute) => `${attribute.label}: ${attribute.value}`);
const finishes = (attributes: PlannedAttribute[]) =>
  attributes
    .filter((attribute) => attribute.attrGroup !== "note" && attribute.attrGroup !== "dimension")
    .map((attribute) => `${attribute.materialCode} → ${attribute.specFieldName ?? "none"}`);

describe("readBillDescription", () => {
  it("reads nothing from a single-line cell, which is its own name", () => {
    expect(readBillDescription("Lounge chair")).toBeNull();
    expect(readBillDescription("Lounge chair\n\n  ")).toBeNull();
    expect(readBillDescription(undefined)).toBeNull();
    expect(billItemName({ itemDescription: "Lounge chair" })).toBe("Lounge chair");
  });

  it("takes the first non-empty line as the name, trimmed", () => {
    const reading = readBillDescription("\r\n  Side Table @ Example Lounge \r\nModel Ref: Bespoke");
    expect(reading?.name).toBe("Side Table @ Example Lounge");
    expect(
      billItemName({ itemDescription: "Side Table @ Example Lounge Model Ref: Bespoke", itemDescriptionRaw: "Side Table\nModel Ref: X" }),
    ).toBe("Side Table");
  });

  it("splits on the FIRST colon, and one colon too many is not a second statement", () => {
    const reading = readBillDescription("Chair\nFabric:: Example weave 01/1\nSpec Size: H:1' 2\"\"");
    expect(reading?.statements.map((statement) => [statement.label, statement.value])).toEqual([
      ["Fabric", "Example weave 01/1"],
      ["Spec Size", "H:1' 2\"\""],
    ]);
  });

  it("files unlabelled lines under the heading above them, and a code list continued under its label", () => {
    const reading = readBillDescription(
      "Desk\nFinish:\nZZ-TIM-01 - Example oak\nZZ-MTL-02 - Example bronze\nTop: ZZ-TIM-03 EXAMPLE\nZZ-MTL-04 EXAMPLE\nSomething else",
    );
    expect(reading?.statements.map((statement) => [statement.label, statement.value, statement.labelFrom])).toEqual([
      ["Finish", "ZZ-TIM-01 - Example oak", "heading"],
      ["Finish", "ZZ-MTL-02 - Example bronze", "heading"],
      ["Top", "ZZ-TIM-03 EXAMPLE", null],
      ["Finish", "ZZ-MTL-04 EXAMPLE", "heading"],
      ["Finish", "Something else", "heading"],
    ]);
  });

  it("keeps a line with no label and no heading as a note of its own", () => {
    const reading = readBillDescription("Armchair\nCom: EXAMPLE CLOTH NAME\n12345-0001\nFinishes - Metal - Bronze");
    expect(reading?.statements.map((statement) => [statement.label, statement.value])).toEqual([
      ["Com", "EXAMPLE CLOTH NAME"],
      [null, "12345-0001"],
      [null, "Finishes - Metal - Bronze"],
    ]);
  });

  it("starts a new line where a finish label is welded onto the figure before it", () => {
    const reading = readBillDescription("Bench\nSizes(mm): W 1500 x D 400 x SH 350Finish: ZZ-TIM-09 Example oak");
    expect(reading?.statements.map((statement) => statement.label)).toEqual(["Sizes(mm)", "Finish"]);
    expect(reading?.statements[0]?.value).toBe("W 1500 x D 400 x SH 350");
  });

  it("keeps a heading nothing follows, so no line of the cell is lost", () => {
    expect(readBillDescription("Stool\nFinish:")?.statements).toEqual([
      { line: "Finish:", label: "Finish", value: "", labelFrom: null },
    ]);
  });
});

describe("planBillDescription — sizes", () => {
  it("fills the slots from the metric line and keeps the imperial twin as a note", () => {
    const result = plan("Dresser\nSizes (ft-in): W 2'-10\"\" x D 1'-8\"\" x H 2'-4\"\"\nSizes (mm): W 860 x D 510 x H 710");
    expect(slots(result.attributes)).toEqual(["W 860mm", "D 510mm", "H 710mm"]);
    expect(result.dimensionCell).toBe("W860 x D510 x H710mm");
    expect(notes(result.attributes)).toEqual(["Sizes (ft-in): W 2'-10\"\" x D 1'-8\"\" x H 2'-4\"\""]);
    expect(result.cautions).toEqual([]);
  });

  it("places the FIRST metric line only — a second one is a note, never a second W", () => {
    const result = plan("Table\nSpec size: W 900 x D 900 x H 750 mm\nSizes (mm): W 910 x D 910 x H 760");
    expect(slots(result.attributes)).toEqual(["W 900mm", "D 900mm", "H 750mm"]);
    expect(notes(result.attributes)).toEqual(["Sizes (mm): W 910 x D 910 x H 760"]);
  });

  it("converts plain inches exactly where there is no metric line", () => {
    const result = plan("Desk Chair\nSizes (ft-in): W 20\"\" x D 22\"\" x SH 17\"\"");
    expect(slots(result.attributes)).toEqual(["W 20in", "D 22in", "SH 17in"]);
    expect(result.dimensionCell).toBe("W508 x D559 x SH432mm");
  });

  it("refuses feet and inches whole, keeps it as a note, and cautions the reviewer", () => {
    const result = plan("Desk\nSizes (ft-in): W 3'5\"\" X D 1'-9 1/2\"\" X H 2'-4\"\"");
    expect(slots(result.attributes)).toEqual([]);
    expect(notes(result.attributes)).toHaveLength(1);
    expect(result.cautions.join(" ")).toMatch(/Feet and inches are not converted/);
  });

  it("keeps a TBC size as a TBC note, with no slots", () => {
    const result = plan("Sofa\nSizes (ft - in):  TBC\nSizes (mm): TBC");
    expect(slots(result.attributes)).toEqual([]);
    expect(result.attributes.map((attribute) => attribute.state)).toEqual(["tbc", "tbc"]);
    expect(result.cautions).toEqual(["The bill gives the size as TBC: no slot is filled."]);
  });

  it("stops the overall reading at a component, so a base never becomes the table's W and D", () => {
    const result = plan("Dining Table\nSizes (cm) - Overall: Dia 110 x H 74  x Base: W 60 x D 60\nOverhang:25cm Top\nThickness :40mm");
    expect(slots(result.attributes)).toEqual(["DIA 110cm", "H 74cm"]);
    expect(result.dimensionCell).toBe("Dia.1100 x H740mm");
    expect(notes(result.attributes)).toEqual([
      "Sizes (cm) - Overall: Dia 110 x H 74  x Base: W 60 x D 60",
      "Overhang: 25cm Top",
      "Thickness: 40mm",
    ]);
  });

  it("never reads a reclined position or a seat as the item's size", () => {
    const result = plan("Lounger\nSizes (cm) - Fully reclined :W 190cm x D 70cm x H 25cm\nSEAT: W 70cm  x  D 120cm");
    expect(slots(result.attributes)).toEqual([]);
    expect(notes(result.attributes)).toHaveLength(2);
  });

  it("reads OAH as the overall height through the vocabulary, and never L as a width", () => {
    expect(slots(plan("Bench\nSizes(mm): W 1500 x D 400 x OAH 380 x SH 330").attributes)).toEqual([
      "W 1500mm",
      "D 400mm",
      "H 380mm",
      "SH 330mm",
    ]);
    const pouf = plan("Pouf\nSizes(mm): L 500 x W 300 x H420");
    expect(slots(pouf.attributes)).toEqual(["W 300mm", "H 420mm"]);
    expect(notes(pouf.attributes)).toEqual(["Sizes(mm): L 500 x W 300 x H420"]);
  });

  it("keeps a garbled figure as a note beside the slots it could read", () => {
    const result = plan("Coffee Table\nSizes(mm): D 48 0 x H 400");
    expect(slots(result.attributes)).toEqual(["H 400mm"]);
    expect(notes(result.attributes)).toEqual(["Sizes(mm): D 48 0 x H 400"]);
  });

  it("reads a diameter before a comma and keeps the clearance as the line", () => {
    const result = plan("Coffee Table\nSizes (cm): Dia 110, 25cm Clearance\nUndertable : H 25cm");
    expect(slots(result.attributes)).toEqual(["DIA 110cm"]);
    expect(notes(result.attributes)).toEqual(["Sizes (cm): Dia 110, 25cm Clearance", "Undertable: H 25cm"]);
  });

  it("cautions a D with no W, taking it as printed rather than as a diameter", () => {
    const result = plan("Stool\nSpec size: D 400 X H 420 mm");
    expect(slots(result.attributes)).toEqual(["D 400mm", "H 420mm"]);
    expect(result.cautions.join(" ")).toMatch(/gives a D and no W/);
  });
});

describe("planBillDescription — finishes", () => {
  it("splits a list of codes into one statement each, claiming slots across the whole record", () => {
    const result = plan("Drawers\nFinish: STN-01, MTL-02, TIM-03\nMetal: ZZ-MTL-05 EXAMPLE");
    expect(finishes(result.attributes)).toEqual([
      "STN-01 → none",
      "MTL-02 → Main metal finish",
      "TIM-03 → Main timber finish",
      "ZZ-MTL-05 → Metal Finish 2",
    ]);
  });

  it("reads a finish under a heading, an inner label, and a code welded to its words", () => {
    const result = plan(
      "Side Table\nFinish:\nZZ-TIM-10 - Example Oak\nStone: ZZ-STN-04 EXAMPLE STONE\nMetal: ZZ-MTL-01EXAMPLE BRONZE\nWood: ZZ-TIM-11",
    );
    expect(finishes(result.attributes)).toEqual([
      "ZZ-TIM-10 → Main timber finish",
      "ZZ-STN-04 → none",
      "ZZ-MTL-01 → Main metal finish",
      "ZZ-TIM-11 → Timber Finish 2",
    ]);
    const welded = result.attributes.find((attribute) => attribute.materialCode === "ZZ-MTL-01");
    expect(welded?.value).toBe("ZZ-MTL-01EXAMPLE BRONZE");
    expect(welded?.finishWords).toBe("EXAMPLE BRONZE");
    const inner = plan("Sofa\nFinish: Wood: ZZ-TIM-09 EXAMPLE OAK").attributes[0];
    expect([inner?.label, inner?.value, inner?.specFieldName]).toEqual(["Finish", "Wood: ZZ-TIM-09 EXAMPLE OAK", "Main timber finish"]);
  });

  it("splits two codes joined by & and files the no-field one against no field", () => {
    const result = plan("Coffee Table\nTop: ZZ-MTL-01  EXAMPLE BRONZE & ZZ-SPF-05 Example inlay");
    expect(finishes(result.attributes)).toEqual(["ZZ-MTL-01 → Main metal finish", "ZZ-SPF-05 → none"]);
  });

  it("keeps a finish with no code as a note, and a code mentioned in passing is not the finish", () => {
    const result = plan("Pouf\nFinish: BESPOKE\nFinish - Wood: OAK-Example open pore\nFinishes: Example ash to match TIM-09");
    expect(finishes(result.attributes)).toEqual([]);
    expect(notes(result.attributes)).toHaveLength(3);
  });

  it("gives a coded fabric the next COM only where the item has no fabric line", () => {
    expect(finishes(plan("Bed\nCOM: ZZ-FAB-04").attributes)).toEqual(["ZZ-FAB-04 → COM 1"]);
    const withLine = plan("Bed\nCOM: ZZ-FAB-04", true);
    expect(finishes(withLine.attributes)).toEqual([]);
    expect(withLine.attributes[0]?.why).toMatch(/own fabric line/);
  });

  it("never claims a COM on the word COM", () => {
    const result = plan("Stool\nFabric: COM");
    expect(finishes(result.attributes)).toEqual([]);
    expect(notes(result.attributes)).toEqual(["Fabric: COM"]);
  });
});

describe("planBillDescription — nothing is lost", () => {
  it("turns every statement into at least one attribute", () => {
    const cell = [
      "Coffee Table @ Example Lounge",
      "Model Ref: BESPOKE DESIGN",
      "Sizes (Inch): 20\"\" (1'-8\"\") H X 2'-6\"\" DIA",
      "Sizes (mm): Dia 760 x H 510",
      "Finish: ZZ-TIM-07 EXAMPLE OAK",
      "ZZ-MTL-01 EXAMPLE BRONZE",
      "Finish: Stained",
      "Surface: Sanded",
      "DWG REF: ZZ-DWG-06",
    ].join("\r\n");
    const result = plan(cell);
    const covered = new Set(result.attributes.map((attribute) => attribute.line));
    expect(result.statements.every((statement) => covered.has(statement.line))).toBe(true);
    expect(result.name).toBe("Coffee Table @ Example Lounge");
    expect(result.dimensionCell).toBe("Dia.760 x H510mm");
  });
});

describe("planSheetDescriptions", () => {
  const lines = [
    { index: 0, lineNo: 9, itemDescriptionRaw: "Bed\nCOM: ZZ-FAB-04" },
    { index: 1, lineNo: 10, itemDescriptionRaw: "Fabric @ Bed\nWidth: 140cm", rowKind: "finish_for", finishFor: { row: 9 } },
    { index: 2, lineNo: 11, itemDescriptionRaw: "Bed\nCOM: ZZ-FAB-04" },
    { index: 3, lineNo: 12 },
  ];

  it("knows which items have a fabric line, and plans nothing for a fabric line or a one-line cell", () => {
    const plans = planSheetDescriptions(lines, FIELDS);
    expect([...plans.keys()]).toEqual([0, 2]);
    expect(finishes(plans.get(0)!.attributes)).toEqual([]);
    expect(finishes(plans.get(2)!.attributes)).toEqual(["ZZ-FAB-04 → COM 1"]);
  });

  it("says whether a bill's descriptions are read at confirm", () => {
    expect(billReadsDescriptions([{ lines }])).toBe(true);
    expect(billReadsDescriptions([{ lines: [{ index: 0, lineNo: 9 }] }])).toBe(false);
    expect(billReadsDescriptions([{ ignored: true, lines }])).toBe(false);
  });
});

describe("revisionDescriptionRefusal", () => {
  const result = () => plan("Chair\nSizes (mm): W 600 x D 600 x H 800\nMetal: ZZ-MTL-01");

  it("writes onto a carried record that holds nothing in the way", () => {
    expect(revisionDescriptionRefusal(result(), { fromBill: false, slots: [], fieldIds: [] })).toBeNull();
  });

  it("writes nothing twice: a record already holding a bill's specifications is refused, in words", () => {
    expect(revisionDescriptionRefusal(result(), { fromBill: true, slots: [], fieldIds: [] })).toMatch(/already holds specifications from a bill/);
  });

  it("never replaces a slot or a field another document filled", () => {
    expect(revisionDescriptionRefusal(result(), { fromBill: false, slots: ["W"], fieldIds: [] })).toMatch(/a W dimension/);
    expect(revisionDescriptionRefusal(result(), { fromBill: false, slots: [], fieldIds: ["f-mtl1"] })).toMatch(/Main metal finish/);
  });
});
