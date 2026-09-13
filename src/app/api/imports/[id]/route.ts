// Reading and editing a staged import. Edits here change nothing operational:
// the staged jsonb is a draft until /confirm promotes it.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

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
  categoryStatus: string;
  categoryCandidates?: { id: string; name: string }[];
  ignored: boolean;
};

type Parsed = { sheet: string; headerRow: number; skippedRows: number; lines: StagedLine[] };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const rows = await sql`
    select r.id, r.project_id, r.status, r.parsed, r.error, r.version, r.confirmed_at,
           p.bws_project_number, p.name as project_name,
           a.filename
    from intake_runs r
    join projects p on p.id = r.project_id
    left join attachments a on a.id = r.attachment_id
    where r.id = ${id}
  `;
  const run = rows[0];
  if (!run) return json({ ok: false, error: "No such import." }, 404);

  const categories = await sql`
    select id, slug, family, name, requirements_authored from item_categories order by family, sort_order
  `;

  // No matching here. Suggestions were computed and stored when the file was
  // parsed, so the reviewer sees exactly what confirm will write. Recomputing
  // on read would let the two drift apart between the screen and the commit.
  const parsed = (run.parsed ?? null) as Parsed | null;

  return json({ ok: true, import: { ...run, parsed }, categories });
}

// Autosave. Merges the reviewer's change into the line that is still present at
// that index, rather than writing back an array the client sent -- a snapshot
// rewrite races another tab's autosave and silently reverts it.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let body: { index?: unknown; categoryId?: unknown; ignored?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const index = typeof body.index === "number" ? body.index : null;
  if (index === null) return json({ ok: false, error: "index is required." }, 400);

  const patch: Record<string, unknown> = {};
  if (typeof body.categoryId === "string" || body.categoryId === null) {
    patch.categoryId = body.categoryId;
    patch.categoryStatus = body.categoryId ? "chosen" : "none";
  }
  if (typeof body.ignored === "boolean") patch.ignored = body.ignored;
  if (Object.keys(patch).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  const rows = await sql`
    update intake_runs
    set parsed = jsonb_set(
          parsed,
          array['lines', ${String(index)}],
          coalesce(parsed->'lines'->(${index}::int), '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
        ),
        updated_by = ${user.email}
    where id = ${id}
      and status = 'parsed'
      and parsed->'lines'->(${index}::int) is not null
    returning version
  `;
  if (!rows[0]) {
    return json({ ok: false, error: "That line is no longer in this import, or the import is already confirmed." }, 409);
  }
  return json({ ok: true, version: rows[0].version });
}
