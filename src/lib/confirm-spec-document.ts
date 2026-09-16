// Promoting reviewed extraction proposals into canonical spec answers.
//
// ============================================================================
// THE RECORD IS THE UNIT OF COMMIT.
//
// One request names ONE record and every one of its currently pending assigned
// proposals, each with the version the reviewer was looking at. The server
// checks that set against the live grouping — so a proposal added or retargeted
// into this record since the page loaded makes the request fail rather than
// letting it commit a card the reviewer never saw whole.
//
// Any failure rolls back EVERYTHING. A half-applied card — three finishes
// written, the fourth refused — is worse than a refused one: it looks finished,
// and the missing one is invisible until someone notices the answer is wrong.
//
// NO MATCHING IS RE-RUN HERE. What gets written is what the reviewer approved.
// A fresh match at confirm time could write something they never saw, which is
// the failure the review-and-confirm skill exists to prevent.
//
// REVIEWED PROPOSALS STAY IN `lines` with their reviewStatus flipped. Nothing
// is compacted or removed, which is what makes ids stable, restore trivial, and
// "the proposal at index 4" a phrase nobody has to say.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import {
  hasPendingProposals,
  proposalBlockers,
  type Proposal,
  type StagedSpecDocument,
} from "@/lib/spec-document";

export type ProposalRef = { id: string; version: number };

export type SpecDocumentConfirmResult = {
  applied: number;
  ignored: number;
  restored: number;
  remainingPending: number;
  status: string;
};

type LoadedRun = {
  runId: string;
  projectId: string;
  staged: StagedSpecDocument;
  actor: string;
};

/** The run, locked, with its staged proposals read from the LOCKED row. */
async function loadRun(txn: TxnSql, runId: string, expectedVersion: number | null): Promise<Omit<LoadedRun, "actor">> {
  const rows = await txn`
    select id, project_id, status, parsed, version, source_kind
    from intake_runs where id = ${runId}
    for update
  `;
  const run = rows[0];
  if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  if (run.source_kind !== "spec_document") {
    throw new DomainConflictError("wrong_kind", "That import is not a specification document.", { status: 400 });
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

  const staged = (run.parsed ?? null) as StagedSpecDocument | null;
  if (!staged || !Array.isArray(staged.lines)) {
    throw new DomainConflictError("not_staged", "This import has nothing staged to review.");
  }
  return { runId: String(run.id), projectId: String(run.project_id), staged };
}

/** Locate by id, never by position. Array index is display order, not identity. */
function takePending(staged: StagedSpecDocument, refs: ProposalRef[], allow: Proposal["reviewStatus"][]): Proposal[] {
  const taken: Proposal[] = [];
  for (const ref of refs) {
    const proposal = staged.lines.find((line) => line.id === ref.id);
    if (!proposal) {
      throw new DomainConflictError("proposal_missing", "One of these rows is no longer part of this import. Reload.");
    }
    if (!allow.includes(proposal.reviewStatus)) {
      throw new DomainConflictError(
        "proposal_reviewed",
        `“${proposal.raw.attributeRaw ?? "That row"}” has already been ${proposal.reviewStatus}. Reload to see the current state.`,
      );
    }
    if (proposal.version !== ref.version) {
      throw new DomainConflictError(
        "proposal_version_stale",
        `“${proposal.raw.attributeRaw ?? "One of these rows"}” was edited in another tab. Reload before confirming.`,
      );
    }
    taken.push(proposal);
  }
  return taken;
}

async function writeStaged(txn: TxnSql, run: Omit<LoadedRun, "actor">, actor: string, lines: Proposal[]): Promise<string> {
  const staged: StagedSpecDocument = { ...run.staged, lines };
  // A run reopens when something becomes pending again, and completes when
  // nothing is. `confirmed` here means NO PENDING PROPOSALS REMAIN -- applied
  // or explicitly ignored. It does not mean every answer is settled, which is
  // why the screen labels it "Review complete".
  const status = hasPendingProposals(lines) ? "parsed" : "confirmed";
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

// ---- confirm ---------------------------------------------------------------

export async function confirmSpecDocumentRecord(
  txn: TxnSql,
  {
    runId,
    expectedVersion,
    recordId,
    proposals: refs,
    actor,
  }: { runId: string; expectedVersion: number | null; recordId: string; proposals: ProposalRef[]; actor: string },
): Promise<SpecDocumentConfirmResult> {
  if (refs.length === 0) {
    throw new DomainConflictError("nothing_to_confirm", "There is nothing to confirm on this record.", { status: 400 });
  }

  const run = await loadRun(txn, runId, expectedVersion);
  const chosen = takePending(run.staged, refs, ["pending"]);

  // The whole card, or nothing. If the live set of pending proposals for this
  // record is not exactly what was submitted, the reviewer is looking at a
  // different card than the one they are about to commit.
  const livePending = run.staged.lines.filter(
    (line) => line.reviewStatus === "pending" && line.recordId === recordId,
  );
  const submitted = new Set(refs.map((ref) => ref.id));
  if (livePending.length !== submitted.size || livePending.some((line) => !submitted.has(line.id))) {
    throw new DomainConflictError(
      "card_changed",
      "The rows on this record changed while you were reviewing. Reload before confirming.",
    );
  }
  if (chosen.some((proposal) => proposal.recordId !== recordId)) {
    throw new DomainConflictError("wrong_record", "One of these rows belongs to a different record. Reload.");
  }

  // Blockers, recomputed from the LIVE set. They are never stored: a retarget
  // clears an acknowledgement and a clash appears and disappears as other rows
  // move, so a blocker frozen at extraction time would be stale by the first edit.
  for (const proposal of chosen) {
    const blockers = proposalBlockers(proposal, run.staged.lines);
    if (blockers.length > 0) {
      throw new DomainConflictError("blocked", blockers[0]?.message ?? "That row cannot be confirmed yet.", {
        diff: { proposalId: proposal.id, blockers },
      });
    }
  }

  // The record, locked. FOR UPDATE (not FOR NO KEY UPDATE) because this
  // operation depends on the ABSENCE of an answer -- it must also block the
  // child insert that would take the parent's key lock.
  const records = await txn`
    select id, project_id, category_id, status, version
    from spec_records where id = ${recordId}
    for update
  `;
  const record = records[0];
  if (!record) throw new DomainConflictError("record_missing", "That spec record no longer exists.", { status: 404 });
  if (String(record.project_id) !== run.projectId) {
    throw new DomainConflictError("wrong_project", "That record belongs to a different project.", { status: 400 });
  }
  if (record.status !== "active") {
    throw new DomainConflictError("record_inactive", "That spec record is no longer active.");
  }

  // Opened before the first answer is written: write_audit() reads the change
  // from the transaction, so one created afterwards would leave every row it
  // covers belonging to nothing.
  const changeSetId = await openChangeSet(txn, {
    projectId: run.projectId,
    kind: "spec_document_confirm",
    actor,
    reason: `${chosen.length} answer${chosen.length === 1 ? "" : "s"} from ${run.staged.filename ?? "a specification document"}`,
    sourceIntakeRunId: run.runId,
  });

  const applied = new Map<string, Proposal["applied"]>();

  for (const proposal of chosen) {
    const target = proposal.target;
    if (!target) throw new DomainConflictError("blocked", "That row has no target.");

    // The question must belong to THIS record's category. Revalidated rather
    // than trusted: the staged snapshot was taken minutes or days ago.
    const requirements = await txn`
      select id, spec_field_id, prompt from requirements
      where id = ${target.requirementId} and category_id = ${record.category_id}
    `;
    const requirement = requirements[0];
    if (!requirement) {
      throw new DomainConflictError(
        "requirement_mismatch",
        "That question does not belong to this item's category any more. Reload and choose again.",
      );
    }

    const state = proposal.proposedState;
    if (state === null) throw new DomainConflictError("blocked", "That row has no state.");
    const value = state === "na" ? null : (proposal.proposedValue ?? "").trim() || null;
    if (state === "confirmed" && !value) {
      throw new DomainConflictError("blocked", "A confirmed answer needs a value.");
    }

    // `confirmed_by`/`confirmed_at` ONLY for a settled `confirmed`, matching
    // /api/answers/[id] and spec_answers_confirmed_needs_actor. Who accepted a
    // TBC observation is recorded on the proposal, not on the answer.
    const confirmedBy = state === "confirmed" ? actor : null;
    const confirmedAt = state === "confirmed" ? new Date().toISOString() : null;

    let answerId: string;
    let answerVersion: number;

    if (target.answerExists && target.answerId) {
      const updated = await txn`
        update spec_answers
        set value        = ${value},
            value_raw    = coalesce(value_raw, ${proposal.raw.valueRaw}),
            state        = ${state},
            source_kind  = 'document',
            source_id    = ${run.runId},
            confirmed_by = ${confirmedBy},
            confirmed_at = ${confirmedAt},
            updated_by   = ${actor}
        where id = ${target.answerId} and version = ${target.answerVersion}
        returning id, version
      `;
      if (updated.length !== 1) {
        // Exactly one row, or this is not the answer that was reviewed.
        throw new DomainConflictError(
          "answer_version_stale",
          `“${String(requirement.prompt)}” was answered by someone else while you were reviewing. Nothing was written — reload.`,
        );
      }
      answerId = String(updated[0]?.id);
      answerVersion = Number(updated[0]?.version);
    } else {
      // The acknowledged ABSENCE must still hold. The parent record lock plus
      // spec_answers_record_requirement_key are what make that safe; `on
      // conflict do nothing` turns a violated assumption into zero rows, which
      // the count check below reports rather than swallowing.
      const inserted = await txn`
        insert into spec_answers
          (record_id, requirement_id, spec_field_id, revision_no, value, value_raw, state,
           source_kind, source_id, confirmed_by, confirmed_at, created_by, updated_by)
        values
          (${recordId}, ${target.requirementId}, ${requirement.spec_field_id}, 0, ${value},
           ${proposal.raw.valueRaw}, ${state}, 'document', ${run.runId}, ${confirmedBy}, ${confirmedAt},
           ${actor}, ${actor})
        on conflict (record_id, requirement_id, revision_no) do nothing
        returning id, version
      `;
      if (inserted.length !== 1) {
        throw new DomainConflictError(
          "answer_appeared",
          `“${String(requirement.prompt)}” was answered by someone else while you were reviewing. Nothing was written — reload.`,
        );
      }
      answerId = String(inserted[0]?.id);
      answerVersion = Number(inserted[0]?.version);
    }

    applied.set(proposal.id, { answerId, answerVersion, value, state });
  }

  const now = new Date().toISOString();
  const lines = run.staged.lines.map((line) => {
    const result = applied.get(line.id);
    if (!result) return line;
    return { ...line, reviewStatus: "applied" as const, reviewedAt: now, reviewedBy: actor, applied: result, version: line.version + 1 };
  });

  const status = await writeStaged(txn, run, actor, lines);

  await snapshotRecords(txn, [recordId], changeSetId);

  await txn`
    insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
    values ('intake_run', ${run.runId}, 'parsed', ${status}, ${actor},
            ${`Applied ${applied.size} extracted answer${applied.size === 1 ? "" : "s"} to one record`})
  `;

  return {
    applied: applied.size,
    ignored: 0,
    restored: 0,
    remainingPending: lines.filter((line) => line.reviewStatus === "pending").length,
    status,
  };
}

// ---- ignore and restore ----------------------------------------------------

export async function ignoreSpecDocumentProposals(
  txn: TxnSql,
  { runId, expectedVersion, proposals: refs, actor }: { runId: string; expectedVersion: number | null; proposals: ProposalRef[]; actor: string },
): Promise<SpecDocumentConfirmResult> {
  const run = await loadRun(txn, runId, expectedVersion);
  const chosen = takePending(run.staged, refs, ["pending"]);
  const ids = new Set(chosen.map((proposal) => proposal.id));
  const now = new Date().toISOString();

  // No answer is written. Ignoring says "the document said this and it is not
  // worth recording", which is a review decision, not a specification one.
  const lines = run.staged.lines.map((line) =>
    ids.has(line.id)
      ? { ...line, reviewStatus: "ignored" as const, reviewedAt: now, reviewedBy: actor, version: line.version + 1 }
      : line,
  );
  const status = await writeStaged(txn, run, actor, lines);
  return {
    applied: 0,
    ignored: ids.size,
    restored: 0,
    remainingPending: lines.filter((line) => line.reviewStatus === "pending").length,
    status,
  };
}

export async function restoreSpecDocumentProposals(
  txn: TxnSql,
  { runId, expectedVersion, proposals: refs, actor }: { runId: string; expectedVersion: number | null; proposals: ProposalRef[]; actor: string },
): Promise<SpecDocumentConfirmResult> {
  const run = await loadRun(txn, runId, expectedVersion);
  // IGNORED ONLY. An `applied` proposal is immutable history: restoring it
  // would imply undoing an answer, and this route does not undo answers. An
  // answer is edited on the record screen, by a person, on purpose.
  const chosen = takePending(run.staged, refs, ["ignored"]);
  const ids = new Set(chosen.map((proposal) => proposal.id));
  const now = new Date().toISOString();

  const lines = run.staged.lines.map((line) =>
    ids.has(line.id)
      ? {
          ...line,
          reviewStatus: "pending" as const,
          reviewedAt: now,
          reviewedBy: actor,
          // The acknowledgement was about a value that may have moved since.
          overwriteAcknowledged: false,
          version: line.version + 1,
        }
      : line,
  );
  // Reopens a completed run: writeStaged puts it back to 'parsed' because
  // something is pending again.
  const status = await writeStaged(txn, run, actor, lines);
  return {
    applied: 0,
    ignored: 0,
    restored: ids.size,
    remainingPending: lines.filter((line) => line.reviewStatus === "pending").length,
    status,
  };
}
