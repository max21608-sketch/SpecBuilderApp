// One value, applied to the items a person ticked, in one act.
//
// ============================================================================
// "ACCESS HAS BEEN APPROVED FOR EVERYTHING."
//
// Max, 2026-09-22, on *Fill in what we know* → **By question**: `Access -
// Select option` opened to 28 rows, each carrying the identical prompt and an
// empty select. *"We need basically an apply-to-all box … even better a tick
// box with an option to select all, but then you can untick some. This screen
// doesn't really make sense if they have to go through every single one."*
//
// This is the UI BATCH ONLY. Answering a question once per PROJECT — a
// `scope = 'project'` column on `spec_answers`, which is what the Project /
// commercial section actually wants — is a data-model change nobody has agreed
// and is NOT replaced by this: a batch applied to 28 items does not stay right
// when a 29th arrives. It remains an open question for Matthew.
//
// ---- THE SHAPE IS `POST /finishes/kinds`, DELIBERATELY --------------------
//
// Take {id, version} per row, lock the set in a deterministic order, run a
// plan/skip pass that gives every skipped row its own REASON, call
// `changeSetForEdit` ONCE, then write. Not `acceptSuggestedLevels`, which has
// no version check at all — right for accepting the app's own suggestions, and
// wrong for writing a person's value over rows they may not have re-read.
//
// ---- FOUR THINGS THAT ARE TRAPS RATHER THAN PREFERENCES -------------------
//
//  - **ONE PRESS IS ONE CHANGE SET.** `editFinish` filed eleven codes as
//    eleven trail entries until `changeSetId` was threaded through it;
//    `editAnswer` gained the same parameter for this route. 26 answers under
//    one change, one version per record.
//
//  - **AN OPEN CHANGE WINS OVER THIS ROUTE'S OWN SENTENCE.** The infill screen
//    carries `OpenChangeBar` — name the meeting once and everything recorded
//    after it belongs to that change. `changeSetForEdit` opens a FRESH change
//    whenever a reason is supplied, so supplying one unconditionally would
//    detach this press from the meeting it happened in. The reason is passed
//    only where there is nothing open to attach to.
//
//  - **A SETTLED ANSWER IS SKIPPED AND NAMED, NEVER OVERWRITTEN.** A person's
//    own answer is the one thing `applyAnswerFills` has never been allowed to
//    touch. `editAnswer` demands a reason where a `confirmed` answer CHANGES,
//    and a batch reason cannot be passed row by row — it would open a change
//    set per row. So those rows are reported back by name and the person
//    changes them deliberately, one at a time, where the reason box is.
//
//  - **NEVER A DIMENSION.** `rowKind` reads `jsonId === 3` and writes an
//    ATTRIBUTE through `POST /api/attributes`, because the composed Dimensions
//    cell is a PROJECTION of the record's dimension attributes. One width
//    applied to 28 items is the case where apply-to-all is certainly wrong.
//    The screen does not offer the tick there; this refuses the row as well,
//    because the client does not get to decide what kind a question is — the
//    `questionTier` rule, in another place.
//
// ---- AN ITEM WITH NO ANSWER ROW YET IS TICKED LIKE ANY OTHER (L2) --------
//
// A seed that adds a question to a sheet leaves every record already on it
// with no row for that question (`answer-rows.ts`). Such a row arrives here as
// (record, question) with a null id and version, and the batch creates its row
// through `insertMissingAnswerRows`, narrowed to those pairs, AFTER the change
// is open and under the record locks — so the insert belongs to the press's one
// change set and its record gets the press's one version. It is refused, and
// named, where the question is not on the item's CURRENT checklist (no row is
// ever made for a question its category does not ask) and where a row has
// appeared since the screen loaded (the screen did not show what it would
// replace). One route, not a second one beside it (2026-11-21).
// ============================================================================
import { json, sql } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { changeSetForEdit, findOpenChangeSet } from "@/lib/change-sets";
import { editAnswer } from "@/lib/answer-edit";
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { snapshotRecords } from "@/lib/record-snapshot";
import { insertMissingAnswerRows } from "@/lib/answer-rows";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";
import { isAnswerState, type AnswerState } from "@/lib/spec-vocab";
import { requireUuid, requireWriter } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

/**
 * A ceiling, not a target. The 300-line project's biggest heading is 401 items
 * ("Dimensions", which this refuses anyway); `Access` is 28. 500 is above every
 * heading that exists and far below anything that would hold a transaction
 * open long enough to matter.
 */
const MAX_ROWS = 500;

const Body = z
  .object({
    /** Absent or empty is TBC's case: a state with no value. */
    value: z.string().max(4000).nullable().optional(),
    state: z.string(),
    rows: z
      .array(
        z
          .object({
            recordId: z.string().uuid(),
            requirementId: z.string().uuid(),
            /** Null, with `version`, where the item has no answer row for this question yet (L2). */
            answerId: z.string().uuid().nullable(),
            version: z.number().int().nonnegative().nullable(),
          })
          .strict()
          .refine((row) => (row.answerId === null) === (row.version === null)),
      )
      .min(1)
      .max(MAX_ROWS),
  })
  .strict();

type Skipped = { recordId: string; requirementId: string; label: string; why: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;
  const { id: projectId } = await context.params;
  const badId = requireUuid(projectId);
  if (badId) return badId;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "That request is not valid." }, 400);

  if (!isAnswerState(parsed.data.state)) {
    return json({ ok: false, error: "A state of confirmed, tbc, missing or na is required." }, 400);
  }
  const state: AnswerState = parsed.data.state;
  // ONLY THE TWO STATES THIS SCREEN RECORDS. `missing` is "nobody has looked"
  // and `na` prunes a question off an item — both are statements about one
  // item, and neither is something a person means about 28 at once.
  if (state !== "confirmed" && state !== "tbc") {
    return json({ ok: false, error: "A batch records a value or TBC. Clearing an answer is done on the item." }, 400);
  }

  const trimmed = typeof parsed.data.value === "string" ? parsed.data.value.trim() : "";
  const value = trimmed === "" ? null : trimmed;
  if (state === "confirmed" && !value) {
    return json({ ok: false, error: "Confirmed needs a value. Use TBC if it is not decided yet." }, 400);
  }

  const asked = parsed.data.rows;
  const answerIds = asked.flatMap((row) => (row.answerId ? [row.answerId] : []));
  const rowless = asked.filter((row) => row.answerId === null);

  // The project has to exist before anything says how many rows it refused.
  const projects = await sql`select id from projects where id = ${projectId}`;
  if (!projects[0]) return json({ ok: false, error: "No such project." }, 404);

  try {
    const result = await withTransaction(async (txn) => {
      // THE RECORDS FIRST, in id order, then the answers (audit B6). This
      // locked the answers and reached the records only in the version pass
      // at the end — the reverse of every confirm, which locks records and
      // then writes answers — so a press here and a drawings confirm on one
      // of these items could deadlock. `record-lock.ts` carries the contract.
      //
      // A row-less item (L2) names its record directly; only THIS project's
      // records are locked on its word. One statement, so the whole set is
      // locked in one id order.
      await txn`
        select r.id from spec_records r
         where r.id in (select a.record_id from spec_answers a where a.id = any(${answerIds}::uuid[]))
            or (r.id = any(${rowless.map((row) => row.recordId)}::uuid[]) and r.project_id = ${projectId})
         order by r.id
           for update
      `;
      // ONE read, locked in a deterministic order so two people pressing this
      // at once cannot interleave into a deadlock. The join is what makes the
      // row's PROJECT, its question and its BWS field the server's own reading
      // rather than the client's claim.
      const rows = await txn`
        select a.id,
               a.record_id,
               a.requirement_id,
               a.version,
               a.state,
               a.value,
               r.project_id,
               r.status as record_status,
               r.record_no,
               r.variant_label,
               r.variant_ordinal,
               (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no,
               pr.bws_project_number,
               q.prompt,
               f.json_id
          from spec_answers a
          join spec_records r on r.id = a.record_id
          join projects pr on pr.id = r.project_id
          join requirements q on q.id = a.requirement_id
          left join spec_fields f on f.id = q.spec_field_id
         where a.id = any(${answerIds}::uuid[])
         order by a.id
           for update of a
      `;
      const live = new Map(rows.map((row) => [String(row.id), row]));

      // THE ROW-LESS ITEMS, read under their record locks: the record, the
      // question, and whether a row has appeared since the screen loaded.
      const rowlessRows =
        rowless.length === 0
          ? []
          : await txn`
              select r.id as record_id,
                     q.id as requirement_id,
                     r.project_id,
                     r.status as record_status,
                     r.category_id as record_category_id,
                     q.category_id as question_category_id,
                     r.record_no,
                     r.variant_label,
                     r.variant_ordinal,
                     (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no,
                     pr.bws_project_number,
                     q.prompt,
                     f.json_id,
                     (select a.id from spec_answers a
                       where a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0) as existing_id
                from unnest(${rowless.map((row) => row.recordId)}::uuid[], ${rowless.map((row) => row.requirementId)}::uuid[])
                     as p(record_id, requirement_id)
                join spec_records r on r.id = p.record_id
                join projects pr on pr.id = r.project_id
                join requirements q on q.id = p.requirement_id
                left join spec_fields f on f.id = q.spec_field_id
            `;
      const pairKey = (row: { recordId: string; requirementId: string }) => `${row.recordId}:${row.requirementId}`;
      const liveRowless = new Map(
        rowlessRows.map((row) => [pairKey({ recordId: String(row.record_id), requirementId: String(row.requirement_id) }), row]),
      );

      const filed: {
        recordId: string;
        requirementId: string;
        answerId: string;
        value: string | null;
        state: string;
        version: number;
      }[] = [];
      const skipped: Skipped[] = [];
      const plan: { asked: (typeof asked)[number]; row: Record<string, unknown>; created?: boolean }[] = [];
      const seen = new Set<string>();

      for (const entry of asked) {
        if (entry.answerId === null) {
          const row = liveRowless.get(pairKey(entry));
          const named = (why: string) =>
            skipped.push({
              recordId: entry.recordId,
              requirementId: entry.requirementId,
              label: row ? labelOf(row) : "That item",
              why,
            });
          if (!row) {
            named("there is no such item or question any more");
            continue;
          }
          if (String(row.project_id) !== projectId) {
            named("it belongs to another project");
            continue;
          }
          if (String(row.record_status) !== "active") {
            named("the item has been retired");
            continue;
          }
          // NEVER A ROW FOR A QUESTION THE ITEM'S CATEGORY DOES NOT ASK: a
          // stale screen after a category change, or a crafted request.
          if (String(row.record_category_id ?? "") !== String(row.question_category_id)) {
            named("the question is not on that item's checklist any more");
            continue;
          }
          if (seen.has(pairKey(entry))) {
            named("it was ticked twice");
            continue;
          }
          if (Number(row.json_id) === DIMENSIONS_JSON_ID) {
            named("a dimension is recorded per item, not in a batch");
            continue;
          }
          if (row.existing_id) {
            named("somebody answered it since this screen loaded");
            continue;
          }
          seen.add(pairKey(entry));
          plan.push({ asked: entry, row, created: true });
          continue;
        }

        const row = live.get(entry.answerId);
        const named = (why: string) =>
          skipped.push({
            recordId: entry.recordId,
            requirementId: entry.requirementId,
            label: row ? labelOf(row) : "That item",
            why,
          });

        if (!row) {
          named("there is no such answer any more");
          continue;
        }
        if (String(row.project_id) !== projectId) {
          named("it belongs to another project");
          continue;
        }
        // The client's own reading of which question this row is, checked
        // rather than trusted: a payload that drifted is a payload that would
        // write one item's access answer onto another item's fabric.
        if (String(row.record_id) !== entry.recordId || String(row.requirement_id) !== entry.requirementId) {
          named("it is not the question that was on screen");
          continue;
        }
        if (String(row.record_status) !== "active") {
          named("the item has been retired");
          continue;
        }
        if (seen.has(pairKey(entry))) {
          named("it was ticked twice");
          continue;
        }
        // A DIMENSION IS NOT AN ANSWER. Refused here as well as unoffered on
        // screen, because the composed cell is a projection of the record's
        // attributes and one width across 28 items is certainly wrong.
        if (Number(row.json_id) === DIMENSIONS_JSON_ID) {
          named("a dimension is recorded per item, not in a batch");
          continue;
        }
        if (Number(row.version) !== entry.version) {
          named("somebody changed it since this screen loaded");
          continue;
        }
        // NOT SILENTLY OVERWRITTEN. `editAnswer` asks for a reason where a
        // settled answer changes, and a reason opens a fresh change set — so
        // there is no honest way to carry one row's reason through a batch.
        // It is named instead, and changed deliberately on its own row.
        if (String(row.state) === "confirmed") {
          named("it is already answered — change that one on its own");
          continue;
        }
        seen.add(pairKey(entry));
        plan.push({ asked: entry, row });
      }

      if (plan.length === 0) {
        throw new DomainConflictError(
          "nothing_to_apply",
          "None of those could be recorded. " + skipped.map((row) => `${row.label} — ${row.why}`).join("; "),
        );
      }

      const prompt = String(plan[0]!.row.prompt ?? "that question");
      // THE OPEN CHANGE WINS. A reason always opens a fresh change set, which
      // is right when nothing is open and wrong in a meeting: `OpenChangeBar`
      // exists so everything recorded in one sitting reads as one thing that
      // happened.
      const open = await findOpenChangeSet(txn, projectId, user.email);
      const { changeSetId } = await changeSetForEdit(txn, {
        projectId,
        actor: user.email,
        kind: "manual_edit",
        reason: open
          ? null
          : state === "tbc"
            ? `Recorded “${prompt}” as TBC on ${plan.length} item${plan.length === 1 ? "" : "s"}.`
            : `Recorded “${prompt}” as “${value}” on ${plan.length} item${plan.length === 1 ? "" : "s"}.`,
      });

      // THE MISSING ROWS, created `missing` inside the change just opened and
      // under the locks taken first (L2): the one insert, narrowed to exactly
      // the pairs planned, so no row is made for anything else.
      const toCreate = plan.filter((entry) => entry.created).map((entry) => entry.asked);
      const createdFor = new Map(
        (
          await insertMissingAnswerRows(
            txn,
            toCreate.map((row) => row.recordId),
            user.email,
            { only: toCreate.map((row) => ({ recordId: row.recordId, requirementId: row.requirementId })) },
          )
        ).map((row) => [pairKey(row), row]),
      );

      for (const { asked: entry, row, created } of plan) {
        const made = created ? createdFor.get(pairKey(entry)) : undefined;
        // Checked under the locks above, so this cannot happen; if it does,
        // the whole press rolls back rather than skipping a row silently.
        if (created && !made) throw new Error(`no answer row was created for ${pairKey(entry)}`);
        const written = await editAnswer(txn, {
          answerId: made ? made.id : entry.answerId!,
          value,
          state,
          expectedVersion: made ? made.version : entry.version!,
          actor: user.email,
          // The change is already open and carries the why for the whole act.
          changeSetId,
          // ONE VERSION PASS FOR THE WHOLE PRESS, below. `snapshotRecords`
          // batches its lock and its `loadRecordAtoms`; per answer it re-locks
          // and re-loads every time — measured at 13.6s for 26 answers against
          // the sandbox, which on a 400-item heading is a request that does not
          // come back.
          snapshot: false,
        });
        filed.push({
          recordId: String(row.record_id),
          requirementId: String(row.requirement_id),
          answerId: written.answer.id,
          value: written.answer.value,
          state: written.answer.state,
          version: written.answer.version,
        });
      }

      // EVERY RECORD THIS TOUCHED, ONCE. `snapshotRecords` takes the lock in
      // sorted order and versions each record once per transaction (0052), so
      // a record answered twice in one press still gets one version.
      await snapshotRecords(
        txn,
        filed.map((row) => row.recordId),
        changeSetId,
      );

      return { filed, skipped, changeSetId, attachedToOpenChange: Boolean(open) };
    });

    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

/**
 * What a skipped row is called on screen — `P17231-014 A`.
 *
 * `recordLabel` is `chase-drafts`' own, so a row this route names reads exactly
 * as the row the person ticked. A skipped row reported by uuid is a skipped row
 * nobody can find.
 */
function labelOf(row: Record<string, unknown>): string {
  const letter = row.variant_label ? ` ${String(row.variant_label)}` : "";
  return `${recordLabel(String(row.bws_project_number), numberingFromRow(row))}${letter}`;
}
