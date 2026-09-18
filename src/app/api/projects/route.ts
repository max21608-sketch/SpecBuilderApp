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
import { EMPTY_COMPLETION, loadProjectCompletion, projectState } from "@/lib/project-completion";
import { EMPTY_SUMMARY, loadProjectSummaries } from "@/lib/project-summary";

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
           -- ::text, ALWAYS. A date column parsed into local midnight renders
           -- as the day BEFORE in British Summer Time — the TOE-dates trap, and
           -- this list is the newest place it could come back.
           p.specs_agreed_by::text,
           (select count(*) from spec_records r where r.project_id = p.id) as record_count
    from projects p
    where (${includeArchived} or p.status = 'active')
    order by
      -- Active first when both are shown, so archiving a project moves it out
      -- of the way even for somebody who asked to see everything.
      case p.status when 'active' then 0 else 1 end,
      p.bws_project_number
  `;

  // How many archived projects there are, counted WHETHER OR NOT they are
  // being shown: the checkbox has to be able to say what it would reveal, and
  // counting the rows that came back can only ever say what is already on
  // screen.
  const archived = await sql`select count(*)::int as n from projects where status = 'archived'`;

  // COMPLETED is derived, never stored, and it is derived here rather than on
  // the client because the client cannot see an answer. See
  // src/lib/project-completion.ts for what counts.
  const completion = await loadProjectCompletion(rows.map((row) => String(row.id)));
  // The same numbers the overview shows, so the list and the project page
  // cannot report different amounts of work outstanding. One query for the
  // whole page — see loadProjectSummaries.
  const summaries = await loadProjectSummaries(rows.map((row) => String(row.id)));

  return json({
    ok: true,
    archivedCount: Number(archived[0]?.n ?? 0),
    projects: rows.map((row) => {
      const done = completion.get(String(row.id)) ?? EMPTY_COMPLETION;
      return {
        ...row,
        completion: done,
        summary: summaries.get(String(row.id)) ?? EMPTY_SUMMARY,
        state: projectState(String(row.status), done),
      };
    }),
  });
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
