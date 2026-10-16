// A size row is named by its slot; a note keeps the document's label.
// Max, 2026-10-16, on TB-08: three rows each labelled with the bill's Dims
// heading read as if each were the whole L x W x H.
import { describe, expect, it } from "vitest";
import { attributeDisplayLabel, documentLabelTitle } from "@/lib/attribute-label";
import { DIMENSION_SLOTS } from "@/lib/spec-vocab";

const HEADING = "DIMENSIONS CM / MM L X W X H";

describe("attributeDisplayLabel", () => {
  it("names each of the five slots, and nothing else", () => {
    expect(DIMENSION_SLOTS.map((slot) => attributeDisplayLabel({ label: HEADING, slot }))).toEqual([
      "Width",
      "Depth",
      "Height",
      "Seat height",
      "Diameter",
    ]);
  });

  it("keeps a note's own label exactly", () => {
    expect(attributeDisplayLabel({ label: "ARM HEIGHT", slot: null })).toBe("ARM HEIGHT");
    expect(attributeDisplayLabel({ label: HEADING, slot: undefined })).toBe(HEADING);
  });

  it("never invents a slot from a value that is not one", () => {
    expect(attributeDisplayLabel({ label: "L", slot: "L" })).toBe("L");
    expect(attributeDisplayLabel({ label: null, slot: null })).toBe("");
  });
});

describe("documentLabelTitle", () => {
  it("offers the document's label where the screen prints the slot instead", () => {
    expect(documentLabelTitle({ label: HEADING, slot: "H" })).toBe(`The document labels it “${HEADING}”`);
  });

  it("says nothing where they agree, or there is nothing to say", () => {
    expect(documentLabelTitle({ label: "Width", slot: "W" })).toBeUndefined();
    expect(documentLabelTitle({ label: "SEAT HEIGHT", slot: "SH" })).toBeUndefined();
    expect(documentLabelTitle({ label: "ARM HEIGHT", slot: null })).toBeUndefined();
    expect(documentLabelTitle({ label: "  ", slot: "W" })).toBeUndefined();
  });
});
