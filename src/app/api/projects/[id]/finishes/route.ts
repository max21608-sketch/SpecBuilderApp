// The project's finishes library: every client finish code, and what uses it.
//
// Keyed by the client's own code, because that is the identity the client, the
// drawings and the FF&E schedule all use — and, for the pilot, the only one:
// the finishes schedule is confirmed absent, so these codes exist nowhere but
// on the drawings.
import { sql, json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { createFinish } from "@/lib/finish-edit";
import { FINISH_KINDS } from "@/lib/finishes";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const projects = await sql`select id, bws_project_number, name from projects where id = ${id}`;
  const project = projects[0];
  if (!project) return json({ ok: false, error: "No such project." }, 404);

  // Sorted by the normalised code, because that is how a person scans a
  // schedule. Each finish carries the items that use it: "which line items
  // does this apply on" is the question the library exists to answer.
  const finishes = await sql`
    select f.id, f.code, f.code_norm, f.kind, f.description, f.supplier_raw, f.reference, f.colour,
           f.notes, f.state, f.status, f.version, f.retired_at, f.retired_by, f.updated_at, f.updated_by,
           (select at.id from attachments at
             where at.entity_type = 'project_finishes' and at.entity_id = f.id and at.kind = 'finish_swatch'
               and at.superseded_at is null
             order by at.created_at desc limit 1) as swatch_attachment_id,
           coalesce((
             select json_agg(json_build_object(
                      'recordId', r.id,
                      'label', p.bws_project_number || '-' || lpad(r.record_no::text, 3, '0'),
                      'itemDescription', r.item_description,
                      'runName', run.name,
                      'attributeLabel', a.label
                    ) order by r.record_no)
             from record_attributes a
             join spec_records r on r.id = a.record_id
             join spec_runs run on run.id = r.run_id
             join projects p on p.id = r.project_id
             where a.finish_id = f.id and a.status = 'active' and r.status = 'active'
           ), '[]'::json) as used_on
    from project_finishes f
    where f.project_id = ${id}
    order by f.status, f.code_norm
  `;

  // Codes the drawings carry that are NOT in the library. Named rather than
  // counted: an unlinked code is a finish nobody can correct once, which is
  // the whole point of the register.
  const unlinked = await sql`
    select upper(btrim(a.material_code)) as code, count(distinct a.record_id)::int as records
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where r.project_id = ${id}
      and a.status = 'active'
      and r.status = 'active'
      and a.material_code is not null
      and btrim(a.material_code) <> ''
      and a.finish_id is null
    group by upper(btrim(a.material_code))
    order by 1
  `;

  return json({
    ok: true,
    project: { id, number: String(project.bws_project_number), name: String(project.name) },
    finishes,
    unlinked,
    kinds: FINISH_KINDS,
  });
}

const Create = z
  .object({
    code: z.string().min(1).max(120),
    kind: z.enum(FINISH_KINDS).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    supplierRaw: z.string().max(300).nullable().optional(),
    reference: z.string().max(300).nullable().optional(),
    colour: z.string().max(200).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    state: z.enum(["confirmed", "tbc"]).optional(),
  })
  .strict();

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
  const parsed = Create.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "A finish needs the client's own code.", field: parsed.error.issues[0]?.path.join(".") }, 400);
  }

  try {
    const finishId = await withTransaction(async (txn) => {
      await openChangeSet(txn, {
        projectId: id,
        kind: "finish_link",
        actor: user.email,
        reason: `Added ${parsed.data.code.trim()} to the finishes library.`,
      });
      return createFinish(txn, { projectId: id, fields: { ...parsed.data, code: parsed.data.code }, actor: user.email });
    });
    return json({ ok: true, finishId });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
