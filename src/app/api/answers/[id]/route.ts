// Editing one answer, under the optimistic lock.
//
// The contract from 0001: the client sends the version it read, the update is
// predicated on it, and zero rows back means somebody else changed the row
// first. That is a 409 naming the field, never a silent overwrite of their
// work. bump_version() and write_audit() do the rest in the database.
//
// Since 0012 the edit also belongs to a CHANGE SET, which is why it runs in a
// transaction rather than as one autocommitted statement — see answer-edit.ts
// for why that is not optional. The guards live there; this is the boundary.
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { editAnswer } from "@/lib/answer-edit";
import { readAnswerBody } from "@/lib/answer-body";
import { verifyEvidence } from "@/lib/change-sets";
import { requireUuid, requireWriter } from "@/lib/route-guards";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
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

  // The value, state, qualifier, reason and attachment are read by the one
  // reader the no-row route shares (`answer-body.ts`), including the two
  // sentences the database would otherwise answer with a constraint name.
  const read = readAnswerBody(body);
  if (!read.ok) return json({ ok: false, error: read.error }, 400);
  const { value, qualifier, state, reason } = read.answer;
  const version = typeof body.version === "number" ? body.version : null;
  if (version === null) return json({ ok: false, error: "version is required." }, 400);

  // The email that asked for the change, already uploaded to this project's
  // own blob prefix by the browser. A PATHNAME, never a URL — the store
  // resolves it against its own host from the token, so there is no host to
  // influence and no redirect to follow. Re-checked against the project
  // inside the transaction. The store is asked about it HERE, before the
  // transaction (audit A15).
  const evidence = await verifyEvidence(read.answer.evidence);

  try {
    const result = await withTransaction((txn) =>
      editAnswer(txn, {
        answerId: id,
        value,
        qualifier,
        state,
        expectedVersion: version,
        reason,
        evidence,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
