// What a document IS, as two vocabularies and the one map between them.
//
// ============================================================================
// A LEAF, so the browser can have it without the Anthropic SDK.
//
// These four lived in `document-classify.ts` and are re-exported from it, so no
// caller changed. They had to move because the UPLOAD SCREEN now guesses a kind
// from the filename before anything is stored, and it has to answer in the same
// vocabulary as the model's own answer — and `document-classify.ts` imports the
// Anthropic SDK at module top, so importing `KIND_FROM_GENRE` from a client
// component would pull the whole SDK into the browser bundle. Same reasoning,
// same shape, as `WAITING_FOR_SLOT_MESSAGE` living in `intake-status.ts`.
//
// THE EXACT STEP IS STILL CODE'S and it is still one table. The model answers
// in DOCUMENT terms — what the thing is called in the trade — and the filename
// rule answers in the same terms; `KIND_FROM_GENRE` is what maps either onto
// this app's `importType` and `DocumentKind`. Two readers, one mapping, which
// is the `composeDimensionCell` rule in a small place: a second table is how the
// upload screen comes to file a document differently from the classify route.
// ============================================================================
import type { DocumentKind } from "@/lib/spec-vocab";

/** What a person in the trade would call the document. Not this app's vocabulary. */
export const DOCUMENT_GENRES = [
  "bill_of_quantities",
  "shop_drawings",
  "specification_sheets",
  "ffe_schedule",
  "finishes_schedule",
  "fabric_schedule",
  "specification_bible",
  "preamble",
  "email",
  "unclear",
] as const;
export type DocumentGenre = (typeof DOCUMENT_GENRES)[number];

export type KindDecision = { importType: "boq" | "spec_document"; documentKind: DocumentKind | null };

/**
 * The exact step: a trade genre becomes this app's own two fields.
 *
 * `specification_sheets` and `shop_drawings` both land on `shop_drawings`
 * because this app has one prompt for both and the Panther pack contains both —
 * nine SPEC-346 sheets and one shop-drawing set, all read the same way. The
 * genre is kept apart from the kind so that stops being true without a prompt
 * change.
 */
export const KIND_FROM_GENRE: Record<Exclude<DocumentGenre, "unclear">, KindDecision> = {
  bill_of_quantities: { importType: "boq", documentKind: null },
  shop_drawings: { importType: "spec_document", documentKind: "shop_drawings" },
  specification_sheets: { importType: "spec_document", documentKind: "shop_drawings" },
  ffe_schedule: { importType: "spec_document", documentKind: "ffe_schedule" },
  finishes_schedule: { importType: "spec_document", documentKind: "finishes_schedule" },
  fabric_schedule: { importType: "spec_document", documentKind: "fabric_schedule" },
  specification_bible: { importType: "spec_document", documentKind: "spec_bible" },
  preamble: { importType: "spec_document", documentKind: "preamble" },
  email: { importType: "spec_document", documentKind: "email" },
};
