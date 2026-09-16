// What changed between two points in a project's history.
//
// Both ends may be baselines or ordinary changes. A baseline names its members
// exactly; an ordinary change is read as the state as at that change. The
// difference matters and is explained in src/lib/baselines.ts.
//
// Read-only, and the diffs are computed here rather than stored — same rule as
// the record history.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { compareChangeSets } from "@/lib/baselines";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!UUID.test(from) || !UUID.test(to)) {
    return json({ ok: false, error: "Give two points to compare." }, 400);
  }
  if (from === to) {
    return json({ ok: false, error: "Those are the same point. Pick two." }, 400);
  }

  const projects = await sql`select id, bws_project_number, name from projects where id = ${id}`;
  if (!projects[0]) return json({ ok: false, error: "No such project." }, 404);

  const result = await compareChangeSets(sql, id, from, to);
  if ("error" in result) return json({ ok: false, error: result.error }, 404);
  return json({ ok: true, ...result });
}
