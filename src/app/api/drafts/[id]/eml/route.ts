// Downloading the draft as an Outlook-openable .eml.
//
// ============================================================================
// THIS IS THE ONLY WAY MAIL LEAVES THIS APP, AND IT IS NOT A SEND.
//
// The response is a FILE. The human opens it, reads it, and presses send in
// their own Outlook, from their own mailbox. There is no SMTP client, no Graph
// send scope and no mail dependency anywhere in this repo, and
// EMAIL_MODE=disabled describes that rather than switching it off.
//
// Downloading records nothing. Telling the app it was sent is a separate,
// explicit act — see ./confirm-sent.
//
// ============================================================================
// STAGING MUST NOT BE ABLE TO EMAIL A CLIENT
//
// A `[STAGING]` subject prefix does not stop anything: the file still carries
// the designer's real address and the project inbox, and one QA click in
// Outlook sends it. house/conventions.md is explicit — "Staging never sends to
// real recipients."
//
// So outside production, To and Cc are BOTH rewritten to the signed-in user,
// and the addresses the production draft would have used are reported in
// headers on the response for the screen to display. The Cc path stays
// testable without addressing p17231@benwhistler.com.
// ============================================================================
import { json } from "@/lib/db";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { currentAppEnvIsProduction } from "@/lib/env";
import { buildEml, formatAddress } from "@/lib/eml";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const rows = await sql`
    select d.id, d.status, d.subject, d.body, d.body_format, d.version,
           d.recipient_name, d.recipient_email, d.cc_email, d.project_label,
           c.name as contact_name
    from email_drafts d
    join project_contacts c on c.id = d.contact_id
    where d.id = ${id}
  `;
  const draft = rows[0];
  if (!draft) return json({ ok: false, error: "No such draft." }, 404);

  // Works for a sent or voided draft too — re-downloading one is retrieving
  // history, not re-sending it.
  const requested = new URL(request.url).searchParams.get("version");
  if (requested !== null && Number(requested) !== Number(draft.version)) {
    return json(
      {
        ok: false,
        conflict: true,
        code: "draft_version_stale",
        error: "This draft has changed since the page loaded. Reload and download it again.",
        currentVersion: Number(draft.version),
      },
      409,
    );
  }

  const intendedName = String(draft.recipient_name ?? draft.contact_name ?? "");
  const intendedTo = String(draft.recipient_email ?? "").trim();
  const intendedCc = String(draft.cc_email ?? "").trim();
  const isProduction = currentAppEnvIsProduction();

  // An unresolved address yields an empty To rather than a guessed one:
  // Outlook opens the draft with the recipient line blank, which is obvious.
  const to = isProduction
    ? formatAddress(intendedName, intendedTo)
    : formatAddress(`[STAGING] ${intendedName || "test recipient"}`, user.email);
  const cc = isProduction
    ? formatAddress(null, intendedCc)
    : intendedCc
      ? formatAddress("[STAGING] project inbox", user.email)
      : "";

  const eml = buildEml({
    from: formatAddress(user.name, user.email),
    to,
    cc,
    subject: String(draft.subject),
    body: String(draft.body),
    format: String(draft.body_format) === "html" ? "html" : "text",
    date: new Date(),
  });

  // Allowlist, not a denylist: this value lands in a Content-Disposition
  // header, so quotes and CR/LF must not survive.
  const safeName = `${String(draft.project_label)} ${intendedName}`
    .replace(/[^A-Za-z0-9 &-]/g, "")
    .slice(0, 60)
    .trim();

  return new Response(eml, {
    status: 200,
    headers: {
      "content-type": "message/rfc822",
      "content-disposition": `attachment; filename="Spec chase - ${safeName || "draft"}.eml"`,
      // Never cached: it contains client contact details and is regenerated
      // cheaply. A shared cache holding it would be a quiet data leak.
      "cache-control": "private, no-store",
      // So the screen can say exactly who the real email would have gone to.
      "x-draft-version": String(draft.version),
      "x-intended-to": isProduction ? "" : intendedTo,
      "x-intended-cc": isProduction ? "" : intendedCc,
    },
  });
}
