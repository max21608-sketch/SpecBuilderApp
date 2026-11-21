// Who a chase may ask what (0062, decision D of 2026-11-20).
//
// ============================================================================
// ONLY A CLIENT QUESTION GOES TO A DESIGNER OR A CLIENT; A COLLEAGUE MAY BE
// SENT ANYTHING.
//
// The first chase on the test tender put "Project sold with metal finish or
// metal paint effect?" and "Assembly guide required" in front of a designer.
// Chaseable was `kind = 'spec_field'` (decision 19) — whether BWS has a column
// for the answer — and that is not who answers it. `requirements.audience`
// says who (seed data), and `project_question_routes` lets ONE project move
// one question ("ask the client", decided by the CAM who did not know it).
//
// Enforced at the write boundary, the generate and edit routes, off the LIVE
// question and the LOCKED contact row — the `questionTier` rule: what the
// email claims about its recipient is the server's to decide. On edit it
// applies to ADDED questions only, so a draft written before this rule opens,
// edits and downloads as it was.
//
// Pure, so the rule and its sentence are tested without a database.
// ============================================================================
import type { QuestionAudience } from "@/lib/spec-vocab";

/** The sentence a refused line carries, or null where the recipient may be asked it. */
export function audienceRefusal(
  question: { audience: QuestionAudience },
  contactRole: string | null | undefined,
): string | null {
  if (contactRole === "internal") return null;
  if (question.audience === "client") return null;
  return question.audience === "cam"
    ? "is the CAM's to answer, not the client's"
    : "is ours to answer (in-house), not the client's";
}
