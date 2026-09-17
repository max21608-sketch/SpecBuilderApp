// Promoting a reviewed BOQ into canonical spec records.
//
// Extracted from the route so BOTH confirm paths (BOQ and specification
// document) sit behind ONE endpoint that dispatches on source_kind. Two confirm
// routes is what the review-and-confirm skill forbids outright, and the reason
// is that the second one is always the one that forgets a guard.
//
// ============================================================================
// THE CONCURRENCY FIX THIS FILE EXISTS FOR
//
// M1 read `coalesce(max(record_no), 0)`, built a list of statements from it,
// and only then opened a transaction. Two imports confirmed at the same moment
// therefore read the SAME maximum and allocated the same record numbers, and
// one of them died on spec_records_project_no_key — after the reviewer had been
// told it was importing.
//
// The `txnClient().transaction([...])` API cannot fix this, because it takes a
// PRE-BUILT array: there is no point at which application code can look at an
// intermediate result and decide. So every guard ran before the transaction
// opened, under read-committed.
//
// Here the project row is locked FIRST, and the maximum is read, the numbers
// allocated, and every insert done INSIDE that lock. This is one of only two
// operations that genuinely needs project-wide serialization (the other is
// generating chase drafts); it is not a pattern to copy onto every write.
//
// The staged lines are re-read AFTER the lock, not taken from the caller: a
// concurrent autosave could otherwise change what is being confirmed between
// the check and the commit.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { assertBoqDocument, normaliseRef, type StagedBoqSheet } from "@/lib/boq-import";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";

type StagedLine = {
  index: number;
  lineNo: number;
  designer: string | null;
  boqCategory: string | null;
  area: string | null;
  code: string | null;
  itemDescription: string;
  productReference: string | null;
  qty: number | null;
  qtyUnit: string | null;
  categoryId: string | null;
  /**
   * The level, and whether a person chose it.
   *
   * `chosen` writes `spec_records.level` — the column the quote gate reads.
   * Anything else writes `level_suggested`, which blocks nothing until
   * somebody accepts it. Both optional: a bill staged before 2026-09-17 has
   * neither, and reads as a line with no level at all, exactly as it did.
   */
  level?: string | null;
  levelStatus?: string;
  levelReason?: string | null;
  ignored: boolean;
  /** The record this line continues, at the version the reviewer was shown. */
  replaces?: { recordId: string; recordVersion: number } | null;
};

/**
 * Which column a staged line's level belongs in.
 *
 * Exactly one of the two is ever non-null — `spec_records_level_or_suggestion`
 * refuses the other shape — so this is the single place that reading is made,
 * and both the insert and the carry-forward call it.
 */
function levelDecision(line: StagedLine): { level: string | null; suggested: string | null; reason: string | null } {
  const level = line.level ?? null;
  if (!level) return { level: null, suggested: null, reason: null };
  if (line.levelStatus === "chosen") return { level, suggested: null, reason: null };
  // A guess with no reason is a guess nobody can check; 0025 refuses it.
  return { level: null, suggested: level, reason: line.levelReason ?? "guessed from the bill" };
}

export type ConfirmBoqResult = {
  imported: number;
  /** Existing records a revision carried forward, updated in place. */
  updated: number;
  /** Records the revision no longer lists, retired rather than deleted. */
  retired: number;
  projectId: string;
  runIds: string[];
  changeSetId: string;
};

export async function confirmBoqImport(
  txn: TxnSql,
  { runId, expectedVersion, actor }: { runId: string; expectedVersion: number | null; actor: string },
): Promise<ConfirmBoqResult> {
  // 1. The run, locked. Read the staged lines from the LOCKED row.
  const runs = await txn`
    select id, project_id, status, parsed, version, source_kind
    from intake_runs where id = ${runId}
    for update
  `;
  const run = runs[0];
  if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  if (run.source_kind !== "boq_xlsx") {
    throw new DomainConflictError("wrong_kind", "That import is not a bill of quantities.", { status: 400 });
  }
  if (run.status === "confirmed") {
    throw new DomainConflictError("already_confirmed", "This import has already been confirmed.");
  }
  if (run.status !== "parsed") {
    throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)}, not ready to confirm.`);
  }
  if (expectedVersion !== null && Number(run.version) !== expectedVersion) {
    throw new DomainConflictError(
      "import_version_stale",
      "Someone else changed this import while you were reviewing it. Reload and check before confirming.",
    );
  }

  const projectId = String(run.project_id);

  // 2. The project row, locked, BEFORE any record number is read. Everything
  //    below now happens with no other import able to interleave.
  const projects = await txn`select id from projects where id = ${projectId} for update`;
  if (!projects[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });

  const parsed = assertBoqDocument(run.parsed);
  const sheets = parsed.sheets.filter((sheet) => !sheet.ignored);
  const lineCount = sheets.reduce(
    (total, sheet) => total + (sheet.lines as StagedLine[]).filter((line) => !line.ignored).length,
    0,
  );
  if (lineCount === 0) {
    throw new DomainConflictError("nothing_to_import", "Every line is ignored — there is nothing to import.", {
      status: 400,
    });
  }

  // 3. Re-checked server-side against live rows. NO MATCHING IS RE-RUN: what
  //    gets written is what the reviewer approved, not what a fresh match would
  //    produce now.
  //
  //    A line with NO CATEGORY is allowed through. Intake must not stall behind
  //    a classification decision that belongs to a later stage: the record
  //    exists, carries its refs and its drawing specs, and simply has no
  //    checklist yet. It says so on the spec table rather than being refused
  //    here. A category that names a row we do not have is still refused —
  //    that is a stale screen, not a deferred decision.
  const categories = await txn`select id from item_categories`;
  const known = new Set(categories.map((row) => String(row.id)));
  const unknownCategory = sheets.flatMap((sheet) =>
    (sheet.lines as StagedLine[]).filter((line) => !line.ignored && line.categoryId && !known.has(line.categoryId)),
  );
  if (unknownCategory.length > 0) {
    throw new DomainConflictError(
      "unknown_category",
      `${unknownCategory.length} line${unknownCategory.length === 1 ? "" : "s"} name a category that no longer exists. Reload the review and choose again.`,
      { diff: unknownCategory.map((line) => ({ index: line.index, lineNo: line.lineNo, code: line.code })) },
    );
  }

  // A sheet naming a run it revises makes this a REVISION rather than a fresh
  // import. The two read differently in the trail, and a revision additionally
  // updates and retires rather than only inserting.
  const revisedRunIds = sheets
    .map((sheet) => (sheet as StagedBoqSheet).replacesRunId ?? null)
    .filter((id): id is string => id !== null);

  // Every run a sheet claims to revise must still be this project's, and
  // active. Re-checked rather than trusted: the reviewer chose it minutes or
  // days ago, and a retired run is not something to write a revision into.
  if (revisedRunIds.length > 0) {
    const targetRuns = await txn`
      select id, project_id, status from spec_runs where id = any(${revisedRunIds}::uuid[])
    `;
    if (targetRuns.length !== new Set(revisedRunIds).size) {
      throw new DomainConflictError("run_missing", "A run this revision replaces no longer exists. Reload the review.");
    }
    for (const target of targetRuns) {
      if (String(target.project_id) !== projectId) {
        throw new DomainConflictError("wrong_project", "A run this revision replaces belongs to another project.", {
          status: 400,
        });
      }
      if (String(target.status) !== "active") {
        throw new DomainConflictError("run_retired", "A run this revision replaces has been retired. Reload the review.");
      }
    }
  }

  // The change this import is. Opened BEFORE the first write, because
  // write_audit() reads it from the transaction: a change set created after
  // them would leave every one belonging to nothing.
  const changeSetId = await openChangeSet(txn, {
    projectId,
    kind: revisedRunIds.length > 0 ? "boq_revision" : "boq_confirm",
    actor,
    sourceIntakeRunId: runId,
  });

  // 4. Allocation, under the lock. `record_no` stays project-wide across runs:
  //    it is the label a person reads, and two records called P17231-014 in
  //    different tabs would be indistinguishable in an export or an email.
  const startRows = await txn`
    select coalesce(max(record_no), 0) as max_no from spec_records where project_id = ${projectId}
  `;
  let nextNo = Number(startRows[0]?.max_no ?? 0);

  const sortRows = await txn`
    select coalesce(max(sort_order), 0) as max_sort from spec_runs where project_id = ${projectId}
  `;
  let nextSort = Number(sortRows[0]?.max_sort ?? 0);
  const runIds: string[] = [];
  const recordIds: string[] = [];
  let imported = 0;
  let updated = 0;
  let retired = 0;

  for (const sheet of sheets as StagedBoqSheet[]) {
    const lines = (sheet.lines as StagedLine[]).filter((line) => !line.ignored);
    if (lines.length === 0) continue;

    const replacesRunId = sheet.replacesRunId ?? null;

    let specRunId: string;
    if (replacesRunId) {
      // ---- A REVISION. The run KEEPS ITS IDENTITY -----------------------
      // Its records keep their ids, and therefore their drawings, their
      // specs, their picture and their checklist answers. That carry-over is
      // the entire point: a revised bill that created a second set of
      // records would strand every bit of work done against the first.
      specRunId = replacesRunId;
      await txn`
        update spec_runs
        set boq_revision = ${sheet.metadata?.revision ?? null},
            boq_date = ${sheet.metadata?.date ?? null},
            header_notes = ${JSON.stringify(sheet.metadata?.notes ?? [])}::jsonb,
            source_import_id = ${runId},
            updated_by = ${actor}
        where id = ${specRunId}
      `;
    } else {
      nextSort += 1;
      // One run per sheet. The reviewer's name for it, not the tab's: a tab
      // called "Feuil1" is not what anybody calls the run.
      const runRow = await txn`
        insert into spec_runs
          (project_id, name, source_sheet, source_import_id, boq_revision, boq_date, header_notes,
           sort_order, created_by, updated_by)
        values
          (${projectId}, ${sheet.proposedRunName.trim() || sheet.sheetName}, ${sheet.sheetName}, ${runId},
           ${sheet.metadata?.revision ?? null}, ${sheet.metadata?.date ?? null},
           ${JSON.stringify(sheet.metadata?.notes ?? [])}::jsonb, ${nextSort}, ${actor}, ${actor})
        returning id
      `;
      specRunId = String(runRow[0]?.id ?? "");
      if (!specRunId) throw new Error(`sheet ${sheet.sheetName} produced no run`);
    }
    runIds.push(specRunId);

    /**
     * Every record this sheet LEAVES LIVE — the ones it carried forward AND
     * the ones it has just created. The retire step below subtracts this from
     * the run's active records, so a new line omitted from it would be
     * inserted and retired by the same confirm.
     */
    const carriedForward = new Set<string>();

    for (const line of lines) {
      // ---- a line the reviewer PAIRED with an existing record -----------
      // Version-predicated, so a record edited since the review refuses the
      // whole confirm rather than silently overwriting somebody's work.
      // Attributes, answers and the item image are NOT touched.
      if (line.replaces) {
        const target = line.replaces;
        // A pairing is only meaningful against the run this sheet revises. A
        // line paired to a record on some OTHER run would move that record
        // between tabs, which is not what a revision does and not what the
        // reviewer was looking at.
        if (!replacesRunId) {
          throw new DomainConflictError(
            "pairing_without_revision",
            `BOQ line ${line.lineNo} is paired to an existing record, but this sheet is not marked as revising a run. Reload the review.`,
          );
        }
        const changed = await txn`
          update spec_records
          set item_description = ${line.itemDescription},
              product_reference = ${line.productReference},
              qty = ${line.qty},
              designer = ${line.designer},
              area = ${line.area ?? line.boqCategory ?? null},
              boq_category = ${line.boqCategory ?? null},
              source_import_id = ${runId},
              source_line_no = ${line.lineNo},
              run_id = ${specRunId},
              -- A REVISION NEVER OVERRIDES A LEVEL SOMEBODY SET. It fills the
              -- gap where there is one: a record carried forward with no level
              -- takes the new bill's reading, and one that already has a level
              -- — decided or suggested — keeps it. Same rule as the category
              -- and the attributes this update deliberately leaves alone.
              level = case
                when spec_records.level is not null then spec_records.level
                else ${levelDecision(line).level}
              end,
              level_suggested = case
                when spec_records.level is not null or spec_records.level_suggested is not null
                  then spec_records.level_suggested
                else ${levelDecision(line).suggested}
              end,
              level_suggested_reason = case
                when spec_records.level is not null or spec_records.level_suggested is not null
                  then spec_records.level_suggested_reason
                else ${levelDecision(line).reason}
              end,
              updated_by = ${actor}
          where id = ${target.recordId}
            and project_id = ${projectId}
            and run_id = ${replacesRunId}
            and status = 'active'
            and version = ${target.recordVersion}
          returning id
        `;
        if (!changed[0]) {
          throw new DomainConflictError(
            "record_changed",
            `The record paired with BOQ line ${line.lineNo} has changed, moved run, or been retired since you reviewed this revision. Nothing was written — reload and check the pairing.`,
          );
        }
        carriedForward.add(target.recordId);
        recordIds.push(target.recordId);

        // The client ref can be re-punctuated between revisions. Refs are
        // write-once-and-delete by design (0002), so the old one goes and the
        // new one is written rather than edited in place.
        if (line.code) {
          await txn`
            delete from spec_record_refs
            where record_id = ${target.recordId} and ref_system = 'boq_code'
              and ref_value_norm <> ${normaliseRef(line.code)}
          `;
          await txn`
            insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
            values (${target.recordId}, ${projectId}, 'boq_code', ${line.code}, ${normaliseRef(line.code)}, 'BOQ revision', ${actor})
            on conflict (record_id, ref_system, ref_value_norm) do nothing
          `;
        }

        updated += 1;
        continue;
      }

      nextNo += 1;
      const recordNo = nextNo;

      // `returning id` rather than re-selecting by record_no: the id is the key,
      // and a follow-up select would be a second chance to pick the wrong row.
      // THE LEVEL GOES IN ONE OF TWO COLUMNS, and which one is the whole
      // point. A level the reviewer picked in the table is a decision and
      // lands in `level`; one this app guessed lands in `level_suggested`,
      // where `questionTier` cannot see it and no gate can rest on it.
      const decided = levelDecision(line);
      const inserted = await txn`
        insert into spec_records
          (project_id, run_id, record_no, status, category_id, item_description, product_reference, qty,
           designer, area, boq_category, level, level_suggested, level_suggested_reason,
           source_import_id, source_line_no, created_by, updated_by)
        values
          (${projectId}, ${specRunId}, ${recordNo}, 'active', ${line.categoryId ?? null}, ${line.itemDescription},
           ${line.productReference}, ${line.qty}, ${line.designer},
           ${line.area ?? line.boqCategory ?? null}, ${line.boqCategory ?? null},
           ${decided.level}, ${decided.suggested}, ${decided.reason},
           ${runId}, ${line.lineNo}, ${actor}, ${actor})
        returning id
      `;
      const recordId = String(inserted[0]?.id ?? "");
      if (!recordId) throw new Error(`line ${line.lineNo} was not inserted`);
      recordIds.push(recordId);
      // A line new to a REVISION is on the run from this moment, and must not
      // be swept up by the retirement of what the revision no longer lists.
      carriedForward.add(recordId);

      if (line.code) {
        await txn`
          insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
          values (${recordId}, ${projectId}, 'boq_code', ${line.code}, ${normaliseRef(line.code)}, 'BOQ import', ${actor})
        `;
      }

      // Only where a category was chosen. An uncategorised record has no
      // questions to be missing — the insert-select below writes nothing for it,
      // and `PATCH /api/records/[id]` writes them when a category is set.
      await txn`
        insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
        select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', ${actor}, ${actor}
        from requirements q
        join spec_records r on r.category_id = q.category_id
        where r.id = ${recordId}
      `;

      imported += 1;
    }

    // ---- what the revision no longer lists ------------------------------
    // RETIRED, NEVER DELETED. A record is the only place a client ref maps to
    // a BWS job, and that job may already exist — deleting the record loses
    // the mapping for work that is already in the factory. It leaves the tabs
    // and the export; it does not leave the history.
    if (replacesRunId) {
      const gone = await txn`
        update spec_records
        set status = 'retired', retired_at = now(), retired_by = ${actor}, updated_by = ${actor}
        where run_id = ${replacesRunId}
          and project_id = ${projectId}
          and status = 'active'
          and not (id = any(${[...carriedForward]}::uuid[]))
        returning id
      `;
      for (const row of gone) recordIds.push(String(row.id));
      retired += gone.length;
    }
  }

  // 5. Predicated on 'parsed' still holding. Zero rows here is a guard result,
  //    not a driver failure, and it must abort the whole import.
  const closed = await txn`
    update intake_runs
    set status = 'confirmed', confirmed_at = now(), updated_by = ${actor}
    where id = ${runId} and status = 'parsed'
    returning id
  `;
  if (!closed[0]) {
    throw new DomainConflictError("already_confirmed", "This import was confirmed by someone else a moment ago.");
  }

  // v1 of every record, LAST: the version has to hold the refs and the answer
  // rows written above it, not the bare row the insert returned.
  await snapshotRecords(txn, recordIds, changeSetId);

  return { imported, updated, retired, projectId, runIds, changeSetId };
}
