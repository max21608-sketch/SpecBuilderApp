// A person adds a configuration to a bill line, or renames one.
//
// ============================================================================
// WHY THIS DOES NOT CALL `ensureVariant`.
//
// `ensureVariant` (variant-create.ts) is intake's find-or-create: a drawing
// page names a configuration, the confirm finds it or makes it, and it REFUSES
// a bill line that already holds specs, because those specs would drop out of
// the export the moment the line became a heading. That refusal is right for
// a confirm, where nobody has been shown what would be lost.
//
// This path is the answer to that block. The person is shown every statement
// the bill line holds, ticks what is true of the new configuration too, and is
// told in words what the rest means — it stops reaching the export. So the
// guard is replaced here by a stronger one: the route re-derives the offer from
// the live rows and refuses if it is not exactly what the screen showed. The
// insert itself is the SAME statement `ensureVariant` makes (the level comes
// down, the qty does not, the ref is not copied), kept in step by hand until
// the two are reconciled — see the note at `insertConfiguration`.
//
// ---- ONE ACT ------------------------------------------------------------
//
// One change set (`record_create`: a configuration added by hand IS an item
// added by hand, and a new kind would mean re-listing the CHECK from a live
// constraint nobody here can read), one version of the new record, and
// NOTHING about the bill line is written — `spec_records.version` on the
// parent is untouched. It becomes a heading because a live child now exists,
// which is `parentIsSupersededBy`'s rule and not a flag on the row.
//
// ---- WHAT IS COPIED, AND HOW ---------------------------------------------
//
// A carried ATTRIBUTE keeps its source run and page: it is still what that
// page said, about this configuration too, and a copy that dropped the page
// would be indistinguishable from a number somebody made up. The answers it
// projects to are then written by `recomposeAnswers`, exactly as for any
// attribute write — so the Dimensions cell is COMPOSED on the configuration,
// never copied.
//
// A carried ANSWER is written `source_kind = 'manual'`, because a person chose
// to carry it. An answer that is a PROJECTION of the bill line's attributes is
// never offered at all: offering both would write an answer and the attribute
// it projects from, and the next recomposition would disagree with one of
// them.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { loadPromotable, recomposeAnswers } from "@/lib/attribute-retire";
import { loadDimensionNote, planAnswerFills } from "@/lib/promote-answers";
import { normaliseRef } from "@/lib/record-refs";
import {
  carryKey,
  checkConfigurationName,
  isDifferingField,
  sameOffer,
  stopsBeingExported,
  type CarryItem,
  type CarryRef,
  type TakenName,
} from "@/lib/configuration-carry";

export type CarryOffer = {
  billLine: {
    id: string;
    projectId: string;
    runId: string;
    /** The phase's name, as the phase tabs print it. */
    runName: string;
    version: number;
    /** What a person calls it: the client ref, or `#<record_no>`. */
    name: string;
    qty: number | null;
  };
  offered: CarryItem[];
  taken: TakenName[];
  /** The bill line already has a live configuration, so it is a heading already. */
  alreadySplit: boolean;
};

const text = (value: unknown): string | null =>
  value === null || value === undefined || String(value) === "" ? null : String(value);

/**
 * Everything on the bill line that could be carried, as the panel shows it
 * and as the route re-derives it. ONE loader for both, or the check that the
 * two agree would be comparing two different questions.
 *
 * Takes any tagged-template executor — the GET route passes `sql`, the add
 * passes the transaction after taking its locks.
 */
export async function loadCarryOffer(q: TxnSql, billLineId: string): Promise<CarryOffer> {
  const rows = await q`
    select r.id, r.project_id, r.run_id, r.version, r.status, r.parent_id, r.record_no, r.qty, r.dimension_note,
           run.name as run_name,
           (select string_agg(x.ref_value, ', ' order by x.ref_value)
              from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code') as client_ref
      from spec_records r join spec_runs run on run.id = r.run_id
     where r.id = ${billLineId}
  `;
  const record = rows[0];
  if (!record) throw new DomainConflictError("not_found", "That record no longer exists.", { status: 404 });
  if (record.parent_id) {
    throw new DomainConflictError(
      "not_a_bill_line",
      "That record is itself a configuration. Add the new one to its bill line.",
      { status: 400 },
    );
  }
  const name = text(record.client_ref) ?? `#${String(record.record_no)}`;

  const attributes = await q`
    select a.id, a.version, a.attr_group, a.label, a.value, a.qualifier, a.unit, a.state, a.dimension_slot,
           a.source_page, a.source_run_id, f.json_id, at.filename as source_filename
      from record_attributes a
      left join spec_fields f on f.id = a.spec_field_id
      left join intake_runs ir on ir.id = a.source_run_id
      left join attachments at on at.id = ir.attachment_id
     where a.record_id = ${billLineId} and a.status = 'active'
     order by a.attr_group, a.sort_order, a.created_at
  `;

  // WHICH ANSWERS ARE PROJECTIONS of those attributes, by the same function
  // that writes them. Those are not offered: the attribute carries them.
  const fills = planAnswerFills(await loadPromotable(q, billLineId), await loadDimensionNote(q, billLineId));
  const projectedFields = new Set(fills.map((fill) => fill.specFieldId).filter((id): id is string => Boolean(id)));
  const projectedJsonIds = new Set(fills.map((fill) => fill.jsonId).filter((id): id is number => id !== null));

  const answers = await q`
    select sa.id, sa.version, sa.value, sa.qualifier, sa.state, sa.spec_field_id, q.prompt, f.json_id
      from spec_answers sa
      join requirements q on q.id = sa.requirement_id
      left join spec_fields f on f.id = sa.spec_field_id
     where sa.record_id = ${billLineId} and sa.revision_no = 0 and sa.state in ('confirmed', 'na')
     order by q.sort_order
  `;

  const offered: CarryItem[] = [];
  for (const row of attributes) {
    const jsonId = row.json_id === null || row.json_id === undefined ? null : Number(row.json_id);
    const slot = text(row.dimension_slot);
    const value = text(row.value);
    const unit = text(row.unit);
    offered.push({
      kind: "attribute",
      id: String(row.id),
      version: Number(row.version),
      label: slot ? `${slot} · ${String(row.label)}` : String(row.label),
      value: value && unit ? `${value} ${unit}` : value,
      qualifier: text(row.qualifier),
      state: String(row.state),
      jsonId,
      source: row.source_run_id
        ? { filename: text(row.source_filename), page: row.source_page === null ? null : Number(row.source_page) }
        : null,
      differing: isDifferingField(jsonId),
    });
  }
  for (const row of answers) {
    const jsonId = row.json_id === null || row.json_id === undefined ? null : Number(row.json_id);
    const fieldId = text(row.spec_field_id);
    if ((fieldId && projectedFields.has(fieldId)) || (jsonId !== null && projectedJsonIds.has(jsonId))) continue;
    offered.push({
      kind: "answer",
      id: String(row.id),
      version: Number(row.version),
      label: String(row.prompt),
      value: text(row.value),
      qualifier: text(row.qualifier),
      state: String(row.state),
      jsonId,
      source: null,
      differing: isDifferingField(jsonId),
    });
  }
  // THE PERSON'S ONE QUALIFIER FOR THE WHOLE DIMENSION CELL (0034). A record
  // column, not an attribute — offered by the bill line's own id and version,
  // so any edit to the bill line's details since the panel opened refuses Add.
  const note = text(record.dimension_note);
  if (note) {
    offered.push({
      kind: "dimension_note",
      id: String(record.id),
      version: Number(record.version),
      label: "Dimension note",
      value: note,
      qualifier: null,
      state: "confirmed",
      jsonId: null,
      source: null,
      differing: false,
    });
  }

  const children = await q`
    select variant_label, status from spec_records where parent_id = ${billLineId}
  `;
  const taken = children.map((row) => ({ label: String(row.variant_label ?? ""), status: String(row.status) }));

  return {
    billLine: {
      id: String(record.id),
      projectId: String(record.project_id),
      runId: String(record.run_id),
      runName: String(record.run_name),
      version: Number(record.version),
      name,
      qty: record.qty === null || record.qty === undefined ? null : Number(record.qty),
    },
    offered,
    taken,
    alreadySplit: taken.some((name) => name.status === "active"),
  };
}

// ============================================================================
// THE SAME BILL LINE ON THE OTHER PHASES.
//
// A bill line exists once PER PHASE: `S-301` on MAIN RUN and `S-301` on the VE
// phase are two records with the same client ref, because each phase quotes it
// at its own quantity. A configuration added on one is nearly always true of
// the other, and five types would otherwise be ten adds.
//
// So the panel offers every OTHER live phase whose live bill line carries the
// same `boq_code` ref under `normaliseRef` — the exact fold every matcher here
// uses, never a looser one. Two lines carrying the ref in ONE phase is the
// `SX11A` case: nothing is offered there, and the panel says why, because
// picking one of the two is exactly the guess `findRecordsByRef` refuses.
//
// EACH PHASE CARRIES ITS OWN BILL LINE'S SPECS. Never phase A's onto phase B:
// the phases can differ, and that is why they exist.
// ============================================================================

export type OtherPhase = {
  runId: string;
  runName: string;
  /** Null when the ref is on more than one line of that phase. */
  billLineId: string | null;
  /** How many live bill lines of that phase carry the ref. */
  lineCount: number;
};

/**
 * The other live phases this bill line's client ref is on. Ordered as the
 * phase tabs are. A bill line with no `boq_code` ref is on no other phase.
 */
export async function loadOtherPhases(q: TxnSql, billLineId: string): Promise<OtherPhase[]> {
  const heads = await q`
    select r.project_id, r.run_id,
           coalesce((select array_agg(x.ref_value) from spec_record_refs x
                      where x.record_id = r.id and x.ref_system = 'boq_code'), '{}') as refs
      from spec_records r where r.id = ${billLineId}
  `;
  const head = heads[0];
  if (!head) return [];
  const wanted = new Set(((head.refs as string[] | null) ?? []).map(normaliseRef).filter(Boolean));
  if (wanted.size === 0) return [];

  const rows = await q`
    select r.id, r.run_id, run.name as run_name, run.sort_order, x.ref_value
      from spec_records r
      join spec_runs run on run.id = r.run_id
      join spec_record_refs x on x.record_id = r.id and x.ref_system = 'boq_code'
     where r.project_id = ${head.project_id} and r.run_id <> ${head.run_id}
       and r.parent_id is null and r.status = 'active' and run.status = 'active'
     order by run.sort_order, run.name, r.id
  `;
  const byRun = new Map<string, { runName: string; lines: Set<string> }>();
  for (const row of rows) {
    if (!wanted.has(normaliseRef(String(row.ref_value)))) continue;
    const runId = String(row.run_id);
    const entry = byRun.get(runId) ?? { runName: String(row.run_name), lines: new Set<string>() };
    entry.lines.add(String(row.id));
    byRun.set(runId, entry);
  }
  return [...byRun.entries()].map(([runId, entry]) => ({
    runId,
    runName: entry.runName,
    billLineId: entry.lines.size === 1 ? [...entry.lines][0]! : null,
    lineCount: entry.lines.size,
  }));
}

export type PhaseRequest = {
  billLineId: string;
  /** Every row the panel showed for this bill line, by id and version. */
  shown: CarryRef[];
  /** The rows the person left ticked. A subset of `shown`. */
  carry: CarryRef[];
};

export type AddConfigurationInput = PhaseRequest & {
  name: string;
  /** The same configuration on other phases' bill lines, each with its own carry list. */
  phases?: PhaseRequest[];
  actor: string;
};

export type AddedOnPhase = {
  recordId: string;
  recordNo: number;
  runName: string;
  carriedSpecs: number;
  carriedAnswers: number;
  stoppedExporting: number;
};

export type AddConfigurationResult = AddedOnPhase & {
  label: string;
  /** The same configuration added on other phases in the same act. */
  alsoAdded: AddedOnPhase[];
  changeSetId: string;
};

type PlannedAdd = {
  offer: CarryOffer;
  carried: CarryItem[];
  stops: CarryItem[];
};

export async function addConfiguration(txn: TxnSql, input: AddConfigurationInput): Promise<AddConfigurationResult> {
  const heads = await txn`select project_id, status from spec_records where id = ${input.billLineId}`;
  const head = heads[0];
  if (!head) throw new DomainConflictError("not_found", "That record no longer exists.", { status: 404 });

  // THE LOCKS: the project first, then every bill line in id order. The
  // project row serialises record_no allocation (the `boq-concurrency`
  // defect); the bill lines' rows hold off a spec being added to any of them
  // between its offer being re-derived and the copy being made. Project, then
  // records in id order, matches `confirm-boq` and `snapshotRecords`, and
  // `createAttribute` takes only a record, so no cycle is possible.
  await txn`select id from projects where id = ${head.project_id} for update`;

  const requests = [
    { billLineId: input.billLineId, shown: input.shown, carry: input.carry },
    ...(input.phases ?? []),
  ];
  const ids = requests.map((request) => request.billLineId);
  if (new Set(ids).size !== ids.length) {
    throw new DomainConflictError("duplicate_phase", "The same bill line was named twice.", { status: 400 });
  }
  // Every other phase asked for has to be one this bill line's ref is on,
  // unambiguously, NOW — the request names bill lines, and the client does
  // not get to say which records are the same item.
  if (requests.length > 1) {
    const others = new Map((await loadOtherPhases(txn, input.billLineId)).map((phase) => [phase.billLineId, phase]));
    for (const request of requests.slice(1)) {
      if (!others.has(request.billLineId)) {
        throw new DomainConflictError(
          "targets_changed",
          "One of the other phases no longer carries this item on exactly one line. Reload and check the phases again.",
        );
      }
    }
  }
  await txn`select id from spec_records where id = any(${[...ids].sort()}::uuid[]) order by id for update`;

  let label = "";
  const plans: PlannedAdd[] = [];
  for (const [index, request] of requests.entries()) {
    const offer = await loadCarryOffer(txn, request.billLineId);
    const where = index === 0 ? "" : `On ${offer.billLine.runName}: `;
    const status = await txn`select status from spec_records where id = ${request.billLineId}`;
    if (String(status[0]?.status) !== "active") {
      throw new DomainConflictError(
        "parent_not_active",
        `${where}that bill line is retired, so nothing can be added under it. Restore it first.`,
      );
    }
    // ONE NAME FOR THE WHOLE ACT, checked against each bill line's own
    // configurations. A clash on any phase refuses all of them, naming the
    // phase: a half-applied add across phases is the half-applied card again.
    const name = checkConfigurationName(input.name, offer.taken, offer.billLine.name);
    if (!name.ok) {
      throw new DomainConflictError(name.code, `${where}${name.message}`, {
        status: name.code === "name_taken" || name.code === "name_retired" ? 409 : 400,
      });
    }
    label = name.label;

    // THE OFFER HAS TO BE THE ONE THAT WAS SHOWN. A spec added to the bill
    // line, retired or corrected since the panel opened changes what stops
    // reaching the export, and the person agreed to a sentence about a
    // different set.
    if (!sameOffer(request.shown, offer.offered)) {
      throw new DomainConflictError(
        "targets_changed",
        `${where}${offer.billLine.name} has changed since this panel was opened, so what would stop being exported is not what you were shown. Reload and check the list again.`,
      );
    }
    const live = new Map(offer.offered.map((item) => [carryKey(item), item]));
    const carried: CarryItem[] = [];
    for (const ref of request.carry) {
      const item = live.get(carryKey(ref));
      if (!item || item.version !== ref.version) {
        throw new DomainConflictError(
          "carry_not_offered",
          `${where}something ticked to carry is not on the bill line any more. Reload.`,
          { status: 400 },
        );
      }
      if (!carried.includes(item)) carried.push(item);
    }
    const stops = stopsBeingExported(offer.offered, new Set(carried.map(carryKey)), offer.alreadySplit);
    plans.push({ offer, carried, stops });
  }

  const primary = plans[0]!.offer.billLine;
  const count = (items: CarryItem[], kind: CarryItem["kind"]) => items.filter((item) => item.kind === kind).length;
  const changeSetId = await openChangeSet(txn, {
    projectId: primary.projectId,
    kind: "record_create",
    actor: input.actor,
    reason: [
      `Configuration ${label} of ${primary.name} added by hand on ${plans.map((plan) => plan.offer.billLine.runName).join(", ")}.`,
      ...plans.map((plan) => {
        const specs = count(plan.carried, "attribute");
        const answers = count(plan.carried, "answer");
        const note = count(plan.carried, "dimension_note") > 0 ? ", the dimension note" : "";
        const carriedText =
          plan.carried.length > 0
            ? `carried from its own bill line: ${specs} spec${specs === 1 ? "" : "s"}, ${answers} answer${answers === 1 ? "" : "s"}${note}, each keeping its source`
            : "nothing carried";
        const stopText = plan.stops.length > 0 ? `; ${plan.stops.length} left on the bill line stop being exported` : "";
        return `${plan.offer.billLine.runName}: ${carriedText}${stopText}.`;
      }),
    ]
      .join(" ")
      .slice(0, 2000),
  });

  const added: AddedOnPhase[] = [];
  for (const plan of plans) {
    added.push(await writeConfiguration(txn, plan, label, input.actor));
  }
  await snapshotRecords(
    txn,
    added.map((row) => row.recordId),
    changeSetId,
  );

  const [first, ...rest] = added;
  return { ...first!, label, alsoAdded: rest, changeSetId };
}

/** One bill line's new configuration: the record, then its own carried rows. */
async function writeConfiguration(txn: TxnSql, plan: PlannedAdd, label: string, actor: string): Promise<AddedOnPhase> {
  const billLineId = plan.offer.billLine.id;
  const attributeIds = plan.carried.filter((item) => item.kind === "attribute").map((item) => item.id);
  const answerIds = plan.carried.filter((item) => item.kind === "answer").map((item) => item.id);
  const note = plan.carried.find((item) => item.kind === "dimension_note");

  const { recordId, recordNo } = await insertConfiguration(txn, {
    billLineId,
    label,
    dimensionNote: note?.value ?? null,
    actor,
  });

  if (attributeIds.length > 0) {
    const copied = await txn`
      insert into record_attributes
        (record_id, attr_group, label, value, qualifier, unit, dimension_slot, material_code, spec_field_id,
         finish_id, state, source_run_id, source_page, sort_order, status, created_by, updated_by)
      select ${recordId}, a.attr_group, a.label, a.value, a.qualifier, a.unit, a.dimension_slot, a.material_code,
             a.spec_field_id, a.finish_id, a.state, a.source_run_id, a.source_page, a.sort_order, 'active',
             ${actor}, ${actor}
        from record_attributes a
       where a.id = any(${attributeIds}::uuid[]) and a.record_id = ${billLineId} and a.status = 'active'
      returning id
    `;
    if (copied.length !== attributeIds.length) {
      throw new DomainConflictError("targets_changed", "A spec on the bill line changed while it was being carried. Nothing was written — reload.");
    }
  }

  if (answerIds.length > 0) {
    const copied = await txn`
      update spec_answers c
         set value = p.value, value_raw = p.value_raw, qualifier = p.qualifier, state = p.state,
             source_kind = 'manual', source_id = null,
             confirmed_by = case when p.state = 'confirmed' then ${actor} else null end,
             confirmed_at = case when p.state = 'confirmed' then now() else null end,
             updated_by = ${actor}
        from spec_answers p
       where p.id = any(${answerIds}::uuid[]) and p.record_id = ${billLineId}
         and c.record_id = ${recordId} and c.requirement_id = p.requirement_id and c.revision_no = 0
      returning c.id
    `;
    if (copied.length !== answerIds.length) {
      throw new DomainConflictError(
        "answers_not_carried",
        "The configuration does not ask every question being carried, so nothing was written. Reload and try again.",
      );
    }
  }

  // The composed cells follow the carried attributes, by the one composer.
  await recomposeAnswers(txn, recordId, null, actor);
  return {
    recordId,
    recordNo,
    runName: plan.offer.billLine.runName,
    carriedSpecs: attributeIds.length,
    carriedAnswers: answerIds.length,
    stoppedExporting: plan.stops.length,
  };
}

/**
 * THE SAME INSERT `ensureVariant` MAKES, with two differences: the label is a
 * name a person typed rather than a letter derived from a page, and
 * `split_reason` is `configuration` (0002 allows both; nothing reads it apart
 * from the record atoms). Level and suggestion come down, the qty does not,
 * the client ref is not copied — each for the reason `variant-create.ts`
 * gives. Kept in step with it by hand: when the two are reconciled, this is
 * the body `ensureVariant` should expose as an `insertVariant` without its
 * find-or-create and its guard.
 *
 * The caller has already taken the project row lock.
 */
async function insertConfiguration(
  txn: TxnSql,
  { billLineId, label, dimensionNote, actor }: { billLineId: string; label: string; dimensionNote: string | null; actor: string },
): Promise<{ recordId: string; recordNo: number }> {
  const parents = await txn`
    select project_id, run_id, category_id, item_description, product_reference, designer, area, boq_category,
           level, level_suggested, level_suggested_reason
      from spec_records where id = ${billLineId}
  `;
  const parent = parents[0];
  if (!parent) throw new DomainConflictError("not_found", "That record no longer exists.", { status: 404 });

  const maxNo = await txn`
    select coalesce(max(record_no), 0) as max_no from spec_records where project_id = ${parent.project_id}
  `;
  const recordNo = Number(maxNo[0]?.max_no ?? 0) + 1;

  const inserted = await txn`
    insert into spec_records
      (project_id, run_id, record_no, status, category_id, item_description, product_reference,
       qty, designer, area, boq_category, level, level_suggested, level_suggested_reason,
       parent_id, depth, split_reason, variant_label, dimension_note,
       created_by, updated_by)
    values
      (${parent.project_id}, ${parent.run_id}, ${recordNo}, 'active', ${parent.category_id ?? null},
       ${parent.item_description}, ${parent.product_reference ?? null},
       null, ${parent.designer ?? null}, ${parent.area ?? null}, ${parent.boq_category ?? null},
       ${parent.level ?? null}, ${parent.level_suggested ?? null}, ${parent.level_suggested_reason ?? null},
       ${billLineId}, 1, 'configuration', ${label}, ${dimensionNote}, ${actor}, ${actor})
    returning id
  `;
  const recordId = String(inserted[0]?.id ?? "");
  if (!recordId) throw new Error(`configuration ${label} of ${billLineId} was not inserted`);

  // The checklist, every question `missing`, so the differing fields are
  // there to fill in and carried answers have a row to land on.
  await txn`
    insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
    select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', ${actor}, ${actor}
    from requirements q
    join spec_records r on r.category_id = q.category_id
    where r.id = ${recordId}
  `;
  return { recordId, recordNo };
}

export type RenameConfigurationResult = { recordId: string; label: string; version: number; changed: boolean };

/**
 * A configuration's name, corrected. Refused for a name already used under the
 * same bill line, retired ones included — a name is never reused.
 *
 * Under the optimistic lock like every other edit of a record, and a version
 * of it: the export's Name column carries the name, so a rename changes what
 * the file says.
 */
export async function renameConfiguration(
  txn: TxnSql,
  { recordId, name, expectedVersion, actor }: { recordId: string; name: string; expectedVersion: number; actor: string },
): Promise<RenameConfigurationResult> {
  const rows = await txn`
    select r.id, r.project_id, r.parent_id, r.variant_label, r.version, r.status,
           (select string_agg(x.ref_value, ', ' order by x.ref_value)
              from spec_record_refs x where x.record_id = r.parent_id and x.ref_system = 'boq_code') as client_ref,
           (select p.record_no from spec_records p where p.id = r.parent_id) as parent_no
      from spec_records r where r.id = ${recordId} for update
  `;
  const record = rows[0];
  if (!record) throw new DomainConflictError("not_found", "No such record.", { status: 404 });
  if (!record.parent_id) {
    throw new DomainConflictError("not_a_configuration", "Only a configuration has a name to change.", { status: 400 });
  }
  if (String(record.status) !== "active") {
    throw new DomainConflictError("record_retired", "That configuration has been retired.", { status: 400 });
  }
  if (Number(record.version) !== expectedVersion) {
    throw new DomainConflictError(
      "record_version_stale",
      "Someone else changed this configuration while you had it open. Reload before renaming.",
    );
  }
  const billLine = text(record.client_ref) ?? `#${String(record.parent_no)}`;
  const current = String(record.variant_label);

  const siblings = await txn`
    select variant_label, status from spec_records where parent_id = ${record.parent_id} and id <> ${recordId}
  `;
  const checked = checkConfigurationName(
    name,
    siblings.map((row) => ({ label: String(row.variant_label ?? ""), status: String(row.status) })),
    billLine,
  );
  if (!checked.ok) {
    throw new DomainConflictError(checked.code, checked.message, {
      status: checked.code === "name_taken" || checked.code === "name_retired" ? 409 : 400,
    });
  }
  if (checked.label === current) return { recordId, label: current, version: expectedVersion, changed: false };

  const changeSetId = await openChangeSet(txn, {
    projectId: String(record.project_id),
    kind: "manual_edit",
    actor,
    reason: `Configuration ${billLine} ${current} renamed ${billLine} ${checked.label}`,
  });
  const updated = await txn`
    update spec_records set variant_label = ${checked.label}, updated_by = ${actor}
     where id = ${recordId} and version = ${expectedVersion}
    returning version
  `;
  if (!updated[0]) {
    throw new DomainConflictError(
      "record_version_stale",
      "Someone else changed this configuration while you had it open. Reload before renaming.",
    );
  }
  await snapshotRecords(txn, [recordId], changeSetId);
  return { recordId, label: checked.label, version: Number(updated[0].version), changed: true };
}
