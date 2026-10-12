// Project-wide questions, answered ONCE for the project.
//
// ============================================================================
// STAGE 2.8 STEP 2, BUILT 2026-10-12 ON MAX'S RULING.
//
// The Project / commercial section — TOE agreement, sales folder, site access,
// assembly guide and fifteen more — is asked of every category, so the same
// question sat outstanding on thirty items and counted thirty times in TGQ
// (450 of the 1,509 on the local copy of P18181 v3). Max, 2026-10-12: they
// stop counting in an item's own TGQ, still flag at project level, and are
// answered ONCE per project, applying to every item that asks them.
//
// ---- THE FAN-OUT IS THE DESIGN ------------------------------------------
//
// A project-wide answer is still ONE `spec_answers` ROW PER RECORD. That is
// what the export, the gates, chase coverage and history already read, and a
// project-level answers table would be a second source every one of them
// would have to learn about — the day one forgot, a gate would pass over an
// access question nobody answered on that item. So "answered once" is a
// WRITE that fans out, never a place the answer lives.
//
// ---- FOUR THINGS THAT ARE TRAPS ------------------------------------------
//
//  - THE TARGET SET IS RE-DERIVED UNDER THE PROJECT LOCK and the write is
//    refused WHOLE if it differs from what the screen showed — a record added,
//    retired or categorised since, or any answer moved. The configuration
//    fan-out's rule (`configuration-family.ts`): a 29th item that arrived after
//    the screen loaded must not be answered by somebody who never saw it.
//  - A SETTLED ANSWER IS NEVER SILENTLY OVERWRITTEN. A row `confirmed` or `na`
//    with a DIFFERENT value is listed before saving, unticked; replacing it
//    takes a tick AND a reason (or an open change), the existing override
//    rule. An item may be the exception, answered on its own.
//  - ONE CHANGE SET, ONE VERSION PER RECORD. `editAnswer` takes the change it
//    is given and is told not to snapshot; `snapshotRecords` runs once over
//    every record touched (it locks them in id order).
//  - THE QUESTION IS KEYED BY WHAT IT ASKS, not by `requirements.id`, which is
//    per category: `questionGroupKey`, the by-question view's own key.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import type { Row } from "@/lib/db";
import { PROJECT_WIDE_SECTION } from "@/lib/checklist-sections";
import { questionGroupKey } from "@/lib/chase-grouping";
import { loadTgqMatrices } from "@/lib/gate-load";
import { questionTierOrNull, type QuestionTier } from "@/lib/tgq";
import { normaliseItemLevel, type AnswerState } from "@/lib/spec-vocab";
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { changeSetForEdit, findOpenChangeSet } from "@/lib/change-sets";
import { editAnswer } from "@/lib/answer-edit";
import { snapshotRecords } from "@/lib/record-snapshot";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";

type Exec = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/** One item asking one project-wide question. */
export type ProjectWideRow = {
  recordId: string;
  recordLabel: string;
  itemDescription: string;
  requirementId: string;
  /** Null where the checklist row was never created. The write creates it. */
  answerId: string | null;
  answerVersion: number | null;
  state: AnswerState;
  value: string | null;
  /** Null where the record has no level under the fallback model. */
  tier: QuestionTier | null;
};

export type ProjectWideQuestion = {
  /** `questionGroupKey`: BWS field, then local key, then folded prompt. */
  key: string;
  heading: string;
  prompt: string;
  fieldLabel: string | null;
  jsonId: number | null;
  localKey: string | null;
  rows: ProjectWideRow[];
  /** How many items ask it. */
  items: number;
  /** Confirmed or N/A. */
  settled: number;
  /** Missing or TBC. */
  outstanding: number;
  /** Outstanding AND blocking a quote — what makes it count in the project's TGQ. */
  toQuoteOutstanding: number;
  /** Is it TGQ on any item that asks it? */
  tier: QuestionTier;
  /** The settled answers it already holds, each with how many items say it. More than one is a difference. */
  values: { value: string | null; state: AnswerState; items: number }[];
};

const isSettledState = (state: string) => state === "confirmed" || state === "na";
const sameAnswer = (row: { state: string; value: string | null }, value: string | null, state: AnswerState) =>
  row.state === state && (row.value ?? "").trim() === (value ?? "").trim();

/**
 * Every project-wide question asked by an item in the export's scope, grouped
 * by what it asks. One query, either driver: the screen reads it over HTTP and
 * the write re-reads it inside its transaction.
 */
export async function loadProjectWide(exec: Exec, projectId: string): Promise<ProjectWideQuestion[]> {
  const rows = await exec`
    select r.id as record_id, r.record_no, r.variant_ordinal, r.item_description, r.level, r.category_id,
           (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no,
           p.bws_project_number,
           q.id as requirement_id, q.prompt, q.tgq_levels, q.local_key, q.sort_order,
           f.json_id, f.name as field_name,
           a.id as answer_id, a.version as answer_version,
           coalesce(a.state, 'missing') as state, a.value
      from spec_records r
      join projects p on p.id = r.project_id
      join spec_runs run on run.id = r.run_id
      join requirements q on q.category_id = r.category_id
      left join spec_fields f on f.id = q.spec_field_id
      left join spec_answers a on a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
     where r.project_id = ${projectId}
       and r.status = 'active'
       and run.status = 'active'
       -- loadExportScope's split-line clause, word for word: a bill line with
       -- a live configuration is a heading, and its configurations are the
       -- items that ask. (No backticks in here: one closes the template.)
       and not exists (select 1 from spec_records v where v.parent_id = r.id and v.status = 'active')
       and q.section = ${PROJECT_WIDE_SECTION}
     order by q.sort_order, coalesce((select p2.record_no from spec_records p2 where p2.id = r.parent_id), r.record_no),
              r.variant_ordinal nulls first, r.id
  `;
  const matrices = await loadTgqMatrices(exec);

  const groups = new Map<string, ProjectWideQuestion>();
  for (const row of rows) {
    const jsonId = row.json_id === null || row.json_id === undefined ? null : Number(row.json_id);
    const localKey = row.local_key === null || row.local_key === undefined ? null : String(row.local_key);
    const prompt = String(row.prompt ?? "");
    const requirementId = String(row.requirement_id);
    const key = questionGroupKey({ requirementId, prompt, jsonId, localKey });
    const tier = questionTierOrNull(
      { tgqLevels: Array.isArray(row.tgq_levels) ? row.tgq_levels.map(String) : [], jsonId, localKey },
      normaliseItemLevel(row.level),
      row.category_id ? (matrices.get(String(row.category_id)) ?? null) : null,
    );
    let group = groups.get(key);
    if (!group) {
      const fieldLabel = row.field_name === null || row.field_name === undefined ? null : String(row.field_name);
      group = {
        key,
        // The prompt is the question as a person reads it; the BWS field's
        // name is a column heading. The checklist leads with the prompt too.
        heading: prompt.trim() || fieldLabel || "Unnamed question",
        prompt,
        fieldLabel,
        jsonId,
        localKey,
        rows: [],
        items: 0,
        settled: 0,
        outstanding: 0,
        toQuoteOutstanding: 0,
        tier: "later",
        values: [],
      };
      groups.set(key, group);
    }
    const state = String(row.state) as AnswerState;
    group.rows.push({
      recordId: String(row.record_id),
      recordLabel: recordLabel(String(row.bws_project_number), numberingFromRow(row)),
      itemDescription: String(row.item_description ?? ""),
      requirementId,
      answerId: row.answer_id === null || row.answer_id === undefined ? null : String(row.answer_id),
      answerVersion: row.answer_version === null || row.answer_version === undefined ? null : Number(row.answer_version),
      state,
      value: row.value === null || row.value === undefined ? null : String(row.value),
      tier,
    });
  }

  for (const group of groups.values()) {
    group.items = new Set(group.rows.map((row) => row.recordId)).size;
    const values = new Map<string, { value: string | null; state: AnswerState; items: number }>();
    for (const row of group.rows) {
      if (row.tier === "to_quote") group.tier = "to_quote";
      if (isSettledState(row.state)) {
        group.settled += 1;
        const k = `${row.state}\u0000${(row.value ?? "").trim()}`;
        const seen = values.get(k) ?? { value: row.value, state: row.state, items: 0 };
        seen.items += 1;
        values.set(k, seen);
      } else {
        group.outstanding += 1;
        if (row.tier === "to_quote") group.toQuoteOutstanding += 1;
      }
    }
    group.values = [...values.values()].sort((a, b) => b.items - a.items);
  }

  // What still blocks a quote first, then what is outstanding, then the rest,
  // each in the cheat sheet's own order (which the query already gave).
  const rank = (group: ProjectWideQuestion) => (group.toQuoteOutstanding > 0 ? 0 : group.outstanding > 0 ? 1 : 2);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

/** What the screen saw of one row, sent back so the write can refuse a moved set. */
export type SeenRow = { recordId: string; requirementId: string; answerId: string | null; version: number | null };

export type ProjectWidePlan = {
  /** Missing or TBC: written. */
  write: ProjectWideRow[];
  /** Settled with a DIFFERENT answer and ticked: written, with a reason. */
  override: ProjectWideRow[];
  /** Settled with a different answer and NOT ticked: left alone, and named. */
  leftAlone: ProjectWideRow[];
  /** Already says exactly this: nothing to do. */
  same: ProjectWideRow[];
};

/**
 * Which rows an answer would touch. Pure, so the card's "what will happen"
 * sentence and the write are the same decision.
 */
export function planProjectWide(
  question: Pick<ProjectWideQuestion, "rows">,
  { value, state, overrides }: { value: string | null; state: AnswerState; overrides: ReadonlySet<string> },
): ProjectWidePlan {
  const plan: ProjectWidePlan = { write: [], override: [], leftAlone: [], same: [] };
  for (const row of question.rows) {
    if (sameAnswer(row, value, state)) plan.same.push(row);
    else if (!isSettledState(row.state)) plan.write.push(row);
    else if (row.answerId && overrides.has(row.answerId)) plan.override.push(row);
    else plan.leftAlone.push(row);
  }
  return plan;
}

const rowKey = (row: { recordId: string; requirementId: string }) => `${row.recordId}:${row.requirementId}`;

export type ApplyProjectWideResult = {
  changeSetId: string;
  attachedToOpenChange: boolean;
  written: number;
  overridden: number;
  leftAlone: { recordLabel: string; value: string | null; state: string }[];
  records: number;
};

/**
 * Answer one project-wide question on every item in scope that asks it.
 *
 * Refused WHOLE (409, nothing written) when the set differs from `seen`.
 */
export async function applyProjectWide(
  txn: TxnSql,
  {
    projectId,
    key,
    value,
    state,
    seen,
    overrides,
    reason,
    actor,
  }: {
    projectId: string;
    key: string;
    value: string | null;
    state: "confirmed" | "tbc";
    seen: SeenRow[];
    /** Answer ids of settled, differing rows the person ticked to replace. */
    overrides: string[];
    reason: string | null;
    actor: string;
  },
): Promise<ApplyProjectWideResult> {
  // THE PROJECT LOCK, first. Two people answering the same question, or a bill
  // confirm adding the 29th item, queue behind it rather than interleave.
  const project = await txn`select id from projects where id = ${projectId} for update`;
  if (!project[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });

  const question = (await loadProjectWide(txn, projectId)).find((group) => group.key === key);
  if (!question) {
    throw new DomainConflictError(
      "project_wide_gone",
      "No item on this project asks that question any more. Nothing was written — reload.",
    );
  }
  if (question.jsonId === DIMENSIONS_JSON_ID) {
    throw new DomainConflictError("dimension", "A dimension is recorded per item, never once for the project.", {
      status: 400,
    });
  }

  // THE SET THE SCREEN SHOWED, row for row and version for version.
  const live = new Map(question.rows.map((row) => [rowKey(row), row]));
  const shown = new Map(seen.map((row) => [rowKey(row), row]));
  const moved =
    live.size !== shown.size ||
    [...live.entries()].some(([k, row]) => {
      const was = shown.get(k);
      return !was || was.answerId !== row.answerId || was.version !== row.answerVersion;
    });
  if (moved) {
    throw new DomainConflictError(
      "project_wide_moved",
      `The items asking “${question.heading}” changed since this card loaded — an item was added or retired, or one of their answers moved. Nothing was written. Reload and check the list again.`,
      { diff: { live: question.rows.length, shown: seen.length } },
    );
  }

  const overrideSet = new Set(overrides);
  const plan = planProjectWide(question, { value, state, overrides: overrideSet });
  // A tick on a row that is not a settled, differing one is not what the
  // screen offered.
  for (const id of overrideSet) {
    if (!plan.override.some((row) => row.answerId === id)) {
      throw new DomainConflictError(
        "override_not_offered",
        "One of the ticked answers is not a settled answer that differs. Nothing was written — reload.",
      );
    }
  }
  const targets = [...plan.write, ...plan.override];
  if (targets.length === 0) {
    throw new DomainConflictError(
      "nothing_to_apply",
      plan.leftAlone.length > 0
        ? `Every item asking “${question.heading}” already holds an answer, and the different ones were not ticked to replace. Nothing was written.`
        : `Every item asking “${question.heading}” already says that. Nothing was written.`,
    );
  }

  // REPLACING A SETTLED ANSWER NEEDS A WHY: the reason, or an open change.
  const open = await findOpenChangeSet(txn, projectId, actor);
  if (plan.override.length > 0 && !open && !reason?.trim()) {
    throw new DomainConflictError(
      "reason_required",
      `${plan.override.length} item${plan.override.length === 1 ? " already holds" : "s already hold"} a settled answer to “${question.heading}”. Say why it is changing, or open a change first.`,
      { status: 400, diff: { field: "reason" } },
    );
  }
  const n = new Set(targets.map((row) => row.recordId)).size;
  const sentence =
    state === "tbc"
      ? `Recorded “${question.heading}” as TBC for the project, on ${n} item${n === 1 ? "" : "s"}.`
      : `Recorded “${question.heading}” as “${value}” for the project, on ${n} item${n === 1 ? "" : "s"}.`;
  const { changeSetId, attached } = await changeSetForEdit(txn, {
    projectId,
    actor,
    kind: "manual_edit",
    // The open change wins: a reason always opens a fresh change set, which
    // would detach this from the meeting it happened in.
    reason: open ? null : reason?.trim() ? `${reason.trim()} — ${sentence}` : sentence,
  });

  for (const row of targets) {
    let answerId = row.answerId;
    let version = row.answerVersion;
    // NO CHECKLIST ROW YET: created `missing` first, inside this change, so
    // the edit below is the ordinary edit with its ordinary lock.
    if (!answerId) {
      const created = await txn`
        insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
        select ${row.recordId}, q.id, q.spec_field_id, 'missing', ${actor}, ${actor}
          from requirements q where q.id = ${row.requirementId}
        returning id, version
      `;
      answerId = String(created[0]!.id);
      version = Number(created[0]!.version);
    }
    await editAnswer(txn, {
      answerId,
      value,
      state,
      expectedVersion: version!,
      actor,
      changeSetId,
      snapshot: false,
    });
  }

  // ONE VERSION PER RECORD, once, over everything touched.
  await snapshotRecords(
    txn,
    targets.map((row) => row.recordId),
    changeSetId,
  );

  return {
    changeSetId,
    attachedToOpenChange: attached,
    written: plan.write.length,
    overridden: plan.override.length,
    leftAlone: plan.leftAlone.map((row) => ({ recordLabel: row.recordLabel, value: row.value, state: row.state })),
    records: n,
  };
}
