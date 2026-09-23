// Pure tier. Guards the contract between the document-kind vocabulary and the
// three things a kind needs before it can be read: a prompt, a tool and a
// schema. Adding a kind without one of them is a run that reads a document with
// the wrong instructions, or returns a shape no reviewer can display.
import { describe, it, expect } from "vitest";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/spec-vocab";
import { PROMPTS } from "@/lib/anthropic";
import {
  TOOLS,
  DRAWINGS_TOOL,
  ExtractionOutput,
  DrawingsOutput,
  PreambleOutput,
  MAX_DRAWING_ITEMS,
  MAX_PREAMBLE_NOTES,
  MAX_PER_ITEM,
} from "@/lib/extraction-schema";

describe("per-kind extraction contract", () => {
  it.each(DOCUMENT_KINDS)("%s has a prompt, a tool and a schema", (kind: DocumentKind) => {
    expect(PROMPTS[kind]?.length ?? 0).toBeGreaterThan(200);
    const spec = TOOLS[kind];
    expect(spec.tool.name).toMatch(/^[a-z_]+$/);
    expect(spec.schema).toBeTruthy();
  });

  it("never sets strict on a tool", () => {
    // The strict validator caps nullable/union parameters at 16 and these
    // schemas have more, so a strict tool is rejected outright.
    for (const kind of DOCUMENT_KINDS) {
      expect((TOOLS[kind].tool as { strict?: boolean }).strict).toBeUndefined();
    }
  });

  it("gives the two register-free kinds their own shapes", () => {
    expect(TOOLS.shop_drawings.outputKind).toBe("drawing_items");
    expect(TOOLS.preamble.outputKind).toBe("preamble_notes");
    expect(TOOLS.ffe_schedule.outputKind).toBe("observations");
    expect(TOOLS.other.outputKind).toBe("observations");
  });

  it("tells the model not to invent a unit the drawings do not print", () => {
    // A shop drawing set mixes millimetres and centimetres between pages and
    // prints neither, so an inferred figure would read as a real measurement.
    expect(PROMPTS.shop_drawings).toMatch(/never infer one from how large the number is/i);
    expect(PROMPTS.shop_drawings).toMatch(/never convert/i);
  });

  it("tells the model to report a unit the page DOES print, separately from the figure", () => {
    // The Panther specification sheets state "WIDTH 1800mm". Reading a unit
    // that is on the page is not inference, and guessing from magnitude at a
    // document that already said so would be strictly worse.
    expect(PROMPTS.shop_drawings).toMatch(/unitRaw/);
    expect(PROMPTS.shop_drawings).toMatch(/never combined into the value/i);
  });

  it("gives the model no operational field to be talked into", () => {
    // Property NAMES, not the prose: the model may be told what a page states,
    // it may not be given a `state` to fill in. Resolution and answer state are
    // decisions for tested code and a human.
    const names = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "properties" && value && typeof value === "object") {
          for (const property of Object.keys(value as Record<string, unknown>)) names.add(property);
        }
        walk(value);
      }
    };
    for (const kind of DOCUMENT_KINDS) walk(TOOLS[kind].tool.input_schema);
    for (const forbidden of ["recordId", "requirementId", "state", "confirmed", "specFieldId", "unit"]) {
      expect(names).not.toContain(forbidden);
    }
    // `unitRaw` is allowed and `unit` is not, and the difference is the whole
    // rule rather than a naming accident. `unitRaw` is what the page printed;
    // `unit` is the app's controlled vocabulary value, which `normaliseUnit`
    // decides afterwards. Same split as labelRaw/valueRaw/materialCodeRaw.
    expect(names).toContain("unitRaw");
  });
});

describe("output schemas", () => {
  it("tolerates a model omitting every optional key", () => {
    const drawings = DrawingsOutput.safeParse({ items: [{}], documentNotes: undefined });
    expect(drawings.success).toBe(true);
    expect(drawings.success && drawings.data.items[0]).toMatchObject({
      itemCodeRaw: null, page: null, dimensions: [], materials: [], notesRaw: [],
    });

    expect(PreambleOutput.safeParse({ notes: [{}] }).success).toBe(true);
    expect(ExtractionOutput.safeParse({ proposals: [{}] }).success).toBe(true);
  });

  it("rejects an over-long array rather than staging it", () => {
    const tooMany = { items: Array.from({ length: MAX_DRAWING_ITEMS + 1 }, () => ({})), documentNotes: null };
    expect(DrawingsOutput.safeParse(tooMany).success).toBe(false);
    expect(PreambleOutput.safeParse({ notes: Array.from({ length: MAX_PREAMBLE_NOTES + 1 }, () => ({})), documentNotes: null }).success).toBe(false);
  });

  it("bounds the observations inside one drawing item", () => {
    const item = { itemCodeRaw: "X-1", dimensions: Array.from({ length: MAX_PER_ITEM + 1 }, () => ({ labelRaw: "W", valueRaw: "1" })) };
    expect(DrawingsOutput.safeParse({ items: [item], documentNotes: null }).success).toBe(false);
  });

  it("keeps a material's client code", () => {
    const parsed = DrawingsOutput.safeParse({
      items: [{ itemCodeRaw: "X-1", materials: [{ labelRaw: "FEET", valueRaw: "Dark wood", materialCodeRaw: "WD-01" }] }],
      documentNotes: null,
    });
    expect(parsed.success && parsed.data.items[0]?.materials[0]?.materialCodeRaw).toBe("WD-01");
  });
});

// ============================================================================
// NEVER FAIL A PAID RUN OVER A HINT — Stage 2 variance row 2 (plan §6.10.b).
//
// One test per FIELD CLASS, because the audit that produced them went field by
// field: a string where a list belongs, a number where a string belongs, an
// unknown enum value, a null where an object belongs. The finding was that
// every scalar and every enum in these schemas already degrades to null or to
// the cautious enum — and that six ARRAYS did not, each of them the `itemCodes`
// shape that has already cost one charged call.
//
// A malformed field must leave ONE amber row in front of a reviewer, never a
// terminal `failed` on a document somebody has paid to read.
// ============================================================================
describe("a malformed optional field never fails a paid run", () => {
  const item = (overrides: Record<string, unknown> = {}) => ({ itemCodeRaw: "X-1", itemNameRaw: "Sofa", page: 1, ...overrides });
  const drawings = (overrides: Record<string, unknown>) =>
    DrawingsOutput.safeParse({ items: [item(overrides)], codeGroups: [], documentNotes: null });

  it("a NUMBER where a string belongs becomes null, on every text field", () => {
    const parsed = drawings({ itemNameRaw: 7, dimensions: [{ labelRaw: 7, valueRaw: "1800", unitRaw: 5, slotEvidence: {} }] });
    expect(parsed.success).toBe(true);
    const dimension = parsed.success ? parsed.data.items[0]?.dimensions[0] : null;
    expect(dimension?.labelRaw).toBeNull();
    expect(dimension?.unitRaw).toBeNull();
    expect(dimension?.slotEvidence).toBeNull();
    // The figure itself survives: it is the only thing on the row worth having.
    expect(dimension?.valueRaw).toBe("1800");
  });

  it("an UNKNOWN ENUM value becomes the cautious answer, never a confident one", () => {
    const parsed = drawings({ confidence: "very", dimensions: [{ labelRaw: "W", valueRaw: "1", slot: "girth" }] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items[0]?.confidence).toBeNull();
    // An unrecognised slot places NOTHING, so the label vocabulary decides.
    expect(parsed.success && parsed.data.items[0]?.dimensions[0]?.slot).toBeNull();

    // `configurations` is the value that turns one item into several BWS jobs,
    // so an unrecognised relationship must land on the one that asks a person.
    const grouped = DrawingsOutput.safeParse({
      items: [item()],
      codeGroups: [{ itemCodes: ["S-100"], pages: [1], relationship: "maybe", evidence: null }],
      documentNotes: null,
    });
    expect(grouped.success && grouped.data.codeGroups?.[0]?.relationship).toBe("unclear");

    const email = ExtractionOutput.safeParse({ proposals: [{ valueRaw: "x", changeIntent: "maybe" }], documentNotes: null });
    expect(email.success && email.data.proposals[0]?.changeIntent).toBeNull();
  });

  it("a NULL where an object belongs drops that entry and keeps its siblings", () => {
    const parsed = drawings({
      dimensions: [null, { labelRaw: "W", valueRaw: "1900" }],
      viewRegions: [null, { viewType: "front", page: 1, bbox: [0, 0, 1, 1] }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items[0]?.dimensions).toEqual([{ labelRaw: "W", valueRaw: "1900" }]);
    // The region beside it SURVIVES. It used to be thrown away with the null:
    // `.catch([])` sat on the whole array, so one bad entry emptied it.
    expect(parsed.success && parsed.data.items[0]?.viewRegions).toEqual([
      { viewType: "front", page: 1, bbox: [0, 0, 1, 1] },
    ]);
  });

  it("ONE malformed view region no longer discards the good ones beside it", () => {
    // FIU 2026-09-21. Survivable either way -- the card proposes no picture and
    // the item stays whole -- but the good regions are recoverable and were not
    // being recovered. A region cannot hold a bare value (a string is not a box
    // on a page), so the bad entry is DROPPED rather than wrapped: nothing is
    // invented and nothing else is lost.
    const parsed = drawings({
      viewRegions: [
        "the photo top left",
        { viewType: "photo", page: 1, bbox: [0.1, 0.1, 0.5, 0.5] },
        [0, 0, 1, 1],
        { viewType: "front", page: 2, bbox: [0, 0, 1, 1] },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items[0]?.viewRegions).toEqual([
      { viewType: "photo", page: 1, bbox: [0.1, 0.1, 0.5, 0.5] },
      { viewType: "front", page: 2, bbox: [0, 0, 1, 1] },
    ]);

    // A region written as ONE object rather than a list of one is read as the
    // list it meant -- the `itemCodes` precedent.
    const single = drawings({ viewRegions: { viewType: "render", page: 3, bbox: [0, 0, 1, 1] } });
    expect(single.success && single.data.items[0]?.viewRegions).toHaveLength(1);

    // And an entry whose OWN fields are malformed still degrades rather than
    // being dropped: every field on a region already carries its own `.catch`,
    // so the region survives with the cautious answer.
    const inner = drawings({ viewRegions: [{ viewType: "elevation", page: "one", bbox: [0, 0] }] });
    expect(inner.success && inner.data.items[0]?.viewRegions).toEqual([
      { viewType: "other", page: null, bbox: null },
    ]);
  });

  it("ONE malformed code group no longer leaves the whole document ungrouped", () => {
    // The grouping is what reads a second page titled `MUR.2 ARMCHAIR` as the
    // same item as `S-200`. Losing every group over one bad entry unpicks that
    // for the whole document.
    const parsed = DrawingsOutput.safeParse({
      items: [item()],
      codeGroups: [
        null,
        "S-100",
        { itemCodes: ["S-200", "MUR.2 ARMCHAIR"], pages: [3, 4], relationship: "one_item", evidence: null },
      ],
      documentNotes: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.codeGroups).toHaveLength(1);
    expect(parsed.success && parsed.data.codeGroups?.[0]?.itemCodes).toEqual(["S-200", "MUR.2 ARMCHAIR"]);
  });

  it("an OVER-LONG array of regions or groups still empties, which is what the catch is for", () => {
    // The bound is the thing that stops a page staging as something it is not,
    // and `objectEntriesAsList` must not become a way round it. Emptying is
    // safe HERE and only here: a card with no picture proposed is visible on
    // screen and fixable by dragging a box, and an ungrouped document asks a
    // person. That is the trade the comment beside `dimensions` refuses.
    const region = { viewType: "photo", page: 1, bbox: [0, 0, 1, 1] };
    const parsed = drawings({ viewRegions: Array.from({ length: 200 }, () => region) });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items[0]?.viewRegions).toEqual([]);
  });

  it("an ABSENT optional array stays absent rather than becoming an empty answer", () => {
    // `viewRegions` omitted means "this loader did not report one", which is
    // not the same statement as "there are none" -- the card reads the absence
    // and proposes the whole page.
    const parsed = drawings({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items[0]?.viewRegions).toBeUndefined();
    const ungrouped = DrawingsOutput.safeParse({ items: [item()], documentNotes: null });
    expect(ungrouped.success && ungrouped.data.codeGroups).toBeUndefined();
  });

  it("a STRING where a list of strings belongs is read as a one-entry list", () => {
    // The `itemCodes` precedent, which cost a charged call on a real document.
    const parsed = drawings({ dimensionsCombinedRaw: "80 x 70 x 90 cm", notesRaw: "REMARKS: verify on site" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items[0]?.dimensionsCombinedRaw).toEqual(["80 x 70 x 90 cm"]);
    expect(parsed.success && parsed.data.items[0]?.notesRaw).toEqual(["REMARKS: verify on site"]);
    // And a number inside one keeps its digits rather than killing the run.
    const numeric = drawings({ notesRaw: [5] });
    expect(numeric.success && numeric.data.items[0]?.notesRaw).toEqual(["5"]);
  });

  it("a STRING where a list of observations belongs becomes ONE unlabelled observation", () => {
    // Nothing is invented: the value is kept and no slot, unit or field is
    // claimed, which is the shape the card already renders as `Dimension 1`.
    const asString = drawings({ dimensions: "1800", materials: "Dark tinted oak" });
    expect(asString.success).toBe(true);
    expect(asString.success && asString.data.items[0]?.dimensions).toEqual([{ labelRaw: null, valueRaw: "1800" }]);
    expect(asString.success && asString.data.items[0]?.materials).toEqual([
      { labelRaw: null, valueRaw: "Dark tinted oak", materialCodeRaw: null },
    ]);

    const flat = ExtractionOutput.safeParse({ proposals: "the seat height is 445mm", documentNotes: null });
    expect(flat.success && flat.data.proposals[0]?.valueRaw).toBe("the seat height is 445mm");
    expect(flat.success && flat.data.proposals[0]?.attributeRaw).toBeNull();

    const preamble = PreambleOutput.safeParse({ notes: "Moisture content 8-12%", documentNotes: null });
    expect(preamble.success && preamble.data.notes[0]?.bodyRaw).toBe("Moisture content 8-12%");
  });

  it("still refuses the three failures that are not hints", () => {
    // An ABSENT required array is a failure to answer, not a thin answer, and
    // defaulting it to empty would report "the document says nothing".
    expect(ExtractionOutput.safeParse({ documentNotes: null }).success).toBe(false);
    expect(PreambleOutput.safeParse({ documentNotes: null }).success).toBe(false);
    // An ITEM is a container, not an observation: a bare string could only
    // become one by naming it something.
    expect(DrawingsOutput.safeParse({ items: "S-100", documentNotes: null }).success).toBe(false);
    // An over-long array still fails loudly rather than staging a 121-dimension
    // page as a page with none.
    expect(drawings({ dimensions: Array.from({ length: MAX_PER_ITEM + 1 }, () => ({ labelRaw: "W", valueRaw: "1" })) }).success).toBe(false);
  });
});

// ============================================================================
// CONFIGURATIONS A PAGE NAMES — schemaVersion 3 (2026-09-23).
//
// The S-301 SHAPE, with invented names: one sheet, one set of overall
// dimensions, and a fabric heading "As per room type" listing four lines for
// five room types. The model read it right and the tool had nowhere to put it,
// so it welded the type into each label and the app made one chair with three
// fabrics out of five chairs with one each.
// ============================================================================
describe("configurations a page names", () => {
  const sheet = (overrides: Record<string, unknown> = {}) => ({
    itemCodeRaw: "Q-301",
    itemNameRaw: "Desk chair",
    page: 1,
    dimensions: [
      { labelRaw: "Width", valueRaw: "550", unitRaw: "mm", slot: "width", slotEvidence: "labelled WIDTH", isOverall: true, configurations: [] },
    ],
    materials: [
      { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker A, Ref. X", materialCodeRaw: null, configurations: ["Type 1", "Type 5"] },
      { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker B, Ref. Y", materialCodeRaw: null, configurations: ["Type 2"] },
    ],
    configurations: [
      { name: "Type 1", nameRaw: "Type 1 & 5", evidence: "As per room type: Type 1 & 5 - Maker A" },
      { name: "Type 5", nameRaw: "Type 1 & 5", evidence: "As per room type: Type 1 & 5 - Maker A" },
      { name: "Type 2", nameRaw: "Type 2", evidence: "Type 2 - Maker B" },
    ],
    depictsConfigurations: [],
    ...overrides,
  });
  const parse = (item: Record<string, unknown>) => DrawingsOutput.safeParse({ items: [item], codeGroups: [], documentNotes: null });

  it("parses a page naming its configurations, with each row's own list", () => {
    const parsed = parse(sheet());
    expect(parsed.success).toBe(true);
    const item = parsed.success ? parsed.data.items[0]! : null;
    expect(item?.configurations?.map((entry) => entry.name)).toEqual(["Type 1", "Type 5", "Type 2"]);
    expect(item?.configurations?.[0]?.nameRaw).toBe("Type 1 & 5");
    expect(item?.materials.map((row) => row.configurations)).toEqual([["Type 1", "Type 5"], ["Type 2"]]);
    // The label stays the FIELD. Nothing welds a type onto it.
    expect(item?.materials.map((row) => row.labelRaw)).toEqual(["FABRIC REFERENCE", "FABRIC REFERENCE"]);
    expect(item?.dimensions[0]?.configurations).toEqual([]);
  });

  it("reads a bare string as a one-entry list, everywhere a list is asked for", () => {
    const parsed = parse(
      sheet({
        configurations: "Type 2",
        depictsConfigurations: "Type 2",
        materials: [{ labelRaw: "FABRIC REFERENCE", valueRaw: "Maker B", materialCodeRaw: null, configurations: "Type 2" }],
      }),
    );
    expect(parsed.success).toBe(true);
    const item = parsed.success ? parsed.data.items[0]! : null;
    expect(item?.configurations).toEqual([{ name: "Type 2", nameRaw: "Type 2", evidence: null }]);
    expect(item?.depictsConfigurations).toEqual(["Type 2"]);
    expect(item?.materials[0]?.configurations).toEqual(["Type 2"]);
  });

  it("drops a name the page never listed from a row, and KEEPS the row", () => {
    const parsed = parse(
      sheet({
        materials: [
          { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker C", materialCodeRaw: null, configurations: ["Type 9", "Type 2"] },
          { labelRaw: "FABRIC", valueRaw: "Maker E", materialCodeRaw: null, configurations: ["Type 7"] },
        ],
        depictsConfigurations: ["Type 7"],
      }),
    );
    expect(parsed.success).toBe(true);
    const item = parsed.success ? parsed.data.items[0]! : null;
    expect(item?.materials).toHaveLength(2);
    expect(item?.materials[0]?.valueRaw).toBe("Maker C");
    expect(item?.materials[0]?.configurations).toEqual(["Type 2"]);
    // A name the TITLE BLOCK gives is the page naming it, so a row may use it.
    expect(item?.depictsConfigurations).toEqual(["Type 7"]);
    expect(item?.materials[1]?.configurations).toEqual(["Type 7"]);
  });

  it("matches a row's names to the page's by case and whitespace only", () => {
    const parsed = parse(
      sheet({
        materials: [{ labelRaw: "FABRIC", valueRaw: "Maker B", materialCodeRaw: null, configurations: ["TYPE  2", "Typo 2"] }],
      }),
    );
    const item = parsed.success ? parsed.data.items[0]! : null;
    // `TYPE  2` is Type 2; `Typo 2` is a different word and is not guessed at.
    expect(item?.materials[0]?.configurations).toEqual(["TYPE  2"]);
  });

  it("never fails the read over a malformed configuration list or entry", () => {
    const junk = parse(sheet({ configurations: [{ nameRaw: "no name" }, 7, null, { name: "Type 1" }], depictsConfigurations: {} }));
    expect(junk.success).toBe(true);
    const item = junk.success ? junk.data.items[0]! : null;
    // The nameless object is dropped; the bare number is a name; the good one survives.
    expect(item?.configurations?.map((entry) => entry.name)).toEqual(["7", "Type 1"]);
    // `{}` is not a list of names; it reads as none rather than failing the read.
    expect(item?.depictsConfigurations).toEqual([]);
    const shapeless = parse(sheet({ configurations: { oops: true } }));
    expect(shapeless.success).toBe(true);
  });

  it("collapses a configuration listed twice", () => {
    const parsed = parse(sheet({ configurations: ["Type 2", "type 2", "Type 3"] }));
    const item = parsed.success ? parsed.data.items[0]! : null;
    expect(item?.configurations?.map((entry) => entry.name)).toEqual(["Type 2", "Type 3"]);
  });

  it("still parses a version 2 response, which carries none of it", () => {
    const parsed = DrawingsOutput.safeParse({
      items: [{ itemCodeRaw: "X-1", itemNameRaw: "Sofa", page: 1, dimensions: [{ labelRaw: "W", valueRaw: "1" }], materials: [], notesRaw: [], dimensionsCombinedRaw: [], confidence: null }],
      codeGroups: [{ itemCodes: ["X-1"], pages: [1, 2], relationship: "one_item", evidence: "same chair" }],
      documentNotes: null,
    });
    expect(parsed.success).toBe(true);
    const item = parsed.success ? parsed.data.items[0]! : null;
    expect(item?.configurations).toBeUndefined();
    expect(item?.depictsConfigurations).toBeUndefined();
    expect(item?.dimensions[0]?.configurations).toBeUndefined();
  });

  it("asks for the new fields on the tool, and asks the model never to weld them into a label", () => {
    const itemSchema = DRAWINGS_TOOL.input_schema.properties.items.items as unknown as {
      properties: Record<string, { items?: { properties?: Record<string, unknown>; required?: string[] } }>;
      required: string[];
    };
    expect(itemSchema.required).toEqual(expect.arrayContaining(["configurations", "depictsConfigurations"]));
    expect(itemSchema.properties.dimensions?.items?.required).toContain("configurations");
    expect(itemSchema.properties.materials?.items?.required).toContain("configurations");
    expect(PROMPTS.shop_drawings).toMatch(/NEVER put the configuration into the label/);
    expect(PROMPTS.shop_drawings).toMatch(/still describes the PAGES/);
  });

  it("requires only properties each object declares", () => {
    // The code-group object listed `itemCodeRaw` as required while declaring
    // `itemCodes` and forbidding anything else — a request no answer could meet.
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const record = node as { properties?: Record<string, unknown>; required?: string[] };
      if (record.properties && Array.isArray(record.required)) {
        for (const key of record.required) expect(Object.keys(record.properties)).toContain(key);
      }
      for (const value of Object.values(node as Record<string, unknown>)) walk(value);
    };
    for (const kind of DOCUMENT_KINDS) walk(TOOLS[kind].tool.input_schema);
  });
});
