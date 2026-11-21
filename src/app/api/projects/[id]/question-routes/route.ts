// "Ask the client" for one question on one project, and back (0062, decision D).
//
// POST { questionKey, askClient: true }   the question goes to the chase here.
// POST { questionKey, askClient: false }  it goes back to whoever the cheat
//                                         sheet says answers it.
//
// The rules live in src/lib/question-routes.ts, inside the transaction; this
// parses, checks the session and hands over. A refusal is a sentence a person
// reads (`DomainConflictError`), never a bare status.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { transactionErrorResponse, withTransaction } from "@/lib/db-transaction";
import { setQuestionRoute } from "@/lib/question-routes";
import { requireUuid, requireWriter } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

const Body = z.object({ questionKey: z.string().min(1).max(600), askClient: z.boolean() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;
  const { id: projectId } = await context.params;
  const badId = requireUuid(projectId);
  if (badId) return badId;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "That request is not valid." }, 400);

  try {
    const result = await withTransaction((txn) =>
      setQuestionRoute(txn, { projectId, questionKey: parsed.data.questionKey, askClient: parsed.data.askClient, actor: user.email }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
