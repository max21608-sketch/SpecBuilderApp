// Starting a project, adding an item, and typing a spec that no document said.
//
// ============================================================================
// WHY THIS EXISTS AT ALL
//
// Until 0028 a record could only be created by confirming a bill of
// quantities, and a spec value only by confirming a document. A project whose
// documents are drawings and emails could not be STARTED, and a value the
// checklist has no question for could not be typed in — which is the whole
// reason `record_attributes` is requirement-free.
//
// Matthew's workflow of 2026-09-17 needs both: "Specs checked and added to
// manually and developed with Q&A with client through your app tools."
//
// ---- EVERYTHING HERE IS STILL A CHANGE SET -------------------------------
//
// A hand-typed item is exactly the kind of row somebody later finds in an
// export and does not recognise. It gets a change set, a snapshot and an audit
// row like anything else, under its own kind, so the history screen can say
// "added by hand, by whom, on what day".
//
// ---- AND IT CARRIES NO SOURCE, DELIBERATELY ------------------------------
//
// `source_run_id` and `source_page` stay null on a typed attribute. A spec
// somebody typed IS a spec with no page to turn to, and every screen that
// prints provenance already handles the blank. Inventing a source would be
// worse than the gap, because the gap is the truth and the invention is not.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { guessLevelFromBill } from "@/lib/level-guess";
import { normaliseRef } from "@/lib/boq-import";
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_UNITS,
  DIMENSION_SLOTS,
  REF_SYSTEMS,
  type AttributeState,
  type RefSystem,
} from "@/lib/spec-vocab";

export type CreateRunResult = { runId: string; name: string; changeSetId: string };

/**
 * A sub-quote with no bill behind it.
 *
 * `spec_runs` has never required one — `source_import_id` and `source_sheet`
 * are nullable from 0007 — because a run is a scope, not a spreadsheet tab.
 * NO unique on (project_id, name), also from 0007: re-uploading a revised BOQ
 * legitimately produces a second "MAIN RUN".
 */
export async function createRun(
  txn: TxnSql,
  { projectId, name, actor }: { projectId: string; name: string; actor: string },
): Promise<CreateRunResult> {
  const trimmed = name.trim();
  if (!trimmed) throw new DomainConflictError("name_required", "A run needs a name.", { status: 400 });

  const projects = await txn`select id from projects where id = ${projectId} for update`;
  if (!projects[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });

  const changeSetId = await openChangeSet(txn, {
    projectId,
    kind: "run_create",
    actor,
    // NOT `label`: 0012's `change_sets_label_is_baseline` reserves that column
    // for baselines — "a baseline is named, and nothing else is". The trail
    // prints the kind's own label beside this, so "Run added by hand · MUR".
    reason: trimmed,
  });

  const order = await txn`
    select coalesce(max(sort_order), 0) as last from spec_runs where project_id = ${projectId}
  `;
  const rows = await txn`
    insert into spec_runs (project_id, name, sort_order, status, created_by, updated_by)
    values (${projectId}, ${trimmed}, ${Number(order[0]?.last ?? 0) + 1}, 'active', ${actor}, ${actor})
    returning id
  `;
  const runId = String(rows[0]?.id ?? "");
  if (!runId) throw new Error("run was not created");
  return { runId, name: trimmed, changeSetId };
}

export type CreateRecordInput = {
  projectId: string;
  runId: string;
  itemDescription: string;
  clientRef?: string | null;
  refSystem?: RefSystem;
  area?: string | null;
  qty?: number | null;
  designer?: string | null;
  categoryId?: string | null;
  actor: string;
};

export type CreateRecordResult = {
  recordId: string;
  recordNo: number;
  answersCreated: number;
  changeSetId: string;
};

export async function createRecord(txn: TxnSql, input: CreateRecordInput): Promise<CreateRecordResult> {
  const description = input.itemDescription.trim();
  if (!description) {
    throw new DomainConflictError("description_required", "An item needs a description.", { status: 400 });
  }

  // The run has to be on this project and live. A record on a retired run is
  // out of export scope the moment it is written, which reads as the save
  // having failed.
  const runs = await txn`
    select id, project_id, status from spec_runs where id = ${input.runId}
  `;
  const run = runs[0];
  if (!run || String(run.project_id) !== input.projectId) {
    throw new DomainConflictError("unknown_run", "That run is not on this project.", { status: 400 });
  }
  if (String(run.status) !== "active") {
    throw new DomainConflictError("run_retired", "That run has been retired. Add the item to a live run.", {
      status: 400,
    });
  }

  if (input.categoryId) {
    const categories = await txn`select id from item_categories where id = ${input.categoryId}`;
    if (!categories[0]) throw new DomainConflictError("unknown_category", "No such category.", { status: 400 });
  }

  // THE PROJECT ROW LOCK, before any record number is read. The
  // `boq-concurrency` defect: two transactions reading the same
  // `max(record_no)` allocate the same number and one dies on the unique index.
  await txn`select id from projects where id = ${input.projectId} for update`;
  const maxNo = await txn`
    select coalesce(max(record_no), 0) as max_no from spec_records where project_id = ${input.projectId}
  `;
  const recordNo = Number(maxNo[0]?.max_no ?? 0) + 1;

  const changeSetId = await openChangeSet(txn, {
    projectId: input.projectId,
    kind: "record_create",
    actor: input.actor,
    reason: description.slice(0, 200),
  });

  // The same advisory guess intake makes, from the same function. A hand-typed
  // description is the same kind of input as a bill line's, and a record born
  // level-less blocks a chase — but it stays a SUGGESTION, because 0019's rule
  // that only a person's decision reaches the gate does not bend for the way
  // the item arrived.
  const guess = guessLevelFromBill({
    itemDescription: description,
    productReference: null,
    boqCategory: null,
  });

  const inserted = await txn`
    insert into spec_records
      (project_id, run_id, record_no, status, category_id, item_description,
       qty, designer, area, level_suggested, level_suggested_reason, created_by, updated_by)
    values
      (${input.projectId}, ${input.runId}, ${recordNo}, 'active', ${input.categoryId ?? null}, ${description},
       ${input.qty ?? null}, ${input.designer?.trim() || null}, ${input.area?.trim() || null},
       ${guess?.level ?? null}, ${guess?.reason ?? null}, ${input.actor}, ${input.actor})
    returning id
  `;
  const recordId = String(inserted[0]?.id ?? "");
  if (!recordId) throw new Error("record was not created");

  const ref = input.clientRef?.trim();
  if (ref) {
    const system: RefSystem =
      input.refSystem && (REF_SYSTEMS as readonly string[]).includes(input.refSystem) ? input.refSystem : "boq_code";
    await txn`
      insert into spec_record_refs
        (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
      values (${recordId}, ${input.projectId}, ${system}, ${ref}, ${normaliseRef(ref)}, 'Typed by hand', ${input.actor})
      on conflict (record_id, ref_system, ref_value_norm) do nothing
    `;
  }

  // The checklist, so the questions exist to be filled — the same statement
  // confirm-boq and variant-create run. Writes nothing for an uncategorised
  // record, and PATCH /api/records/[id] writes them if a category is set later.
  const answers = await txn`
    insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
    select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', ${input.actor}, ${input.actor}
    from requirements q
    join spec_records r on r.category_id = q.category_id
    where r.id = ${recordId}
    returning 1 as written
  `;

  await snapshotRecords(txn, [recordId], changeSetId);
  return { recordId, recordNo, answersCreated: answers.length, changeSetId };
}

export type CreateAttributeInput = {
  recordId: string;
  attrGroup: string;
  label: string;
  value: string | null;
  /** Where on the item it goes: "Main body & self pipe" (0029). */
  qualifier?: string | null;
  unit?: string | null;
  dimensionSlot?: string | null;
  specFieldId?: string | null;
  materialCode?: string | null;
  state: AttributeState;
  actor: string;
};

export type CreateAttributeResult = {
  attributeId: string;
  recordId: string;
  filled: number;
  retracted: number;
  changeSetId: string;
};

/**
 * One spec value, typed by a person.
 *
 * The validation below repeats 0007's and 0011's constraints ON PURPOSE. The
 * database is still the enforcement — a constraint the app forgets is a
 * constraint the database keeps — but a check violation reaches the screen as
 * "nothing was written" with no field named, and this is a form somebody is
 * filling in.
 */
export async function createAttribute(txn: TxnSql, input: CreateAttributeInput): Promise<CreateAttributeResult> {
  const label = input.label.trim();
  const value = input.value?.trim() || null;
  if (!label) throw new DomainConflictError("label_required", "A spec needs a label.", { status: 400 });
  if (!(ATTRIBUTE_GROUPS as readonly string[]).includes(input.attrGroup)) {
    throw new DomainConflictError("unknown_group", "That is not a spec group.", { status: 400 });
  }
  if (input.state === "confirmed" && !value) {
    throw new DomainConflictError("value_required", "A confirmed spec needs a value. Use TBC if it is not settled.", {
      status: 400,
    });
  }

  // 0011's biconditional: attr_group = 'dimension' MEANS one of Matthew's five
  // slots. There is no such thing as a slotless dimension, which is what makes
  // composeDimensionCell total.
  const slot = input.dimensionSlot?.trim() || null;
  const isDimension = input.attrGroup === "dimension";
  if (isDimension && !slot) {
    throw new DomainConflictError(
      "dimension_needs_slot",
      "A dimension has to be W, D, H, SH or Dia. Anything else a document measures is a note.",
      { status: 400 },
    );
  }
  if (!isDimension && slot) {
    throw new DomainConflictError("slot_needs_dimension", "Only a dimension carries a slot.", { status: 400 });
  }
  if (slot && !(DIMENSION_SLOTS as readonly string[]).includes(slot)) {
    throw new DomainConflictError("unknown_slot", "That is not one of the five slots.", { status: 400 });
  }

  const unit = input.unit?.trim() || null;
  if (unit && !isDimension) {
    throw new DomainConflictError("unit_not_a_measurement", "Only a dimension carries a unit.", { status: 400 });
  }
  if (unit && !(ATTRIBUTE_UNITS as readonly string[]).includes(unit)) {
    throw new DomainConflictError("unknown_unit", "That is not a unit this app knows.", { status: 400 });
  }

  const records = await txn`
    select id, project_id, run_id, status from spec_records where id = ${input.recordId} for update
  `;
  const record = records[0];
  if (!record) throw new DomainConflictError("not_found", "No such record.", { status: 404 });
  if (String(record.status) !== "active") {
    throw new DomainConflictError("record_retired", "That item has been retired.", { status: 400 });
  }

  // One BWS field, one value. The partial unique index would refuse it anyway;
  // saying WHICH value is in the way is the difference between a form somebody
  // can fix and one they retry.
  if (input.specFieldId && !isDimension) {
    const held = await txn`
      select a.id, a.label, a.value, f.name as field_name
        from record_attributes a
        left join spec_fields f on f.id = a.spec_field_id
       where a.record_id = ${input.recordId} and a.spec_field_id = ${input.specFieldId}
         and a.attr_group <> 'dimension' and a.status = 'active'
    `;
    const occupant = held[0];
    if (occupant) {
      throw new DomainConflictError(
        "field_occupied",
        `${String(occupant.field_name ?? "That BWS field")} already holds “${String(occupant.value ?? occupant.label)}” on this item. Retire it first, or record this as a note.`,
        { status: 409 },
      );
    }
  }
  if (isDimension && slot) {
    const held = await txn`
      select id, value from record_attributes
       where record_id = ${input.recordId} and dimension_slot = ${slot} and status = 'active'
    `;
    if (held[0]) {
      throw new DomainConflictError(
        "slot_occupied",
        `This item already has a ${slot} of “${String(held[0].value ?? "")}”. Retire it first.`,
        { status: 409 },
      );
    }
  }

  const changeSetId = await openChangeSet(txn, {
    projectId: String(record.project_id),
    kind: "attribute_create",
    actor: input.actor,
    reason: `${label}${value ? `: ${value}` : ""}`.slice(0, 200),
  });

  const order = await txn`
    select coalesce(max(sort_order), 0) as last from record_attributes where record_id = ${input.recordId}
  `;
  const inserted = await txn`
    insert into record_attributes
      (record_id, attr_group, label, value, qualifier, unit, dimension_slot, material_code, spec_field_id,
       state, source_run_id, source_page, sort_order, status, created_by, updated_by)
    values
      (${input.recordId}, ${input.attrGroup}, ${label}, ${value}, ${input.qualifier?.trim() || null},
       ${unit}, ${slot},
       ${input.materialCode?.trim() || null}, ${input.specFieldId ?? null}, ${input.state},
       null, null, ${Number(order[0]?.last ?? 0) + 1}, 'active', ${input.actor}, ${input.actor})
    returning id
  `;
  const attributeId = String(inserted[0]?.id ?? "");
  if (!attributeId) throw new Error("attribute was not created");

  // THE WHOLE RECORD IS RECOMPOSED, not this row. A typed height must
  // recompose the cell over the width and depth an earlier document confirmed,
  // or the answer says H720mm while the record says W1900 x D790 x H720mm.
  const { filled, retracted } = await recomposeAnswers(txn, input.recordId, null, input.actor);

  await snapshotRecords(txn, [input.recordId], changeSetId);
  return { attributeId, recordId: input.recordId, filled, retracted, changeSetId };
}

export type RecordDetailPatch = {
  itemDescription?: string;
  area?: string | null;
  qty?: number | null;
  designer?: string | null;
  specDescription?: string | null;
  internalNotes?: string | null;
};

export type EditRecordDetailsResult = { recordId: string; version: number; changed: string[] };

/**
 * The bill's own words, and the two free-text columns.
 *
 * Under the optimistic lock like every other user-editable row. A no-op writes
 * nothing and records no change: a history full of "edited by hand" entries
 * that changed nothing is how the one screen that has to stay readable stops
 * being read.
 */
export async function editRecordDetails(
  txn: TxnSql,
  {
    recordId,
    patch,
    expectedVersion,
    actor,
  }: { recordId: string; patch: RecordDetailPatch; expectedVersion: number; actor: string },
): Promise<EditRecordDetailsResult> {
  const rows = await txn`
    select id, project_id, version, status, item_description, area, qty, designer,
           spec_description, internal_notes
      from spec_records where id = ${recordId} for update
  `;
  const record = rows[0];
  if (!record) throw new DomainConflictError("not_found", "No such record.", { status: 404 });
  if (Number(record.version) !== expectedVersion) {
    throw new DomainConflictError(
      "record_version_stale",
      "Someone else changed this item while you had it open. Reload before saving.",
    );
  }

  const description =
    patch.itemDescription === undefined ? String(record.item_description) : patch.itemDescription.trim();
  if (!description) {
    throw new DomainConflictError("description_required", "An item needs a description.", { status: 400 });
  }

  const next = {
    item_description: description,
    area: patch.area === undefined ? (record.area ?? null) : patch.area?.trim() || null,
    qty: patch.qty === undefined ? (record.qty ?? null) : patch.qty,
    designer: patch.designer === undefined ? (record.designer ?? null) : patch.designer?.trim() || null,
    spec_description:
      patch.specDescription === undefined ? (record.spec_description ?? null) : patch.specDescription?.trim() || null,
    internal_notes:
      patch.internalNotes === undefined ? (record.internal_notes ?? null) : patch.internalNotes?.trim() || null,
  };

  const before: Record<string, unknown> = {
    item_description: record.item_description ?? null,
    area: record.area ?? null,
    qty: record.qty === null || record.qty === undefined ? null : Number(record.qty),
    designer: record.designer ?? null,
    spec_description: record.spec_description ?? null,
    internal_notes: record.internal_notes ?? null,
  };
  const changed = Object.keys(next).filter(
    (key) => String(before[key] ?? "") !== String(next[key as keyof typeof next] ?? ""),
  );
  if (changed.length === 0) {
    return { recordId, version: Number(record.version), changed: [] };
  }

  const changeSetId = await openChangeSet(txn, {
    projectId: String(record.project_id),
    kind: "manual_edit",
    actor,
    reason: `Edited ${changed.join(", ")}`,
  });

  const updated = await txn`
    update spec_records
       set item_description = ${next.item_description},
           area             = ${next.area},
           qty              = ${next.qty},
           designer         = ${next.designer},
           spec_description = ${next.spec_description},
           internal_notes   = ${next.internal_notes},
           updated_by       = ${actor}
     where id = ${recordId} and version = ${expectedVersion}
    returning version
  `;
  if (!updated[0]) {
    throw new DomainConflictError(
      "record_version_stale",
      "Someone else changed this item while you had it open. Reload before saving.",
    );
  }

  await snapshotRecords(txn, [recordId], changeSetId);
  return { recordId, version: Number(updated[0].version), changed };
}
