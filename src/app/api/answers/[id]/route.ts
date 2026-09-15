// Editing one answer, under the optimistic lock.
//
// The contract from 0001: the client sends the version it read, the update is
// predicated on it, and zero rows back means somebody else changed the row
// first. That is a 409 naming the field, never a silent overwrite of their
// work. bump_version() and write_audit() do the rest in the database.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isAnswerState, type AnswerState } from "@/lib/spec-vocab";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let body: { value?: unknown; state?: unknown; version?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  if (!isAnswerState(body.state)) {
    return json({ ok: false, error: "A state of confirmed, tbc, missing or na is required." }, 400);
  }
  const state: AnswerState = body.state;
  const version = typeof body.version === "number" ? body.version : null;
  if (version === null) return json({ ok: false, error: "version is required." }, 400);

  const raw = typeof body.value === "string" ? body.value.trim() : "";
  const value = raw === "" ? null : raw;

  // The database refuses `confirmed` without a value and an actor, and refuses
  // a value on `na`. Saying so here gives the reviewer a sentence rather than a
  // constraint violation.
  if (state === "confirmed" && !value) {
    return json({ ok: false, error: "Confirmed needs a value. Use TBC if it is not decided yet." }, 400);
  }
  if (state === "na" && value) {
    return json({ ok: false, error: "N/A cannot carry a value." }, 400);
  }

  const rows = await sql`
    update spec_answers
    set value        = ${value},
        state        = ${state},
        confirmed_by = ${state === "confirmed" ? user.email : null},
        confirmed_at = ${state === "confirmed" ? new Date().toISOString() : null},
        -- THE EDIT TAKES OWNERSHIP. An answer filled from a drawing carries
        -- source_kind 'document' and the run that wrote it, and that pair is
        -- exactly what tells promote-answers.ts it may recompose the row as
        -- later slots arrive. The moment a person edits it, it stops being
        -- that row: marking it 'manual' is what stops the next confirmed
        -- drawing overwriting what they typed. (Not null -- the column is
        -- not-null and 'manual' is its default and its honest value here.)
        source_kind  = 'manual',
        source_id    = null,
        updated_by   = ${user.email}
    where id = ${id} and version = ${version}
    returning id, value, state, version, confirmed_by, confirmed_at
  `;

  if (!rows[0]) {
    const current = await sql`
      select a.version, a.state, a.value, a.updated_by, q.prompt
      from spec_answers a join requirements q on q.id = a.requirement_id
      where a.id = ${id}
    `;
    if (!current[0]) return json({ ok: false, error: "No such answer." }, 404);
    return json(
      {
        ok: false,
        conflict: true,
        error: `"${String(current[0].prompt)}" was changed by ${String(current[0].updated_by ?? "someone else")} while you were editing. Their answer is shown; yours was not saved.`,
        current: current[0],
      },
      409,
    );
  }

  return json({ ok: true, answer: rows[0] });
}
