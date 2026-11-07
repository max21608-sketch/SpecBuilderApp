// Typing one spec value by hand.
//
// ============================================================================
// THE SINGLE `insert into record_attributes` USED TO BE confirm-drawings.ts.
//
// Which meant a spec value could only exist if a document had said it and a
// reviewer had confirmed a card. `record_attributes` is requirement-free
// precisely so a statement the checklist has no question for can still be
// recorded — and until 0028 there was no way to record one.
//
// The guards live in src/lib/manual-capture.ts, inside the transaction, where
// a check can still abort the write it is checking. This is the boundary.
//
// A typed attribute carries NO source run and NO page, and that is the honest
// shape: a spec somebody typed is a spec with no page to turn to.
// ============================================================================
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { createAttributeWithTwins } from "@/lib/twin-writes";
import { ATTRIBUTE_GROUPS, ATTRIBUTE_UNITS, DIMENSION_SLOTS } from "@/lib/spec-vocab";
import { requireWriter } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    recordId: z.string().uuid(),
    attrGroup: z.enum(ATTRIBUTE_GROUPS),
    label: z.string().min(1).max(300),
    value: z.string().max(20000).nullable(),
    qualifier: z.string().max(2000).nullable().optional(),
    unit: z.enum(ATTRIBUTE_UNITS).nullable().optional(),
    dimensionSlot: z.enum(DIMENSION_SLOTS).nullable().optional(),
    specFieldId: z.string().uuid().nullable().optional(),
    materialCode: z.string().max(200).nullable().optional(),
    state: z.enum(["confirmed", "tbc"]),
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

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That is not a spec value.", field: issue?.path.join(".") }, 400);
  }

  try {
    const result = await withTransaction((txn) =>
      createAttributeWithTwins(txn, { ...parsed.data, alsoRecords: parsed.data.alsoRecords ?? [], actor: user.email }),
    );
    return json({ ok: true, ...result }, 201);
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
