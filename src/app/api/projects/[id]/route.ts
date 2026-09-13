// One project, and the small amount of it that is editable.
//
// shared_inbox exists in the schema since 0002 and had no way to set it. A
// chase email copies the project inbox, so leaving it unreachable would mean
// either no Cc at all or an address invented in code — and an invented address
// on a message a human sends to a client is not a small mistake.
//
// An unset inbox is a visible state, not an error: "no Cc" is a legitimate
// choice and the draft screen says which one is in force.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

const EMAIL = /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/;

const ProjectPatch = z.object({
  version: z.number().int(),
  sharedInbox: z
    .string()
    .trim()
    .max(320)
    .regex(EMAIL, "That does not look like a single email address.")
    .nullable()
    .optional(),
});

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const rows = await sql`
    select id, bws_project_number, name, client, shared_inbox, order_date, specs_agreed_by, delivery_date, version
    from projects where id = ${id}
  `;
  if (!rows[0]) return json({ ok: false, error: "No such project." }, 404);
  return json({ ok: true, project: rows[0] });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const parsed = ProjectPatch.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That change is not valid." }, 400);
  }
  if (!("sharedInbox" in parsed.data)) {
    return json({ ok: false, error: "Nothing to change." }, 400);
  }

  const trimmed = (parsed.data.sharedInbox ?? "").trim();
  const sharedInbox = trimmed === "" ? null : trimmed;

  const rows = await sql`
    update projects
    set shared_inbox = ${sharedInbox}, updated_by = ${user.email}
    where id = ${id} and version = ${parsed.data.version}
    returning id, bws_project_number, name, client, shared_inbox, version
  `;

  if (!rows[0]) {
    const current = await sql`select id, shared_inbox, version, updated_by from projects where id = ${id}`;
    if (!current[0]) return json({ ok: false, error: "No such project." }, 404);
    return json(
      {
        ok: false,
        conflict: true,
        code: "project_version_stale",
        error: `This project was changed by ${String(current[0].updated_by ?? "someone else")} while you were editing. Reload and try again.`,
        current: current[0],
      },
      409,
    );
  }

  return json({ ok: true, project: rows[0] });
}
