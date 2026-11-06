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
//
// THREE RULES ABOUT THE HEADERS (audit A6, A10, 2026-11-06):
//   - The filename goes through `contentDisposition`. A name with any
//     character above U+00FF (`Ronnie Scott’s – Drawings.pdf`) made `Headers`
//     throw, and the document could never be opened.
//   - `nosniff`, and inline ONLY for a type a reviewer opens to read (a PDF, a
//     spreadsheet, a picture). Anything else is plain bytes to download.
//   - AN EMAIL'S `.eml` IS NEVER SERVED INLINE. Its body is HTML a stranger
//     wrote, and this route used to serve it inline as message/rfc822. It is
//     a DOWNLOAD here, exactly as the mime route serves it, rather than a 404:
//     a spec confirmed off an email cites the email's run as its source, and
//     the checklist, the bill line, the disagreement and the history all link
//     that source through this route, so refusing it would kill every one of
//     those links where opening it in Outlook is the right answer.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { blobPathname, streamTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { contentDisposition } from "@/lib/content-disposition";
import { isPictureContentType } from "@/lib/picture-types";

export const dynamic = "force-dynamic";

/** What a reviewer opens in the browser to read. Everything else downloads as plain bytes. */
const READABLE_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function servedAs(type: string): { contentType: string; inline: boolean } {
  const bare = type.split(";", 1)[0]!.trim().toLowerCase();
  return READABLE_TYPES.has(bare) || isPictureContentType(bare)
    ? { contentType: type, inline: true }
    : { contentType: "application/octet-stream", inline: false };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  // A BILL READ FROM A PDF has two documents: the run's source is the workbook
  // its text was put back into, and `?document=pdf` is the PDF itself. Which
  // attachment that is comes from the RUN'S OWN staged record, written by the
  // server at registration, and must be an attachment of the run's project —
  // the request names nothing but the run.
  const document = new URL(request.url).searchParams.get("document");
  if (document !== null && document !== "pdf") return json({ ok: false, error: "Unknown document." }, 400);

  const rows =
    document === "pdf"
      ? await sql`
          select r.project_id, r.document_kind, a.storage_path, a.filename, a.content_type
          from intake_runs r
          join attachments a
            on a.id::text = r.parsed->'pdfSource'->>'attachmentId'
           and a.entity_type = 'project' and a.entity_id = r.project_id
          where r.id = ${id}
        `
      : await sql`
          select r.project_id, r.document_kind, a.storage_path, a.filename, a.content_type
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

    const served =
      String(run.document_kind) === "email"
        ? { contentType: "message/rfc822", inline: false }
        : servedAs(String(run.content_type || source.contentType || "application/octet-stream"));
    const headers = new Headers({
      "content-type": served.contentType,
      // inline, so the browser's own PDF viewer opens it rather than saving a
      // copy of an NDA-covered document into someone's Downloads folder.
      "content-disposition": contentDisposition(served.inline ? "inline" : "attachment", String(run.filename ?? "document")),
      "x-content-type-options": "nosniff",
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
