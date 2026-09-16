// Retiring a run, and everything on it.
//
// ============================================================================
// WHY A RUN CAN BE RETIRED AT ALL.
//
// 0007's own header says re-uploading a revised BOQ "legitimately produces a
// second MAIN RUN; retiring the old one is how it leaves the tabs" — and until
// now nothing in this app could. There was no `update spec_runs` anywhere in
// src/, so a duplicated run was permanent.
//
// A revision usually does not need this: 0017 lets a revised sheet REPLACE a
// run in place, keeping every record's drawings and answers. Retiring is for
// the other case — a run that was created by mistake, a sub-quote the client
// dropped, or the duplicate a pre-0017 re-upload left behind.
//
// ---- THE CASCADE IS CROSS-TABLE, SO CODE HAS TO ASSERT IT ---------------
//
// `spec_records.status` does not follow `spec_runs.status`, and no constraint
// can make it: they are different rows in different tables. Before 0017's
// export change, a retired run's records stayed in the export — a file that
// re-imports a sub-quote the project has moved on from. So this retires every
// record on the run and then CHECKS that none is left active before the
// transaction commits. A count, not a hope.
//
// Reversible, like every other dismissal here. Restoring brings the run back
// with the records it retired at the same moment, and nothing else — a record
// retired earlier, for its own reason, stays retired.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";

export type RetireRunResult = { runId: string; recordsRetired: number; changeSetId: string };

export async function retireRun(
  txn: TxnSql,
  {
    projectId,
    runId,
    reason,
    replacedByRunId,
    actor,
  }: { projectId: string; runId: string; reason: string; replacedByRunId?: string | null; actor: string },
): Promise<RetireRunResult> {
  // The project row, so no import can interleave and add a record to a run
  // this is in the middle of emptying.
  const projects = await txn`select id from projects where id = ${projectId} for update`;
  if (!projects[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });

  const runs = await txn`
    select id, project_id, name, status from spec_runs where id = ${runId} for update
  `;
  const run = runs[0];
  if (!run) throw new DomainConflictError("not_found", "No such run.", { status: 404 });
  if (String(run.project_id) !== projectId) {
    throw new DomainConflictError("wrong_project", "That run belongs to another project.", { status: 400 });
  }
  if (String(run.status) !== "active") {
    throw new DomainConflictError("already_retired", "That run has already been retired. Reload.");
  }

  if (replacedByRunId) {
    const replacement = await txn`
      select id, status from spec_runs where id = ${replacedByRunId} and project_id = ${projectId}
    `;
    if (!replacement[0]) {
      throw new DomainConflictError("replacement_missing", "The run you named as its replacement is not on this project.", {
        status: 400,
      });
    }
  }

  const changeSetId = await openChangeSet(txn, {
    projectId,
    kind: "run_retire",
    actor,
    reason,
  });

  const retired = await txn`
    update spec_records
    set status = 'retired', retired_at = now(), retired_by = ${actor}, updated_by = ${actor}
    where run_id = ${runId} and project_id = ${projectId} and status = 'active'
    returning id
  `;

  await txn`
    update spec_runs
    set status = 'retired', retired_at = now(), retired_by = ${actor},
        replaced_by_run_id = ${replacedByRunId ?? null}, updated_by = ${actor}
    where id = ${runId} and status = 'active'
  `;

  // The assertion no constraint can make. A run marked retired with a live
  // record still on it would ship that record in the project export, which is
  // the failure this whole path exists to prevent.
  const left = await txn`
    select count(*)::int as n from spec_records where run_id = ${runId} and status = 'active'
  `;
  if (Number(left[0]?.n ?? 0) > 0) {
    throw new DomainConflictError(
      "records_still_active",
      "Something added a record to this run while it was being retired. Nothing was written — try again.",
    );
  }

  await snapshotRecords(
    txn,
    retired.map((row) => String(row.id)),
    changeSetId,
  );

  return { runId, recordsRetired: retired.length, changeSetId };
}

export async function restoreRun(
  txn: TxnSql,
  { projectId, runId, reason, actor }: { projectId: string; runId: string; reason: string; actor: string },
): Promise<RetireRunResult> {
  const projects = await txn`select id from projects where id = ${projectId} for update`;
  if (!projects[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });

  const runs = await txn`
    select id, project_id, status, retired_at, replaced_by_run_id from spec_runs where id = ${runId} for update
  `;
  const run = runs[0];
  if (!run) throw new DomainConflictError("not_found", "No such run.", { status: 404 });
  if (String(run.project_id) !== projectId) {
    throw new DomainConflictError("wrong_project", "That run belongs to another project.", { status: 400 });
  }
  if (String(run.status) !== "retired") {
    throw new DomainConflictError("not_retired", "That run is already on the project.");
  }
  if (run.replaced_by_run_id) {
    throw new DomainConflictError(
      "superseded",
      "Another run replaced this one. Bringing it back would leave the project quoting the same codes twice with nothing to say which is live.",
    );
  }

  const changeSetId = await openChangeSet(txn, { projectId, kind: "run_retire", actor, reason });

  // Only the records retired AT THE SAME MOMENT. A record retired earlier, for
  // its own reason, stays retired — restoring a run must not quietly undo a
  // decision somebody made about one item.
  const restored = await txn`
    update spec_records
    set status = 'active', retired_at = null, retired_by = null, updated_by = ${actor}
    where run_id = ${runId} and status = 'retired' and retired_at = ${run.retired_at}
    returning id
  `;

  await txn`
    update spec_runs
    set status = 'active', retired_at = null, retired_by = null, updated_by = ${actor}
    where id = ${runId} and status = 'retired'
  `;

  await snapshotRecords(
    txn,
    restored.map((row) => String(row.id)),
    changeSetId,
  );

  return { runId, recordsRetired: restored.length, changeSetId };
}
