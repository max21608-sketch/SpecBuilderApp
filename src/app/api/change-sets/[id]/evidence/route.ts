// The email (or drawing, or PDF) that caused one change, for download.
//
// THE PATHNAME IS NEVER ACCEPTED FROM THE CLIENT. It is resolved from the
// change set's own attachment row and re-checked against that change's project
// prefix on the way out — the caller names a change and nothing else. Same
// rule as the item image and the import source, and for the same reason: the
// blob token is the store's, not the user's.
//
// ALWAYS AN ATTACHMENT, NEVER RENDERED. A .eml body is untrusted HTML a
// stranger wrote and a .msg is binary Outlook format this app does not parse.
// `content-disposition: attachment` plus `nosniff` is what keeps "open the
// email that asked for this" a download that opens in Outlook rather than a
// page this app draws.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { blobPathname, streamTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";

export const dynamic = "force-dynamic";

function safeFilename(name: string): string {
  // Quotes and control characters would let a filename break out of the
  // header it is quoted in.
  return name.replace(/[\r\n"\\]/g, "").slice(0, 200) || "evidence";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const rows = await sql`
    select cs.project_id, a.storage_path, a.content_type, a.filename
    from change_sets cs
    join attachments a on a.id = cs.evidence_attachment_id
    where cs.id = ${id}
  `;
  const row = rows[0];
  if (!row) return json({ ok: false, error: "That change has no attached evidence." }, 404);

  try {
    const source = await streamTrustedBlob(blobPathname(String(row.storage_path)), String(row.project_id), {
      range: request.headers.get("range"),
    });
    const headers = new Headers({
      "content-type": String(row.content_type || "application/octet-stream"),
      "content-disposition": `attachment; filename="${safeFilename(String(row.filename ?? "evidence"))}"`,
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
    console.error("evidence read failed", cause);
    return json({ ok: false, error: "That file could not be read." }, 502);
  }
}
