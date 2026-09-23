// Adding a configuration to a bill line by hand.
//
// GET is the offer: every statement the bill line holds that could be carried,
// with its id, version and source, and the names already used under it. POST
// is the add, and it sends back IDS AND VERSIONS ONLY — what the panel showed
// and what the person left ticked. The route re-derives the offer from the live
// rows inside the transaction and refuses when it is not what was shown, so the
// sentence the person agreed to ("these stop being exported") is about the rows
// that are actually there. The rules live in `src/lib/configuration-add.ts`.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { addConfiguration, loadCarryOffer, loadOtherPhases } from "@/lib/configuration-add";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  try {
    const offer = await loadCarryOffer(sql, id);
    // The same bill line on the other live phases, each with ITS OWN offer —
    // never this one's, because the phases can differ.
    const phases = await loadOtherPhases(sql, id);
    const otherPhases = [];
    for (const phase of phases) {
      otherPhases.push({ ...phase, offer: phase.billLineId ? await loadCarryOffer(sql, phase.billLineId) : null });
    }
    return json({ ok: true, ...offer, otherPhases });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

const Ref = z
  .object({
    kind: z.enum(["attribute", "answer", "dimension_note"]),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();

const Phase = z
  .object({
    billLineId: z.string().uuid(),
    shown: z.array(Ref).max(2000),
    carry: z.array(Ref).max(2000),
  })
  .strict();

const Body = z
  .object({
    name: z.string().max(200),
    shown: z.array(Ref).max(2000),
    carry: z.array(Ref).max(2000),
    phases: z.array(Phase).max(50).optional(),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  // Middleware is the authorization boundary and already gates writer roles.
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
    const result = await withTransaction((txn) =>
      addConfiguration(txn, {
        billLineId: id,
        name: parsed.data.name,
        shown: parsed.data.shown,
        carry: parsed.data.carry,
        phases: parsed.data.phases ?? [],
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
