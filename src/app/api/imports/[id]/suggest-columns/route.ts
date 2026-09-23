// A model reads a bill's layout: its header, its columns and its row kinds.
//
// ============================================================================
// ONE SMALL READ, CHARGED — AND NEVER TWICE FOR ONE PRESS.
//
// Called automatically ONCE, the first time the review opens a bill that has a
// sheet nobody could map and no structure read on record, and again whenever a
// person presses "Ask the model to read the columns" on a sheet's panel. It is
// the only place a bill meets a model, and what the model says is applied to
// the STAGED bill exactly as a person's columns are — a re-read of the stored
// spreadsheet by code (`stageStructureReading`). Nothing reaches a record until
// the confirm, and the confirm waits for "The columns are right".
//
// THE REPLAY GUARD IS THE RUN'S VERSION, CLAIMED BEFORE THE CALL. The request
// names the version the screen was loaded at; the claim writes a `pending`
// marker under that version, which bumps it, so a second tab — or a second
// press — naming the same version finds the fence gone and is refused in words
// before anything is sent. A request id is kept too, so a retried request that
// already landed is answered from the record rather than read again. A claim
// older than the deadline is taken to be dead and may be claimed again: a
// worker that died must not hold a bill's panel shut for ever.
//
// THE RESULT IS FENCED ON THE CLAIM. If anything changed the staged bill while
// the model was reading — a person set the columns by hand — the reading is NOT
// applied over their work; the call is still recorded, because it was paid for.
//
// The blob is read, and the model called, OUTSIDE any transaction: a network
// call inside one holds the run's row lock for as long as the model thinks.
// ============================================================================
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { assertBoqDocument, BOQ_SCHEMA_VERSION, type BoqDocument } from "@/lib/boq-import";
import { loadBoqRun, readBoqSource } from "@/lib/boq-run-source";
import { loadLineSuggester, stageStructureReading } from "@/lib/boq-stage";
import {
  readBillStructure,
  validateStructure,
  STRUCTURE_DEADLINE_MS,
  STRUCTURE_MODEL,
  type StructureCall,
} from "@/lib/boq-structure";

export const maxDuration = 300;

const Body = z
  .object({
    version: z.number().int().nonnegative(),
    /** One sheet, from its panel's button. Absent: every live sheet nobody could map. */
    sheetIndex: z.number().int().nonnegative().optional(),
    /** Generated once per press by the browser, so a retried request is answered, not re-read. */
    requestId: z.string().uuid(),
  })
  .strict();

/** What `intake_runs.model_metadata.structureRead` holds. */
export type StructureReadRecord = {
  pending?: { requestId: string; at: string; sheets: string[] } | null;
  lastRequestId?: string | null;
  model?: string;
  /** Per sheet name, the last reading's outcome in words. */
  sheets?: Record<string, { at: string; ok: boolean; outcome: string }>;
  calls?: (StructureCall & { at: string })[];
};

/** A claim older than this is a request that died; its sheets may be read again. */
const CLAIM_EXPIRES_MS = STRUCTURE_DEADLINE_MS + 60_000;

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
  const body = Body.safeParse(raw);
  if (!body.success) return json({ ok: false, error: body.error.issues[0]?.message ?? "That request is not valid." }, 400);

  const run = await loadBoqRun(id);
  if (!run) return json({ ok: false, error: "No such import." }, 404);
  if (run.sourceKind !== "boq_xlsx") {
    return json({ ok: false, code: "wrong_kind", error: "Only a bill of quantities has columns to read." }, 400);
  }
  if (run.status !== "parsed") {
    return json({ ok: false, error: `This bill is ${run.status}; its columns can no longer be read.` }, 409);
  }

  const metaRows = await sql`select model_metadata from intake_runs where id = ${id}`;
  const record = ((metaRows[0]?.model_metadata as { structureRead?: StructureReadRecord } | null)?.structureRead ??
    {}) as StructureReadRecord;

  // A RETRIED REQUEST THAT ALREADY LANDED is answered from the record.
  if (record.lastRequestId === body.data.requestId) {
    return json({ ok: true, replayed: true, version: run.version, sheets: record.sheets ?? {} });
  }
  const pendingFresh =
    record.pending && Date.now() - new Date(record.pending.at).getTime() < CLAIM_EXPIRES_MS ? record.pending : null;
  if (pendingFresh) {
    return json(
      {
        ok: false,
        code: "structure_read_running",
        error:
          "The columns are being read already — in another tab, or a moment ago. This screen shows the result when it lands; nothing more is charged.",
      },
      409,
    );
  }
  if (run.version !== body.data.version) {
    return json(
      {
        ok: false,
        code: "import_version_stale",
        error: "This bill changed since the screen loaded. Reload before asking the model to read its columns.",
      },
      409,
    );
  }

  const staged = assertBoqDocument(run.parsed);
  const targets =
    body.data.sheetIndex !== undefined
      ? staged.sheets[body.data.sheetIndex]
        ? [body.data.sheetIndex]
        : []
      : staged.sheets.flatMap((sheet, index) =>
          sheet.needsColumns && !sheet.ignored && !record.sheets?.[sheet.sheetName] ? [index] : [],
        );
  if (body.data.sheetIndex !== undefined && targets.length === 0) {
    return json({ ok: false, error: "That sheet is not in this bill." }, 400);
  }
  // Nothing to read: every live sheet is mapped, or has had its reading. The
  // automatic call lands here on every later visit, and it costs nothing.
  if (targets.length === 0) return json({ ok: true, nothing: true, version: run.version, sheets: record.sheets ?? {} });

  const names = targets.map((index) => staged.sheets[index]?.sheetName ?? "");
  // THE CLAIM. Written under the version the screen saw; the version bump is
  // what refuses the second tab.
  const claimAt = new Date().toISOString();
  const claimed = await sql`
    update intake_runs
    set model_metadata = jsonb_set(
          coalesce(model_metadata, '{}'::jsonb),
          array['structureRead'],
          coalesce(model_metadata->'structureRead', '{}'::jsonb)
            || jsonb_build_object('pending', ${JSON.stringify({ requestId: body.data.requestId, at: claimAt, sheets: names })}::jsonb)
        ),
        updated_by = ${user.email}
    where id = ${id} and version = ${body.data.version} and status = 'parsed'
    returning version
  `;
  if (!claimed[0]) {
    return json(
      {
        ok: false,
        code: "structure_read_running",
        error: "Someone else started reading this bill's columns a moment ago. Reload to see the result; nothing more is charged.",
      },
      409,
    );
  }
  const claimVersion = Number(claimed[0].version);

  // Everything from here on must clear the claim, whatever happens.
  let sources: Awaited<ReturnType<typeof readBoqSource>>;
  try {
    sources = await readBoqSource(run);
  } catch (cause) {
    await release(id, user.email, {});
    return transactionErrorResponse(cause);
  }

  const readings = await Promise.all(
    targets.map(async (index) => {
      const sheet = staged.sheets[index];
      const source =
        (sheet && sources.find((candidate) => candidate.sheet === sheet.sheetName)) ?? sources[index] ?? null;
      if (!sheet || !source) return { index, sheet, source: null, result: null };
      return { index, sheet, source, result: await readBillStructure({ sheetName: sheet.sheetName, data: source.data }) };
    }),
  );

  const at = new Date().toISOString();
  const calls = readings.flatMap((reading) => (reading.result ? reading.result.calls.map((call) => ({ ...call, at })) : []));
  const outcomes: Record<string, { at: string; ok: boolean; outcome: string }> = {};
  const fresh: BoqDocument = { ...staged, schemaVersion: BOQ_SCHEMA_VERSION, sheets: [...staged.sheets] };

  try {
    const applied = await withTransaction(async (txn) => {
      const suggest = await loadLineSuggester(txn);
      for (const reading of readings) {
        const name = reading.sheet?.sheetName ?? `sheet ${reading.index + 1}`;
        if (!reading.sheet || !reading.source) {
          outcomes[name] = { at, ok: false, outcome: `The stored file no longer has a sheet called “${name}”.` };
          continue;
        }
        if (!reading.result || !reading.result.ok) {
          outcomes[name] = {
            at,
            ok: false,
            outcome: `${reading.result?.error ?? "The columns were not read."} Nothing was applied — set them by hand, or ask again.`,
          };
          continue;
        }
        const validated = validateStructure(reading.result.output, reading.source.data);
        const next = stageStructureReading(reading.sheet, reading.source, validated, suggest);
        fresh.sheets[reading.index] = next;
        outcomes[name] = {
          at,
          ok: validated.notABill !== null || validated.mapping !== null,
          outcome: validated.notABill
            ? `Read as not a bill: ${validated.notABill}`
            : validated.mapping
              ? `Columns and row kinds read by the model: ${next.lines.length} line${next.lines.length === 1 ? "" : "s"}. Check them before confirming.`
              : `The model's reading could not be used: ${validated.mappingProblem ?? "it named no columns"}`,
        };
      }

      const nextRecord: StructureReadRecord = {
        ...record,
        pending: null,
        lastRequestId: body.data.requestId,
        model: STRUCTURE_MODEL,
        sheets: { ...(record.sheets ?? {}), ...outcomes },
        calls: [...(record.calls ?? []), ...calls],
      };
      const anyApplied = readings.some((reading) => reading.result?.ok);
      // FENCED ON THE CLAIM: the staged bill is replaced only if nothing else
      // wrote it since. Otherwise only the record of the call is written.
      const rows = await txn`
        update intake_runs
        set parsed = case when version = ${claimVersion} and ${anyApplied}::boolean then ${JSON.stringify(fresh)}::jsonb else parsed end,
            model = ${STRUCTURE_MODEL},
            raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('structureRead', ${JSON.stringify(
              readings.map((reading) => (reading.result && reading.result.ok ? reading.result.raw : null)),
            )}::jsonb),
            model_metadata = jsonb_set(coalesce(model_metadata, '{}'::jsonb), array['structureRead'], ${JSON.stringify(nextRecord)}::jsonb),
            updated_by = ${user.email}
        where id = ${id} and status = 'parsed'
        returning version, (parsed = ${JSON.stringify(fresh)}::jsonb) as applied
      `;
      if (!rows[0]) throw new DomainConflictError("not_reviewable", "This bill is no longer being reviewed.");
      return { version: Number(rows[0].version), applied: Boolean(rows[0].applied) };
    });

    const charged = calls.length;
    if (!applied.applied && readings.some((reading) => reading.result?.ok)) {
      return json(
        {
          ok: false,
          code: "import_version_stale",
          error:
            "The bill changed while the model was reading it, so its reading was not applied over that change. Reload, and ask again if you still want it.",
          charged,
        },
        409,
      );
    }
    const failures = Object.values(outcomes).filter((outcome) => !outcome.ok);
    if (failures.length === Object.keys(outcomes).length) {
      return json({ ok: false, error: failures.map((outcome) => outcome.outcome).join(" "), charged, sheets: outcomes, version: applied.version }, 502);
    }
    return json({ ok: true, version: applied.version, sheets: outcomes, charged });
  } catch (cause) {
    await release(id, user.email, { calls });
    return transactionErrorResponse(cause);
  }
}

/** Clear a claim that will not complete, keeping the record of any call that was paid for. */
async function release(id: string, actor: string, extra: { calls?: (StructureCall & { at: string })[] }): Promise<void> {
  await sql`
    update intake_runs
    set model_metadata = jsonb_set(
          coalesce(model_metadata, '{}'::jsonb),
          array['structureRead'],
          coalesce(model_metadata->'structureRead', '{}'::jsonb)
            || jsonb_build_object('pending', null)
            || jsonb_build_object('calls', coalesce(model_metadata->'structureRead'->'calls', '[]'::jsonb) || ${JSON.stringify(extra.calls ?? [])}::jsonb)
        ),
        updated_by = ${actor}
    where id = ${id}
  `;
}
