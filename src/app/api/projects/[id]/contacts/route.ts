// The people a chase email can be addressed to.
//
// These exist as their own endpoints, separate from drafts, for one concrete
// reason: on a brand-new project there is nobody to chase, so the blocked-record
// banner has to be able to create a contact BEFORE any draft exists. Hanging
// contact creation off a draft card would make that circular.
//
// email is optional here on purpose. Modelling "the LCS design team owe us
// these answers" is useful before anyone has dug the address out of Outlook;
// the missing address blocks recording a send, which is the right place for it.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { CONTACT_ROLES } from "@/lib/spec-vocab";
import { CapsuleNotConfiguredError, CapsuleUpstreamError, getParty } from "@/lib/capsule";

// Matches the check constraint in 0005. A display name with a comma is fine
// (eml.ts quotes it); a CR/LF or a second mailbox is not.
const EMAIL = /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/;

const ContactInput = z.object({
  name: z.string().trim().min(1, "A contact name is required.").max(200),
  email: z
    .string()
    .trim()
    .max(320)
    .regex(EMAIL, "That does not look like a single email address.")
    .nullable()
    .optional(),
  organisation: z.string().trim().max(200).nullable().optional(),
  role: z.enum(CONTACT_ROLES),
  // Joined against spec_records.designer, which is free text off the BOQ. The
  // constraint requires it already normalised, so normalise here rather than
  // handing the user a constraint violation.
  designerCode: z.string().trim().max(40).nullable().optional(),
  // The Capsule party this person IS. Optional: a designer Capsule has never
  // heard of still has to be chaseable today, and a tool that refuses to record
  // them just moves the record into somebody's head. Unlinked contacts are
  // flagged on screen instead.
  capsulePartyId: z.number().int().positive().nullable().optional(),
});

/**
 * The party, re-read from Capsule rather than taken from the request.
 *
 * A client could otherwise claim any id and any name for it, and the link is
 * the thing that makes the contact trustworthy. Returns null when no id was
 * given; throws (and the caller 503s) when Capsule cannot answer, so a contact
 * is never recorded as linked to something nobody checked.
 */
async function resolveParty(capsulePartyId: number | null | undefined, email: string | null) {
  if (capsulePartyId === null || capsulePartyId === undefined) return null;
  const party = await getParty(capsulePartyId);
  if (!party) {
    return { error: "That Capsule contact no longer exists. Search again." };
  }
  // The address has to be one Capsule holds for them, or the link says this is
  // that person while the email goes somewhere else.
  if (email && party.emails.length > 0 && !party.emails.includes(email.toLowerCase())) {
    return {
      error: `Capsule does not list ${email} for ${party.name}. Choose one of their addresses, or leave it blank.`,
    };
  }
  return { party };
}

function capsuleErrorResponse(cause: unknown): Response | null {
  if (cause instanceof CapsuleNotConfiguredError) {
    return json({ ok: false, code: "capsule_not_configured", error: cause.message }, 503);
  }
  if (cause instanceof CapsuleUpstreamError) {
    return json({ ok: false, code: "capsule_upstream", error: cause.message }, 502);
  }
  return null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const rows = await sql`
    select id, name, email, organisation, role, designer_code, version,
           capsule_party_id, capsule_party_type, capsule_synced_at
    from project_contacts
    where project_id = ${id}
    order by role, name
  `;
  return json({ ok: true, contacts: rows });
}

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

  const parsed = ContactInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That contact is not valid." }, 400);
  }

  const project = await sql`select id from projects where id = ${id}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  const designerCode = blankToNull(parsed.data.designerCode)?.toUpperCase() ?? null;

  if (designerCode) {
    const clash = await sql`
      select name from project_contacts where project_id = ${id} and designer_code = ${designerCode}
    `;
    if (clash[0]) {
      return json(
        {
          ok: false,
          conflict: true,
          error:
            `${String(clash[0].name)} is already the default contact for ${designerCode}. ` +
            `Add this person without a designer code and pick them explicitly, or change the existing one.`,
        },
        409,
      );
    }
  }

  const email = blankToNull(parsed.data.email);

  // Resolved BEFORE the insert: a contact is never recorded as linked to a
  // party nobody read. Capsule unreachable means nothing is written.
  let linked = null;
  try {
    const resolved = await resolveParty(parsed.data.capsulePartyId, email);
    if (resolved && "error" in resolved) return json({ ok: false, error: resolved.error }, 400);
    linked = resolved?.party ?? null;
  } catch (cause) {
    const response = capsuleErrorResponse(cause);
    if (response) return response;
    throw cause;
  }

  const rows = await sql`
    insert into project_contacts
      (project_id, name, email, organisation, role, designer_code,
       capsule_party_id, capsule_party_type, capsule_synced_at, created_by, updated_by)
    values (${id}, ${linked ? linked.name : parsed.data.name}, ${email},
            ${linked?.organisation?.name ?? blankToNull(parsed.data.organisation)},
            ${parsed.data.role}, ${designerCode},
            ${linked ? linked.id : null}, ${linked ? linked.type : null},
            ${linked ? new Date().toISOString() : null},
            ${user.email}, ${user.email})
    returning id, name, email, organisation, role, designer_code, version,
              capsule_party_id, capsule_party_type, capsule_synced_at
  `;
  return json({ ok: true, contact: rows[0] }, 201);
}
