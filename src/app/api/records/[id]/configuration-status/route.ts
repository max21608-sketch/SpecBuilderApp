// Retiring a configuration, or putting one back. A retire needs a reason
// (0038): it takes the configuration out of the export, and when it was the
// last live one it puts its bill line back in. The rules live in
// `setConfigurationStatus` (`src/lib/configuration-add.ts`).
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { setConfigurationStatus } from "@/lib/configuration-add";

const Body = z
  .object({
    status: z.enum(["active", "retired"]),
    version: z.number().int().nonnegative(),
    reason: z.string().max(2000).nullable().optional(),
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
  if (!parsed.success) return json({ ok: false, error: "A status and the version it was changed from are needed." }, 400);

  try {
    const result = await withTransaction((txn) =>
      setConfigurationStatus(txn, {
        recordId: id,
        status: parsed.data.status,
        reason: parsed.data.reason ?? null,
        expectedVersion: parsed.data.version,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
