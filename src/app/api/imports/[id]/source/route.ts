// The source document itself, for the reviewer.
//
// A proposal a reviewer can only check against the model's own restatement of
// it is a proposal they have to take on faith. This is what makes "page 14 says
// Antique Brass" verifiable rather than persuasive.
//
// THE URL IS NEVER ACCEPTED FROM THE CLIENT. The pathname is resolved from the
// RUN'S OWN attachment row, and re-checked against the run's project prefix on
// the way out. The caller names an import id — nothing else — so there is no
// value here that could redirect a store credential anywhere.
//
// Streamed, not buffered: a 20MB PDF read into memory in a serverless function
// is the one request that takes the whole instance down. Range requests are
// passed through so a PDF viewer can jump to a page instead of pulling the
// whole file to show one of them.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { blobPathname, streamTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const rows = await sql`
    select r.project_id, a.storage_path, a.filename, a.content_type
    from intake_runs r
    join attachments a on a.id = r.attachment_id
    where r.id = ${id}
  `;
  const run = rows[0];
  if (!run) return json({ ok: false, error: "That import has no stored document." }, 404);

  try {
    const source = await streamTrustedBlob(
      blobPathname(String(run.storage_path)),
      String(run.project_id),
      { range: request.headers.get("range") },
    );

    const headers = new Headers({
      "content-type": String(run.content_type || source.contentType || "application/octet-stream"),
      // inline, so the browser's own PDF viewer opens it rather than saving a
      // copy of an NDA-covered document into someone's Downloads folder.
      "content-disposition": `inline; filename="${String(run.filename ?? "document").replace(/["\\\r\n]/g, "")}"`,
      "accept-ranges": "bytes",
      // Private and per-user: this is client specification material, and a
      // shared cache holding it is a disclosure waiting to happen.
      "cache-control": "private, no-store",
    });
    const contentRange = source.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);
    const contentLength = source.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);

    return new Response(source.stream as unknown as BodyInit, {
      status: contentRange ? 206 : 200,
      headers,
    });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 404);
    console.error("source document read failed", cause);
    return json({ ok: false, error: "That document could not be read." }, 502);
  }
}
