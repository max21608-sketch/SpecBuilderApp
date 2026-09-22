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
  answer: { id: string; value: string | null; qualifier: string | null; state: string; version: number };
  changeSetId: string;
  attachedToOpenChange: boolean;
  snapshotNo: number | null;
};

export async function editAnswer(
  txn: TxnSql,
  {
    answerId,
    value,
    qualifier,
    state,
    expectedVersion,
    reason,
    evidence,
    actor,
    changeSetId: attachTo,
    snapshot = true,
  }: {
    answerId: string;
    value: string | null;
    /** Where on the item it goes (0029). Undefined leaves what is there. */
    qualifier?: string | null;
    state: AnswerState;
    expectedVersion: number;
    reason?: string | null;
    evidence?: UploadedEvidence | null;
    actor: string;
    /**
     * An ALREADY OPEN change to attach this edit to, instead of opening one.
     *
     * For a caller that answers several questions as ONE act — applying one
     * value to the items a by-question heading lists. Without it every answer
     * opens its own change set and 26 items answered in one press become 26
     * entries in the project trail, which is the failure `editFinish` names in
     * the same words and `acceptSuggestedLevels` avoids by calling
     * `changeSetForEdit` once. The caller owns the change and the reason on it.
     *
     * Supplying one also SATISFIES the reason rule, exactly as an open change
     * does on the single-edit path: the "why" is on the change, not on the row.
     * A caller that means to override settled answers therefore has to have
     * decided that deliberately — `POST /answers/apply` does not, and skips
     * every settled row rather than passing the decision down here.
     */
    changeSetId?: string;
    /**
     * FALSE where the CALLER will version the records itself.
     *
     * `snapshotRecords` batches: one lock, one `loadRecordAtoms` over every
     * record, then two statements each. Called per answer it re-locks and
     * re-loads the whole time — measured on the sandbox, 2026-09-22, at 13.6s
     * for 26 answers in one press, which is a screen somebody stops using.
     * A batch caller passes false and calls it ONCE with every record it
     * touched, which is the same version and a tenth of the round trips.
     *
     * A caller that passes false and then forgets is caught by
     * `tests/db/change-history.test.ts`, which reads the WHOLE database and
     * fails any change set with spec-content audit rows and no version.
     */
    snapshot?: boolean;
  },
): Promise<EditAnswerResult> {
  const rows = await txn`
    select a.id, a.record_id, a.value, a.qualifier, a.state, a.version, r.project_id, q.prompt
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

  const nextQualifier =
    qualifier === undefined ? (existing.qualifier === null || existing.qualifier === undefined ? null : String(existing.qualifier)) : (qualifier?.trim() || null);

  const settled = String(existing.state) === "confirmed";
  const changing =
    String(existing.value ?? "") !== String(value ?? "") ||
    String(existing.qualifier ?? "") !== String(nextQualifier ?? "") ||
    String(existing.state) !== state;
  const overriding = settled && changing;

  const { changeSetId, attached } = attachTo
    ? { changeSetId: attachTo, attached: true }
    : await changeSetForEdit(txn, {
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
        qualifier    = ${nextQualifier},
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
    returning id, value, qualifier, state, version
  `;
  const answer = updated[0];
  if (!answer) {
    throw new DomainConflictError(
      "answer_version_stale",
      `“${String(existing.prompt)}” changed as you saved. Nothing was written — reload.`,
    );
  }

  const snapshots = snapshot
    ? await snapshotRecords(txn, [String(existing.record_id)], changeSetId)
    : new Map<string, number>();

  return {
    answer: {
      id: String(answer.id),
      value: answer.value === null || answer.value === undefined ? null : String(answer.value),
      qualifier: answer.qualifier === null || answer.qualifier === undefined ? null : String(answer.qualifier),
      state: String(answer.state),
      version: Number(answer.version),
    },
    changeSetId,
    attachedToOpenChange: attached,
    snapshotNo: snapshots.get(String(existing.record_id)) ?? null,
  };
}
