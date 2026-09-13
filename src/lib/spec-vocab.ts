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

export const INTAKE_STATUSES = ["pending", "parsing", "parsed", "confirmed", "failed"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const RECORD_STATUSES = ["draft", "active", "retired"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

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
