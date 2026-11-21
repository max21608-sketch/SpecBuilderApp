// Accepting, choosing or clearing an item's gate-model TYPE (0061, decision B).
//
// A sheet covering several of Matthew's types answers for their union, so a
// sofa is asked about a swivel base because an armchair is. The screens show
// each item's SUGGESTED type with its reason (`suggestMatrixType`, computed,
// never stored); this is the only way `spec_records.matrix_type` is written,
// and it is a person's press:
//
//   mode "accept"  the suggestions the screen showed — one record, or "Accept
//                  n suggested types" on a phase. The server re-derives each
//                  suggestion and refuses the whole press if one moved.
//   mode "set"     a type a person chose ("Change…"), or null to go back to
//                  the sheet's union.
//
// Every record carries the version it was drawn at; one that moved refuses
// the whole press with nothing written. One `category_set` change set, one
// version per record (`src/lib/matrix-type-set.ts`).
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { setMatrixTypes } from "@/lib/matrix-type-set";
import { requireUuid, requireWriter } from "@/lib/route-guards";

const Body = z
  .object({
    mode: z.enum(["accept", "set"]),
    records: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            version: z.number().int().positive(),
            matrixType: z.string().trim().min(1).max(20).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
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
  if (!parsed.success) return json({ ok: false, error: "That request is not valid." }, 400);
  const body = parsed.data;
  if (body.mode === "accept" && body.records.some((record) => record.matrixType === null)) {
    return json({ ok: false, error: "An accepted suggestion names the type it accepts." }, 400);
  }
  if (new Set(body.records.map((record) => record.id)).size !== body.records.length) {
    return json({ ok: false, error: "That request names one item twice." }, 400);
  }

  try {
    const result = await withTransaction(
      async (txn) => await setMatrixTypes(txn, { projectId: id, records: body.records, mode: body.mode, actor: user.email }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
