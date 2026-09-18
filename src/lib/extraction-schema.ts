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
import type { DimensionSlot } from "@/lib/spec-vocab";

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

// ============================================================================
// AN EMAIL
//
// The same OUTPUT as a specification document — a flat list of observations
// resolving against the registers — with two fields a document does not need
// and one it cannot use.
//
// `page`, `sourceSheet` and `sourceRow` are meaningless here and are asked for
// as null. What replaces them is `quotedText`: an email has no page to turn to,
// so the sentence the value was read from is what makes the proposal
// re-checkable at review time.
//
// `changeIntent` records how the message READS. It is not an instruction: the
// resolver still derives the proposed state from the value, exactly as it does
// for a document. It changes exactly one case, and that case is the reason it
// exists — an email withdrawing a settled value back to "not yet decided"
// carries no TBC token in its value, so nothing in the wording alone could
// produce a `tbc` proposal.
// ============================================================================
export const EMAIL_TOOL = {
  name: "record_email_observations",
  description:
    "Record every specification observation stated in this email. One entry per attribute of one item. " +
    "Copy the email's own wording; do not normalise, tidy, translate or interpret it.",
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
                "The item reference exactly as the email writes it (e.g. 'S-100', 'SX11A', 'P17726-014'). Null if this observation names no item.",
            },
            attributeRaw: {
              type: ["string", "null"],
              maxLength: MAX_SHORT,
              description:
                "The attribute exactly as the email labels it (e.g. 'seat height', 'COM fabric'). Null if it gives no label.",
            },
            valueRaw: {
              type: ["string", "null"],
              maxLength: MAX_VALUE,
              description:
                "The value exactly as written, including wording like 'TBC', 'N/A' or 'to be confirmed'. Never substitute a cleaner value.",
            },
            quotedText: {
              type: ["string", "null"],
              maxLength: MAX_VALUE,
              description:
                "The sentence or line this observation was read from, copied verbatim from the email. This is what a reviewer checks the proposal against.",
            },
            changeIntent: {
              anyOf: [
                { type: "string", enum: ["adds", "changes", "confirms_tbc", "withdraws_to_tbc", "unclear"] },
                { type: "null" },
              ],
              description:
                "How the email reads: 'adds' states a value not given before; 'changes' says a value was previously different; 'confirms_tbc' settles something the email says was undecided; 'withdraws_to_tbc' says a settled value is now undecided again; 'unclear' if the email does not say.",
            },
            confidence: {
              anyOf: [{ type: "string", enum: ["high", "medium", "low"] }, { type: "null" }],
              description:
                "How clearly the email states this. 'low' for anything inferred from context rather than stated.",
            },
            note: {
              type: ["string", "null"],
              maxLength: MAX_NOTE,
              description:
                "Anything a reviewer needs in order to judge this — an ambiguity, a conflict with another part of the thread, who is speaking.",
            },
            page: { type: "null", description: "Always null: an email has no pages." },
            sourceSheet: { type: "null", description: "Always null." },
            sourceRow: { type: "null", description: "Always null." },
          },
          required: [
            "refRaw",
            "attributeRaw",
            "valueRaw",
            "quotedText",
            "changeIntent",
            "confidence",
            "note",
            "page",
            "sourceSheet",
            "sourceRow",
          ],
        },
      },
      documentNotes: {
        type: ["string", "null"],
        maxLength: MAX_NOTE,
        description:
          "One note about the email as a whole: what it is about, and anything it plainly does not answer.",
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
  // ---- email only, and OPTIONAL so staged JSON written before emails
  // existed still validates rather than failing a review screen ----------
  //
  // An email has no page number, so the sentence the value came from is what
  // makes it re-checkable: the reviewer reads "the seat height is 440mm"
  // beside the proposal instead of opening the message and searching.
  quotedText: nullableText(MAX_VALUE).optional(),
  // How the email READS, not what the app should do. Code still derives the
  // proposed state; this only changes the one case wording alone cannot
  // express — a value being withdrawn back to undecided.
  changeIntent: z
    .enum(["adds", "changes", "confirms_tbc", "withdraws_to_tbc", "unclear"])
    .nullable()
    .catch(null)
    .default(null)
    .optional(),
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
// A page shows a 3D view, three or four elevations, sometimes a photograph and
// a couple of details. Twelve is generous; a page reporting more than that is
// reporting furniture in swatches, not views of one item.
export const MAX_VIEW_REGIONS = 12;

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

// ============================================================================
// WHICH FIGURE IS THE WIDTH — READ OFF THE PAGE, NOT SORTED BY SIZE.
//
// This is the 2026-09-18 change and the reason for it is measured, not
// theoretical. Across 18 staged runs on the sandbox, 141 of 183 placed
// dimensions — 77% — were the app's guess rather than the page's statement,
// 19 items had their slots SORTED BY MAGNITUDE, and S-203 composed
// `W900 x D800 x H700mm` from a page printing `80 x 70 x 90 cm` with the
// labels Width, Depth and Height beside the figures. The app was outvoting the
// page with an assumption that furniture is wider than it is deep.
//
// Which figure is the overall width is something a person answers BY LOOKING AT
// THE PAGE — it is drawn on the front elevation, it is labelled, it spans the
// whole object — so under the revised house convention 6 it is the model's to
// read and report, with the evidence it read it from. What this app CALLS that
// slot is still resolved in code (`slotFromModel` below maps to
// `DIMENSION_SLOTS`), which is the exact half of the same rule.
//
// `null` has to be a real answer. `ARM HEIGHT` is not one of the five slots and
// never was; a model that cannot decline produces exactly the confident wrong
// answers the magnitude sort produced.
// ============================================================================
const dimensionSlotProperties = {
  slot: {
    anyOf: [
      { type: "string", enum: ["width", "depth", "height", "seat_height", "diameter"] },
      { type: "null" },
    ],
    description:
      "Which OVERALL dimension of the whole item this figure gives, if it gives one. " +
      "Null unless you can see that it does — a reveal, a radius, a component thickness, an arm height, a seat-only width " +
      "and a gap all take null, and null is a good answer. Use the page: a figure is the overall width when it is labelled " +
      "as one, or spans the whole item on a front or plan view; the depth spans it on a side or plan view; the height spans " +
      "it on a front or side view. 'seat_height' only for the height of a seat above the floor. Never choose a slot because " +
      "of how large the number is.",
  },
  slotEvidence: {
    type: ["string", "null"],
    maxLength: MAX_SHORT,
    description:
      "Why you gave this figure that slot, in a few words, quoting the page — \"labelled WIDTH on the specification table\", " +
      "\"spans the whole chair on the front elevation\", \"first of three in the printed line 80 x 70 x 90\". " +
      "Null when slot is null. A reviewer checks this against the drawing, so it must say what you SAW, not what you reasoned.",
  },
  isOverall: {
    type: "boolean",
    description:
      "True if this figure measures the whole item, false if it measures a part of it — a reveal, a radius, a gap, a rail, " +
      "a cushion thickness, an arm height. A shop drawing is mostly parts: S-200 prints 5, 50, 110 and 125 beside 840 and 790. " +
      "The card shows the overall figures and folds the parts away, so this decides what a reviewer reads first. " +
      "Every figure with a slot is overall; a figure can be overall without filling one of the five slots.",
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
                properties: { ...drawingObservationProperties, ...dimensionUnitProperty, ...dimensionSlotProperties },
                required: ["labelRaw", "valueRaw", "unitRaw", "slot", "slotEvidence", "isOverall"],
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
            dimensionsCombinedRaw: {
              type: "array",
              maxItems: MAX_PER_ITEM,
              description:
                "Any overall dimension printed as ONE line, copied VERBATIM ('80 x 70 x 90 cm', 'W1520 TBC x D560 x H1005 mm', " +
                "'Dia.460 x H450mm'), so a reviewer can check it against the page. " +
                "ALSO report each of its figures in `dimensions`, giving each one its slot and saying in `slotEvidence` which " +
                "part of the printed line it came from. You can see the order the page printed them in; this app cannot, and " +
                "when it used to assume one it read `80 x 70 x 90` as a 900mm-wide chair.",
              items: { type: "string", maxLength: MAX_VALUE },
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
            // WHERE the pictures of this item are, so one can be shown against
            // the record. The model reports every view it can see and which
            // kind each is; WHICH ONE to use is decided afterwards by
            // pickItemView(), in code, and the crop a human actually gets is
            // rendered in front of them before anything is saved.
            //
            // No "best" or "preferred" field, deliberately. That would be the
            // model making the choice, and this app's rule is that it reads and
            // decides nothing.
            viewRegions: {
              type: "array",
              maxItems: MAX_VIEW_REGIONS,
              description:
                "Every drawn view or photograph of this item on the page — a 3D view, a product photograph or render, front/side/plan elevations. Omit title blocks, logos, swatch chips, dimension-only details and anything that is not a picture of the item itself.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  viewType: {
                    type: "string",
                    enum: ["photo", "render", "3d", "front", "side", "back", "plan", "detail", "other"],
                    description:
                      "What this picture is. 'photo' for a photograph, 'render' for a CGI visual, '3d' for an isometric or perspective line drawing, then the named elevations. 'other' is an honest answer.",
                  },
                  page: { type: ["integer", "null"], minimum: 1, description: "1-based page the view is on." },
                  bbox: {
                    type: "array",
                    minItems: 4,
                    maxItems: 4,
                    items: { type: "number", minimum: 0, maximum: 1 },
                    description:
                      "Where it sits on that page as [x0, y0, x1, y1], each a FRACTION of the page from 0 to 1, origin top-left. Approximate is fine and far better than omitting the region: enclose the picture as tightly as you reasonably can, leaving out its caption, the dimension lines and any surrounding border.",
                  },
                },
                required: ["viewType", "page", "bbox"],
              },
            },
          },
          required: ["itemCodeRaw", "itemNameRaw", "page", "dimensions", "dimensionsCombinedRaw", "materials", "notesRaw", "confidence"],
        },
      },
      // ====================================================================
      // ONE ITEM DRAWN TWICE, OR TWO THINGS TO MAKE.
      //
      // The app used to answer this by COUNTING PAGES: a code appearing on two
      // pages became two configurations, `S-200 A` and `S-200 B`, and 0024 then
      // takes the bill line out of the export and ships the configurations as
      // separate BWS jobs. One armchair, two jobs, from a page count.
      //
      // It cannot be recovered by comparing strings afterwards, and that was
      // measured rather than assumed. Panther's S-200 states
      // `FABRIC REFERENCE = Tibor Blob Amber Fern` on its specification sheet
      // and `FABRIC / CLO003 A = Tibor Blob Amber Fern` on its shop drawing —
      // same chair, same cloth, two vocabularies. Comparing the codes calls it
      // a split; comparing the descriptions calls it a split too, because one
      // page adds "as per approved sample". Both miss the case a person gets
      // right in two seconds by looking at the pages.
      //
      // So the model says, and says why. `unclear` is a real answer and it
      // leaves the reviewer to decide — which is strictly better than a page
      // count deciding for them.
      // ====================================================================
      codeGroups: {
        type: "array",
        maxItems: MAX_DRAWING_ITEMS,
        description:
          "One entry for every item code you reported on MORE THAN ONE page. Omit a code drawn only once.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            itemCodeRaw: {
              type: "string",
              maxLength: MAX_SHORT,
              description: "The code, exactly as you reported it on those pages.",
            },
            pages: {
              type: "array",
              maxItems: MAX_VIEW_REGIONS,
              items: { type: "integer", minimum: 1 },
              description: "The 1-based pages carrying this code.",
            },
            relationship: {
              type: "string",
              enum: ["one_item", "configurations", "unclear"],
              description:
                "'one_item' when the pages describe the SAME piece of furniture in different ways — a specification sheet and " +
                "its shop drawing, an elevation and a section, a general view and a detail. This is the common case. " +
                "'configurations' ONLY when the pages are genuinely different things to manufacture: the same shape offered in " +
                "different fabrics or finishes, usually lettered or numbered by the document itself. " +
                "'unclear' when you cannot tell — a person will decide, and that is far better than a wrong guess, because " +
                "'configurations' makes this one item into several separate jobs.",
            },
            evidence: {
              type: "string",
              maxLength: MAX_SHORT,
              description:
                "What on the pages tells you that, quoting them — \"page 1 is the specification sheet and page 2 the shop " +
                "drawing of the same chair, both stating Tibor Blob Amber Fern\", \"the sheets are titled OPTION A and " +
                "OPTION B with different fabrics\".",
            },
          },
          required: ["itemCodeRaw", "pages", "relationship", "evidence"],
        },
      },
      documentNotes: {
        type: ["string", "null"],
        maxLength: MAX_NOTE,
        description: "One note about the drawing set as a whole: what it covers, pages you could not read, units if they ARE stated anywhere.",
      },
    },
    required: ["items", "codeGroups", "documentNotes"],
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
/**
 * The words the TOOL offers for a slot, and what this app calls them.
 *
 * The exact half of house convention 6: the model reports what the page shows a
 * figure to be, in plain words, and the mapping to `DIMENSION_SLOTS` — the
 * vocabulary `record_attributes_dimension_slot_check` enforces — happens here,
 * in code, where it is testable. The model is never shown `SH` or `DIA`.
 */
export const MODEL_SLOT_WORDS = ["width", "depth", "height", "seat_height", "diameter"] as const;
export type ModelSlotWord = (typeof MODEL_SLOT_WORDS)[number];

export const SLOT_FROM_MODEL: Record<ModelSlotWord, DimensionSlot> = {
  width: "W",
  depth: "D",
  height: "H",
  seat_height: "SH",
  diameter: "DIA",
};

/** The model's word as a slot, or null — including for anything unrecognised. */
export function slotFromModel(word: unknown): DimensionSlot | null {
  return typeof word === "string" && word in SLOT_FROM_MODEL ? SLOT_FROM_MODEL[word as ModelSlotWord] : null;
}

/**
 * `.catch(null)` / `.catch(false)` on the three new fields, and `.optional()`
 * on all of them, for the reason `unitRaw` has both.
 *
 * OPTIONAL IS NOT A CONCESSION, IT IS THE MIGRATION. Every run staged before
 * 2026-09-18 sits in `intake_runs.parsed` with no slot, no evidence and no
 * `isOverall`, and a required key would make each of those runs unreadable —
 * the review screen 500s on a pack somebody has already paid to read. Absent
 * means "staged before the model was asked", which `stageDrawings` handles by
 * falling back to the label vocabulary alone.
 *
 * A malformed value must also not fail a call that has already been paid for.
 * Losing one slot puts one amber row in front of a reviewer; failing the run
 * costs another call.
 */
export const RawDrawingDimension = RawDrawingObservation.extend({
  unitRaw: nullableText(MAX_SHORT).optional().catch(null),
  slot: z.enum(MODEL_SLOT_WORDS).nullable().catch(null).optional(),
  slotEvidence: nullableText(MAX_SHORT).optional().catch(null),
  // Defaults TRUE when absent, and that is deliberate: an old staged run has no
  // `isOverall`, and treating every one of its figures as a component would
  // fold an entire pack's dimensions out of sight. A new run always states it.
  isOverall: z.boolean().catch(true).optional(),
});

/**
 * Whether the pages carrying one code are one item or several things to make.
 *
 * `.catch("unclear")` on the relationship: a value this app does not recognise
 * must land on the answer that asks a person, never on `configurations`, which
 * is the one that turns an item into several BWS jobs.
 */
export const RawCodeGroup = z.object({
  itemCodeRaw: z.string().max(MAX_SHORT),
  pages: z.array(z.number().int().min(1).max(100_000)).max(MAX_VIEW_REGIONS).catch([]).default([]),
  relationship: z.enum(["one_item", "configurations", "unclear"]).catch("unclear").default("unclear"),
  evidence: nullableText(MAX_SHORT).catch(null).default(null),
});

export type RawCodeGroup = z.infer<typeof RawCodeGroup>;

export const RawDrawingMaterial = RawDrawingObservation.extend({
  materialCodeRaw: nullableText(MAX_SHORT),
});

/**
 * `.catch(...)` on every field: a malformed region should be DROPPED, not fail
 * an extraction that has already been paid for. A missing picture is a card
 * where the reviewer drags a box themselves; a failed run is another call.
 */
export const RawViewRegion = z.object({
  viewType: z
    .enum(["photo", "render", "3d", "front", "side", "back", "plan", "detail", "other"])
    .catch("other")
    .default("other"),
  page: z.number().int().min(1).max(100_000).nullable().catch(null).default(null),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().catch(null).default(null),
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
  // Same `.default([])` discipline as the arrays above, and for the same
  // reason: an over-long combined list must fail the extraction loudly rather
  // than stage a page as having no overall dimension at all.
  dimensionsCombinedRaw: z.array(z.string().max(MAX_VALUE)).max(MAX_PER_ITEM).default([]),
  notesRaw: z.array(z.string().max(MAX_VALUE)).max(MAX_PER_ITEM).default([]),
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null).default(null),
  // `.catch([])` HERE, unlike the observation arrays above, and the difference
  // is what each one costs when it goes wrong. Losing an over-long dimensions
  // array silently stages a page as having no dimensions, which nothing would
  // ever notice; losing the view regions stages a card with no picture
  // proposed, which is visible on screen and fixable by dragging a box.
  //
  // Optional in the INFERRED type as well, like `unitRaw`: most callers and
  // every fixture describe an item that proposes no picture, and making them
  // write `viewRegions: []` to say the ordinary thing is noise.
  viewRegions: z.array(RawViewRegion).max(MAX_VIEW_REGIONS).catch([]).optional(),
});

export type RawDrawingItem = z.infer<typeof RawDrawingItem>;
export type RawViewRegion = z.infer<typeof RawViewRegion>;
export type RawDrawingDimension = z.infer<typeof RawDrawingDimension>;
export type RawDrawingMaterial = z.infer<typeof RawDrawingMaterial>;
export type RawDrawingObservation = z.infer<typeof RawDrawingObservation>;

export const DrawingsOutput = z.object({
  items: z.array(RawDrawingItem).max(MAX_DRAWING_ITEMS),
  // `.catch([])` and optional, unlike `items`: a run staged before 2026-09-18
  // has none, and a malformed group must leave the grouping unstated rather
  // than fail a paid call. Unstated means the reviewer is asked, which is the
  // safe end of this particular question.
  codeGroups: z.array(RawCodeGroup).max(MAX_DRAWING_ITEMS).catch([]).optional(),
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
  | { outputKind: "observations"; tool: typeof SPEC_DOCUMENT_TOOL | typeof EMAIL_TOOL; schema: typeof ExtractionOutput }
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
  email: { outputKind: "observations", tool: EMAIL_TOOL, schema: ExtractionOutput },
  shop_drawings: { outputKind: "drawing_items", tool: DRAWINGS_TOOL, schema: DrawingsOutput },
  preamble: { outputKind: "preamble_notes", tool: PREAMBLE_TOOL, schema: PreambleOutput },
};

/** What a successful extraction returned, discriminated by the shape it is. */
export type ExtractionPayload =
  | { outputKind: "observations"; data: ExtractionOutput }
  | { outputKind: "drawing_items"; data: DrawingsOutput }
  | { outputKind: "preamble_notes"; data: PreambleOutput };
