// The app's inbox: every email that has arrived, and where it went.
//
// Held messages come FIRST and are never hidden. An email nobody has placed is
// the one thing in this feature that silently stops work: the sender believes
// they have told us, and nothing on any project screen says otherwise.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const includeTriaged = url.searchParams.get("includeTriaged") === "1";

  const rows = await sql`
    select em.id, em.origin, em.mailbox, em.fetch_status, em.fetch_error,
           em.from_addr, em.from_name, em.subject, em.received_at, em.has_attachments,
           em.attachments_meta, em.routing_status, em.routing_reason, em.routing_candidates,
           em.project_id, em.assigned_by, em.assigned_at, em.assignment_kind,
           em.intake_run_id, em.chase_draft_id, em.chase_match, em.triage, em.parse_error,
           em.version, em.created_at,
           p.bws_project_number, p.name as project_name,
           r.status as run_status, r.error as run_error,
           -- How much of the email is still waiting on a person. Computed from
           -- the staged JSON rather than stored: a blocker frozen at extraction
           -- time is stale by the first edit.
           (select count(*) from jsonb_array_elements(coalesce(r.parsed -> 'lines', '[]'::jsonb)) line
             where line ->> 'reviewStatus' = 'pending') as pending_count,
           (select count(*) from jsonb_array_elements(coalesce(r.parsed -> 'lines', '[]'::jsonb)) line
             where line ->> 'reviewStatus' = 'applied') as applied_count
    from email_messages em
    left join projects p on p.id = em.project_id
    left join intake_runs r on r.id = em.intake_run_id
    where (${projectId}::uuid is null or em.project_id = ${projectId}::uuid)
      and (${includeTriaged}::boolean or em.triage = 'open')
    order by
      -- Unplaced first: it is the only state where nothing else will happen.
      case em.routing_status when 'assigned' then 1 else 0 end,
      em.received_at desc nulls last,
      em.created_at desc
    limit 200
  `;

  const heldRows = await sql`
    select count(*)::int as n from email_messages
    where routing_status <> 'assigned' and triage = 'open'
  `;

  // Every live project, so the Unassigned list can offer a destination without
  // a second round trip.
  const projects = await sql`
    select id, bws_project_number, name from projects where status <> 'archived'
    order by bws_project_number
  `;

  return json({
    ok: true,
    messages: rows,
    heldCount: Number(heldRows[0]?.n ?? 0),
    projects,
  });
}
