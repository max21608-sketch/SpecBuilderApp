// Opening and closing a change.
//
// A reviewer working through a client's email says why ONCE, attaches the
// email, and every edit they make after that belongs to it. Without this, the
// only way to record a reason would be to ask on every keystroke — see
// src/lib/answer-edit.ts for why that does not survive contact with the work.
//
// At most one open change per person per project, enforced by a partial unique
// index rather than by hope. Opening a second closes the first, because the
// alternative is a reviewer silently filing today's edits under last week's
// reason.
import { sql, json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { closeChangeSet, findOpenChangeSet, openChangeSet, attachEvidence } from "@/lib/change-sets";
import { randomUUID } from "node:crypto";

const Evidence = z
  .object({
    pathname: z.string().min(1).max(1024),
    filename: z.string().max(300).nullable().optional(),
    contentType: z.string().max(200).nullable().optional(),
    size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
  })
  .strict();

const Body = z
  .object({
    action: z.enum(["open", "close"]),
    reason: z.string().max(2000).optional(),
    evidence: Evidence.nullable().optional(),
  })
  .strict();

/** The caller's own open change, if they have one. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const rows = await sql`
    select cs.id, cs.reason, cs.created_at, a.filename as evidence_filename,
           (select count(*)::int from record_snapshots s where s.change_set_id = cs.id) as records_changed
    from change_sets cs
    left join attachments a on a.id = cs.evidence_attachment_id
    where cs.project_id = ${id} and cs.actor = ${user.email} and cs.closed_at is null
  `;
  const row = rows[0];
  return json({
    ok: true,
    open: row
      ? {
          id: String(row.id),
          reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
          createdAt: new Date(String(row.created_at)).toISOString(),
          evidenceFilename: row.evidence_filename === null || row.evidence_filename === undefined ? null : String(row.evidence_filename),
          recordsChanged: Number(row.records_changed),
        }
      : null,
  });
}

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
  if (!parsed.success) return json({ ok: false, error: "That request is not valid." }, 400);

  const projects = await sql`select id from projects where id = ${id}`;
  if (!projects[0]) return json({ ok: false, error: "No such project." }, 404);

  try {
    if (parsed.data.action === "close") {
      const closed = await withTransaction(async (txn) => {
        const open = await findOpenChangeSet(txn, id, user.email);
        if (!open) return null;
        await closeChangeSet(txn, open, user.email);
        return open;
      });
      return json({ ok: true, closed: closed !== null });
    }

    const reason = parsed.data.reason?.trim();
    if (!reason) {
      return json({ ok: false, error: "Say what this change is — it is what a later question gets answered with.", field: "reason" }, 400);
    }

    const changeSetId = await withTransaction(async (txn) => {
      // Opening a second change closes the first. Two open changes would make
      // "which one does this edit belong to" a coin toss, and the index
      // forbids it anyway.
      const open = await findOpenChangeSet(txn, id, user.email);
      if (open) await closeChangeSet(txn, open, user.email);

      const newId = randomUUID();
      const evidenceAttachmentId = parsed.data.evidence
        ? await attachEvidence(txn, { projectId: id, changeSetId: newId, evidence: parsed.data.evidence, actor: user.email })
        : null;
      await openChangeSet(txn, {
        id: newId,
        projectId: id,
        kind: "manual_edit",
        actor: user.email,
        reason,
        evidenceAttachmentId,
        open: true,
      });
      return newId;
    });

    return json({ ok: true, changeSetId });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
