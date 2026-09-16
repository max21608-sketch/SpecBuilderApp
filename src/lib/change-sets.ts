// A change set: who changed something, when, why, and what caused it.
//
// ============================================================================
// WHAT THIS IS FOR
//
// Every write to spec content (spec_records, spec_answers, record_attributes,
// spec_record_refs) belongs to a change set. The change set is what the
// history screens render, what a `record_snapshots` row hangs off, and what
// answers "the client says they never asked for this" — because it carries the
// intake run or the uploaded email that caused the change.
//
// ---- THE GUC, AND WHY IT IS NOT A TRANSACTION ID -------------------------
//
// `openChangeSet` inserts the row and then issues `set_config('app.change_set_id',
// <id>, true)` — SET LOCAL in its parameterizable form, because `SET` itself
// takes no parameters. `write_audit()` reads it, so every audit row written
// afterwards in the same transaction carries the change it belonged to,
// without a single call site remembering to pass it.
//
// 0001's header warns that SET LOCAL never survives on Neon's HTTP driver.
// That is true and it is why this must only ever be called inside
// `withTransaction`, which holds one `pg` client across a real BEGIN/COMMIT.
// Calling it on the HTTP driver would set the GUC in a connection that is
// handed back to the pool an instant later, and the audit rows would carry
// nothing.
//
// A transaction id (`pg_current_xact_id`) would have been the obvious link and
// is rejected in 0012's header: xid8 values do not survive db/restore.mjs into
// a fresh Neon project, so the join would start lying after a recovery.
//
// ---- OPEN vs CLOSED ------------------------------------------------------
//
// A document confirm is one deliberate act, so it opens a change and closes it
// in the same breath. A person editing answers is not: they are working
// through a client's email, and asking why on every keystroke produces twenty
// prompts and twenty uses of the word "update". So a reviewer can OPEN a
// change with a reason and an evidence file, and every transaction they run
// after that attaches to it. At most one open change per actor per project,
// enforced by a partial unique index rather than by hope.
// ============================================================================
import { randomUUID } from "node:crypto";
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { assertProjectScopedPathname } from "@/lib/blob-source";

export const CHANGE_SET_KINDS = [
  "boq_confirm",
  "boq_revision",
  "run_retire",
  "drawing_confirm",
  "spec_document_confirm",
  "preamble_confirm",
  "manual_edit",
  "attribute_retire",
  "category_set",
  "level_set",
  "finish_edit",
  "finish_link",
  "finish_unlink",
  "baseline",
  "history_begins",
  "email_confirm",
] as const;
export type ChangeSetKind = (typeof CHANGE_SET_KINDS)[number];

export function isChangeSetKind(value: unknown): value is ChangeSetKind {
  return typeof value === "string" && (CHANGE_SET_KINDS as readonly string[]).includes(value);
}

/** Kinds where the database refuses a change set with no reason. Mirrors `change_sets_reason_required`. */
export const REASON_REQUIRED_KINDS: readonly ChangeSetKind[] = [
  "attribute_retire",
  "run_retire",
  "finish_edit",
  "finish_unlink",
  "baseline",
];

export const CHANGE_SET_KIND_LABELS: Record<ChangeSetKind, string> = {
  boq_confirm: "Bill of quantities imported",
  boq_revision: "Bill of quantities revised",
  run_retire: "Run retired",
  drawing_confirm: "Drawings confirmed",
  spec_document_confirm: "Specification document confirmed",
  preamble_confirm: "Preamble confirmed",
  manual_edit: "Edited by hand",
  attribute_retire: "Spec retired",
  category_set: "Category set",
  level_set: "Level set",
  finish_edit: "Finish edited",
  finish_link: "Finish linked",
  finish_unlink: "Finish unlinked",
  baseline: "Baseline",
  history_begins: "History begins",
  email_confirm: "Email confirmed",
};

export type OpenChangeSet = {
  projectId: string;
  kind: ChangeSetKind;
  actor: string;
  reason?: string | null;
  label?: string | null;
  sourceIntakeRunId?: string | null;
  evidenceAttachmentId?: string | null;
  /**
   * The id to use, when something had to be written that points at the change
   * before the change existed — an evidence attachment, whose owning row is
   * (entity_type 'change_sets', entity_id <this>). Generated here otherwise.
   */
  id?: string;
  /**
   * Leave it open for further transactions by the same actor. Only a person
   * deliberately starting a change does this; everything automatic closes
   * immediately, so the one-open-per-actor index never collides with a confirm
   * running while somebody has a change open.
   */
  open?: boolean;
};

/**
 * Inserts the change set and publishes its id to the transaction.
 *
 * MUST be called inside `withTransaction`. The second statement is what makes
 * every audit row that follows carry the change; without it the row is written
 * and nothing points at it.
 */
export async function openChangeSet(txn: TxnSql, change: OpenChangeSet): Promise<string> {
  const reason = change.reason?.trim() || null;
  if (REASON_REQUIRED_KINDS.includes(change.kind) && !reason) {
    // The constraint would catch this, but a constraint violation reaches the
    // reviewer as "Nothing was written" with no field named.
    throw new DomainConflictError("reason_required", `A ${CHANGE_SET_KIND_LABELS[change.kind].toLowerCase()} has to say why.`, {
      status: 400,
    });
  }

  const rows = await txn`
    insert into change_sets
      (id, project_id, kind, reason, label, source_intake_run_id, evidence_attachment_id, closed_at, actor)
    values
      (${change.id ?? randomUUID()}, ${change.projectId}, ${change.kind}, ${reason}, ${change.label?.trim() || null},
       ${change.sourceIntakeRunId ?? null}, ${change.evidenceAttachmentId ?? null},
       ${change.open ? null : new Date().toISOString()}, ${change.actor})
    returning id
  `;
  const id = String(rows[0]?.id ?? "");
  if (!id) throw new Error("change set was not created");
  await publishChangeSet(txn, id);
  return id;
}

/**
 * Makes an existing change set the one this transaction's writes belong to.
 *
 * Parameterized `set_config(..., is_local => true)` rather than `SET LOCAL`,
 * which takes no parameters — the value would have to be concatenated into the
 * statement, and a uuid pasted into SQL is still a uuid pasted into SQL.
 */
export async function publishChangeSet(txn: TxnSql, changeSetId: string): Promise<void> {
  await txn`select set_config('app.change_set_id', ${changeSetId}, true)`;
}

/** The actor's open change on this project, if they have one. */
export async function findOpenChangeSet(txn: TxnSql, projectId: string, actor: string): Promise<string | null> {
  const rows = await txn`
    select id from change_sets
    where project_id = ${projectId} and actor = ${actor} and closed_at is null
  `;
  return rows[0] ? String(rows[0].id) : null;
}

/**
 * The normal path for a person's edit: attach to the change they opened, or
 * open a one-shot change for just this edit.
 *
 * Not named `use...`: the React hooks lint rule reads that prefix as a hook
 * declaration and fails the build on a server-side function.
 *
 * Returns the id and whether it came from an open change, because the routes
 * report "added to your change" differently from "recorded on its own".
 */
export async function changeSetForEdit(
  txn: TxnSql,
  {
    projectId,
    actor,
    kind,
    reason,
    evidence,
  }: { projectId: string; actor: string; kind: ChangeSetKind; reason?: string | null; evidence?: UploadedEvidence | null },
): Promise<{ changeSetId: string; attached: boolean }> {
  // A reason or an evidence file supplied with THIS edit is about this edit,
  // so it gets its own change rather than being silently swallowed by whatever
  // the reviewer opened an hour ago.
  if (!reason?.trim() && !evidence) {
    const open = await findOpenChangeSet(txn, projectId, actor);
    if (open) {
      await publishChangeSet(txn, open);
      return { changeSetId: open, attached: true };
    }
  }
  const id = randomUUID();
  const evidenceAttachmentId = evidence ? await attachEvidence(txn, { projectId, changeSetId: id, evidence, actor }) : null;
  await openChangeSet(txn, { id, projectId, kind, actor, reason, evidenceAttachmentId });
  return { changeSetId: id, attached: false };
}

export type UploadedEvidence = {
  pathname: string;
  filename?: string | null;
  contentType?: string | null;
  size?: number | null;
};

/**
 * Stores the email (or drawing, or PDF) that caused a change, and returns the
 * attachment id to hang on it.
 *
 * Called BEFORE `openChangeSet`, with the id the change is about to take: the
 * attachment's owner is (entity_type 'change_sets', entity_id <that id>), and
 * a change set cannot be updated afterwards to point at it — 0012 makes the
 * row append-only, and that is the rule, not an obstacle to route around.
 *
 * The pathname is re-checked against THIS project here and not trusted from
 * the screen, for the reason blob-source.ts gives: being signed in does not
 * make an arbitrary pathname this project's file.
 */
export async function attachEvidence(
  txn: TxnSql,
  {
    projectId,
    changeSetId,
    evidence,
    actor,
  }: { projectId: string; changeSetId: string; evidence: UploadedEvidence; actor: string },
): Promise<string> {
  let pathname: string;
  try {
    pathname = assertProjectScopedPathname(evidence.pathname, projectId);
  } catch {
    throw new DomainConflictError("evidence_not_this_project", "That file is not one of this project's uploads.", {
      status: 400,
    });
  }

  const rows = await txn`
    insert into attachments
      (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
    values
      ('change_sets', ${changeSetId}, 'evidence', ${pathname}, ${evidence.filename ?? "evidence"},
       ${evidence.contentType ?? "application/octet-stream"}, ${evidence.size ?? null}, ${actor})
    returning id
  `;
  const id = String(rows[0]?.id ?? "");
  if (!id) throw new Error("evidence was not stored");
  return id;
}

/** Settles an open change. Closing an already-closed one is refused by the trigger. */
export async function closeChangeSet(txn: TxnSql, changeSetId: string, actor: string): Promise<boolean> {
  const rows = await txn`
    update change_sets set closed_at = now()
    where id = ${changeSetId} and actor = ${actor} and closed_at is null
    returning id
  `;
  return rows.length > 0;
}
