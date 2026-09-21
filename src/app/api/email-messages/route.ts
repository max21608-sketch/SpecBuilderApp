// The app's inbox: every email that has arrived, where it went, and what it
// turned out to say.
//
// Held messages come FIRST and are never hidden. An email nobody has placed is
// the one thing in this feature that silently stops work: the sender believes
// they have told us, and nothing on any project screen says otherwise.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { describeChange } from "@/lib/spec-change";
import type { Proposal } from "@/lib/spec-document";

export const dynamic = "force-dynamic";

/** What a read turned up, for the inbox's "What it found" column. */
type Found = {
  /** Staged proposal lines, whatever their review state. */
  proposals: number;
  /** Distinct runs those lines write to — one email, one code, three runs. */
  runs: number;
  /** How many would CHANGE or WITHDRAW something already settled. */
  changesConfirmed: number;
  /** Read, and it states nothing this app can record. A real outcome. */
  nothingToRecord: boolean;
};

/**
 * What the staged lines add up to.
 *
 * ============================================================================
 * `describeChange` IS THE SINGLE IMPLEMENTATION, AND THAT IS WHY THIS IS TS.
 *
 * The verb a review row carries — provides / confirms / changes / repeats /
 * puts back to TBC — is derived from the TARGET SNAPSHOT the proposal froze,
 * not from the model's wording, because the record is the thing about to be
 * written and the intent is a reading. Counting "how many change a confirmed
 * value" in jsonb would be a second reading of that rule, and the inbox would
 * start promising a number the review screen does not show. So the staged JSON
 * is loaded and the same function is run over it.
 *
 * A `changes` needs an overwrite acknowledgement before it can commit and a
 * `withdraws` does not, and both destroy or override something somebody
 * settled. They are counted together because the column's question is "does
 * this email undo a decision", which is the same question for either.
 * ============================================================================
 */
function summariseFound(parsed: unknown): Found | null {
  if (!parsed || typeof parsed !== "object") return null;
  const lines = (parsed as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return null;

  const proposals = lines as Proposal[];
  const runs = new Set<string>();
  let changesConfirmed = 0;
  for (const proposal of proposals) {
    // Staged JSON is data the app wrote, not input — but it is jsonb, and a
    // column read cannot promise a shape. One bad line must not 500 the inbox.
    if (!proposal || typeof proposal !== "object") continue;
    if (proposal.runId) runs.add(proposal.runId);
    const kind = describeChange(proposal).kind;
    if (kind === "changes" || kind === "withdraws") changesConfirmed += 1;
  }

  return {
    proposals: proposals.length,
    runs: runs.size,
    changesConfirmed,
    // NOT the same as "no project" or "failed". The model read it and it says
    // nothing this app can record — which is worth printing, because a blank
    // column otherwise reads as a document nobody has got to yet.
    nothingToRecord: proposals.length === 0,
  };
}

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
           -- A READ THE CAP DEFERRED, which is not a read nobody started and
           -- not a read that failed. The marker is the pair nothing else
           -- writes: a deadline with no attempt (extraction-slots.ts). Without
           -- it an auto-assigned message over the project's cap renders as
           -- "Reading..." for as long as it waits, and a screen that says the
           -- app is busy on a row where it has not begun is how somebody comes
           -- to distrust the column.
           (r.status = 'pending' and r.attempt_id is null and r.attempt_deadline_at > now())
             as waiting_for_slot,
           -- How much of the email is still waiting on a person. Computed from
           -- the staged JSON rather than stored: a blocker frozen at extraction
           -- time is stale by the first edit.
           (select count(*) from jsonb_array_elements(coalesce(r.parsed -> 'lines', '[]'::jsonb)) line
             where line ->> 'reviewStatus' = 'pending') as pending_count,
           (select count(*) from jsonb_array_elements(coalesce(r.parsed -> 'lines', '[]'::jsonb)) line
             where line ->> 'reviewStatus' = 'applied') as applied_count,
           -- THE STAGED DOCUMENT ITSELF, for a run that has been read. It never
           -- reaches the client: it is summarised below and dropped, because
           -- 200 staged documents is a payload nobody asked for. Withheld for a
           -- run still queued or failed, so "not read yet" and "read, and it
           -- said nothing" stay different answers.
           case when r.status in ('parsed', 'confirmed') then r.parsed else null end as staged
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

  const messages = rows.map((row) => {
    const { staged, ...rest } = row;
    return {
      ...rest,
      found: summariseFound(staged),
      // A HINT, AND ONLY THE CONFIDENT ONE IS PRINTED AS A FACT. `sender_only`
      // and `subject_only` are the resolver's weaker readings and the review
      // screen already says them in words with their caveat; a boolean cannot
      // carry a caveat, so it carries only the reading that needs none. This is
      // the same wording the inbox has shown since 0021.
      chaseReply: String(row.chase_match ?? "") === "confident",
    };
  });

  const heldRows = await sql`
    select count(*)::int as n from email_messages
    where routing_status <> 'assigned' and triage = 'open'
  `;

  // ---- the two tiles -------------------------------------------------------
  //
  // Their own query, not a count over `rows`. The list is capped at 200 and —
  // the half that matters — it hides triaged messages unless asked, so
  // "ruled on this week" computed from it would read zero on exactly the screen
  // it appears on.
  //
  // BOTH SIDES OF THE DAY COMPARISON NAME ONE ZONE. `received_at` is a
  // timestamptz and has no calendar day until something says where: comparing
  // it against a day computed from the Node process's clock would make the tile
  // depend on which region the function ran in, which is the TOE-dates trap
  // wearing a timestamp. Europe/London is named because this app is pinned to
  // the UK — Vercel lhr1, Neon London — and the people reading it are there.
  const counts = await sql`
    select
      count(*) filter (
        where em.received_at is not null
          and (em.received_at at time zone 'Europe/London')::date
              = (now() at time zone 'Europe/London')::date
      )::int as arrived_today,
      -- Ruled on: triaged away from 'open'. The triaged_at column is stamped
      -- by the same constraint that refuses a triaged row with no actor, so it
      -- is never null on one of these. (No backticks anywhere inside a sql
      -- template: one closes it, and esbuild then reports a syntax error
      -- thirty lines away pointing at a word in the comment.)
      count(*) filter (
        where em.triage <> 'open' and em.triaged_at >= now() - interval '7 days'
      )::int as ruled_this_week
    from email_messages em
    where (${projectId}::uuid is null or em.project_id = ${projectId}::uuid)
  `;

  // Every live project, so the Unassigned list can offer a destination without
  // a second round trip.
  const projects = await sql`
    select id, bws_project_number, name from projects where status <> 'archived'
    order by bws_project_number
  `;

  return json({
    ok: true,
    messages,
    heldCount: Number(heldRows[0]?.n ?? 0),
    arrivedToday: Number(counts[0]?.arrived_today ?? 0),
    ruledThisWeek: Number(counts[0]?.ruled_this_week ?? 0),
    projects,
  });
}
