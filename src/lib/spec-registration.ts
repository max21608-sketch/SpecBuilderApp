// Registering a specification document's intake run, and dispatching its read.
//
// ============================================================================
// ONE PROTOCOL, TWO CALLERS.
//
// `/api/imports` registers every uploaded specification document here, and
// `/api/imports/[id]/read-specifications` registers a confirmed bill's OWN
// stored file as one (plan any-bill, Step 2.5). The second must not be a copy of
// the first: the idempotency check, the per-pack read cap and the
// commit-then-publish order are the rules about when a paid call may be
// claimed, and two copies of them is two sets of those rules.
//
//   * The idempotency check and the insert are in ONE transaction, so two
//     deliveries of the same retried request cannot both insert.
//   * At most three of one pack read at once; over the cap the run is
//     DEFERRED, promised and not started (`deferRead`), never refused.
//   * The attempt is opened in the SAME transaction as the insert, and
//     published only after the commit (`dispatchRegisteredRead`) — a queue
//     publish is network I/O and a transaction must never be held across it.
// ============================================================================
import { randomUUID } from "node:crypto";
import type { TxnSql } from "@/lib/db-transaction";
import type { DocumentKind } from "@/lib/spec-vocab";
import { openAttempt, publishAttempt } from "@/lib/extraction-dispatch";
import { takeReadSlot, deferRead, WAITING_FOR_SLOT_MESSAGE } from "@/lib/extraction-slots";

export type SpecRunRegistration =
  | { importId: string; reused: true; attemptId?: undefined }
  | { importId: string; reused: false; attemptId: string | null };

/**
 * The run, inserted and (cap permitting) queued. `attach` produces the
 * attachment the run reads — an upload inserts a new one, a bill hands over the
 * one it was parsed from — and is called only when the request is not a replay.
 */
export async function insertSpecDocumentRun(
  txn: TxnSql,
  input: {
    projectId: string;
    batchId: string | null;
    documentKind: DocumentKind;
    registrationRequestId: string | null;
    actor: string;
    attach: () => Promise<string>;
  },
): Promise<SpecRunRegistration> {
  if (input.registrationRequestId) {
    const existing = await txn`
      select id from intake_runs where registration_request_id = ${input.registrationRequestId}
    `;
    if (existing[0]) return { importId: String(existing[0].id), reused: true };
  }

  const attachmentId = await input.attach();
  const run = await txn`
    insert into intake_runs
      (project_id, attachment_id, batch_id, source_kind, document_kind, status,
       registration_request_id, created_by, updated_by)
    values (${input.projectId}, ${attachmentId}, ${input.batchId}, 'spec_document',
            ${input.documentKind}, 'pending', ${input.registrationRequestId}, ${input.actor}, ${input.actor})
    returning id
  `;
  if (!run[0]) throw new Error("the import was not recorded");
  const importId = String(run[0].id);

  const scope = { projectId: input.projectId, batchId: input.batchId };
  if (!(await takeReadSlot(txn, scope))) {
    await deferRead(txn, importId, input.actor);
    return { importId, attemptId: null, reused: false };
  }
  const opened = await openAttempt(txn, importId, randomUUID(), input.actor, "pending");
  if (!opened) throw new Error("the import was recorded but could not be queued for reading");
  return { importId, attemptId: opened, reused: false };
}

/** What the registration's 201 says about its read. */
export type AutoRead =
  | { dispatched: true }
  | { dispatched: false; waiting: true; note: string }
  | { dispatched: false; code: string; error: string };

/**
 * After the commit: publish the attempt, or say it is waiting for a slot.
 * `waiting`, never `error`: a deferred read needs nobody, where a dispatch
 * failure needs a Retry, and painting the first red teaches people to ignore
 * the second.
 */
export async function dispatchRegisteredRead(
  registered: Extract<SpecRunRegistration, { reused: false }>,
  actor: string,
): Promise<AutoRead> {
  if (!registered.attemptId) return { dispatched: false, waiting: true, note: WAITING_FOR_SLOT_MESSAGE };
  const failure = await publishAttempt(registered.importId, registered.attemptId, actor);
  return failure ? { dispatched: false, code: failure.code, error: failure.error } : { dispatched: true };
}
