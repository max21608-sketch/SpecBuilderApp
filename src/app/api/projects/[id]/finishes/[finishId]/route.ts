// Editing one finish, and carrying the change to every item that uses it.
//
// A reason is required when the finish is CONFIRMED: changing a settled
// finish rewrites what forty export cells say, and "why" is the only thing
// that makes that answerable later. Adding a description to a TBC finish is
// the library being filled in, not overridden, so it needs none.
//
// Retiring is refused while anything still uses it — an item pointing at a
// retired finish would render from a definition nobody maintains.
import { sql, json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { editFinish } from "@/lib/finish-edit";
import { changeSetForEdit } from "@/lib/change-sets";
import { FINISH_KINDS } from "@/lib/finishes";

const Patch = z
  .object({
    version: z.number().int().nonnegative(),
    reason: z.string().max(2000).optional(),
    code: z.string().min(1).max(120).optional(),
    kind: z.enum(FINISH_KINDS).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    supplierRaw: z.string().max(300).nullable().optional(),
    reference: z.string().max(300).nullable().optional(),
    colour: z.string().max(200).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    state: z.enum(["confirmed", "tbc"]).optional(),
    status: z.enum(["active", "retired"]).optional(),
    evidence: z
      .object({
        pathname: z.string().min(1).max(1024),
        filename: z.string().max(300).nullable().optional(),
        contentType: z.string().max(200).nullable().optional(),
        size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; finishId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id, finishId } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Patch.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "That change is not valid." }, 400);
  const body = parsed.data;

  // Was it settled before this edit? That, not what it is becoming, decides
  // whether a reason is required.
  const rows = await sql`select state, status, code from project_finishes where id = ${finishId} and project_id = ${id}`;
  const current = rows[0];
  if (!current) return json({ ok: false, error: "No such finish on this project." }, 404);
  const wasConfirmed = String(current.state) === "confirmed";

  if ((wasConfirmed || body.status === "retired") && !body.reason?.trim()) {
    return json(
      {
        ok: false,
        code: "reason_required",
        error:
          body.status === "retired"
            ? `Say why “${String(current.code)}” is leaving the library.`
            : `“${String(current.code)}” is confirmed and is used on this project's items. Say why it is changing.`,
        field: "reason",
      },
      400,
    );
  }

  try {
    if (body.status === "retired" || (body.status === "active" && String(current.status) === "retired")) {
      const result = await withTransaction(async (txn) => {
        const retiring = body.status === "retired";
        if (retiring) {
          const used = await txn`
            select count(*)::int as n from record_attributes a
            join spec_records r on r.id = a.record_id
            where a.finish_id = ${finishId} and a.status = 'active' and r.status = 'active'
          `;
          if (Number(used[0]?.n ?? 0) > 0) {
            throw new DomainConflictError(
              "finish_in_use",
              `${Number(used[0]?.n)} item${Number(used[0]?.n) === 1 ? " still uses" : "s still use"} this finish. Unlink them first — an item pointing at a retired finish would render from a definition nobody is keeping up to date.`,
            );
          }
        }
        await changeSetForEdit(txn, {
          projectId: id,
          actor: user.email,
          kind: "finish_edit",
          reason: body.reason ?? `Put ${String(current.code)} back in the library.`,
        });
        const rows = await txn`
          update project_finishes
          set status = ${retiring ? "retired" : "active"},
              retired_at = ${retiring ? new Date().toISOString() : null},
              retired_by = ${retiring ? user.email : null},
              updated_by = ${user.email}
          where id = ${finishId} and project_id = ${id} and version = ${body.version}
          returning id
        `;
        if (!rows[0]) {
          throw new DomainConflictError("finish_version_stale", "That finish changed as you saved. Reload.");
        }
        return { finishId, retired: retiring };
      });
      return json({ ok: true, ...result });
    }

    const result = await withTransaction((txn) =>
      editFinish(txn, {
        projectId: id,
        finishId,
        expectedVersion: body.version,
        fields: body,
        reason: body.reason ?? `Filled in ${String(current.code)}.`,
        evidence: body.evidence ?? null,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
