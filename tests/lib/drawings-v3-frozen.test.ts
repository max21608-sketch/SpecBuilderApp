// Pure tier. THE PROOF THAT A VERSION 1, 2 OR 3 RUN READS EXACTLY AS IT DID.
//
// The item-centric read (staged `schemaVersion: 4`, brief D, 2026-10-04) gated
// a dozen helpers on the schema version: the code-group regrouping, page
// lettering, cross-page claims, the cross-view de-duplication, the magnitude
// vote, the slot guess. Every one of them still runs on a run staged before it,
// and "still runs" has to mean "produces the same bytes", or a pack somebody
// has already paid to read changes underneath its reviewer.
//
// So one synthetic v3 document — every multi-page and configuration shape the
// v3 glue exists for, with invented codes and materials — is staged, read back
// through `assertStagedDrawings` as v1, v2 and v3, resolved the way the screen
// resolves it, and reduced the way the eval harness scores it. The whole lot is
// compared against a FILE written by the code BEFORE version 4 existed. A diff
// in that file is a v1–v3 run reading differently; it is never a number to
// re-record without reading why.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertStagedDrawings,
  codeConfigurations,
  crossPageClaims,
  groupItemsByCode,
  namedConfigurationPlans,
  stageDrawings,
  variantLettersByItem,
  type OccupiedSlots,
  type SpecFieldEntry,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { resolveStagedRun } from "@/lib/drawing-resolution";
import { DrawingsOutput } from "@/lib/extraction-schema";
import type { RecordEntry } from "@/lib/record-refs";
import { reduceStagedDrawings } from "../../tools/drawings-golden";

const FIELDS: SpecFieldEntry[] = [
  { id: "f-com1", jsonId: 1, name: "COM 1" },
  { id: "f-com2", jsonId: 2, name: "COM 2" },
  { id: "f-com3", jsonId: 14, name: "COM 3" },
  { id: "f-timber1", jsonId: 4, name: "Main timber finish" },
  { id: "f-timber2", jsonId: 31, name: "Timber Finish 2" },
  { id: "f-timber3", jsonId: 143, name: "Timber Finish 3" },
  { id: "f-metal1", jsonId: 5, name: "Main metal finish" },
  { id: "f-metal2", jsonId: 35, name: "Metal Finish 2" },
];

function record(id: string, code: string, runId: string, runName: string): RecordEntry {
  return {
    id,
    recordNo: 1,
    label: `P00001-${id}`,
    itemDescription: "Item",
    categoryId: null,
    categoryName: null,
    refs: [code],
    boqCodes: [code],
    runId,
    runName,
    parentId: null,
    variantLabel: null,
    version: 1,
  };
}

const RECORDS: RecordEntry[] = [
  record("r-200-main", "X-200", "run-main", "Main"),
  record("r-200-mur", "X-200", "run-mur", "Mock-up"),
  record("r-301", "X-301", "run-main", "Main"),
  record("r-203", "X-203", "run-main", "Main"),
  record("r-33", "PL-X-33", "run-main", "Main"),
  record("r-400", "X-400", "run-main", "Main"),
];

const NO_OCCUPANCY: OccupiedSlots = { fields: new Map(), dimensions: new Map() };

/** Every shape the v3 glue exists for, in one invented document. */
const RAW = {
  documentNotes: "Invented drawing set for the frozen-read proof.",
  codeGroups: [
    {
      itemCodes: ["X-200", "MUR.2 ARMCHAIR"],
      pages: [1, 2],
      relationship: "one_item",
      evidence: "page 1 is the sheet and page 2 the shop drawing of one armchair",
    },
    { itemCodes: ["X-400"], pages: [7, 8], relationship: "configurations", evidence: "OPTION A and OPTION B" },
  ],
  items: [
    {
      itemCodeRaw: "X-200",
      itemNameRaw: "Armchair",
      page: 1,
      dimensions: [
        { labelRaw: "WIDTH", valueRaw: "840", unitRaw: "mm", slot: "width", slotEvidence: "labelled WIDTH", isOverall: true, configurations: [] },
        { labelRaw: "DEPTH", valueRaw: "790", unitRaw: "mm", slot: "depth", slotEvidence: "labelled DEPTH", isOverall: true, configurations: [] },
        { labelRaw: "HEIGHT", valueRaw: "720", unitRaw: "mm", slot: "height", slotEvidence: "labelled HEIGHT", isOverall: true, configurations: [] },
        { labelRaw: "SEAT HEIGHT", valueRaw: "460", unitRaw: "mm", slot: "seat_height", slotEvidence: "labelled", isOverall: true, configurations: [] },
        { labelRaw: "ARM HEIGHT", valueRaw: "620", unitRaw: "mm", slot: null, slotEvidence: null, isOverall: false, configurations: [] },
        { labelRaw: "WIDTH SEAT", valueRaw: "TBC", unitRaw: null, slot: null, slotEvidence: null, isOverall: false, configurations: [] },
      ],
      materials: [
        { labelRaw: "FABRIC REFERENCE", valueRaw: "Invented Cloth Amber", materialCodeRaw: null, configurations: [] },
        { labelRaw: "FEET", valueRaw: "Dark stained oak", materialCodeRaw: "WD-01", configurations: [] },
        { labelRaw: "PIPING", valueRaw: "TBC", materialCodeRaw: null, configurations: [] },
      ],
      dimensionsCombinedRaw: [],
      notesRaw: ["REMARKS: SUBMIT SHOP DRAWINGS FOR REVIEW.", "REMARKS: PROVIDE A SAMPLE.", "SUPPLIER: TO BID"],
      confidence: "high",
      configurations: [],
      depictsConfigurations: [],
      viewRegions: [{ viewType: "photo", page: 1, bbox: [0.1, 0.1, 0.5, 0.5] }],
    },
    {
      itemCodeRaw: "MUR.2 ARMCHAIR",
      itemNameRaw: "Armchair",
      page: 2,
      dimensions: [
        { labelRaw: null, valueRaw: "840", unitRaw: null, slot: "width", slotEvidence: "spans the front elevation", isOverall: true, configurations: [] },
        { labelRaw: null, valueRaw: "840", unitRaw: null, slot: "width", slotEvidence: "spans the plan", isOverall: true, configurations: [] },
        { labelRaw: null, valueRaw: "790", unitRaw: null, slot: "depth", slotEvidence: "side elevation", isOverall: true, configurations: [] },
        { labelRaw: null, valueRaw: "720", unitRaw: null, slot: "height", slotEvidence: "front elevation", isOverall: true, configurations: [] },
        { labelRaw: null, valueRaw: "5", unitRaw: null, slot: null, slotEvidence: null, isOverall: false, configurations: [] },
        { labelRaw: null, valueRaw: "5", unitRaw: null, slot: null, slotEvidence: null, isOverall: false, configurations: [] },
        { labelRaw: null, valueRaw: "110", unitRaw: null, slot: null, slotEvidence: null, isOverall: false, configurations: [] },
      ],
      materials: [{ labelRaw: "FABRIC", valueRaw: "Invented Cloth Amber", materialCodeRaw: "CLO-03 A", configurations: [] }],
      dimensionsCombinedRaw: [],
      notesRaw: [],
      confidence: "medium",
      configurations: [],
      depictsConfigurations: [],
    },
    {
      itemCodeRaw: "X-301",
      itemNameRaw: "Desk chair",
      page: 3,
      dimensions: [
        { labelRaw: "W", valueRaw: "550", unitRaw: "mm", slot: "width", slotEvidence: "prefix W in the line", isOverall: true, configurations: [] },
      ],
      materials: [
        { labelRaw: "FABRIC REFERENCE", valueRaw: "Invented Raffia", materialCodeRaw: null, configurations: ["Type 1", "Type 5"] },
        { labelRaw: "FABRIC REFERENCE", valueRaw: "Invented Velvet", materialCodeRaw: null, configurations: ["Type 2"] },
        { labelRaw: "FRAME", valueRaw: "Antique bronze", materialCodeRaw: "MT-01", configurations: [] },
        { labelRaw: "FABRIC REFERENCE", valueRaw: "Stray", materialCodeRaw: null, configurations: ["Type 9"] },
      ],
      dimensionsCombinedRaw: ["W550 x D600 x H800 mm"],
      notesRaw: [],
      confidence: "high",
      configurations: [
        { name: "Type 1", nameRaw: "Type 1 & 5", evidence: "As per room type" },
        { name: "Type 5", nameRaw: "Type 1 & 5", evidence: "As per room type" },
        { name: "Type 2", nameRaw: "Type 2", evidence: "As per room type" },
      ],
      depictsConfigurations: [],
    },
    {
      itemCodeRaw: null,
      itemNameRaw: null,
      page: 4,
      dimensions: [],
      materials: [],
      dimensionsCombinedRaw: [],
      notesRaw: ["General notes: do not scale."],
      confidence: "low",
      configurations: [],
      depictsConfigurations: [],
    },
    {
      itemCodeRaw: "X-203",
      itemNameRaw: "Armchair",
      page: 5,
      dimensions: [
        { labelRaw: "Width", valueRaw: "80", unitRaw: "cm", slot: "width", slotEvidence: "first of three", isOverall: true, configurations: [] },
        { labelRaw: "Depth", valueRaw: "70", unitRaw: "cm", slot: "height", slotEvidence: "second of three", isOverall: true, configurations: [] },
        { labelRaw: null, valueRaw: "90", unitRaw: "cm", slot: "height", slotEvidence: "third of three", isOverall: true, configurations: [] },
      ],
      materials: [{ labelRaw: "ARMCHAIR", valueRaw: "Invented Boucle", materialCodeRaw: null, configurations: [] }],
      dimensionsCombinedRaw: ["80 x 70 x 90 cm"],
      notesRaw: [],
      confidence: "high",
      configurations: [],
      depictsConfigurations: [],
    },
    {
      itemCodeRaw: "X-33",
      itemNameRaw: "Desk",
      page: 6,
      dimensions: [
        { labelRaw: null, valueRaw: "5'-7", unitRaw: "\"", slot: "width", slotEvidence: "plan", isOverall: true, configurations: [] },
        { labelRaw: null, valueRaw: "2'-7 1/4\"", unitRaw: null, slot: "depth", slotEvidence: "plan", isOverall: true, configurations: [] },
        { labelRaw: null, valueRaw: "1'6\"", unitRaw: null, slot: "height", slotEvidence: "elevation", isOverall: true, configurations: [] },
      ],
      materials: [{ labelRaw: null, valueRaw: "Timber finish", materialCodeRaw: "GR TIM 04", configurations: [] }],
      dimensionsCombinedRaw: [],
      notesRaw: [],
      confidence: "high",
      configurations: [],
      depictsConfigurations: [],
    },
    {
      itemCodeRaw: "X-400",
      itemNameRaw: "Bench",
      page: 7,
      dimensions: [{ labelRaw: null, valueRaw: "1200", unitRaw: null, slot: "width", slotEvidence: "plan", isOverall: true, configurations: [] }],
      materials: [{ labelRaw: "SEAT", valueRaw: "Invented Linen", materialCodeRaw: "UPH-01", configurations: [] }],
      dimensionsCombinedRaw: [],
      notesRaw: [],
      confidence: "high",
      configurations: [],
      depictsConfigurations: [],
    },
    {
      itemCodeRaw: "X-400",
      itemNameRaw: "Bench",
      page: 8,
      dimensions: [{ labelRaw: null, valueRaw: "1200", unitRaw: null, slot: "width", slotEvidence: "plan", isOverall: true, configurations: [] }],
      materials: [{ labelRaw: "SEAT", valueRaw: "Invented Wool", materialCodeRaw: "UPH-02", configurations: [] }],
      dimensionsCombinedRaw: [],
      notesRaw: [],
      confidence: "high",
      configurations: [],
      depictsConfigurations: [],
    },
  ],
};

/** Maps and Sets as plain JSON, so the file says what they held. */
function plain(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, entry) => {
      if (entry instanceof Map) return Object.fromEntries([...entry].map(([k, v]) => [String(k), v]));
      if (entry instanceof Set) return [...entry];
      return entry;
    },
    2,
  );
}

let counter = 0;
beforeEach(() => {
  counter = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

function readAs(staged: StagedDrawings, schemaVersion: 1 | 2 | 3) {
  const doc = assertStagedDrawings(JSON.parse(JSON.stringify({ ...staged, schemaVersion })), FIELDS);
  const context = {
    records: RECORDS,
    occupied: NO_OCCUPANCY,
    variants: new Map<string, string>(),
    finishes: [],
    variantSources: new Map<string, Set<string>>(),
  };
  return {
    doc,
    groups: groupItemsByCode(doc.items, doc),
    letters: variantLettersByItem(doc.items, doc),
    named: namedConfigurationPlans(doc.items, doc),
    configurations: codeConfigurations(doc.items, doc),
    crossPage: crossPageClaims(doc.items, doc, FIELDS),
    resolved: resolveStagedRun(doc, context, FIELDS, "intake-run"),
    reduced: reduceStagedDrawings(doc),
  };
}

describe("a version 1-3 run reads exactly as it did before version 4", () => {
  it("stages, reads, resolves and reduces to the recorded bytes", async () => {
    const output = DrawingsOutput.parse(RAW);
    const staged = stageDrawings(output.items, FIELDS, "X-SET Drawings.pdf", output.documentNotes, null, output.codeGroups ?? []);
    const recorded = {
      staged,
      v3: readAs(staged, 3),
      v2: readAs(staged, 2),
      v1: readAs(staged, 1),
    };
    await expect(plain(recorded)).toMatchFileSnapshot("./__snapshots__/drawings-v3-frozen.json");
  });
});
