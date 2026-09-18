// Filing several finishes under the kind the app suggested, in one act.
//
// ============================================================================
// THE CLIENT SENDS WHICH ROWS, NEVER WHICH KIND.
//
// This route re-derives every kind from `suggestFinishKind` against the LIVE
// row, so a request can only ever file what the screen actually offered. It is
// the `questionTier` rule — "the server reads the tier off the live row and a
// request that tries to SET one is a 400" — for the same reason: the control
// is called "file the 7 suggested", and a body carrying arbitrary kinds would
// let it mean something else.
//
// A row whose suggestion has since changed or gone (somebody edited its
// description) is SKIPPED and named in the response, not guessed at. A row that
// already carries a kind is skipped too: a filed kind is a person's decision
// and a bulk control must never overwrite one.
//
// ---- ONE CHANGE SET, NOT N ------------------------------------------------
//
// `acceptSuggestedLevels` writes every accepted level under one `level_set`
// change, because 59 records must not mean 59 visits — and, just as much,
// because 59 change sets for one click makes the project trail unreadable. The
// same applies here: eleven finishes filed in one press is ONE entry saying so.
//
// A reason is not collected. Every finish this touches is `tbc` with no kind
// recorded, so nothing settled is being overridden — which is the same test
// `PATCH /finishes/[finishId]` already applies when it demands a reason only
// for a CONFIRMED finish.
// ============================================================================
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { changeSetForEdit } from "@/lib/change-sets";
import { editFinish } from "@/lib/finish-edit";
import { suggestFinishKind } from "@/lib/finish-kind-guess";
import { FINISH_KIND_LABELS, isFinishKind } from "@/lib/finishes";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    finishes: z
      .array(z.object({ id: z.string().uuid(), version: z.number().int().nonnegative() }).strict())
      .min(1)
      .max(200),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "That request is not valid." }, 400);
  const asked = parsed.data.finishes;

  try {
    const result = await withTransaction(async (txn) => {
      // Locked, in the order the client asked, so two people pressing this at
      // once cannot interleave into a deadlock.
      const rows = await txn`
        select id, version, code, kind, description, supplier_raw, reference, colour, notes, state, status
        from project_finishes
        where project_id = ${id} and id = any(${asked.map((entry) => entry.id)}::uuid[])
        order by code_norm
        for update
      `;
      const live = new Map(rows.map((row) => [String(row.id), row]));

      const filed: { code: string; kind: string }[] = [];
      const skipped: { code: string; why: string }[] = [];
      const plan: { row: Record<string, unknown>; kind: Awaited<ReturnType<typeof suggestFinishKind>> }[] = [];

      for (const entry of asked) {
        const row = live.get(entry.id);
        if (!row) {
          skipped.push({ code: entry.id, why: "it is no longer on this project" });
          continue;
        }
        const code = String(row.code);
        if (String(row.status) !== "active") {
          skipped.push({ code, why: "it has been retired" });
          continue;
        }
        // Somebody edited it between the screen loading and this click. Refuse
        // that one rather than writing over what they did.
        if (Number(row.version) !== entry.version) {
          skipped.push({ code, why: "somebody changed it since this screen loaded" });
          continue;
        }
        if (row.kind) {
          const filedAs = isFinishKind(row.kind) ? FINISH_KIND_LABELS[row.kind].toLowerCase() : String(row.kind);
          skipped.push({ code, why: `it is already filed as ${filedAs}` });
          continue;
        }
        const suggestion = suggestFinishKind({
          code,
          description: row.description === null || row.description === undefined ? null : String(row.description),
        });
        if (!suggestion) {
          skipped.push({ code, why: "there is nothing to read a kind from any more" });
          continue;
        }
        plan.push({ row, kind: suggestion });
      }

      if (plan.length === 0) {
        throw new DomainConflictError("nothing_to_file", "None of those can be filed. " + skipped.map((entry) => `${entry.code} — ${entry.why}`).join("; "));
      }

      // ONE change for the whole click, the `acceptSuggestedLevels` pattern —
      // eleven codes filed in one press is one thing that happened, not eleven
      // entries in the project trail.
      //
      // A REASON IS REQUIRED, and not merely by convention: `finish_edit` is in
      // `REASON_REQUIRED_KINDS` and the database enforces it with
      // `change_sets_reason_required`, so a change set opened without one is
      // refused and the whole transaction rolls back. Found by pressing the
      // button — it reported "A finish edited has to say why" and wrote
      // nothing, which is the right failure and the wrong request.
      //
      // The default mirrors `PATCH /finishes/[finishId]`, which supplies
      // "Filled in <code>." for the same reason. It names what was done and
      // what it was read from, which is what makes the entry answerable later.
      const { changeSetId } = await changeSetForEdit(txn, {
        projectId: id,
        actor: user.email,
        kind: "finish_edit",
        reason:
          plan.length === 1
            ? `Filed ${String(plan[0]!.row.code)} as ${FINISH_KIND_LABELS[plan[0]!.kind!.kind].toLowerCase()} — ${plan[0]!.kind!.reason}.`
            : `Filed ${plan.length} finishes under the kind their code or description says: ${plan
                .map((entry) => `${String(entry.row.code)} ${FINISH_KIND_LABELS[entry.kind!.kind].toLowerCase()}`)
                .join(", ")}.`,
      });

      for (const { row, kind } of plan) {
        // EVERY field, not just the kind. `editFinish` REPLACES the row — an
        // omitted field is written as null — so a partial patch here would
        // silently delete the description the suggestion was READ FROM.
        await editFinish(txn, {
          projectId: id,
          finishId: String(row.id),
          expectedVersion: Number(row.version),
          actor: user.email,
          changeSetId,
          // Unused while `changeSetId` is supplied — the change is already
          // open and carries the reason for the whole act.
          reason: kind!.reason,
          fields: {
            code: String(row.code),
            kind: kind!.kind,
            description: row.description === null || row.description === undefined ? null : String(row.description),
            supplierRaw: row.supplier_raw === null || row.supplier_raw === undefined ? null : String(row.supplier_raw),
            reference: row.reference === null || row.reference === undefined ? null : String(row.reference),
            colour: row.colour === null || row.colour === undefined ? null : String(row.colour),
            notes: row.notes === null || row.notes === undefined ? null : String(row.notes),
            state: row.state as never,
          },
        });
        filed.push({ code: String(row.code), kind: FINISH_KIND_LABELS[kind!.kind] });
      }

      return { filed, skipped };
    });

    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
