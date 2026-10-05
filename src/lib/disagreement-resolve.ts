// A person settling a disagreement between two documents.
//
// ============================================================================
// THE TWO ANSWERS, AND WHAT EACH ONE WRITES.
//
// 0046 records a later document's statement BESIDE the held value and leaves
// the held value live, because Max's instruction was "keep whatever's in the
// BOQ to begin with" — and to flag it in red until somebody decides. This file
// is that decision, and it always says why (`disagreement_resolve` is in
// REASON_REQUIRED_KINDS and in the database CHECK 0046 re-listed).
//
//   kept_held   The held value is right. The disagreement is closed and NOTHING
//               ELSE MOVES: no attribute, no answer, no record version. It is a
//               decision ABOUT a value, not a change TO one — the same reason
//               recording the disagreement took no version. The change set
//               still carries who, when and why, and the audit rows point at it.
//
//   used_this   The other document is right. This is `attribute-correct.ts`'s
//               supersession with a different source for the new value: the
//               held row is retired (version-checked) and points at a NEW row
//               built from the disagreement's statement, which keeps ITS OWN
//               document and page — the tracker's page 9, not the bill's line.
//               The checklist is recomposed through `recomposeAnswers` (the
//               answer is a projection of the attributes; writing it directly
//               would be wiped by the next drawing confirm) and the record gets
//               ONE version under the change, which is what the whole-database
//               coverage assertion in change-history.test.ts reads.
//
// ---- A HELD VALUE THAT HAS ALREADY GONE ------------------------------------
//
// Two documents can each disagree with the bill's width. Using the first
// retires the bill's row; the second is still OPEN and now points at a retired
// row. It is shown as "was against the bill's value, now replaced" and may
// only be KEPT: using it would retire the value the first decision put there,
// which nobody compared it with. Refused in words naming what replaced it — the
// `correctAttribute` refusal, for the same reason.
//
// ---- WHAT "USE THIS" DOES NOT CARRY ----------------------------------------
//
// The BW standard (0041) on the held row is NOT copied to the new row. A
// correction carries it because a correction is the same statement read again;
// this is a DIFFERENT statement — the tracker's TIM-09 in place of the bill's
// smoked oak — and BW's proposal against the one is not a proposal against the
// other. The retired row keeps it as history, and the result says it was left
// behind so the screen can say so.
//
// THE FINISHES LIBRARY follows the correction flow's rule: the new row is
// linked to a library finish only where the statement's own code resolves to
// one and its words agree (`resolveFinishCode` → matched). A conflict, or a
// code the library does not hold, leaves it unlinked and the library untouched.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit, type UploadedEvidence } from "@/lib/change-sets";
import { resolveFinishCode } from "@/lib/finishes";
import { loadFinishLibrary } from "@/lib/bill-fabric-load";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers } from "@/lib/attribute-retire";
import type { DisagreementDecision } from "@/lib/disagreements";

export type ResolveDisagreementInput = {
  disagreementId: string;
  decision: DisagreementDecision;
  /** The disagreement's version as the screen read it. */
  expectedVersion: number;
  /**
   * The held row's version as the screen read it, for "use this". Optional,
   * because "keep" changes nothing on the held row; checked where given.
   */
  heldVersion?: number | null;
  reason: string;
  evidence?: UploadedEvidence | null;
  actor: string;
};

export type ResolveDisagreementResult = {
  disagreementId: string;
  decision: DisagreementDecision;
  recordId: string;
  changeSetId: string;
  /** used_this only: the new live row, and the row it replaced. */
  attributeId: string | null;
  supersededId: string | null;
  answersFilled: number;
  answersRetracted: number;
  /** used_this only: the record's new version number. Null for kept_held. */
  snapshotNo: number | null;
  /** used_this only: the statement's code disagreed with the library, so the new row is not linked. */
  finishUnlinked: boolean;
  /** used_this only: the held row carried a BW standard, which stays on it and does not move across. */
  standardLeftBehind: boolean;
};

export async function resolveDisagreement(
  txn: TxnSql,
  { disagreementId, decision, expectedVersion, heldVersion, reason, evidence, actor }: ResolveDisagreementInput,
): Promise<ResolveDisagreementResult> {
  // ALWAYS A REASON OF ITS OWN. `changeSetForEdit` would otherwise attach a
  // reasonless edit to the actor's open change, and a decision between two
  // documents is not something an hour-old "Hayley's call" should stand for.
  if (!reason.trim()) {
    throw new DomainConflictError(
      "reason_required",
      "Say why. Both values stay on record, and the reason is what makes the decision readable later.",
      { status: 400 },
    );
  }

  const rows = await txn`
    select d.id, d.project_id, d.record_id, d.held_attribute_id, d.status, d.version,
           d.attr_group, d.label, d.value, d.unit, d.dimension_slot, d.spec_field_id,
           d.material_code, d.state, d.source_run_id, d.source_page,
           d.resolved_at, d.resolved_by
      from attribute_disagreements d
     where d.id = ${disagreementId}
     for update
  `;
  const row = rows[0];
  if (!row) throw new DomainConflictError("not_found", "No such disagreement.", { status: 404 });

  if (String(row.status) !== "open") {
    const who = row.resolved_by ? ` by ${String(row.resolved_by)}` : "";
    throw new DomainConflictError(
      "already_resolved",
      `This disagreement has already been settled${who} — ${
        String(row.status) === "used_this" ? "its value was used instead" : "the held value was kept"
      }. Reload to see it.`,
    );
  }
  if (Number(row.version) !== expectedVersion) {
    throw new DomainConflictError(
      "disagreement_version_stale",
      "This disagreement changed while you had it open. Reload before settling it.",
    );
  }

  // THE HELD ROW, locked: "use this" retires it, and "keep" must not race a
  // correction into calling a value kept that has just been replaced.
  const heldRows = await txn`
    select a.id, a.record_id, a.status, a.version, a.label, a.value, a.unit, a.attr_group,
           a.dimension_slot, a.spec_field_id, a.sort_order, a.superseded_by_id, a.standard_value,
           a.standard_state
      from record_attributes a
     where a.id = ${row.held_attribute_id}
     for update
  `;
  const held = heldRows[0];
  if (!held) throw new DomainConflictError("not_found", "The value this disagreed with no longer exists.", { status: 404 });

  const recordId = String(row.record_id);
  const projectId = String(row.project_id);

  if (decision === "used_this") {
    if (String(held.status) !== "active") {
      // NAME WHAT IS THERE NOW. "Already retired" reads as a failure; it is a
      // decision somebody took while this screen was open, and the reader needs
      // to know which value is live before deciding anything else.
      if (held.superseded_by_id) {
        const newer = await txn`
          select label, value, unit from record_attributes where id = ${held.superseded_by_id}
        `;
        const now = newer[0];
        throw new DomainConflictError(
          "held_replaced",
          now
            ? `The value this disagreed with has already been replaced by “${String(now.label)}${now.value ? `: ${String(now.value)}` : ""}${now.unit ? String(now.unit) : ""}”. It can only be kept now — compare it with that value first.`
            : "The value this disagreed with has already been replaced. Reload before settling it.",
        );
      }
      throw new DomainConflictError(
        "held_retired",
        "The value this disagreed with has been taken off this item. Put it back before using this instead, or add the value as a new spec.",
      );
    }
    if (heldVersion !== undefined && heldVersion !== null && Number(held.version) !== heldVersion) {
      throw new DomainConflictError(
        "attribute_version_stale",
        `“${String(held.label)}” changed while you had it open. Reload before settling this.`,
      );
    }
  }

  const { changeSetId } = await changeSetForEdit(txn, {
    projectId,
    actor,
    kind: "disagreement_resolve",
    reason,
    evidence,
  });

  if (decision === "kept_held") {
    const settled = await txn`
      update attribute_disagreements
         set status = 'kept_held', resolved_at = now(), resolved_by = ${actor},
             change_set_id = ${changeSetId}, updated_by = ${actor}
       where id = ${disagreementId} and version = ${expectedVersion} and status = 'open'
       returning id
    `;
    if (!settled[0]) {
      throw new DomainConflictError(
        "disagreement_version_stale",
        "This disagreement changed as you saved. Nothing was written — reload.",
      );
    }
    return {
      disagreementId,
      decision,
      recordId,
      changeSetId,
      attributeId: null,
      supersededId: null,
      answersFilled: 0,
      answersRetracted: 0,
      snapshotNo: null,
      finishUnlinked: false,
      standardLeftBehind: false,
    };
  }

  // ---- used_this ------------------------------------------------------------
  const attrGroup = String(row.attr_group);
  const slot = row.dimension_slot ? String(row.dimension_slot) : null;
  // The statement's own field, or — where the document named none and it is
  // the same kind of thing — the field the held value was answering. Without
  // the fallback a fabric used from a tracker that named no field would leave
  // COM 1 and retract its checklist answer, which nobody asked for.
  const specFieldId =
    (row.spec_field_id ? String(row.spec_field_id) : null) ??
    (attrGroup === String(held.attr_group) && held.spec_field_id ? String(held.spec_field_id) : null);

  // THE OCCUPANT CHECK, as the correction makes it: the held row is about to
  // leave the slot, so only ANOTHER live row in the slot or field it lands in
  // is in the way — named, rather than met as a unique violation.
  if (slot || specFieldId) {
    const clash = await txn`
      select label, value from record_attributes
       where record_id = ${recordId}
         and status = 'active'
         and id <> ${String(held.id)}
         and ((${slot}::text is not null and dimension_slot = ${slot}::text)
           or (${specFieldId}::uuid is not null and spec_field_id = ${specFieldId}::uuid))
    `;
    if (clash[0]) {
      throw new DomainConflictError(
        "slot_taken",
        `This item already holds “${String(clash[0].label)}${clash[0].value ? `: ${String(clash[0].value)}` : ""}” there. Retire that one first if this is the value you want.`,
      );
    }
  }

  // The library, by the statement's own code.
  let finishId: string | null = null;
  let finishUnlinked = false;
  const materialCode = row.material_code ? String(row.material_code) : null;
  if (materialCode) {
    const resolution = resolveFinishCode(
      materialCode,
      row.value === null ? null : String(row.value),
      await loadFinishLibrary(txn, projectId),
    );
    if (resolution.status === "matched") finishId = resolution.finish.id;
    else if (resolution.status === "conflict") finishUnlinked = true;
  }

  // RETIRE FIRST: both partial unique indexes count active rows only.
  const retired = await txn`
    update record_attributes
       set status = 'retired', retired_at = now(), retired_by = ${actor}, updated_by = ${actor}
     where id = ${String(held.id)} and version = ${Number(held.version)} and status = 'active'
     returning id
  `;
  if (!retired[0]) {
    throw new DomainConflictError(
      "attribute_version_stale",
      "The value this disagreed with changed as you saved. Nothing was written — reload.",
    );
  }

  // THE NEW ROW KEEPS THE OTHER DOCUMENT'S PAGE. That is the point of copying
  // the statement in the attribute's own shape: the tracker's width is checked
  // against the tracker's page 9, never against the bill line it replaced.
  const inserted = await txn`
    insert into record_attributes
      (record_id, attr_group, label, value, unit, material_code, spec_field_id,
       dimension_slot, state, source_run_id, source_page, sort_order, finish_id,
       created_by, updated_by)
    values
      (${recordId}, ${attrGroup}, ${String(row.label)}, ${row.value ?? null}, ${row.unit ?? null},
       ${materialCode}, ${specFieldId}, ${slot}, ${String(row.state)},
       ${row.source_run_id ?? null}, ${row.source_page ?? null},
       ${Number(held.sort_order ?? 0)}, ${finishId},
       ${actor}, ${actor})
    returning id
  `;
  const newId = String(inserted[0]!.id);

  // 0016 allows this only on a retired row, which it now is.
  await txn`
    update record_attributes set superseded_by_id = ${newId}, updated_by = ${actor}
     where id = ${String(held.id)}
  `;

  const settled = await txn`
    update attribute_disagreements
       set status = 'used_this', resolved_at = now(), resolved_by = ${actor},
           resolved_attribute_id = ${newId}, change_set_id = ${changeSetId}, updated_by = ${actor}
     where id = ${disagreementId} and version = ${expectedVersion} and status = 'open'
     returning id
  `;
  if (!settled[0]) {
    throw new DomainConflictError(
      "disagreement_version_stale",
      "This disagreement changed as you saved. Nothing was written — reload.",
    );
  }

  // Recomposed from what the record now holds. `runId` is null, as for a
  // correction: the new row carries its own source run, and the fill that
  // reads it takes the run from there.
  const { filled, retracted } = await recomposeAnswers(txn, recordId, null, actor);
  const snapshots = await snapshotRecords(txn, [recordId], changeSetId);

  return {
    disagreementId,
    decision,
    recordId,
    changeSetId,
    attributeId: newId,
    supersededId: String(held.id),
    answersFilled: filled,
    answersRetracted: retracted,
    snapshotNo: snapshots.get(recordId) ?? null,
    finishUnlinked,
    standardLeftBehind: held.standard_value !== null && held.standard_value !== undefined,
  };
}
