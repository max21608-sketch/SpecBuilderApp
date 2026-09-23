// A SYNTHETIC fixture in the SHAPE of Panther's S-301 desk chair specification
// sheet, 2026-09-23. No client wording: the code, the makers and the cloths are
// invented. What is real is the structure that broke the app:
//
//   page 1 — the specification sheet. ONE set of overall dimensions, and a
//            fabric heading "As per room type" whose four lines cover five room
//            types: "Type 1 & 5 - …", "Type 2 - …", "Type 3 - … ; Type 4 - …".
//   page 2 — the shop drawing of the same chair, title block "MUR 1 & TYPO 5
//            DESK CHAIR": the same geometry and ONE swatch, fabric A.
//
// `codeGroups` says the two pages are ONE item (one chair described twice) —
// correct, and still correct when that chair comes in five configurations.
import { stageDrawings, type SpecFieldEntry, type StagedDrawings } from "@/lib/drawing-document";
import type { RawCodeGroup, RawDrawingDimension, RawDrawingItem } from "@/lib/extraction-schema";

export const NAMED_FIELDS: SpecFieldEntry[] = [
  { id: "f-com1", jsonId: 1, name: "COM 1" },
  { id: "f-com2", jsonId: 2, name: "COM 2" },
  { id: "f-com3", jsonId: 14, name: "COM 3" },
  { id: "f-timber1", jsonId: 4, name: "Main timber finish" },
  { id: "f-timber2", jsonId: 31, name: "Timber Finish 2" },
  { id: "f-timber3", jsonId: 143, name: "Timber Finish 3" },
  { id: "f-metal1", jsonId: 5, name: "Main metal finish" },
  { id: "f-metal2", jsonId: 35, name: "Metal Finish 2" },
];

const dim = (label: string, value: string, slot: RawDrawingDimension["slot"], configurations: string[] = []): RawDrawingDimension => ({
  labelRaw: label,
  valueRaw: value,
  unitRaw: "mm",
  slot,
  slotEvidence: `labelled ${label}`,
  isOverall: true,
  configurations,
});

const configuration = (name: string, nameRaw: string, evidence: string) => ({ name, nameRaw, evidence });

export const SPEC_SHEET: RawDrawingItem = {
  itemCodeRaw: "Q-301",
  itemNameRaw: "Desk chair",
  page: 1,
  dimensions: [dim("Width", "550", "width"), dim("Depth", "560", "depth"), dim("Height", "790", "height")],
  materials: [
    { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker A, Ref. X", materialCodeRaw: null, configurations: ["Type 1", "Type 5"] },
    { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker B, Ref. Y", materialCodeRaw: null, configurations: ["Type 2"] },
    { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker C, Ref. Z", materialCodeRaw: null, configurations: ["Type 3"] },
    { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker D, Ref. W", materialCodeRaw: null, configurations: ["Type 4"] },
    // Shared by every room type, and CODED — the drawing names the same code.
    { labelRaw: "FEET", valueRaw: "feet dark tinted wood as per approved sample", materialCodeRaw: "QW-01", configurations: [] },
  ],
  dimensionsCombinedRaw: [],
  notesRaw: [],
  confidence: "high",
  configurations: [
    configuration("Type 1", "Type 1 & 5", "As per room type: Type 1 & 5 - Maker A"),
    configuration("Type 5", "Type 1 & 5", "As per room type: Type 1 & 5 - Maker A"),
    configuration("Type 2", "Type 2", "Type 2 - Maker B"),
    configuration("Type 3", "Type 3", "Type 3 - Maker C"),
    configuration("Type 4", "Type 4", "Type 4 - Maker D"),
  ],
  depictsConfigurations: [],
};

export const SHOP_DRAWING: RawDrawingItem = {
  itemCodeRaw: "MUR 1 & TYPO 5 DESK CHAIR",
  itemNameRaw: "Desk chair",
  page: 2,
  dimensions: [dim("Width", "550", "width"), dim("Depth", "560", "depth"), dim("Height", "790", "height")],
  // The SAME cloth as the sheet's Type 1 & 5 line, WORDED DIFFERENTLY — which
  // is the real pack's shape, and what makes COM 1 a reviewer's decision.
  materials: [
    { labelRaw: "FABRIC", valueRaw: "Maker A, Ref. X, woven", materialCodeRaw: "QQ-01.1", configurations: [] },
    // The SAME finish as the sheet's feet, by the same client code, worded
    // differently: already recorded, never a question.
    { labelRaw: "FEET", valueRaw: "Dark tinted wood", materialCodeRaw: "QW-01", configurations: [] },
  ],
  dimensionsCombinedRaw: [],
  notesRaw: [],
  confidence: "high",
  configurations: [
    configuration("Type 1", "MUR 1", "title block reads MUR 1 & TYPO 5 DESK CHAIR"),
    configuration("Type 5", "TYPO 5", "title block reads MUR 1 & TYPO 5 DESK CHAIR"),
  ],
  depictsConfigurations: ["Type 1", "Type 5"],
};

export const ONE_CHAIR_TWO_PAGES: RawCodeGroup = {
  itemCodes: ["Q-301", "MUR 1 & TYPO 5 DESK CHAIR"],
  pages: [1, 2],
  relationship: "one_item",
  evidence: "page 1 is the specification sheet and page 2 the shop drawing of the same desk chair",
};

/** The S-301 shape, staged as a version 3 run. */
export function namedSheetRun(items: RawDrawingItem[] = [SPEC_SHEET, SHOP_DRAWING]): StagedDrawings {
  return stageDrawings(items, NAMED_FIELDS, "q-301.pdf", null, null, items.length > 1 ? [ONE_CHAIR_TWO_PAGES] : []);
}
