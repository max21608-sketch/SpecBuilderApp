// Unlinking two twin lines (0060): they are not one item after all.
//
//   PATCH /api/twins/<link id>   { status: "retired", version, reason }
//
// Retired, never deleted, and a reason is required (an open change satisfies
// it). Nothing either line holds changes: a twin never shared a value, so
// there is nothing to take back, only an offer that stops being made.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { requireUuid, requireWriter } from "@/lib/route-guards";
import { unlinkTwins } from "@/lib/record-twins";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    status: z.literal("retired"),
    version: z.number().int().nonnegative(),
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;
  const { id } = await context.params;
  const badId = requireUuid(id);
  if (badId) return badId;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "Say why these lines are not one item." }, 400);

  try {
    const result = await withTransaction((txn) =>
      unlinkTwins(txn, {
        twinId: id,
        expectedVersion: parsed.data.version,
        reason: parsed.data.reason ?? null,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
