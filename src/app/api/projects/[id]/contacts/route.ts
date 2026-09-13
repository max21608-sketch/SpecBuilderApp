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
});

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const rows = await sql`
    select id, name, email, organisation, role, designer_code, version
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

  const rows = await sql`
    insert into project_contacts (project_id, name, email, organisation, role, designer_code, created_by, updated_by)
    values (${id}, ${parsed.data.name}, ${blankToNull(parsed.data.email)},
            ${blankToNull(parsed.data.organisation)}, ${parsed.data.role}, ${designerCode},
            ${user.email}, ${user.email})
    returning id, name, email, organisation, role, designer_code, version
  `;
  return json({ ok: true, contact: rows[0] }, 201);
}
