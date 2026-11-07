// The import route's SPECIFICATION-DOCUMENT half other than drawings: a proposal's autosave, a preamble note's, a finishes schedule entry's kind, and their review GETs.
// Moved out of src/app/api/imports/[id]/route.ts on 2026-11-07 (audit 5.3, cut D); the route is now the dispatcher.

import { z } from "zod";
import { sql, json, type Row } from "@/lib/db";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import {
  annotateHeld,
  asNoteProposal,
  buildTargetSnapshot,
  suggestState,
  unmatchedBecomesNote,
  type Proposal,
  type StagedSpecDocument,
} from "@/lib/spec-document";
import { ANSWER_STATES, ATTRIBUTE_UNITS, type DocumentKind } from "@/lib/spec-vocab";
import { furnitureReadRequestId } from "@/lib/tracker-furniture";
import { assertStagedPreamble, preambleNoteBlockers, type StagedPreamble } from "@/lib/preamble-document";
import { assertStagedFinishSchedule, reviewFinishSchedule } from "@/lib/finish-schedule";
import { loadScheduleLibrary, setFinishScheduleEntryKind } from "@/lib/confirm-finish-schedule";
import { isFinishKind } from "@/lib/finishes";
import { documentClosedSentence, reviewedWord } from "@/lib/intake-status";

// ---- a preamble note's autosave --------------------------------------------

const PreamblePatch = z
  .object({
    noteId: z.string().min(1),
    expectedVersion: z.number().int().nonnegative(),
    changes: z
      .object({
        topic: z.string().max(300).nullable().optional(),
        title: z.string().max(300).nullable().optional(),
        body: z.string().max(8000).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export async function patchPreamble(id: string, raw: unknown, actor: string): Promise<Response> {
  const parsed = PreamblePatch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That change is not valid." }, 400);
  }
  const { noteId, expectedVersion, changes } = parsed.data;
  if (Object.keys(changes).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`
        select id, status, parsed, version from intake_runs where id = ${id} for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.status !== "parsed") {
        throw new DomainConflictError("not_reviewable", documentClosedSentence(String(run.status), { consequence: "it cannot be edited here" }));
      }
      const staged: StagedPreamble = assertStagedPreamble(run.parsed);
      const note = staged.notes.find((row) => row.id === noteId);
      if (!note) throw new DomainConflictError("note_missing", "That note is no longer part of this import. Reload.");
      if (note.reviewStatus !== "pending") {
        throw new DomainConflictError(
          "note_reviewed",
          `That note has already been ${reviewedWord(note.reviewStatus)}. Reload to see where it stands.`,
        );
      }
      if (note.version !== expectedVersion) {
        throw new DomainConflictError("note_version_stale", "That note changed since this screen loaded. Reload.");
      }

      // The reviewer's text changes; `*Raw` keeps what the document said, so a
      // value can always be traced back to its page.
      const notes = staged.notes.map((row) =>
        row.id === noteId ? { ...row, version: row.version + 1, ...changes } : row,
      );
      const written = await txn`
        update intake_runs
        set parsed = ${JSON.stringify({ ...staged, notes })}::jsonb, updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("not_reviewable", "This import closed while you were editing it.");
      return { version: Number(written[0].version) };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}



// ---- a finishes schedule entry's kind, filed by a person's click ------------

const FinishEntryPatch = z
  .object({
    entryId: z.string().min(1),
    expectedVersion: z.number().int().nonnegative(),
    changes: z.object({ kind: z.string().nullable() }).strict(),
  })
  .strict();

export async function patchFinishScheduleEntry(id: string, raw: unknown, actor: string): Promise<Response> {
  const parsed = FinishEntryPatch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That change is not valid." }, 400);
  }
  const { entryId, expectedVersion, changes } = parsed.data;
  if (changes.kind !== null && !isFinishKind(changes.kind)) {
    return json({ ok: false, error: "That is not a kind of finish." }, 400);
  }
  try {
    const result = await withTransaction((txn) =>
      setFinishScheduleEntryKind(txn, {
        runId: id,
        entryId,
        expectedVersion,
        kind: changes.kind === null ? null : (changes.kind as Parameters<typeof setFinishScheduleEntryKind>[1]["kind"]),
        actor,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- a proposal's autosave --------------------------------------------------

const ProposalPatch = z
  .object({
    proposalId: z.string().uuid(),
    expectedProposalVersion: z.number().int().nonnegative(),
    changes: z
      .object({
        proposedValue: z.string().max(4000).nullable().optional(),
        proposedState: z.enum(ANSWER_STATES).nullable().optional(),
        overwriteAcknowledged: z.boolean().optional(),
        // Retargeting. A dedicated operation: it revalidates membership,
        // rebuilds the snapshot, and clears what the old target justified.
        recordId: z.string().uuid().nullable().optional(),
        requirementId: z.string().uuid().nullable().optional(),
        // A DIMENSION's unit, which the email often does not state. There is
        // deliberately no magnitude fallback anywhere in the dimension model,
        // so where the wording carries no unit a person supplies one or the
        // cell renders the figure verbatim saying why.
        dimensionUnit: z.enum(ATTRIBUTE_UNITS).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export async function patchProposal(id: string, raw: unknown, actor: string): Promise<Response> {
  const parsed = ProposalPatch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That change is not valid." }, 400);
  }
  const { proposalId, expectedProposalVersion, changes } = parsed.data;
  if (Object.keys(changes).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  const retargeting = "recordId" in changes || "requirementId" in changes;

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`
        select id, project_id, status, parsed, version, source_kind, document_kind
        from intake_runs where id = ${id}
        for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.status !== "parsed") {
        throw new DomainConflictError("not_reviewable", documentClosedSentence(String(run.status), { consequence: "it cannot be edited here" }));
      }

      const staged = (run.parsed ?? null) as StagedSpecDocument | null;
      if (!staged?.lines) throw new DomainConflictError("not_staged", "This import has nothing staged.");

      // By id, in the LOCKED json. Never by position.
      const proposal = staged.lines.find((line) => line.id === proposalId);
      if (!proposal) throw new DomainConflictError("proposal_missing", "That row is no longer part of this import.");
      if (proposal.reviewStatus !== "pending") {
        throw new DomainConflictError(
          "proposal_reviewed",
          `That row has already been ${reviewedWord(proposal.reviewStatus)}, so it cannot be edited. Reload to see where it stands.`,
        );
      }
      // PER-PROPOSAL optimistic lock. The run's coarse version is bumped by
      // every autosave on every row, so using it here would make two people
      // editing two different rows conflict with each other for no reason.
      if (proposal.version !== expectedProposalVersion) {
        throw new DomainConflictError(
          "proposal_version_stale",
          "This row changed since this screen loaded. Its current value is shown; yours was not saved.",
          { diff: { proposal } },
        );
      }

      let next: Proposal = { ...proposal };

      if (retargeting) {
        const registers = await loadExtractionRegisters(String(run.project_id));
        const recordId = "recordId" in changes ? changes.recordId ?? null : proposal.recordId;
        const record = recordId ? registers.records.find((row) => row.id === recordId) ?? null : null;
        if (recordId && !record) {
          throw new DomainConflictError("record_missing", "That record is not part of this project.", { status: 400 });
        }

        // A requirement is only valid inside the chosen record's category.
        //
        // EXPLICIT and CARRIED-OVER are handled differently, and conflating them
        // was a bug: moving a proposal to a record in another category carried
        // the old question along, found it invalid there, and REFUSED the whole
        // edit — for a question the reviewer had not chosen and could not see.
        // An explicitly sent question that does not fit is a refusal; one merely
        // inherited from the old record is silently cleared.
        const explicitRequirement = "requirementId" in changes;
        const requirementId = explicitRequirement ? changes.requirementId ?? null : proposal.requirementId;
        const requirement =
          requirementId && record
            ? registers.requirements.find((row) => row.id === requirementId && row.categoryId === record.categoryId) ?? null
            : null;
        if (explicitRequirement && requirementId && !requirement) {
          throw new DomainConflictError(
            "requirement_mismatch",
            "That question does not belong to the chosen item's category.",
            { status: 400 },
          );
        }

        next = {
          ...next,
          recordId: record ? record.id : null,
          // INCOMPATIBLE selections are cleared, not every selection. Moving a
          // proposal to another record in the SAME category keeps the question
          // -- it is still one of that item's questions -- but the snapshot
          // below is rebuilt against the new record's answer, which is what the
          // reviewer has to see before confirming. Moving it to a record in a
          // different category leaves `requirement` null and clears it.
          requirementId: requirement ? requirement.id : null,
          target: record && requirement ? buildTargetSnapshot(record, requirement, registers.answers) : null,
          // The old acknowledgement was about a different answer entirely.
          overwriteAcknowledged: false,
        };

        // A NOTE OR AN ANSWER, decided by what the reviewer chose (A4). A
        // statement on a schedule that answers no question is kept as a note
        // on its record; choosing a question makes it that question's answer
        // and drops the note; clearing the question, or moving it to another
        // item, makes it a note again — on THAT item, compared with THAT
        // item's bill note. Never on an email, and never on a dimension or a
        // finish, which land by slot and by field.
        if (!proposal.dimension && !proposal.finish) {
          const asNote =
            record && !requirement && unmatchedBecomesNote(run.document_kind ? (String(run.document_kind) as DocumentKind) : null)
              ? asNoteProposal({ ...next, note: null, attributeTarget: null }, record, registers)
              : null;
          if (asNote) {
            next = { ...asNote, overwriteAcknowledged: false };
          } else {
            next = { ...next, note: null, attributeTarget: null };
            if (proposal.note) {
              // It was a note, kept verbatim; as an answer it is read the way
              // every answer is, so a "N/A" is not recorded as the words N/A.
              const suggestion = suggestState(proposal.raw.valueRaw);
              next.proposedState = suggestion.state;
              next.proposedValue = suggestion.value;
              next.stateReason = suggestion.reason;
            }
          }
        }

        // A fresh suggestion for a newly reachable target, but only where the
        // reviewer has not already typed something of their own.
        if (next.target && next.proposedState === null && next.proposedValue === proposal.raw.valueRaw) {
          const suggestion = suggestState(proposal.raw.valueRaw);
          next.proposedState = suggestion.state;
          next.proposedValue = suggestion.value;
          next.stateReason = suggestion.reason;
        }
      }

      if ("proposedValue" in changes) next.proposedValue = changes.proposedValue ?? null;
      if ("proposedState" in changes) {
        next.proposedState = changes.proposedState ?? null;
        // A state the reviewer chose needs no explanation of why none was
        // suggested.
        if (changes.proposedState) next.stateReason = null;
      }
      // Setting the unit is a PERSON deciding, so it is recorded as such:
      // `unitSource` stops being "stated" and the screen stops calling it the
      // email's own. Refused on a row that is not a dimension rather than
      // silently ignored, or a client could believe it had set one.
      if ("dimensionUnit" in changes) {
        if (!proposal.dimension) {
          throw new DomainConflictError("not_a_dimension", "That row is not a dimension.", { status: 400 });
        }
        next.dimension = {
          ...proposal.dimension,
          unit: changes.dimensionUnit ?? null,
          unitSource: changes.dimensionUnit ? "reviewer" : null,
        };
      }

      if ("overwriteAcknowledged" in changes && !retargeting) {
        next.overwriteAcknowledged = Boolean(changes.overwriteAcknowledged);
      }

      next.version = proposal.version + 1;

      // The full replacement value is assembled HERE, from the locked current
      // row -- never from an array the client sent.
      const lines = staged.lines.map((line) => (line.id === proposalId ? next : line));
      const written = await txn`
        update intake_runs
        set parsed = ${JSON.stringify({ ...staged, lines })}::jsonb, updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("not_reviewable", "This import changed while you were editing.");

      return { proposal: next, version: Number(written[0].version) };
    });

    return json({ ok: true, proposal: result.proposal, version: result.version });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- the review GETs ------------------------------------------------------

/** A finishes schedule read as ENTRIES (schemaVersion 2), or not read yet. */
export async function getFinishScheduleReview(run: Row): Promise<Response> {
  // The FURNITURE half of the same file, if somebody has asked for it to be
  // read (`tracker-furniture.ts`) — so the button becomes a link to that run.
  const furnitureRows = await sql`
    select id from intake_runs where registration_request_id = ${furnitureReadRequestId(String(run.id))}
  `;
  const furnitureRunId = furnitureRows[0] ? String(furnitureRows[0].id) : null;
  if (!run.parsed) return json({ ok: true, import: { ...run, parsed: null }, review: [], furnitureRunId });
  // The verdict against the LIVE library, by the function the confirm calls.
  const staged = assertStagedFinishSchedule(run.parsed);
  const library = await loadScheduleLibrary(sql, String(run.project_id));
  return json({
    ok: true,
    import: { ...run, parsed: staged },
    review: reviewFinishSchedule(staged, library),
    furnitureRunId,
  });
}

/** A preamble's notes and their blockers. */
export async function getPreambleReview(run: Row): Promise<Response> {
  if (!run.parsed) return json({ ok: true, import: { ...run, parsed: null } });
  const staged = assertStagedPreamble(run.parsed);
  return json({ ok: true, import: { ...run, parsed: staged }, blockers: preambleNoteBlockers(staged) });
}

/** Every other specification document: an email, a schedule, a sheet, a v1 finishes schedule. */
export async function getProposalsReview(run: Row): Promise<Response> {
  // The registers the review screen's selects are built from. Loaded here so
  // the screen never has to guess which questions a category has.
  const registers = await loadExtractionRegisters(String(run.project_id));
  const parsed = (run.parsed ?? null) as StagedSpecDocument | null;

  // An email carries its own header panel: who sent it, when, and a link
  // that opens it in Outlook. A proposal off an email has no page to turn
  // to, so the message itself is what a reviewer checks it against.
  const messageRows =
    run.document_kind === "email"
      ? await sql`
          select em.id, em.from_addr, em.from_name, em.subject, em.received_at,
                 em.to_addrs, em.cc_addrs, em.attachments_meta, em.has_attachments,
                 em.routing_reason, em.chase_match, em.triage, em.version,
                 -- The PLAIN TEXT body, for the screen's own message tab. The
                 -- html body is deliberately not selected: it is markup a
                 -- stranger wrote, and the two routes that serve the raw .eml
                 -- both force a download for that reason.
                 em.body_text,
                 d.subject as chase_subject, d.sent_at as chase_sent_at,
                 d.recipient_name as chase_recipient_name,
                 (select count(*) from email_draft_items i where i.draft_id = d.id) as chase_question_count
          from email_messages em
          left join email_drafts d on d.id = em.chase_draft_id
          where em.intake_run_id = ${run.id}
        `
      : [];

  // WHAT EACH ROW WOULD LAND ON, AS IT IS NOW. Whether a value agrees with
  // what the record holds, and whether what it holds is the BILL's, is read
  // off the live registers on every look — the comparison the confirm makes
  // again inside its transaction (`annotateHeld`). Not written back: the
  // staged JSON stays what was resolved when the document was read.
  const live = parsed && Array.isArray(parsed.lines)
    ? { ...parsed, lines: annotateHeld(parsed.lines, registers.attributes ?? []) }
    : parsed;

  return json({
    ok: true,
    import: { ...run, parsed: live },
    message: messageRows[0] ?? null,
    registers: {
      records: registers.records,
      requirements: registers.requirements,
    },
  });
}
