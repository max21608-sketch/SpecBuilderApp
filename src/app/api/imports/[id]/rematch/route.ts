// Re-resolving an already-staged specification document against today's bill.
//
// ============================================================================
// THIS SPENDS NOTHING. No model call, no attempt, no delivery.
//
// A spec document resolves in the WORKER rather than at read time, because a
// proposal needs a target snapshot the confirm can check for edits underneath
// the reviewer. The cost of that is that a corrected matching rule is not
// retro-active: an already-read document keeps the resolution it was given,
// and the only way to improve it was to read it again — a billed call to fix
// an app defect.
//
// Every staged proposal carries its own `raw` observation, so the whole model
// output is already on record and re-resolving is free. Three cases it serves,
// all of them ordinary:
//
//   - the run fan-out landing after a document was read (the defect that
//     produced this route: one email about `S-201` asked a reviewer to place
//     seven values by hand against three identical candidates);
//   - an email read BEFORE its bill of quantities was confirmed, which
//     CLAUDE.md already calls a normal order of work for drawings;
//   - a bill revised after the email was read.
//
// IT NEVER OVERWRITES A DECISION. `rematchProposals` re-resolves only what is
// still pending, still at version 1 and still unresolved. A retarget, an edit,
// an ignore or a confirm is a person's decision and is passed through
// untouched — the rule `upgradeCalloutGuesses` follows, in a second place.
//
// No change set is opened, because nothing canonical is written: this moves
// STAGED rows only, exactly like an autosave.
// ============================================================================
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import { rematchProposals, type StagedSpecDocument } from "@/lib/spec-document";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const RematchRequest = z.object({ expectedVersion: z.number().int().nullable().optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = RematchRequest.safeParse(body ?? {});
  if (!parsed.success) return json({ ok: false, error: "invalid request" }, 400);
  const expectedVersion = parsed.data.expectedVersion ?? null;

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`
        select id, project_id, status, parsed, version, source_kind
        from intake_runs where id = ${id}
        for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.source_kind !== "spec_document") {
        throw new DomainConflictError("wrong_kind", "That import is not a specification document.", { status: 400 });
      }
      // `confirmed` is allowed: it means nothing is left to REVIEW, and a
      // proposal that never resolved was ignored rather than applied. Re-
      // matching one cannot resurrect it — an ignored row is not pending.
      if (run.status !== "parsed" && run.status !== "confirmed") {
        throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)}, not ready to review.`);
      }
      if (expectedVersion !== null && Number(run.version) !== expectedVersion) {
        throw new DomainConflictError(
          "import_version_stale",
          "This import changed while you were reviewing it. Reload and try again.",
        );
      }

      const staged = (run.parsed ?? null) as StagedSpecDocument | null;
      if (!staged || !Array.isArray(staged.lines)) {
        throw new DomainConflictError("not_staged", "This import has nothing staged to review.");
      }

      // Read INSIDE the transaction, so the registers the re-match resolves
      // against are the ones true at the moment it is written.
      const registers = await loadExtractionRegisters(String(run.project_id));
      const { lines, rematched, added } = rematchProposals(staged, registers, () => randomUUID());

      if (rematched === 0) {
        return { rematched: 0, added: 0, version: Number(run.version) };
      }

      const updated = await txn`
        update intake_runs
        set parsed = ${JSON.stringify({ ...staged, lines })}::jsonb,
            updated_by = ${user.email}
        where id = ${id}
        returning version
      `;
      if (!updated[0]) throw new Error("the import was not updated");
      return { rematched, added, version: Number(updated[0].version) };
    });

    return json({ ok: true, ...result });
  } catch (error) {
    return transactionErrorResponse(error);
  }
}
