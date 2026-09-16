// Linking one item's spec to a finish, or letting it stand on its own words.
//
// Unlinking needs a reason: the item stops following the library, so a later
// correction to the code will not reach it, and whoever finds that later needs
// to know it was deliberate.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { setAttributeFinish } from "@/lib/finish-edit";

const Body = z
  .object({
    finishId: z.string().uuid().nullable(),
    version: z.number().int().nonnegative(),
    reason: z.string().max(2000).optional(),
  })
  .strict();

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
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "That change is not valid." }, 400);

  if (parsed.data.finishId === null && !parsed.data.reason?.trim()) {
    return json(
      {
        ok: false,
        code: "reason_required",
        error:
          "Say why this item stops following the library. Once unlinked, correcting the finish code will not reach it.",
        field: "reason",
      },
      400,
    );
  }

  try {
    const result = await withTransaction((txn) =>
      setAttributeFinish(txn, {
        attributeId: id,
        finishId: parsed.data.finishId,
        expectedVersion: parsed.data.version,
        reason: parsed.data.reason ?? "Linked to the project's finishes library.",
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
