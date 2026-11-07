// Accepting the bill review's twin suggestions (0060).
//
//   POST /api/imports/<run>/twins
//   { sheetIndex, accept: [{ index, version }], clear: [{ index, version }] }
//
// A line is accepted as the twin the review SUGGESTED for it, never one the
// request names: the server re-reads the sheet under the run's lock and takes
// `suggestTwins`' own answer (`stageBillTwins`). Nothing here creates a link;
// the bill confirm links the records the accepted lines become.
//
// Its own route rather than an action on `/api/imports/[id]`, so the staged
// shape it writes is reached by one door with one body.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { requireUuid, requireWriter } from "@/lib/route-guards";
import { stageBillTwins } from "@/lib/bill-twins";

export const dynamic = "force-dynamic";

const Entry = z.object({ index: z.number().int().nonnegative(), version: z.number().int().nonnegative() }).strict();
const Body = z
  .object({
    sheetIndex: z.number().int().nonnegative(),
    accept: z.array(Entry).max(2000).default([]),
    clear: z.array(Entry).max(2000).default([]),
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
  if (!parsed.success) return json({ ok: false, error: "Name the tab and the rows to accept or take back." }, 400);
  if (parsed.data.accept.length === 0 && parsed.data.clear.length === 0) {
    return json({ ok: false, error: "Name the rows to accept or take back." }, 400);
  }

  try {
    const result = await withTransaction((txn) =>
      stageBillTwins(txn, { runId: id, ...parsed.data, actor: user.email }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
