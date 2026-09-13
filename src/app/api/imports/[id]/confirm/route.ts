// THE confirm boundary. The only route that promotes staged lines into
// canonical spec records.
//
// Rules it keeps, from .claude/skills/review-and-confirm:
//   * No matching is re-run here. What gets written is what the reviewer
//     approved -- a fresh match at confirm time could write something they
//     never saw.
//   * Blocking conditions are re-checked server-side. A category that has
//     disappeared, or a line the reviewer never categorised, refuses the batch;
//     the review screen's opinion is not trusted.
//   * The whole batch commits or none of it does. A half-imported BOQ, where
//     the second half looks like it was never delivered, is worse than a
//     refused import.
import { sql, txnClient, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { normaliseRef } from "@/lib/boq-import";

type StagedLine = {
  index: number;
  lineNo: number;
  designer: string | null;
  boqCategory: string | null;
  code: string | null;
  itemDescription: string;
  productReference: string | null;
  qty: number | null;
  categoryId: string | null;
  ignored: boolean;
};

export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let body: { version?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const runs = await sql`
    select id, project_id, status, parsed, version from intake_runs where id = ${id}
  `;
  const run = runs[0];
  if (!run) return json({ ok: false, error: "No such import." }, 404);
  if (run.status === "confirmed") {
    return json({ ok: false, error: "This import has already been confirmed." }, 409);
  }
  if (run.status !== "parsed") {
    return json({ ok: false, error: `This import is ${String(run.status)}, not ready to confirm.` }, 409);
  }
  if (typeof body.version === "number" && body.version !== Number(run.version)) {
    return json(
      { ok: false, conflict: true, error: "Someone else changed this import while you were reviewing it. Reload and check before confirming." },
      409,
    );
  }

  const parsed = run.parsed as { lines: StagedLine[] } | null;
  const lines = (parsed?.lines ?? []).filter((line) => !line.ignored);
  if (lines.length === 0) {
    return json({ ok: false, error: "Every line is ignored — there is nothing to import." }, 400);
  }

  // Re-check, server-side, against live rows.
  const categories = await sql`select id from item_categories`;
  const known = new Set(categories.map((c) => String(c.id)));
  const uncategorised = lines.filter((line) => !line.categoryId || !known.has(line.categoryId));
  if (uncategorised.length > 0) {
    return json(
      {
        ok: false,
        error: `${uncategorised.length} line${uncategorised.length === 1 ? "" : "s"} still need a category. A record with no category cannot be measured for completeness.`,
        lines: uncategorised.map((line) => ({ index: line.index, lineNo: line.lineNo, code: line.code })),
      },
      409,
    );
  }

  const startRows = await sql`
    select coalesce(max(record_no), 0) as max_no from spec_records where project_id = ${run.project_id}
  `;
  let nextNo = Number(startRows[0]?.max_no ?? 0);

  const client = txnClient();
  const statements = [];
  for (const line of lines) {
    nextNo += 1;
    const recordNo = nextNo;
    statements.push(client`
      insert into spec_records
        (project_id, record_no, status, category_id, item_description, product_reference, qty,
         designer, area, source_import_id, source_line_no, created_by, updated_by)
      values
        (${run.project_id}, ${recordNo}, 'active', ${line.categoryId}, ${line.itemDescription},
         ${line.productReference}, ${line.qty}, ${line.designer}, ${line.boqCategory},
         ${id}, ${line.lineNo}, ${user.email}, ${user.email})
    `);
    if (line.code) {
      statements.push(client`
        insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
        select r.id, ${run.project_id}, 'boq_code', ${line.code}, ${normaliseRef(line.code)}, 'BOQ import', ${user.email}
        from spec_records r
        where r.project_id = ${run.project_id} and r.record_no = ${recordNo}
      `);
    }
    statements.push(client`
      insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
      select r.id, q.id, q.spec_field_id, 'missing', 'manual', ${user.email}, ${user.email}
      from spec_records r
      join requirements q on q.category_id = r.category_id
      where r.project_id = ${run.project_id} and r.record_no = ${recordNo}
    `);
    statements.push(client`
      insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
      select 'spec_record', r.id, null, 'active', ${user.email}, ${"Imported from BOQ line " + String(line.lineNo)}
      from spec_records r
      where r.project_id = ${run.project_id} and r.record_no = ${recordNo}
    `);
  }
  statements.push(client`
    update intake_runs
    set status = 'confirmed', confirmed_at = now(), updated_by = ${user.email}
    where id = ${id} and status = 'parsed'
  `);

  try {
    await client.transaction(statements);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return json({ ok: false, error: `Nothing was imported. ${message}` }, 500);
  }

  return json({ ok: true, imported: lines.length, projectId: run.project_id });
}
