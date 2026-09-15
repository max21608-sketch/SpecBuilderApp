// Retiring a preamble note, and marking the ones that bind.
//
// RETIRED, NEVER DELETED. A note is evidence of how a document was read; a
// mis-extracted one that is deleted takes with it the fact that anybody looked.
// Retiring removes it from the overview and keeps the trail.
//
// This is also why the notes live in `project_notes` rather than the chassis
// `notes` table, which is append-only by trigger and would make a wrong note
// permanent.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// Both fields optional, but at least one required. They are independent on
// purpose: `status` is whether the note is a correct reading of the document,
// `flagged` is whether an accurate note is load-bearing. Overloading one field
// with both would make "this is wrong" and "this matters" the same answer.
const Patch = z
  .object({
    status: z.enum(["active", "retired"]).optional(),
    flagged: z.boolean().optional(),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.flagged !== undefined, {
    message: "Nothing to change.",
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; noteId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id, noteId } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Patch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That change is not valid." }, 400);
  }
  const { status, flagged, version } = parsed.data;

  // Read first, so an unsent field keeps its stored value. Writing every column
  // on every save is what moved the TOE dates a day earlier each time; the same
  // shape here would silently un-flag a note somebody flagged.
  const stored = await sql`
    select status, flagged from project_notes where id = ${noteId} and project_id = ${id}
  `;
  if (!stored[0]) return json({ ok: false, error: "No such note." }, 404);
  const nextStatus = status ?? String(stored[0].status);
  const nextFlagged = flagged ?? Boolean(stored[0].flagged);

  // Predicated on the version, so a stale tab writes zero rows rather than
  // silently overwriting somebody else's change.
  const rows = await sql`
    update project_notes
    set status = ${nextStatus},
        flagged = ${nextFlagged},
        retired_at = ${nextStatus === "retired" ? new Date().toISOString() : null},
        retired_by = ${nextStatus === "retired" ? user.email : null},
        updated_by = ${user.email}
    where id = ${noteId} and project_id = ${id} and version = ${version}
    returning id, status, flagged, version
  `;
  if (!rows[0]) {
    const current = await sql`select version, status, flagged from project_notes where id = ${noteId} and project_id = ${id}`;
    if (!current[0]) return json({ ok: false, error: "No such note." }, 404);
    return json(
      {
        ok: false,
        conflict: true,
        code: "note_version_stale",
        error: "This note changed while you had it open. Reload before saving.",
        current: current[0],
      },
      409,
    );
  }
  return json({ ok: true, note: rows[0] });
}
