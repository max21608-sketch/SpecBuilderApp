// Editing a draft: the prose, and which questions it covers.
//
// ============================================================================
// WHAT IS EDITABLE, AND WHY IT IS NOT THE WHOLE BODY
//
// The author edits `intro_text` and `closing_text`, as PLAIN TEXT. The question
// table is regenerated from the coverage rows every time.
//
// The alternative -- a contentEditable over the whole body, sanitised on save --
// is what the fabric app does, and it is the wrong trade here. Its sanitiser
// says so itself: "defense-in-depth for a single-tenant tool whose only author
// is the logged-in user". More importantly, it lets the body and the coverage
// rows drift apart, and the send gate's entire guarantee is that they cannot.
// Someone deleting a table row by hand would produce an email that asks four
// questions while the app believes it asked five, and then waits for a reply to
// the fifth forever.
//
// Changing coverage is therefore a first-class, structured edit: the caller
// sends the question set it wants, and the body is re-rendered to match.
//
// An edit is NOT a refresh. A retained question whose answer moved since
// generation makes this 409 and tells the author to regenerate -- silently
// re-snapshotting would quietly change what the email claims.
// ============================================================================
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { currentAppEnvIsProduction } from "@/lib/env";
import { DomainConflictError, transactionErrorResponse, withTransaction } from "@/lib/db-transaction";
import {
  coverageStaleReasons,
  coveredFromQuestion,
  groupsFromCovered,
  loadQuestionsByKey,
  questionKey,
  type ContextSnapshot,
  type CoveredQuestion,
} from "@/lib/chase-drafts";
import { TEMPLATE_VERSION, buildChaseEmail } from "@/lib/chase-template";
import { ANSWER_STATE_LABELS } from "@/lib/spec-vocab";
import { isQuestionTier } from "@/lib/tgq";

export const maxDuration = 60;

const EditInput = z.object({
  version: z.number().int(),
  introText: z.string().max(4000),
  closingText: z.string().max(2000),
  // The full question set the draft should cover after this edit — retained
  // and added together. Sending a delta would make "remove the last question"
  // ambiguous with "change nothing".
  questions: z
    .array(z.object({ recordId: z.string().uuid(), requirementId: z.string().uuid() }))
    .min(1, "A chase email has to ask at least one question.")
    .max(2000),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const parsed = EditInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That edit is not valid." }, 400);
  }
  const input = parsed.data;

  const requestedKeys = new Set(input.questions.map((q) => questionKey(q.recordId, q.requirementId, 0)));
  if (requestedKeys.size !== input.questions.length) {
    return json({ ok: false, error: "The same question is listed twice." }, 400);
  }

  try {
    const result = await withTransaction(async (sql) => {
      const draftRows = await sql`
        select d.id, d.project_id, d.contact_id, d.status, d.version, d.project_label,
               d.recipient_name, c.name as contact_name
        from email_drafts d
        join project_contacts c on c.id = d.contact_id
        where d.id = ${id}
        for update of d
      `;
      const draft = draftRows[0];
      if (!draft) throw new DomainConflictError("draft_missing", "No such draft.", { status: 404 });

      const status = String(draft.status);
      if (status !== "draft") {
        throw new DomainConflictError(
          "draft_not_editable",
          status === "sent"
            ? "This draft has been recorded as sent and is now history. Withdraw the confirmation first if it was a mistake."
            : `This draft is ${status} and can no longer be edited.`,
        );
      }
      if (Number(draft.version) !== input.version) {
        throw new DomainConflictError(
          "draft_version_stale",
          "This draft changed while you were editing. Reload before saving, so you do not overwrite someone else's change.",
        );
      }

      // Existing coverage, so retained questions keep their ORIGINAL snapshot.
      const existingRows = await sql`
        select record_id, requirement_id, revision_no, answer_id, snapshot_answer_version,
               record_version, context_snapshot, prompt_text, field_label, current_value_text,
               tier, record_no, requirement_sort
        from email_draft_items where draft_id = ${id}
      `;
      const existing = new Map<string, CoveredQuestion>();
      for (const row of existingRows) {
        existing.set(questionKey(String(row.record_id), String(row.requirement_id), Number(row.revision_no)), {
          recordId: String(row.record_id),
          requirementId: String(row.requirement_id),
          answerId: row.answer_id === null || row.answer_id === undefined ? null : String(row.answer_id),
          answerVersion:
            row.snapshot_answer_version === null || row.snapshot_answer_version === undefined
              ? null
              : Number(row.snapshot_answer_version),
          recordVersion: Number(row.record_version),
          context: row.context_snapshot as ContextSnapshot,
          prompt: String(row.prompt_text),
          fieldLabel: row.field_label === null || row.field_label === undefined ? null : String(row.field_label),
          currentValueText:
            row.current_value_text === null || row.current_value_text === undefined
              ? null
              : String(row.current_value_text),
          // An edit is not a refresh: a retained question keeps the snapshot
          // the email was written against. The TIER is the exception, because
          // it is presentation rather than a claim about an answer, and the
          // body is being re-rendered anyway — a question that has since become
          // blocking should print under the heading that says so.
          tier: isQuestionTier(row.tier) ? row.tier : "later",
          recordNo: row.record_no === null || row.record_no === undefined ? 0 : Number(row.record_no),
          requirementSort:
            row.requirement_sort === null || row.requirement_sort === undefined
              ? 0
              : Number(row.requirement_sort),
        });
      }

      // Live rows for everything involved: retained questions to re-check,
      // added ones to snapshot.
      const live = await loadQuestionsByKey(input.questions, sql);

      const covered: CoveredQuestion[] = [];
      const staleRetained: { recordLabel: string; prompt: string; why: string }[] = [];
      const ineligibleAdded: { recordLabel: string; prompt: string; reason: string }[] = [];

      for (const q of input.questions) {
        const key = questionKey(q.recordId, q.requirementId, 0);
        const prior = existing.get(key);
        const liveQuestion = live.get(key) ?? null;

        if (prior) {
          // Retained: keep the snapshot the email was written against, but
          // refuse if it no longer holds.
          const reasons = coverageStaleReasons(
            {
              recordId: prior.recordId,
              requirementId: prior.requirementId,
              revisionNo: 0,
              answerId: prior.answerId,
              snapshotAnswerVersion: prior.answerVersion,
              recordVersion: prior.recordVersion,
              context: prior.context,
            },
            liveQuestion,
          );
          if (reasons.length > 0) {
            staleRetained.push({
              recordLabel: prior.context.recordLabel,
              prompt: prior.prompt,
              why: reasons.join(", "),
            });
            continue;
          }
          covered.push(
            liveQuestion?.tier
              ? {
                  ...prior,
                  tier: liveQuestion.tier,
                  recordNo: liveQuestion.recordNo,
                  requirementSort: liveQuestion.sortOrder,
                }
              : prior,
          );
          continue;
        }

        // Added: must be genuinely outstanding right now.
        if (!liveQuestion) {
          ineligibleAdded.push({ recordLabel: "", prompt: "", reason: "that question no longer exists" });
          continue;
        }
        if (liveQuestion.recordStatus !== "active") {
          ineligibleAdded.push({
            recordLabel: liveQuestion.recordLabel,
            prompt: liveQuestion.prompt,
            reason: `the record is ${liveQuestion.recordStatus}`,
          });
          continue;
        }
        if (liveQuestion.state !== "missing" && liveQuestion.state !== "tbc") {
          ineligibleAdded.push({
            recordLabel: liveQuestion.recordLabel,
            prompt: liveQuestion.prompt,
            reason: `it is now ${ANSWER_STATE_LABELS[liveQuestion.state]}`,
          });
          continue;
        }
        if (liveQuestion.tier === null) {
          ineligibleAdded.push({
            recordLabel: liveQuestion.recordLabel,
            prompt: liveQuestion.prompt,
            reason: "that record has no item level, so the email cannot say whether it blocks the quote",
          });
          continue;
        }
        covered.push(coveredFromQuestion(liveQuestion));
      }

      if (staleRetained.length > 0) {
        throw new DomainConflictError(
          "coverage_stale",
          `${staleRetained.length} question${staleRetained.length === 1 ? "" : "s"} in this draft changed since it was written. ` +
            `Regenerate rather than editing, so the email describes the current picture.`,
          { diff: staleRetained },
        );
      }
      if (ineligibleAdded.length > 0) {
        throw new DomainConflictError(
          "questions_ineligible",
          `${ineligibleAdded.length} question${ineligibleAdded.length === 1 ? " is" : "s are"} no longer outstanding and cannot be added.`,
          { diff: ineligibleAdded },
        );
      }

      // Record order then the cheat sheet's question order — the same order
      // generation used. Sorting on the rendered label and prompt re-ordered
      // the table alphabetically on every edit, which reads to the recipient as
      // the email having been rewritten.
      covered.sort((a, b) => a.recordNo - b.recordNo || a.requirementSort - b.requirementSort);

      const { subject, body } = buildChaseEmail({
        projectLabel: String(draft.project_label),
        contactName: String(draft.recipient_name ?? draft.contact_name),
        intro: input.introText,
        closing: input.closingText,
        groups: groupsFromCovered(covered),
        now: new Date(),
        environmentPrefix: currentAppEnvIsProduction() ? undefined : "[STAGING]",
      });

      // Coverage is immutable by trigger, so a change is a delete and a
      // rewrite — inside this transaction, alongside the body it describes.
      await sql`delete from email_draft_items where draft_id = ${id} returning id`;

      let sortOrder = 0;
      for (const item of covered) {
        sortOrder += 1;
        const inserted = await sql`
          insert into email_draft_items
            (draft_id, record_id, requirement_id, revision_no, answer_id, snapshot_answer_version,
             record_version, context_snapshot, prompt_text, field_label, current_value_text,
             sort_order, tier, record_no, requirement_sort, created_by)
          values
            (${id}, ${item.recordId}, ${item.requirementId}, 0, ${item.answerId}, ${item.answerVersion},
             ${item.recordVersion}, ${JSON.stringify(item.context)}::jsonb, ${item.prompt},
             ${item.fieldLabel}, ${item.currentValueText ?? ANSWER_STATE_LABELS[item.context.state]},
             ${sortOrder}, ${item.tier}, ${item.recordNo}, ${item.requirementSort}, ${user.email})
          returning id
        `;
        if (!inserted[0]) throw new Error("a coverage row failed to insert");
      }

      const rows = await sql`
        update email_drafts
        set intro_text = ${input.introText}, closing_text = ${input.closingText},
            subject = ${subject}, body = ${body}, template_version = ${TEMPLATE_VERSION},
            manually_edited_at = now(), manually_edited_by = ${user.email},
            updated_by = ${user.email}
        where id = ${id} and status = 'draft' and version = ${input.version}
        returning id, subject, body, intro_text, closing_text, version, manually_edited_at, manually_edited_by
      `;
      if (!rows[0]) {
        throw new DomainConflictError("draft_version_stale", "This draft changed. Nothing was saved.");
      }

      return { draft: rows[0], questionsCovered: covered.length };
    });

    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
