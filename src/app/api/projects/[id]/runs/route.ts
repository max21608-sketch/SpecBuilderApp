// Adding a sub-quote with no bill behind it.
//
// A run is a SCOPE, not a spreadsheet tab. `spec_runs.source_import_id` and
// `source_sheet` have been nullable since 0007 for exactly this reason, and
// until 0028 nothing used it: every run in the app came from a BOQ confirm, so
// a project whose documents are drawings and emails could not be started.
//
// No unique on (project_id, name), also from 0007 — re-uploading a revised BOQ
// legitimately produces a second "MAIN RUN", and refusing a duplicate name
// here would be a rule the import does not follow.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { createRun } from "@/lib/manual-capture";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().min(1).max(200) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "A run needs a name." }, 400);

  try {
    const run = await withTransaction((txn) =>
      createRun(txn, { projectId: id, name: parsed.data.name, actor: user.email }),
    );
    return json({ ok: true, run }, 201);
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
