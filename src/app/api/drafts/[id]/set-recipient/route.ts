// Filling in a missing address from the draft card.
//
// Two writes, one transaction: the draft's own recipient snapshot, and — only
// when it is still BLANK — the contact register. A contact whose address has
// already been corrected by a person is never overwritten from here; changing
// a known-wrong address is a deliberate, version-checked contact edit.
//
// This deliberately does NOT set manually_edited_at. There is no authored
// prose to lose, so regenerating after adding an address should not demand an
// acknowledgement.
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { DomainConflictError, transactionErrorResponse, withTransaction } from "@/lib/db-transaction";

const EMAIL = /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/;

const RecipientInput = z.object({
  version: z.number().int(),
  email: z.string().trim().min(1).max(320).regex(EMAIL, "That does not look like a single email address."),
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

  const parsed = RecipientInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That address is not valid." }, 400);
  }

  try {
    const result = await withTransaction(async (sql) => {
      const draftRows = await sql`
        select id, contact_id, status, version from email_drafts where id = ${id} for update
      `;
      const draft = draftRows[0];
      if (!draft) throw new DomainConflictError("draft_missing", "No such draft.", { status: 404 });
      if (String(draft.status) !== "draft") {
        throw new DomainConflictError(
          "draft_not_editable",
          `This draft is ${String(draft.status)} and can no longer be changed.`,
        );
      }
      if (Number(draft.version) !== parsed.data.version) {
        throw new DomainConflictError(
          "draft_version_stale",
          "This draft changed while you were editing. Reload and try again.",
        );
      }

      const updated = await sql`
        update email_drafts
        set recipient_email = ${parsed.data.email}, updated_by = ${user.email}
        where id = ${id} and status = 'draft' and version = ${parsed.data.version}
        returning id, recipient_email, version
      `;
      if (!updated[0]) {
        throw new DomainConflictError("draft_version_stale", "This draft changed. Nothing was saved.");
      }

      // Only fills a blank. `nullif(btrim(...), '')` treats a whitespace-only
      // value as blank too.
      const contactUpdated = await sql`
        update project_contacts
        set email = ${parsed.data.email}, updated_by = ${user.email}
        where id = ${draft.contact_id} and nullif(btrim(coalesce(email, '')), '') is null
        returning id, email, version
      `;

      return { draft: updated[0], contactUpdated: contactUpdated.length > 0 };
    });

    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
