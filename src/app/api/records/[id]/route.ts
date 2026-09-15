// One spec record: what documents have said about it, and what its category's
// checklist still asks.
//
// The ATTRIBUTES come first in the payload and on the screen, because they are
// the intake stage's product: statements a client document made about this
// item, each traceable to a page. The cheat-sheet answers are a later stage's
// measure and may not even be assigned yet.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { setRecordCategory } from "@/lib/record-category";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  const rows = await sql`
    select r.id, r.record_no, r.item_description, r.product_reference, r.qty, r.designer, r.area,
           r.boq_category, r.status, r.version, r.source_line_no, r.category_id,
           p.bws_project_number, p.name as project_name, p.id as project_id,
           run.id as run_id, run.name as run_name,
           c.name as category_name, c.family as category_family, c.requirements_authored
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    left join item_categories c on c.id = r.category_id
    where r.id = ${id}
  `;
  const record = rows[0];
  if (!record) return json({ ok: false, error: "No such record." }, 404);

  const refs = await sql`
    select ref_system, ref_value, source from spec_record_refs where record_id = ${id} order by ref_system, ref_value
  `;

  // The document's own words, with the page they came from. `source_filename`
  // and `source_page` are what make a value re-checkable: a value whose source
  // cannot be named is a value nobody can question.
  const attributes = await sql`
    select a.id, a.attr_group, a.label, a.value, a.unit, a.dimension_slot, a.material_code, a.state, a.status,
           a.sort_order, a.version, a.source_page, a.source_run_id, a.created_at, a.created_by,
           f.name as field_name, f.json_id, f.field_category,
           src.filename as source_filename, src.document_kind as source_document_kind
    from record_attributes a
    left join spec_fields f on f.id = a.spec_field_id
    left join (
      select r.id, r.document_kind, at.filename
      from intake_runs r left join attachments at on at.id = r.attachment_id
    ) src on src.id = a.source_run_id
    where a.record_id = ${id} and a.status = 'active'
    order by a.attr_group, a.sort_order, a.created_at
  `;

  // LEFT JOIN from requirements: a question with no answer row must still be
  // asked, as `missing`. An uncategorised record has no questions at all —
  // which is NOT the same as having none outstanding, and the screen says so.
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

  const categories = await sql`
    select id, slug, family, name, requirements_authored from item_categories order by family, sort_order
  `;

  return json({ ok: true, record, refs, attributes, answers, categories });
}

const Patch = z
  .object({
    categoryId: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Sets the record's category, and creates the answer rows that go with it.
 *
 * This exists because intake no longer blocks on a category: without it, a
 * record imported without one could never acquire one. Creating the answers in
 * the same transaction matters — a category with no answers scores 0/0 and
 * reads as complete, the same class of error as an empty programme rendering
 * as a healthy one.
 */
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
    return json({ ok: false, error: issue?.message ?? "That change is not valid.", field: issue?.path.join(".") }, 400);
  }

  try {
    const result = await withTransaction((txn) =>
      setRecordCategory(txn, {
        recordId: id,
        categoryId: parsed.data.categoryId,
        expectedVersion: parsed.data.version,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
