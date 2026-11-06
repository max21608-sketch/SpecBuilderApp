// Retiring a run, and bringing one back.
//
// A reason is required: retiring takes a whole sub-quote out of the tabs and
// out of the export, and "why" is what makes that readable to whoever finds
// the gap later. The guards, including the cross-table assertion that no
// record is left active on a retired run, live in src/lib/run-retire.ts.
//
// THE VERSION THE SCREEN SHOWED IS REQUIRED (audit A16): retiring took none,
// so a press on a screen loaded before somebody renamed the phase, or retired
// and restored it, went through over a phase the person had not seen.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { retireRun, restoreRun } from "@/lib/run-retire";
import { requireUuid, requireWriter } from "@/lib/route-guards";

const Body = z
  .object({
    status: z.enum(["retired", "active"]),
    reason: z.string().min(1).max(2000),
    replacedByRunId: z.string().uuid().nullable().optional(),
    version: z.number().int().positive(),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; runId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;
  const { id, runId } = await context.params;
  const badId = requireUuid(id, runId);
  if (badId) return badId;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json(
      {
        ok: false,
        error:
          issue?.path[0] === "reason"
            ? "Say why this phase is being retired. It keeps every record and can be brought back, but the export stops carrying it."
            : "That request is not valid.",
        field: issue?.path.join("."),
      },
      400,
    );
  }

  try {
    const result = await withTransaction((txn) =>
      parsed.data.status === "retired"
        ? retireRun(txn, {
            projectId: id,
            runId,
            reason: parsed.data.reason,
            replacedByRunId: parsed.data.replacedByRunId ?? null,
            expectedVersion: parsed.data.version,
            actor: user.email,
          })
        : restoreRun(txn, {
            projectId: id,
            runId,
            reason: parsed.data.reason,
            expectedVersion: parsed.data.version,
            actor: user.email,
          }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
