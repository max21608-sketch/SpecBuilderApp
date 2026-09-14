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
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return json({ ok: false, error: "projectId is required." }, 400);
  // Which run (BOQ tab) to show. Absent means the whole project.
  const runId = url.searchParams.get("runId");

  // The programme the completion view measures Overdue against. Overdue is
  // COMPUTED from this date, never stored: writing it onto spec_answers would
  // bump the version M2's extraction snapshots are taken against, exactly as
  // Waiting would. A null date means "no programme", which the client must not
  // render as "on time".
  const projectRows = await sql`
    select order_date::text, specs_agreed_by::text, delivery_date::text
    from projects where id = ${projectId}
  `;
  if (!projectRows[0]) return json({ ok: false, error: "No such project." }, 404);
  // ::text above, not a Date: `pg` parses a date column into LOCAL midnight and
  // toISOString() then renders the day before in British Summer Time. A day is a
  // day; do not give it a timezone to lose.
  const asDate = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value).slice(0, 10);
  const programme = {
    orderDate: asDate(projectRows[0].order_date),
    specsAgreedBy: asDate(projectRows[0].specs_agreed_by),
    deliveryDate: asDate(projectRows[0].delivery_date),
  };

  const rows = await sql`
    select
      r.id,
      r.record_no,
      r.item_description,
      r.product_reference,
      r.qty,
      r.designer,
      r.area,
      r.boq_category,
      r.status,
      r.run_id,
      run.name as run_name,
      -- How much a document has actually said about this item. The intake
      -- stage's own progress measure: the cheat-sheet counts beside it measure
      -- a checklist that may not have been assigned yet.
      (select count(*) from record_attributes ra where ra.record_id = r.id and ra.status = 'active') as attribute_count,
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
    join spec_runs run on run.id = r.run_id
    left join item_categories c on c.id = r.category_id
    left join requirements q on q.category_id = r.category_id
    left join spec_answers a on a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
    where r.project_id = ${projectId}
      and (${runId}::uuid is null or r.run_id = ${runId}::uuid)
    group by r.id, c.name, c.family, c.requirements_authored, run.name, run.sort_order
    order by run.sort_order, r.record_no
  `;

  return json({ ok: true, programme, records: rows });
}
