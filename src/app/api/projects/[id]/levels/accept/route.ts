// Accepting the levels this app suggested, a run at a time.
//
// WHY A BULK ROUTE AT ALL. A level is a person's decision and stays one — the
// gate reads `spec_records.level`, which nothing but a person fills. But a
// 59-line bill produces 59 suggestions, and a decision that costs 59 visits is
// a decision nobody takes: the screen would go on saying "Set level" for ever
// and every chase would go on being blocked. So the reviewer reads the run's
// levels on one screen, with what each was guessed from beside it, and says
// yes once. That is the same shape as a drawing card writing several answers
// from one confirm: the gate is that nothing is accepted unseen, not that each
// row costs its own click.
//
// It accepts only what is ALREADY SUGGESTED. A record with no suggestion is
// untouched — there is nothing to agree with — and a record whose level was
// decided is never revisited.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { acceptSuggestedLevels } from "@/lib/record-category";

const Body = z
  .object({
    // Null means the whole project. The screens always send a run.
    runId: z.string().uuid().nullable().optional(),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) raw = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "That request is not valid." }, 400);

  try {
    const result = await withTransaction((txn) =>
      acceptSuggestedLevels(txn, { projectId: id, runId: parsed.data.runId ?? null, actor: user.email }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
