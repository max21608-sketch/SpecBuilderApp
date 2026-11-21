// Giving existing records the checklist rows a later seed's questions need.
//
// ============================================================================
// WHY (review 1, finding 1, 2026-11-21).
//
// A record's answer rows are made when it is categorised, one per question its
// sheet asked THAT DAY. Seed 0014 added 77 questions to the eight cabinetry
// sheets, which already held records (403 live on the local copy), and none
// of them gained a row: the stone / glass / lighting / fitted controllers read
// as blocking a quote and nobody could answer them, and a spec already on the
// Specs tab (a second timber finish) did not fill the new question for its
// field, because a recompose only UPDATES rows.
//
// The app now creates a row on the first answer (`answer-rows.ts`). This pass
// does the rest, once, after the seed: for every LIVE record (status active,
// with a category, on any phase) it inserts, `missing`, the rows its
// category's questions lack, then RECOMPOSES the record through the one path
// every writer uses (`recomposeAnswers`), so a spec the record already holds
// fills its new question — as `source_kind = 'attribute'`, a projection
// (0050), never a person's answer — and anything else the specs say that a
// row had not yet caught up with is caught up the same way.
//
// THE TRAIL. One change set per project (`manual_edit`, with a reason naming
// this pass; no kind is added for a one-off), one version of every record it
// gives a row to. Every such record's version differs from its last, because
// a version holds EVERY answer (`record-atoms.ts`), a `missing` one included;
// a record with nothing to add is not touched and gets no version. Inserting
// rows does not move `spec_records.version`, so no unsent chase goes stale.
//
// WHAT IT CANNOT DECIDE, it prints and leaves: a new question whose BWS field
// a spec on the item speaks to, where the composer abstains — a spec marked
// TBC with no words, or two specs claiming the field — so the row stays
// missing while the Specs tab shows something there. A person reads the spec
// and answers. (A second QUESTION on one field cannot arise:
// `requirements_category_field_idx` asks a field once per category. And the
// sheet's older "Any Specialist Lighting/ Power Required?" beside the new
// "Integrated lighting or power?" is not this pass's to connect: two readiness
// questions, no shared field, and copying one into the other would be a
// decision nobody made — design finding 5.)
//
// SAFE TO RE-RUN: the insert re-checks under the record lock, so a second run
// finds nothing to add and opens no change set.
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";
import type { SqlLike } from "@/lib/record-atoms";
import { openChangeSet } from "@/lib/change-sets";
import { loadPromotable, recomposeAnswers } from "@/lib/attribute-retire";
import { snapshotRecords } from "@/lib/record-snapshot";
import { lockRecords } from "@/lib/record-lock";
import { insertMissingAnswerRows } from "@/lib/answer-rows";
import { DIMENSIONS_JSON_ID, planAnswerFills, type AnswerFill } from "@/lib/promote-answers";
import { numberingFromRow, recordLabel } from "@/lib/record-label";

export const QUESTION_ROWS_REASON =
  "Checklist rows for questions added to a category after its items were categorised (seed 0014), filled from " +
  "each item's own specs where they answer them.";

export type QuestionRowsRecord = {
  recordId: string;
  recordLabel: string;
  /** The questions this record's category asks and it holds no row for. */
  adding: { requirementId: string; prompt: string }[];
  /** Of those, the ones its specs will fill, and with what. */
  fills: { prompt: string; value: string; state: string }[];
  /** Rows it already held that the recompose will change (a spec a row had not caught up with). */
  alsoRecomposed: { prompt: string; from: string; to: string }[];
};

export type QuestionRowsProject = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  records: QuestionRowsRecord[];
  rowsToAdd: number;
  /** New questions left missing although a spec on the item speaks to their field. */
  undecided: { recordLabel: string; prompt: string; specs: string[] }[];
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const said = (value: string | null, state: string) => (state === "missing" ? "missing" : `“${value ?? ""}” (${state})`);

/** The fill a row of this field takes, or null. */
function fillFor(fills: AnswerFill[], fieldId: string | null, jsonId: number | null): AnswerFill | null {
  if (jsonId === DIMENSIONS_JSON_ID) return fills.find((fill) => fill.jsonId === DIMENSIONS_JSON_ID) ?? null;
  if (!fieldId) return null;
  return fills.find((fill) => fill.specFieldId === fieldId) ?? null;
}

/**
 * Reads every live record of every project (or one) and works out what this
 * pass would add and fill. Writes nothing.
 */
export async function planQuestionRows(exec: SqlLike, projectId: string | null): Promise<QuestionRowsProject[]> {
  const projects = await exec`
    select id, bws_project_number, name from projects
     where (${projectId}::uuid is null or id = ${projectId}::uuid)
     order by bws_project_number
  `;
  const out: QuestionRowsProject[] = [];
  for (const project of projects) {
    const pid = String(project.id);
    const lacking = await exec`
      select r.id as record_id, r.record_no, r.variant_ordinal, r.dimension_note, p.bws_project_number,
             (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no,
             q.id as requirement_id, q.prompt, q.spec_field_id, f.json_id
        from spec_records r
        join projects p on p.id = r.project_id
        join requirements q on q.category_id = r.category_id
        left join spec_fields f on f.id = q.spec_field_id
       where r.project_id = ${pid} and r.status = 'active'
         and not exists (
           select 1 from spec_answers a where a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
         )
       order by r.record_no, r.variant_ordinal nulls first, q.sort_order
    `;
    const plan: QuestionRowsProject = {
      projectId: pid,
      projectNumber: String(project.bws_project_number),
      projectName: String(project.name),
      records: [],
      rowsToAdd: lacking.length,
      undecided: [],
    };
    const byRecord = new Map<string, typeof lacking>();
    for (const row of lacking) {
      const list = byRecord.get(String(row.record_id)) ?? [];
      list.push(row);
      byRecord.set(String(row.record_id), list);
    }
    for (const [recordId, rows] of byRecord) {
      const first = rows[0]!;
      const label = recordLabel(String(first.bws_project_number), numberingFromRow(first));
      // `loadPromotable` reads with a tagged template and nothing else, so the
      // planner's executor serves (answer-provenance-backfill.ts does the same).
      const attributes = await loadPromotable(exec as unknown as TxnSql, recordId);
      const fills = planAnswerFills(attributes, text(first.dimension_note));
      const held = await exec`
        select a.spec_field_id, f.json_id, a.value, a.qualifier, a.state, a.source_kind, q.prompt
          from spec_answers a
          join requirements q on q.id = a.requirement_id
          left join spec_fields f on f.id = a.spec_field_id
         where a.record_id = ${recordId} and a.revision_no = 0
         order by q.sort_order
      `;
      const record: QuestionRowsRecord = { recordId, recordLabel: label, adding: [], fills: [], alsoRecomposed: [] };
      for (const row of rows) {
        const fieldId = text(row.spec_field_id);
        const jsonId = row.json_id === null || row.json_id === undefined ? null : Number(row.json_id);
        record.adding.push({ requirementId: String(row.requirement_id), prompt: String(row.prompt) });
        const fill = fillFor(fills, fieldId, jsonId);
        if (fill) {
          record.fills.push({ prompt: String(row.prompt), value: fill.value, state: fill.state });
          continue;
        }
        // The composer abstained over a spec that IS there.
        const speaking = fieldId
          ? attributes.filter((attribute) => attribute.attrGroup !== "dimension" && attribute.specFieldId === fieldId)
          : [];
        if (speaking.length > 0) {
          plan.undecided.push({
            recordLabel: label,
            prompt: String(row.prompt),
            specs: speaking.map((attribute) => said(attribute.value ?? null, attribute.state)),
          });
        }
      }
      // What `recomposeAnswers` will also do to the rows already there: the
      // same guard it updates under (`missing`, or `attribute`), the same fill.
      for (const answer of held) {
        const state = String(answer.state);
        const kind = String(answer.source_kind);
        if (state !== "missing" && kind !== "attribute") continue;
        const fieldId = text(answer.spec_field_id);
        const jsonId = answer.json_id === null || answer.json_id === undefined ? null : Number(answer.json_id);
        const fill = fillFor(fills, fieldId, jsonId);
        const from = said(text(answer.value), state);
        if (fill) {
          const to = said(fill.value, fill.state);
          const same = text(answer.value) === fill.value && text(answer.qualifier) === (fill.qualifier ?? null) && state === fill.state;
          if (!same) record.alsoRecomposed.push({ prompt: String(answer.prompt), from, to });
        } else if (kind === "attribute" && state !== "missing" && fieldId) {
          record.alsoRecomposed.push({ prompt: String(answer.prompt), from, to: "missing" });
        }
      }
      plan.records.push(record);
    }
    out.push(plan);
  }
  return out;
}

/**
 * Writes one project's plan inside the caller's transaction: the records
 * locked by id, ONE change set, the rows inserted (re-checked under the lock),
 * each record given rows recomposed, and ONE version of each. Returns what it
 * wrote; a project with nothing left to add opens no change set.
 */
export async function applyQuestionRows(
  txn: TxnSql,
  project: QuestionRowsProject,
  actor: string,
): Promise<{ rowsAdded: number; recordsVersioned: number; changeSetId: string | null }> {
  const planned = project.records.map((record) => record.recordId);
  if (planned.length === 0) return { rowsAdded: 0, recordsVersioned: 0, changeSetId: null };
  await lockRecords(txn, planned);

  // Under the lock: a person's first answer, or a second run, since the plan.
  const left = await txn`
    select count(*)::int as n
      from spec_records r join requirements q on q.category_id = r.category_id
     where r.id = any(${planned}::uuid[]) and r.status = 'active'
       and not exists (
         select 1 from spec_answers a where a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
       )
  `;
  if (Number(left[0]?.n ?? 0) === 0) return { rowsAdded: 0, recordsVersioned: 0, changeSetId: null };

  const changeSetId = await openChangeSet(txn, { projectId: project.projectId, kind: "manual_edit", actor, reason: QUESTION_ROWS_REASON });
  // Only records still live: one retired since the plan keeps what it has.
  const live = await txn`select id from spec_records where id = any(${planned}::uuid[]) and status = 'active' order by id`;
  const created = await insertMissingAnswerRows(
    txn,
    live.map((row) => String(row.id)),
    actor,
  );
  const touched = [...new Set(created.map((row) => row.recordId))].sort();
  for (const recordId of touched) await recomposeAnswers(txn, recordId, null, actor);
  const versions = await snapshotRecords(txn, touched, changeSetId);
  return { rowsAdded: created.length, recordsVersioned: versions.size, changeSetId };
}
