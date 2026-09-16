// Everything the chase screen needs in one read: the project, its contacts,
// the drafts, and the full inventory of outstanding questions.
//
// Three things here are deliberate:
//
//   * Readiness questions are returned SEPARATELY and are not pre-selected.
//     408 of the 728 seeded requirements are readiness questions, and they
//     include deposit status, COM payment plan and BWS folder setup. Those are
//     Ben Whistler's internal commercial checklist. Defaulting them into an
//     email to the client's designer would be a genuinely embarrassing send.
//
//   * A record with no category, or whose category has no authored
//     requirements, is reported as a BLOCKER rather than contributing zero
//     questions. Zero of zero renders as complete, which is the opposite of
//     the truth.
//
//   * Staleness is computed here, server-side, and returned per draft item.
//     The client cannot distinguish "the record was retired" from "somebody
//     answered it" by comparing versions, and those want different words.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import {
  coverageStaleReasons,
  designerKey,
  groupByContact,
  loadOutstanding,
  loadQuestionsByKey,
  loadSentCoverage,
  loadUncategorisedRecords,
  questionKey,
  waitingByQuestion,
  type ContextSnapshot,
  type ProjectContact,
} from "@/lib/chase-drafts";
import { isQuestionTier } from "@/lib/tgq";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // Every other route under /api/drafts checks this. This one did not, which
  // left the whole inventory of a project's outstanding questions readable by
  // anything that got past the middleware — the middleware is the first line,
  // never the only one.
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return json({ ok: false, error: "projectId is required." }, 400);

  const projectRows = await sql`
    select id, bws_project_number, name, client, shared_inbox, version
    from projects where id = ${projectId}
  `;
  const project = projectRows[0];
  if (!project) return json({ ok: false, error: "No such project." }, 404);

  const contactRows = await sql`
    select id, name, email, organisation, role, designer_code, version
    from project_contacts where project_id = ${projectId} order by role, name
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

  const [outstanding, uncategorised, sentCoverage] = await Promise.all([
    loadOutstanding(projectId),
    loadUncategorisedRecords(projectId),
    loadSentCoverage(projectId),
  ]);

  const waiting = waitingByQuestion(outstanding, sentCoverage);
  const { groups, blocked } = groupByContact(outstanding, contacts);

  // The designer codes the BOQ actually used that nobody has been named for.
  // Offered to the contact form so the code is picked, not retyped and
  // mistyped -- it is the join key to spec_records.designer.
  const suggestedCodes = [
    ...new Set(blocked.map((row) => designerKey(row.designer)).filter((code): code is string => Boolean(code))),
  ].sort();

  // Records with a category and no level. `groupByContact` already blocks the
  // ones carrying questions; this list also catches a record whose questions
  // are all answered, so the level can be set before the next document lands.
  const levelless = await sql`
    select r.id, r.record_no, r.item_description, r.version, p.bws_project_number
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    where r.project_id = ${projectId} and r.status = 'active' and run.status = 'active'
      and r.category_id is not null and r.level is null
    order by r.record_no
  `;

  // A category nobody has authored requirements for scores 0/0 and renders
  // green. Surface it next to the real blockers.
  const unauthored = await sql`
    select r.id, r.record_no, r.item_description, c.name as category_name, p.bws_project_number
    from spec_records r
    join projects p on p.id = r.project_id
    join item_categories c on c.id = r.category_id
    where r.project_id = ${projectId} and r.status = 'active' and c.requirements_authored = false
    order by r.record_no
  `;

  // ---- drafts, newest first, with their coverage and its staleness ---------
  const draftRows = await sql`
    select d.id, d.status, d.subject, d.body, d.body_format, d.intro_text, d.closing_text,
           d.recipient_name, d.recipient_email, d.cc_email, d.project_label,
           d.contact_id, d.contact_version, d.generated_at, d.version,
           d.manually_edited_at, d.manually_edited_by,
           d.sent_at, d.sent_by, d.voided_at, d.voided_by, d.void_reason,
           c.name as contact_name, c.email as contact_email
    from email_drafts d
    join project_contacts c on c.id = d.contact_id
    where d.project_id = ${projectId} and d.status <> 'superseded'
    order by case d.status when 'draft' then 0 when 'sent' then 1 else 2 end,
             d.generated_at desc
  `;

  const itemRows = draftRows.length
    ? await sql`
        select i.draft_id, i.record_id, i.requirement_id, i.revision_no, i.answer_id,
               i.snapshot_answer_version, i.record_version, i.context_snapshot,
               i.prompt_text, i.field_label, i.current_value_text, i.sort_order, i.tier
        from email_draft_items i
        where i.draft_id = any(${draftRows.map((d) => String(d.id))}::uuid[])
        order by i.sort_order
      `
    : [];

  // Live state for every covered question, whatever it is now — so the diff
  // can say "they answered it" rather than "it is gone".
  const liveByKey = await loadQuestionsByKey(
    itemRows.map((row) => ({ recordId: String(row.record_id), requirementId: String(row.requirement_id) })),
  );

  const itemsByDraft = new Map<string, unknown[]>();
  for (const row of itemRows) {
    const key = questionKey(String(row.record_id), String(row.requirement_id), Number(row.revision_no));
    const live = liveByKey.get(key) ?? null;
    const staleReasons = coverageStaleReasons(
      {
        recordId: String(row.record_id),
        requirementId: String(row.requirement_id),
        revisionNo: Number(row.revision_no),
        answerId: row.answer_id === null || row.answer_id === undefined ? null : String(row.answer_id),
        snapshotAnswerVersion:
          row.snapshot_answer_version === null || row.snapshot_answer_version === undefined
            ? null
            : Number(row.snapshot_answer_version),
        recordVersion: Number(row.record_version),
        context: row.context_snapshot as ContextSnapshot,
      },
      live,
    );

    const list = itemsByDraft.get(String(row.draft_id)) ?? [];
    list.push({
      recordId: String(row.record_id),
      requirementId: String(row.requirement_id),
      revisionNo: Number(row.revision_no),
      recordLabel: (row.context_snapshot as ContextSnapshot)?.recordLabel ?? "",
      refs: (row.context_snapshot as ContextSnapshot)?.refs ?? "",
      prompt: String(row.prompt_text),
      fieldLabel: row.field_label === null || row.field_label === undefined ? null : String(row.field_label),
      currentValueText:
        row.current_value_text === null || row.current_value_text === undefined
          ? null
          : String(row.current_value_text),
      liveState: live?.state ?? null,
      tier: isQuestionTier(row.tier) ? row.tier : null,
      // Advisory, never a stale reason: a question moving between the two
      // halves is a gate revision, not a change to any answer, and making it
      // stale would 409 every draft the moment the TGQ workbook is applied.
      tierChanged: isQuestionTier(row.tier) && live?.tier != null && live.tier !== row.tier,
      liveTier: live?.tier ?? null,
      staleReasons,
    });
    itemsByDraft.set(String(row.draft_id), list);
  }

  const drafts = draftRows.map((row) => {
    const items = itemsByDraft.get(String(row.id)) ?? [];
    return {
      ...row,
      items,
      // Only an editable draft can be refreshed, so only an editable draft's
      // staleness is actionable. A sent draft's coverage moving on is normal.
      staleCount:
        String(row.status) === "draft"
          ? items.filter((item) => ((item as { staleReasons: string[] }).staleReasons ?? []).length > 0).length
          : 0,
    };
  });

  const specFieldOutstanding = outstanding.filter((q) => q.requirementKind === "spec_field");
  const readinessOutstanding = outstanding.filter((q) => q.requirementKind === "readiness");

  return json({
    ok: true,
    project,
    contacts,
    drafts,
    inventory: {
      // Grouped by the contact each record's designer resolves to.
      groups: groups.map((group) => ({
        contact: group.contact,
        questions: group.questions.map((question) => ({
          ...question,
          // The client renders this; it never decides eligibility from it.
          waiting: waiting.get(questionKey(question.recordId, question.requirementId, 0)) ?? null,
        })),
      })),
      blocked,
      suggestedCodes,
      uncategorised,
      unauthored,
      levelless: levelless.map((row) => ({
        recordId: String(row.id),
        recordLabel: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
        itemDescription: String(row.item_description ?? ""),
        version: Number(row.version),
      })),
      totals: {
        outstanding: outstanding.length,
        specField: specFieldOutstanding.length,
        readiness: readinessOutstanding.length,
        toQuote: outstanding.filter((q) => q.tier === "to_quote").length,
        later: outstanding.filter((q) => q.tier === "later").length,
        noLevel: outstanding.filter((q) => q.tier === null).length,
        waiting: waiting.size,
        blockedRecords: blocked.length + uncategorised.length + unauthored.length,
      },
    },
  });
}
