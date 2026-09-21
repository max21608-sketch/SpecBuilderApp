// One file that came attached to an email, handed to the person who has to
// decide what it is.
//
// ============================================================================
// WHY THIS EXISTS — Stage 2 variance row 4 (plan §6.10.c).
//
// Specification arrives as an attachment constantly: the email says "sizes
// attached" and the sizes are in a PDF. The body is read as it always was, and
// the attachment is LISTED as not read — a document's kind is declared by a
// person and reading one is a charged call, so nothing about it is automatic.
// But listing it was the whole of it: the only way to reach the bytes was to
// download the whole .eml, open it in a mail client, save the attachment out
// and then upload it as its own intake document. Four steps, three of them
// outside this app.
//
// So the attachment is served on its own, and the upload that follows is the
// ordinary registration with its ordinary charge on the button.
//
// ============================================================================
// WHAT THIS IS NOT.
//
// IT REGISTERS NOTHING AND SPENDS NOTHING. No `intake_runs` row, no attempt,
// no model call. It is a read, and the hard gate on placing an inbound email on
// a project — the thing that starts the charged read — is untouched.
//
// THE CLIENT NAMES AN IMPORT AND AN INDEX, AND NOTHING ELSE. The pathname is
// resolved from the RUN'S OWN attachment row and re-checked against the run's
// project prefix on the way out, which is `blob-source.ts`'s rule: there is no
// value here that could point a store credential anywhere. The index is
// checked against what the message actually carries.
//
// NOTHING IS RENDERED. An attachment on an email from outside the company is
// bytes a stranger chose, so it goes out as a download with `nosniff` — the
// same treatment the .eml itself gets, for the same reason.
// ============================================================================
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { readAttachment } from "@/lib/email-envelope";

export const dynamic = "force-dynamic";

/** The same ceiling registration puts on a message. */
const MAX_EMAIL_BYTES = 30 * 1024 * 1024;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; index: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id, index } = await context.params;

  const position = Number(index);
  if (!Number.isInteger(position) || position < 0) {
    return json({ ok: false, error: "That is not an attachment on this message." }, 400);
  }

  const rows = await sql`
    select r.project_id, r.document_kind, a.storage_path
    from intake_runs r
    join attachments a on a.id = r.attachment_id
    where r.id = ${id}
  `;
  const run = rows[0];
  if (!run) return json({ ok: false, error: "That import has no stored document." }, 404);
  // Only an email HAS attachments in this sense. A PDF's own embedded files are
  // not something this app has ever read, and answering for one here would be
  // a second meaning for the same URL.
  if (String(run.document_kind) !== "email") {
    return json({ ok: false, error: "That import is not an email." }, 404);
  }

  let bytes: Buffer;
  try {
    const blob = await readTrustedBlob(String(run.storage_path), String(run.project_id), {
      maxBytes: MAX_EMAIL_BYTES,
    });
    bytes = blob.bytes;
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 404);
    console.error("email attachment read failed", cause);
    return json({ ok: false, error: "That message could not be read." }, 502);
  }

  // `readAttachment` takes the index against the SAME parse that produced the
  // list the screen renders, so the route cannot serve file three while the
  // screen was naming file four.
  const found = await readAttachment(bytes, position);
  if (!found) {
    return json({ ok: false, error: "That message does not carry that attachment." }, 404);
  }
  const { meta, bytes: body } = found;

  // A filename a stranger chose. Quotes, backslashes and newlines are stripped
  // so it cannot break out of the header, and a missing one gets a plain name
  // rather than an invented extension.
  const filename = (meta.filename ?? `attachment-${position + 1}`).replace(/["\\\r\n]/g, "");

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: new Headers({
      "content-type": meta.contentType || "application/octet-stream",
      // ALWAYS a download, never inline. The .eml route's rule: this is a file
      // somebody outside the company attached, and a browser rendering it is
      // this app showing a stranger's markup as its own.
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff",
      "content-length": String(body.byteLength),
      // Client specification material. A shared cache holding it is a
      // disclosure waiting to happen.
      "cache-control": "private, no-store",
    }),
  });
}
