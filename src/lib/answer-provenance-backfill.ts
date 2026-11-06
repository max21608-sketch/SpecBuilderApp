// Giving every answer written before 0050 the provenance 0050 records.
//
// ============================================================================
// WHAT 0050 CHANGED, AND WHY EXISTING ROWS NEED A PASS.
//
// Before 0050 a checklist answer composed from the record's attributes and an
// answer a reviewer confirmed off a schedule straight onto the question were
// both `source_kind = 'document'`, and `promote-answers.ts` told them apart by
// the document behind `source_id`. That inference froze every answer a bill,
// a schedule, the tracker or an email had filled (audit E1). Since 0050 the
// recompose writes `attribute` and touches nothing else, so every projected
// answer written before it is now out of reach until it is relabelled. Some of
// them are also WRONG: frozen at a value the attributes no longer say, or
// still confirmed over a spec somebody retired, which the export ships.
//
// THE DECISION IS ONE PURE FUNCTION (`decideAnswerProvenance`), tested in the
// pure tier, over rows the planner loads. In order, for each `document` answer
// that is not `missing` and belongs to a BWS field:
//
//   1. No `source_id`: a hand-typed spec composed it (0028). Every document
//      path writes a run id. A projection.
//   2. Its run is a BILL, a SHOP DRAWING, or an EMAIL. None of the three ever
//      wrote an answer directly as `document`: a bill and a drawing write only
//      attributes, and an email's direct answers are `email`. A projection.
//   3. An active attribute holds the field and came from that same run. The
//      spec-document confirm recomposed it. A projection.
//   4. Its run is a schedule (or a run no longer on record) and NO active
//      attribute holds the field: a reviewer's own answer. Left `document`.
//   5. Its run is a schedule and an active attribute holds the field, from a
//      different run. Either a projection, or a reviewer's answer an attribute
//      landed on later. Decided by VALUE: if the answer already says what the
//      attributes compose, it is a projection and nothing changes; otherwise a
//      person decides, and both values are printed.
//
// A projection is relabelled `attribute` and RECOMPOSED through the one path
// every writer uses (`recomposeAnswers`), which is where a frozen answer gets
// its current value back and a retired spec's answer goes back to `missing`.
// What it will become is computed here first with `planAnswerFills`, never
// re-expressed, so the dry run prints the change the apply makes.
//
// A readiness answer (no BWS field) is never a projection, whatever wrote it.
// `manual`, `email` and `attribute` answers are not touched.
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";
import type { SqlLike } from "@/lib/record-atoms";
import { openChangeSet } from "@/lib/change-sets";
import { loadPromotable, recomposeAnswers } from "@/lib/attribute-retire";
import { snapshotRecords } from "@/lib/record-snapshot";
import {
  composesIntoCell,
  DIMENSIONS_JSON_ID,
  planAnswerFills,
  type PromotableAttribute,
} from "@/lib/promote-answers";
import { recordLabel, numberingFromRow } from "@/lib/record-label";

/** An intake run, as far as this decision reads one. */
export type ProvenanceRun = { sourceKind: string; documentKind: string | null };

export type ProvenanceAnswer = {
  id: string;
  /** The BWS field the question asks for; null for a readiness question. */
  fieldId: string | null;
  jsonId: number | null;
  sourceKind: string;
  sourceId: string | null;
  value: string | null;
  qualifier: string | null;
  state: string;
};

export type AnswerStatement = { value: string | null; qualifier: string | null; state: string };

export type ProvenanceDecision =
  | {
      answerId: string;
      outcome: "projection";
      /** Null where the answer already says what the attributes compose. */
      change: { from: AnswerStatement; to: AnswerStatement } | null;
    }
  | { answerId: string; outcome: "left_document" }
  | { answerId: string; outcome: "needs_person"; held: AnswerStatement; composed: AnswerStatement };

/** The kinds of run that never wrote a `document` answer except by recomposing. */
const PROJECTION_ONLY_DOCUMENT_KINDS = new Set(["shop_drawings", "email"]);

function statementOf(answer: ProvenanceAnswer): AnswerStatement {
  return { value: answer.value ?? null, qualifier: answer.qualifier ?? null, state: answer.state };
}

function sameStatement(a: AnswerStatement, b: AnswerStatement): boolean {
  return (a.value ?? null) === (b.value ?? null) && (a.qualifier ?? null) === (b.qualifier ?? null) && a.state === b.state;
}

/** The attributes that speak to an answer's field: the composing slots for Dimensions, else the field's own. */
function holdersOf(answer: ProvenanceAnswer, attributes: readonly PromotableAttribute[]): PromotableAttribute[] {
  if (answer.jsonId === DIMENSIONS_JSON_ID) return attributes.filter(composesIntoCell);
  return attributes.filter((attribute) => attribute.attrGroup !== "dimension" && attribute.specFieldId === answer.fieldId);
}

/**
 * Whether an answer is CONFIRMED over a field no active attribute holds, and
 * is not a person's own (`manual` or `email`). Audit E1's symptom, counted per
 * project before anything is written: the export falls back to the answer
 * where no attribute holds a field, so each of these is a value the file
 * ships with nothing behind it. `document` ones may still be a reviewer's own
 * answer off a schedule; the count is a measurement for Max, not a verdict.
 */
export function standsOnNothing(answer: ProvenanceAnswer, attributes: readonly PromotableAttribute[]): boolean {
  if (answer.state !== "confirmed" || answer.fieldId === null) return false;
  if (answer.sourceKind === "manual" || answer.sourceKind === "email") return false;
  return holdersOf(answer, attributes).length === 0;
}

/** What `recomposeAnswers` will leave in this answer: the fill for its field, or `missing`. */
function composedFor(answer: ProvenanceAnswer, attributes: PromotableAttribute[], dimensionNote: string | null): AnswerStatement {
  const fill = planAnswerFills(attributes, dimensionNote).find((candidate) =>
    answer.jsonId === DIMENSIONS_JSON_ID ? candidate.jsonId === DIMENSIONS_JSON_ID : candidate.specFieldId === answer.fieldId,
  );
  return fill ? { value: fill.value, qualifier: fill.qualifier, state: fill.state } : { value: null, qualifier: null, state: "missing" };
}

/** See the header for the five rules, in this order. */
export function decideAnswerProvenance(input: {
  attributes: PromotableAttribute[];
  dimensionNote: string | null;
  answers: readonly ProvenanceAnswer[];
  runs: ReadonlyMap<string, ProvenanceRun>;
}): ProvenanceDecision[] {
  const decisions: ProvenanceDecision[] = [];
  for (const answer of input.answers) {
    if (answer.sourceKind !== "document" || answer.state === "missing") continue;
    if (answer.fieldId === null) {
      decisions.push({ answerId: answer.id, outcome: "left_document" });
      continue;
    }

    const held = statementOf(answer);
    const composed = composedFor(answer, input.attributes, input.dimensionNote);
    const projection = (): ProvenanceDecision => ({
      answerId: answer.id,
      outcome: "projection",
      change: sameStatement(held, composed) ? null : { from: held, to: composed },
    });

    if (answer.sourceId === null) {
      decisions.push(projection());
      continue;
    }
    const run = input.runs.get(answer.sourceId) ?? null;
    if (run && (run.sourceKind === "boq_xlsx" || PROJECTION_ONLY_DOCUMENT_KINDS.has(run.documentKind ?? ""))) {
      decisions.push(projection());
      continue;
    }
    const holders = holdersOf(answer, input.attributes);
    if (holders.some((attribute) => attribute.sourceRunId === answer.sourceId)) {
      decisions.push(projection());
      continue;
    }
    if (holders.length === 0) {
      decisions.push({ answerId: answer.id, outcome: "left_document" });
      continue;
    }
    decisions.push(
      sameStatement(held, composed)
        ? { answerId: answer.id, outcome: "projection", change: null }
        : { answerId: answer.id, outcome: "needs_person", held, composed },
    );
  }
  return decisions;
}

// ---- reading a database ----------------------------------------------------

export type ProvenanceLine = {
  recordId: string;
  recordLabel: string;
  answerId: string;
  field: string;
};

export type AnswerProvenanceProject = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  /** Answers confirmed over a field no active attribute holds, not manual or email, BEFORE this pass. */
  standingOnNothing: number;
  /** Per record: the answers to relabel, and whether any of them changes value. */
  records: { recordId: string; relabel: string[]; recompose: boolean }[];
  relabelled: number;
  changed: (ProvenanceLine & { from: AnswerStatement; to: AnswerStatement })[];
  leftAsDocument: number;
  needsPerson: (ProvenanceLine & { held: AnswerStatement; composed: AnswerStatement })[];
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

/**
 * Reads every active record of every project (or one), and decides each of
 * its `document` answers. Writes nothing.
 */
export async function planAnswerProvenance(exec: SqlLike, projectId: string | null): Promise<AnswerProvenanceProject[]> {
  const projects = await exec`
    select id, bws_project_number, name from projects
     where (${projectId}::uuid is null or id = ${projectId}::uuid)
     order by bws_project_number
  `;
  const out: AnswerProvenanceProject[] = [];

  for (const project of projects) {
    const pid = String(project.id);
    const runRows = await exec`select id, source_kind, document_kind from intake_runs where project_id = ${pid}`;
    const runs = new Map<string, ProvenanceRun>(
      runRows.map((row) => [String(row.id), { sourceKind: String(row.source_kind), documentKind: text(row.document_kind) }]),
    );
    const records = await exec`
      select r.id, r.record_no, r.variant_ordinal, r.dimension_note, p.bws_project_number,
             (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no
        from spec_records r
        join projects p on p.id = r.project_id
       where r.project_id = ${pid} and r.status = 'active'
       order by r.record_no, r.variant_ordinal nulls first
    `;
    const plan: AnswerProvenanceProject = {
      projectId: pid,
      projectNumber: String(project.bws_project_number),
      projectName: String(project.name),
      standingOnNothing: 0,
      records: [],
      relabelled: 0,
      changed: [],
      leftAsDocument: 0,
      needsPerson: [],
    };

    for (const record of records) {
      const recordId = String(record.id);
      const answerRows = await exec`
        select a.id, a.spec_field_id, f.json_id, f.name as field_name, q.prompt,
               a.source_kind, a.source_id, a.value, a.qualifier, a.state
          from spec_answers a
          join requirements q on q.id = a.requirement_id
          left join spec_fields f on f.id = a.spec_field_id
         where a.record_id = ${recordId} and a.revision_no = 0
      `;
      const answers: (ProvenanceAnswer & { field: string })[] = answerRows.map((row) => ({
        id: String(row.id),
        fieldId: text(row.spec_field_id),
        jsonId: row.json_id === null || row.json_id === undefined ? null : Number(row.json_id),
        sourceKind: String(row.source_kind),
        sourceId: text(row.source_id),
        value: text(row.value),
        qualifier: text(row.qualifier),
        state: String(row.state),
        field: text(row.field_name) ?? String(row.prompt),
      }));
      // `loadPromotable` takes a transaction-shaped executor and reads with
      // nothing but a tagged template, so the planner's own executor serves.
      const attributes = await loadPromotable(exec as unknown as TxnSql, recordId);
      plan.standingOnNothing += answers.filter((answer) => standsOnNothing(answer, attributes)).length;

      const decisions = decideAnswerProvenance({ attributes, dimensionNote: text(record.dimension_note), answers, runs });
      const label = recordLabel(String(record.bws_project_number), numberingFromRow(record));
      const byId = new Map(answers.map((answer) => [answer.id, answer]));
      const relabel: string[] = [];
      let recompose = false;
      for (const decision of decisions) {
        const answer = byId.get(decision.answerId);
        const line = { recordId, recordLabel: label, answerId: decision.answerId, field: answer?.field ?? "?" };
        if (decision.outcome === "projection") {
          relabel.push(decision.answerId);
          if (decision.change) {
            recompose = true;
            plan.changed.push({ ...line, from: decision.change.from, to: decision.change.to });
          }
        } else if (decision.outcome === "left_document") {
          plan.leftAsDocument += 1;
        } else {
          plan.needsPerson.push({ ...line, held: decision.held, composed: decision.composed });
        }
      }
      if (relabel.length > 0) plan.records.push({ recordId, relabel, recompose });
      plan.relabelled += relabel.length;
    }
    out.push(plan);
  }
  return out;
}

/**
 * Writes one project's plan, inside the caller's transaction: ONE change set
 * (`manual_edit`, with a reason naming this pass; no kind is added for a
 * one-off), each projection relabelled, a record recomposed where one of its
 * answers changes, and ONE version of every record written.
 *
 * A RELABEL TAKES A VERSION TOO, and bumps the answer's version, and both are
 * deliberate. `bump_version` fires on every update of `spec_answers`, so the
 * answer version cannot be held. And the snapshot carries each answer's
 * source kind: a relabel with no version would surface as "Source: document →
 * attribute" in the diff of whatever change touched the record NEXT, under
 * that change's reason. The coverage assertion in change-history.test.ts
 * would also, rightly, fail a change set that wrote answers and took no
 * version.
 *
 * Re-checked in the write: only a row still `document` is relabelled, so a
 * second run, or a person's edit since the plan was read, is left alone.
 */
export async function applyAnswerProvenance(
  txn: TxnSql,
  project: AnswerProvenanceProject,
  actor: string,
): Promise<{ relabelled: number; recomposed: number; changeSetId: string | null }> {
  if (project.records.length === 0) return { relabelled: 0, recomposed: 0, changeSetId: null };
  // Nothing left to relabel (a second run): no change set, rather than an
  // entry in the trail that changed nothing.
  const planned = project.records.flatMap((record) => record.relabel);
  const left = await txn`
    select count(*)::int as n from spec_answers where id = any(${planned}::uuid[]) and source_kind = 'document'
  `;
  if (Number(left[0]?.n ?? 0) === 0) return { relabelled: 0, recomposed: 0, changeSetId: null };

  const changeSetId = await openChangeSet(txn, {
    projectId: project.projectId,
    kind: "manual_edit",
    actor,
    reason:
      "Answer provenance (0050): answers composed from the record's specs are marked so, and any that had stopped " +
      "following their specs are recomposed from them.",
  });

  let relabelled = 0;
  let recomposed = 0;
  const written: string[] = [];
  for (const record of project.records) {
    const moved = await txn`
      update spec_answers set source_kind = 'attribute', updated_by = ${actor}
       where id = any(${record.relabel}::uuid[]) and record_id = ${record.recordId} and source_kind = 'document'
      returning id
    `;
    if (moved.length === 0) continue;
    relabelled += moved.length;
    written.push(record.recordId);
    if (record.recompose) {
      await recomposeAnswers(txn, record.recordId, null, actor);
      recomposed += 1;
    }
  }
  if (written.length > 0) await snapshotRecords(txn, written, changeSetId);
  return { relabelled, recomposed, changeSetId };
}
