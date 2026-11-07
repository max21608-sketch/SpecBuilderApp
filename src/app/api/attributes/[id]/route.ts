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
import { restoreAttribute } from "@/lib/attribute-retire";
import { retireAttributeWithTwins } from "@/lib/twin-writes";
import { verifyEvidence } from "@/lib/change-sets";
import { requireUuid, requireWriter } from "@/lib/route-guards";

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
    // 0060: the twins a person ticked. Re-read under the lock and checked
    // against the offer the screen drew (`twin-writes.ts`), never believed.
    alsoRecords: z
      .array(
        z
          .object({
            recordId: z.string().uuid(),
            attributeId: z.string().uuid().nullable().optional(),
            version: z.number().int().nonnegative().nullable().optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;
  const { id } = await context.params;
  const badId = requireUuid(id);
  if (badId) return badId;

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

  // Putting a spec back is one item at a time: what its twin holds now may be
  // a later value, and a restore that reached it would retire that unseen.
  if (parsed.data.status === "active" && (parsed.data.alsoRecords?.length ?? 0) > 0) {
    return json({ ok: false, error: "Put a spec back on one item at a time.", field: "alsoRecords" }, 400);
  }

  // The store is asked about any evidence before the transaction (audit A15).
  const evidence = await verifyEvidence(parsed.data.evidence);
  try {
    const result = await withTransaction((txn) =>
      parsed.data.status === "retired"
        ? retireAttributeWithTwins(txn, {
            attributeId: id,
            expectedVersion: parsed.data.version,
            reason: parsed.data.reason,
            evidence,
            actor: user.email,
            alsoRecords: parsed.data.alsoRecords ?? [],
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
