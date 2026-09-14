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
    // The set mixes millimetres and centimetres between pages and prints
    // neither, so a converted figure would read as a real measurement.
    expect(PROMPTS.shop_drawings).toMatch(/never append, convert or infer a\s*\n?unit/i);
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
