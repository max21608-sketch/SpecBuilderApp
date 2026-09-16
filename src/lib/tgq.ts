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

export const TIER_LABELS: Record<QuestionTier, string> = {
  to_quote: "Needed to quote",
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
 * Does this question have to be answered before this item can be priced?
 *
 * `tgqLevels` is seed data revised by re-seed (see db/seed/0003_requirements.sql
 * and docs/plans/tgq-for-matthew.md). An empty array is a question that never
 * blocks a quote at any level.
 */
export function questionTier(
  requirement: { tgqLevels: readonly string[] },
  level: ItemLevel,
): QuestionTier {
  return requirement.tgqLevels.includes(level) ? "to_quote" : "later";
}

/**
 * The same decision where the level may be missing.
 *
 * Returns null rather than a tier, so a caller cannot accidentally treat
 * "nobody has said what kind of item this is" as an answer.
 */
export function questionTierOrNull(
  requirement: { tgqLevels: readonly string[] },
  level: ItemLevel | null,
): QuestionTier | null {
  return level === null ? null : questionTier(requirement, level);
}

/** What a screen says where a tier cannot be computed. */
export const NO_LEVEL_LABEL = "Set level";
export const NO_LEVEL_EXPLANATION =
  "No level set, so nothing on this record can be sorted into what blocks a quote and what does not. Choose simple, complex or hero.";
