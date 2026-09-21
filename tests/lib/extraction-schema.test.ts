// Pure tier. Guards the contract between the document-kind vocabulary and the
// three things a kind needs before it can be read: a prompt, a tool and a
// schema. Adding a kind without one of them is a run that reads a document with
// the wrong instructions, or returns a shape no reviewer can display.
import { describe, it, expect } from "vitest";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/spec-vocab";
import { PROMPTS } from "@/lib/anthropic";
import {
  TOOLS,
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
