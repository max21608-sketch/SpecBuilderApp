// The record screen's payload, as `/api/records/[id]` sends it, and the shapes
// inside it. Moved out of src/app/dashboard/records/[id]/page.tsx on
// 2026-11-07 (audit 5.3, cut C), so the page and the components it was split
// into read one set of types.
import type { AnswerState, AttributeGroup, AttributeState, DimensionSlot } from "@/lib/spec-vocab";
import type { Disagreement } from "@/lib/disagreements";
import type { RecordPictureState } from "@/components/records/RecordPicture";
import type { ConfigurationFamily } from "@/lib/configuration-family";
import type { MatrixFieldRow } from "@/components/records/GatePanel";
import type { Palette } from "@/lib/palettes";
import type { Gate, GateStatus } from "@/lib/gates";
import type { ItemTgqRow } from "@/lib/item-tgq";
import type { TwinWithAttributes } from "@/lib/twin-offer";

export type Answer = {
  requirement_id: string; kind: string; prompt: string; help_text: string | null; section: string | null;
  tgq_levels: string[] | null;
  field_name: string | null; json_id: number | null; field_category: string | null;
  answer_id: string | null; value: string | null; qualifier: string | null; state: AnswerState; version: number;
  /** Ties a readiness question to a row of Matthew's matrix that has no BWS field. */
  local_key: string | null;
  confirmed_by: string | null; confirmed_at: string | null;
};

export type SpecRecord = {
  id: string; record_no: number; item_description: string; product_reference: string | null;
  qty: number | null; designer: string | null; area: string | null; boq_category: string | null;
  /** The bill's quantity cell as printed where it gave no count (0059); the header prints quantityNotGiven(qty_raw). */
  qty_raw?: string | null;
  source_line_no: number | null; version: number; category_id: string | null; level: string | null;
  /** A level this app guessed. Advisory until somebody accepts it. */
  level_suggested: string | null; level_suggested_reason: string | null;
  /** 0028's two free-text columns. `spec_description` is quote-facing;
   *  `internal_notes` never leaves this app. */
  spec_description: string | null; internal_notes: string | null;
  /** 0034: the one sentence a person typed about the dimension cell. */
  dimension_note: string | null;
  bws_project_number: string; project_name: string; project_id: string;
  run_id: string; run_name: string;
  category_name: string | null; category_family: string | null;
  /** A fabric split (0024). Both null on an ordinary record. */
  parent_id: string | null; variant_label: string | null;
  /** 0039: its number under its bill line, and that line's own number. Null on a bill line. */
  variant_ordinal?: number | null; parent_record_no?: number | null;
  /** `retired` for a configuration somebody took out of the export (0038). */
  status: string;
  /** Whether the record has a CURRENT picture — a bill's or a crop off the
   *  drawings — so the screen can decide without asking `/image` and being
   *  refused. */
  has_image: boolean;
};

/** This record's bill line and every live configuration under it, parent first. */
export type FamilyMember = {
  id: string; record_no: number; variant_label: string | null; qty: number | null;
  item_description: string; attribute_count: string; refs: string | null;
  /** 0039. Null on the bill line itself. */
  variant_ordinal?: number | null; parent_record_no?: number | null;
  version?: number;
};

export type Attribute = {
  id: string; attr_group: AttributeGroup; label: string; value: string | null; unit: string | null;
  /** Where on the item it goes (0029): "Main body & self pipe". */
  qualifier: string | null;
  finish_id: string | null; finish_code: string | null; finish_description: string | null;
  finish_state: string | null;
  /** `internal` = a code this app minted (0036). It never reaches the export. */
  finish_code_origin: string | null;
  dimension_slot: DimensionSlot | null;
  material_code: string | null; state: AttributeState; sort_order: number; version: number;
  source_page: number | null; source_run_id: string | null; created_by: string | null;
  field_name: string | null; json_id: number | null; field_category: string | null;
  source_filename: string | null; source_document_kind: string | null; source_is_bill?: boolean | null;
  /**
   * 0041: the BW standard beside the client's words, its state, and the email
   * that agreed it. Optional so an older payload still renders.
   */
  standard_value?: string | null; standard_state?: string | null;
  standard_set_by?: string | null; standard_set_at?: string | null;
  standard_evidence_filename?: string | null; standard_evidence_change_set_id?: string | null;
  /** 0045: BW's own finish for the linked CODE -- the one in force on a linked spec. */
  finish_standard_value?: string | null; finish_standard_state?: string | null;
};

/** A row in the shape `attribute-label.ts` reads: a slotted size is named by its slot. */
export function labelOf(attribute: Pick<Attribute, "label" | "dimension_slot">) {
  return { label: attribute.label, slot: attribute.dimension_slot };
}

export type Category = { id: string; slug: string; family: string; name: string; requirements_authored: boolean };

export type RetiredAttribute = Attribute & {
  retired_at: string | null;
  retired_by: string | null;
  superseded_by_id: string | null;
};

/** Who owes us the unanswered questions, resolved from the BOQ's designer code. */
export type DesignerContact = { id: string; name: string; email: string | null; role: string | null; designer_code: string };

/** One end of a mock-up link (0043): a record, its number and its phase. */
export type MockupLink = { id: string; recordNo: number; runName: string; status: string };

export type Payload = {
  record: SpecRecord;
  /**
   * The current picture and where it came from, and the one a person may swap
   * in (2026-10-05). Optional: a payload built before it carries none, and the
   * panel then shows nothing rather than a picture it cannot caption.
   */
  picture?: RecordPictureState;
  /**
   * The mock-up phase, in both directions (0043). `of` is the record a mock-up
   * item was added from; `copies` are this record's copies on the mock-up
   * phase, a retired one included and marked. Optional: an older payload has none.
   */
  mockup?: { isMockup: boolean; of: MockupLink | null; copies: MockupLink[] };
  /**
   * The bill lines this one is a TWIN of (0060), each with its live specs for
   * the "also on its twin" ticks. Optional: an older payload has none.
   */
  twins?: TwinWithAttributes[];
  refs: { ref_system: string; ref_value: string }[];
  attributes: Attribute[];
  retiredAttributes: RetiredAttribute[];
  /**
   * What a later document said that disagrees with a value this record holds
   * (0046) — open and settled. Optional: an older payload carries none.
   */
  disagreements?: Disagreement[];
  answers: Answer[];
  categories: Category[];
  specFields: { id: string; name: string; json_id: number }[];
  /** The project's finishes library, for the Attach control on the Specs tab. */
  finishes: {
    id: string; code: string; code_origin: string; kind: string | null;
    description: string | null; state: string;
  }[];
  /** Every palette, options included. A BWS-owned one arrives with none. */
  palettes: (Omit<Palette, "options"> & { allows_free_text: boolean; source_note: string | null; synced_at: string | null; options: Palette["options"] })[];
  /** Which palette a question offers, by BWS field id or by local key. */
  paletteByQuestion: { json_id: number | null; local_key: string | null; palette_key: string }[];
  family: FamilyMember[];
  /**
   * A split bill line's configurations with their live specs and answers,
   * for what they have in common. Null on a configuration and on a line with
   * none.
   */
  configurationFamily?: ConfigurationFamily | null;
  /** Null where this record's category is not on Matthew's matrix. */
  gates: Record<Gate, GateStatus> | null;
  /**
   * Which model decides this record's TGQ, as data rather than as a verdict.
   *
   * Null where his matrix does not cover the category, which means the 0019
   * placeholder applies — NOT that nothing blocks a quote. Arrays because a
   * Set does not survive JSON; the screen rebuilds them.
   */
  tgqMatrix: { fields: number[]; localKeys: string[] } | null;
  /**
   * Which questions have already been ASKED and not answered, keyed by
   * `questionKey(recordId, requirementId, 0)` — derived, never stored.
   */
  waiting: Record<string, { draftId: string; sentAt: string | null; contactName: string }>;
  designerContact: DesignerContact | null;
  designerContactAmbiguous: boolean;
  /** `toQuote`/`alsoOutstanding`/`toChase` are NULL where the record has no level. A dash, never a zero. */
  quoteReadiness: {
    toQuote: number | null;
    /** Of `toQuote`, the ones a chase would ask — readiness rows are ours to record. */
    toChase: number | null;
    /** Project-wide TGQ questions on this item: answered once on the project, never in `toQuote`. */
    projectWide?: number | null;
    /** The rows `toQuote` counts (`itemTgq`). THE LIST IS THE COUNT. */
    rows?: ItemTgqRow[];
    model?: "matrix" | "placeholder";
    alsoOutstanding: number | null;
    outstanding: number;
    settled: number;
    notApplicable: number;
    noLevel: boolean;
  };
  /** Matthew's matrix rows for this category. Null where his matrix does not reach it. */
  matrixFields: MatrixFieldRow[] | null;
};
