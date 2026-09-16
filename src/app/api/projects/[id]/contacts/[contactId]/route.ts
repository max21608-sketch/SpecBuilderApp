// Editing one contact, under the optimistic lock — same contract as
// /api/answers/[id]: the client sends the version it read, the update is
// predicated on it, and zero rows back is a 409 rather than a silent overwrite.
//
// Correcting an address here does NOT rewrite existing drafts. A draft holds
// its own recipient snapshot so it renders tomorrow the way it was reviewed
// today; changing the register and silently re-addressing a reviewed draft
// would be the opposite of that guarantee.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { CONTACT_ROLES } from "@/lib/spec-vocab";

const EMAIL = /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/;

const ContactPatch = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().max(320).regex(EMAIL, "That does not look like a single email address.").nullable().optional(),
  organisation: z.string().trim().max(200).nullable().optional(),
  role: z.enum(CONTACT_ROLES).optional(),
  designerCode: z.string().trim().max(40).nullable().optional(),
});

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; contactId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id, contactId } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const parsed = ContactPatch.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That change is not valid." }, 400);
  }

  // Scope is resolved from the stored row, never from the path alone: a
  // contact id from another project must not be editable by addressing it
  // through this project's URL.
  const existing = await sql`
    select id, name, email, organisation, role, designer_code, version, updated_by
    from project_contacts
    where id = ${contactId} and project_id = ${id}
  `;
  const current = existing[0];
  if (!current) return json({ ok: false, error: "No such contact on this project." }, 404);

  const next = {
    name: parsed.data.name ?? String(current.name),
    email: "email" in parsed.data ? blankToNull(parsed.data.email) : (current.email as string | null),
    organisation:
      "organisation" in parsed.data
        ? blankToNull(parsed.data.organisation)
        : (current.organisation as string | null),
    role: parsed.data.role ?? String(current.role),
    designerCode:
      "designerCode" in parsed.data
        ? (blankToNull(parsed.data.designerCode)?.toUpperCase() ?? null)
        : (current.designer_code as string | null),
  };

  if (next.designerCode && next.designerCode !== current.designer_code) {
    const clash = await sql`
      select name from project_contacts
      where project_id = ${id} and designer_code = ${next.designerCode} and id <> ${contactId}
    `;
    if (clash[0]) {
      return json(
        {
          ok: false,
          conflict: true,
          error: `${String(clash[0].name)} is already the default contact for ${next.designerCode}.`,
        },
        409,
      );
    }
  }

  const rows = await sql`
    update project_contacts
    set name = ${next.name},
        email = ${next.email},
        organisation = ${next.organisation},
        role = ${next.role},
        designer_code = ${next.designerCode},
        updated_by = ${user.email}
    where id = ${contactId} and project_id = ${id} and version = ${parsed.data.version}
    returning id, name, email, organisation, role, designer_code, version,
              capsule_party_id, capsule_party_type, capsule_synced_at
  `;

  if (!rows[0]) {
    return json(
      {
        ok: false,
        conflict: true,
        code: "contact_version_stale",
        error: `${String(current.name)} was changed by ${String(current.updated_by ?? "someone else")} while you were editing. Reload and try again.`,
        current,
      },
      409,
    );
  }

  return json({ ok: true, contact: rows[0] });
}
