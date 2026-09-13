// Projects. Minimal on purpose: M1 needs somewhere to hang an import, not a
// project management screen. TOE dates are nullable and unused until there is
// a live programme to compute against.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export async function GET(): Promise<Response> {
  const rows = await sql`
    select p.id, p.bws_project_number, p.name, p.client,
           (select count(*) from spec_records r where r.project_id = p.id) as record_count
    from projects p
    order by p.bws_project_number
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
