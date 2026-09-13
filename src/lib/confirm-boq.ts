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
import { normaliseRef } from "@/lib/boq-import";

type StagedLine = {
  index: number;
  lineNo: number;
  designer: string | null;
  boqCategory: string | null;
  code: string | null;
  itemDescription: string;
  productReference: string | null;
  qty: number | null;
  categoryId: string | null;
  ignored: boolean;
};

export type ConfirmBoqResult = { imported: number; projectId: string };

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

  const parsed = (run.parsed ?? null) as { lines: StagedLine[] } | null;
  const lines = (parsed?.lines ?? []).filter((line) => !line.ignored);
  if (lines.length === 0) {
    throw new DomainConflictError("nothing_to_import", "Every line is ignored — there is nothing to import.", {
      status: 400,
    });
  }

  // 3. Re-checked server-side against live rows. NO MATCHING IS RE-RUN: what
  //    gets written is what the reviewer approved, not what a fresh match would
  //    produce now.
  const categories = await txn`select id from item_categories`;
  const known = new Set(categories.map((row) => String(row.id)));
  const uncategorised = lines.filter((line) => !line.categoryId || !known.has(line.categoryId));
  if (uncategorised.length > 0) {
    throw new DomainConflictError(
      "uncategorised",
      `${uncategorised.length} line${uncategorised.length === 1 ? "" : "s"} still need a category. A record with no category cannot be measured for completeness.`,
      { diff: uncategorised.map((line) => ({ index: line.index, lineNo: line.lineNo, code: line.code })) },
    );
  }

  // 4. Allocation, under the lock.
  const startRows = await txn`
    select coalesce(max(record_no), 0) as max_no from spec_records where project_id = ${projectId}
  `;
  let nextNo = Number(startRows[0]?.max_no ?? 0);

  for (const line of lines) {
    nextNo += 1;
    const recordNo = nextNo;

    // `returning id` rather than re-selecting by record_no: the id is the key,
    // and a follow-up select would be a second chance to pick the wrong row.
    const inserted = await txn`
      insert into spec_records
        (project_id, record_no, status, category_id, item_description, product_reference, qty,
         designer, area, source_import_id, source_line_no, created_by, updated_by)
      values
        (${projectId}, ${recordNo}, 'active', ${line.categoryId}, ${line.itemDescription},
         ${line.productReference}, ${line.qty}, ${line.designer}, ${line.boqCategory},
         ${runId}, ${line.lineNo}, ${actor}, ${actor})
      returning id
    `;
    const recordId = String(inserted[0]?.id ?? "");
    if (!recordId) throw new Error(`line ${line.lineNo} was not inserted`);

    if (line.code) {
      await txn`
        insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
        values (${recordId}, ${projectId}, 'boq_code', ${line.code}, ${normaliseRef(line.code)}, 'BOQ import', ${actor})
      `;
    }

    await txn`
      insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
      select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', ${actor}, ${actor}
      from requirements q
      join spec_records r on r.category_id = q.category_id
      where r.id = ${recordId}
    `;

    await txn`
      insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
      values ('spec_record', ${recordId}, null, 'active', ${actor}, ${`Imported from BOQ line ${line.lineNo}`})
    `;
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

  return { imported: lines.length, projectId };
}
