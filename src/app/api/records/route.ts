// The completion view's data. One row per spec record with its counts.
//
// The counts are computed from `requirements LEFT JOIN spec_answers`, not from
// answers alone: a requirement with no answer row is MISSING, and driving off
// answers would make it invisible. Readiness and spec-field requirements are
// counted separately -- a record whose BWS fields are all confirmed but whose
// deposit is unresolved is not ready, and one number would hide that.
import { sql, json } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return json({ ok: false, error: "projectId is required." }, 400);

  const rows = await sql`
    select
      r.id,
      r.record_no,
      r.item_description,
      r.product_reference,
      r.qty,
      r.designer,
      r.area,
      r.status,
      c.name  as category_name,
      c.family as category_family,
      c.requirements_authored,
      (select string_agg(x.ref_value, ', ' order by x.ref_value)
         from spec_record_refs x where x.record_id = r.id) as refs,
      count(q.id) filter (where q.kind = 'spec_field') as spec_total,
      count(q.id) filter (where q.kind = 'spec_field' and a.state in ('confirmed','na')) as spec_settled,
      count(q.id) filter (where q.kind = 'spec_field' and a.state = 'tbc') as spec_tbc,
      count(q.id) filter (where q.kind = 'spec_field' and (a.state = 'missing' or a.id is null)) as spec_missing,
      count(q.id) filter (where q.kind = 'readiness') as ready_total,
      count(q.id) filter (where q.kind = 'readiness' and a.state in ('confirmed','na')) as ready_settled,
      count(q.id) filter (where q.kind = 'readiness' and a.state = 'tbc') as ready_tbc,
      count(q.id) filter (where q.kind = 'readiness' and (a.state = 'missing' or a.id is null)) as ready_missing
    from spec_records r
    left join item_categories c on c.id = r.category_id
    left join requirements q on q.category_id = r.category_id
    left join spec_answers a on a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
    where r.project_id = ${projectId}
    group by r.id, c.name, c.family, c.requirements_authored
    order by r.record_no
  `;
  return json({ ok: true, records: rows });
}
