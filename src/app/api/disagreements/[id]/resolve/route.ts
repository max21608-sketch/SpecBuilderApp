// Settling one disagreement between two documents.
//
// A REASON IS ALWAYS REQUIRED, either way — the correction screen's rule, and
// for a stronger reason here: both values stay on record whatever is decided,
// and the reason is the only thing that says why one of them won. An open
// change does NOT stand in for it (the library refuses a blank reason before
// it would look for one).
//
// Writer roles only: the middleware's allowlist gates every mutating API
// request, and this is one. The guards live in `src/lib/disagreement-resolve.ts`,
// inside the transaction — the disagreement's version, the held value's
// version and liveness, and the slot the used value lands in. A stale version
// is a 409 the screen shows on the row before reloading it.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { resolveDisagreement } from "@/lib/disagreement-resolve";
import { DISAGREEMENT_DECISIONS } from "@/lib/disagreements";

const Body = z
  .object({
    decision: z.enum(DISAGREEMENT_DECISIONS),
    reason: z.string().trim().min(1).max(2000),
    version: z.number().int().nonnegative(),
    // The held value's version as the screen read it. Checked for "use this",
    // which retires that row; ignored for "keep", which changes nothing on it.
    heldVersion: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

const MESSAGES: Record<string, string> = {
  decision: "Say which value stands: keep the held one, or use this instead.",
  reason: "Say why. Both values stay on record, and the reason is what makes the decision readable later.",
  version: "The version this decision was made against is missing.",
  heldVersion: "The held value's version is not a number.",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return json({ ok: false, error: "No such disagreement." }, 404);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return json(
      {
        ok: false,
        code: field === "reason" ? "reason_required" : "invalid",
        error: (typeof field === "string" && MESSAGES[field]) || "That request is not valid.",
        field: issue?.path.join("."),
      },
      400,
    );
  }

  try {
    const result = await withTransaction((txn) =>
      resolveDisagreement(txn, {
        disagreementId: id,
        decision: parsed.data.decision,
        expectedVersion: parsed.data.version,
        heldVersion: parsed.data.heldVersion ?? null,
        reason: parsed.data.reason,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
