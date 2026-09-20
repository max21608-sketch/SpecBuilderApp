// Retiring a run, and bringing one back.
//
// A reason is required: retiring takes a whole sub-quote out of the tabs and
// out of the export, and "why" is what makes that readable to whoever finds
// the gap later. The guards, including the cross-table assertion that no
// record is left active on a retired run, live in src/lib/run-retire.ts.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { retireRun, restoreRun } from "@/lib/run-retire";

const Body = z
  .object({
    status: z.enum(["retired", "active"]),
    reason: z.string().min(1).max(2000),
    replacedByRunId: z.string().uuid().nullable().optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; runId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id, runId } = await context.params;

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
            actor: user.email,
          })
        : restoreRun(txn, { projectId: id, runId, reason: parsed.data.reason, actor: user.email }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
