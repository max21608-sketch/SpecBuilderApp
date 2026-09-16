// THE confirm boundary. The only route that promotes staged rows into canonical
// business records — spec records from a BOQ, spec answers from a document.
//
// ONE route, dispatching on source_kind, because two confirm routes is what the
// review-and-confirm skill forbids: the second one is always the one that
// forgets a guard. The guards themselves live in src/lib/confirm-boq.ts and
// src/lib/confirm-spec-document.ts, inside the transaction, where a check can
// still abort the write it is checking.
//
// Rules both paths keep:
//   * No matching is re-run. What gets written is what the reviewer approved;
//     a fresh match at confirm time could write something they never saw.
//   * Blocking conditions are re-checked server-side against live rows. The
//     review screen's opinion is not trusted.
//   * All of it commits or none of it does.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { confirmBoqImport } from "@/lib/confirm-boq";
import {
  confirmSpecDocumentRecord,
  ignoreSpecDocumentProposals,
  restoreSpecDocumentProposals,
} from "@/lib/confirm-spec-document";
import { confirmDrawingItem, reviewDrawingObservations } from "@/lib/confirm-drawings";
import { confirmPreambleNotes, reviewPreambleNotes } from "@/lib/confirm-preamble";

export const maxDuration = 60;

const ProposalRef = z.object({ id: z.string().uuid(), version: z.number().int().nonnegative() });

/** Staged ids are server-generated but not necessarily uuids across shapes. */
const StagedRef = z.object({ id: z.string().min(1), version: z.number().int().nonnegative() });

const ConfirmBody = z
  .object({
    version: z.number().int().optional(),
    action: z.enum(["confirm", "ignore", "restore"]).default("confirm"),
    recordId: z.string().uuid().optional(),
    proposals: z.array(ProposalRef).min(1).max(500).optional(),
    // Shop drawings: the ITEM is the unit of commit, because one drawing
    // legitimately belongs to the same code in several runs.
    itemId: z.string().min(1).optional(),
    itemVersion: z.number().int().nonnegative().optional(),
    observations: z.array(StagedRef).min(1).max(500).optional(),
    // The picture the reviewer kept, already uploaded to the project's own
    // blob prefix by the review screen. A PATHNAME, never a URL -- the store
    // resolves it against its own host from the token, so there is no host to
    // influence. Re-checked against this run's project inside the transaction;
    // being signed in does not make an arbitrary pathname this project's file.
    image: z
      .object({
        pathname: z.string().min(1).max(1024),
        filename: z.string().max(300).nullable().optional(),
        width: z.number().int().positive().max(20_000).nullable().optional(),
        height: z.number().int().positive().max(20_000).nullable().optional(),
        size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    // Preamble notes.
    notes: z.array(StagedRef).min(1).max(500).optional(),
  })
  .strict();

function distinct(refs: { id: string }[]): boolean {
  return new Set(refs.map((ref) => ref.id)).size === refs.length;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const parsed = ConfirmBody.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That request is not valid." }, 400);
  }
  const body = parsed.data;
  const expectedVersion = typeof body.version === "number" ? body.version : null;

  // Which pipeline, read from the run itself rather than from the request. The
  // client does not get to say which confirm logic applies to a row.
  const runs = await sql`select id, source_kind, document_kind from intake_runs where id = ${id}`;
  const run = runs[0];
  if (!run) return json({ ok: false, error: "No such import." }, 404);

  try {
    if (run.source_kind === "boq_xlsx") {
      const result = await withTransaction((txn) =>
        confirmBoqImport(txn, { runId: id, expectedVersion, actor: user.email }),
      );
      return json({
        ok: true,
        imported: result.imported,
        updated: result.updated,
        retired: result.retired,
        projectId: result.projectId,
        runs: result.runIds.length,
      });
    }

    if (run.source_kind !== "spec_document") {
      return json({ ok: false, error: "That import cannot be confirmed." }, 400);
    }

    if (run.document_kind === "shop_drawings") {
      const observations = body.observations ?? [];
      if (!body.itemId) return json({ ok: false, error: "Say which item this applies to." }, 400);
      if (observations.length === 0) return json({ ok: false, error: "Say which specs this applies to." }, 400);
      // A repeated id would be applied twice, and the version check would not
      // notice because it compares against the same staged row.
      if (!distinct(observations)) return json({ ok: false, error: "That request lists a spec twice." }, 400);

      if (body.action === "confirm") {
        if (typeof body.itemVersion !== "number") {
          return json({ ok: false, error: "itemVersion is required." }, 400);
        }
        const result = await withTransaction((txn) =>
          confirmDrawingItem(txn, {
            runId: id,
            expectedVersion,
            itemId: body.itemId as string,
            itemVersion: body.itemVersion as number,
            observations,
            image: body.image ?? null,
            actor: user.email,
          }),
        );
        return json({ ok: true, ...result });
      }

      const result = await withTransaction((txn) =>
        reviewDrawingObservations(txn, {
          runId: id,
          expectedVersion,
          itemId: body.itemId as string,
          observations,
          action: body.action as "ignore" | "restore",
          actor: user.email,
        }),
      );
      return json({ ok: true, ...result });
    }

    if (run.document_kind === "preamble") {
      const notes = body.notes ?? [];
      if (notes.length === 0) return json({ ok: false, error: "Say which notes this applies to." }, 400);
      if (!distinct(notes)) return json({ ok: false, error: "That request lists a note twice." }, 400);

      const result =
        body.action === "confirm"
          ? await withTransaction((txn) =>
              confirmPreambleNotes(txn, { runId: id, expectedVersion, notes, actor: user.email }),
            )
          : await withTransaction((txn) =>
              reviewPreambleNotes(txn, {
                runId: id,
                expectedVersion,
                notes,
                action: body.action as "ignore" | "restore",
                actor: user.email,
              }),
            );
      return json({ ok: true, ...result });
    }

    const proposals = body.proposals ?? [];
    if (proposals.length === 0) {
      return json({ ok: false, error: "Say which rows this applies to." }, 400);
    }
    // Ids must be distinct: a repeated id would be applied twice, and the
    // second application would find the version it just bumped.
    if (new Set(proposals.map((proposal) => proposal.id)).size !== proposals.length) {
      return json({ ok: false, error: "The same row was listed twice." }, 400);
    }

    if (body.action === "ignore") {
      const result = await withTransaction((txn) =>
        ignoreSpecDocumentProposals(txn, { runId: id, expectedVersion, proposals, actor: user.email }),
      );
      return json({ ok: true, ...result });
    }

    if (body.action === "restore") {
      const result = await withTransaction((txn) =>
        restoreSpecDocumentProposals(txn, { runId: id, expectedVersion, proposals, actor: user.email }),
      );
      return json({ ok: true, ...result });
    }

    if (!body.recordId) {
      return json({ ok: false, error: "A confirmation names one record.", field: "recordId" }, 400);
    }
    const result = await withTransaction((txn) =>
      confirmSpecDocumentRecord(txn, {
        runId: id,
        expectedVersion,
        recordId: body.recordId as string,
        proposals,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
