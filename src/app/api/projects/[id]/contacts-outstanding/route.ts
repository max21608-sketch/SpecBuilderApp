// WHO OWES US WHAT — the Contacts table's "Owes us" column, on its own.
//
// It lived inside `GET /api/projects/[id]` until 2026-09-22 and was the whole
// weight of that request: `loadOutstanding` returns every outstanding question
// in the project — 19,655 of them and 19.2 MB on the sandbox's 300-line
// project, measured — to produce three integers per contact, and the tiles,
// the documents, the phases and the notes all waited behind it. The overview
// took 10.4 seconds to render where the plan asks for under two
// (`found-in-use.md`, 2026-09-20).
//
// SPLIT, NOT REWRITTEN. This is the CHASE SCREEN'S OWN grouping, called rather
// than reproduced: `loadOutstanding` tiers every question through
// `questionTier` and `groupByContact` decides which contact each record's
// free-text designer resolves to. Counting it in SQL instead would put
// `designerKey`'s folding and the split-line predicate in a second place, and
// this column and the chase screen would then report different numbers for one
// contact — which is the disagreement the TGQ split already cost a day. The
// numbers are identical to what the combined route returned; only the moment
// they arrive has moved.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { groupByContact, loadOutstanding, type ProjectContact } from "@/lib/chase-drafts";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const exists = await sql`select id from projects where id = ${id}`;
  if (!exists[0]) return json({ ok: false, error: "No such project." }, 404);

  const contactRows = await sql`
    select id, name, email, organisation, role, designer_code, version
    from project_contacts where project_id = ${id} order by role, name
  `;
  const contacts: ProjectContact[] = contactRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: row.email === null || row.email === undefined ? null : String(row.email),
    organisation: row.organisation === null || row.organisation === undefined ? null : String(row.organisation),
    role: String(row.role) as ProjectContact["role"],
    designerCode: row.designer_code === null || row.designer_code === undefined ? null : String(row.designer_code),
    version: Number(row.version),
  }));

  const outstanding = await loadOutstanding(id);
  const { groups, blocked } = groupByContact(outstanding, contacts);

  // THREE BUCKETS, BECAUSE TWO WOULD NOT ADD UP. `groupByContact` also holds
  // back a record with no LEVEL, which belongs to a contact and still cannot be
  // chased; folding those into `unassigned` would say nobody owns them, and
  // dropping them would leave the table short of the project's own total. The
  // bucket a question falls in is read off `blocked`'s own reason, never
  // re-decided here.
  //
  // A tier of null is its own count. `questionTierOrNull` refuses to pick a
  // reading where the fallback model has no level, so adding those into either
  // column would be this route answering a question only a person can.
  const tally = (questions: { tier: string | null }[]) => ({
    toQuote: questions.filter((q) => q.tier === "to_quote").length,
    alsoOutstanding: questions.filter((q) => q.tier === "later").length,
    noTier: questions.filter((q) => q.tier === null).length,
  });
  const recordsWithNoContact = new Set(
    blocked.filter((row) => row.reason !== "no level on the record").map((row) => row.recordId),
  );
  const recordsWithNoLevel = new Set(
    blocked.filter((row) => row.reason === "no level on the record").map((row) => row.recordId),
  );

  return json({
    ok: true,
    contactsOutstanding: {
      byContact: groups.map((group) => ({
        contactId: group.contact.id,
        contactName: group.contact.name,
        ...tally(group.questions),
      })),
      unassigned: {
        ...tally(outstanding.filter((question) => recordsWithNoContact.has(question.recordId))),
        records: blocked.filter((row) => row.reason !== "no level on the record").length,
      },
      noLevel: {
        ...tally(outstanding.filter((question) => recordsWithNoLevel.has(question.recordId))),
        records: recordsWithNoLevel.size,
      },
    },
  });
}
