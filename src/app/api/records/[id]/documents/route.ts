// Every document behind one record, for its Documents tab.
//
// Read-only, and its OWN route rather than more of `/api/records/[id]`: that
// payload is loaded on every visit and already carries the checklist, the
// gates and a whole-project chase load, and this list is wanted only when the
// tab is opened — the Versions tab's arrangement, for the same reason.
//
// Nothing here serves a file. Each row's links point at the routes that
// already do, and that already scope the blob to the project: the import
// source for a PDF, the email and evidence downloads for anything that must
// never be rendered. See src/lib/record-documents.ts.
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { loadRecordDocuments } from "@/lib/record-documents";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  // A malformed id is a missing record, not a 500 from a uuid cast.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return json({ ok: false, error: "No such record." }, 404);
  }

  const result = await loadRecordDocuments(id);
  if (!result) return json({ ok: false, error: "No such record." }, 404);
  return json({ ok: true, ...result });
}
