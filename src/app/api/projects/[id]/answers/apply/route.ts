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
// ============================================================================
import { json, sql } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { changeSetForEdit, findOpenChangeSet } from "@/lib/change-sets";
import { editAnswer } from "@/lib/answer-edit";
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { snapshotRecords } from "@/lib/record-snapshot";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";
import { isAnswerState, type AnswerState } from "@/lib/spec-vocab";

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
            answerId: z.string().uuid(),
            version: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_ROWS),
  })
  .strict();

type Skipped = { recordId: string; requirementId: string; label: string; why: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id: projectId } = await context.params;

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

  // The project has to exist before anything says how many rows it refused.
  const projects = await sql`select id from projects where id = ${projectId}`;
  if (!projects[0]) return json({ ok: false, error: "No such project." }, 404);

  try {
    const result = await withTransaction(async (txn) => {
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
         where a.id = any(${asked.map((row) => row.answerId)}::uuid[])
         order by a.id
           for update of a
      `;
      const live = new Map(rows.map((row) => [String(row.id), row]));

      const filed: {
        recordId: string;
        requirementId: string;
        answerId: string;
        value: string | null;
        state: string;
        version: number;
      }[] = [];
      const skipped: Skipped[] = [];
      const plan: { asked: (typeof asked)[number]; row: Record<string, unknown> }[] = [];
      const seen = new Set<string>();

      for (const entry of asked) {
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
        if (seen.has(entry.answerId)) {
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
        seen.add(entry.answerId);
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

      for (const { asked: entry, row } of plan) {
        const written = await editAnswer(txn, {
          answerId: entry.answerId,
          value,
          state,
          expectedVersion: entry.version,
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
      // sorted order and `on conflict (record_id, change_set_id) do nothing`
      // means a record answered twice in one press still gets one version.
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
