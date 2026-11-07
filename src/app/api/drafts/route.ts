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
import { inChaseAsk, projectWideTgqKeys, totalItemTgq } from "@/lib/chase-grouping";
import { loadMatrixItemTgq } from "@/lib/item-tgq-load";
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
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { loadProjectSummary } from "@/lib/project-summary";
import { packContactGroups } from "@/lib/chase-inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // Every other route under /api/drafts checks this. This one did not, which
  // left the whole inventory of a project's outstanding questions readable by
  // anything that got past the middleware — the middleware is the first line,
  // never the only one.
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  // `questions=once` ships each question ONCE, with the groups naming them by
  // position (src/lib/chase-inventory.ts, audit F13). Every colleague's group
  // holds every question on the project, so the old shape repeated the whole
  // list per colleague: 62.9 MB on a 440-record project with two. The old
  // shape stays the default only until the chase page asks for this one.
  const questionsOnce = url.searchParams.get("questions") === "once";
  if (!projectId) return json({ ok: false, error: "projectId is required." }, 400);

  const projectRows = await sql`
    select id, bws_project_number, name, client, shared_inbox, version
    from projects where id = ${projectId}
  `;
  const project = projectRows[0];
  if (!project) return json({ ok: false, error: "No such project." }, 404);

  const contactRows = await sql`
    select id, name, email, organisation, role, designer_code, version,
           capsule_party_id, capsule_party_type, capsule_synced_at
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
    capsulePartyId:
      row.capsule_party_id === null || row.capsule_party_id === undefined ? null : Number(row.capsule_party_id),
    capsulePartyType:
      row.capsule_party_type === null || row.capsule_party_type === undefined ? null : String(row.capsule_party_type),
    capsuleSyncedAt:
      row.capsule_synced_at === null || row.capsule_synced_at === undefined ? null : String(row.capsule_synced_at),
  }));

  const [outstanding, uncategorised, sentCoverage, summary, matrix] = await Promise.all([
    loadOutstanding(projectId),
    loadUncategorisedRecords(projectId),
    loadSentCoverage(projectId),
    loadProjectSummary(projectId),
    // THE MATRIX HALF OF EACH ITEM'S TGQ (`itemTgq`, 2026-10-13), so the
    // lines count gate rows where Matthew wrote a matrix. What a chase ASKS is
    // unchanged: questions only.
    loadMatrixItemTgq([projectId]),
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
  //
  // ONLY WHERE THE LEVEL IS WHAT IS MISSING (audit F1, F14, 2026-11-06). A
  // category on Matthew's matrix tiers its questions with no level
  // (`questionTierOrNull`), so listing such a record here put it under "no
  // level" on the chase screen for a decision no chase needs; it is chased
  // as it stands. The level still picks the BWS boilerplate, and the record
  // screen and the spec table still say so; this list is about chasing. And
  // a split bill line is a heading, chased through its configurations, so it
  // is not listed either. The matrix test is loadTgqMatrices' own: a category
  // in spec_matrix_category_map is on the matrix.
  const levelless = await sql`
    select r.id, r.record_no, r.item_description, r.version, r.level_suggested, r.level_suggested_reason,
           p.bws_project_number, r.variant_ordinal,
           (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    where r.project_id = ${projectId} and r.status = 'active' and run.status = 'active'
      and r.category_id is not null and r.level is null
      and r.category_id not in (select item_category_id from spec_matrix_category_map)
      -- CHASE_HEADING_PREDICATE. (No backticks in here: one closes the template.)
      and not exists (select 1 from spec_records v where v.parent_id = r.id and v.status = 'active')
    order by r.record_no
  `;

  // A category nobody has authored requirements for scores 0/0 and renders
  // green. Surface it next to the real blockers. In the export's scope, as
  // every other blocker list is (audit F14): a record on a retired phase, or a
  // split bill line, is nothing anybody can chase or ship.
  const unauthored = await sql`
    select r.id, r.record_no, r.item_description, c.name as category_name, p.bws_project_number,
           r.variant_ordinal,
           (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no
    from spec_records r
    join projects p on p.id = r.project_id
    join item_categories c on c.id = r.category_id
    join spec_runs run on run.id = r.run_id
    where r.project_id = ${projectId} and r.status = 'active' and run.status = 'active'
      and c.requirements_authored = false
      -- CHASE_HEADING_PREDICATE. (No backticks in here: one closes the template.)
      and not exists (select 1 from spec_records v where v.parent_id = r.id and v.status = 'active')
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
    projectId,
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
      // HOW MANY FURNITURE LINES THIS PROJECT HAS, in the export's scope — the
      // same count the overview's Line items tile shows, so the two screens
      // cannot report different sizes for one project. Questions alone cannot
      // give it: a line with nothing outstanding contributes none.
      lineCount: summary.records,
      // WHAT IS DONE, read off the same summary rather than off the contact
      // groups. The tile used to subtract the lines in a CONTACT's group from
      // the line count, so a project with no contacts read "67 with nothing
      // outstanding" over 3,128 open questions (found-in-use, 2026-10-12).
      // Settled is "has questions, none open"; an uncategorised line has none
      // at all and is counted apart, never as done.
      settledLines: summary.settledItems,
      uncategorisedLines: summary.uncategorised,
      // Grouped by the contact each record's designer resolves to.
      ...(() => {
        // Each question carries its waiting state once, whichever shape ships.
        // The client renders it; it never decides eligibility from it.
        const withWaiting = new Map(
          outstanding.map((question) => {
            const key = questionKey(question.recordId, question.requirementId, 0);
            return [key, { ...question, waiting: waiting.get(key) ?? null }] as const;
          }),
        );
        const shaped = groups.map((group) => ({
          contact: group.contact,
          questions: group.questions.map(
            (question) => withWaiting.get(questionKey(question.recordId, question.requirementId, 0))!,
          ),
        }));
        return questionsOnce ? packContactGroups(shaped) : { groups: shaped };
      })(),
      blocked,
      // Per record on Matthew's matrix: its TGQ count, project-wide count, and
      // the rows that are not questions (slots, record columns), which the
      // table lists as "record it on the item" when a line opens.
      itemTgq: Object.fromEntries(
        [...matrix.values()].map((item) => [
          item.recordId,
          {
            count: item.count,
            projectWide: item.projectWide,
            // Which line the record is on, so a line's count can include a
            // configuration on it that no outstanding question names (F7).
            lineId: item.lineId,
            itemRows: item.rows
              .filter((row) => row.kind !== "question")
              .map((row) => ({ label: row.label, where: row.where === "details" ? "details" : "specs" })),
          },
        ]),
      ),
      suggestedCodes,
      uncategorised,
      unauthored: unauthored.map((row) => ({
        ...row,
        // Named by the one label helper (0039), so the page prints it rather
        // than composing the number itself.
        record_label: recordLabel(String(row.bws_project_number), numberingFromRow(row)),
      })),
      levelless: levelless.map((row) => ({
        recordId: String(row.id),
        recordLabel: recordLabel(String(row.bws_project_number), numberingFromRow(row)),
        itemDescription: String(row.item_description ?? ""),
        version: Number(row.version),
        // What this app would guess, and why. Advisory: the record is still
        // levelless as far as every tier is concerned.
        suggested: row.level_suggested === null ? null : String(row.level_suggested),
        suggestedReason: row.level_suggested_reason === null ? null : String(row.level_suggested_reason),
      })),
      totals: {
        outstanding: outstanding.length,
        specField: specFieldOutstanding.length,
        readiness: readinessOutstanding.length,
        // THE ONE RULE (chase-grouping.ts): the items' own TGQ, any kind,
        // minus the project-wide section; the subset a chase asks by default;
        // and the distinct project-wide questions, answered once on the
        // project. The tile says all three in words.
        // Each record counts its `itemTgq`: the gate's rows on the matrix, its
        // own questions elsewhere. EVERY MATRIX RECORD counts, not only those
        // with a question outstanding (audit F7): a matrix item with every
        // question answered and W and SH still empty owes its TGQ and has no
        // question row. The overview counts it, and until 2026-11-06 this
        // header did not. The chase TABLE still lists only lines with a
        // question to tick, so such an item is in this number and on no row
        // there; the fill-in screen gives it a line of its own.
        toQuote: totalItemTgq(outstanding, matrix),
        toChase: outstanding.filter(inChaseAsk).length,
        projectWide: projectWideTgqKeys(outstanding).size,
        later: outstanding.filter((q) => q.tier === "later").length,
        noLevel: outstanding.filter((q) => q.tier === null).length,
        waiting: waiting.size,
        blockedRecords: blocked.length + uncategorised.length + unauthored.length,
      },
    },
  });
}
