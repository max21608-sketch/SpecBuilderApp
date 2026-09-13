// Reading and editing a staged import. Edits here change nothing operational:
// the staged jsonb is a draft until /confirm promotes it.
//
// TWO SHAPES behind one endpoint, dispatched on source_kind — the BOQ's
// positional lines, and a specification document's identified proposals. They
// are edited differently for a reason that is not cosmetic:
//
//   BOQ lines are a FIXED LIST parsed from a spreadsheet. Nothing is ever added
//   or removed, so an index is a stable address.
//
//   PROPOSALS ARE ADDRESSED BY UUID, NEVER BY POSITION. Reviewing one changes
//   the set the screen is filtering, so "the proposal at index 4" means a
//   different row before and after an Ignore. Every operation here locates by
//   `elem.id` in the live, locked JSON.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import {
  buildTargetSnapshot,
  suggestState,
  type Proposal,
  type StagedSpecDocument,
} from "@/lib/spec-document";
import { ANSWER_STATES } from "@/lib/spec-vocab";

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
  categoryStatus: string;
  categoryCandidates?: { id: string; name: string }[];
  ignored: boolean;
};

type ParsedBoq = { sheet: string; headerRow: number; skippedRows: number; lines: StagedLine[] };

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const rows = await sql`
    select r.id, r.project_id, r.status, r.parsed, r.error, r.version, r.confirmed_at,
           r.source_kind, r.document_kind, r.model, r.model_metadata,
           r.attempt_id, r.claim_count, r.queued_at,
           (r.attempt_deadline_at > now()) as within_deadline,
           (r.status = 'parsing' and r.processing_started_at > now() - interval '360 seconds') as claim_live,
           p.bws_project_number, p.name as project_name,
           a.filename
    from intake_runs r
    join projects p on p.id = r.project_id
    left join attachments a on a.id = r.attachment_id
    where r.id = ${id}
  `;
  const run = rows[0];
  if (!run) return json({ ok: false, error: "No such import." }, 404);

  if (run.source_kind === "spec_document") {
    // The registers the review screen's selects are built from. Loaded here so
    // the screen never has to guess which questions a category has.
    const registers = await loadExtractionRegisters(String(run.project_id));
    const parsed = (run.parsed ?? null) as StagedSpecDocument | null;
    return json({
      ok: true,
      import: { ...run, parsed },
      registers: {
        records: registers.records,
        requirements: registers.requirements,
      },
    });
  }

  const categories = await sql`
    select id, slug, family, name, requirements_authored from item_categories order by family, sort_order
  `;

  // No matching here. Suggestions were computed and stored when the file was
  // parsed, so the reviewer sees exactly what confirm will write. Recomputing
  // on read would let the two drift apart between the screen and the commit.
  const parsed = (run.parsed ?? null) as ParsedBoq | null;
  return json({ ok: true, import: { ...run, parsed }, categories });
}

// ---- the BOQ's positional autosave -----------------------------------------
// Merges the reviewer's change into the line that is still present at that
// index, rather than writing back an array the client sent -- a snapshot
// rewrite races another tab's autosave and silently reverts it.
async function patchBoqLine(id: string, body: { index?: unknown; categoryId?: unknown; ignored?: unknown }, actor: string): Promise<Response> {
  const index = typeof body.index === "number" ? body.index : null;
  if (index === null) return json({ ok: false, error: "index is required." }, 400);

  const patch: Record<string, unknown> = {};
  if (typeof body.categoryId === "string" || body.categoryId === null) {
    patch.categoryId = body.categoryId;
    patch.categoryStatus = body.categoryId ? "chosen" : "none";
  }
  if (typeof body.ignored === "boolean") patch.ignored = body.ignored;
  if (Object.keys(patch).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  const rows = await sql`
    update intake_runs
    set parsed = jsonb_set(
          parsed,
          array['lines', ${String(index)}],
          coalesce(parsed->'lines'->(${index}::int), '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
        ),
        updated_by = ${actor}
    where id = ${id}
      and status = 'parsed'
      and parsed->'lines'->(${index}::int) is not null
    returning version
  `;
  if (!rows[0]) {
    return json({ ok: false, error: "That line is no longer in this import, or the import is already confirmed." }, 409);
  }
  return json({ ok: true, version: rows[0].version });
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
      })
      .strict(),
  })
  .strict();

async function patchProposal(id: string, raw: unknown, actor: string): Promise<Response> {
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
        select id, project_id, status, parsed, version, source_kind
        from intake_runs where id = ${id}
        for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.status !== "parsed") {
        throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)} and cannot be edited.`);
      }

      const staged = (run.parsed ?? null) as StagedSpecDocument | null;
      if (!staged?.lines) throw new DomainConflictError("not_staged", "This import has nothing staged.");

      // By id, in the LOCKED json. Never by position.
      const proposal = staged.lines.find((line) => line.id === proposalId);
      if (!proposal) throw new DomainConflictError("proposal_missing", "That row is no longer part of this import.");
      if (proposal.reviewStatus !== "pending") {
        throw new DomainConflictError(
          "proposal_reviewed",
          `That row has already been ${proposal.reviewStatus} and cannot be edited.`,
        );
      }
      // PER-PROPOSAL optimistic lock. The run's coarse version is bumped by
      // every autosave on every row, so using it here would make two people
      // editing two different rows conflict with each other for no reason.
      if (proposal.version !== expectedProposalVersion) {
        throw new DomainConflictError(
          "proposal_version_stale",
          "This row was edited in another tab. Its current value is shown; yours was not saved.",
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  // Which shape, read from the run, not from the request.
  const rows = await sql`select source_kind from intake_runs where id = ${id}`;
  if (!rows[0]) return json({ ok: false, error: "No such import." }, 404);

  if (rows[0].source_kind === "spec_document") return patchProposal(id, raw, user.email);
  return patchBoqLine(id, (raw ?? {}) as Record<string, unknown>, user.email);
}
