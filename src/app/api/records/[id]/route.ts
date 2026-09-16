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
import {
  setRecordCategory,
  setRecordLevel,
  type SetCategoryResult,
  type SetLevelResult,
} from "@/lib/record-category";
import { ITEM_LEVELS } from "@/lib/spec-vocab";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  const rows = await sql`
    select r.id, r.record_no, r.item_description, r.product_reference, r.qty, r.designer, r.area,
           r.boq_category, r.status, r.version, r.source_line_no, r.category_id, r.level,
           r.parent_id, r.variant_label,
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
           a.finish_id, fin.code as finish_code, fin.description as finish_description, fin.state as finish_state,
           src.filename as source_filename, src.document_kind as source_document_kind
    from record_attributes a
    left join spec_fields f on f.id = a.spec_field_id
    left join project_finishes fin on fin.id = a.finish_id
    left join (
      select r.id, r.document_kind, at.filename
      from intake_runs r left join attachments at on at.id = r.attachment_id
    ) src on src.id = a.source_run_id
    where a.record_id = ${id} and a.status = 'active'
    order by a.attr_group, a.sort_order, a.created_at
  `;

  // Retired specs, separately. They are kept as evidence that a document said
  // something, and every dismissal in this app is reversible — so they have to
  // be visible somewhere, or "retire" is a delete with extra steps.
  const retired = await sql`
    select a.id, a.attr_group, a.label, a.value, a.unit, a.dimension_slot, a.material_code, a.state,
           a.sort_order, a.version, a.source_page, a.source_run_id, a.retired_at, a.retired_by,
           a.superseded_by_id,
           f.name as field_name, f.json_id,
           src.filename as source_filename
    from record_attributes a
    left join spec_fields f on f.id = a.spec_field_id
    left join (
      select r.id, r.document_kind, at.filename
      from intake_runs r left join attachments at on at.id = r.attachment_id
    ) src on src.id = a.source_run_id
    where a.record_id = ${id} and a.status = 'retired'
    order by a.retired_at desc nulls last
  `;

  // LEFT JOIN from requirements: a question with no answer row must still be
  // asked, as `missing`. An uncategorised record has no questions at all —
  // which is NOT the same as having none outstanding, and the screen says so.
  const answers = await sql`
    select q.id as requirement_id, q.kind, q.prompt, q.help_text, q.section, q.sort_order,
           q.tgq_levels,
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

  // ---- the fabric split, in both directions -------------------------------
  //
  // A bill line needs its configurations listed, because they are what the
  // export ships and this row is a heading. A configuration needs its bill
  // line named, because its own record number is just the next free one in the
  // project and says nothing about what it belongs to.
  //
  // One query serves both: every live record in this record's family. Ordered
  // with the parent first so a screen can take it off the front.
  const familyId = record.parent_id ? String(record.parent_id) : String(record.id);
  const family = await sql`
    select r.id, r.record_no, r.variant_label, r.qty, r.status, r.item_description,
           (select count(*) from record_attributes ra where ra.record_id = r.id and ra.status = 'active')
             as attribute_count,
           (select string_agg(x.ref_value, ', ' order by x.ref_value)
              from spec_record_refs x where x.record_id = r.id) as refs
      from spec_records r
     where (r.id = ${familyId} or r.parent_id = ${familyId})
       and r.status = 'active'
     order by r.parent_id nulls first, r.variant_label
  `;

  return json({
    ok: true,
    record,
    refs,
    attributes,
    retiredAttributes: retired,
    answers,
    categories,
    family,
  });
}

/**
 * Exactly one of `categoryId` or `level` per request.
 *
 * A union rather than two optional fields: each is its own decision, recorded
 * under its own change-set kind, and a body carrying both would have to pick
 * one kind for two changes. `level` accepts null — "I do not know yet" is a
 * real answer and must be reversible.
 */
const Patch = z.union([
  z.object({ categoryId: z.string().uuid(), version: z.number().int().nonnegative() }).strict(),
  z
    .object({
      level: z.enum(ITEM_LEVELS).nullable(),
      version: z.number().int().nonnegative(),
    })
    .strict(),
]);

/**
 * Sets the record's category (and creates the answer rows that go with it), or
 * its item level.
 *
 * The category exists because intake no longer blocks on one: without it, a
 * record imported without a category could never acquire one. Creating the
 * answers in the same transaction matters — a category with no answers scores
 * 0/0 and reads as complete, the same class of error as an empty programme
 * rendering as a healthy one.
 *
 * The LEVEL decides which of those questions hold up a quote (0019). Nothing
 * infers it, so until a person sets one the record has no tier at all.
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
    // A union's own message is "Invalid input" with an empty path, which tells
    // a reader nothing. Say which of the two shapes was meant and what is
    // wrong with it.
    const body = raw as Record<string, unknown> | null;
    if (body && "level" in body) {
      return json(
        {
          ok: false,
          error: `A level is one of ${ITEM_LEVELS.join(", ")}, or null to clear it.`,
          field: "level",
        },
        400,
      );
    }
    const issue = parsed.error.issues[0];
    return json(
      {
        ok: false,
        error: issue?.message ?? "Send either a category or a level, with the version you were looking at.",
        field: issue?.path.join("."),
      },
      400,
    );
  }

  try {
    const body = parsed.data;
    const result = await withTransaction<SetCategoryResult | SetLevelResult>((txn) =>
      "categoryId" in body
        ? setRecordCategory(txn, {
            recordId: id,
            categoryId: body.categoryId,
            expectedVersion: body.version,
            actor: user.email,
          })
        : setRecordLevel(txn, {
            recordId: id,
            level: body.level,
            expectedVersion: body.version,
            actor: user.email,
          }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
