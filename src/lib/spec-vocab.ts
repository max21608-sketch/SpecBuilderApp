// The controlled vocabularies of the spec model, as TypeScript constants.
//
// Each of these has a matching `check` constraint in db/migrations/0002. The
// constant and the constraint must agree, and changing either means a
// migration — not just an edit here. See .claude/skills/external-vocabulary-sync.

/**
 * The four states a spec answer can be in. These are genuinely four different
 * things and gate rules must read this value, never test whether a string is
 * empty:
 *   confirmed — a human has settled it
 *   tbc       — a human has actively said "not yet decided". This is an ANSWER.
 *               It blocks a gate. It is not the absence of one.
 *   missing   — nobody has looked yet
 *   na        — does not apply to this item
 *
 * Unrelated to NAME_DENYLIST's "tbc" in matching.ts, which is about an entity
 * name nobody filled in. Do not let the two meanings merge.
 */
export const ANSWER_STATES = ["confirmed", "tbc", "missing", "na"] as const;
export type AnswerState = (typeof ANSWER_STATES)[number];

export const ANSWER_STATE_LABELS: Record<AnswerState, string> = {
  confirmed: "Confirmed",
  tbc: "TBC",
  missing: "Missing",
  na: "N/A",
};

/** Whether a requirement's answer belongs in a BWS spec column, or nowhere. */
export const REQUIREMENT_KINDS = ["spec_field", "readiness"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Where an answer came from. `source_id` points at the row, per kind. */
export const ANSWER_SOURCES = ["manual", "document", "email"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

/**
 * The ref systems a client reference can belong to. The same item carries
 * different refs in different documents, which is why these are rows rather
 * than one column on the record.
 */
export const REF_SYSTEMS = ["boq_code", "design_code", "cos_code", "compound", "bws_job"] as const;
export type RefSystem = (typeof REF_SYSTEMS)[number];

export const SPLIT_REASONS = ["fabric", "configuration"] as const;
export type SplitReason = (typeof SPLIT_REASONS)[number];

/**
 * The life of an intake run. Matches `intake_runs_status_check` in 0006.
 *
 *   pending    registered; nobody has asked for it to be read. NOT queued work
 *              — a BOQ never rests here, and a spec document does until a human
 *              presses Extract, because that is the click that spends money.
 *   queued     a message is in flight for the current attempt
 *   parsing    a worker holds the claim, or a BOQ is being read inline
 *   parsed     staged and awaiting review
 *   confirmed  no pending proposals remain — applied or explicitly ignored.
 *              It does NOT mean every answer is settled; label it "Review
 *              complete".
 *   failed     terminal for this attempt
 */
export const INTAKE_STATUSES = ["pending", "queued", "parsing", "parsed", "confirmed", "failed"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

/** Matches `intake_runs_source_kind_check`. */
export const INTAKE_SOURCE_KINDS = ["boq_xlsx", "spec_document"] as const;
export type IntakeSourceKindValue = (typeof INTAKE_SOURCE_KINDS)[number];

/**
 * What kind of specification document this is. DECLARED at upload, never
 * inferred: an FF&E schedule and a BOQ are both .xlsx, and a file extension
 * identifies bytes, not a workflow. It selects the prompt.
 *
 * Matches `intake_runs_document_kind_check`.
 */
export const DOCUMENT_KINDS = [
  "ffe_schedule",
  "spec_bible",
  "finishes_schedule",
  "fabric_schedule",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  ffe_schedule: "FF&E schedule",
  spec_bible: "Specification bible",
  finishes_schedule: "Finishes schedule",
  fabric_schedule: "Fabric schedule",
  other: "Other specification document",
};

/** The states a staged proposal can be in. Reviewed rows are kept, never removed. */
export const PROPOSAL_REVIEW_STATUSES = ["pending", "ignored", "applied"] as const;
export type ProposalReviewStatus = (typeof PROPOSAL_REVIEW_STATUSES)[number];

export const RECORD_STATUSES = ["draft", "active", "retired"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/**
 * Who a chase email can be addressed to. `designer` rows additionally carry a
 * `designer_code` that joins to `spec_records.designer`.
 */
export const CONTACT_ROLES = ["designer", "client", "internal"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/**
 * The life of a chase draft. Only `draft` is editable.
 *
 *   draft      — being prepared; nothing has been claimed
 *   sent       — a human attested they sent it. Its content is now history.
 *   voided     — that attestation was withdrawn. The content and send record
 *                are preserved; the questions stop reading as Waiting.
 *   superseded — regeneration replaced it. Kept rather than deleted so a stale
 *                tab gets a conflict it can explain instead of a 404.
 */
export const DRAFT_STATUSES = ["draft", "sent", "voided", "superseded"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** A draft is finished being edited once it leaves `draft`. */
export function isSettledDraft(status: DraftStatus): boolean {
  return status !== "draft";
}

export function isAnswerState(value: unknown): value is AnswerState {
  return typeof value === "string" && (ANSWER_STATES as readonly string[]).includes(value);
}

/**
 * A record is "complete" when nothing is missing and nothing is still TBC.
 * `na` counts as settled: the question was asked and answered "not applicable".
 */
export function isSettled(state: AnswerState): boolean {
  return state === "confirmed" || state === "na";
}
