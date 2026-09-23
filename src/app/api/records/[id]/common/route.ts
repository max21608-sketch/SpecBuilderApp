// A spec COMMON to every configuration of a bill line, edited once.
//
// ============================================================================
// THE BOUNDARY. The rules live in src/lib/configuration-family.ts, inside the
// transaction, where a refusal can still abort every write it would have
// made. This route parses, checks the session and hands over.
//
// Four ops, each fanned out to every live configuration as ONE change with
// one version per configuration:
//
//   correct  a common row gets a new value (attribute_correct, reason required)
//   retire   a common row comes off every configuration (attribute_retire, reason required)
//   add      a spec none of them holds goes onto all of them (attribute_create)
//   answer   a checklist question answered identically everywhere is answered
//            once for all of them (manual_edit)
//
// Every op carries what the screen SHOWED — the configurations, and each
// row's or answer's version — and is refused WHOLE, with a 409 in words and
// nothing written, if any of it moved or the row is no longer common. Middleware
// gates the writer roles; this checks the session, as every write route does.
// ============================================================================
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { editCommonSpec } from "@/lib/configuration-family";
import { ATTRIBUTE_GROUPS, ATTRIBUTE_UNITS, DIMENSION_SLOTS } from "@/lib/spec-vocab";

export const dynamic = "force-dynamic";

const ids = z.array(z.string().uuid()).min(2).max(200);
const seenAttributes = z
  .array(z.object({ attributeId: z.string().uuid(), version: z.number().int().nonnegative() }).strict())
  .min(1)
  .max(200);

const Body = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("correct"),
      groupKey: z.string().min(1).max(400),
      value: z.string().max(4000).nullable(),
      unit: z.enum(ATTRIBUTE_UNITS).nullable(),
      state: z.enum(["confirmed", "tbc"]),
      reason: z.string().max(2000).nullable().optional(),
      configurations: ids,
      seen: seenAttributes,
    })
    .strict(),
  z
    .object({
      op: z.literal("retire"),
      groupKey: z.string().min(1).max(400),
      reason: z.string().min(1).max(2000),
      configurations: ids,
      seen: seenAttributes,
    })
    .strict(),
  z
    .object({
      op: z.literal("add"),
      attrGroup: z.enum(ATTRIBUTE_GROUPS),
      label: z.string().min(1).max(300),
      value: z.string().max(20000).nullable(),
      unit: z.enum(ATTRIBUTE_UNITS).nullable().optional(),
      qualifier: z.string().max(2000).nullable().optional(),
      dimensionSlot: z.enum(DIMENSION_SLOTS).nullable().optional(),
      specFieldId: z.string().uuid().nullable().optional(),
      state: z.enum(["confirmed", "tbc"]),
      reason: z.string().max(2000).nullable().optional(),
      seen: z
        .array(z.object({ recordId: z.string().uuid(), version: z.number().int().nonnegative() }).strict())
        .min(2)
        .max(200),
    })
    .strict(),
  z
    .object({
      op: z.literal("answer"),
      requirementId: z.string().uuid(),
      value: z.string().max(4000).nullable(),
      qualifier: z.string().max(2000).nullable().optional(),
      state: z.enum(["confirmed", "tbc", "na"]),
      reason: z.string().max(2000).nullable().optional(),
      configurations: ids,
      seen: z
        .array(z.object({ answerId: z.string().uuid(), version: z.number().int().nonnegative() }).strict())
        .min(1)
        .max(200),
    })
    .strict(),
]);

const MESSAGES: Record<string, string> = {
  reason: "Say why. A common edit changes every configuration, and the reason is what makes it readable later.",
  seen: "The rows this edit was made against are missing — reload and try again.",
  configurations: "The configurations this edit was made against are missing — reload and try again.",
  value: "That value is too long, or is not text.",
  unit: "A unit is one of mm, cm, m or in, or none at all.",
  state: "A spec is confirmed or TBC.",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
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
    const field = issue?.path[0];
    return json(
      {
        ok: false,
        error: (typeof field === "string" && MESSAGES[field]) || issue?.message || "That request is not valid.",
        field: issue?.path.join("."),
      },
      400,
    );
  }

  try {
    const result = await withTransaction((txn) => editCommonSpec(txn, { lineId: id, edit: parsed.data, actor: user.email }));
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
