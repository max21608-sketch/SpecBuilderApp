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
import { readAttachment, sameListedAttachment } from "@/lib/email-envelope";
import { contentDisposition } from "@/lib/content-disposition";
import { requireUuid } from "@/lib/route-guards";

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
  const badId = requireUuid(id);
  if (badId) return badId;

  const position = Number(index);
  if (!Number.isInteger(position) || position < 0) {
    return json({ ok: false, error: "That is not an attachment on this message." }, 400);
  }

  // The message row is the LIST the screen rendered (`attachments_meta`, written
  // at registration). `intake_run_id` is unique on email_messages, so at most
  // one row joins.
  const rows = await sql`
    select r.project_id, r.document_kind, a.storage_path,
           em.id as message_id, em.origin as message_origin, em.attachments_meta
    from intake_runs r
    join attachments a on a.id = r.attachment_id
    left join email_messages em on em.intake_run_id = r.id
    where r.id = ${id}
  `;
  const run = rows[0];
  if (!run) return json({ ok: false, error: "That document has no stored file." }, 404);
  // Only an email HAS attachments in this sense. A PDF's own embedded files are
  // not something this app has ever read, and answering for one here would be
  // a second meaning for the same URL.
  if (String(run.document_kind) !== "email") {
    return json({ ok: false, error: "That document is not an email." }, 404);
  }

  // NOTHING IS SENT WITHOUT THE LIST IT WAS CLICKED FROM. The screen offers a
  // download only off the message row joined above, so a run with none (the
  // email was taken off this project, which clears the link) was not reached
  // by a click, and there is nothing to check the index against.
  if (!run.message_id) {
    return json(
      {
        ok: false,
        code: "email_not_on_document",
        error: "This email is no longer on this document, so its attachments are not served here. Find it in the inbox.",
      },
      404,
    );
  }
  const listed = Array.isArray(run.attachments_meta) ? run.attachments_meta[position] : undefined;
  if (!listed) {
    return json({ ok: false, error: "That message does not carry that attachment." }, 404);
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

  // `readAttachment` takes the index against ONE parse, so its list and its
  // bytes agree; whether that list is still the one the screen rendered is the
  // comparison below.
  const found = await readAttachment(bytes, position);
  if (!found) {
    return json({ ok: false, error: "That message does not carry that attachment." }, 404);
  }
  const { meta, bytes: body } = found;

  // THE FILE SENT IS THE FILE CLICKED, or nothing is sent. The bytes are
  // re-parsed now and the list was parsed at registration; a parser that reads
  // the message differently (postal-mime 4, 2026-11-20) moves the index, and
  // the browser would save a different document under the name the person
  // clicked. `sameListedAttachment` says what is compared and why the size is
  // compared only on an upload.
  if (!sameListedAttachment(listed, meta, { sizeComparable: String(run.message_origin) === "upload" })) {
    return json(
      {
        ok: false,
        code: "attachment_changed",
        error:
          'This attachment reads differently now from when the email arrived, so it is not sent in case it is a different file. Use "open the .eml" and save it from your mail program.',
      },
      409,
    );
  }

  // A filename a stranger chose, in any script. `contentDisposition` keeps it
  // inside the header and keeps `Headers` from throwing on a character above
  // U+00FF (audit A6: that throw was an unhandled, non-JSON 500 here).
  const filename = meta.filename ?? `attachment-${position + 1}`;

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: new Headers({
      "content-type": meta.contentType || "application/octet-stream",
      // ALWAYS a download, never inline. The .eml route's rule: this is a file
      // somebody outside the company attached, and a browser rendering it is
      // this app showing a stranger's markup as its own.
      "content-disposition": contentDisposition("attachment", filename),
      "x-content-type-options": "nosniff",
      "content-length": String(body.byteLength),
      // Client specification material. A shared cache holding it is a
      // disclosure waiting to happen.
      "cache-control": "private, no-store",
    }),
  });
}
