// Promoting reviewed drawing observations into canonical record attributes.
//
// ============================================================================
// THE ITEM CARD IS THE UNIT OF COMMIT.
//
// The spec-document confirm names one RECORD, because a proposal there targets
// exactly one. A drawing page targets several: one drawing of S-100 belongs to
// the mock-up run, the main run and the VE run at once. The card the reviewer
// reads is therefore the ITEM — one page, its observations, its target records
// — and that is what commits, atomically.
//
// This is the same rule as "the record is the unit of commit", not an exception
// to it: never commit a card the reviewer did not see whole. A page written to
// two of its three runs looks finished and is not, and nothing downstream would
// ever ask why the VE record has no fabric.
//
// TARGETS ARE RE-RESOLVED HERE, AND A NEW ONE REFUSES THE REQUEST.
//
// Resolution is live (see drawing-document.ts), so confirming the batch's BOQ
// between page load and confirm can ADD a run. That new record is one the
// reviewer never saw and never unticked, so the request fails with
// `targets_changed` rather than quietly writing to it or quietly skipping it.
//
// spec_records.version IS NOT TOUCHED. Nothing on the record changes: an
// attribute is its own row. Bumping the record would invalidate every M2
// extraction snapshot and every chase coverage row taken against it, for a
// reason that has nothing to do with them — the same trap as a `chased_at`
// column.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import {
  applyAnswerFills,
  applyAnswerRetractions,
  planAnswerFills,
  type PromotableAttribute,
} from "@/lib/promote-answers";
import {
  acknowledgedReplacements,
  assertStagedDrawings,
  drawingItemBlockers,
  hasPendingObservations,
  resolveDrawingTargets,
  targetRecordIds,
  type DrawingItem,
  type DrawingObservation,
  type OccupiedSlots,
  type OccupiedSlot,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { isDimensionSlot, type DimensionSlot } from "@/lib/spec-vocab";
import type { RecordEntry } from "@/lib/spec-document";
import { assertProjectScopedPathname } from "@/lib/blob-source";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";

export type ObservationRef = { id: string; version: number };

export type DrawingsConfirmResult = {
  applied: number;
  ignored: number;
  restored: number;
  records: number;
  /** Checklist answers filled from the attributes this confirm wrote. */
  answersFilled: number;
  /** Rows a revised drawing retired and took the place of. */
  replaced?: number;
  remainingPending: number;
  status: string;
};

type LoadedRun = { runId: string; projectId: string; staged: StagedDrawings };

async function loadRun(txn: TxnSql, runId: string, expectedVersion: number | null): Promise<LoadedRun> {
  const rows = await txn`
    select id, project_id, status, parsed, version, source_kind, document_kind
    from intake_runs where id = ${runId}
    for update
  `;
  const run = rows[0];
  if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  if (run.document_kind !== "shop_drawings") {
    throw new DomainConflictError("wrong_kind", "That import is not a set of shop drawings.", { status: 400 });
  }
  if (run.status !== "parsed" && run.status !== "confirmed") {
    throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)}, not ready to review.`);
  }
  if (expectedVersion !== null && Number(run.version) !== expectedVersion) {
    throw new DomainConflictError(
      "import_version_stale",
      "This import changed while you were reviewing it. Reload and check before confirming.",
    );
  }
  return { runId: String(run.id), projectId: String(run.project_id), staged: assertStagedDrawings(run.parsed) };
}

/**
 * The project's active records, with the run identity the fan-out needs.
 *
 * Read INSIDE the transaction so the resolution the confirm checks is the one
 * that is true at commit, not the one the review screen was showing.
 */
async function loadRecords(txn: TxnSql, projectId: string): Promise<RecordEntry[]> {
  const rows = await txn`
    select r.id, r.record_no, r.item_description, r.category_id, r.version,
           r.run_id, run.name as run_name, p.bws_project_number,
           coalesce((select array_agg(x.ref_value order by x.ref_value)
                       from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code'), '{}') as boq_codes
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    where r.project_id = ${projectId} and r.status = 'active'
    order by run.sort_order, r.record_no
  `;
  return rows.map((row) => ({
    id: String(row.id),
    recordNo: Number(row.record_no),
    label: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
    itemDescription: String(row.item_description),
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: null,
    refs: (row.boq_codes as string[] | null)?.map(String) ?? [],
    boqCodes: (row.boq_codes as string[] | null)?.map(String) ?? [],
    runId: String(row.run_id),
    runName: String(row.run_name),
    version: Number(row.version),
  }));
}

/** Locate by id, never by position. Array index is display order, not identity. */
function takeObservations(
  item: DrawingItem,
  refs: ObservationRef[],
  allow: DrawingObservation["reviewStatus"][],
): DrawingObservation[] {
  const taken: DrawingObservation[] = [];
  for (const ref of refs) {
    const observation = item.observations.find((row) => row.id === ref.id);
    if (!observation) {
      throw new DomainConflictError("observation_missing", "One of these specs is no longer part of this import. Reload.");
    }
    if (!allow.includes(observation.reviewStatus)) {
      throw new DomainConflictError(
        "observation_reviewed",
        `“${observation.labelRaw ?? "That spec"}” has already been ${observation.reviewStatus}. Reload to see the current state.`,
      );
    }
    if (observation.version !== ref.version) {
      throw new DomainConflictError(
        "observation_version_stale",
        `“${observation.labelRaw ?? "One of these specs"}” was edited in another tab. Reload before confirming.`,
      );
    }
    taken.push(observation);
  }
  return taken;
}

function findItem(staged: StagedDrawings, itemId: string): DrawingItem {
  const item = staged.items.find((row) => row.id === itemId);
  if (!item) throw new DomainConflictError("item_missing", "That item is no longer part of this import. Reload.");
  return item;
}

async function writeStaged(txn: TxnSql, run: LoadedRun, actor: string, items: DrawingItem[]): Promise<string> {
  const staged: StagedDrawings = { ...run.staged, items };
  // `confirmed` means NO PENDING OBSERVATIONS REMAIN — applied or explicitly
  // ignored. It does not mean every spec of every item is settled, which is why
  // the screen labels it "Review complete".
  const status = hasPendingObservations(staged) ? "parsed" : "confirmed";
  const rows = await txn`
    update intake_runs
    set parsed = ${JSON.stringify(staged)}::jsonb,
        status = ${status},
        confirmed_at = ${status === "confirmed" ? new Date().toISOString() : null},
        updated_by = ${actor}
    where id = ${run.runId}
    returning id
  `;
  if (!rows[0]) throw new Error("the import was not updated");
  return status;
}

function countPending(items: DrawingItem[]): number {
  return items.reduce(
    (total, item) => total + item.observations.filter((o) => o.reviewStatus === "pending").length,
    0,
  );
}

// ---- confirm ---------------------------------------------------------------

/**
 * A crop of the source drawing that the reviewer looked at before confirming.
 *
 * `pathname`, never a URL. The store resolves a pathname against its own host
 * from the token, so there is no host for a client to influence and no redirect
 * to follow -- see the header of blob-source.ts for the defect that rule exists
 * to close.
 */
export type ItemImage = {
  pathname: string;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
};

export async function confirmDrawingItem(
  txn: TxnSql,
  {
    runId,
    expectedVersion,
    itemId,
    itemVersion,
    observations: refs,
    image,
    actor,
  }: {
    runId: string;
    expectedVersion: number | null;
    itemId: string;
    itemVersion: number;
    observations: ObservationRef[];
    /** The crop the reviewer looked at, already uploaded. Null for none. */
    image?: ItemImage | null;
    actor: string;
  },
): Promise<DrawingsConfirmResult> {
  const run = await loadRun(txn, runId, expectedVersion);
  const item = findItem(run.staged, itemId);
  if (item.version !== itemVersion) {
    throw new DomainConflictError(
      "item_version_stale",
      "This item's targets changed while you were reviewing it. Reload before confirming.",
    );
  }

  const records = await loadRecords(txn, run.projectId);
  const resolution = resolveDrawingTargets(item.itemCodeRaw, records);
  const targets = targetRecordIds(item, resolution);

  // The card-changed guard, in its fan-out form. A record the live resolution
  // suggests that the reviewer neither ticked nor unticked is one that appeared
  // after the page loaded — a BOQ confirmed in between.
  const decided = new Set([...(item.targets?.ticked ?? []), ...(item.targets?.unticked ?? [])]);
  if (item.targets) {
    const appeared = resolution.suggested.filter((recordId) => !decided.has(recordId));
    if (appeared.length > 0) {
      throw new DomainConflictError(
        "targets_changed",
        `This item now also appears in ${appeared.length} record${appeared.length === 1 ? "" : "s"} you have not seen. Reload and choose which runs this drawing applies to.`,
        { diff: appeared },
      );
    }
  }

  // The set the reviewer submitted must be exactly the item's live pending set.
  const pendingIds = item.observations.filter((o) => o.reviewStatus === "pending").map((o) => o.id);
  const submitted = new Set(refs.map((ref) => ref.id));
  if (pendingIds.length !== submitted.size || pendingIds.some((id) => !submitted.has(id))) {
    throw new DomainConflictError(
      "card_changed",
      "The specs on this item changed while you were reviewing it. Reload before confirming.",
    );
  }

  const taken = takeObservations(item, refs, ["pending"]);
  if (taken.length === 0) {
    throw new DomainConflictError("nothing_to_apply", "There is nothing pending on this item.", { status: 400 });
  }

  // Blockers are recomputed here, never trusted from the screen. `occupied` is
  // read live so a slot filled by another card a second ago is caught.
  // Both halves, for the reason loadOccupiedSlots gives: a BWS field and a
  // dimension slot are two uniqueness rules, and reading one would let the
  // other collide at insert.
  const occupied: OccupiedSlots = { fields: new Map(), dimensions: new Map() };
  if (targets.length > 0) {
    const occupiedRows = await txn`
      select id, record_id, spec_field_id, dimension_slot, version, label, value, unit, source_page
      from record_attributes
      where record_id = any(${targets}::uuid[])
        and status = 'active'
        and (spec_field_id is not null or dimension_slot is not null)
    `;
    for (const row of occupiedRows) {
      const recordId = String(row.record_id);
      const occupant: OccupiedSlot = {
        attributeId: String(row.id),
        attributeVersion: Number(row.version),
        label: String(row.label),
        value: row.value === null || row.value === undefined ? null : String(row.value),
        unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
        sourceFilename: null,
        sourcePage: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
      };
      if (row.spec_field_id) {
        const map = occupied.fields.get(recordId) ?? new Map<string, OccupiedSlot>();
        map.set(String(row.spec_field_id), occupant);
        occupied.fields.set(recordId, map);
      }
      if (isDimensionSlot(row.dimension_slot)) {
        const map = occupied.dimensions.get(recordId) ?? new Map<DimensionSlot, OccupiedSlot>();
        map.set(row.dimension_slot, occupant);
        occupied.dimensions.set(recordId, map);
      }
    }
  }
  const blockers = drawingItemBlockers(item, resolution, occupied);
  if (blockers.length > 0) {
    throw new DomainConflictError("blocked", blockers[0]?.message ?? "This item cannot be confirmed yet.", {
      diff: blockers,
    });
  }

  // Locked in a deterministic order. Two item cards fanning out to overlapping
  // records would otherwise be able to deadlock against each other.
  const ordered = [...targets].sort();
  const locked = await txn`
    select id, project_id, status from spec_records
    where id = any(${ordered}::uuid[])
    order by id
    for update
  `;
  if (locked.length !== ordered.length) {
    throw new DomainConflictError("record_missing", "One of the target records no longer exists. Reload.");
  }
  for (const row of locked) {
    if (String(row.project_id) !== run.projectId) {
      throw new DomainConflictError("wrong_project", "A target record belongs to another project.", { status: 400 });
    }
    if (String(row.status) !== "active") {
      throw new DomainConflictError("record_not_active", "A target record is no longer active. Reload.");
    }
  }

  // The picture, if the reviewer kept one. Validated HERE and not trusted from
  // the screen: the pathname has to be one of THIS project's, or a signed-in
  // user could attach any blob in the store to any record by editing a request.
  let imagePath: string | null = null;
  if (image) {
    try {
      imagePath = assertProjectScopedPathname(image.pathname, run.projectId);
    } catch {
      throw new DomainConflictError("image_not_this_project", "That image is not one of this project's files.", {
        status: 400,
      });
    }
  }

  // The change this confirm is, opened before the first write so write_audit()
  // can stamp every row it produces. Its reason is generated rather than asked
  // for: the page and the document ARE the reason, and a reviewer typing "from
  // the drawings" on every card is ceremony, not consent.
  const changeSetId = await openChangeSet(txn, {
    projectId: run.projectId,
    kind: "drawing_confirm",
    actor,
    reason: `${taken.length} spec${taken.length === 1 ? "" : "s"} from ${run.staged.filename ?? "the shop drawings"}${item.page ? ` page ${item.page}` : ""}${item.itemCodeRaw ? ` (${item.itemCodeRaw})` : ""}`,
    sourceIntakeRunId: runId,
  });

  const attributeIdsByObservation = new Map<string, string[]>();
  /** Old row → the row that took over, linked once the new id is known. */
  const superseded: { oldId: string; observationId: string; recordId: string }[] = [];
  const now = new Date().toISOString();
  let answersFilled = 0;

  for (const recordId of ordered) {
    // One image row per target record, the same fan-out the attributes get, and
    // correct for the same reason: it is ONE drawing of one item, and the runs
    // quoting it are quoting that item.
    //
    // REPLACES rather than accumulates. Confirming a second card for the same
    // record should leave one picture, not two with nothing to say which is
    // current. The old row is deleted rather than kept, because unlike an
    // attribute an image carries no observation anybody reasoned from -- the
    // source PDF is preserved and the crop can always be re-made.
    if (imagePath) {
      await txn`
        delete from attachments
        where entity_type = 'spec_records' and entity_id = ${recordId} and kind = 'item_image'
      `;
      await txn`
        insert into attachments
          (entity_type, entity_id, kind, storage_path, filename, content_type, size,
           image_width, image_height, uploaded_by)
        values
          ('spec_records', ${recordId}, 'item_image', ${imagePath},
           ${image?.filename ?? "item.png"}, 'image/png', ${image?.size ?? null},
           ${image?.width ?? null}, ${image?.height ?? null}, ${actor})
      `;
    }

    const sortRows = await txn`
      select coalesce(max(sort_order), 0) as max_sort from record_attributes where record_id = ${recordId}
    `;
    let sortOrder = Number(sortRows[0]?.max_sort ?? 0);

    for (const observation of taken) {
      sortOrder += 1;

      // ---- a revised drawing replaces what is in the slot ------------------
      // Retired BEFORE the insert, and that order is decided by the database
      // rather than by preference: both partial unique indexes are
      // `where status = 'active'`, so retire-then-insert commits and
      // insert-then-retire cannot. Re-checked against the version the reviewer
      // saw — an occupant that changed since is refused rather than replaced,
      // because the value they agreed to drop is not the value that is there.
      const replacement = acknowledgedReplacements(observation).get(recordId);
      if (replacement) {
        const supersededRows = await txn`
          update record_attributes
          set status = 'retired', retired_at = now(), retired_by = ${actor}, updated_by = ${actor}
          where id = ${replacement.attributeId}
            and record_id = ${recordId}
            and version = ${replacement.attributeVersion}
            and status = 'active'
          returning id
        `;
        if (!supersededRows[0]) {
          throw new DomainConflictError(
            "occupant_changed",
            "The spec this page would replace has changed since you looked at it. Nothing was written — reload and check what is there now.",
          );
        }
        superseded.push({ oldId: replacement.attributeId, observationId: observation.id, recordId });
      }

      const inserted = await txn`
        insert into record_attributes
          (record_id, attr_group, dimension_slot, label, value, unit, material_code, spec_field_id, state,
           source_run_id, source_page, sort_order, created_by, updated_by)
        values
          (${recordId}, ${observation.attrGroup},
           -- Only a dimension carries one, and 0011's biconditional makes the
           -- pairing unrepresentable otherwise: a dimension with no slot and a
           -- note with one are both refused at insert. Normalised here rather
           -- than trusted from the staged JSON, because a row staged before
           -- 0011 carries no slot key at all.
           ${observation.attrGroup === "dimension" ? (observation.dimensionSlot ?? null) : null},
           ${observation.labelRaw ?? observation.attrGroup},
           ${observation.value},
           ${observation.unit}, ${observation.materialCodeRaw}, ${observation.specFieldId},
           ${observation.state}, ${runId}, ${item.page}, ${sortOrder}, ${actor}, ${actor})
        returning id
      `;
      const attributeId = String(inserted[0]?.id ?? "");
      if (!attributeId) throw new Error(`observation ${observation.id} was not inserted`);

      // Which row took over, so "why did the width change on the 14th" is
      // answered by following a link rather than by guessing which of two
      // retired rows came next.
      if (replacement) {
        await txn`
          update record_attributes set superseded_by_id = ${attributeId}, updated_by = ${actor}
          where id = ${replacement.attributeId}
        `;
      }

      const list = attributeIdsByObservation.get(observation.id) ?? [];
      list.push(attributeId);
      attributeIdsByObservation.set(observation.id, list);
    }

    // ---- through to the checklist ----------------------------------------
    // Read back from the table rather than from `taken`, because the answer
    // has to reflect EVERY attribute the record now carries. A card supplying
    // only the height still has to recompose the whole dimensions cell over
    // the width and depth an earlier document confirmed -- otherwise the
    // answer says H720 and the record says W1900 x D790 x H720.
    const attributeRows = await txn`
      select attr_group, dimension_slot, spec_field_id, value, unit, state, sort_order, source_run_id
      from record_attributes
      where record_id = ${recordId} and status = 'active'
      order by sort_order
    `;
    const promotable: PromotableAttribute[] = attributeRows.map((row) => ({
      attrGroup: String(row.attr_group),
      dimensionSlot: row.dimension_slot ? String(row.dimension_slot) : null,
      specFieldId: row.spec_field_id ? String(row.spec_field_id) : null,
      value: row.value === null ? null : String(row.value),
      unit: row.unit === null ? null : String(row.unit),
      state: String(row.state) as PromotableAttribute["state"],
      sortOrder: Number(row.sort_order),
      sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
    }));
    // An uncategorised record has no questions yet, so there is nothing to
    // fill and that is not a failure -- the attributes are the record of what
    // the document said either way, and setting a category later creates the
    // answer rows. It just does not back-fill them; see the gap in CLAUDE.md.
    const fills = planAnswerFills(promotable);
    const filled = await applyAnswerFills(txn, recordId, runId, actor, fills);
    // Retractions too, because a REPLACEMENT can orphan an answer: the row it
    // retired may have carried a BWS field the new row does not. Without this
    // the checklist would go on reporting a confirmed value the record holds
    // no statement for, and the export would still ship it.
    await applyAnswerRetractions(txn, recordId, actor, fills);
    answersFilled += filled;

  }

  // One version per target record, taken AFTER the answers were promoted: a
  // version showing the new attribute but not the checklist answer it filled
  // would be a version of a state the record was never in.
  await snapshotRecords(txn, ordered, changeSetId);

  const items = run.staged.items.map((row) =>
    row.id !== itemId
      ? row
      : {
          ...row,
          version: row.version + 1,
          targets: { ticked: ordered, unticked: row.targets?.unticked ?? [] },
          observations: row.observations.map((observation) =>
            attributeIdsByObservation.has(observation.id)
              ? {
                  ...observation,
                  version: observation.version + 1,
                  reviewStatus: "applied" as const,
                  reviewedAt: now,
                  reviewedBy: actor,
                  applied: { attributeIds: attributeIdsByObservation.get(observation.id) ?? [] },
                }
              : observation,
          ),
        },
  );

  const status = await writeStaged(txn, run, actor, items);

  await txn`
    insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
    values ('intake_run', ${runId}, 'parsed', ${status}, ${actor},
            ${`${taken.length} spec${taken.length === 1 ? "" : "s"} applied to ${ordered.length} record${ordered.length === 1 ? "" : "s"}`})
  `;

  return {
    applied: taken.length * ordered.length,
    ignored: 0,
    restored: 0,
    records: ordered.length,
    replaced: superseded.length,
    answersFilled,
    remainingPending: countPending(items),
    status,
  };
}

// ---- ignore and restore ----------------------------------------------------

/**
 * Every ignore is reversible; an APPLIED observation is not. Undoing a spec
 * that reached a record is something a person does on the record screen, on
 * purpose, where they can see what else is there.
 */
export async function reviewDrawingObservations(
  txn: TxnSql,
  {
    runId,
    expectedVersion,
    itemId,
    observations: refs,
    action,
    actor,
  }: {
    runId: string;
    expectedVersion: number | null;
    itemId: string;
    observations: ObservationRef[];
    action: "ignore" | "restore";
    actor: string;
  },
): Promise<DrawingsConfirmResult> {
  const run = await loadRun(txn, runId, expectedVersion);
  const item = findItem(run.staged, itemId);
  const taken = takeObservations(item, refs, action === "ignore" ? ["pending"] : ["ignored"]);
  const now = new Date().toISOString();
  const takenIds = new Set(taken.map((observation) => observation.id));

  const items = run.staged.items.map((row) =>
    row.id !== itemId
      ? row
      : {
          ...row,
          observations: row.observations.map((observation) =>
            takenIds.has(observation.id)
              ? {
                  ...observation,
                  version: observation.version + 1,
                  reviewStatus: action === "ignore" ? ("ignored" as const) : ("pending" as const),
                  reviewedAt: action === "ignore" ? now : null,
                  reviewedBy: action === "ignore" ? actor : null,
                }
              : observation,
          ),
        },
  );

  const status = await writeStaged(txn, run, actor, items);
  return {
    applied: 0,
    ignored: action === "ignore" ? taken.length : 0,
    restored: action === "restore" ? taken.length : 0,
    records: 0,
    // Ignoring writes no attribute, so it answers nothing. It also does NOT
    // retract an answer a previous confirm filled: undoing an answer is
    // something a person does on the record screen, on purpose.
    answersFilled: 0,
    remainingPending: countPending(items),
    status,
  };
}
