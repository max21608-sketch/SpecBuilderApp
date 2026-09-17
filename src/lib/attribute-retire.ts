// Taking a spec off a record.
//
// ============================================================================
// THE DEAD END THIS CLOSES.
//
// `record_attributes` has had `status`, `retired_at` and `retired_by` since
// 0007 and nothing has ever set them. Three blocker messages in
// drawing-document.ts tell a reviewer to "retire the old value" when a second
// document claims a slot, and until now there was nowhere to do it — so a
// revised drawing for one item simply could not land.
//
// RETIRING IS NOT DELETING, for the reason project_notes gives: an attribute
// is evidence that a document said something, and deleting a wrong one takes
// with it the fact that anybody ever looked. The row stays, with who retired
// it and when, and — when something replaced it — which row took over.
//
// ---- AND IT MUST RECOMPOSE THE CHECKLIST --------------------------------
//
// This is the part that is easy to leave out and wrong to. Confirming a
// drawing writes two rows: the attribute and the checklist answer it fills.
// Retiring the attribute and leaving the answer means the checklist goes on
// reporting a confirmed fabric the record holds no statement for, AND THE
// EXPORT STILL SHIPS IT — a confirmed answer is exported whether or not an
// attribute backs it. So the whole record is recomposed from what is left,
// and a field nothing speaks to any more goes back to `missing`.
//
// A person's own answer is never touched by either half. The change set
// records that it now stands on nothing, which is a thing for a human to
// look at rather than for this code to decide.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { isFinishKind } from "@/lib/finishes";
import { changeSetForEdit, type UploadedEvidence } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import {
  applyAnswerFills,
  applyAnswerRetractions,
  planAnswerFills,
  type PromotableAttribute,
} from "@/lib/promote-answers";

export type RetireAttributeResult = {
  attributeId: string;
  recordId: string;
  answersFilled: number;
  answersRetracted: number;
  snapshotNo: number | null;
  changeSetId: string;
};

/** Every active attribute on a record, in the shape the promotion functions take. */
export async function loadPromotable(txn: TxnSql, recordId: string): Promise<PromotableAttribute[]> {
  const rows = await txn`
    select a.attr_group, a.dimension_slot, a.spec_field_id, a.value, a.qualifier, a.unit, a.state, a.sort_order, a.source_run_id,
           a.finish_id, f.code as finish_code, f.code_norm as finish_code_norm, f.kind as finish_kind,
           f.description as finish_description, f.supplier_raw as finish_supplier_raw,
           f.reference as finish_reference, f.colour as finish_colour, f.state as finish_state
    from record_attributes a
    left join project_finishes f on f.id = a.finish_id
    where a.record_id = ${recordId} and a.status = 'active'
    order by a.sort_order
  `;
  return rows.map((row) => ({
    attrGroup: String(row.attr_group),
    dimensionSlot: row.dimension_slot ? String(row.dimension_slot) : null,
    specFieldId: row.spec_field_id ? String(row.spec_field_id) : null,
    value: row.value === null || row.value === undefined ? null : String(row.value),
    qualifier: row.qualifier === null || row.qualifier === undefined ? null : String(row.qualifier),
    unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
    state: String(row.state) as PromotableAttribute["state"],
    sortOrder: Number(row.sort_order),
    sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
    finish: row.finish_id
      ? {
          id: String(row.finish_id),
          code: String(row.finish_code),
          codeNorm: String(row.finish_code_norm),
          kind: isFinishKind(row.finish_kind) ? row.finish_kind : null,
          description: row.finish_description === null || row.finish_description === undefined ? null : String(row.finish_description),
          supplierRaw: row.finish_supplier_raw === null || row.finish_supplier_raw === undefined ? null : String(row.finish_supplier_raw),
          reference: row.finish_reference === null || row.finish_reference === undefined ? null : String(row.finish_reference),
          colour: row.finish_colour === null || row.finish_colour === undefined ? null : String(row.finish_colour),
          state: String(row.finish_state) as PromotableAttribute["state"],
        }
      : null,
  }));
}

/**
 * Recomposes a record's checklist from whatever attributes it now has.
 *
 * Fills first, then retractions: the retraction statement is told which fields
 * are still claimed, so running it first would clear a field the fill is about
 * to rewrite and report two movements for one.
 */
export async function recomposeAnswers(
  txn: TxnSql,
  recordId: string,
  runId: string | null,
  actor: string,
): Promise<{ filled: number; retracted: number }> {
  const attributes = await loadPromotable(txn, recordId);
  const fills = planAnswerFills(attributes);
  const filled = await applyAnswerFills(txn, recordId, runId, actor, fills);
  const retracted = await applyAnswerRetractions(txn, recordId, actor, fills);
  return { filled, retracted };
}

/**
 * Puts a retired spec back.
 *
 * house/data-safety.md: "Keep the data and add the way back." Retiring is a
 * dismissal, and every dismissal in this app is reversible — `project_notes`
 * already works this way, and an attribute is the same kind of evidence.
 *
 * TWO THINGS CAN REFUSE IT, and both are the right answer rather than an
 * obstacle:
 *
 *   * Something else now holds the slot. The partial unique indexes count only
 *     active rows, so restoring would make two rows current. The reviewer is
 *     told which value is in the way rather than getting a constraint
 *     violation, and can retire that one first if the restore is what they
 *     meant.
 *   * It was SUPERSEDED — a revised drawing took its place. Restoring it
 *     silently would leave the item holding the old value and the new one with
 *     nothing to say which is current. Retire the replacement first.
 */
export async function restoreAttribute(
  txn: TxnSql,
  {
    attributeId,
    expectedVersion,
    reason,
    actor,
  }: { attributeId: string; expectedVersion: number; reason: string; actor: string },
): Promise<RetireAttributeResult> {
  const rows = await txn`
    select a.id, a.record_id, a.version, a.status, a.label, a.spec_field_id, a.dimension_slot,
           a.superseded_by_id, r.project_id
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where a.id = ${attributeId}
    for update of a
  `;
  const attribute = rows[0];
  if (!attribute) throw new DomainConflictError("not_found", "No such spec.", { status: 404 });
  if (String(attribute.status) !== "retired") {
    throw new DomainConflictError("not_retired", "That spec is already on the item.");
  }
  if (Number(attribute.version) !== expectedVersion) {
    throw new DomainConflictError(
      "attribute_version_stale",
      `“${String(attribute.label)}” changed while you had it open. Reload before restoring it.`,
    );
  }
  if (attribute.superseded_by_id) {
    throw new DomainConflictError(
      "superseded",
      "A later drawing replaced this spec. Retire the replacement first, or this item would hold both with nothing to say which is current.",
    );
  }

  const recordId = String(attribute.record_id);

  // What is in the way, named. Checked here rather than left to the partial
  // unique index, whose violation reaches a reviewer as "Nothing was written".
  if (attribute.spec_field_id || attribute.dimension_slot) {
    const clash = await txn`
      select label, value from record_attributes
      where record_id = ${recordId}
        and status = 'active'
        and ((${attribute.spec_field_id}::uuid is not null and spec_field_id = ${attribute.spec_field_id}::uuid)
          or (${attribute.dimension_slot}::text is not null and dimension_slot = ${attribute.dimension_slot}::text))
    `;
    if (clash[0]) {
      throw new DomainConflictError(
        "slot_taken",
        `This item already holds “${String(clash[0].label)}${clash[0].value ? `: ${String(clash[0].value)}` : ""}” in that slot. Retire that one first if this is the value you want.`,
      );
    }
  }

  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: String(attribute.project_id),
    actor,
    kind: "attribute_retire",
    reason,
  });

  const restored = await txn`
    update record_attributes
    set status = 'active', retired_at = null, retired_by = null, updated_by = ${actor}
    where id = ${attributeId} and version = ${expectedVersion} and status = 'retired'
    returning id
  `;
  if (!restored[0]) {
    throw new DomainConflictError("attribute_version_stale", "That spec changed as you saved. Nothing was written — reload.");
  }

  const { filled, retracted } = await recomposeAnswers(txn, recordId, null, actor);
  const snapshots = await snapshotRecords(txn, [recordId], changeSetId);

  return {
    attributeId,
    recordId,
    answersFilled: filled,
    answersRetracted: retracted,
    snapshotNo: snapshots.get(recordId) ?? null,
    changeSetId,
  };
}

export async function retireAttribute(
  txn: TxnSql,
  {
    attributeId,
    expectedVersion,
    reason,
    evidence,
    actor,
  }: {
    attributeId: string;
    expectedVersion: number;
    reason: string;
    evidence?: UploadedEvidence | null;
    actor: string;
  },
): Promise<RetireAttributeResult> {
  const rows = await txn`
    select a.id, a.record_id, a.version, a.status, a.label, r.project_id, r.status as record_status
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where a.id = ${attributeId}
    for update of a
  `;
  const attribute = rows[0];
  if (!attribute) throw new DomainConflictError("not_found", "No such spec.", { status: 404 });
  if (String(attribute.status) !== "active") {
    throw new DomainConflictError("already_retired", "That spec has already been taken off this item. Reload.");
  }
  if (Number(attribute.version) !== expectedVersion) {
    throw new DomainConflictError(
      "attribute_version_stale",
      `“${String(attribute.label)}” changed while you had it open. Reload before retiring it.`,
    );
  }

  const recordId = String(attribute.record_id);

  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: String(attribute.project_id),
    actor,
    kind: "attribute_retire",
    reason,
    evidence,
  });

  const retired = await txn`
    update record_attributes
    set status = 'retired', retired_at = now(), retired_by = ${actor}, updated_by = ${actor}
    where id = ${attributeId} and version = ${expectedVersion} and status = 'active'
    returning id
  `;
  if (!retired[0]) {
    throw new DomainConflictError("attribute_version_stale", "That spec changed as you saved. Nothing was written — reload.");
  }

  // Recomposed from what is LEFT. `runId` is null: this confirm is not a
  // document, and every fill that survives already carries the run that
  // supplied its value.
  const { filled, retracted } = await recomposeAnswers(txn, recordId, null, actor);

  const snapshots = await snapshotRecords(txn, [recordId], changeSetId);

  return {
    attributeId,
    recordId,
    answersFilled: filled,
    answersRetracted: retracted,
    snapshotNo: snapshots.get(recordId) ?? null,
    changeSetId,
  };
}
