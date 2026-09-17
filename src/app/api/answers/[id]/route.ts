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
import { z } from "zod";
import { isAnswerState, type AnswerState } from "@/lib/spec-vocab";

const Evidence = z
  .object({
    pathname: z.string().min(1).max(1024),
    filename: z.string().max(300).nullable().optional(),
    contentType: z.string().max(200).nullable().optional(),
    size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
  })
  .strict()
  .nullable();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let body: {
    value?: unknown;
    qualifier?: unknown;
    state?: unknown;
    version?: unknown;
    reason?: unknown;
    evidence?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  if (!isAnswerState(body.state)) {
    return json({ ok: false, error: "A state of confirmed, tbc, missing or na is required." }, 400);
  }
  const state: AnswerState = body.state;
  const version = typeof body.version === "number" ? body.version : null;
  if (version === null) return json({ ok: false, error: "version is required." }, 400);

  const raw = typeof body.value === "string" ? body.value.trim() : "";
  const value = raw === "" ? null : raw;
  // Absent leaves the placement alone; an empty string clears it. A screen that
  // sends only the value must not silently drop a qualifier somebody typed.
  const qualifier =
    body.qualifier === undefined
      ? undefined
      : typeof body.qualifier === "string" && body.qualifier.trim()
        ? body.qualifier.trim()
        : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;

  // The email that asked for the change, already uploaded to this project's
  // own blob prefix by the browser. A PATHNAME, never a URL — the store
  // resolves it against its own host from the token, so there is no host to
  // influence and no redirect to follow. Re-checked against the project
  // inside the transaction.
  const parsedEvidence = Evidence.safeParse(body.evidence ?? null);
  if (!parsedEvidence.success) {
    return json({ ok: false, error: "That attachment is not valid." }, 400);
  }
  const evidence = parsedEvidence.data;

  // The database refuses `confirmed` without a value and an actor, and refuses
  // a value on `na`. Saying so here gives the reviewer a sentence rather than a
  // constraint violation.
  if (state === "confirmed" && !value) {
    return json({ ok: false, error: "Confirmed needs a value. Use TBC if it is not decided yet." }, 400);
  }
  if (state === "na" && value) {
    return json({ ok: false, error: "N/A cannot carry a value." }, 400);
  }

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
