// The BW standard on one spec: propose it, say it is TBC, take it away, or
// record that the client agreed to it (0041).
//
// Two actions on one route because they are one column group and one screen
// control, and a second route would be a second copy of the version check.
// The guards live in `src/lib/attribute-standard.ts`, inside the transaction:
// the version, the option against the field's own list, and the reason
// `standard_change` needs when an AGREED standard is changed or withdrawn.
//
// The option is named by its VALUE. Which option row that is, is the server's
// to resolve -- the `questionTier` rule: the client does not get to say.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { agreeAttributeStandard, setAttributeStandard } from "@/lib/attribute-standard";

const Evidence = z
  .object({
    pathname: z.string().min(1).max(1024),
    filename: z.string().max(300).nullable().optional(),
    contentType: z.string().max(200).nullable().optional(),
    size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
  })
  .strict()
  .nullable()
  .optional();

const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("set"),
      // null takes the standard away; `tbc` is "BW will propose one".
      standard: z
        .union([
          z.object({ state: z.literal("proposed"), value: z.string().min(1).max(4000) }).strict(),
          z.object({ state: z.literal("tbc") }).strict(),
        ])
        .nullable(),
      version: z.number().int().nonnegative(),
      reason: z.string().max(2000).nullable().optional(),
      evidence: Evidence,
    })
    .strict(),
  z
    .object({
      action: z.literal("agree"),
      version: z.number().int().nonnegative(),
      reason: z.string().max(2000).nullable().optional(),
      evidence: Evidence,
    })
    .strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  // Middleware is the authorization boundary and already gates writer roles;
  // this is the session check every write route makes.
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
    return json({ ok: false, error: "That request is not valid.", field: parsed.error.issues[0]?.path.join(".") }, 400);
  }

  try {
    const body = parsed.data;
    const result = await withTransaction((txn) =>
      body.action === "agree"
        ? agreeAttributeStandard(txn, {
            attributeId: id,
            expectedVersion: body.version,
            evidence: body.evidence ?? null,
            reason: body.reason ?? null,
            actor: user.email,
          })
        : setAttributeStandard(txn, {
            attributeId: id,
            expectedVersion: body.version,
            choice: body.standard,
            reason: body.reason ?? null,
            evidence: body.evidence ?? null,
            actor: user.email,
          }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
