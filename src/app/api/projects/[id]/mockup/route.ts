// "Also in a mock-up phase": the selected items, put on the project's mock-up
// phase as well as the phase they are on. The rules -- what is copied, what is
// not, and why the act is idempotent -- live in `src/lib/mockup-phase.ts`.
//
// The ids are the ONLY input. The server finds or makes the phase, and the
// client does not get to name it: a request naming a phase could put copies on
// a bill's own tab, which is the one thing this action must never do.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { addToMockupPhase } from "@/lib/mockup-phase";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    recordIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return json({ ok: false, error: "No such project." }, 404);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "Select at least one item to add to the mock-up phase." }, 400);

  try {
    const result = await withTransaction((txn) =>
      addToMockupPhase(txn, { projectId: id, recordIds: parsed.data.recordIds, actor: user.email }),
    );
    return json({ ok: true, ...result }, result.added.length > 0 ? 201 : 200);
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
