// Renaming a configuration. Refused for a name already used under the same
// bill line, retired ones included, and under the record's optimistic lock.
// The rules live in `renameConfiguration` (`src/lib/configuration-add.ts`).
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { renameConfiguration } from "@/lib/configuration-add";

const Body = z.object({ name: z.string().max(200), version: z.number().int().nonnegative() }).strict();

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
  if (!parsed.success) return json({ ok: false, error: "A new name and the version it was changed from are needed." }, 400);

  try {
    const result = await withTransaction((txn) =>
      renameConfiguration(txn, {
        recordId: id,
        name: parsed.data.name,
        expectedVersion: parsed.data.version,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
