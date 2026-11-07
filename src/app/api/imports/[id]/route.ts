// Reading and editing a staged import. Edits here change nothing operational:
// the staged jsonb is a draft until /confirm promotes it.
//
// TWO SHAPES behind one endpoint, dispatched on source_kind — the BOQ's
// positional lines, and a specification document's identified proposals. They
// are edited differently for a reason that is not cosmetic:
//
//   BOQ lines are a FIXED LIST parsed from a spreadsheet. Nothing is ever added
//   or removed, so an index is a stable address.
//
//   PROPOSALS ARE ADDRESSED BY UUID, NEVER BY POSITION. Reviewing one changes
//   the set the screen is filtering, so "the proposal at index 4" means a
//   different row before and after an Ignore. Every operation here locates by
//   `elem.id` in the live, locked JSON.
//
// THIS FILE IS THE DISPATCHER (audit 5.3, cut D, 2026-11-07). It reads the run,
// chooses the shape from the run (never from the request), and hands the
// request to one handler in src/lib/import-route/: bill.ts, drawings.ts, or
// proposals.ts (every other specification document). The status codes, the
// bodies and the DomainConflictError codes are the handlers' own, unchanged;
// tests/db/intake-routes.test.ts is the contract.
import { sql, json, type Row } from "@/lib/db";
import { CLAIM_EXPIRY_SECONDS } from "@/lib/extraction-claim";
import { getSessionUser } from "@/lib/session";
import { isStagedFinishSchedule } from "@/lib/finish-schedule";
import { requireUuid, requireWriter } from "@/lib/route-guards";
import { getBillReview, patchBoqLine } from "@/lib/import-route/bill";
import { getDrawingsReview, patchBulkUnit, patchDrawing } from "@/lib/import-route/drawings";
import {
  getFinishScheduleReview,
  getPreambleReview,
  getProposalsReview,
  patchFinishScheduleEntry,
  patchPreamble,
  patchProposal,
} from "@/lib/import-route/proposals";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const badId = requireUuid(id);
  if (badId) return badId;
  const rows = await sql`
    select r.id, r.project_id, r.status, r.parsed, r.error, r.version, r.confirmed_at,
           r.source_kind, r.document_kind, r.model, r.model_metadata,
           r.attempt_id, r.claim_count, r.queued_at,
           -- Whether the original is stored, so a bill that failed or needs
           -- its columns can offer a free re-read from it rather than a
           -- request for the file again.
           (r.attachment_id is not null) as has_source,
           (r.attempt_deadline_at > now()) as within_deadline,
           -- The claim window is the worker's own constant. A literal here
           -- (360 seconds, from before the claim went to 900) offered a
           -- Restart the extract route then refused, from minute 6 to 15.
           (r.status = 'parsing' and r.processing_started_at > now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS})) as claim_live,
           p.bws_project_number, p.name as project_name,
           a.filename
    from intake_runs r
    join projects p on p.id = r.project_id
    left join attachments a on a.id = r.attachment_id
    where r.id = ${id}
  `;
  const row = rows[0];
  if (!row) return json({ ok: false, error: "No such import." }, 404);

  // ==========================================================================
  // `pending` COVERS TWO STATES, AND THE SCREENS SAID THE WRONG ONE.
  //
  // A document the per-pack cap DEFERRED sits at `pending` with no attempt and
  // a live deadline — the pair `openAttempt` never writes, because it always
  // writes both (`src/lib/extraction-slots.ts`). The three single-document
  // review screens read the status alone and said "has not been read", which is
  // the sentence for a document waiting for a PERSON, over one the app is going
  // to read on its own as soon as a slot frees.
  //
  // THE SAME PREDICATE IS IN SQL IN TWO PLACES — the pack screen's
  // src/app/api/projects/[id]/batches/route.ts and the drawings step's
  // src/lib/drawing-resolution.ts, where it has to be SQL because those
  // aggregate over a whole pack. Here the row is already in hand and both its
  // columns are already selected, so this reads them rather than adding a third
  // copy of the SQL. Change one and change the others, or the pack screen and a
  // document's own screen start disagreeing about which documents are waiting.
  // ==========================================================================
  const waitingForSlot = row.status === "pending" && !row.attempt_id && Boolean(row.within_deadline);
  const run: Row = { ...row, waitingForSlot };

  if (run.source_kind === "spec_document" && run.document_kind === "shop_drawings") return getDrawingsReview(run);

  // ---- a finishes schedule read as ENTRIES (schemaVersion 2) --------------
  // Null `parsed` is a schedule not read yet, and it will be read in the new
  // shape. A version 1 run (proposals) falls through to the old screen below.
  if (
    run.source_kind === "spec_document" &&
    run.document_kind === "finishes_schedule" &&
    (!run.parsed || isStagedFinishSchedule(run.parsed))
  ) {
    return getFinishScheduleReview(run);
  }

  if (run.source_kind === "spec_document" && run.document_kind === "preamble") return getPreambleReview(run);

  if (run.source_kind === "spec_document") return getProposalsReview(run);

  return getBillReview(run);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;
  const { id } = await context.params;
  const badId = requireUuid(id);
  if (badId) return badId;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  // Which shape, read from the run, not from the request.
  const rows = await sql`
    select source_kind, document_kind, parsed->>'kind' as staged_kind from intake_runs where id = ${id}
  `;
  if (!rows[0]) return json({ ok: false, error: "No such import." }, 404);

  if (rows[0].document_kind === "finishes_schedule" && rows[0].staged_kind === "finishes_schedule") {
    return patchFinishScheduleEntry(id, raw, user.email);
  }

  if (rows[0].document_kind === "shop_drawings") {
    // Two shapes on one route, told apart by the key the body carries rather
    // than by a mode flag: a bulk set names no observation and carries no
    // version, so it cannot be validated by `DrawingPatch` at all.
    if (raw && typeof raw === "object" && "bulkUnit" in raw) return patchBulkUnit(id, raw, user.email);
    return patchDrawing(id, raw, user.email);
  }
  if (rows[0].document_kind === "preamble") return patchPreamble(id, raw, user.email);
  if (rows[0].source_kind === "spec_document") return patchProposal(id, raw, user.email);
  return patchBoqLine(id, (raw ?? {}) as Record<string, unknown>, user.email);
}