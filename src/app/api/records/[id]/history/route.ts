// Every version of one record, with what changed at each.
//
// Read-only. The diffs are computed here rather than stored; see
// change-history.ts for why that is not an optimisation waiting to happen.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { loadRecordHistory, compareRecordVersions } from "@/lib/change-history";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const records = await sql`
    select r.id, r.record_no, r.item_description, p.bws_project_number
    from spec_records r join projects p on p.id = r.project_id
    where r.id = ${id}
  `;
  const record = records[0];
  if (!record) return json({ ok: false, error: "No such record." }, 404);
  const label = `${String(record.bws_project_number)}-${String(record.record_no).padStart(3, "0")}`;

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Comparing any two versions, rather than each against the one before it.
  if (from !== null || to !== null) {
    const a = Number(from);
    const b = Number(to);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) {
      return json({ ok: false, error: "Give two version numbers to compare." }, 400);
    }
    const result = await compareRecordVersions(sql, id, a, b);
    if ("error" in result) return json({ ok: false, error: result.error }, 404);
    return json({ ok: true, record: { id, label, itemDescription: String(record.item_description) }, ...result });
  }

  const versions = await loadRecordHistory(sql, id);
  return json({
    ok: true,
    record: { id, label, itemDescription: String(record.item_description) },
    versions,
  });
}
