// Correcting a spec, without losing the page it was read from.
//
// ============================================================================
// THE VERB THAT WAS MISSING.
//
// Matthew went looking for confirm-or-update on a confirmed record and neither
// he nor Max could find it, because there was nothing to find. A confirmed
// `record_attributes` row could be RETIRED (reason required) or a new one
// TYPED by hand, and nothing else. Correcting `W1900` to `W1090` off the SAME
// page therefore meant two acts, two change sets, and a replacement carrying
// no source run and no page — because a hand-typed spec deliberately carries
// neither. The record then held the right number with nothing saying where to
// check it, beside a retired row that still cited the page.
//
// ---- WHY NOT AN UPDATE IN PLACE ------------------------------------------
//
// `record_attributes` is WHAT A DOCUMENT SAID. An in-place edit makes the row
// say something the page does not while still naming that page as its source —
// a false provenance — and the history could then never answer "what did the
// card say before Max fixed it". So a correction is a SUPERSESSION BY A
// PERSON, exactly the shape 0016 built for a revised drawing: the old row is
// retired with `superseded_by_id` pointing at a new row that KEEPS its source
// run and page, because the page is still where to go and check the figure.
//
// A hand-typed row carries no page, and its correction carries none either.
// Copied, never invented: a link opening a document at page 1 to stand in
// would be a false provenance rather than a missing one.
//
// ---- WHAT IT MUST NOT DO -------------------------------------------------
//
//   * Touch `spec_records.version`. An attribute is its own row; bumping the
//     record invalidates every extraction snapshot and chase coverage row
//     taken against it, for a reason that has nothing to do with them.
//   * Write `spec_answers` directly. The checklist is a PROJECTION of the
//     attributes, recomposed by `recomposeAnswers` — write the answer here and
//     the next drawing confirm recomposes from the attributes alone and wipes
//     the correction.
//   * Accept a correction onto a row that is not the current active occupant
//     of the slot it would land in. Refused, naming what is there.
//
// THE ORDER IS THE DATABASE'S, NOT A PREFERENCE. Both partial unique indexes
// (`record_attributes_field_slot_key`, `record_attributes_dimension_slot_key`)
// count only ACTIVE rows, so retire must come before insert or the insert
// cannot commit. `superseded_by_id` is then set on the retired row, which is
// the only order 0016's own check (`superseded_by_id is null or status =
// 'retired'`) allows.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit, type UploadedEvidence } from "@/lib/change-sets";
import { isFinishCodeOrigin, isFinishKind, resolveFinishCode, type Finish } from "@/lib/finishes";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers } from "@/lib/attribute-retire";
import type { AttributeState, AttributeUnit, DimensionSlot } from "@/lib/spec-vocab";

export type CorrectAttributeResult = {
  /** The NEW row. The corrected value lives here; the old id is below. */
  attributeId: string;
  /** The row that was retired, now pointing at the new one. */
  supersededId: string;
  recordId: string;
  answersFilled: number;
  answersRetracted: number;
  snapshotNo: number | null;
  changeSetId: string;
  /**
   * The old row was linked to a finish and the corrected words disagree with
   * what the library says that code is, so the new row is NOT linked.
   *
   * The library is the truth and the attribute is the evidence: linking would
   * make the item render the library's words while its own page said something
   * else. The library row is untouched — correcting it is a separate decision,
   * with its own reason, on the finishes screen.
   */
  finishUnlinked: boolean;
};

export type CorrectAttributeInput = {
  attributeId: string;
  expectedVersion: number;
  /** The corrected value. Null only where the state is `tbc`. */
  value: string | null;
  unit: AttributeUnit | null;
  /**
   * Where a dimension lands. Omitted means "unchanged" — the common case is a
   * mistyped figure or a wrong unit, not a figure in the wrong slot.
   */
  dimensionSlot?: DimensionSlot | null;
  state: AttributeState;
  reason: string;
  evidence?: UploadedEvidence | null;
  actor: string;
};

export async function correctAttribute(
  txn: TxnSql,
  {
    attributeId,
    expectedVersion,
    value,
    unit,
    dimensionSlot,
    state,
    reason,
    evidence,
    actor,
  }: CorrectAttributeInput,
): Promise<CorrectAttributeResult> {
  const rows = await txn`
    select a.id, a.record_id, a.version, a.status, a.label, a.value, a.attr_group,
           a.dimension_slot, a.spec_field_id, a.material_code, a.qualifier,
           a.source_run_id, a.source_page, a.sort_order, a.finish_id, a.superseded_by_id,
           r.project_id
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where a.id = ${attributeId}
    for update of a
  `;
  const attribute = rows[0];
  if (!attribute) throw new DomainConflictError("not_found", "No such spec.", { status: 404 });

  if (String(attribute.status) !== "active") {
    // NAME THE NEWER ROW. "Already retired" on a row somebody has just
    // corrected reads as a failure; it is the correction that happened while
    // this screen was open, and the reviewer needs to know their figure is
    // there rather than lost.
    if (attribute.superseded_by_id) {
      const newer = await txn`
        select label, value, unit from record_attributes where id = ${attribute.superseded_by_id}
      `;
      const row = newer[0];
      throw new DomainConflictError(
        "superseded",
        row
          ? `This spec has already been superseded by “${String(row.label)}${row.value ? `: ${String(row.value)}` : ""}${row.unit ? String(row.unit) : ""}”. Reload and correct that one instead.`
          : "This spec has already been superseded by a later one. Reload before correcting it.",
      );
    }
    throw new DomainConflictError(
      "already_retired",
      "That spec has been taken off this item. Put it back before correcting it, or add the value as a new spec.",
    );
  }

  if (Number(attribute.version) !== expectedVersion) {
    throw new DomainConflictError(
      "attribute_version_stale",
      `“${String(attribute.label)}” changed while you had it open. Reload before correcting it.`,
    );
  }

  const recordId = String(attribute.record_id);
  const attrGroup = String(attribute.attr_group);
  const oldSlot = attribute.dimension_slot ? String(attribute.dimension_slot) : null;
  // Omitted means unchanged. `null` passed explicitly is not accepted on a
  // dimension — 0011 makes `attr_group = 'dimension'` MEAN it carries a slot,
  // so a dimension with none would be refused by a check constraint whose
  // message names nothing useful.
  const nextSlot = dimensionSlot === undefined ? oldSlot : dimensionSlot;
  if (attrGroup === "dimension" && !nextSlot) {
    throw new DomainConflictError(
      "slot_required",
      "A dimension has to say which of W, D, H, SH or Dia it is. Retire it instead if it is not one of those.",
    );
  }
  if (attrGroup !== "dimension" && nextSlot) {
    throw new DomainConflictError("slot_not_a_dimension", "Only a dimension carries a slot.");
  }

  // THE OCCUPANT CHECK. An active row is by definition the occupant of the slot
  // it holds — both indexes are partial on `status = 'active'` — so this only
  // ever fires when the correction MOVES the value into a slot another live row
  // already holds. The reviewer is told which value is in the way, rather than
  // meeting a unique-violation as "Nothing was written".
  if (nextSlot || attribute.spec_field_id) {
    const clash = await txn`
      select label, value from record_attributes
      where record_id = ${recordId}
        and status = 'active'
        and id <> ${attributeId}
        and ((${nextSlot}::text is not null and dimension_slot = ${nextSlot}::text)
          or (${attribute.spec_field_id}::uuid is not null and spec_field_id = ${attribute.spec_field_id}::uuid))
    `;
    if (clash[0]) {
      throw new DomainConflictError(
        "slot_taken",
        `This item already holds “${String(clash[0].label)}${clash[0].value ? `: ${String(clash[0].value)}` : ""}” there. Retire that one first if this is the value you want.`,
      );
    }
  }

  // ---- does the corrected wording still match the library? -----------------
  //
  // `resolveFinishCode` is the single implementation of that question, shared
  // with the drawings confirm. A conflict LINKS NOTHING: the library has
  // committed to a description and this row now says something else, and only a
  // person can say which is out of date.
  //
  // IT IS ASKED ABOUT THE ROW THIS ATTRIBUTE IS ALREADY LINKED TO, so the
  // library row's OWN code goes in rather than the attribute's `material_code`.
  // WHICH finish this is was settled at confirm time and a correction never
  // moves it — `material_code` is copied verbatim below — so the only question
  // left is whether the corrected WORDS still match. Passing the attribute's
  // code instead makes the answer depend on the two normalising onto each
  // other, and a row where they do not would come back `new`, which is not a
  // conflict, and the link would survive a correction that contradicts it.
  let finishId = attribute.finish_id ? String(attribute.finish_id) : null;
  let finishUnlinked = false;
  if (finishId) {
    const finishRows = await txn`
      select id, code, code_norm, code_origin, kind, description, supplier_raw, reference, colour, state
      from project_finishes where id = ${finishId}
    `;
    const row = finishRows[0];
    if (row) {
      const finish: Finish = {
        id: String(row.id),
        code: String(row.code),
        codeNorm: String(row.code_norm),
        codeOrigin: isFinishCodeOrigin(row.code_origin) ? row.code_origin : "client",
        kind: isFinishKind(row.kind) ? row.kind : null,
        description: row.description === null || row.description === undefined ? null : String(row.description),
        supplierRaw: row.supplier_raw === null || row.supplier_raw === undefined ? null : String(row.supplier_raw),
        reference: row.reference === null || row.reference === undefined ? null : String(row.reference),
        colour: row.colour === null || row.colour === undefined ? null : String(row.colour),
        state: String(row.state) as AttributeState,
      };
      const resolution = resolveFinishCode(finish.code, value, [finish]);
      if (resolution.status === "conflict") {
        finishId = null;
        finishUnlinked = true;
      }
    }
  }

  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: String(attribute.project_id),
    actor,
    kind: "attribute_correct",
    reason,
    evidence,
  });

  // RETIRE FIRST. Both partial unique indexes count active rows only, so the
  // reverse order cannot commit — the database decides this, not the comment.
  const retired = await txn`
    update record_attributes
    set status = 'retired', retired_at = now(), retired_by = ${actor}, updated_by = ${actor}
    where id = ${attributeId} and version = ${expectedVersion} and status = 'active'
    returning id
  `;
  if (!retired[0]) {
    throw new DomainConflictError(
      "attribute_version_stale",
      "That spec changed as you saved. Nothing was written — reload.",
    );
  }

  // THE NEW ROW KEEPS THE PAGE. `source_run_id` and `source_page` are copied
  // verbatim, including when they are null: a spec somebody typed is a spec
  // with no page to turn to, and its correction is too.
  //
  // The change set's kind is what records that a PERSON wrote this value —
  // there is no column on `record_attributes` for it, and 0028 added none.
  // `created_by` carries who, `attribute_correct` carries how.
  const inserted = await txn`
    insert into record_attributes
      (record_id, attr_group, label, value, unit, material_code, qualifier, spec_field_id,
       dimension_slot, state, source_run_id, source_page, sort_order, finish_id,
       created_by, updated_by)
    values
      (${recordId}, ${attrGroup}, ${String(attribute.label)}, ${value}, ${unit},
       ${attribute.material_code ?? null}, ${attribute.qualifier ?? null},
       ${attribute.spec_field_id ?? null}, ${nextSlot}, ${state},
       ${attribute.source_run_id ?? null}, ${attribute.source_page ?? null},
       ${Number(attribute.sort_order ?? 0)}, ${finishId}, ${actor}, ${actor})
    returning id
  `;
  const newId = String(inserted[0]!.id);

  // 0016 allows this only on a retired row, which it now is.
  await txn`
    update record_attributes
    set superseded_by_id = ${newId}, updated_by = ${actor}
    where id = ${attributeId}
  `;

  // Recomposed from what the record now holds. `runId` is null: a correction
  // is not a document, and every fill that survives already carries the run
  // that supplied its value.
  const { filled, retracted } = await recomposeAnswers(txn, recordId, null, actor);
  const snapshots = await snapshotRecords(txn, [recordId], changeSetId);

  return {
    attributeId: newId,
    supersededId: attributeId,
    recordId,
    answersFilled: filled,
    answersRetracted: retracted,
    snapshotNo: snapshots.get(recordId) ?? null,
    changeSetId,
    finishUnlinked,
  };
}
