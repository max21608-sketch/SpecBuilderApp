// An intake batch: one delivery of documents.
//
// A tender pack arrives as a set — a preamble, a bill of quantities, a drawing
// pack — and they are read in that order, because the bill creates the records
// the drawings attach to. Grouping the runs lets the screen say "this pack"
// instead of showing three unrelated uploads whose order nobody can see.
//
// A batch has NO STATUS COLUMN. Its state is whatever its runs are, and those
// move independently: a preamble can be fully reviewed while the drawings are
// still queued. A stored batch status would be a second copy of that truth,
// wrong from the first transition nobody remembered to mirror. It is derived
// here, on read, from the runs themselves.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const CreateBatch = z.object({ label: z.string().trim().max(200).optional() }).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const project = await sql`select id from projects where id = ${id}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  // HOW MANY PROPOSALS ARE STILL PENDING, counted here so the pack screen can
  // stop ticking a document because somebody opened it (found-in-use 4).
  //
  // Three staged shapes carry a reviewStatus and they are named rather than
  // searched: items[].observations[] (src/lib/drawing-document.ts), lines[]
  // (src/lib/spec-document.ts, which is also an email) and notes[]
  // (src/lib/preamble-document.ts). A recursive jsonpath would need no shape
  // knowledge and would also silently mean whatever it meant; a named path is
  // readable, and a fourth shape reads as zero rather than as a wrong number.
  //
  // A BILL has no per-line review status -- its whole review is one confirm --
  // so it counts zero and the screen falls back to the status label.
  //
  // It is a COUNT, never the staged blob: the pack screen polls every three
  // seconds while anything is in flight, and a drawings run's parsed JSON is
  // megabytes.
  const batches = await sql`
    select b.id, b.label, b.created_at, b.created_by,
           coalesce(
             (select json_agg(json_build_object(
                       'id', r.id,
                       'sourceKind', r.source_kind,
                       'documentKind', r.document_kind,
                       'status', r.status,
                       -- Deferred by the in-flight cap, not by a person: the
                       -- pair (no attempt, a live deadline) is written by
                       -- nothing else, because openAttempt always writes both.
                       --
                       -- THE SAME EXPRESSION IS IN src/lib/drawing-resolution.ts,
                       -- where the drawings step reads it, and in /api/projects/[id] for the
                       -- overview. The driver cannot
                       -- share a SQL fragment; change all three together.
                       'waitingForSlot', (r.status = 'pending' and r.attempt_id is null
                                          and r.attempt_deadline_at > now()),
                       'error', r.error,
                       'filename', a.filename,
                       'createdAt', r.created_at,
                       'pendingReview', jsonb_array_length(
                            jsonb_path_query_array(coalesce(r.parsed, '{}'::jsonb),
                              '$.items[*].observations[*] ? (@.reviewStatus == "pending")')
                         || jsonb_path_query_array(coalesce(r.parsed, '{}'::jsonb),
                              '$.lines[*] ? (@.reviewStatus == "pending")')
                         || jsonb_path_query_array(coalesce(r.parsed, '{}'::jsonb),
                              '$.notes[*] ? (@.reviewStatus == "pending")')
                       )
                     ) order by
                       -- Read order, not upload order: the preamble gives the
                       -- context, the bill creates the records, the drawings
                       -- attach to them.
                       case r.document_kind
                         when 'preamble' then 0
                         when 'shop_drawings' then 2
                         else 1
                       end,
                       case r.source_kind when 'boq_xlsx' then 0 else 1 end,
                       r.created_at)
                from intake_runs r
                left join attachments a on a.id = r.attachment_id
                where r.batch_id = b.id),
             '[]'::json
           ) as runs
    from intake_batches b
    where b.project_id = ${id}
    order by b.created_at desc
    limit 50
  `;
  return json({ ok: true, batches });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const parsed = CreateBatch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That request is not valid." }, 400);
  }

  const project = await sql`select id from projects where id = ${id}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  const rows = await sql`
    insert into intake_batches (project_id, label, created_by, updated_by)
    values (${id}, ${parsed.data.label ?? null}, ${user.email}, ${user.email})
    returning id, label, created_at
  `;
  return json({ ok: true, batch: rows[0] }, 201);
}
