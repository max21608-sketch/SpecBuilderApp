// "Also read its furniture as an FF&E schedule" — a finishes schedule's SAME
// file, read a second time for its items. One charged read, stated on the
// button that calls this.
//
// ============================================================================
// THE AMAN TRACKER IS TWO DOCUMENTS IN ONE FILE (2026-10-05). `260824 - OMS
// and FF&E Tracker.pdf` is a finishes schedule on pages 1–7 and a FURNITURE
// schedule on pages 8–14, one row per FUR code with its maker, upholstery,
// finish, size, link and approval. The finishes schedule's read leaves the
// furniture out on purpose (its prompt says a sofa is an item, not a finish).
// So the furniture is read as what it is — an `ffe_schedule` — over the SAME
// stored file, in the SAME pack, through the registration protocol every
// uploaded document uses (`insertSpecDocumentRun`): the attempt opened in the
// insert's transaction, published after the commit, deferred at the pack's
// cap rather than refused.
//
// IDEMPOTENT BY CONSTRUCTION, the bill's own read's rule: the request id is
// derived from the finishes run (`ffe-of:<runId>`), so a second press — another
// tab, a double click, a retry — returns the run the first one made and
// publishes nothing.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { insertSpecDocumentRun, type SpecRunRegistration } from "@/lib/spec-registration";

export const FURNITURE_READ_PREFIX = "ffe-of:";

export function furnitureReadRequestId(finishesRunId: string): string {
  return `${FURNITURE_READ_PREFIX}${finishesRunId}`;
}

export async function registerTrackerFurniture(
  txn: TxnSql,
  { finishesRunId, actor }: { finishesRunId: string; actor: string },
): Promise<SpecRunRegistration> {
  const rows = await txn`
    select id, project_id, batch_id, source_kind, document_kind, attachment_id
    from intake_runs where id = ${finishesRunId}
    for update
  `;
  const run = rows[0];
  if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  if (run.source_kind !== "spec_document" || run.document_kind !== "finishes_schedule") {
    throw new DomainConflictError(
      "wrong_kind",
      "Only a finishes schedule is read again for its furniture this way.",
      { status: 400 },
    );
  }
  if (!run.attachment_id) {
    throw new DomainConflictError(
      "source_not_kept",
      "The original of this schedule was not kept, so its furniture cannot be read. Upload the file again as an FF&E schedule.",
    );
  }
  return insertSpecDocumentRun(txn, {
    projectId: String(run.project_id),
    batchId: run.batch_id === null || run.batch_id === undefined ? null : String(run.batch_id),
    documentKind: "ffe_schedule",
    registrationRequestId: furnitureReadRequestId(finishesRunId),
    actor,
    // THE SAME STORED FILE, not a copy: a proposal is checked against the
    // pages the finishes were read from.
    attach: async () => String(run.attachment_id),
  });
}
