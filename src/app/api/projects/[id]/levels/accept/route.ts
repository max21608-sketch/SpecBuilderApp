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
// In its FIRST form it accepts only what is ALREADY SUGGESTED. A record with no
// suggestion is untouched — there is nothing to agree with — and a record whose
// level was decided is never revisited.
//
// ============================================================================
// THE SECOND FORM: A LEVEL A PERSON PICKED, ON THE RECORDS THEY NAMED.
//
// Item 1.15. The drawings review is where a level can first be decided from
// evidence — the brass leg is on the drawing, not on the bill — and the card
// there has no suggestion to accept when the app has none, or has one the
// reviewer disagrees with. So the same route takes an explicit level for a
// named set of records, and writes it under ONE change set for the same reason
// the first form does: a card fanning out to three phases is one decision.
//
// IT IS STILL THIS ROUTE. Levels go through one boundary so the two writes
// cannot be confused, which is also why the drawings confirm request carries no
// level: one request writing both a card's specs and a record's level would put
// two decisions behind one acknowledgement.
// ============================================================================
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { acceptSuggestedLevels, setLevelOnRecords } from "@/lib/record-category";
import { ITEM_LEVELS } from "@/lib/spec-vocab";

const Body = z
  .union([
    z
      .object({
        // Named records, one level, one change set. Both halves are required
        // together: a level with no records is a request to set every level on
        // the project, which nothing should be able to ask for by leaving a
        // field out.
        recordIds: z.array(z.string().uuid()).min(1).max(200),
        level: z.enum(ITEM_LEVELS),
      })
      .strict(),
    z
      .object({
        // Null means the whole project. The screens always send a phase.
        runId: z.string().uuid().nullable().optional(),
      })
      .strict(),
  ])
  .default({});

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

  const body = parsed.data;
  try {
    const result = await withTransaction(async (txn) =>
      "recordIds" in body
        ? await setLevelOnRecords(txn, {
            projectId: id,
            recordIds: body.recordIds,
            level: body.level,
            actor: user.email,
          })
        : await acceptSuggestedLevels(txn, { projectId: id, runId: body.runId ?? null, actor: user.email }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
