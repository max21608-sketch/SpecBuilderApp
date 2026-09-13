// One spec record and every question its category asks, answered or not.
import { sql, json } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  const rows = await sql`
    select r.id, r.record_no, r.item_description, r.product_reference, r.qty, r.designer, r.area,
           r.status, r.version, r.source_line_no,
           p.bws_project_number, p.name as project_name, p.id as project_id,
           c.name as category_name, c.family as category_family, c.requirements_authored
    from spec_records r
    join projects p on p.id = r.project_id
    left join item_categories c on c.id = r.category_id
    where r.id = ${id}
  `;
  const record = rows[0];
  if (!record) return json({ ok: false, error: "No such record." }, 404);

  const refs = await sql`
    select ref_system, ref_value, source from spec_record_refs where record_id = ${id} order by ref_system, ref_value
  `;

  // LEFT JOIN from requirements: a question with no answer row must still be
  // asked, as `missing`.
  const answers = await sql`
    select q.id as requirement_id, q.kind, q.prompt, q.help_text, q.section, q.sort_order,
           f.name as field_name, f.json_id, f.field_category,
           a.id as answer_id, a.value, a.state, a.version, a.confirmed_by, a.confirmed_at
    from requirements q
    left join spec_fields f on f.id = q.spec_field_id
    left join spec_answers a on a.requirement_id = q.id and a.record_id = ${id} and a.revision_no = 0
    where q.category_id = (select category_id from spec_records where id = ${id})
    order by q.sort_order
  `;

  return json({ ok: true, record, refs, answers });
}
