// One email, for download.
//
// THE PATHNAME IS NEVER ACCEPTED FROM THE CLIENT. It is resolved from the
// message's own row and re-checked against a project prefix on the way out.
// Same rule as the change-set evidence route and the item image: the blob
// token is the store's, not the user's.
//
// ALWAYS AN ATTACHMENT, NEVER RENDERED. An .eml body is untrusted HTML a
// stranger wrote. "Open in Outlook" is a download that opens in Outlook, and
// nothing in this app draws the message.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { blobPathname, streamTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";

export const dynamic = "force-dynamic";

function safeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, "").slice(0, 200) || "email.eml";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const rows = await sql`
    select em.project_id, em.subject, em.mailbox_storage_path, a.storage_path, a.filename, a.content_type
    from email_messages em
    left join attachments a on a.id = em.mime_attachment_id
    where em.id = ${id}
  `;
  const row = rows[0];
  if (!row) return json({ ok: false, error: "No such email." }, 404);

  const path = row.storage_path ?? row.mailbox_storage_path;
  if (!path) return json({ ok: false, error: "This email's source file was not kept." }, 404);

  // An unassigned message has no project, so it has no project prefix to check
  // against. Its bytes live under the mailbox prefix instead, and the download
  // is refused until somebody has placed it — which is also when a person has
  // decided it is theirs to read.
  if (!row.project_id) {
    return json(
      { ok: false, error: "Assign this email to a project before opening it." },
      409,
    );
  }

  try {
    const source = await streamTrustedBlob(blobPathname(String(path)), String(row.project_id), {
      range: request.headers.get("range"),
    });
    const headers = new Headers({
      "content-type": String(row.content_type || "message/rfc822"),
      "content-disposition": `attachment; filename="${safeFilename(String(row.filename ?? `${String(row.subject ?? "email").slice(0, 80)}.eml`))}"`,
      "accept-ranges": "bytes",
      // NDA-covered client correspondence. No shared cache may hold it.
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    const contentRange = source.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);
    const contentLength = source.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);
    return new Response(source.stream as unknown as BodyInit, { status: contentRange ? 206 : 200, headers });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 404);
    console.error("email mime read failed", cause);
    return json({ ok: false, error: "That file could not be read." }, 502);
  }
}
