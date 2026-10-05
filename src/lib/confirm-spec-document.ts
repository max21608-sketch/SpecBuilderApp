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
import { applyAnswerFills, applyAnswerRetractions, loadDimensionNote, planAnswerFills } from "@/lib/promote-answers";
import { loadPromotable } from "@/lib/attribute-retire";
import {
  annotateHeld,
  hasPendingProposals,
  heldReading,
  proposalBlockers,
  type AttributeEntry,
  type Proposal,
  type StagedSpecDocument,
} from "@/lib/spec-document";
import { loadBillHeldIds } from "@/lib/attribute-from-bill";
import { recordDisagreement, type DisagreementStatement } from "@/lib/disagreement-record";
import { isDimensionSlot, normaliseUnit, type AttributeGroup, type AttributeState, type DimensionSlot } from "@/lib/spec-vocab";

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
  documentKind: string | null;
  actor: string;
};

/**
 * What a confirm records, and where the answers say they came from.
 *
 * Taken from the RUN ROW, never from the request: the client does not choose
 * which pipeline its confirm is treated as. An email and a schedule differ in
 * three ways and no others — the kind of change recorded, the `source_kind`
 * written onto each answer, and whether the change carries the source as
 * evidence somebody can open.
 */
type ConfirmSource = {
  changeKind: "spec_document_confirm" | "email_confirm";
  answerSource: "document" | "email";
  reason: string;
  evidenceAttachmentId: string | null;
};

async function confirmSourceFor(txn: TxnSql, run: Omit<LoadedRun, "actor">, count: number): Promise<ConfirmSource> {
  const answers = `${count} answer${count === 1 ? "" : "s"}`;

  if (run.documentKind !== "email") {
    return {
      changeKind: "spec_document_confirm",
      answerSource: "document",
      reason: `${answers} from ${run.staged.filename ?? "a specification document"}`,
      evidenceAttachmentId: null,
    };
  }

  // The message itself is the evidence. "The client says they never asked for
  // this" is answered by opening the email, so the change carries the .eml
  // rather than a rendering of it — see db/migrations/0013.
  const rows = await txn`
    select em.from_name, em.from_addr, em.subject, em.received_at, em.mime_attachment_id
    from email_messages em where em.intake_run_id = ${run.runId}
  `;
  const message = rows[0];
  if (!message) {
    // The kind says email and no message points at the run. Refuse rather than
    // writing answers whose provenance line would be a guess.
    throw new DomainConflictError(
      "email_missing",
      "This import is an email, but the message it came from is missing. Nothing was written.",
    );
  }

  const who = [message.from_name, message.from_addr].filter(Boolean).join(" ") || "an unknown sender";
  const when = message.received_at ? new Date(String(message.received_at)).toLocaleDateString("en-GB") : "an unknown date";
  const subject = message.subject ? ` "${String(message.subject)}"` : "";

  return {
    changeKind: "email_confirm",
    answerSource: "email",
    reason: `${answers} from an email from ${who}, ${when}${subject}`.slice(0, 300),
    evidenceAttachmentId: message.mime_attachment_id ? String(message.mime_attachment_id) : null,
  };
}

/** The run, locked, with its staged proposals read from the LOCKED row. */
async function loadRun(txn: TxnSql, runId: string, expectedVersion: number | null): Promise<Omit<LoadedRun, "actor">> {
  const rows = await txn`
    select id, project_id, status, parsed, version, source_kind, document_kind
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
  return {
    runId: String(run.id),
    projectId: String(run.project_id),
    staged,
    documentKind: run.document_kind === null || run.document_kind === undefined ? null : String(run.document_kind),
  };
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

/**
 * The values these proposals would land on, read LIVE inside the confirm's
 * transaction and locked, with whether each is the BILL's — by the one
 * predicate the review screen's registers and the drawings card read
 * (`attribute-from-bill.ts`). Active rows only: a row retired since is not a
 * value to compare with, and `annotateHeld` marks it moved.
 */
async function loadLiveHeld(txn: TxnSql, attributeIds: string[]): Promise<AttributeEntry[]> {
  if (attributeIds.length === 0) return [];
  const rows = await txn`
    select a.id, a.record_id, a.attr_group, a.dimension_slot, a.spec_field_id, a.label, a.value, a.unit,
           a.state, a.version, a.material_code, a.source_run_id, a.source_page
    from record_attributes a
    where a.id = any(${attributeIds}::uuid[]) and a.status = 'active'
    order by a.id
    for update
  `;
  const billHeld = await loadBillHeldIds(txn, { attributeIds });
  return rows.map((row) => ({
    id: String(row.id),
    recordId: String(row.record_id),
    attrGroup: String(row.attr_group) as AttributeGroup,
    slot: isDimensionSlot(row.dimension_slot) ? (String(row.dimension_slot) as DimensionSlot) : null,
    specFieldId: row.spec_field_id ? String(row.spec_field_id) : null,
    label: String(row.label),
    value: row.value === null || row.value === undefined ? null : String(row.value),
    unit: normaliseUnit(row.unit),
    state: String(row.state) as AttributeState,
    version: Number(row.version),
    materialCode: row.material_code ? String(row.material_code) : null,
    fromBill: billHeld.has(String(row.id)),
    sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
    sourcePage: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
  }));
}

/** What a dimension, finish or note proposal states, in the attribute's own shape. */
function statementOf(proposal: Proposal): DisagreementStatement {
  const dimension = proposal.dimension ?? null;
  const finish = proposal.finish ?? null;
  const note = proposal.note ?? null;
  if (dimension) {
    return {
      attrGroup: "dimension",
      label: (proposal.raw.attributeRaw ?? dimension.slot).trim() || dimension.slot,
      value: dimension.tbc ? (proposal.raw.valueRaw ?? "TBC") : dimension.figure,
      unit: dimension.unit,
      dimensionSlot: dimension.slot,
      specFieldId: null,
      materialCode: null,
      state: dimension.tbc ? "tbc" : "confirmed",
    };
  }
  if (finish) {
    return {
      attrGroup: finish.group,
      label: (proposal.raw.attributeRaw ?? finish.group).trim() || finish.group,
      value: finish.value,
      unit: null,
      dimensionSlot: null,
      specFieldId: finish.specFieldId,
      materialCode: finish.codeRaw,
      state: finish.tbc ? "tbc" : "confirmed",
    };
  }
  return {
    attrGroup: "note",
    label: note?.label ?? ((proposal.raw.attributeRaw ?? "").trim() || "Note"),
    value: (proposal.proposedValue ?? "").trim() ? proposal.proposedValue : proposal.raw.valueRaw,
    unit: null,
    dimensionSlot: null,
    specFieldId: null,
    materialCode: null,
    state: note?.tbc ? "tbc" : "confirmed",
  };
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
  const taken = takePending(run.staged, refs, ["pending"]);

  // THE HELD VALUES, LIVE. Whether a row agrees with what the record holds,
  // and whether what it holds is the BILL's, is read here from the rows as
  // they are now — never from the request and never from the staged JSON,
  // which was written when the document was read. The screen reads the same
  // comparison off the registers (`annotateHeld` in the review GET).
  const live = await loadLiveHeld(txn, [
    ...new Set(taken.map((proposal) => proposal.attributeTarget?.attributeId).filter((id): id is string => Boolean(id))),
  ]);
  const annotated = new Map(annotateHeld(taken, live).map((proposal) => [proposal.id, proposal]));
  const chosen = taken.map((proposal) => annotated.get(proposal.id) ?? proposal);
  const lines = run.staged.lines.map((line) => annotated.get(line.id) ?? line);

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
  // A value that moved since the reviewer looked is refused under its own
  // code, ahead of the blockers: the value they compared with, or agreed to
  // drop, is not the value that is there.
  const moved = chosen.find((proposal) => proposal.attributeTarget?.moved);
  if (moved) {
    throw new DomainConflictError(
      "occupant_changed",
      `The ${moved.dimension?.slot ?? moved.finish?.specFieldName ?? moved.note?.label ?? "spec"} this would be compared with has changed since you looked at it. Nothing was written — re-match (free) and check what is there now.`,
    );
  }

  for (const proposal of chosen) {
    const blockers = proposalBlockers(proposal, lines);
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
  const source = await confirmSourceFor(txn, run, chosen.length);
  // OPENED AT THE FIRST WRITE, not before the card is read. A card whose every
  // row agrees with what the record already holds writes nothing, and a change
  // in the trail that changed nothing is a line a reader has to work out is
  // empty. Still opened BEFORE that first write, which is the rule that
  // matters: write_audit() reads the change from the transaction.
  let changeSetId: string | null = null;
  const changeSet = async (): Promise<string> => {
    changeSetId ??= await openChangeSet(txn, {
      projectId: run.projectId,
      kind: source.changeKind,
      actor,
      reason: source.reason,
      sourceIntakeRunId: run.runId,
      evidenceAttachmentId: source.evidenceAttachmentId,
    });
    return changeSetId;
  };

  const applied = new Map<string, Proposal["applied"]>();
  // Whether anything a VERSION describes was written. A card whose every row
  // agrees with the bill, or is recorded beside it, writes no spec content,
  // and a version describing no change would be a version nobody made.
  let wroteContent = false;

  // ---- dimensions ---------------------------------------------------------
  //
  // A DIMENSION writes a `record_attributes` row, not an answer, and the
  // checklist answer follows from `promote-answers.ts` over every slot the
  // record holds. That is the drawings path exactly, and it has to be: writing
  // the answer directly would leave the record holding a Dimensions cell no
  // attribute backs, and the next drawing confirm recomposes from the
  // attributes alone and would silently wipe what this email contributed.
  const attributeWrites = chosen.filter((proposal) => proposal.dimension || proposal.finish || proposal.note);
  let wroteAttributes = false;
  if (attributeWrites.length > 0) {
    // Newest last, so `sort_order` reads in the order the reviewer saw.
    let sortOrder = Number(
      (await txn`select coalesce(max(sort_order), 0) as n from record_attributes where record_id = ${recordId}`)[0]?.n ?? 0,
    );

    for (const proposal of attributeWrites) {
      const dimension = proposal.dimension ?? null;
      const finish = proposal.finish ?? null;
      const note = proposal.note ?? null;
      const reading = heldReading(proposal);
      const statement = statementOf(proposal);
      const held = proposal.attributeTarget ?? null;

      // THE SAME VALUE: nothing to write. The row is still marked applied,
      // naming the attribute that already says it, so the card can complete.
      if (reading === "same" && held) {
        applied.set(proposal.id, {
          answerId: null,
          answerVersion: null,
          attributeId: held.attributeId,
          value: statement.value,
          state: statement.state,
          outcome: "agrees",
        });
        continue;
      }

      // DIFFERENT FROM THE BILL, and the reviewer left the default: the bill's
      // value stays live and this statement is recorded BESIDE it, in red,
      // until a person decides (0046). Nothing that reads record_attributes
      // moves. Ticking "use this document's instead" is the replace tick, and
      // falls through to the retire-and-insert below.
      if (reading === "bill_differs" && held && !proposal.overwriteAcknowledged) {
        const disagreement = await recordDisagreement(txn, {
          projectId: run.projectId,
          recordId,
          heldAttributeId: held.attributeId,
          sourceRunId: run.runId,
          sourcePage: proposal.raw.page ?? null,
          statement,
          changeSetId: changeSet,
          actor,
        });
        applied.set(proposal.id, {
          answerId: null,
          answerVersion: null,
          attributeId: null,
          value: statement.value,
          state: statement.state,
          outcome: "recorded_beside",
          disagreementId: disagreement.id,
        });
        continue;
      }

      sortOrder += 1;
      wroteAttributes = true;
      await changeSet();

      // RETIRE BEFORE INSERT, and the database decides that order rather than
      // preference: 0016's partial unique index is `where status = 'active'`,
      // so insert-then-retire cannot commit. Re-checked against the version
      // the reviewer saw — an occupant that moved since is refused, because
      // the value they agreed to drop is not the value that is there.
      // A note read as FREE (it only points at a drawing, or it holds the
      // bill's words and more) is written BESIDE the bill's note, never over
      // it: nothing is retired.
      if (proposal.attributeTarget && reading !== "free") {
        const retired = await txn`
          update record_attributes
          set status = 'retired', retired_at = now(), retired_by = ${actor}, updated_by = ${actor}
          where id = ${proposal.attributeTarget.attributeId}
            and record_id = ${recordId}
            and version = ${proposal.attributeTarget.attributeVersion}
            and status = 'active'
          returning id
        `;
        if (!retired[0]) {
          throw new DomainConflictError(
            "occupant_changed",
            `The ${dimension?.slot ?? finish?.specFieldName ?? note?.label ?? "spec"} this would replace has changed since you looked at it. Nothing was written — reload and check what is there now.`,
          );
        }
      }

      const label = statement.label;
      const tbc = statement.state === "tbc";
      // 0011's biconditional makes the pairing unrepresentable otherwise: a
      // dimension with no slot and a note carrying one are both refused at
      // insert. Only a dimension carries a slot; only a finish carries a field.
      // A NOTE is the document's own heading and words, verbatim (A4).
      // The PAGE goes with it: a statement off page 9 of the tracker is checked
      // against page 9 (null for a spreadsheet, which has none).
      const inserted = await txn`
        insert into record_attributes
          (record_id, attr_group, dimension_slot, spec_field_id, material_code, label, value, unit, state,
           source_run_id, source_page, sort_order, created_by, updated_by)
        values
          (${recordId}, ${statement.attrGroup},
           ${statement.dimensionSlot},
           ${statement.specFieldId},
           ${statement.materialCode},
           ${label},
           ${statement.value},
           ${statement.unit},
           ${statement.state},
           ${run.runId}, ${proposal.raw.page ?? null}, ${sortOrder}, ${actor}, ${actor})
        returning id
      `;
      const attributeId = String(inserted[0]?.id ?? "");
      if (!attributeId) throw new Error(`dimension ${proposal.id} was not inserted`);

      // The wording the figure was read from. "445mm (measured to top of
      // cushion, compressed)" — the figure is the derived reading and this is
      // what it actually measures, which is specification content and must not
      // be dropped. Kept as a NOTE, per CLAUDE.md's rule that everything a
      // document measures which is not one of the five slots stays a note.
      if (dimension?.qualifier) {
        sortOrder += 1;
        await txn`
          insert into record_attributes
            (record_id, attr_group, label, value, state, source_run_id, sort_order, created_by, updated_by)
          values
            (${recordId}, 'note', ${label}, ${proposal.raw.valueRaw ?? dimension.qualifier},
             'confirmed', ${run.runId}, ${sortOrder}, ${actor}, ${actor})
        `;
      }

      applied.set(proposal.id, {
        answerId: null,
        answerVersion: null,
        attributeId,
        value: dimension ? dimension.figure : statement.value,
        state: tbc ? "tbc" : "confirmed",
        outcome: "written",
      });
    }
  }

  if (wroteAttributes) {
    wroteContent = true;

    // Recompose the WHOLE record, not just the slots this document supplied:
    // a message giving only the seat height still has to recompose the cell
    // over the width and depth an earlier drawing confirmed, or the answer
    // says SH445mm and the record says W660 x D685 x H680 x SH445mm.
    // AND WITH THE RECORD'S OWN DIMENSION NOTE (0034). The composed cell is a
    // projection of the attributes AND that note; recomposing without it would
    // quietly drop a person's qualifier out of the checklist the first time
    // any document touched the record.
    const promotable = await loadPromotable(txn, recordId);
    const fills = planAnswerFills(promotable, await loadDimensionNote(txn, recordId));
    await applyAnswerFills(txn, recordId, run.runId, actor, fills);
    await applyAnswerRetractions(txn, recordId, actor, fills);
  }

  for (const proposal of chosen) {
    if (proposal.dimension || proposal.finish || proposal.note) continue;
    wroteContent = true;
    await changeSet();
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
            source_kind  = ${source.answerSource},
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
           ${proposal.raw.valueRaw}, ${state}, ${source.answerSource}, ${run.runId}, ${confirmedBy}, ${confirmedAt},
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
  // The STAGED lines, not the annotated ones: the live facts are read again on
  // every look and are not the document's to keep.
  const written = run.staged.lines.map((line) => {
    const result = applied.get(line.id);
    if (!result) return line;
    return { ...line, reviewStatus: "applied" as const, reviewedAt: now, reviewedBy: actor, applied: result, version: line.version + 1 };
  });

  const status = await writeStaged(txn, run, actor, written);

  if (wroteContent) await snapshotRecords(txn, [recordId], await changeSet());

  await txn`
    insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
    values ('intake_run', ${run.runId}, 'parsed', ${status}, ${actor},
            ${`Applied ${applied.size} extracted answer${applied.size === 1 ? "" : "s"} to one record`})
  `;

  return {
    applied: applied.size,
    ignored: 0,
    restored: 0,
    remainingPending: written.filter((line) => line.reviewStatus === "pending").length,
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
