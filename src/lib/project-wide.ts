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
import { questionTierOrNull, tgqMatrixFor, type QuestionTier } from "@/lib/tgq";
import { normaliseItemLevel, type AnswerState } from "@/lib/spec-vocab";
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { changeSetForEdit, findOpenChangeSet } from "@/lib/change-sets";
import { editAnswer } from "@/lib/answer-edit";
import { snapshotRecords } from "@/lib/record-snapshot";
import { lockRecords } from "@/lib/record-lock";
import { insertMissingAnswerRows } from "@/lib/answer-rows";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";
import { foldArea } from "@/lib/area-filter";
import { planProjectWide, type ProjectWideRow } from "@/lib/project-wide-plan";
import { loadRecordAtoms, scopeForAtoms, exportAnswers } from "@/lib/record-atoms";
import { cellsByField } from "@/lib/bws-export";

/**
 * WHERE ONE ANSWER FANS OUT (decision C of 2026-11-20).
 *
 *   project   the "Project / commercial" SECTION, answered once per project
 *             (Stage 2.8, 2026-10-12).
 *   area      `requirements.answer_scope = 'area'` (0062, seed 0015): Indoor /
 *             Outdoor, Floor type, Wall build, fully outdoor. Answered once for
 *             "Restaurant" and written to every item in it. The area is folded
 *             by case and whitespace only (`foldArea`), never anything
 *             cleverer, or two rooms a bill kept apart become one; an item with
 *             NO area is on no card and is asked on its own.
 *
 * ONE mechanism, the same four traps above, one level down: the area's set is
 * re-derived under the PROJECT lock and refused whole if it moved, and the
 * questions stay in the item's own TGQ count (the design's finding 12: a
 * third, per-area count is how TGQ came to mean four numbers).
 */
export type FanOutScope = "project" | "area";

/** The card key of an area question: the folded area, then the question. */
export function areaQuestionKey(area: string, questionKey: string): string {
  return `area:${area}\u0000${questionKey}`;
}

type Exec = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

// The row, the plan and its rule live in `project-wide-plan.ts`, which the
// card imports too (chase review C1): one decision, never a copy of it.
export { planProjectWide, heldBySpec, type ProjectWidePlan, type ProjectWideRow } from "@/lib/project-wide-plan";

export type ProjectWideQuestion = {
  /** `questionGroupKey`: BWS field, then local key, then folded prompt. An area card prefixes its folded area. */
  key: string;
  /** The area as the document first spelled it, on an area card; null on a project card. */
  area: string | null;
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
  /**
   * THE PHASES ITS ITEMS ARE ON, each with how many (chase review C3): an
   * area "Guest Room A" can sit in MUR and in MAIN RUN, and the card names
   * both BEFORE the press. In the phases' own order; active phases only.
   */
  phases: QuestionPhase[];
};

export type QuestionPhase = { runId: string; name: string; items: number };

const isSettledState = (state: string) => state === "confirmed" || state === "na";

/**
 * Every project-wide question asked by an item in the export's scope, grouped
 * by what it asks. One query, either driver: the screen reads it over HTTP and
 * the write re-reads it inside its transaction.
 */
export async function loadProjectWide(exec: Exec, projectId: string): Promise<ProjectWideQuestion[]> {
  return loadFanOut(exec, projectId, "project", null);
}

/**
 * Every area question an item in scope asks, one card per (area, question).
 * Items with no area are on none.
 *
 * `runId` is the fill-in's PHASE FILTER (chase review C3): given, the card's
 * items are that phase's alone, and so is what a press writes; null is every
 * active phase. A retired phase is never in a set either way.
 */
export async function loadAreaWide(exec: Exec, projectId: string, runId: string | null = null): Promise<ProjectWideQuestion[]> {
  return loadFanOut(exec, projectId, "area", runId);
}

async function loadFanOut(exec: Exec, projectId: string, scope: FanOutScope, runId: string | null): Promise<ProjectWideQuestion[]> {
  const projectScope = scope === "project";
  const rows = await exec`
    select r.id as record_id, run.id as run_id, run.name as run_name, run.sort_order as run_sort, r.record_no, r.variant_ordinal, r.item_description, r.level, r.category_id, r.area, r.matrix_type,
           (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no,
           p.bws_project_number,
           q.id as requirement_id, q.prompt, q.tgq_levels, q.local_key, q.sort_order,
           f.json_id, f.name as field_name,
           a.id as answer_id, a.version as answer_version,
           coalesce(a.state, 'missing') as state, a.value, a.source_kind,
           -- A SPEC THAT MAY FILL THIS FIELD (review C1): the composer decides
           -- below; this only spares it the records with none.
           (q.spec_field_id is not null and exists (
              select 1 from record_attributes ra
               where ra.record_id = r.id and ra.spec_field_id = q.spec_field_id
                 and ra.status = 'active' and ra.attr_group <> 'dimension')) as spec_candidate
      from spec_records r
      join projects p on p.id = r.project_id
      join spec_runs run on run.id = r.run_id
      join requirements q on q.category_id = r.category_id
      left join spec_fields f on f.id = q.spec_field_id
      left join spec_answers a on a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
     where r.project_id = ${projectId}
       and r.status = 'active'
       and run.status = 'active'
       -- THE PHASE FILTER (review C3), on the area card only; null is every phase.
       and (${runId}::uuid is null or r.run_id = ${runId}::uuid)
       -- loadExportScope's split-line clause, word for word: a bill line with
       -- a live configuration is a heading, and its configurations are the
       -- items that ask. (No backticks in here: one closes the template.)
       and not exists (select 1 from spec_records v where v.parent_id = r.id and v.status = 'active')
       and ((${projectScope}::boolean and q.section = ${PROJECT_WIDE_SECTION})
            or (not ${projectScope}::boolean and q.answer_scope = 'area'))
     order by q.sort_order, coalesce((select p2.record_no from spec_records p2 where p2.id = r.parent_id), r.record_no),
              r.variant_ordinal nulls first, r.id
  `;
  const matrices = await loadTgqMatrices(exec);

  // WHAT THE FILE SHIPS WHERE A SPEC FILLS THE FIELD (review C1), by the
  // export's own composer over the export's own atoms — the cell the record
  // checklist's `specShipsInstead` reads — for the records that hold one.
  const candidates = [...new Set(rows.filter((row) => row.spec_candidate === true).map((row) => String(row.record_id)))];
  const atoms = candidates.length > 0 ? await loadRecordAtoms(exec, candidates) : new Map();
  const cellsByRecord = new Map(
    [...atoms.entries()].map(([id, atom]) => [id, cellsByField(scopeForAtoms(atom), atom.record, atom.attributes, exportAnswers(atom))]),
  );
  const shipsFor = (recordId: string, jsonId: number | null): string | null => {
    if (jsonId === null) return null;
    const cell = cellsByRecord.get(recordId)?.get(jsonId);
    return cell && cell.source.kind === "attribute" ? cell.value : null;
  };

  const groups = new Map<string, ProjectWideQuestion>();
  for (const row of rows) {
    const jsonId = row.json_id === null || row.json_id === undefined ? null : Number(row.json_id);
    const localKey = row.local_key === null || row.local_key === undefined ? null : String(row.local_key);
    const prompt = String(row.prompt ?? "");
    const requirementId = String(row.requirement_id);
    const questionKey = questionGroupKey({ requirementId, prompt, jsonId, localKey });
    const rawArea = row.area === null || row.area === undefined ? null : String(row.area);
    const folded = projectScope ? null : foldArea(rawArea);
    // NO AREA, NO CARD: an item nobody placed is asked on its own.
    if (!projectScope && folded === null) continue;
    const key = folded === null ? questionKey : areaQuestionKey(folded, questionKey);
    const tier = questionTierOrNull(
      { tgqLevels: Array.isArray(row.tgq_levels) ? row.tgq_levels.map(String) : [], jsonId, localKey },
      normaliseItemLevel(row.level),
      // The record's accepted type (decision B), the union where it has none.
      tgqMatrixFor(
        matrices,
        row.category_id ? String(row.category_id) : null,
        row.matrix_type === null || row.matrix_type === undefined ? null : String(row.matrix_type),
      ),
    );
    let group = groups.get(key);
    if (!group) {
      const fieldLabel = row.field_name === null || row.field_name === undefined ? null : String(row.field_name);
      group = {
        key,
        area: folded === null ? null : (rawArea ?? "").replace(/\s+/g, " ").trim(),
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
        phases: [],
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
      specShips: shipsFor(String(row.record_id), jsonId),
      projection: row.source_kind === "attribute",
    });
  }

  // Which phase each record is on, and the phases' own order, for `phases`.
  const phaseOf = new Map<string, { runId: string; name: string; sort: number }>();
  for (const row of rows) {
    phaseOf.set(String(row.record_id), {
      runId: String(row.run_id),
      name: String(row.run_name ?? ""),
      sort: Number(row.run_sort ?? 0),
    });
  }

  for (const group of groups.values()) {
    group.items = new Set(group.rows.map((row) => row.recordId)).size;
    const byPhase = new Map<string, { runId: string; name: string; sort: number; records: Set<string> }>();
    for (const row of group.rows) {
      const phase = phaseOf.get(row.recordId)!;
      const entry = byPhase.get(phase.runId) ?? { ...phase, records: new Set<string>() };
      entry.records.add(row.recordId);
      byPhase.set(phase.runId, entry);
    }
    group.phases = [...byPhase.values()]
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name) || a.runId.localeCompare(b.runId))
      .map((entry) => ({ runId: entry.runId, name: entry.name, items: entry.records.size }));
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
export async function applyProjectWide(txn: TxnSql, input: FanOutInput): Promise<ApplyProjectWideResult> {
  return applyFanOut(txn, "project", input);
}

/** Answer one area question on every item in that area that asks it. The same rules, refused WHOLE if the set moved. */
export async function applyAreaWide(txn: TxnSql, input: FanOutInput): Promise<ApplyProjectWideResult> {
  return applyFanOut(txn, "area", input);
}

export type FanOutInput = {
  projectId: string;
  key: string;
  value: string | null;
  state: "confirmed" | "tbc";
  seen: SeenRow[];
  /** Answer ids of settled, differing rows the person ticked to replace. */
  overrides: string[];
  reason: string | null;
  actor: string;
  /**
   * The phase the card was filtered to (chase review C3), or null for every
   * phase. The set is re-derived under the lock WITH it, so a card filtered to
   * MUR writes MUR's items only, and its rows sent without the phase are a
   * different set and refused whole.
   */
  runId?: string | null;
};

async function applyFanOut(
  txn: TxnSql,
  scope: FanOutScope,
  {
    projectId,
    key,
    value,
    state,
    seen,
    overrides,
    reason,
    actor,
    runId = null,
  }: FanOutInput,
): Promise<ApplyProjectWideResult> {
  // The phase narrows an AREA card only; the project card is the project's.
  const phase = scope === "area" ? (runId ?? null) : null;
  // THE PROJECT LOCK, first — for an area too, because what moves an area's
  // set (an item added, retired, moved to another area) is a write to the
  // project's records. Two people answering the same question, or a bill
  // confirm adding the 29th item, queue behind it rather than interleave.
  const project = await txn`select id from projects where id = ${projectId} for update`;
  if (!project[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });

  // THE RECORDS, LOCKED BEFORE THE SET IS READ AGAIN (chase review C4,
  // 2026-11-21). The project lock holds back what takes it (a bill confirm, a
  // second press), but an AREA edit (`editRecordDetails`) and a category change
  // lock only their record: an item moved to Terrace between a first read and
  // the record locks received Restaurant's answer. So every record the screen
  // showed or a first read finds is locked, project then records in id order
  // (`record-lock.ts`), and only then is the set derived for real. An item
  // moved IN after this is outside the write and the comparison below refuses
  // the press; one moved OUT is held here and shows as moved.
  // `seen` is the client's word, so only THIS project's records are locked —
  // `lockRecords`' own statement (id order, `for update`) with the project in it.
  const first = (await loadFanOut(txn, projectId, scope, phase)).find((group) => group.key === key);
  const candidates = [...new Set([...seen.map((row) => row.recordId), ...(first?.rows ?? []).map((row) => row.recordId)])].sort();
  if (candidates.length > 0) {
    await txn`
      select id from spec_records
       where id = any(${candidates}::uuid[]) and project_id = ${projectId}
       order by id
         for update
    `;
  }

  const question = (await loadFanOut(txn, projectId, scope, phase)).find((group) => group.key === key);
  // What the card says the answer is FOR, in every sentence below.
  const forWhat = scope === "area" ? `for ${question?.area ?? "the area"}` : "for the project";
  if (!question) {
    throw new DomainConflictError(
      "project_wide_gone",
      scope === "area"
        ? "No item in that area asks that question any more. Nothing was written — reload."
        : "No item on this project asks that question any more. Nothing was written — reload.",
    );
  }
  if (question.jsonId === DIMENSIONS_JSON_ID) {
    throw new DomainConflictError(
      "dimension",
      `A dimension is recorded per item, never once ${scope === "area" ? "for an area" : "for the project"}.`,
      { status: 400 },
    );
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
      `The items asking “${question.heading}”${scope === "area" ? ` in ${question.area}` : ""} changed since this card loaded — an item was added, retired or moved, or one of their answers moved. Nothing was written. Reload and check the list again.`,
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
        ? `Every item asking “${question.heading}” already holds an answer, or a spec that fills this BWS field, and none was ticked to replace. Nothing was written.`
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
      ? `Recorded “${question.heading}” as TBC ${forWhat}, on ${n} item${n === 1 ? "" : "s"}.`
      : `Recorded “${question.heading}” as “${value}” ${forWhat}, on ${n} item${n === 1 ? "" : "s"}.`;
  const typed = reason?.trim() ? reason.trim() : null;
  const { changeSetId, attached } = await changeSetForEdit(txn, {
    projectId,
    actor,
    kind: "manual_edit",
    // WITH NOTHING TYPED, the open change wins: this app's own sentence would
    // open a fresh change set and detach the press from the meeting it
    // happened in.
    //
    // A TYPED REASON IS KEPT, open change or not (audit E8, 2026-11-06). The
    // card asks for one before it replaces a settled answer, and this used to
    // pass null whenever a change was open, so the one sentence explaining an
    // override was dropped and the trail showed only the meeting's name. A
    // change set is append-only (0012) and cannot take it afterwards, so it
    // follows `changeSetForEdit`'s rule for every other edit: a reason given
    // WITH an edit is about that edit, and gets a change of its own.
    reason: typed ? `${typed} — ${sentence}` : open ? null : sentence,
  });

  // EVERY RECORD THIS WRITES, locked in id order before the first answer
  // (`record-lock.ts`). `editAnswer` takes its record's lock itself, but one
  // at a time in the plan's order, which is not id order; a confirm holding
  // two of these records in id order could then deadlock with this loop.
  await lockRecords(
    txn,
    targets.map((row) => row.recordId),
  );

  // NO CHECKLIST ROW YET: created `missing` first, inside this change, so the
  // edit below is the ordinary edit with its ordinary lock. ONE insert for
  // every such row (review 4A, 2026-11-16), not one per row — the records are
  // already locked above, and the rows are new, so nothing else can see them.
  // It is `insertMissingAnswerRows`, the one insert (L1, 2026-11-21), narrowed
  // to the pairs this press writes: never a row for another question.
  const missing = targets.filter((row) => !row.answerId);
  const createdFor = new Map<string, { id: string; version: number }>();
  if (missing.length > 0) {
    const created = await insertMissingAnswerRows(
      txn,
      missing.map((row) => row.recordId),
      actor,
      { only: missing.map((row) => ({ recordId: row.recordId, requirementId: row.requirementId })) },
    );
    for (const row of created) createdFor.set(`${row.recordId}:${row.requirementId}`, { id: row.id, version: row.version });
  }

  for (const row of targets) {
    let answerId = row.answerId;
    let version = row.answerVersion;
    if (!answerId) {
      const created = createdFor.get(`${row.recordId}:${row.requirementId}`);
      // The set was read under the record locks, so the row cannot have
      // appeared since; a missing one is a fault, never a silent skip.
      if (!created) throw new Error(`no answer row was created for ${row.recordId}:${row.requirementId}`);
      answerId = created.id;
      version = created.version;
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
