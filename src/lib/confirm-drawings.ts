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
import { applyAnswerFills, applyAnswerRetractions, loadDimensionNote, planAnswerFills } from "@/lib/promote-answers";
import { loadPromotable } from "@/lib/attribute-retire";
import {
  acknowledgedReplacements,
  assertStagedDrawings,
  specFieldEntries,
  drawingItemBlockers,
  hasPendingObservations,
  occupancyThrough,
  resolveDrawingTargets,
  targetRecordIds,
  canonicalCode,
  variantLettersByItem,
  namedConfigurationPlans,
  parentVariantsOf,
  rowWriteRecords,
  stateToWrite,
  type NamedTargets,
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
import { guessLevelFromAttributes } from "@/lib/level-guess";
import {
  isFinishCodeOrigin,
  isFinishGroup,
  isFinishKind,
  normaliseFinishCode,
  readUncodedFinish,
  resolveFinishCode,
  type Finish,
} from "@/lib/finishes";

/** A swatch chip cropped off the page, keyed by the row it was cropped for. */
export type SwatchCrop = {
  observationId: string;
  pathname: string;
  /**
   * The page the crop was TAKEN FROM, which on a two-page item need not be the
   * page the row was read from — the chip is printed where it is printed. It is
   * what names the stored file, so a swatch stays checkable against a page
   * somebody can open, which is the whole reason the standalone swatch route
   * refuses an upload that does not say where it came from.
   */
  page?: number | null;
  filename?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
};

import { createFinish, mintInternalFinishCode } from "@/lib/finish-edit";
import { ensureVariant } from "@/lib/variant-create";
import { snapshotRecords } from "@/lib/record-snapshot";

/**
 * What a stored swatch is CALLED, which is the only place its page survives.
 *
 * `attachments` has no source column and this is not the migration that adds
 * one, so the page goes in the filename — where the finishes screen already
 * shows it and where a person checking a chip against the drawing can read it.
 * The client sends a uuid; a name saying which page the picture came off is
 * worth more than an observation id nobody can look up.
 */
function swatchFilename(swatch: SwatchCrop): string {
  if (typeof swatch.page === "number" && Number.isInteger(swatch.page) && swatch.page > 0) {
    return `swatch-page-${swatch.page}.png`;
  }
  return swatch.filename ?? "swatch.png";
}

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
  // Read with the register, exactly as the screen reads it: a callout whose
  // group and BWS field were re-read on the way to the card must land on the
  // same field when it is written, or the screen is promising a cell the file
  // does not deliver.
  const fieldRows = await txn`select id, json_id, name from spec_fields order by sort_order`;
  return {
    runId: String(run.id),
    projectId: String(run.project_id),
    staged: assertStagedDrawings(run.parsed, specFieldEntries(fieldRows)),
  };
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
           r.parent_id, r.variant_label,
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
    parentId: row.parent_id ? String(row.parent_id) : null,
    variantLabel: row.variant_label ? String(row.variant_label) : null,
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
    swatches = [],
    actor,
  }: {
    runId: string;
    expectedVersion: number | null;
    itemId: string;
    itemVersion: number;
    observations: ObservationRef[];
    /** The crop the reviewer looked at, already uploaded. Null for none. */
    image?: ItemImage | null;
    /** Swatch chips cropped off the page, one per finish row. */
    swatches?: SwatchCrop[];
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
  // The canonical code, matching `resolveStagedRun` exactly: the screen and the
  // confirm must resolve an item the same way or a card commits somewhere the
  // reviewer was not shown.
  const resolution = resolveDrawingTargets(canonicalCode(run.staged, item.itemCodeRaw), records);
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

  // ==========================================================================
  // A CODE DRAWN MORE THAN ONCE WRITES TO A CONFIGURATION, NOT THE BILL LINE.
  //
  // S-201 is drawn on pages 5 and 6 with identical geometry and different
  // fabrics, against ONE bill line. Both pages used to resolve to that one
  // record, so confirming the second offered to RETIRE the first's fabric: the
  // app insisting one of two true statements had to be wrong.
  //
  // The letter is derived HERE from the staged document, by the same pure
  // function the review screen uses, and is never taken from the request — a
  // client naming the record its data belongs to is what `blob-source.ts`
  // exists to refuse.
  //
  // TWO LISTS COME OUT OF THIS AND THEY ARE NOT INTERCHANGEABLE.
  //   `ordered`  the records the reviewer TICKED — the bill's own. Echoed back
  //              into the staged item and compared against the live resolution
  //              on the next read, so writing variant ids here would make
  //              every later confirm fail `targets_changed`.
  //   `writeIds` where the specs actually land.
  // A code drawn ONCE has the two identical, which is most of any pack.
  // ==========================================================================
  //
  // A CODE WHOSE PAGES NAME ITS CONFIGURATIONS (schemaVersion 3) is the third
  // case, and it writes to SEVERAL variants per bill line: S-301's sheet is
  // TYPE 1 … TYPE 5 on every phase that quotes it, and each ROW lands only on
  // the configurations it belongs to. The plan comes from the same pure
  // function the card reads. `ordered` is unchanged — still the bill's own.
  // ==========================================================================
  const plan = namedConfigurationPlans(run.staged.items, run.staged).get(item.id) ?? null;
  const variantLabel = plan ? null : (variantLettersByItem(run.staged.items, run.staged).get(item.id) ?? null);
  const ordered = [...targets].sort();
  const variantOf = new Map<string, string>();
  if (variantLabel) {
    for (const parentId of ordered) {
      const variant = await ensureVariant(txn, { parentId, variantLabel, actor });
      variantOf.set(parentId, variant.recordId);
    }
  }
  // The live variants BEFORE this confirm creates any: the blocker that asks
  // before a new configuration is created beside existing ones has to see the
  // bill line as it was, or every creation would read as an exact match.
  const named: NamedTargets | null = plan ? { plan, variants: parentVariantsOf(records) } : null;
  const existingNamedIds = named
    ? [...new Set(taken.flatMap((observation) => rowWriteRecords(observation.id, ordered, named)))]
    : [];
  const writeIds = named ? existingNamedIds : ordered.map((parentId) => variantOf.get(parentId) ?? parentId);

  // Blockers are recomputed here, never trusted from the screen. `occupied` is
  // read live so a slot filled by another card a second ago is caught.
  // Both halves, for the reason loadOccupiedSlots gives: a BWS field and a
  // dimension slot are two uniqueness rules, and reading one would let the
  // other collide at insert.
  const byWriteTarget: OccupiedSlots = { fields: new Map(), dimensions: new Map() };
  if (writeIds.length > 0) {
    const occupiedRows = await txn`
      select id, record_id, spec_field_id, dimension_slot, version, label, value, unit, source_page
      from record_attributes
      where record_id = any(${writeIds}::uuid[])
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
        const map = byWriteTarget.fields.get(recordId) ?? new Map<string, OccupiedSlot>();
        map.set(String(row.spec_field_id), occupant);
        byWriteTarget.fields.set(recordId, map);
      }
      if (isDimensionSlot(row.dimension_slot)) {
        const map = byWriteTarget.dimensions.get(recordId) ?? new Map<DimensionSlot, OccupiedSlot>();
        map.set(row.dimension_slot, occupant);
        byWriteTarget.dimensions.set(recordId, map);
      }
    }
  }
  // Keyed back onto what the reviewer ticked, so the blockers and the replace
  // acknowledgements both speak about the records named on the card. A NAMED
  // page is keyed by the real variants instead: one bill line has five of
  // them, and a re-key onto the parent could only hold one.
  const occupied = named ? byWriteTarget : occupancyThrough(byWriteTarget, variantOf);
  const blockers = drawingItemBlockers(item, resolution, occupied, named);
  if (blockers.length > 0) {
    throw new DomainConflictError("blocked", blockers[0]?.message ?? "This item cannot be confirmed yet.", {
      diff: blockers,
    });
  }

  // ---- where each row lands ------------------------------------------------
  //
  // One entry per record written. `ackKey` is what the reviewer's replace
  // acknowledgements are keyed on: the ticked bill record for a plain or
  // lettered card (the `occupancyThrough` contract), the variant itself for a
  // named one (whose occupants the card named by variant).
  type Write = { tickedId: string; recordId: string; ackKey: string; observations: DrawingObservation[] };
  const writes: Write[] = [];
  if (named) {
    for (const parentId of ordered) {
      for (const label of named.plan.labels) {
        const variant = await ensureVariant(txn, { parentId, variantLabel: label, actor });
        writes.push({
          tickedId: parentId,
          recordId: variant.recordId,
          ackKey: variant.recordId,
          observations: taken.filter((observation) =>
            (named.plan.rows[observation.id] ?? named.plan.labels).includes(label),
          ),
        });
      }
    }
  } else {
    for (const [index, recordId] of ordered.map((parentId) => variantOf.get(parentId) ?? parentId).entries()) {
      const tickedId = ordered[index]!;
      writes.push({ tickedId, recordId, ackKey: tickedId, observations: taken });
    }
  }
  const writtenIds = writes.map((write) => write.recordId);

  // Locked in a deterministic order. Two item cards fanning out to overlapping
  // records would otherwise be able to deadlock against each other. The records
  // LOCKED are the ones being written, which for a configuration is the variant
  // rather than the bill line.
  const lockOrder = [...new Set(writtenIds)].sort();
  const locked = await txn`
    select id, project_id, status from spec_records
    where id = any(${lockOrder}::uuid[])
    order by id
    for update
  `;
  if (locked.length !== lockOrder.length) {
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

  // ---- the project's finishes library, for the codes this card carries ----
  //
  // Read once, before the fan-out. A code that is already in the library links
  // to it; a code nobody has seen creates an entry, TBC, holding what this
  // page said. A CONFLICT — the library has committed to a description and
  // this page says something else — LINKS NOTHING: linking would make the item
  // render the library's words while its own page said otherwise, and there is
  // no way to tell which is right. It stays unlinked and shows up on the
  // finishes page as a code needing a person, which is house/conventions.md §5:
  // anything unresolvable becomes a visible flag, never a plausible-looking
  // wrong answer.
  const libraryRows = await txn`
    select id, code, code_norm, code_origin, kind, description, supplier_raw, reference, colour, state
    from project_finishes where project_id = ${run.projectId} and status = 'active'
  `;
  const library: Finish[] = libraryRows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    codeNorm: String(row.code_norm),
    codeOrigin: isFinishCodeOrigin(row.code_origin) ? row.code_origin : "client",
    kind: isFinishKind(row.kind) ? row.kind : null,
    description: row.description === null || row.description === undefined ? null : String(row.description),
    supplierRaw: row.supplier_raw === null || row.supplier_raw === undefined ? null : String(row.supplier_raw),
    reference: row.reference === null || row.reference === undefined ? null : String(row.reference),
    colour: row.colour === null || row.colour === undefined ? null : String(row.colour),
    state: String(row.state) as Finish["state"],
  }));

  const finishIdByObservation = new Map<string, string | null>();
  for (const observation of taken) {
    const resolution = resolveFinishCode(observation.materialCodeRaw, observation.value, library);
    if (resolution.status === "matched") {
      finishIdByObservation.set(observation.id, resolution.finish.id);
    } else if (resolution.status === "new") {
      const finishId = await createFinish(txn, {
        projectId: run.projectId,
        fields: {
          code: resolution.code,
          // What THIS page said, as a starting point. `tbc` because a drawing
          // naming a code is not somebody confirming what it is.
          description: observation.value,
          state: "tbc",
        },
        actor,
      });
      library.push({
        id: finishId,
        code: resolution.code,
        codeNorm: resolution.codeNorm,
        codeOrigin: "client",
        kind: null,
        description: observation.value,
        supplierRaw: null,
        reference: null,
        colour: null,
        state: "tbc",
      });
      finishIdByObservation.set(observation.id, finishId);
    } else if (resolution.status === "none" && isFinishGroup(observation.attrGroup)) {
      // ====================================================================
      // A FINISH THE CLIENT GAVE NO CODE FOR (4a.1, Max 2026-09-22).
      //
      // `resolveFinishCode` answers `none` before it looks at anything else
      // when there is no `materialCodeRaw`, which is why the S-203 fabric sat
      // on the record while the project's library stayed empty. There was no
      // key to file it under, and Max's answer is that the app mints one.
      //
      // THE SAME PURE FUNCTION THE REVIEW SCREEN CALLS. The card shows what
      // will happen and this does it; a second reading here is how a card
      // comes to promise something the confirm does not deliver — the
      // `proposalBlockers()` rule.
      //
      // MINTING IS THE ONLY THING HERE THAT NEEDS A PERSON. Linking to an
      // exact wording already in the library is not a register write, so it
      // happens on its own and the card says so. Creating a row does not: it
      // waits for the press that sets `finishFiling`.
      // ====================================================================
      const reading = readUncodedFinish(observation.value, library, observation.finishFiling ?? null);
      if (reading.outcome === "link" && reading.finish) {
        finishIdByObservation.set(observation.id, reading.finish.id);
      } else if (reading.outcome === "mint") {
        const code = await mintInternalFinishCode(txn, run.projectId);
        const finishId = await createFinish(txn, {
          projectId: run.projectId,
          fields: {
            code,
            codeOrigin: "internal",
            // What THIS page said, which is the only thing the library knows
            // about it — and the wording a later item is matched on.
            description: observation.value,
            state: "tbc",
          },
          actor,
        });
        library.push({
          id: finishId,
          code,
          codeNorm: normaliseFinishCode(code),
          codeOrigin: "internal",
          kind: null,
          description: observation.value,
          supplierRaw: null,
          reference: null,
          colour: null,
          state: "tbc",
        });
        finishIdByObservation.set(observation.id, finishId);
      } else {
        finishIdByObservation.set(observation.id, null);
      }
    } else {
      finishIdByObservation.set(observation.id, null);
    }
  }

  const attributeIdsByObservation = new Map<string, string[]>();
    // ---- the swatch chips, onto the finishes they belong to -----------------
  //
  // A SWATCH BELONGS TO THE CODE, NOT TO THE ITEM. `project_finishes` is
  // unique on (project_id, code_norm) and `WD-05` is on three pages of the
  // real set, so this writes the swatch for that finish across the project —
  // which is the library's edit-once rule, and what the card says out loud.
  //
  // REFUSED, NEVER DROPPED, when the row's code did not resolve to a finish: a
  // code in conflict with the library links nothing by design, and silently
  // discarding a picture somebody cropped is how they come to believe it is
  // stored. Inside the transaction, so the specs roll back with it.
  for (const swatch of swatches) {
    const finishId = finishIdByObservation.get(swatch.observationId);
    if (finishId === undefined) {
      throw new DomainConflictError(
        "swatch_not_on_this_card",
        "A swatch was submitted for a spec that is not on this card. Reload before confirming.",
      );
    }
    if (finishId === null) {
      throw new DomainConflictError(
        "swatch_has_no_finish",
        "That swatch's code does not resolve to one finish in this project's library, so there is nothing to attach it to. Settle the code on the finishes page first.",
      );
    }
    let pathname: string;
    try {
      pathname = assertProjectScopedPathname(swatch.pathname, run.projectId);
    } catch {
      throw new DomainConflictError(
        "swatch_not_this_project",
        "That swatch is not one of this project's files.",
        { status: 400 },
      );
    }
    // Supersede, never delete: a record version may point at the old row, and
    // a version whose picture had been deleted would be a version of a state
    // nobody can see any more. Same rule as the swatch route's own POST.
    await txn`
      update attachments set superseded_at = now()
      where entity_type = 'project_finishes' and entity_id = ${finishId} and kind = 'finish_swatch'
        and superseded_at is null
    `;
    await txn`
      insert into attachments
        (entity_type, entity_id, kind, storage_path, filename, content_type, size,
         image_width, image_height, uploaded_by)
      values
        ('project_finishes', ${finishId}, 'finish_swatch', ${pathname},
         ${swatchFilename(swatch)}, 'image/png', ${swatch.size ?? null},
         ${swatch.width ?? null}, ${swatch.height ?? null}, ${actor})
    `;
  }

  /** Old row → the row that took over, linked once the new id is known. */
  const superseded: { oldId: string; observationId: string; recordId: string }[] = [];
  const now = new Date().toISOString();
  let answersFilled = 0;

  // BOTH IDS PER ITERATION. `recordId` is where the spec lands; `ackKey` is
  // what the reviewer's replace acknowledgements are keyed on — the record the
  // card named. For a code drawn once the two are the same.
  let inserts = 0;
  for (const { recordId, ackKey, observations: landing } of writes) {
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

    for (const observation of landing) {
      sortOrder += 1;
      inserts += 1;

      // ---- a revised drawing replaces what is in the slot ------------------
      // Retired BEFORE the insert, and that order is decided by the database
      // rather than by preference: both partial unique indexes are
      // `where status = 'active'`, so retire-then-insert commits and
      // insert-then-retire cannot. Re-checked against the version the reviewer
      // saw — an occupant that changed since is refused rather than replaced,
      // because the value they agreed to drop is not the value that is there.
      const replacement = acknowledgedReplacements(observation).get(ackKey);
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
          (record_id, attr_group, dimension_slot, label, value, unit, material_code, finish_id, spec_field_id, state,
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
           ${observation.unit}, ${observation.materialCodeRaw},
           ${finishIdByObservation.get(observation.id) ?? null},
           ${observation.specFieldId},
           -- NO BACKTICKS IN A SQL TEMPLATE -- one closes the literal.
           -- A row nothing reads the state of is never ASKED for one, so it
           -- arrives here null; the state column is not null default
           -- confirmed, and this insert names it positionally, so the default
           -- would never fire. stateToWrite is that default, shared with the
           -- empty_value blocker so the two cannot disagree. A row that WAS
           -- asked writes exactly what the reviewer chose.
           ${stateToWrite(observation)}, ${runId}, ${item.page}, ${sortOrder}, ${actor}, ${actor})
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
    // Re-read from the table rather than from `taken`, because the answer has
    // to reflect EVERY attribute the record now carries. A card supplying only
    // the height still has to recompose the whole dimensions cell over the
    // width and depth an earlier document confirmed -- otherwise the answer
    // says H720 and the record says W1900 x D790 x H720.
    //
    // Through loadPromotable, which also resolves each attribute's linked
    // FINISH: the export renders a linked attribute as the library says it is,
    // and an answer written from the attribute's own text would disagree with
    // the file the moment somebody edited the library.
    // AND WITH THE RECORD'S OWN DIMENSION NOTE (0034). The composed cell is a
    // projection of the attributes AND that note; recomposing without it would
    // quietly drop a person's qualifier out of the checklist the first time
    // any document touched the record.
    const promotable = await loadPromotable(txn, recordId);
    const fills = planAnswerFills(promotable, await loadDimensionNote(txn, recordId));
    const filled = await applyAnswerFills(txn, recordId, runId, actor, fills);
    // Retractions too, because a REPLACEMENT can orphan an answer: the row it
    // retired may have carried a BWS field the new row does not. Without this
    // the checklist would go on reporting a confirmed value the record holds
    // no statement for, and the export would still ship it.
    await applyAnswerRetractions(txn, recordId, actor, fills);
    answersFilled += filled;

    // ---- a second look at the item's level -------------------------------
    //
    // The bill is usually silent about metalwork; the shop drawing is where a
    // brass leg first appears. So a record whose level NOBODY HAS DECIDED gets
    // its suggestion revised from what the drawing just said.
    //
    // Two things this must not do, and does not. It never touches `level`:
    // a decision stands, and a drawing is not a person. And it only ever
    // strengthens — `guessLevelFromAttributes` returns complex or hero or
    // nothing, never simple, because "this page named no metal" is not
    // evidence that the item has none.
    const undecided = await txn`
      select id from spec_records where id = ${recordId} and level is null for update
    `;
    if (undecided[0]) {
      const held = await txn`
        select label, value, source_page from record_attributes
         where record_id = ${recordId} and status = 'active'
      `;
      const guess = guessLevelFromAttributes(
        held.map((row) => ({
          labelRaw: row.label === null ? null : String(row.label),
          valueRaw: row.value === null ? null : String(row.value),
          sourcePage: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
        })),
      );
      if (guess) {
        await txn`
          update spec_records
             set level_suggested = ${guess.level},
                 level_suggested_reason = ${guess.reason},
                 updated_by = ${actor}
           where id = ${recordId}
             and level is null
             and level_suggested is distinct from ${guess.level}
        `;
      }
    }
  }

  // One version per target record, taken AFTER the answers were promoted: a
  // version showing the new attribute but not the checklist answer it filled
  // would be a version of a state the record was never in.
  // The records that CHANGED, which for a configuration is the variant. A
  // version of the bill line would describe a heading nothing was written to.
  await snapshotRecords(txn, writtenIds, changeSetId);

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
            ${`${taken.length} spec${taken.length === 1 ? "" : "s"} applied to ${writes.length} record${writes.length === 1 ? "" : "s"}`})
  `;

  return {
    applied: inserts,
    ignored: 0,
    restored: 0,
    records: writes.length,
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
