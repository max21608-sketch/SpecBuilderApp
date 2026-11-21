// Answering a checklist question this record has NO answer row for yet.
//
// A question a seed added to the record's cheat sheet after the record was
// categorised is listed on every screen and had nowhere to be recorded
// (review 1, finding 1). The record screen's checklist and the fill-in screen
// post here, with the question's requirement id, where a row exists they
// PATCH `/api/answers/[id]` as always. The row is created inside the answer's
// own change set and record lock (`answer-rows.ts`), and the answer is the
// ordinary edit.
//
// The body is the PATCH route's, read by the same reader (`answer-body.ts`),
// with `requirementId` in place of a version: there is no row to have one.
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { answerQuestionWithoutRow } from "@/lib/answer-rows";
import { readAnswerBody } from "@/lib/answer-body";
import { verifyEvidence } from "@/lib/change-sets";
import { requireUuid, requireWriter } from "@/lib/route-guards";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;
  const { id } = await context.params;
  const badId = requireUuid(id);
  if (badId) return badId;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object") return json({ ok: false, error: "invalid JSON" }, 400);

  const requirementId = typeof body.requirementId === "string" ? body.requirementId : "";
  if (!requirementId) return json({ ok: false, error: "requirementId is required." }, 400);
  const badRequirement = requireUuid(requirementId);
  if (badRequirement) return badRequirement;

  const read = readAnswerBody(body);
  if (!read.ok) return json({ ok: false, error: read.error }, 400);
  const { value, qualifier, state, reason } = read.answer;
  // Asked of the store before the transaction (audit A15), as the PATCH does.
  const evidence = await verifyEvidence(read.answer.evidence);

  try {
    const result = await withTransaction((txn) =>
      answerQuestionWithoutRow(txn, {
        recordId: id,
        requirementId,
        value,
        qualifier,
        state,
        reason,
        evidence,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result }, 201);
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
