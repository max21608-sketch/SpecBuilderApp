// The project's trail: every change, newest first, with what it touched.
//
// `runId` narrows it to changes that produced a version of a record on that
// run — the project screen's tabs are runs, so a trail beside them that showed
// every other tab's changes would be unreadable. It is a view filter on a
// read-only screen, not the kind of filtering the export forbids.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { loadProjectHistory } from "@/lib/change-history";

const MAX_LIMIT = 200;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const projects = await sql`select id, bws_project_number, name from projects where id = ${id}`;
  const project = projects[0];
  if (!project) return json({ ok: false, error: "No such project." }, 404);

  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  if (runId !== null && !/^[0-9a-f-]{36}$/i.test(runId)) {
    return json({ ok: false, error: "runId is not a valid id." }, 400);
  }
  const limitParam = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : 100;

  const changes = await loadProjectHistory(sql, id, { runId, limit });
  return json({
    ok: true,
    project: { id, number: String(project.bws_project_number), name: String(project.name) },
    changes,
    limit,
  });
}
