// The gate: a human tells the app they sent this email.
//
// ============================================================================
// WHAT THIS DOES AND DOES NOT PROMISE
//
// It does NOT prove an email was sent. Nothing in this app can — the sending
// happens in Outlook, outside the application entirely. What it proves is
// narrower and still worth having:
//
//   * the questions this draft claims to cover are exactly the questions its
//     body listed, because the body and the coverage rows were written in one
//     transaction at generation time; and
//   * every one of those questions is STILL as the email described it.
//
// The second is the whole point. The email froze the data. If an answer has
// changed since, the email no longer describes reality, and marking it sent
// would leave the app claiming to be waiting on a reply to a question it
// asked about something else.
//
// ============================================================================
// IT WRITES NOTHING TO spec_answers. DELIBERATELY.
//
// The obvious implementation sets a `chased_at` column. That fires
// bump_version on spec_answers, which invalidates every M2 extraction
// snapshot pointing at that answer for a reason unrelated to the answer.
//
// So "waiting for a reply" is DERIVED — see waitingByQuestion in
// chase-drafts.ts. A consequence, which departs from the
// email-draft-and-send-gate skill: undo does NOT check `version = snapshot + 1`.
// That rule exists in the fabric app because confirming a send there mutates
// the covered rows, so exactly one bump proves nothing else touched them.
// Nothing is mutated here, so there is no bump to count.
// ============================================================================
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { DomainConflictError, transactionErrorResponse, withTransaction } from "@/lib/db-transaction";
import {
  coverageStaleReasons,
  loadQuestionsByKey,
  questionKey,
  type ContextSnapshot,
  type StaleReason,
} from "@/lib/chase-drafts";

const ConfirmInput = z.object({
  version: z.number().int(),
  // Not a checkbox with a default. The person is asserting they did something
  // outside the app, and the request has to carry that assertion explicitly.
  attestation: z.literal(true),
});

const REASON_TEXT: Record<StaleReason, string> = {
  answerAppeared: "someone has since answered this",
  answerRemoved: "the answer row was removed",
  answerChanged: "the answer changed after the email was written",
  answerSettled: "this has since been settled",
  recordChanged: "the record changed after the email was written",
  recordRetired: "the record was retired",
  contextChanged: "the question or the record's details changed after the email was written",
  questionGone: "this question no longer exists on the record",
};

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

  const parsed = ConfirmInput.safeParse(raw);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Confirm that you sent this email, and include the version you were looking at." },
      400,
    );
  }

  try {
    const result = await withTransaction(async (sql) => {
      // No project lock: this does not replace a set of drafts, it settles one.
      // Locking the project here would serialize confirmations against every
      // other chase operation for no benefit.
      const draftRows = await sql`
        select id, project_id, contact_id, status, version, recipient_email, subject
        from email_drafts where id = ${id} for update
      `;
      const draft = draftRows[0];
      if (!draft) throw new DomainConflictError("draft_missing", "No such draft.", { status: 404 });

      const status = String(draft.status);
      if (status !== "draft") {
        throw new DomainConflictError(
          status === "sent" ? "already_sent" : "draft_not_editable",
          status === "sent"
            ? "This draft has already been recorded as sent."
            : `This draft is ${status} and cannot be recorded as sent.`,
        );
      }
      if (Number(draft.version) !== parsed.data.version) {
        throw new DomainConflictError(
          "draft_version_stale",
          "This draft changed while you were looking at it. Reload, re-download the .eml, and confirm again.",
        );
      }

      // A draft with nobody to send to cannot have been sent.
      const recipient = String(draft.recipient_email ?? "").trim();
      if (!recipient) {
        throw new DomainConflictError(
          "no_recipient",
          "This draft has no email address, so it cannot have been sent. Add one first.",
          { status: 400 },
        );
      }

      const items = await sql`
        select record_id, requirement_id, revision_no, answer_id, snapshot_answer_version,
               record_version, context_snapshot, prompt_text
        from email_draft_items where draft_id = ${id} order by sort_order
      `;
      // A draft covering nothing must never read as "all fresh".
      if (items.length === 0) {
        throw new DomainConflictError(
          "no_coverage",
          "This draft covers no questions, so there is nothing to record.",
          { status: 400 },
        );
      }

      // Live state for exactly the covered questions, read through THIS
      // transaction so the rows validated are the rows locked.
      const live = await loadQuestionsByKey(
        items.map((row) => ({ recordId: String(row.record_id), requirementId: String(row.requirement_id) })),
        sql,
      );

      const stale: {
        recordId: string;
        requirementId: string;
        recordLabel: string;
        prompt: string;
        reasons: StaleReason[];
        why: string;
      }[] = [];

      for (const row of items) {
        const key = questionKey(String(row.record_id), String(row.requirement_id), Number(row.revision_no));
        const context = row.context_snapshot as ContextSnapshot;
        const reasons = coverageStaleReasons(
          {
            recordId: String(row.record_id),
            requirementId: String(row.requirement_id),
            revisionNo: Number(row.revision_no),
            answerId: row.answer_id === null || row.answer_id === undefined ? null : String(row.answer_id),
            snapshotAnswerVersion:
              row.snapshot_answer_version === null || row.snapshot_answer_version === undefined
                ? null
                : Number(row.snapshot_answer_version),
            recordVersion: Number(row.record_version),
            context,
          },
          live.get(key) ?? null,
        );
        if (reasons.length === 0) continue;

        stale.push({
          recordId: String(row.record_id),
          requirementId: String(row.requirement_id),
          recordLabel: context?.recordLabel ?? "",
          prompt: String(row.prompt_text),
          reasons,
          // The person needs to know WHAT moved to decide whether to
          // regenerate. A bare "conflict" leaves them guessing.
          why: reasons.map((reason) => REASON_TEXT[reason]).join("; "),
        });
      }

      if (stale.length > 0) {
        throw new DomainConflictError(
          "coverage_stale",
          `${stale.length} of the ${items.length} question${items.length === 1 ? "" : "s"} in this email changed after it was written. ` +
            `Regenerate the draft so it describes the current picture, then send that.`,
          { diff: stale },
        );
      }

      const sentRows = await sql`
        update email_drafts
        set status = 'sent', sent_at = now(), sent_by = ${user.email}, updated_by = ${user.email}
        where id = ${id} and status = 'draft' and version = ${parsed.data.version}
        returning id, status, sent_at, sent_by, version
      `;
      // Zero rows here means the row moved between the lock and the write,
      // which should be impossible -- but reporting success without a write is
      // exactly the failure mode this whole route exists to prevent.
      if (!sentRows[0]) {
        throw new DomainConflictError("draft_version_stale", "This draft changed. Nothing was recorded.");
      }

      await sql`
        insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
        values ('email_draft', ${id}, 'draft', 'sent', ${user.email},
                ${`Sent to ${recipient}, covering ${items.length} question${items.length === 1 ? "" : "s"}`})
      `;

      return { draft: sentRows[0], questionsCovered: items.length };
    });

    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
