// Which outstanding questions are holding up a QUOTE, and which are merely
// outstanding.
//
// ============================================================================
// ONE IMPLEMENTATION, SIX CALLERS
//
// The drafts inventory, the generate and edit routes, the record screen, the
// spec table and the email template all ask the same question and must get the
// same answer -- the email's "we cannot quote without these" has to be the same
// set the screen showed and the same set the server enforced. A second copy is
// how a screen starts promising something the server does not hold to.
//
// ---- WHY THIS FUNCTION CANNOT TAKE A NULL LEVEL --------------------------
//
// An item's level is a person's decision (0019). A record that has none has no
// tier, and every caller has to say so rather than pick a reading: "everything
// counts as needed to quote" makes a level-less record look urgent, "nothing
// does" makes it look quotable, and both are the app answering a question only
// a human can. The type refuses the call; the screens show "Set level" and a
// chase for such a record is blocked with that reason.
// ============================================================================
import type { ItemLevel } from "@/lib/spec-vocab";

export type QuestionTier = "to_quote" | "later";

export const QUESTION_TIERS = ["to_quote", "later"] as const;

/**
 * What a tier is called ON SCREEN.
 *
 * TGQ, not "needed to quote". Settled with Max on 2026-09-18: they are the
 * same question, and two names for it is how a reader comes to believe they
 * are two measurements — which is exactly what had happened, with the spec
 * table and the record's own gate panel reporting different figures under
 * different names.
 *
 * `TIER_EMAIL_HEADINGS` below is deliberately NOT renamed. TGQ is this
 * business's word and a designer at another firm has never heard it; an email
 * saying "TGQ" in its red banner would be asking somebody to answer a question
 * they cannot read. The email says what it means in plain words, and the app
 * uses the term the people who work in it use.
 */
export const TIER_LABELS: Record<QuestionTier, string> = {
  to_quote: "TGQ",
  later: "Also outstanding",
};

/** The heading each tier gets in a chase email. Longer than the UI label on purpose. */
export const TIER_EMAIL_HEADINGS: Record<QuestionTier, string> = {
  to_quote: "Needed before we can quote",
  later: "Also outstanding — not holding up the quote",
};

export function isQuestionTier(value: unknown): value is QuestionTier {
  return typeof value === "string" && (QUESTION_TIERS as readonly string[]).includes(value);
}

/**
 * What Matthew's matrix says blocks a quote, for ONE category.
 *
 * Built from `spec_field_gates` rows at gate TGQ, mapped onto our cheat sheets
 * through `spec_matrix_category_map`. A category he has not written is ABSENT
 * from the map rather than present and empty — the `gatesForRecord` rule, and
 * the reason `loadTgqMatrices` returns a Map: an empty set would compute as
 * "nothing blocks a quote here" and report a cabinetry item quotable because
 * nobody has written its rules.
 */
export type TgqMatrix = {
  /** `spec_fields.json_id` values his matrix puts at TGQ for this category. */
  fields: ReadonlySet<number>;
  /** `requirements.local_key` values it puts at TGQ — the id-less questions. */
  localKeys: ReadonlySet<string>;
};

/** A checklist question, as both models need to see it. */
export type TgqRequirement = {
  /** 0019's per-level seed. The fallback, and only the fallback. */
  tgqLevels: readonly string[];
  /** The BWS field this question fills, by json_id. Null for a readiness row. */
  jsonId?: number | null;
  /** Its app-local key, where `kind = 'readiness'` and BWS has no column. */
  localKey?: string | null;
};

/**
 * Does this question have to be answered before this item can be priced?
 *
 * ==========================================================================
 * TWO MODELS, ONE ANSWER, AND WHICH ONE APPLIES DEPENDS ON THE CATEGORY.
 *
 * Settled with Max on 2026-09-18, after the overview made the disagreement
 * impossible to ignore: the same sofa read "48 needed to quote" in the spec
 * table and "6 outstanding" in its own TGQ gate panel, because two independent
 * models were answering the same question.
 *
 *   `spec_field_gates` (0026) is what Matthew actually WROTE — 35 fields across
 *   three gates for his nine seating categories. Where it covers a category it
 *   is the answer, because it is the only written gate model that exists.
 *
 *   `requirements.tgq_levels` (0019) is the placeholder that predates it, per
 *   question and per LEVEL, seeded with all three levels on all 728 rows. It
 *   stays as the fallback for every category his matrix does not reach — the
 *   eight cabinetry sheets, until he writes that half.
 *
 * Both are called TGQ on screen. They are the same question, and two names for
 * it is how a reader comes to believe they are two measurements.
 *
 * ---- WHY THE FALLBACK IS NOT SIMPLY "NOTHING BLOCKS IT" ------------------
 *
 * Because that is the confidently-wrong answer the gate model exists to
 * prevent. A cabinetry item reporting zero blocking questions would not be
 * ready; it would be unwritten. The placeholder over-reports — everything
 * counts — which is the safe direction to be wrong in, and the screens say so.
 *
 * ---- A MAPPED CATEGORY NEEDS NO LEVEL -----------------------------------
 *
 * His matrix is per CATEGORY and carries no level column, so where it applies
 * the tier is knowable without one. `questionTierOrNull` therefore answers for
 * a level-less record in a mapped category, and a chase for it is no longer
 * blocked. The level is still a real decision and still required by the
 * fallback — and still what the BWS boilerplate reads — so nothing else about
 * it changes.
 * ==========================================================================
 */
export function questionTier(
  requirement: TgqRequirement,
  level: ItemLevel,
  matrix?: TgqMatrix | null,
): QuestionTier {
  return tierFrom(requirement, level, matrix ?? null) ?? "later";
}

/**
 * The same decision where the level may be missing.
 *
 * Returns null only where the answer genuinely cannot be computed: the
 * FALLBACK model with no level. A caller must not treat "nobody has said what
 * kind of item this is" as an answer — "needed at any level" makes a
 * level-less record look urgent and "needed at none" makes it look quotable,
 * and both are the app answering a question only a person can.
 */
export function questionTierOrNull(
  requirement: TgqRequirement,
  level: ItemLevel | null,
  matrix?: TgqMatrix | null,
): QuestionTier | null {
  return tierFrom(requirement, level, matrix ?? null);
}

function tierFrom(
  requirement: TgqRequirement,
  level: ItemLevel | null,
  matrix: TgqMatrix | null,
): QuestionTier | null {
  if (matrix) {
    // HIS MATRIX, where he has written one. A question reaches it by the BWS
    // field it fills, or by the local key a readiness question carries — the
    // two homes `spec_field_gates` allows, by its own check constraint.
    const byField = requirement.jsonId !== null && requirement.jsonId !== undefined && matrix.fields.has(requirement.jsonId);
    const byKey = Boolean(requirement.localKey) && matrix.localKeys.has(requirement.localKey!);
    return byField || byKey ? "to_quote" : "later";
  }
  if (level === null) return null;
  return requirement.tgqLevels.includes(level) ? "to_quote" : "later";
}

/** What a screen says where a tier cannot be computed. */
export const NO_LEVEL_LABEL = "Set level";
export const NO_LEVEL_EXPLANATION =
  "No level set, so nothing on this record can be sorted into what blocks a quote and what does not. Choose simple, complex or hero.";
