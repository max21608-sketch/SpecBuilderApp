// A confirmed bill's own spreadsheet, registered as a specification document
// and read — one charged read, stated on the button that calls this.
//
// See `src/lib/bill-specifications.ts` for why nothing downstream is new, and
// why a second press returns the run the first one made. The registration is
// committed first and the read published after it, the protocol every
// registration uses (`src/lib/spec-registration.ts`).
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { registerBillSpecifications } from "@/lib/bill-specifications";
import { dispatchRegisteredRead } from "@/lib/spec-registration";

export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  try {
    const result = await withTransaction((txn) => registerBillSpecifications(txn, { billRunId: id, actor: user.email }));
    if (result.reused) return json({ ok: true, importId: result.importId, reused: true }, 200);
    return json(
      { ok: true, importId: result.importId, reused: false, autoRead: await dispatchRegisteredRead(result, user.email) },
      201,
    );
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
