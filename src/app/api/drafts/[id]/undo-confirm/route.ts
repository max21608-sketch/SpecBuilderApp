// Withdrawing a send confirmation.
//
// This does NOT recall an email. It says "I told the app I sent this, and I
// was wrong" — a misclick, or a send that failed in Outlook. The draft keeps
// its body, its coverage and its send record; it moves to `voided`, which
// stops its questions reading as waiting for a reply.
//
// ============================================================================
// WHY THERE IS NO `version = snapshot + 1` CHECK HERE
//
// The email-draft-and-send-gate skill requires undo to prove the covered rows
// are still exactly where the confirm left them — version bumped by exactly
// one, from the confirm's own write. That rule exists because in the fabric
// app confirming a send MUTATES the covered lines, so anything other than a
// single bump means a human edited them afterwards and undoing would silently
// discard that edit.
//
// Confirming a send here mutates nothing. There is no bump to count, and
// nothing for an undo to discard. Requiring one would be importing a guard
// without its reason, and would block the most useful case: noticing the
// mistake precisely BECAUSE someone has since edited an answer.
//
// So undo is guarded only on the draft itself — still `sent`, still at the
// version the caller was looking at.
// ============================================================================
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { DomainConflictError, transactionErrorResponse, withTransaction } from "@/lib/db-transaction";

const UndoInput = z.object({
  version: z.number().int(),
  reason: z.string().trim().max(500).optional(),
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

  const parsed = UndoInput.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "Include the version you were looking at." }, 400);
  }
  const reason = parsed.data.reason?.trim() || null;

  try {
    const result = await withTransaction(async (sql) => {
      const draftRows = await sql`
        select id, status, version from email_drafts where id = ${id} for update
      `;
      const draft = draftRows[0];
      if (!draft) throw new DomainConflictError("draft_missing", "No such draft.", { status: 404 });

      const status = String(draft.status);
      if (status !== "sent") {
        throw new DomainConflictError(
          "not_sent",
          status === "voided"
            ? "This send confirmation has already been withdrawn."
            : `This draft is ${status}, so there is no send confirmation to withdraw.`,
        );
      }
      if (Number(draft.version) !== parsed.data.version) {
        throw new DomainConflictError(
          "draft_version_stale",
          "This draft changed while you were looking at it. Reload and try again.",
        );
      }

      // sent_at/sent_by are deliberately preserved: this is the record of what
      // happened, annotated, not erased. The DB trigger enforces that too.
      const rows = await sql`
        update email_drafts
        set status = 'voided', voided_at = now(), voided_by = ${user.email},
            void_reason = ${reason}, updated_by = ${user.email}
        where id = ${id} and status = 'sent' and version = ${parsed.data.version}
        returning id, status, sent_at, sent_by, voided_at, voided_by, void_reason, version
      `;
      if (!rows[0]) {
        throw new DomainConflictError("draft_version_stale", "This draft changed. Nothing was recorded.");
      }

      await sql`
        insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
        values ('email_draft', ${id}, 'sent', 'voided', ${user.email},
                ${reason ? `Send confirmation withdrawn: ${reason}` : "Send confirmation withdrawn"})
      `;

      return { draft: rows[0] };
    });

    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
