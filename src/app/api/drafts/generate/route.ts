// Generating chase drafts from an explicit selection of questions.
//
// ============================================================================
// WHAT MAKES THIS SAFE
//
// The caller sends the drafts it was LOOKING AT (ids + versions) as well as the
// questions it wants. If that set no longer matches what is in the database,
// the whole request is refused. Two people pressing Generate at once therefore
// cannot both succeed, and a stale tab cannot quietly replace work it never saw.
//
// Existing drafts are marked `superseded`, never deleted. Deleting would
// destroy what someone else is reading and leave their next action with a 404
// instead of a conflict that can be explained.
//
// There is no generation_token here, and that is not an oversight. The fabric
// app needs one because its FR route UPSERTS a draft in place, so "version N+1
// exists" cannot prove its own write won rather than a concurrent writer's.
// This route only ever INSERTS new rows inside one transaction, so there is no
// such ambiguity to resolve.
//
// The whole selection is rejected if any one question is no longer eligible.
// Silently dropping a question the user explicitly asked for would produce an
// email they believe covers something it does not.
// ============================================================================
import { z } from "zod";
import { json, type Row } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { currentAppEnvIsProduction } from "@/lib/env";
import { DomainConflictError, transactionErrorResponse, withTransaction } from "@/lib/db-transaction";
import {
  coveredFromQuestion,
  groupsFromCovered,
  loadQuestionsByKey,
  questionKey,
  type OutstandingQuestion,
} from "@/lib/chase-drafts";
import { TEMPLATE_VERSION, buildChaseEmail, defaultClosing, defaultIntro, tierCounts } from "@/lib/chase-template";
import { ANSWER_STATE_LABELS } from "@/lib/spec-vocab";

export const maxDuration = 60;

/**
 * `.strict()` so a body carrying a `tier` is a 400 rather than being ignored.
 *
 * The tier decides what the email CLAIMS is blocking a quote, and the client
 * does not get to say. The server reads it off the live locked row, which is
 * conventions §9 — a gate is enforced on the server, not by which boxes the
 * screen ticked.
 */
const QuestionRef = z.object({ recordId: z.string().uuid(), requirementId: z.string().uuid() }).strict();

const GenerateInput = z.object({
  projectId: z.string().uuid(),
  selections: z
    .array(
      z.object({
        contactId: z.string().uuid(),
        questions: z.array(QuestionRef).min(1).max(2000),
      }),
    )
    .min(1)
    .max(50),
  // The drafts the caller was looking at. An EMPTY array is a positive
  // assertion that there were none -- which is what stops two concurrent
  // first-time generations from both succeeding.
  expectedCurrentDrafts: z.array(z.object({ id: z.string().uuid(), version: z.number().int() })),
  // Edited drafts the caller has explicitly accepted losing. Naming the exact
  // id and version matters: a blanket boolean would also discard an edit that
  // arrived after the warning was shown.
  acknowledgeDiscard: z
    .array(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .default([]),
});

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const parsed = GenerateInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That selection is not valid." }, 400);
  }
  const input = parsed.data;

  // One question may appear once across the whole request. The same question in
  // two drafts would be covered twice and read as waiting on both.
  const seen = new Set<string>();
  for (const selection of input.selections) {
    for (const q of selection.questions) {
      const key = questionKey(q.recordId, q.requirementId, 0);
      if (seen.has(key)) {
        return json(
          { ok: false, error: "The same question is selected for two different recipients. Choose one." },
          400,
        );
      }
      seen.add(key);
    }
  }

  try {
    const result = await withTransaction(async (sql) => {
      // 1. Project. This is one of only two operations that takes a
      //    project-wide lock, because generation replaces the whole current
      //    draft set and must not interleave with another generation.
      const projectRows = await sql`
        select id, bws_project_number, name, shared_inbox
        from projects where id = ${input.projectId} for update
      `;
      const project = projectRows[0];
      if (!project) throw new DomainConflictError("project_missing", "No such project.", { status: 404 });
      const projectLabel = `${String(project.bws_project_number)} ${String(project.name)}`.trim();

      // 2. The current editable drafts, locked.
      const currentDrafts = await sql`
        select id, version, manually_edited_at, contact_id
        from email_drafts
        where project_id = ${input.projectId} and status = 'draft'
        order by id
        for update
      `;

      // 3. Does the caller's picture match reality?
      const expected = new Map(input.expectedCurrentDrafts.map((d) => [d.id, d.version]));
      const mismatched =
        currentDrafts.length !== expected.size ||
        currentDrafts.some((row) => expected.get(String(row.id)) !== Number(row.version));
      if (mismatched) {
        throw new DomainConflictError(
          "drafts_changed",
          "The drafts on this project changed while you were choosing. Reload and check before regenerating.",
        );
      }

      // 4. Hand-edited prose is only discarded when that exact version was
      //    acknowledged.
      const acknowledged = new Map(input.acknowledgeDiscard.map((d) => [d.id, d.version]));
      const edited = currentDrafts.filter((row) => row.manually_edited_at !== null);
      const unacknowledged = edited.filter((row) => acknowledged.get(String(row.id)) !== Number(row.version));
      if (unacknowledged.length > 0) {
        const names = await sql`
          select d.id, c.name as contact_name, d.version
          from email_drafts d join project_contacts c on c.id = d.contact_id
          where d.id = any(${unacknowledged.map((r) => String(r.id))}::uuid[])
        `;
        throw new DomainConflictError(
          "unacknowledged_edits",
          "Some drafts have edits that regenerating would discard.",
          { diff: names },
        );
      }

      // 5. Contacts, locked, and proven to belong to this project.
      const contactIds = input.selections.map((s) => s.contactId);
      const contactRows = await sql`
        select id, name, email, role, version
        from project_contacts
        where project_id = ${input.projectId} and id = any(${contactIds}::uuid[])
        order by id
        for update
      `;
      if (contactRows.length !== new Set(contactIds).size) {
        throw new DomainConflictError(
          "contact_missing",
          "One of the chosen recipients is no longer on this project. Reload and try again.",
        );
      }
      const contactById = new Map(contactRows.map((row) => [String(row.id), row]));

      // 6. Every selected question, validated against live locked rows.
      const allQuestions = input.selections.flatMap((s) => s.questions);
      const live = await loadQuestionsByKey(allQuestions, sql);

      // Each refusal names the record and the question where they are known.
      // Without them the screen rendered a list of blank bullets, which reads
      // as the app having no idea why it said no.
      const ineligible: {
        recordId: string;
        requirementId: string;
        recordLabel: string | null;
        prompt: string | null;
        reason: string;
      }[] = [];
      for (const q of allQuestions) {
        const key = questionKey(q.recordId, q.requirementId, 0);
        const question = live.get(key);
        if (!question) {
          ineligible.push({
            ...q,
            recordLabel: null,
            prompt: null,
            reason: "that question no longer exists on this record",
          });
          continue;
        }
        const named = { ...q, recordLabel: question.recordLabel, prompt: question.prompt };
        if (question.recordStatus !== "active") {
          ineligible.push({ ...named, reason: `is ${question.recordStatus}` });
          continue;
        }
        // No level, no tier, so the email could not say which half of it holds
        // up the quote. Blocked on screen too, with a level picker beside it.
        if (question.tier === null) {
          ineligible.push({
            ...named,
            reason: "has no item level set, so nothing on it can be sorted into what blocks a quote",
          });
          continue;
        }
        if (question.state !== "missing" && question.state !== "tbc") {
          ineligible.push({
            ...named,
            reason: `is now ${ANSWER_STATE_LABELS[question.state]}`,
          });
        }
      }
      if (ineligible.length > 0) {
        throw new DomainConflictError(
          "questions_ineligible",
          `${ineligible.length} selected question${ineligible.length === 1 ? " is" : "s are"} no longer outstanding. Reload to see the current picture.`,
          { diff: ineligible },
        );
      }

      // 7. Supersede the set the caller reviewed. Not deleted: history, and a
      //    meaningful conflict for anyone else holding it open.
      if (currentDrafts.length > 0) {
        const supersededRows = await sql`
          update email_drafts
          set status = 'superseded', updated_by = ${user.email}
          where id = any(${currentDrafts.map((r) => String(r.id))}::uuid[]) and status = 'draft'
          returning id
        `;
        if (supersededRows.length !== currentDrafts.length) {
          throw new DomainConflictError(
            "drafts_changed",
            "A draft changed while this was being generated. Nothing was written; reload and try again.",
          );
        }
      }

      // 8. Render and insert.
      const environmentPrefix = currentAppEnvIsProduction() ? undefined : "[STAGING]";
      const created: Row[] = [];

      for (const selection of input.selections) {
        const contact = contactById.get(selection.contactId);
        if (!contact) continue; // proven present above; satisfies the type

        const questions = selection.questions
          .map((q) => live.get(questionKey(q.recordId, q.requirementId, 0)))
          .filter((q): q is OutstandingQuestion => Boolean(q))
          .sort((a, b) => a.recordNo - b.recordNo || a.sortOrder - b.sortOrder);

        const covered = questions.map(coveredFromQuestion);
        const groups = groupsFromCovered(covered);
        // WHO IS BEING ASKED, off the LIVE contact row and never off the
        // request. A colleague gets "we still need" where a designer gets "we
        // need from you": the wording is a claim about the recipient, and a
        // client that could set it could make an external chase read as an
        // internal note. The `questionTier` rule, in a second place.
        const intro = defaultIntro(projectLabel, tierCounts(groups), {
          internal: String(contact.role) === "internal",
        });
        const closing = defaultClosing();
        const { subject, body } = buildChaseEmail({
          projectLabel,
          contactName: String(contact.name),
          intro,
          closing,
          groups,
          now: new Date(),
          environmentPrefix,
        });

        const draftRows = await sql`
          insert into email_drafts
            (project_id, contact_id, kind, status, intro_text, closing_text, subject, body,
             body_format, template_version, recipient_name, recipient_email, cc_email,
             contact_version, project_label, created_by, updated_by)
          values
            (${input.projectId}, ${selection.contactId}, 'chase', 'draft', ${intro}, ${closing},
             ${subject}, ${body}, 'html', ${TEMPLATE_VERSION}, ${String(contact.name)},
             ${contact.email ?? null}, ${project.shared_inbox ?? null}, ${Number(contact.version)},
             ${projectLabel}, ${user.email}, ${user.email})
          returning id, status, subject, version
        `;
        const draft = draftRows[0];
        if (!draft) throw new Error("the draft insert returned no row");
        const draftId = String(draft.id);

        // Coverage, snapshotted in the SAME transaction as the body, so the
        // email and the versions it froze can never disagree.
        let sortOrder = 0;
        for (const item of covered) {
          sortOrder += 1;
          const inserted = await sql`
            insert into email_draft_items
              (draft_id, record_id, requirement_id, revision_no, answer_id, snapshot_answer_version,
               record_version, context_snapshot, prompt_text, field_label, current_value_text,
               sort_order, tier, record_no, requirement_sort, created_by)
            values
              (${draftId}, ${item.recordId}, ${item.requirementId}, 0,
               ${item.answerId}, ${item.answerVersion}, ${item.recordVersion},
               ${JSON.stringify(item.context)}::jsonb, ${item.prompt},
               ${item.fieldLabel}, ${item.currentValueText ?? ANSWER_STATE_LABELS[item.context.state]},
               ${sortOrder}, ${item.tier}, ${item.recordNo}, ${item.requirementSort}, ${user.email})
            returning id
          `;
          if (!inserted[0]) throw new Error("a coverage row failed to insert");
        }

        created.push({ ...draft, questionCount: questions.length });
      }

      return { created, superseded: currentDrafts.length };
    });

    return json({ ok: true, ...result }, 201);
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}



