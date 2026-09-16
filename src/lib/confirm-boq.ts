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
import { assertBoqV2, normaliseRef, type StagedBoqSheet } from "@/lib/boq-import";
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
  ignored: boolean;
};

export type ConfirmBoqResult = { imported: number; projectId: string; runIds: string[]; changeSetId: string };

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

  // The change this import is. Opened BEFORE the first insert, because
  // write_audit() reads it from the transaction: a change set created after
  // the writes would leave every one of them belonging to nothing.
  const changeSetId = await openChangeSet(txn, {
    projectId,
    kind: "boq_confirm",
    actor,
    sourceIntakeRunId: runId,
  });

  const parsed = assertBoqV2(run.parsed);
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

  for (const sheet of sheets as StagedBoqSheet[]) {
    const lines = (sheet.lines as StagedLine[]).filter((line) => !line.ignored);
    if (lines.length === 0) continue;

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
    const specRunId = String(runRow[0]?.id ?? "");
    if (!specRunId) throw new Error(`sheet ${sheet.sheetName} produced no run`);
    runIds.push(specRunId);

    for (const line of lines) {
      nextNo += 1;
      const recordNo = nextNo;

      // `returning id` rather than re-selecting by record_no: the id is the key,
      // and a follow-up select would be a second chance to pick the wrong row.
      const inserted = await txn`
        insert into spec_records
          (project_id, run_id, record_no, status, category_id, item_description, product_reference, qty,
           designer, area, boq_category, source_import_id, source_line_no, created_by, updated_by)
        values
          (${projectId}, ${specRunId}, ${recordNo}, 'active', ${line.categoryId ?? null}, ${line.itemDescription},
           ${line.productReference}, ${line.qty}, ${line.designer},
           ${line.area ?? line.boqCategory ?? null}, ${line.boqCategory ?? null},
           ${runId}, ${line.lineNo}, ${actor}, ${actor})
        returning id
      `;
      const recordId = String(inserted[0]?.id ?? "");
      if (!recordId) throw new Error(`line ${line.lineNo} was not inserted`);
      recordIds.push(recordId);

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

  return { imported, projectId, runIds, changeSetId };
}
