// POST /api/projects/[id]/designer — "Set designer…" on the ticked items of a
// phase (2026-11-20, U2). Every record goes through `editRecordDetails`, the
// function the record Edit panel's PATCH calls, with the version the screen
// showed; `src/lib/designer-batch.ts` says what that keeps and why one change
// set is opened per record.
//
// A refusal of ONE item is reported in the body beside what was set, not as
// the response's status: a stale row costs only itself. The request as a whole
// is refused (400, 404) only when it cannot be read or names no project.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { setDesignerOnRecords } from "@/lib/designer-batch";
import { requireUuid, requireWriter } from "@/lib/route-guards";

export const dynamic = "force-dynamic";
// 500 items in one transaction, a savepoint each: seconds, not minutes, but
// more than the platform's default allows on a cold database.
export const maxDuration = 60;

const Body = z
  .object({
    designer: z.string().max(200),
    records: z
      .array(z.object({ id: z.string().uuid(), version: z.number().int().nonnegative() }).strict())
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
  if (!parsed.success) {
    return json(
      { ok: false, code: "designer_request_invalid", error: "Tick at least one item (at most 500) and type a designer code of at most 200 characters." },
      400,
    );
  }

  try {
    const result = await withTransaction((txn) =>
      setDesignerOnRecords(txn, {
        projectId: id,
        designer: parsed.data.designer,
        records: parsed.data.records,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
