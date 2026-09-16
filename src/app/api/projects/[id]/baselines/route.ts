// Naming a point in a project's history.
//
// A baseline writes down the exact version of every active record, under the
// project row lock. See src/lib/baselines.ts for why it is a materialised set
// rather than a timestamp — the short version is that transaction start time
// does not order commits, so "newest version as at that date" can put a
// version on the wrong side of the line.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { takeBaseline } from "@/lib/baselines";

const Body = z
  .object({
    label: z.string().min(1).max(120),
    reason: z.string().min(1).max(2000),
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
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json(
      {
        ok: false,
        error:
          issue?.path[0] === "label"
            ? "A baseline needs a name, so it can be referred to later."
            : "Say what this baseline is — what was issued, and to whom.",
        field: issue?.path.join("."),
      },
      400,
    );
  }

  try {
    const result = await withTransaction((txn) =>
      takeBaseline(txn, {
        projectId: id,
        label: parsed.data.label,
        reason: parsed.data.reason,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
