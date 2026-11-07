// A bill line's twins (0060): the lines it is linked to as one item, the
// lines it could be linked to, and linking one.
//
//   GET  /api/records/<id>/twins      { twins, candidates }
//   POST /api/records/<id>/twins      { otherId, reason }
//
// A link writes no spec and takes no record version; it only decides which
// records a person's later act is OFFERED on (`twin-offer.ts`). The guards
// live in `linkTwins`, inside the transaction: both ends bill lines of one
// project, locked in id order, a reason or an open change.
import { json, sql } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { requireUuid, requireWriter } from "@/lib/route-guards";
import { linkTwins, twinsOf } from "@/lib/record-twins";
import { recordLabel } from "@/lib/record-label";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  const badId = requireUuid(id);
  if (badId) return badId;

  const me = await sql`select id, project_id, parent_id from spec_records where id = ${id}`;
  if (!me[0]) return json({ ok: false, error: "No such record." }, 404);
  const twins = await twinsOf(sql, id);
  // WHAT IT COULD BE LINKED TO: the project's other live bill lines. Not a
  // configuration (it carries its bill line's twins) and not one already
  // linked. Every phase, the mock-up included (T2: a twin may cross phases).
  const taken = [id, ...twins.map((twin) => twin.recordId)];
  const rows = me[0].parent_id
    ? []
    : await sql`
        select r.id, r.record_no, r.item_description, r.area, run.name as run_name, p.bws_project_number,
               coalesce((select array_agg(x.ref_value order by x.ref_value)
                           from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code'), '{}') as boq_codes
          from spec_records r
          join spec_runs run on run.id = r.run_id and run.status = 'active'
          join projects p on p.id = r.project_id
         where r.project_id = ${me[0].project_id} and r.status = 'active' and r.parent_id is null
           and not (r.id = any(${taken}::uuid[]))
         order by run.sort_order, r.record_no
      `;
  const candidates = rows.map((row) => ({
    recordId: String(row.id),
    label: recordLabel(String(row.bws_project_number), Number(row.record_no)),
    itemDescription: String(row.item_description),
    area: row.area === null || row.area === undefined ? null : String(row.area),
    runName: String(row.run_name),
    boqCodes: ((row.boq_codes as unknown[] | null) ?? []).map(String),
  }));
  return json({ ok: true, twins, candidates });
}

const Body = z
  .object({
    otherId: z.string().uuid(),
    reason: z.string().max(2000).nullable().optional(),
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
  if (!parsed.success) return json({ ok: false, error: "Name the line this one is a twin of." }, 400);

  try {
    const result = await withTransaction((txn) =>
      linkTwins(txn, { recordId: id, otherId: parsed.data.otherId, reason: parsed.data.reason ?? null, actor: user.email }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
