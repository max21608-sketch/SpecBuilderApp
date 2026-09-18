// Writing to the finishes library, and carrying the change to every item.
//
// ============================================================================
// ONE EDIT, N RECORDS, AND THE ANSWERS HAVE TO MOVE WITH IT.
//
// Editing CH-01.1 changes what every linked item's export cell says, because
// the composer renders the library. If nothing else happened, the CHECKLIST on
// each of those items would go on showing the old text — the export and the
// screen would disagree, which is the failure the single-composer rule exists
// to prevent.
//
// So a finish edit recomposes every linked record's answers, and takes a
// version of each. That is what makes "why does this item say Walnut now"
// answerable on the item, rather than only in a library nobody was looking at.
//
// ---- WHAT IT CANNOT MOVE ------------------------------------------------
//
// An answer somebody TYPED is theirs and is never overwritten — that rule is
// in applyAnswerFills and this does not weaken it. The consequence has to be
// visible rather than silent: the result reports which records have a manual
// answer on a field this finish feeds, and the library screen says so beside
// the item count. Otherwise a person edits a finish, sees "12 items", and has
// no way to know that one of them did not follow.
//
// `spec_records.version` is NOT bumped by any of this. A finish edit is not a
// change to the record's own row, and bumping it would invalidate every
// extraction snapshot and chase coverage row taken against it.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit, openChangeSet, type UploadedEvidence } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { normaliseFinishCode, isFinishKind, type FinishKind } from "@/lib/finishes";
import type { AttributeState } from "@/lib/spec-vocab";

export type FinishFields = {
  code?: string;
  kind?: FinishKind | null;
  description?: string | null;
  supplierRaw?: string | null;
  reference?: string | null;
  colour?: string | null;
  notes?: string | null;
  state?: AttributeState;
};

export type FinishEditResult = {
  finishId: string;
  recordsTouched: number;
  answersFilled: number;
  /** Linked records whose answer for this field a person owns, so it did not move. */
  recordsWithManualAnswers: { recordId: string; label: string }[];
  changeSetId: string;
};

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  return text === "" ? null : text;
}

/** Creates a finish. Used by the library screen and by the drawings confirm. */
export async function createFinish(
  txn: TxnSql,
  {
    projectId,
    fields,
    actor,
  }: { projectId: string; fields: FinishFields & { code: string }; actor: string },
): Promise<string> {
  const code = fields.code.trim();
  if (!code) throw new DomainConflictError("code_required", "A finish needs the client's own code.", { status: 400 });
  const codeNorm = normaliseFinishCode(code);

  const rows = await txn`
    insert into project_finishes
      (project_id, code, code_norm, kind, description, supplier_raw, reference, colour, notes, state,
       created_by, updated_by)
    values
      (${projectId}, ${code}, ${codeNorm}, ${fields.kind ?? null}, ${clean(fields.description)},
       ${clean(fields.supplierRaw)}, ${clean(fields.reference)}, ${clean(fields.colour)}, ${clean(fields.notes)},
       ${fields.state ?? "tbc"}, ${actor}, ${actor})
    on conflict do nothing
    returning id
  `;
  if (!rows[0]) {
    // The partial unique index caught it: this project already has that code
    // active. Reported rather than silently linked to the existing one — the
    // reviewer asked to create, and the two may not be the same thing.
    throw new DomainConflictError("code_exists", `This project already has a finish called “${code}”.`, { status: 409 });
  }
  return String(rows[0].id);
}

export async function editFinish(
  txn: TxnSql,
  {
    projectId,
    finishId,
    expectedVersion,
    fields,
    reason,
    evidence,
    actor,
    changeSetId: attachTo,
  }: {
    projectId: string;
    finishId: string;
    expectedVersion: number;
    fields: FinishFields;
    reason: string;
    evidence?: UploadedEvidence | null;
    actor: string;
    /**
     * An ALREADY OPEN change to attach this edit to, instead of opening one.
     *
     * For a caller that edits several finishes as ONE act — filing a library's
     * suggested kinds in a single click. Without it every finish opens its own
     * change set and eleven codes filed in one press become eleven entries in
     * the project trail, which is the failure `acceptSuggestedLevels` avoids by
     * calling `changeSetForEdit` once and writing every row under the id it
     * returns. The caller owns the change and the reason on it.
     */
    changeSetId?: string;
  },
): Promise<FinishEditResult> {
  const rows = await txn`
    select id, project_id, version, status, code, state from project_finishes where id = ${finishId} for update
  `;
  const finish = rows[0];
  if (!finish) throw new DomainConflictError("not_found", "No such finish.", { status: 404 });
  if (String(finish.project_id) !== projectId) {
    throw new DomainConflictError("wrong_project", "That finish belongs to another project.", { status: 400 });
  }
  if (String(finish.status) !== "active") {
    throw new DomainConflictError("retired", "That finish has been retired. Put it back before editing it.");
  }
  if (Number(finish.version) !== expectedVersion) {
    throw new DomainConflictError(
      "finish_version_stale",
      `“${String(finish.code)}” was changed by someone else while you had it open. Reload before saving.`,
    );
  }

  const changeSetId =
    attachTo ??
    (
      await changeSetForEdit(txn, {
        projectId,
        actor,
        kind: "finish_edit",
        reason,
        evidence,
      })
    ).changeSetId;

  const code = fields.code === undefined ? String(finish.code) : fields.code.trim();
  if (!code) throw new DomainConflictError("code_required", "A finish needs the client's own code.", { status: 400 });

  const updated = await txn`
    update project_finishes
    set code = ${code},
        code_norm = ${normaliseFinishCode(code)},
        kind = ${fields.kind === undefined ? null : fields.kind},
        description = ${clean(fields.description)},
        supplier_raw = ${clean(fields.supplierRaw)},
        reference = ${clean(fields.reference)},
        colour = ${clean(fields.colour)},
        notes = ${clean(fields.notes)},
        state = ${fields.state ?? String(finish.state)},
        updated_by = ${actor}
    where id = ${finishId} and version = ${expectedVersion} and status = 'active'
    returning id
  `;
  if (!updated[0]) {
    throw new DomainConflictError("finish_version_stale", "That finish changed as you saved. Nothing was written — reload.");
  }

  // ---- carry it to every item -------------------------------------------
  const linked = await txn`
    select distinct r.id, r.record_no, p.bws_project_number
    from record_attributes a
    join spec_records r on r.id = a.record_id
    join projects p on p.id = r.project_id
    where a.finish_id = ${finishId} and a.status = 'active' and r.status = 'active'
    order by r.record_no
  `;

  let answersFilled = 0;
  const manual: { recordId: string; label: string }[] = [];
  for (const row of linked) {
    const recordId = String(row.id);
    const { filled } = await recomposeAnswers(txn, recordId, null, actor);
    answersFilled += filled;

    // An answer a person typed is theirs and did not move. Reported, because
    // "12 items" with one of them quietly not following is worse than a
    // smaller number honestly stated.
    const owned = await txn`
      select 1 from spec_answers ans
      join record_attributes a on a.record_id = ans.record_id and a.spec_field_id = ans.spec_field_id
      where ans.record_id = ${recordId}
        and ans.revision_no = 0
        and ans.source_kind = 'manual'
        and ans.state <> 'missing'
        and a.finish_id = ${finishId}
        and a.status = 'active'
      limit 1
    `;
    if (owned[0]) {
      manual.push({
        recordId,
        label: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
      });
    }
  }

  await snapshotRecords(
    txn,
    linked.map((row) => String(row.id)),
    changeSetId,
  );

  return {
    finishId,
    recordsTouched: linked.length,
    answersFilled,
    recordsWithManualAnswers: manual,
    changeSetId,
  };
}

/** Links or unlinks one attribute. Unlinking makes the item stand on its own words. */
export async function setAttributeFinish(
  txn: TxnSql,
  {
    attributeId,
    finishId,
    expectedVersion,
    reason,
    actor,
  }: { attributeId: string; finishId: string | null; expectedVersion: number; reason: string; actor: string },
): Promise<{ recordId: string; changeSetId: string }> {
  const rows = await txn`
    select a.id, a.record_id, a.version, a.status, a.finish_id, r.project_id
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where a.id = ${attributeId}
    for update of a
  `;
  const attribute = rows[0];
  if (!attribute) throw new DomainConflictError("not_found", "No such spec.", { status: 404 });
  if (String(attribute.status) !== "active") {
    throw new DomainConflictError("retired", "That spec has been retired.");
  }
  if (Number(attribute.version) !== expectedVersion) {
    throw new DomainConflictError("attribute_version_stale", "That spec changed while you had it open. Reload.");
  }

  const projectId = String(attribute.project_id);
  if (finishId) {
    const finish = await txn`
      select id from project_finishes where id = ${finishId} and project_id = ${projectId} and status = 'active'
    `;
    if (!finish[0]) {
      throw new DomainConflictError("finish_missing", "That finish is not in this project's library.", { status: 400 });
    }
  }

  const changeSetId = await openChangeSet(txn, {
    projectId,
    actor,
    kind: finishId ? "finish_link" : "finish_unlink",
    reason,
  });

  const updated = await txn`
    update record_attributes set finish_id = ${finishId}, updated_by = ${actor}
    where id = ${attributeId} and version = ${expectedVersion} and status = 'active'
    returning id
  `;
  if (!updated[0]) {
    throw new DomainConflictError("attribute_version_stale", "That spec changed as you saved. Nothing was written — reload.");
  }

  const recordId = String(attribute.record_id);
  await recomposeAnswers(txn, recordId, null, actor);
  await snapshotRecords(txn, [recordId], changeSetId);
  return { recordId, changeSetId };
}

export { isFinishKind };
