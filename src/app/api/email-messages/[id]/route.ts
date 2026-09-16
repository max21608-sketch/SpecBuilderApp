// One email: assign it to a project, take it off one, or rule that it needs
// nothing.
//
// Assigning is the only action here that spends money — it starts the model
// read — so it is the one the screen states a charge for.
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { transactionErrorResponse } from "@/lib/db-transaction";
import { assignMessage, triageMessage, unassignMessage } from "@/lib/email-registration";

export const dynamic = "force-dynamic";

/**
 * Exactly one action per request. A union rather than optional fields: each is
 * its own decision with its own consequences, and a body carrying two would
 * have to choose an order for them.
 */
const Patch = z.union([
  z.object({ action: z.literal("assign"), projectId: z.string().uuid(), version: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("unassign"), version: z.number().int().nonnegative() }).strict(),
  z
    .object({
      action: z.literal("triage"),
      triage: z.enum(["open", "nothing_to_record", "not_specification"]),
      version: z.number().int().nonnegative(),
    })
    .strict(),
]);

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
  const parsed = Patch.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That change is not valid." }, 400);
  }
  const body = parsed.data;

  try {
    if (body.action === "assign") {
      const result = await assignMessage({
        messageId: id,
        projectId: body.projectId,
        kind: "manual",
        actor: user.email,
        expectedVersion: body.version,
      });
      return json({ ok: true, ...result });
    }
    if (body.action === "unassign") {
      return json({ ok: true, ...(await unassignMessage(id, { actor: user.email, expectedVersion: body.version })) });
    }
    return json({
      ok: true,
      ...(await triageMessage(id, { triage: body.triage, actor: user.email, expectedVersion: body.version })),
    });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
