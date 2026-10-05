// A finishes schedule's own file, registered again as an FF&E schedule and
// read for its FURNITURE — one charged read, stated on the button that calls
// this. See `src/lib/tracker-furniture.ts` for why, and why a second press
// returns the run the first one made. Writer roles only, by the middleware's
// allowlist on every mutating API request.
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { registerTrackerFurniture } from "@/lib/tracker-furniture";
import { dispatchRegisteredRead } from "@/lib/spec-registration";

export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  try {
    const result = await withTransaction((txn) => registerTrackerFurniture(txn, { finishesRunId: id, actor: user.email }));
    if (result.reused) return json({ ok: true, importId: result.importId, reused: true }, 200);
    return json(
      { ok: true, importId: result.importId, reused: false, autoRead: await dispatchRegisteredRead(result, user.email) },
      201,
    );
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
