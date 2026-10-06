// A bill's own Dims and Finish columns, read by the reader a description
// cell's size and finish lines go through (`bill-description.ts`).
//
// Every cell here is SYNTHETIC: the SHAPES are the Butler Arms bills'
// (2026-10-06, specifier Creation Luxury), the figures and words invented.
import { describe, expect, it } from "vitest";
import {
  billReadsDescriptions,
  lineStatements,
  placedSizeOf,
  planBillDescription,
  planSheetDescriptions,
  sheetColumnHeadings,
  sizeReadLabel,
  type BillColumnHeadings,
  type PlannedAttribute,
} from "@/lib/bill-description";
import { calloutKindsNamed, classifyCallout, type SpecFieldEntry } from "@/lib/drawing-document";

const FIELDS: SpecFieldEntry[] = [
  { id: "f-com1", jsonId: 1, name: "COM 1" },
  { id: "f-com2", jsonId: 2, name: "COM 2" },
  { id: "f-com3", jsonId: 14, name: "COM 3" },
  { id: "f-tim1", jsonId: 4, name: "Main timber finish" },
  { id: "f-tim2", jsonId: 31, name: "Timber Finish 2" },
  { id: "f-mtl1", jsonId: 5, name: "Main metal finish" },
  { id: "f-mtl2", jsonId: 35, name: "Metal Finish 2" },
];

const dims = (cell: string, heading = "Dims", description = "SOFA") => {
  const plan = planBillDescription(description, {
    fields: FIELDS,
    hasFabricLine: false,
    columns: { dimensionsRaw: cell, headings: { dimensions: heading } },
    name: description,
  });
  if (!plan) throw new Error("expected a plan");
  return plan;
};
const finish = (cell: string, options: { hasFabricLine?: boolean; description?: string; heading?: string } = {}) => {
  const plan = planBillDescription(options.description ?? "SOFA", {
    fields: FIELDS,
    hasFabricLine: options.hasFabricLine ?? false,
    columns: { finishRaw: cell, headings: { finish: options.heading ?? "Finish" } },
    name: "SOFA",
  });
  if (!plan) throw new Error("expected a plan");
  return plan;
};
const slots = (attributes: PlannedAttribute[]) =>
  attributes.filter((attribute) => attribute.slot).map((attribute) => `${attribute.slot} ${attribute.value}${attribute.unit ?? ""}`);
const notes = (attributes: PlannedAttribute[]) =>
  attributes.filter((attribute) => attribute.attrGroup === "note").map((attribute) => `${attribute.label}: ${attribute.value}`);

describe("a Dims column cell", () => {
  it("reads a size whose unit the cell prints", () => {
    const plan = dims("W1200 x D500 x H750 mm");
    expect(slots(plan.attributes)).toEqual(["W 1200mm", "D 500mm", "H 750mm"]);
    expect(plan.dimensionCell).toBe("W1200 x D500 x H750mm");
    expect(plan.cautions).toEqual([]);
    expect(plan.name).toBe("SOFA");
    // The label is the column's heading, as printed.
    expect(plan.attributes.every((attribute) => attribute.label === "Dims")).toBe(true);
    expect(plan.columnCells).toEqual([{ column: "dimensions", heading: "Dims", value: "W1200 x D500 x H750 mm" }]);
  });

  it("takes the unit from the column's HEADING where the cell prints none", () => {
    const plan = dims("W1200 x D500 x H750", "Dims (mm)");
    expect(slots(plan.attributes)).toEqual(["W 1200mm", "D 500mm", "H 750mm"]);
    expect(plan.dimensionCell).toBe("W1200 x D500 x H750mm");
    // A heading that is not itself a size label still lends its bracket, and nothing else.
    expect(slots(dims("W100 x D200", "Size W x D (cm)").attributes)).toEqual(["W 100cm", "D 200cm"]);
    // Inches stated in the heading convert exactly.
    expect(dims("W18 x D20", "Dimensions (in)").dimensionCell).toBe("W457 x D508mm");
  });

  it("places a size with NO unit unconverted, in the composer's own bracket — never a magnitude vote", () => {
    const plan = dims("W800 X D950 X H790 X SH430");
    expect(slots(plan.attributes)).toEqual(["W 800", "D 950", "H 790", "SH 430"]);
    expect(plan.dimensionCell).toBe("[W 800 — no unit] [D 950 — no unit] [H 790 — no unit] [SH 430 — no unit]");
    expect(plan.cautions).toContain("W800 has no unit, so it cannot be converted to millimetres.");
    expect(plan.attributes[0]?.why).toMatch(/No unit is printed/);
  });

  it("does not let the row next door decide the unit: inches unstated beside millimetres unstated read alike", () => {
    // W47.2 is inches and W2000 is millimetres on the real sheet, and neither
    // says so. Both are kept as printed; a size vote would make one wrong.
    const lines = [
      { index: 0, lineNo: 2, itemDescription: "Side table", dimensionsRaw: "W47.2 x D27.5 x H16.5" },
      { index: 1, lineNo: 3, itemDescription: "Dining table", dimensionsRaw: "W2000 x D1000 x H700" },
    ];
    const plans = planSheetDescriptions(lines, FIELDS, { dimensions: "Dims" });
    expect(plans.get(0)?.dimensionCell).toBe("[W 47.2 — no unit] [D 27.5 — no unit] [H 16.5 — no unit]");
    expect(plans.get(1)?.dimensionCell).toBe("[W 2000 — no unit] [D 1000 — no unit] [H 700 — no unit]");
    expect(plans.get(0)?.attributes.every((attribute) => attribute.unit === null)).toBe(true);
  });

  it("reads DIA as the diameter, the cell speaking", () => {
    const plan = dims("DIA 550 x H650 mm");
    expect(slots(plan.attributes)).toEqual(["DIA 550mm", "H 650mm"]);
    expect(plan.dimensionCell).toBe("Dia.550 x H650mm");
  });

  it("keeps an arm height as a note — not one of the five slots — beside the four that are", () => {
    const plan = dims("W610 x D620 x H840 x AH640 x SH440 mm");
    expect(slots(plan.attributes)).toEqual(["W 610mm", "D 620mm", "H 840mm", "SH 440mm"]);
    expect(notes(plan.attributes)).toEqual(["Dims: W610 x D620 x H840 x AH640 x SH440 mm"]);
    expect(plan.attributes.find((attribute) => attribute.attrGroup === "note")?.why).toMatch(/AH640/);
  });

  it("gives two bare figures no slot, with or without a unit", () => {
    for (const cell of ["150 cm x 200 cm", "50 x 50"]) {
      const plan = dims(cell);
      expect(slots(plan.attributes)).toEqual([]);
      expect(notes(plan.attributes)).toEqual([`Dims: ${cell}`]);
      expect(plan.dimensionCell).toBe("");
      expect(plan.cautions).toEqual([`“${cell}”: a size this app could not place.`]);
    }
  });

  it("keeps a sentence, a stray figure's context and a garbled cell as notes — a sentence never stands where a measurement goes", () => {
    for (const cell of ["Which size?", "SAME LENGTH AS KING W90 x 200cm", "W1000 X H1400 X D45MMW1400 X D45 X H1000"]) {
      const plan = dims(cell);
      expect(slots(plan.attributes)).toEqual([]);
      expect(notes(plan.attributes)).toEqual([`Dims: ${cell}`]);
    }
  });

  it("does not pick between two statements of one size in one cell (inches, then centimetres)", () => {
    const cell = `47.5" (W) x 20.5" (D) x 36.5" (H)- W 120.65cm D 52.07cm H 92.71cm`;
    const plan = dims(cell);
    expect(slots(plan.attributes)).toEqual([]);
    expect(notes(plan.attributes)).toEqual([`Dims: ${cell}`]);
    expect(plan.cautions.length).toBe(1);
  });

  it("places a lone unitless height", () => {
    const plan = dims("H21.6");
    expect(slots(plan.attributes)).toEqual(["H 21.6"]);
    expect(plan.dimensionCell).toBe("[H 21.6 — no unit]");
  });

  it("keeps a TBC size as a TBC note", () => {
    const plan = dims("TBC");
    expect(plan.attributes).toMatchObject([{ attrGroup: "note", state: "tbc", slot: null }]);
  });

  it("composes exactly as the same size written inside a description cell does", () => {
    for (const size of ["W800 x D950 x H790", "W1200 x D500 x H750 mm", "DIA 550 x H650"]) {
      const fromColumn = dims(size, "Dimensions");
      const fromDescription = planBillDescription(`SOFA\nDimensions: ${size}`, { fields: FIELDS, hasFabricLine: false })!;
      expect(fromColumn.dimensionCell).toBe(fromDescription.dimensionCell);
      expect(fromColumn.cautions).toEqual(fromDescription.cautions);
      expect(slots(fromColumn.attributes)).toEqual(slots(fromDescription.attributes));
    }
  });

  it("is one more statement of the line: a description's metric size line is placed first, and the column's same size is a note", () => {
    const plan = planBillDescription("SOFA\nSizes (mm): W 900 x D 800 x H 700", {
      fields: FIELDS,
      hasFabricLine: false,
      columns: { dimensionsRaw: "W900 x D800 x H700 mm", headings: { dimensions: "Dims" } },
    })!;
    expect(slots(plan.attributes)).toEqual(["W 900mm", "D 800mm", "H 700mm"]);
    expect(plan.attributes.find((attribute) => attribute.label === "Dims")?.why).toMatch(/states the same size again/);
    // And a metric column beats a description that states no unit.
    const ranked = planBillDescription("SOFA\nSizes: W 900 x D 800", {
      fields: FIELDS,
      hasFabricLine: false,
      columns: { dimensionsRaw: "W905 x D805 mm", headings: { dimensions: "Dims" } },
    })!;
    expect(slots(ranked.attributes)).toEqual(["W 905mm", "D 805mm"]);
  });

  it("takes a reviewer's slot change on a column's part, through the one list the route reads", () => {
    const line = { itemDescriptionRaw: undefined, dimensionsRaw: "D 400 x H 450 mm" };
    const headings: BillColumnHeadings = { dimensions: "Dims" };
    const placed = placedSizeOf(lineStatements(line, headings) ?? []);
    expect(placed?.reading.parts.map((part) => part.slot)).toEqual(["D", "H"]);
    const plan = planBillDescription(undefined, {
      fields: FIELDS,
      hasFabricLine: false,
      columns: { ...line, headings },
      slotOverrides: { "D 400": "DIA" },
      name: "Stool",
    })!;
    expect(slots(plan.attributes)).toEqual(["DIA 400mm", "H 450mm"]);
    expect(plan.depthWithoutWidth).toBeNull();
  });

  it("reads a Dims column always as a size, and a Finish column never", () => {
    expect(sizeReadLabel({ line: "x", label: "DIMENSIONS", value: "x", labelFrom: "column", column: "dimensions" })).toBe("DIMENSIONS");
    expect(sizeReadLabel({ line: "x", label: "Dims (mm)", value: "x", labelFrom: "column", column: "dimensions" })).toBe("Dims (mm)");
    expect(sizeReadLabel({ line: "x", label: "Size W x D", value: "x", labelFrom: "column", column: "dimensions" })).toBe("Dimensions");
    expect(sizeReadLabel({ line: "x", label: "Dims", value: "x", labelFrom: "column", column: "finish" })).toBeNull();
  });
});

describe("a Finish column cell", () => {
  it("keeps a cell naming two kinds whole, as a note under the column's heading", () => {
    const plan = finish("SMOKED OILED OAK / BRUSHED BRASS HARDWARE / NO PAINT");
    expect(plan.attributes).toMatchObject([
      { attrGroup: "note", label: "Finish", value: "SMOKED OILED OAK / BRUSHED BRASS HARDWARE / NO PAINT", specFieldId: null },
    ]);
    expect(plan.attributes[0]?.why).toMatch(/more than one kind of finish \(metal and timber\)/);
  });

  it("files one kind into its first free field, whole — never split on ' / '", () => {
    expect(finish("SUEDE / NUBUCK").attributes).toMatchObject([
      { attrGroup: "material", specFieldName: "COM 1", value: "SUEDE / NUBUCK", materialCode: null },
    ]);
    expect(finish("Natural oak, oiled").attributes).toMatchObject([{ attrGroup: "finish", specFieldName: "Main timber finish" }]);
    // Hardware is a part: brass hardware is the brass.
    expect(finish("BRUSHED BRASS HARDWARE").attributes).toMatchObject([{ attrGroup: "finish", specFieldName: "Main metal finish" }]);
  });

  it("keeps what names no material as a note", () => {
    expect(finish("Ral colour").attributes).toMatchObject([{ attrGroup: "note", label: "Finish", value: "Ral colour" }]);
  });

  it("takes the NEXT free field when the description has already filled the first", () => {
    const plan = planBillDescription("SOFA\nFabric: UPH-01 Teal velvet", {
      fields: FIELDS,
      hasFabricLine: false,
      columns: { finishRaw: "Mohair velvet", headings: { finish: "Finish" } },
    })!;
    expect(plan.attributes.filter((attribute) => attribute.specFieldName).map((attribute) => attribute.specFieldName)).toEqual([
      "COM 1",
      "COM 2",
    ]);
  });

  it("claims no COM where the item has its own fabric line, and none for COM itself", () => {
    expect(finish("Velvet", { hasFabricLine: true }).attributes).toMatchObject([{ attrGroup: "note" }]);
    expect(finish("COM").attributes).toMatchObject([{ attrGroup: "note", specFieldId: null }]);
  });

  it("records an undecided finish as TBC", () => {
    expect(finish("TBC").attributes).toMatchObject([{ attrGroup: "note", state: "tbc" }]);
    expect(finish("TBC - velvet").attributes).toMatchObject([{ attrGroup: "material", specFieldName: "COM 1", state: "tbc" }]);
  });

  it("is labelled with the column's heading as printed, with the cell's whitespace folded", () => {
    const plan = finish("Smoked oak\n  legs", { heading: "FINISH" });
    expect(plan.attributes).toMatchObject([{ label: "FINISH", value: "Smoked oak legs" }]);
    expect(plan.columnCells).toEqual([{ column: "finish", heading: "FINISH", value: "Smoked oak\n  legs" }]);
  });
});

describe("a bill with no such columns", () => {
  it("plans nothing for a single-line description, exactly as before", () => {
    expect(planBillDescription("Lounge chair", { fields: FIELDS, hasFabricLine: false })).toBeNull();
    expect(planBillDescription("Lounge chair", { fields: FIELDS, hasFabricLine: false, columns: {} })).toBeNull();
    expect(planBillDescription("Lounge chair", { fields: FIELDS, hasFabricLine: false, columns: { dimensionsRaw: "  ", finishRaw: null } })).toBeNull();
    expect(planSheetDescriptions([{ index: 0, lineNo: 2, itemDescription: "Lounge chair" }], FIELDS).size).toBe(0);
    expect(billReadsDescriptions([{ lines: [{ index: 0, lineNo: 2, itemDescription: "Lounge chair" }] }])).toBe(false);
  });

  it("a multi-line description plans what it always did, with no column cells", () => {
    const plan = planBillDescription("Sofa\nSpec size: W 900 x D 800 mm", { fields: FIELDS, hasFabricLine: false })!;
    expect(plan.columnCells).toEqual([]);
    expect(plan.name).toBe("Sofa");
  });

  it("says a bill whose only specifications are in its columns is read at confirm", () => {
    expect(
      billReadsDescriptions([{ lines: [{ index: 0, lineNo: 2, itemDescription: "Sofa", finishRaw: "Oak" }] }]),
    ).toBe(true);
  });

  it("finds the headings on a staged sheet's columns, and none on one staged before", () => {
    expect(
      sheetColumnHeadings({ columns: { dimensions: { heading: "Dims (mm)" }, finish: { heading: "Finish" }, code: { heading: "Ref" } } }),
    ).toEqual({ dimensions: "Dims (mm)", finish: "Finish" });
    expect(sheetColumnHeadings({})).toEqual({});
  });
});

describe("classifyCallout's words, as a list", () => {
  it("is the same reading: classifyCallout's kind is the list's first entry", () => {
    for (const text of ["Velvet", "brass frame", "oak legs", "brass knob", "oak / brass", "plain"]) {
      expect(classifyCallout({ labelRaw: null, valueRaw: text }).kind).toBe(calloutKindsNamed(` ${text}`)[0] ?? null);
    }
    expect(calloutKindsNamed("SMOKED OILED OAK / BRUSHED BRASS HARDWARE")).toEqual(["metal", "timber"]);
  });
});
