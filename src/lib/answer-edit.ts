// Editing one checklist answer, under the optimistic lock and inside a change.
//
// ============================================================================
// WHY THIS MOVED OFF THE HTTP DRIVER.
//
// The single version-predicated UPDATE it does was correct on `sql`, and
// db-transaction.ts used to name this route as the example of something that
// did NOT need a second driver. That changed when every write became part of a
// change set: `write_audit()` reads the change from a transaction-local
// setting, and on the HTTP driver each statement is its own transaction, so
// the setting is gone before the UPDATE it was meant to stamp. A person's edit
// would be the one kind of change with no "why" and no version — the exact
// kind somebody goes looking for.
//
// The UPDATE itself is unchanged, including the 409 that names who changed the
// row first.
//
// ---- WHEN A REASON IS REQUIRED -------------------------------------------
//
// Only when the edit OVERRIDES a settled answer: the value was `confirmed` and
// this changes it. Filling a blank, or answering TBC, needs no explanation —
// the value is the explanation, and a box demanding one on every keystroke
// produces twenty answers all reading "update".
//
// An open change satisfies it. A reviewer working through a client's email
// says so once, attaches the email, and every edit that follows belongs to it.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit, type UploadedEvidence } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import type { AnswerState } from "@/lib/spec-vocab";

export type EditAnswerResult = {
  answer: { id: string; value: string | null; state: string; version: number };
  changeSetId: string;
  attachedToOpenChange: boolean;
  snapshotNo: number | null;
};

export async function editAnswer(
  txn: TxnSql,
  {
    answerId,
    value,
    state,
    expectedVersion,
    reason,
    evidence,
    actor,
  }: {
    answerId: string;
    value: string | null;
    state: AnswerState;
    expectedVersion: number;
    reason?: string | null;
    evidence?: UploadedEvidence | null;
    actor: string;
  },
): Promise<EditAnswerResult> {
  const rows = await txn`
    select a.id, a.record_id, a.value, a.state, a.version, r.project_id, q.prompt
    from spec_answers a
    join spec_records r on r.id = a.record_id
    join requirements q on q.id = a.requirement_id
    where a.id = ${answerId}
    for update of a
  `;
  const existing = rows[0];
  if (!existing) throw new DomainConflictError("not_found", "No such answer.", { status: 404 });

  if (Number(existing.version) !== expectedVersion) {
    throw new DomainConflictError(
      "answer_version_stale",
      `“${String(existing.prompt)}” was changed by someone else while you were editing. Their answer stands; yours was not saved.`,
      { diff: { version: Number(existing.version), state: existing.state, value: existing.value } },
    );
  }

  const settled = String(existing.state) === "confirmed";
  const changing = String(existing.value ?? "") !== String(value ?? "") || String(existing.state) !== state;
  const overriding = settled && changing;

  const { changeSetId, attached } = await changeSetForEdit(txn, {
    projectId: String(existing.project_id),
    actor,
    kind: "manual_edit",
    reason,
    evidence,
  });

  // Checked AFTER the change set is resolved, because an open change is one of
  // the two ways to satisfy it.
  if (overriding && !attached && !reason?.trim()) {
    throw new DomainConflictError(
      "reason_required",
      `“${String(existing.prompt)}” is already confirmed. Say why it is changing, or open a change first — then every edit you make is recorded against it.`,
      { status: 400, diff: { field: "reason", prompt: String(existing.prompt) } },
    );
  }

  const updated = await txn`
    update spec_answers
    set value        = ${value},
        state        = ${state},
        confirmed_by = ${state === "confirmed" ? actor : null},
        confirmed_at = ${state === "confirmed" ? new Date().toISOString() : null},
        -- THE EDIT TAKES OWNERSHIP. An answer filled from a drawing carries
        -- source_kind 'document' and the run that wrote it, and that pair is
        -- exactly what tells promote-answers.ts it may recompose the row as
        -- later slots arrive. The moment a person edits it, it stops being
        -- that row: marking it 'manual' is what stops the next confirmed
        -- drawing overwriting what they typed.
        source_kind  = 'manual',
        source_id    = null,
        updated_by   = ${actor}
    where id = ${answerId} and version = ${expectedVersion}
    returning id, value, state, version
  `;
  const answer = updated[0];
  if (!answer) {
    throw new DomainConflictError(
      "answer_version_stale",
      `“${String(existing.prompt)}” changed as you saved. Nothing was written — reload.`,
    );
  }

  const snapshots = await snapshotRecords(txn, [String(existing.record_id)], changeSetId);

  return {
    answer: {
      id: String(answer.id),
      value: answer.value === null || answer.value === undefined ? null : String(answer.value),
      state: String(answer.state),
      version: Number(answer.version),
    },
    changeSetId,
    attachedToOpenChange: attached,
    snapshotNo: snapshots.get(String(existing.record_id)) ?? null,
  };
}
