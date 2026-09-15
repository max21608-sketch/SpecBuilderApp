// Projects. Minimal on purpose: M1 needs somewhere to hang an import, not a
// project management screen. TOE dates are nullable and unused until there is
// a live programme to compute against.
//
// ARCHIVED, NEVER DELETED, and the list hides archived projects by default.
// A delivered project is the record of what was specified and quoted, and it
// holds the client ref -> BWS job number mapping that exists nowhere else in
// the business -- so there is no delete here and there should not be one. The
// only thing that was missing was somewhere for a finished project to go, which
// is why every project ever created was on this screen forever.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

// Needed the moment this route started reading a query string: without it Next
// caches the default (active-only) response and the "include archived" toggle
// returns the same list.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // Opt-in, not a filter that defaults to everything: the point of archiving is
  // that a finished project stops being in the way.
  const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";

  const rows = await sql`
    select p.id, p.bws_project_number, p.name, p.client, p.status,
           p.archived_at::text, p.archived_by,
           (select count(*) from spec_records r where r.project_id = p.id) as record_count
    from projects p
    where (${includeArchived} or p.status = 'active')
    order by
      -- Active first when both are shown, so archiving a project moves it out
      -- of the way even for somebody who asked to see everything.
      case p.status when 'active' then 0 else 1 end,
      p.bws_project_number
  `;
  return json({ ok: true, projects: rows });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  let body: { bwsProjectNumber?: unknown; name?: unknown; client?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const number = typeof body.bwsProjectNumber === "string" ? body.bwsProjectNumber.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!number || !name) {
    return json({ ok: false, error: "A BWS project number and a name are both required." }, 400);
  }
  const clientName = typeof body.client === "string" && body.client.trim() ? body.client.trim() : null;

  const existing = await sql`select id from projects where bws_project_number = ${number}`;
  if (existing[0]) {
    return json({ ok: false, error: `Project ${number} already exists.` }, 409);
  }

  const rows = await sql`
    insert into projects (bws_project_number, name, client, created_by, updated_by)
    values (${number}, ${name}, ${clientName}, ${user.email}, ${user.email})
    returning id, bws_project_number, name, client
  `;
  return json({ ok: true, project: rows[0] }, 201);
}
