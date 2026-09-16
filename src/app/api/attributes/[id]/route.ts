// Taking one spec off a record, and putting it back.
//
// A reason is REQUIRED here, unlike an ordinary answer edit. Retiring destroys
// a statement a document made about an item — the record of what a page said —
// and "why" is the only thing that makes that reversible in the sense that
// matters: somebody can read it later and decide whether it was right.
//
// RETIRING IS REVERSIBLE, because house/data-safety.md says every dismissal
// is: "keep the data and add the way back". A restore can still be refused —
// something else may hold the slot now, or a revised drawing may have
// superseded it — and both refusals name what is in the way.
//
// The guards live in src/lib/attribute-retire.ts, inside the transaction,
// where a check can still abort the write it is checking.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { restoreAttribute, retireAttribute } from "@/lib/attribute-retire";

const Body = z
  .object({
    status: z.enum(["retired", "active"]),
    version: z.number().int().nonnegative(),
    reason: z.string().min(1).max(2000),
    evidence: z
      .object({
        pathname: z.string().min(1).max(1024),
        filename: z.string().max(300).nullable().optional(),
        contentType: z.string().max(200).nullable().optional(),
        size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

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
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json(
      {
        ok: false,
        error:
          issue?.path[0] === "reason"
            ? "Say why this spec is being taken off the item, or put back. It is kept, not deleted, and the reason is what makes it readable later."
            : "That request is not valid.",
        field: issue?.path.join("."),
      },
      400,
    );
  }

  try {
    const result = await withTransaction((txn) =>
      parsed.data.status === "retired"
        ? retireAttribute(txn, {
            attributeId: id,
            expectedVersion: parsed.data.version,
            reason: parsed.data.reason,
            evidence: parsed.data.evidence ?? null,
            actor: user.email,
          })
        : restoreAttribute(txn, {
            attributeId: id,
            expectedVersion: parsed.data.version,
            reason: parsed.data.reason,
            actor: user.email,
          }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
