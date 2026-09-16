// Re-read a linked contact from Capsule.
//
// A READ that updates this app's cached copy, and nothing else. Capsule is
// never written to; if the person has been renamed or moved organisation
// there, this is how that reaches the chase screen.
//
// Two things it deliberately does NOT do:
//
//   * It never clears a stored email. If the address is no longer one Capsule
//     lists, that is REPORTED — somebody may have corrected it here on purpose
//     after a bounce, and a refresh silently blanking the only way to reach a
//     designer is the worst outcome available.
//   * It never rewrites an existing draft. A draft holds its own recipient
//     snapshot so it renders tomorrow the way it was reviewed today.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { CapsuleNotConfiguredError, CapsuleUpstreamError, getParty } from "@/lib/capsule";

export const dynamic = "force-dynamic";

const Body = z.object({ version: z.number().int().nonnegative() }).strict();

export async function POST(
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
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "Send the version you were looking at." }, 400);

  // Scope resolved from the stored row: a contact id from another project must
  // not be refreshable by addressing it through this project's URL.
  const rows = await sql`
    select id, project_id, email, capsule_party_id, version
    from project_contacts where id = ${contactId} and project_id = ${id}
  `;
  const contact = rows[0];
  if (!contact) return json({ ok: false, error: "No such contact on this project." }, 404);
  if (!contact.capsule_party_id) {
    return json({ ok: false, error: "This contact is not linked to Capsule, so there is nothing to refresh." }, 400);
  }

  let party;
  try {
    party = await getParty(Number(contact.capsule_party_id));
  } catch (cause) {
    if (cause instanceof CapsuleNotConfiguredError) {
      return json({ ok: false, code: "capsule_not_configured", error: cause.message }, 503);
    }
    if (cause instanceof CapsuleUpstreamError) {
      return json({ ok: false, code: "capsule_upstream", error: cause.message }, 502);
    }
    throw cause;
  }

  if (!party) {
    return json(
      {
        ok: false,
        error: "That Capsule contact no longer exists. Unlink this contact or search for the right party.",
      },
      404,
    );
  }

  const updated = await sql`
    update project_contacts
    set name = ${party.name},
        organisation = ${party.organisation?.name ?? null},
        capsule_party_type = ${party.type},
        capsule_synced_at = now(),
        updated_by = ${user.email}
    where id = ${contactId} and project_id = ${id} and version = ${parsed.data.version}
    returning id, name, email, organisation, role, designer_code, version,
              capsule_party_id, capsule_party_type, capsule_synced_at
  `;
  if (!updated[0]) {
    return json(
      {
        ok: false,
        conflict: true,
        code: "contact_version_stale",
        error: "This contact changed while you had it open. Reload and try again.",
      },
      409,
    );
  }

  const stored = contact.email ? String(contact.email).toLowerCase() : null;
  return json({
    ok: true,
    contact: updated[0],
    // Reported, never acted on.
    emailNotInCapsule: Boolean(stored && party.emails.length > 0 && !party.emails.includes(stored)),
    capsuleEmails: party.emails,
  });
}
