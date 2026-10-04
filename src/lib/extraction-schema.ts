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

// ============================================================================
// A LIST THE MODEL WROTE AS A BARE VALUE — THE `itemCodes` PRECEDENT, APPLIED
// EVERYWHERE IT COSTS A CHARGED CALL.
//
// `itemCodes` came back as a string on one real document, `z.array()` refused
// it, and a read that had already been PAID FOR went terminal with "Expected
// array, received string" — over a grouping hint. The lesson was written down
// beside that one field and nowhere else, so an audit of every optional field
// (Stage 2 variance row 2) found five more arrays with the same shape and the
// same cost: `dimensions`, `materials`, `dimensionsCombinedRaw`, `notesRaw`,
// and the flat `proposals` / `notes` lists. Every scalar and every enum in
// these schemas already degrades to null; the arrays did not.
//
// THE RULE, AND WHERE IT STOPS. A bare value is read as a ONE-ENTRY LIST
// wherever the element can hold it WITHOUT INVENTING ANYTHING: a list of
// strings holds it as its own entry, and a list of observations holds it as the
// VALUE of an unlabelled one — which is a shape both screens already render
// (`Dimension 3`, a proposal with no attribute), so the reviewer sees the
// wording with no claim attached to it. That is the flag: a row nobody can
// mistake for a resolved reading.
//
// `items` is deliberately NOT lenient. A drawing item is a CONTAINER — a code,
// a page and the observations under it — not an observation, so a string could
// only become one by naming it something, and `items` being a string is a
// failure to answer the tool rather than one malformed hint inside an answer.
// The same goes for an over-long array, which still fails loudly: staging a
// 41-dimension page as a page with none is the silent loss the bound exists to
// prevent.
//
// A NULL ELEMENT IS DROPPED, because there is nothing in it to keep. Anything
// else that is not the element's shape stays terminal and reported.
// ============================================================================
function bareValuesAsList(wrap: (scalar: string) => unknown) {
  return (value: unknown): unknown => {
    // Passed through untouched, so a REQUIRED array is still required: turning
    // an absent `proposals` into an empty one would report "the document says
    // nothing" for a model that failed to answer at all.
    if (value === undefined || value === null) return value;
    const list = Array.isArray(value) ? value : [value];
    return list
      .filter((entry) => entry !== null && entry !== undefined)
      .map((entry) =>
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
          ? wrap(String(entry))
          : entry,
      );
  };
}

/** A list of strings that survives being written as one string. */
const looseTextList = (max: number, maxItems: number) =>
  z.preprocess(bareValuesAsList((scalar) => scalar), z.array(z.string().max(max)).max(maxItems)).default([]);

/**
 * The same rule for a list whose element CANNOT hold a bare value.
 *
 * `bareValuesAsList` keeps a scalar by wrapping it, because a dimension or a
 * proposal has an obvious place to put one — the value, with nothing else
 * claimed. A VIEW REGION has none: it is a box on a page, and a string is not a
 * box, so wrapping one would have to invent a page or a bbox. A CODE GROUP has
 * none either: it is a statement that these pages are one item or several, and
 * a bare code carries no such statement.
 *
 * So the entry is DROPPED and its siblings are kept, which is the half that
 * was missing. Both arrays sat behind `.catch([])` on the WHOLE list, so one
 * malformed entry threw away every good one beside it — three usable view
 * regions lost because a fourth came back as a string. Survivable (the card
 * proposes no picture and the item stays whole) and recoverable, and it was
 * not being recovered.
 *
 * The `.catch([])` STAYS behind this, for the case it was actually written
 * for: an over-long array. What it can no longer be reached by is one bad
 * entry.
 */
function objectEntriesAsList(value: unknown): unknown {
  // Untouched, so an absent optional array stays absent rather than becoming
  // an empty one that claims the model answered.
  if (value === undefined || value === null) return value;
  const list = Array.isArray(value) ? value : [value];
  return list.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry));
}

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
  // Lenient about SHAPE, still required to be present. A bare string becomes
  // one observation carrying it as the value, with no attribute and no ref —
  // which the review screen already renders as "choose which record and
  // question this belongs to".
  proposals: z.preprocess(
    bareValuesAsList((scalar) => ({ valueRaw: scalar })),
    z.array(RawProposal).max(MAX_PROPOSALS),
  ),
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
// A page naming its own configurations names a handful: S-301's sheet names
// five room types. Thirty is generous and still bounded.
export const MAX_CONFIGURATIONS = 30;

const drawingObservationProperties = {
  labelRaw: {
    type: ["string", "null"],
    maxLength: MAX_SHORT,
    description:
      "The drawing's own label for this, exactly as written ('SOFA FEET', 'FABRIC', 'Width', 'PIPING'). Null if the drawing gives none. " +
      "Never add a configuration to the label: 'FABRIC REFERENCE', not 'FABRIC REFERENCE - Type 2'.",
  },
  valueRaw: {
    type: ["string", "null"],
    maxLength: MAX_VALUE,
    description:
      "The value exactly as written, including 'TBC' where the drawing says so. For a dimension, the figure alone ('190'). Never add a unit the drawing does not print.",
  },
};

// ============================================================================
// WHICH CONFIGURATIONS A ROW BELONGS TO — READ OFF THE PAGE (schemaVersion 3).
//
// Panther's S-301 sheet prints ONE fabric line per room type under one heading
// ("FABRIC REFERENCE  As per room type: Type 1 & 5 - …, Type 2 - …") beside ONE
// set of overall dimensions. The model read it correctly and the tool had
// nowhere to put it, so it welded the type into each row's LABEL and the app
// then handed the four lines COM 1, COM 2 and COM 3 of ONE record — one chair
// with three fabrics, where the sheet describes five chairs with one each.
//
// Which configuration a line is about is a thing a person answers by looking
// at the page, so under house convention 6 it is the model's to read and
// report. What this app CALLS a configuration — the folded name it stores in
// `spec_records.variant_label` — is resolved afterwards, in code.
//
// EMPTY IS THE COMMON ANSWER: a row shared by every configuration the page
// shows (the geometry, a shared frame finish) carries none.
// ============================================================================
const observationConfigurationsProperty = {
  configurations: {
    type: "array",
    maxItems: MAX_CONFIGURATIONS,
    items: { type: "string", maxLength: MAX_SHORT },
    description:
      "The configurations this row applies to, by the `name` you gave them in the item's `configurations`. " +
      "Empty when the row is shared by every configuration the page shows — the overall dimensions, a frame finish " +
      "common to all of them — and when the page names no configurations at all, which is the usual case. " +
      "A line reading 'Type 1 & 5 - <fabric>' is ONE row with ['Type 1', 'Type 5'].",
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
                properties: {
                  ...drawingObservationProperties,
                  ...dimensionUnitProperty,
                  ...dimensionSlotProperties,
                  ...observationConfigurationsProperty,
                },
                required: ["labelRaw", "valueRaw", "unitRaw", "slot", "slotEvidence", "isOverall", "configurations"],
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
                  ...observationConfigurationsProperty,
                },
                required: ["labelRaw", "valueRaw", "materialCodeRaw", "configurations"],
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
            configurations: {
              type: "array",
              maxItems: MAX_CONFIGURATIONS,
              description:
                "The configurations of this item that THIS PAGE NAMES — room types, options, versions the document itself " +
                "lists ('As per room type: Type 1 & 5 - …, Type 2 - …', 'OPTION A / OPTION B', a title block 'MUR 1 & TYPO 5'). " +
                "ONE entry per configuration: a line naming two ('Type 1 & 5') gives two entries, 'Type 1' and 'Type 5'. " +
                "Empty when the page names none, which is the usual case.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: {
                    type: "string",
                    maxLength: MAX_SHORT,
                    description:
                      "ONE configuration, in the PAGE'S OWN WORDS ('MUR 1', 'TYPO 5', 'Type 2', 'Option B') — never translated " +
                      "into another vocabulary. Only where this same document's specification sheet and shop drawing name one " +
                      "configuration differently ('Type 5' and 'TYPO 5' for the same chair) use the sheet's name on both.",
                  },
                  nameRaw: {
                    type: ["string", "null"],
                    maxLength: MAX_SHORT,
                    description: "The page's own words for it, exactly as printed ('Type 1 & 5', 'TYPO 5', 'OPTION B').",
                  },
                  evidence: {
                    type: ["string", "null"],
                    maxLength: MAX_NOTE,
                    description:
                      "Where on the page it is named, quoting it — \"FABRIC REFERENCE: As per room type: Type 1 & 5 - …\", " +
                      "\"title block reads MUR 1 & TYPO 5 DESK CHAIR\".",
                  },
                },
                required: ["name", "nameRaw", "evidence"],
              },
            },
            depictsConfigurations: {
              type: "array",
              maxItems: MAX_CONFIGURATIONS,
              items: { type: "string", maxLength: MAX_SHORT },
              description:
                "Which of this item's configurations THIS PAGE SHOWS, by `name`, when the page itself says so — a shop " +
                "drawing titled 'MUR 1 & TYPO 5 DESK CHAIR' shows Type 1 and Type 5 only. Empty when the page does not " +
                "restrict itself to some of them. A title block naming rooms counts only where the pages differ in " +
                "specification; where nothing differs, leave this empty.",
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
          required: [
            "itemCodeRaw",
            "itemNameRaw",
            "page",
            "dimensions",
            "dimensionsCombinedRaw",
            "materials",
            "notesRaw",
            "confidence",
            "configurations",
            "depictsConfigurations",
          ],
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
          "One entry for every item you reported on MORE THAN ONE page, INCLUDING an item whose pages title it differently. " +
          "Omit an item that appears on one page only.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            itemCodes: {
              type: "array",
              minItems: 1,
              maxItems: MAX_VIEW_REGIONS,
              items: { type: "string", maxLength: MAX_SHORT },
              description:
                "Every code or title you reported for this item, exactly as reported, FIRST the one a client's bill of " +
                "quantities would use. Pages often title one item differently — a specification sheet headed 'S-200' and " +
                "its shop drawing headed 'MUR.2 ARMCHAIR' in the title block are the same chair, and the bill says S-200. " +
                "List both; put S-200 first.",
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
                "its shop drawing, an elevation and a section, a general view and a detail. This is the common case, and it " +
                "stays the answer when the item comes in several configurations that a page itself lists ('as per room type: " +
                "Type 1 … Type 5'): those go in the items' `configurations`, and this field describes only the PAGES. " +
                "'configurations' ONLY when the pages are genuinely different things to manufacture: the same shape offered in " +
                "different fabrics or finishes, usually lettered or numbered by the document itself. " +
                "'unclear' when you cannot tell — a person will decide, and that is far better than a wrong guess, because " +
                "'configurations' makes this one item into several separate jobs.",
            },
            evidence: {
              type: "string",
              // MAX_NOTE, not MAX_SHORT. This is the sentence that decides
              // whether one armchair becomes one BWS job or several, and a
              // reviewer settles it by reading it against two pages -- so it
              // has to be allowed to name both pages, what each is, and what
              // they agree about. The first real read wrote 480 characters
              // doing exactly that and `MAX_SHORT` (300) threw it away.
              maxLength: MAX_NOTE,
              description:
                "What on the pages tells you that, quoting them — \"page 1 is the specification sheet and page 2 the shop " +
                "drawing of the same chair, both stating Tibor Blob Amber Fern\", \"the sheets are titled OPTION A and " +
                "OPTION B with different fabrics\".",
            },
          },
          // `itemCodes`, the property this object actually declares. The list
          // named `itemCodeRaw` from before the field became plural — a
          // required key the object forbids — until 2026-09-23.
          required: ["itemCodes", "pages", "relationship", "evidence"],
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
  // schemaVersion 3. OPTIONAL in the inferred type, like `unitRaw`: almost no
  // row names a configuration, and every fixture and every staged run before
  // 2026-09-23 describes a row that names none. `.catch([])` because a
  // malformed hint must never fail a read that has already been paid for —
  // the row is kept and reads as shared, which the card shows.
  configurations: looseTextList(MAX_SHORT, MAX_CONFIGURATIONS).catch([]).optional(),
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
  // PLURAL, and the first is the one the bill would use. A group's pages
  // routinely title one item differently -- Panther's S-200 is headed `S-200`
  // on its specification sheet and `MUR.2 ARMCHAIR` in the shop drawing's
  // title block -- so a single code cannot name the group, and asking for one
  // produced the compound string "S-200 / MLR 2 ARMCHAIR", which matched
  // neither page.
  //
  // A BARE STRING IS ACCEPTED, AND THAT IS NOT LENIENCE FOR ITS OWN SAKE. The
  // strict version cost a charged call: the S-100 read returned
  // `itemCodes: "S-100"`, the whole extraction failed validation with "Expected
  // array, received string", and the run went terminal with nothing staged —
  // over a grouping hint, on a document that had already been read and paid
  // for. `.catch([])` behind it drops a group nothing can make sense of, which
  // leaves the item whole and asks a person: the safe end of this question.
  itemCodes: z
    .preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(z.string().max(MAX_SHORT)).min(1).max(MAX_VIEW_REGIONS),
    )
    .catch([]),
  pages: z.array(z.number().int().min(1).max(100_000)).max(MAX_VIEW_REGIONS).catch([]).default([]),
  relationship: z.enum(["one_item", "configurations", "unclear"]).catch("unclear").default("unclear"),
  // `.catch(null)` keeps a paid run alive when the evidence is malformed, and
  // it is also how the best output of the first real read was silently lost:
  // the model wrote 480 useful characters, the bound was 300, and the row
  // arrived with `evidence: null` and nothing anywhere saying why. The bound is
  // the fix; the catch stays, because failing a charged call over a sentence
  // costs more than losing the sentence.
  evidence: nullableText(MAX_NOTE).catch(null).default(null),
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

/**
 * One configuration a page names, as the model read it.
 *
 * A BARE STRING IS A CONFIGURATION WITH ONLY A NAME — the element can hold it
 * without inventing anything, which is `bareValuesAsList`'s rule. An entry with
 * no usable name is dropped by `.catch` on the list's entry, never by failing
 * the read.
 */
export const RawConfiguration = z.object({
  name: z.string().trim().min(1).max(MAX_SHORT),
  nameRaw: nullableText(MAX_SHORT),
  evidence: nullableText(MAX_NOTE),
});

export type RawConfiguration = z.infer<typeof RawConfiguration>;

/** A configuration list that survives a bare string, a null entry and a nameless entry. */
const configurationList = z
  .preprocess(
    (value) => {
      const listed = bareValuesAsList((scalar) => ({ name: scalar, nameRaw: scalar, evidence: null }))(value);
      if (!Array.isArray(listed)) return listed;
      // An entry that is not a configuration is DROPPED and its siblings kept —
      // `objectEntriesAsList`'s rule, for the same reason: one bad entry must
      // not throw away four good ones beside it.
      return listed.filter((entry) => RawConfiguration.safeParse(entry).success);
    },
    z.array(RawConfiguration).max(MAX_CONFIGURATIONS),
  )
  .catch([])
  .optional();

/**
 * How a configuration name is compared: case and whitespace, and nothing else.
 *
 * The same fold `normaliseVariantLabel` (record-variants.ts) stores, repeated
 * here rather than imported so this schema module stays a leaf. Anything
 * cleverer — reading `TYPO 5` as `Type 5` — is the model's job on the page, not
 * a string rule afterwards.
 */
const foldConfigurationName = (name: string) => name.trim().replace(/\s+/g, " ").toUpperCase();

const RawDrawingItemShape = z.object({
  itemCodeRaw: nullableText(MAX_SHORT),
  itemNameRaw: nullableText(MAX_SHORT),
  page: z.number().int().min(1).max(100_000).nullable().catch(null).default(null),
  // STILL NOT `.catch([])`: that turns an over-long array into an EMPTY one, so
  // a page with 41 dimensions would stage as a page with none and nothing
  // anywhere would say so. A schema failure is terminal and reported.
  //
  // What `bareValuesAsList` adds is the other half of that trade: a figure the
  // model wrote as a bare string, or one bad entry beside forty good ones, no
  // longer kills a charged read. The figure is kept, unlabelled, and the
  // reviewer reads it off the card.
  dimensions: z
    .preprocess(
      bareValuesAsList((scalar) => ({ labelRaw: null, valueRaw: scalar })),
      z.array(RawDrawingDimension).max(MAX_PER_ITEM),
    )
    .default([]),
  materials: z
    .preprocess(
      bareValuesAsList((scalar) => ({ labelRaw: null, valueRaw: scalar, materialCodeRaw: null })),
      z.array(RawDrawingMaterial).max(MAX_PER_ITEM),
    )
    .default([]),
  dimensionsCombinedRaw: looseTextList(MAX_VALUE, MAX_PER_ITEM),
  notesRaw: looseTextList(MAX_VALUE, MAX_PER_ITEM),
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
  //
  // `objectEntriesAsList` in front of it so ONE malformed region no longer
  // takes its siblings with it. A region cannot hold a bare value, so a
  // non-object entry is dropped rather than wrapped; the `.catch([])` behind
  // it is still there for the over-long case it was written for.
  viewRegions: z
    .preprocess(objectEntriesAsList, z.array(RawViewRegion).max(MAX_VIEW_REGIONS))
    .catch([])
    .optional(),
  // schemaVersion 3: the configurations the page NAMES, and which of them it
  // SHOWS. Optional in the inferred type for the reason `viewRegions` is.
  configurations: configurationList,
  depictsConfigurations: looseTextList(MAX_SHORT, MAX_CONFIGURATIONS).catch([]).optional(),
});

/**
 * A NAME THE PAGE DID NOT GIVE IS DROPPED FROM A ROW, AND THE ROW IS KEPT.
 *
 * A row names configurations by the `name` the page gave them — in its
 * `configurations`, or in `depictsConfigurations`, which is the page naming the
 * ones it shows (a title block `MUR 1 & TYPO 5`). One that matches neither is
 * a reading this app cannot place — so the NAME goes and the row stays,
 * reading as shared, which is what the card then shows a reviewer. Failing the
 * read would lose every other row on the page over one word; keeping the name
 * would invent a configuration nothing on the page lists.
 *
 * `depictsConfigurations` itself is kept as read: it IS the page naming them.
 * Duplicates (the same folded name twice) collapse to the first.
 */
export const RawDrawingItem = RawDrawingItemShape.transform((item) => {
  const configurations: RawConfiguration[] = [];
  const known = new Set<string>();
  for (const entry of item.configurations ?? []) {
    const folded = foldConfigurationName(entry.name);
    if (known.has(folded)) continue;
    known.add(folded);
    configurations.push(entry);
  }
  const distinct = (names: readonly string[] | undefined, allowed: ReadonlySet<string> | null) => {
    const kept: string[] = [];
    for (const name of names ?? []) {
      const folded = foldConfigurationName(name);
      if (folded === "" || (allowed && !allowed.has(folded))) continue;
      if (kept.some((entry) => foldConfigurationName(entry) === folded)) continue;
      kept.push(name);
    }
    return kept;
  };
  const depicts = distinct(item.depictsConfigurations, null);
  for (const name of depicts) known.add(foldConfigurationName(name));
  const keepKnown = (names: readonly string[] | undefined) => distinct(names, known);
  const withRowNames = <T extends { configurations?: string[] }>(row: T): T =>
    row.configurations === undefined ? row : { ...row, configurations: keepKnown(row.configurations) };
  return {
    ...item,
    dimensions: item.dimensions.map(withRowNames),
    materials: item.materials.map(withRowNames),
    ...(item.configurations === undefined ? {} : { configurations }),
    ...(item.depictsConfigurations === undefined ? {} : { depictsConfigurations: depicts }),
  };
});

export type RawDrawingItem = z.infer<typeof RawDrawingItem>;
export type RawViewRegion = z.infer<typeof RawViewRegion>;
export type RawDrawingDimension = z.infer<typeof RawDrawingDimension>;
export type RawDrawingMaterial = z.infer<typeof RawDrawingMaterial>;
export type RawDrawingObservation = z.infer<typeof RawDrawingObservation>;

export const DrawingsOutput = z.object({
  // TERMINAL ON PURPOSE, and the one array `bareValuesAsList` is not applied
  // to. An item is a container — a code, a page and the observations under it —
  // so a bare string could only become one by naming it something, and `items`
  // arriving as a string is a failure to answer the tool rather than one
  // malformed hint inside an answer.
  items: z.array(RawDrawingItem).max(MAX_DRAWING_ITEMS),
  // `.catch([])` and optional, unlike `items`: a run staged before 2026-09-18
  // has none, and a malformed group must leave the grouping unstated rather
  // than fail a paid call. Unstated means the reviewer is asked, which is the
  // safe end of this particular question.
  //
  // `objectEntriesAsList` in front of it for the same reason as `viewRegions`:
  // ONE malformed group used to leave the WHOLE document ungrouped, so a
  // second page that names its item differently stopped being read as the same
  // item. A bare entry is dropped rather than wrapped — a code on its own is
  // not a statement about a relationship, and `relationship` would default to
  // `unclear`, which letters nothing, so keeping it would add a group that
  // says nothing while implying the model grouped something.
  codeGroups: z
    .preprocess(objectEntriesAsList, z.array(RawCodeGroup).max(MAX_DRAWING_ITEMS))
    .catch([])
    .optional(),
  documentNotes: nullableText(MAX_NOTE),
});

export type DrawingsOutput = z.infer<typeof DrawingsOutput>;

// ============================================================================
// THE ITEM-CENTRIC READ (staged schemaVersion 4, 2026-10-04).
//
// Everything above asks for ONE ENTRY PER ITEM PER PAGE, every figure on that
// page (seven required fields each, up to 120), and a separate `codeGroups` to
// say which pages belong together — and a dozen helpers then glue the pages
// back together and second-guess the model (`canonicalCode`,
// `groupItemsByCode`, `variantLettersByItem`, `crossPageClaims`, the
// cross-view de-duplication, the magnitude vote). Max, 2026-10-04: the read
// "is structured around the page", so every real-world nuance — an item drawn
// over two pages, a codeless continuation sheet, a title block naming the item
// differently from the bill — became another piece of glue, "and there are
// endless issues that arise from it".
//
// This asks the real question once: WHAT ARE THE THINGS TO BE MADE, AND WHAT
// DOES THE DOCUMENT SAY ABOUT EACH. An item spans whatever pages describe it.
// Its overall size is FIVE SLOTS, one figure each by the SHAPE of the answer,
// with the view and page each came from and every rival figure the model saw
// kept beside it as a candidate — so "two of these are the width" cannot be
// produced, and a choice the model made between two figures is shown rather
// than silently taken. Everything else the page measures is kept, secondary.
// A doubt is said in words (`uncertain`) instead of being silent.
//
// The prompt that matches it is `PROMPTS.shop_drawings` in anthropic.ts, and
// it was trialled on six real documents before it was written here.
//
// SAME TOLERANCE AS EVERYTHING ABOVE: never fail a paid read over a hint. A
// bare value is a one-entry list where the element can hold it; a malformed
// entry is dropped and its siblings kept; a malformed scalar degrades to null.
// ONE DEPARTURE, and it is deliberate: an OVER-LONG list is TRUNCATED and
// SAID, not refused. Version 3 failed the read on a 121st figure because a
// silently truncated list stages a page as having fewer figures than it
// prints; here every list past its bound keeps its first N entries AND adds an
// `uncertain` line saying how many were dropped, so the loss is on the card in
// words. Everything this read lists past the overall size is secondary by
// construction (the prompt says the other dimensions "may be partial"), and a
// read that has said what it lost is worth more than a failed one.
// `items` stays terminal, for the reason it always was.
// ============================================================================

export const DRAWINGS_ITEMS_TOOL_NAME = "record_items_to_make";

/** Every code one item may be titled by. A handful in practice: S-200 and MUR.2 ARMCHAIR. */
export const MAX_ITEM_CODES = 12;
/** The pages one item may span. A configuration sheet set can run to a dozen; this is generous. */
export const MAX_ITEM_PAGES = 60;
/** The rival figures one slot may list. */
export const MAX_SLOT_CANDIDATES = 12;
/** A detailed specification sheet is the richest source an item will ever have: take it all in. */
export const MAX_STATEMENTS = 200;
/** The doubts one item may state. */
export const MAX_UNCERTAIN = 40;

/** The words `uncertain.about` may take. Anything else reads as `other`. */
export const UNCERTAIN_ABOUT = [
  "width",
  "depth",
  "height",
  "seatHeight",
  "diameter",
  "grouping",
  "configurations",
  "finish",
  "code",
  "conflict",
  "other",
] as const;
export type UncertainAbout = (typeof UNCERTAIN_ABOUT)[number];

/** The five overall slots, as the read names them. `MODEL_SLOT_WORDS` above is the v3 spelling. */
export const OVERALL_KEYS = ["width", "depth", "height", "seatHeight", "diameter"] as const;
export type OverallKey = (typeof OVERALL_KEYS)[number];

export const OVERALL_SLOT: Record<OverallKey, DimensionSlot> = {
  width: "W",
  depth: "D",
  height: "H",
  seatHeight: "SH",
  diameter: "DIA",
};

/** The picture kinds the read may report. `section` is new in version 4. */
export const PICTURE_KINDS = ["photo", "render", "3d", "front", "side", "back", "plan", "section", "detail", "other"] as const;

// ============================================================================
// SIXTEEN UNIONS AND A GRAMMAR BUDGET — WHY THE SHAPE IS NOT THE DRAFT'S.
//
// Structured outputs compiles the schema into a grammar, and refuses two kinds
// of schema with a 400, before a token is read (measured 2026-10-04, each
// refusal free):
//   1. more than SIXTEEN union-typed parameters (a nullable type or an
//      `anyOf`), counted per LOCATION. The draft's shape — five nullable slot
//      objects with nullable fields, again per configuration — was 62. The v3
//      tool is exactly 16.
//   2. "The compiled grammar is too large". Descriptions, integer and number
//      types made no difference; the number of PROPERTY SLOTS did. Counted the
//      way the test counts them, v3 is 35, 43 was accepted, 47 was refused.
//
// So the shape is FLAT where the draft nested, and keeps every question:
//   * `overall` is a LIST of slot entries (`slot` an enum), at most one per
//     slot; a slot the page does not print is absent. A configuration's own
//     size is an entry naming the configuration, not a second `overall`.
//   * a figure carries its printed unit IN `valueRaw` ("840 mm"), the way
//     `splitFigureAndUnit` already reads one; a candidate is one line,
//     "740 (SIDE ELEVATION, page 2)"; a doubt is "width: …"; a non-item page
//     is "3: general notes".
//   * a plain remark is a statement with an EMPTY label; `mockup` is the quoted
//     evidence or empty; a swatch is `swatchBox` on the callout's page.
//   * every optional text is a plain string, EMPTY for none; the only unions
//     left are a finish's `part`, `spec` and `code`, where null means "not
//     printed" and the library supplies the words.
// The Zod check reads the flat shape back into the nested one staging reads
// (`itemFromSchemaShape`, `overallAsSlots`, `blankText`), and reads the
// draft's nested shape too. `tests/lib/extraction-schema.test.ts` counts both
// limits for every tool.
// ============================================================================
const blankString = (max: number, description: string) => ({ type: "string", maxLength: max, description });
const pageNumber = (description: string) => ({ type: "integer", minimum: 1, description });
const pageBox = (description: string) => ({
  type: "array",
  minItems: 4,
  maxItems: 4,
  items: { type: "number", minimum: 0, maximum: 1 },
  description,
});

const candidateProperties = {
  valueRaw: { type: "string", maxLength: MAX_SHORT, description: "The figure exactly as printed, marks and all ('840', '5'-7\"')." },
  unitRaw: blankString(MAX_SHORT, "The unit only if the page prints it beside this figure ('mm', 'cm'). Empty otherwise; never inferred."),
  view: blankString(MAX_SHORT, "The view it is printed on, in the page's own words ('ELEVATION 1', 'SECTION A', 'PLAN'). Empty if none."),
  page: pageNumber("1-based page it is printed on."),
};

/** The overall size: one entry per slot the page prints, at most one per slot. */
const overallSchema = (description: string) => ({
  type: "array",
  maxItems: OVERALL_KEYS.length,
  description,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      slot: {
        type: "string",
        enum: [...OVERALL_KEYS],
        description:
          "width: side to side as seen from the front (a plan or front elevation; never a side elevation or a section). " +
          "depth: front to back. height: floor to the highest point as drawn. seatHeight: seating only, floor to seat top " +
          "(on a bench, stool or ottoman you sit on the top of, the overall height). diameter: round items only, instead of width and depth.",
      },
      valueRaw: {
        type: "string",
        maxLength: MAX_SHORT,
        description:
          "The figure exactly as printed, marks and all, with its unit ONLY where the page prints one beside it ('840', '840 mm', '5'-7\"'). Never inferred.",
      },
      view: candidateProperties.view,
      page: candidateProperties.page,
      evidence: {
        type: "string",
        maxLength: MAX_NOTE,
        description:
          "Which view it is on and what printed it, quoting the page — \"ELEVATION 1, the dimension spanning the full front\", " +
          "\"labelled WIDTH 550MM on the specification table\"; for height, what it is to. A reviewer checks this against the drawing.",
      },
      candidates: {
        type: "array",
        maxItems: MAX_SLOT_CANDIDATES,
        description:
          "Every OTHER figure that could be this slot and that you did not choose (a different view printing a different figure, " +
          "a shop drawing disagreeing with the specification sheet), one entry each written as figure (view, page): " +
          "\"740 (SIDE ELEVATION, page 2)\". Empty when no other view disagrees.",
        items: { type: "string", maxLength: MAX_SHORT },
      },
      configurations: {
        type: "array",
        maxItems: MAX_CONFIGURATIONS,
        items: { type: "string", maxLength: MAX_SHORT },
        description:
          "EMPTY for the item's own size, which is the usual case. Only where a configuration's size DIFFERS: an entry of its own " +
          "naming that configuration (by its `name`), beside the item's entry for the same slot.",
      },
    },
    required: ["slot", "valueRaw", "view", "page", "evidence", "candidates", "configurations"],
  },
});

const configurationNamesSchema = {
  type: "array",
  maxItems: MAX_CONFIGURATIONS,
  items: { type: "string", maxLength: MAX_SHORT },
  description:
    "Which of the item's configurations this applies to, by the `name` you gave them. Empty when it applies to every configuration, " +
    "and when the item has none — which is the usual case.",
};

export const DRAWINGS_ITEMS_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    documentNotes: blankString(
      MAX_NOTE,
      "One note about the document as a whole: what it covers, general notes printed on every sheet, units if they ARE stated anywhere, pages you could not read. Empty if nothing.",
    ),
    nonItemPages: {
      type: "array",
      maxItems: MAX_DRAWING_ITEMS,
      description: "Every page that describes no item at all — a cover, a legend, general notes — with the reason.",
      items: { type: "string", maxLength: MAX_SHORT, description: "The page number, a colon, and what the page is: \"3: general notes only\"." },
    },
    items: {
      type: "array",
      maxItems: MAX_DRAWING_ITEMS,
      description: "One entry per THING TO BE MADE — not per page. An item may span several pages; a page may hold several items.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          codes: {
            type: "array",
            maxItems: MAX_ITEM_CODES,
            items: { type: "string", maxLength: MAX_SHORT },
            description:
              "Every code the item is titled by: the item code as the title prints it FIRST ('FUR-33', 'S-200'), other titles after it " +
              "('MUR.2 ARMCHAIR'), and a drawing or sheet number ('AM-ID-PL-FUR-33') LAST. Empty only when nothing titles it.",
          },
          name: blankString(MAX_SHORT, "What the document calls the item ('Desk', 'Armchair'), from a title block or caption. Empty if none."),
          pages: {
            type: "array",
            maxItems: MAX_ITEM_PAGES,
            items: { type: "integer", minimum: 1 },
            description: "Every 1-based page that describes this item.",
          },
          whyOneItem: blankString(
            MAX_NOTE,
            "Where the item spans more than one page or carries more than one code: what tied them together, quoting the pages. Empty otherwise.",
          ),
          overall: overallSchema(
            "The item's overall size read off the page: AT MOST ONE entry per slot, the figure that measures the whole item. " +
              "Leave a slot out when the page does not print it — never add parts together and never estimate.",
          ),
          combinedLine: blankString(
            MAX_VALUE,
            "A size printed as ONE line ('80 x 70 x 90 cm', 'W1520 x D560 x H1005 mm'), copied verbatim. Empty where there is none.",
          ),
          configurations: {
            type: "array",
            maxItems: MAX_CONFIGURATIONS,
            description:
              "Only where the document itself tells variants of the item apart ('Type 1 – 5', 'Option A / B', a fabric per room type). " +
              "One entry per configuration: 'Type 1 & 5' is two. Empty for one item drawn for two rooms with nothing different — the usual case.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: {
                  type: "string",
                  maxLength: MAX_SHORT,
                  description:
                    "This configuration's own label in the document's words ('Type 2', 'MUR 1'). Where the specification sheet and the shop drawing " +
                    "name one configuration differently ('Type 5' / 'TYPO 5'), the sheet's name.",
                },
                nameRaw: { type: "string", maxLength: MAX_SHORT, description: "The exact printed text it came from ('Type 1 & 5 - <fabric>')." },
                differsIn: { type: "string", maxLength: MAX_NOTE, description: "What differs between this configuration and the others." },
              },
              required: ["name", "nameRaw", "differsIn"],
            },
          },
          finishes: {
            type: "array",
            maxItems: MAX_PER_ITEM,
            description: "Each distinct finish, material, fabric or hardware callout, once, even if several views point to it.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                part: { type: ["string", "null"], maxLength: MAX_SHORT, description: "The PART it names ('SOFA FEET', 'TOP'), or null where the page names none." },
                spec: {
                  type: ["string", "null"],
                  maxLength: MAX_VALUE,
                  description:
                    "The SPECIFICATION as printed ('Dark tinted wood', 'Antique bronze'), or null where only a code is printed. Never describe a code in your own words.",
                },
                code: { type: ["string", "null"], maxLength: MAX_SHORT, description: "The client's own finish code where one is printed ('GR TIM 04', 'UPH-07'). Null otherwise." },
                configurations: configurationNamesSchema,
                page: pageNumber("1-based page the callout is on."),
                swatchBox: {
                  type: "array",
                  maxItems: 4,
                  items: { type: "number", minimum: 0, maximum: 1 },
                  description:
                    "Where the finish is shown as a printed swatch chip or material photo on the callout's page, that chip as [x0, y0, x1, y1], " +
                    "fractions of the page from 0 to 1, origin top-left; approximate is fine. EMPTY when no chip is printed there.",
                },
              },
              required: ["part", "spec", "code", "configurations", "page", "swatchBox"],
            },
          },
          statements: {
            type: "array",
            maxItems: MAX_STATEMENTS,
            description:
              "Every labelled line of a specification table, schedule or remarks block that is not already a size or a finish above, " +
              "label and value as printed ('FILLING: Feather wrap', 'LEAD TIME: 12 weeks'). Take in everything. A remark with no label " +
              "of its own — any other note about THIS item, one per remark or bullet — is an entry with an EMPTY label.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string", maxLength: MAX_SHORT, description: "The line's label as printed ('FILLING'), or empty for a plain remark." },
                value: { type: "string", maxLength: MAX_VALUE, description: "Its value as printed ('Feather wrap')." },
                page: pageNumber("1-based page."),
                configurations: configurationNamesSchema,
              },
              required: ["label", "value", "page", "configurations"],
            },
          },
          mockup: blankString(
            MAX_SHORT,
            "ONLY where the page itself says the drawing is for a mock-up (a title block reading MOCKUP ROOM, a drawing number with a MUR segment, " +
              "'(MUR)' in the title): what printed it, quoted. EMPTY otherwise, which is the usual case.",
          ),
          otherDimensions: {
            type: "array",
            maxItems: MAX_PER_ITEM,
            description:
              "Every other dimension on the item, briefly — kept for reference and folded away. On a dense sheet this may be partial; say so in uncertain.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: blankString(
                  MAX_SHORT,
                  "The page's label for it and the view it is on, in the page's words ('ARM HEIGHT, SECTION B'), or empty.",
                ),
                valueRaw: {
                  type: "string",
                  maxLength: MAX_SHORT,
                  description: "The figure exactly as printed, with its unit only where the page prints one beside it ('620', '620 mm', '1'-6\"').",
                },
                page: pageNumber("1-based page."),
              },
              required: ["label", "valueRaw", "page"],
            },
          },
          pictures: {
            type: "array",
            maxItems: MAX_VIEW_REGIONS,
            description: "Every drawn view or photo OF THE ITEM. Not swatch chips, title blocks or logos. An approximate box is wanted.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", maxLength: MAX_SHORT, description: `What the picture is, one of: ${PICTURE_KINDS.join(", ")}.` },
                page: pageNumber("1-based page."),
                box: pageBox("[x0, y0, x1, y1] as fractions of the page from 0 to 1, origin top-left."),
              },
              required: ["kind", "page", "box"],
            },
          },
          uncertain: {
            type: "array",
            maxItems: MAX_UNCERTAIN,
            description:
              "Anything you could not settle, said plainly: a figure you could not read, a slot chosen between candidates, pages you were not sure belonged together.",
            items: {
              type: "string",
              maxLength: MAX_NOTE,
              description: `One doubt, starting with what it is about and a colon — one of ${UNCERTAIN_ABOUT.join(", ")} — then the doubt in words: "width: the plan prints 5'-7\" and ELEVATION 2 prints 5'-6\"".`,
            },
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description:
              "'high' = every overall figure read clearly and agreed; 'medium' = a figure chosen between candidates or hard to read; 'low' = the grouping or most sizes are doubtful.",
          },
        },
        required: [
          "codes",
          "name",
          "pages",
          "whyOneItem",
          "overall",
          "combinedLine",
          "configurations",
          "finishes",
          "statements",
          "mockup",
          "otherDimensions",
          "pictures",
          "uncertain",
          "confidence",
        ],
      },
    },
  },
  required: ["documentNotes", "nonItemPages", "items"],
};

export const DRAWINGS_ITEMS_TOOL = {
  name: DRAWINGS_ITEMS_TOOL_NAME,
  description:
    "Record every thing to be made in this document — one entry per ITEM, spanning whatever pages describe it — with its overall size, " +
    "configurations, finishes and everything else the document states about it. Copy the document's own wording and figures; never convert, tidy or infer.",
  input_schema: DRAWINGS_ITEMS_SCHEMA,
};

// ---- the check ---------------------------------------------------------------

/** Text the schema asks for as a plain string, EMPTY for "none": read back as null, so staging sees one shape. */
const blankText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), nullableText(max));

const pageOrNull = z.number().int().min(1).max(100_000).nullable().catch(null).default(null);

/** A list of page numbers that survives a bare number and drops anything that is not one. */
const pageList = z
  .preprocess((value) => {
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.filter((entry) => Number.isInteger(entry) && (entry as number) >= 1 && (entry as number) <= 100_000);
  }, z.array(z.number().int()))
  .catch([])
  .transform((pages) => [...new Set(pages)].sort((a, b) => a - b).slice(0, MAX_ITEM_PAGES));

/** A box on a page: four numbers, or null. Cleaned again by `usableBox` at staging. */
const boxOrNull = z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().catch(null).default(null);

/**
 * A list kept to its bound, with how many were dropped. The count is turned
 * into an `uncertain` line by the item transform, so a truncation is said on
 * the card rather than lost.
 */
type Bounded<T> = { kept: T[]; dropped: number };
function boundedList<T extends z.ZodTypeAny>(entry: T, max: number, wrap: ((scalar: string) => unknown) | null) {
  return z
    .preprocess((value) => {
      if (value === undefined || value === null) return [];
      const list = Array.isArray(value) ? value : [value];
      return list
        .filter((element) => element !== null && element !== undefined)
        .map((element) =>
          typeof element === "string" || typeof element === "number" || typeof element === "boolean"
            ? wrap
              ? wrap(String(element))
              : null
            : element,
        )
        .filter((element) => entry.safeParse(element).success);
    }, z.array(entry))
    .catch([])
    .transform((list): Bounded<z.infer<T>> => ({ kept: list.slice(0, max), dropped: Math.max(0, list.length - max) }));
}

const RawCandidate = z.object({
  valueRaw: z.preprocess((value) => (typeof value === "number" ? String(value) : value), z.string().trim().min(1).max(MAX_SHORT)),
  unitRaw: blankText(MAX_SHORT),
  view: blankText(MAX_SHORT),
  page: pageOrNull,
});
export type RawCandidate = z.infer<typeof RawCandidate>;

/**
 * One overall figure. A bare string or number is the figure with nothing else
 * claimed — the element can hold it — and anything that is not a figure is
 * null: one lost slot is an amber row in front of a reviewer, a failed read is
 * another call.
 */
const RawOverallFigure = z
  .preprocess(
    (value) => (typeof value === "string" || typeof value === "number" ? { valueRaw: String(value) } : value),
    z.object({
      valueRaw: z.preprocess((value) => (typeof value === "number" ? String(value) : value), z.string().trim().min(1).max(MAX_SHORT)),
      unitRaw: blankText(MAX_SHORT),
      view: blankText(MAX_SHORT),
      page: pageOrNull,
      evidence: blankText(MAX_NOTE),
      candidates: boundedList(RawCandidate, MAX_SLOT_CANDIDATES, (scalar) => ({ valueRaw: scalar })).transform(
        (bounded) => bounded.kept,
      ),
    }),
  )
  .nullable()
  .catch(null)
  .default(null);
export type RawOverallFigure = z.infer<typeof RawOverallFigure>;

/**
 * The overall size as a LIST of slot entries (the schema's shape), read into
 * one figure per slot. The FIRST entry for a slot is the answer; a second entry
 * for the same slot is the model breaking the one-per-slot rule, and it is kept
 * as a CANDIDATE of the first rather than dropped or allowed to stand beside it
 * — so the card shows it under the slot and "two of these are the width"
 * cannot be produced. The draft's object-of-five-slots shape is read as well.
 */
function overallAsSlots(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const out: Record<string, Record<string, unknown>> = {};
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { slot, ...figure } = entry as Record<string, unknown>;
    if (typeof slot !== "string" || !(OVERALL_KEYS as readonly string[]).includes(slot)) continue;
    const kept = out[slot];
    if (!kept) {
      out[slot] = figure;
      continue;
    }
    const candidates = Array.isArray(kept.candidates) ? kept.candidates : [];
    out[slot] = {
      ...kept,
      candidates: [...candidates, { valueRaw: figure.valueRaw, unitRaw: figure.unitRaw, view: figure.view, page: figure.page }],
    };
  }
  return out;
}

const RawOverall = z
  .preprocess(overallAsSlots, z.object({
    width: RawOverallFigure,
    depth: RawOverallFigure,
    height: RawOverallFigure,
    seatHeight: RawOverallFigure,
    diameter: RawOverallFigure,
  }))
  .catch({ width: null, depth: null, height: null, seatHeight: null, diameter: null })
  .default({ width: null, depth: null, height: null, seatHeight: null, diameter: null });
export type RawOverall = z.infer<typeof RawOverall>;

const configurationNames = looseTextList(MAX_SHORT, MAX_CONFIGURATIONS).catch([]);

const RawItemConfiguration = z.object({
  name: z.string().trim().min(1).max(MAX_SHORT),
  nameRaw: blankText(MAX_SHORT),
  differsIn: blankText(MAX_NOTE),
  pages: pageList,
  overall: RawOverall,
});
export type RawItemConfiguration = z.infer<typeof RawItemConfiguration>;

const RawFinish = z.object({
  part: blankText(MAX_SHORT),
  spec: blankText(MAX_VALUE),
  code: blankText(MAX_SHORT),
  configurations: configurationNames,
  page: pageOrNull,
  // A list of at most one box in the schema (a nullable object would spend a
  // union); the first box is the swatch, and a bare object is read too.
  swatch: z
    .preprocess((value) => (Array.isArray(value) ? (value[0] ?? null) : value), z.object({ page: pageOrNull, box: boxOrNull }).nullable())
    .catch(null)
    .default(null),
});
export type RawFinish = z.infer<typeof RawFinish>;

const RawStatement = z.object({
  label: blankText(MAX_SHORT),
  value: blankText(MAX_VALUE),
  page: pageOrNull,
  configurations: configurationNames,
});
export type RawStatement = z.infer<typeof RawStatement>;

const RawOtherDimension = z.object({
  label: blankText(MAX_SHORT),
  valueRaw: z.preprocess((value) => (typeof value === "number" ? String(value) : value), z.string().trim().min(1).max(MAX_SHORT)),
  unitRaw: blankText(MAX_SHORT),
  view: blankText(MAX_SHORT),
  page: pageOrNull,
});
export type RawOtherDimension = z.infer<typeof RawOtherDimension>;

const RawItemNote = z.object({ text: z.string().trim().min(1).max(MAX_VALUE), page: pageOrNull });

const RawPicture = z.object({
  kind: z.enum(PICTURE_KINDS).catch("other").default("other"),
  page: pageOrNull,
  box: boxOrNull,
});
export type RawPicture = z.infer<typeof RawPicture>;

const RawUncertain = z.object({
  about: z.enum(UNCERTAIN_ABOUT).catch("other").default("other"),
  why: z.string().trim().min(1).max(MAX_NOTE),
});
export type RawUncertain = z.infer<typeof RawUncertain>;

/** "width: the plan prints 5'-7\"" → about width; anything without a known word first is `other`, whole. */
function uncertainFromText(text: string): { about: string; why: string } {
  const match = /^\s*([A-Za-z]+)\s*:\s*([\s\S]+)$/.exec(text);
  if (match && (UNCERTAIN_ABOUT as readonly string[]).includes(match[1]!)) return { about: match[1]!, why: match[2]!.trim() };
  return { about: "other", why: text };
}

/**
 * The schema's FLAT shape, read into the one staging reads (see the head of
 * `DRAWINGS_ITEMS_SCHEMA` for why it is flat):
 *   * an `overall` entry naming configurations is that configuration's own
 *     size, moved onto the configuration — the item's `overall` keeps the
 *     entries naming none. A name the item does not list is dropped, and the
 *     entry reads as the item's own (`RawDrawingItem`'s rule);
 *   * `mockup` is the quoted evidence, or empty;
 *   * a finish's `swatchBox` is a chip on the callout's page.
 * The nested shape (the draft's) passes through untouched.
 */
function itemFromSchemaShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const item: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (typeof item.mockup === "string") {
    item.mockup = { is: item.mockup.trim() !== "", evidence: item.mockup };
  } else if (typeof item.mockup === "boolean") {
    item.mockup = { is: item.mockup, evidence: typeof item.mockupEvidence === "string" ? item.mockupEvidence : null };
  }
  if (Array.isArray(item.finishes)) {
    item.finishes = item.finishes.map((finish) => {
      if (!finish || typeof finish !== "object" || "swatch" in finish || !("swatchBox" in finish)) return finish;
      const { swatchBox, swatchPage, ...rest } = finish as Record<string, unknown>;
      const box = Array.isArray(swatchBox) && swatchBox.length === 4 ? swatchBox : null;
      return { ...rest, swatch: box ? { page: swatchPage ?? (rest as { page?: unknown }).page ?? null, box } : null };
    });
  }
  if (Array.isArray(item.overall) && Array.isArray(item.configurations)) {
    const named = new Map<string, Record<string, unknown>>();
    for (const configuration of item.configurations) {
      if (configuration && typeof configuration === "object" && typeof (configuration as { name?: unknown }).name === "string") {
        named.set(foldConfigurationName((configuration as { name: string }).name), configuration as Record<string, unknown>);
      }
    }
    const own = new Map<string, unknown[]>();
    const shared: unknown[] = [];
    for (const entry of item.overall) {
      const names = entry && typeof entry === "object" ? (entry as { configurations?: unknown }).configurations : undefined;
      const known = (Array.isArray(names) ? names : [])
        .filter((name): name is string => typeof name === "string")
        .map(foldConfigurationName)
        .filter((name) => named.has(name));
      if (known.length === 0) shared.push(entry);
      else for (const name of new Set(known)) own.set(name, [...(own.get(name) ?? []), entry]);
    }
    item.overall = shared;
    item.configurations = item.configurations.map((configuration) => {
      if (!configuration || typeof configuration !== "object" || "overall" in configuration) return configuration;
      const name = (configuration as { name?: unknown }).name;
      return { ...configuration, overall: typeof name === "string" ? (own.get(foldConfigurationName(name)) ?? []) : [] };
    });
  }
  return item;
}

const RawDrawingItemV4Shape = z.object({
  codes: z
    .preprocess(bareValuesAsList((scalar) => scalar), z.array(z.unknown()))
    .catch([])
    .transform((list) =>
      list
        .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
        .map((entry) => entry.trim().slice(0, MAX_SHORT))
        .slice(0, MAX_ITEM_CODES),
    ),
  name: blankText(MAX_SHORT),
  pages: pageList,
  whyOneItem: blankText(MAX_NOTE),
  overall: RawOverall,
  combinedLine: blankText(MAX_VALUE),
  configurations: boundedList(RawItemConfiguration, MAX_CONFIGURATIONS, (scalar) => ({
    name: scalar,
    nameRaw: scalar,
    differsIn: null,
    pages: [],
  })),
  finishes: boundedList(RawFinish, MAX_PER_ITEM, (scalar) => ({ part: null, spec: scalar, code: null })),
  statements: boundedList(RawStatement, MAX_STATEMENTS, (scalar) => ({ label: null, value: scalar })),
  mockup: z
    .object({ is: z.boolean().catch(false).default(false), evidence: blankText(MAX_SHORT) })
    .catch({ is: false, evidence: null })
    .default({ is: false, evidence: null }),
  otherDimensions: boundedList(RawOtherDimension, MAX_PER_ITEM, (scalar) => ({ valueRaw: scalar })),
  notes: boundedList(RawItemNote, MAX_PER_ITEM, (scalar) => ({ text: scalar })),
  pictures: boundedList(RawPicture, MAX_VIEW_REGIONS, null),
  uncertain: boundedList(RawUncertain, MAX_UNCERTAIN, uncertainFromText),
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null).default(null),
});

/**
 * One item, with the configuration names on every row checked against the
 * item's own list (a name the item does not list is dropped and the row reads
 * as shared — `RawDrawingItem`'s rule), duplicate configurations collapsed,
 * and every truncation said in `uncertain`.
 */
export const RawDrawingItemV4 = z.preprocess(itemFromSchemaShape, RawDrawingItemV4Shape).transform((item) => {
  const configurations: RawItemConfiguration[] = [];
  const known = new Set<string>();
  for (const entry of item.configurations.kept) {
    const folded = foldConfigurationName(entry.name);
    if (known.has(folded)) continue;
    known.add(folded);
    configurations.push(entry);
  }
  const keepKnown = (names: readonly string[]) => {
    const kept: string[] = [];
    for (const name of names) {
      const folded = foldConfigurationName(name);
      if (!known.has(folded) || kept.some((entry) => foldConfigurationName(entry) === folded)) continue;
      kept.push(name);
    }
    return kept;
  };
  const truncated: RawUncertain[] = [];
  const said = (what: string, bounded: { dropped: number; kept: unknown[] }) => {
    if (bounded.dropped > 0) {
      truncated.push({
        about: "other",
        why: `The read listed ${bounded.kept.length + bounded.dropped} ${what}; only the first ${bounded.kept.length} are kept.`,
      });
    }
  };
  said("configurations", item.configurations);
  said("finishes", item.finishes);
  said("statements", item.statements);
  said("other dimensions", item.otherDimensions);
  said("notes", item.notes);
  said("pictures", item.pictures);
  return {
    codes: item.codes,
    name: item.name,
    pages: item.pages,
    whyOneItem: item.whyOneItem,
    overall: item.overall,
    combinedLine: item.combinedLine,
    configurations,
    finishes: item.finishes.kept.map((finish) => ({ ...finish, configurations: keepKnown(finish.configurations) })),
    statements: item.statements.kept.map((statement) => ({ ...statement, configurations: keepKnown(statement.configurations) })),
    mockup: item.mockup,
    otherDimensions: item.otherDimensions.kept,
    notes: item.notes.kept,
    pictures: item.pictures.kept,
    uncertain: [...item.uncertain.kept, ...truncated],
    confidence: item.confidence,
  };
});
export type RawDrawingItemV4 = z.infer<typeof RawDrawingItemV4>;

export const DrawingsItemsOutput = z.object({
  documentNotes: blankText(MAX_NOTE),
  // "3: general notes only" in the schema's shape; an object is read too.
  nonItemPages: z
    .preprocess(
      (value) =>
        objectEntriesAsList(
          Array.isArray(value)
            ? value.map((entry) => {
                if (typeof entry !== "string") return entry;
                const match = /^\s*(?:page\s*)?(\d+)\s*[:\-–]?\s*([\s\S]*)$/i.exec(entry);
                return match ? { page: Number(match[1]), why: match[2] } : null;
              })
            : value,
        ),
      z.array(z.object({ page: pageOrNull, why: blankText(MAX_SHORT) })),
    )
    .catch([])
    .default([])
    .transform((pages) =>
      pages
        .filter((entry): entry is { page: number; why: string | null } => entry.page !== null)
        .slice(0, MAX_DRAWING_ITEMS),
    ),
  // TERMINAL ON PURPOSE, as `DrawingsOutput.items` is: an item is a container,
  // and `items` arriving as anything but a list is a failure to answer.
  items: z.array(RawDrawingItemV4).max(MAX_DRAWING_ITEMS),
});
export type DrawingsItemsOutput = z.infer<typeof DrawingsItemsOutput>;

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
  // A bare string becomes one note carrying it as the BODY, with no topic and
  // no title — the preamble review's own shape for a paragraph read under no
  // heading. Required to be present, for the reason `proposals` is.
  notes: z.preprocess(
    bareValuesAsList((scalar) => ({ bodyRaw: scalar })),
    z.array(RawPreambleNote).max(MAX_PREAMBLE_NOTES),
  ),
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
  | { outputKind: "drawing_items_v4"; tool: typeof DRAWINGS_ITEMS_TOOL; schema: typeof DrawingsItemsOutput }
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
  // Version 4, the item-centric read (2026-10-04). The page-centric v3 tool is
  // `TOOL_VARIANTS.shop_drawings.v3`, kept for the eval harness's baseline and
  // for re-reading a run's saved raw output.
  shop_drawings: { outputKind: "drawing_items_v4", tool: DRAWINGS_ITEMS_TOOL, schema: DrawingsItemsOutput },
  preamble: { outputKind: "preamble_notes", tool: PREAMBLE_TOOL, schema: PreambleOutput },
};

/** What a successful extraction returned, discriminated by the shape it is. */
export type ExtractionPayload =
  | { outputKind: "observations"; data: ExtractionOutput }
  | { outputKind: "drawing_items"; data: DrawingsOutput }
  | { outputKind: "drawing_items_v4"; data: DrawingsItemsOutput }
  | { outputKind: "preamble_notes"; data: PreambleOutput };

/**
 * Earlier tools for a kind, by the harness's pipeline name, so the eval harness
 * (`tools/eval-drawings.ts`) can re-ask a document exactly as an earlier
 * pipeline asked it, and re-check its saved response against the shape it was
 * asked for. `PROMPT_VARIANTS` in anthropic.ts is the prompt half of the same
 * pair. Nothing in the app passes a variant.
 */
export const TOOL_VARIANTS: Partial<Record<DocumentKind, Record<string, ExtractionToolSpec>>> = {
  shop_drawings: {
    v3: { outputKind: "drawing_items", tool: DRAWINGS_TOOL, schema: DrawingsOutput },
    v4: TOOLS.shop_drawings,
  },
};

/** The tool for a kind, or for one of its named variants; null for a variant that does not exist. */
export function toolFor(documentKind: DocumentKind, variant?: string): ExtractionToolSpec | null {
  if (!variant) return TOOLS[documentKind];
  return TOOL_VARIANTS[documentKind]?.[variant] ?? null;
}
