// What the model is allowed to return, and what we insist on before believing
// any of it.
//
// ============================================================================
// THE OUTPUT IS DELIBERATELY DUMB.
//
// The model returns OBSERVATIONS — "this document, on page 14, says SX11A's leg
// finish is Antique Brass" — and nothing else. It never returns a spec record
// id, a requirement id, or an answer state.
//
// Two reasons, and both are load-bearing:
//
//   1. Resolving a ref to a record is not a language problem. `SX11A` appears
//      TWICE in the pilot BOQ with different quantities. A model asked to pick
//      one will pick one, confidently, and be right half the time. Code that
//      finds two candidates reports two candidates and makes a human choose.
//   2. An answer state is an operational decision. `confirmed` versus `tbc` is
//      the difference between a gate passing and a gate blocking. A document
//      that literally says "TBC" must never produce a settled answer, and that
//      rule belongs in tested code, not in a prompt.
//
// So: the model reads; the resolver in spec-document.ts decides; a human
// confirms. Each of those three can be wrong in a way the next one catches.
//
// The tool schema and the Zod schema look redundant. They are not. The tool
// schema is a REQUEST — it shapes what the model tries to produce. Zod is the
// CHECK, applied to what actually arrived. A model can return malformed output
// under any schema, and TypeScript types are not runtime validation.
// ============================================================================
import { z } from "zod";

export const TOOL_NAME = "record_specification_observations";

/** Bounds. A document cannot talk this process into unbounded memory. */
export const MAX_PROPOSALS = 600;
const MAX_SHORT = 300;
const MAX_VALUE = 2_000;
const MAX_NOTE = 1_000;

// `strict: true` is NOT set on the tool. The strict validator caps
// nullable/union parameters at 16 and this schema has more, so it would be
// rejected outright. `additionalProperties: false` plus every field in
// `required` gets the same discipline without that ceiling.
//
// Nullable scalars are `{ type: [T, "null"] }`. A nullable ENUM cannot be
// written that way and has to use `anyOf` — a JSON Schema quirk, not a
// preference. Treat all of this as current API behaviour to re-verify, not as
// a timeless rule.
export const SPEC_DOCUMENT_TOOL = {
  name: TOOL_NAME,
  description:
    "Record every specification observation found in the source document. One entry per attribute of one item. " +
    "Copy the document's own wording; do not normalise, tidy, translate or interpret it.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      proposals: {
        type: "array",
        maxItems: MAX_PROPOSALS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            refRaw: {
              type: ["string", "null"],
              maxLength: MAX_SHORT,
              description:
                "The item reference exactly as the document writes it (e.g. 'SX11A', 'FU-209-15'). Null if this observation names no item.",
            },
            attributeRaw: {
              type: ["string", "null"],
              maxLength: MAX_SHORT,
              description:
                "The attribute exactly as the document labels it (e.g. 'Leg finish', 'COM fabric'). Null if the document gives no label.",
            },
            valueRaw: {
              type: ["string", "null"],
              maxLength: MAX_VALUE,
              description:
                "The value exactly as written, including wording like 'TBC', 'N/A' or 'Design to suggest'. Never substitute a cleaner value.",
            },
            page: {
              type: ["integer", "null"],
              minimum: 1,
              description: "1-based page number for a PDF. Null for a spreadsheet.",
            },
            sourceSheet: {
              type: ["string", "null"],
              maxLength: MAX_SHORT,
              description: "Sheet name for a spreadsheet. Null for a PDF.",
            },
            sourceRow: {
              type: ["integer", "null"],
              minimum: 1,
              description: "1-based row number for a spreadsheet. Null for a PDF.",
            },
            confidence: {
              anyOf: [{ type: "string", enum: ["high", "medium", "low"] }, { type: "null" }],
              description:
                "How clearly the document states this. 'low' for anything inferred from layout rather than read from a label.",
            },
            note: {
              type: ["string", "null"],
              maxLength: MAX_NOTE,
              description:
                "Anything a reviewer needs in order to judge this — an ambiguity, a conflict with another page, a heading the value was read under.",
            },
          },
          required: ["refRaw", "attributeRaw", "valueRaw", "page", "sourceSheet", "sourceRow", "confidence", "note"],
        },
      },
      documentNotes: {
        type: ["string", "null"],
        maxLength: MAX_NOTE,
        description: "One note about the document as a whole: what it covers, what it plainly does not, anything unreadable.",
      },
    },
    required: ["proposals", "documentNotes"],
  },
};

// The check. `.default(null)` where a missing field is genuinely acceptable;
// the core structure stays required, because output without `proposals` is not
// a thin result, it is a failure to answer.
const nullableText = (max: number) =>
  z.string().max(max).nullable().catch(null).default(null);

export const RawProposal = z.object({
  refRaw: nullableText(MAX_SHORT),
  attributeRaw: nullableText(MAX_SHORT),
  valueRaw: nullableText(MAX_VALUE),
  page: z.number().int().min(1).max(100_000).nullable().catch(null).default(null),
  sourceSheet: nullableText(MAX_SHORT),
  sourceRow: z.number().int().min(1).max(1_000_000).nullable().catch(null).default(null),
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null).default(null),
  note: nullableText(MAX_NOTE),
});

export type RawProposal = z.infer<typeof RawProposal>;

export const ExtractionOutput = z.object({
  proposals: z.array(RawProposal).max(MAX_PROPOSALS),
  documentNotes: nullableText(MAX_NOTE),
});

export type ExtractionOutput = z.infer<typeof ExtractionOutput>;

// ============================================================================
// SHOP DRAWINGS
//
// A different document entirely, and the reason it needs its own schema rather
// than another prompt over `record_specification_observations`: a drawing page
// is ONE item with MANY observations of several kinds, and the flat proposal
// list above cannot say which page's item a dimension belongs to without the
// model guessing a ref onto every row.
//
// What the AP364 seating drawings actually put on a page:
//   * The item code as large outlined text ("S-100", "UP-101"). It is VECTOR
//     OUTLINE, absent from the PDF's text layer — only a model reading the page
//     as an image gets it, which is why this document goes to the model as a
//     `document` block and never as extracted text.
//   * Dimension figures with leader lines and no unit printed anywhere. 190/79/
//     72 is a sofa in centimetres; 550/735 is a desk chair in millimetres. The
//     model reports the FIGURES; the unit is a human's decision afterwards.
//
// The Panther specification sheets that arrive in the same pack are the other
// half of this. One PDF per line item, and they DO print the unit: "WIDTH
// 1800mm". So `unitRaw` asks for the unit the page shows and forbids inferring
// one it does not. A unit the document states is not a guess, and no amount of
// downstream care recovers a stated unit that was never read.
//   * Swatch captions pairing a part with a material: "SOFA / Yarn Tessarae
//     YC04158 - 01", "SOFA FEET / Dark tinted wood".
//   * The client's own finish codes beside the swatches: CH-01.1, WD-01, MT-01.
//   * Deferred decisions written on the drawing: "PIPING  TBC".
//
// Still no state, no record id, no BWS field, and no unit this app INVENTED.
// Same rule as above: the model reads, the resolver decides, a human confirms.
// ============================================================================

export const DRAWINGS_TOOL_NAME = "record_drawing_items";

export const MAX_DRAWING_ITEMS = 400;
// Measured, not guessed: a real AP364 armchair page returned 44 dimension
// figures across its plan, elevations and section. 40 refused the whole
// extraction after the call was paid for. Generous enough for a dense page,
// still bounded — a document cannot talk this process into unbounded memory.
export const MAX_PER_ITEM = 120;

const drawingObservationProperties = {
  labelRaw: {
    type: ["string", "null"],
    maxLength: MAX_SHORT,
    description:
      "The drawing's own label for this, exactly as written ('SOFA FEET', 'FABRIC', 'Width', 'PIPING'). Null if the drawing gives none.",
  },
  valueRaw: {
    type: ["string", "null"],
    maxLength: MAX_VALUE,
    description:
      "The value exactly as written, including 'TBC' where the drawing says so. For a dimension, the figure alone ('190'). Never add a unit the drawing does not print.",
  },
};

// Dimensions only, and REPORTED rather than decided. The AP364 shop drawings
// print no unit anywhere; the Panther specification sheets print "WIDTH 1800mm"
// outright. Asking the model to report a unit it can SEE is reading, not
// inference — and it is strictly better than the app guessing from magnitude at
// a document that already said so.
//
// It stays raw text. `normaliseUnit` resolves it against the app's own
// vocabulary afterwards, in code, which is the exact/fuzzy split house
// convention 6 requires: the model decides which text is the unit, the resolver
// decides what this app calls it.
const dimensionUnitProperty = {
  unitRaw: {
    type: ["string", "null"],
    maxLength: MAX_SHORT,
    description:
      "The unit PRINTED beside this figure, copied exactly ('mm', 'cm', '\"'). Null if the page prints no unit for it — which is the normal case on a shop drawing. Never infer one from how large the number is.",
  },
};

export const DRAWINGS_TOOL = {
  name: DRAWINGS_TOOL_NAME,
  description:
    "Record every furniture item drawn in this document, one entry per item, with the dimensions, materials and notes its page states. " +
    "Copy the drawing's own wording and figures; do not normalise, convert, tidy or infer.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        maxItems: MAX_DRAWING_ITEMS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            itemCodeRaw: {
              type: ["string", "null"],
              maxLength: MAX_SHORT,
              description:
                "The item code the page is titled with, exactly as drawn (e.g. 'S-100', 'UP-101'). Usually large text in a corner. Null if the page shows none.",
            },
            itemNameRaw: {
              type: ["string", "null"],
              maxLength: MAX_SHORT,
              description:
                "What the drawing calls the item ('Sofa', 'Desk chair', 'Headboard'), from the title block or a caption. Null if absent.",
            },
            page: { type: ["integer", "null"], minimum: 1, description: "1-based page number this item is drawn on." },
            dimensions: {
              type: "array",
              maxItems: MAX_PER_ITEM,
              description:
                "Every dimension figure on the page. Report the number as drawn, and the unit ONLY where the page prints one beside it.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { ...drawingObservationProperties, ...dimensionUnitProperty },
                required: ["labelRaw", "valueRaw", "unitRaw"],
              },
            },
            materials: {
              type: "array",
              maxItems: MAX_PER_ITEM,
              description:
                "Every material, fabric, finish or hardware callout, one per entry. Keep the part it names and the specification separate.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  ...drawingObservationProperties,
                  materialCodeRaw: {
                    type: ["string", "null"],
                    maxLength: MAX_SHORT,
                    description:
                      "The client's own finish code shown against this callout, if any ('CH-01.1', 'WD-01', 'MT-01', 'UPH-07'). Null otherwise.",
                  },
                },
                required: ["labelRaw", "valueRaw", "materialCodeRaw"],
              },
            },
            notesRaw: {
              type: "array",
              maxItems: MAX_PER_ITEM,
              description:
                "Anything else the page states about this item: construction notes, annotations in any language, 'TBC' markers not attached to a callout above.",
              items: { type: "string", maxLength: MAX_VALUE },
            },
            confidence: {
              anyOf: [{ type: "string", enum: ["high", "medium", "low"] }, { type: "null" }],
              description: "How clearly the page identifies this item. 'low' if the code was hard to read.",
            },
          },
          required: ["itemCodeRaw", "itemNameRaw", "page", "dimensions", "materials", "notesRaw", "confidence"],
        },
      },
      documentNotes: {
        type: ["string", "null"],
        maxLength: MAX_NOTE,
        description: "One note about the drawing set as a whole: what it covers, pages you could not read, units if they ARE stated anywhere.",
      },
    },
    required: ["items", "documentNotes"],
  },
};

export const RawDrawingObservation = z.object({
  labelRaw: nullableText(MAX_SHORT),
  valueRaw: nullableText(MAX_VALUE),
});

// `.optional().catch(null)` on unitRaw, unlike the arrays above: a model that
// omits it or returns something odd should lose the unit and fall through to
// the figures and then the project default, not fail an extraction that has
// already been paid for. Losing a unit is recoverable on the review screen;
// losing the whole run costs another call.
//
// Optional in the INFERRED type too, deliberately. Most dimensions this app
// will ever see carry no printed unit, so a caller constructing one should not
// have to write `unitRaw: null` to say the ordinary thing.
export const RawDrawingDimension = RawDrawingObservation.extend({
  unitRaw: nullableText(MAX_SHORT).optional().catch(null),
});

export const RawDrawingMaterial = RawDrawingObservation.extend({
  materialCodeRaw: nullableText(MAX_SHORT),
});

export const RawDrawingItem = z.object({
  itemCodeRaw: nullableText(MAX_SHORT),
  itemNameRaw: nullableText(MAX_SHORT),
  page: z.number().int().min(1).max(100_000).nullable().catch(null).default(null),
  // NOT `.catch([])`: that turns an over-long or malformed array into an EMPTY
  // one, so a page with 41 dimensions would stage as a page with none and
  // nothing anywhere would say so. A schema failure is terminal and reported.
  dimensions: z.array(RawDrawingDimension).max(MAX_PER_ITEM).default([]),
  materials: z.array(RawDrawingMaterial).max(MAX_PER_ITEM).default([]),
  notesRaw: z.array(z.string().max(MAX_VALUE)).max(MAX_PER_ITEM).default([]),
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null).default(null),
});

export type RawDrawingItem = z.infer<typeof RawDrawingItem>;
export type RawDrawingDimension = z.infer<typeof RawDrawingDimension>;
export type RawDrawingMaterial = z.infer<typeof RawDrawingMaterial>;
export type RawDrawingObservation = z.infer<typeof RawDrawingObservation>;

export const DrawingsOutput = z.object({
  items: z.array(RawDrawingItem).max(MAX_DRAWING_ITEMS),
  documentNotes: nullableText(MAX_NOTE),
});

export type DrawingsOutput = z.infer<typeof DrawingsOutput>;

// ============================================================================
// PREAMBLE
//
// Project-level prose, not item data: flameproofing standards, tagging and
// penalties, moisture content, tolerances, who verifies site dimensions. It
// belongs on the project overview, so the model's job is to cut it into notes
// somebody will actually read, keeping the document's own words.
// ============================================================================

export const PREAMBLE_TOOL_NAME = "record_preamble_notes";

export const MAX_PREAMBLE_NOTES = 300;
const MAX_BODY = 4_000;

export const PREAMBLE_TOOL = {
  name: PREAMBLE_TOOL_NAME,
  description:
    "Record the requirements this preamble places on the manufacturer, one entry per requirement, in the document's own words.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      notes: {
        type: "array",
        maxItems: MAX_PREAMBLE_NOTES,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            topicRaw: {
              type: ["string", "null"],
              maxLength: MAX_SHORT,
              description:
                "The section or heading this sits under, as written ('SECTION 4 SEATING / UPHOLSTERY SPECIFICATIONS', 'FLAMEPROOFING').",
            },
            titleRaw: {
              type: ["string", "null"],
              maxLength: MAX_SHORT,
              description: "A short title for this requirement, taken from its own numbered heading where it has one.",
            },
            bodyRaw: {
              type: ["string", "null"],
              maxLength: MAX_BODY,
              description:
                "What the document requires, in its own words. Quote or condense; never paraphrase a standard, a tolerance, a percentage or a deadline into different wording.",
            },
            page: { type: ["integer", "null"], minimum: 1, description: "1-based page number." },
          },
          required: ["topicRaw", "titleRaw", "bodyRaw", "page"],
        },
      },
      documentNotes: {
        type: ["string", "null"],
        maxLength: MAX_NOTE,
        description: "One note about the preamble as a whole: which trades it covers, anything unreadable.",
      },
    },
    required: ["notes", "documentNotes"],
  },
};

export const RawPreambleNote = z.object({
  topicRaw: nullableText(MAX_SHORT),
  titleRaw: nullableText(MAX_SHORT),
  bodyRaw: nullableText(MAX_BODY),
  page: z.number().int().min(1).max(100_000).nullable().catch(null).default(null),
});

export type RawPreambleNote = z.infer<typeof RawPreambleNote>;

export const PreambleOutput = z.object({
  notes: z.array(RawPreambleNote).max(MAX_PREAMBLE_NOTES),
  documentNotes: nullableText(MAX_NOTE),
});

export type PreambleOutput = z.infer<typeof PreambleOutput>;

// ============================================================================
// ONE TOOL PER DOCUMENT KIND
//
// Keyed on DocumentKind so adding a kind to the vocabulary fails the typecheck
// until it has a tool and a schema, exactly as it already fails until it has a
// prompt. `outputKind` is the SHAPE the model returns, which is not the same
// thing as the document kind: five kinds share the observation shape because
// they are all schedules of item attributes.
// ============================================================================
import type { DocumentKind } from "@/lib/spec-vocab";

export type ExtractionToolSpec =
  | { outputKind: "observations"; tool: typeof SPEC_DOCUMENT_TOOL; schema: typeof ExtractionOutput }
  | { outputKind: "drawing_items"; tool: typeof DRAWINGS_TOOL; schema: typeof DrawingsOutput }
  | { outputKind: "preamble_notes"; tool: typeof PREAMBLE_TOOL; schema: typeof PreambleOutput };

const OBSERVATIONS: ExtractionToolSpec = {
  outputKind: "observations",
  tool: SPEC_DOCUMENT_TOOL,
  schema: ExtractionOutput,
};

export const TOOLS: Record<DocumentKind, ExtractionToolSpec> = {
  ffe_schedule: OBSERVATIONS,
  spec_bible: OBSERVATIONS,
  finishes_schedule: OBSERVATIONS,
  fabric_schedule: OBSERVATIONS,
  other: OBSERVATIONS,
  shop_drawings: { outputKind: "drawing_items", tool: DRAWINGS_TOOL, schema: DrawingsOutput },
  preamble: { outputKind: "preamble_notes", tool: PREAMBLE_TOOL, schema: PreambleOutput },
};

/** What a successful extraction returned, discriminated by the shape it is. */
export type ExtractionPayload =
  | { outputKind: "observations"; data: ExtractionOutput }
  | { outputKind: "drawing_items"; data: DrawingsOutput }
  | { outputKind: "preamble_notes"; data: PreambleOutput };
