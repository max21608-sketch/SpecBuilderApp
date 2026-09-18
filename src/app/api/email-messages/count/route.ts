// How many emails are sitting in the inbox with nobody on them.
//
// It is the ONE number the top bar carries, and it is there because an unplaced
// email is the only thing in this app that silently stops work: the sender
// believes they have told us, and no project screen says otherwise. The inbox
// is project-less by nature, so without a marker on the chrome it is a page
// somebody has to remember to visit.
//
// THE PREDICATE IS THE INBOX ROUTE'S, WORD FOR WORD — `routing_status <>
// 'assigned' and triage = 'open'`, the same clause that produces `heldCount`
// there. A bubble counting something slightly different from the list it opens
// is worse than no bubble, because the reader trusts it and then finds nothing.
//
// Not folded onto `/api/auth/me`: that is the environment-identity endpoint a
// deployment check reads, and it answers "what am I connected to", not "what is
// waiting for me". Mixing a workload count into it means a person verifying a
// deployment has to reason about a query that touches project data.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  const rows = await sql`
    select count(*)::int as n from email_messages
    where routing_status <> 'assigned' and triage = 'open'
  `;

  return json({ ok: true, unplaced: Number(rows[0]?.n ?? 0) });
}
