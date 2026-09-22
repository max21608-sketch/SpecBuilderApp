// Putting an email on a project, and reading it.
//
// ============================================================================
// ASSIGNMENT IS THE SPEND POINT
//
// Registering a specification document schedules a paid model call, and the
// upload screen states the count and the charge before anything uploads
// (CLAUDE.md, "Registering a specification document SPENDS MONEY"). The same
// rule applies here, moved to the moment a message acquires a project: an
// unassigned email is never read, because there are no registers to resolve it
// against and nothing useful to produce. Assigning one — automatically from its
// headers, or by a person from the inbox screen — is what starts the read, and
// both screens say so.
//
// ---- AND IT OPENS NO CHANGE SET. DECIDED, NOT OVERLOOKED -----------------
//
// Since 2.11 the app assigns confidently routed mail itself, so a charged read
// can start with nobody watching — and a charged read a person did not ask for
// is exactly the kind of thing a trail ought to carry. It is still not a
// `change_sets` row, for four reasons, and the fourth is the one that decides
// it:
//
//   1. A change set is a change to a project's SPECIFICATION CONTENT — who,
//      when, why, and the document that caused it — and `record_snapshots` is
//      its output. Assignment writes none: it sets `email_messages.project_id`
//      and inserts an `intake_runs` row. There is nothing to version, and the
//      whole-database coverage assertion in `tests/db/change-history.test.ts`
//      is built on a change and a version being the same fact.
//   2. The email's EFFECT on the project already opens one. Confirming a
//      proposal off it opens an `email_confirm` change whose
//      `evidence_attachment_id` is the `.eml` itself, which is what answers
//      "the client says they never asked for this". An assignment-time entry
//      would be a second entry, for the same email, at a moment when nothing
//      had changed.
//   3. Most assigned mail records nothing — the inbox has a tab for exactly
//      that outcome. A change set per arrival fills the project trail with
//      entries for reads that changed nothing, on the one screen whose value
//      is that a named baseline or a key date stands out from forty rows.
//   4. What the gate asks is that the read be ACCOUNTED FOR, and it is, in a
//      fuller way than a trail row: the inbox row says "assigned automatically"
//      with the signal that decided and Unassign beside it; `audit_log` carries
//      every write under `system:router` through `updated_by`; and the inbox
//      tiles count the reads that FAILED, which is the half nobody could see
//      before. The account belongs on the screen for mail, next to the control
//      that undoes it.
//
// If that is overruled, the shape is an `email_assigned` kind opened inside
// `assignInTransaction` (already a transaction), reason naming the sender, the
// date and the subject, evidence the `.eml` this function attaches, actor
// `system:router`. It costs a migration that re-lists the whole CHECK from the
// LIVE constraint (the 0032 lesson) and a re-reading of the coverage test,
// because such a change set would carry no version by design.
//
// ---- THE PROTOCOL IS THE DOCUMENT ONE, UNCHANGED -------------------------
//
// `openAttempt` inside the transaction that inserts the run; `publishAttempt`
// AFTER the commit. A run committed at `pending` with a message already
// published against it is a paid call against state that may not exist.
// `registration_request_id` is `email:<messageId>`, so a replayed assignment
// returns the run it already made instead of opening a second attempt.
// ============================================================================
import { randomUUID } from "node:crypto";
import { copy } from "@vercel/blob";
import { sql } from "@/lib/db";
import { DomainConflictError, withTransaction, type TxnSql } from "@/lib/db-transaction";
import { openAttempt, publishAttempt } from "@/lib/extraction-dispatch";
import { takeReadSlot, deferRead } from "@/lib/extraction-slots";
import {
  assertMailboxScopedPathname,
  blobPathname,
  projectUploadPrefix,
  UntrustedBlobError,
} from "@/lib/blob-source";

export type AssignResult = {
  messageId: string;
  projectId: string;
  runId: string;
  /** False when the message already had a run: a replay, not a second read. */
  read: boolean;
};

/** `email:<uuid>` — one run per message, forever, whatever retries happen. */
export function emailRegistrationKey(messageId: string): string {
  return `email:${messageId}`;
}

/**
 * Where the message's `.eml` has to be for this project to read it.
 *
 * ==========================================================================
 * THE MAILBOX PREFIX IS NOT READABLE BY ANY PROJECT, AND THAT IS ON PURPOSE
 *
 * Mail arrives before anybody knows whose it is, so `mailboxStoragePath` puts
 * it under `mailbox/`. Every read in `blob-source.ts` is scoped to
 * `projects/<id>/`. Assignment attached the arrival path verbatim, so the run
 * it started could never be read: the worker asked for a mailbox path with a
 * project scope and was refused with "That file does not belong to this
 * project." The comment beside the attachment insert already SAID "under the
 * project's own prefix" — it was describing the upload path, where the browser
 * had already put the file there, and the Graph path had never been walked.
 *
 * So the message is COPIED under the project that claims it. Copied, not
 * moved: the mailbox path is the arrival record, `email_messages` documents it
 * as the pre-assignment location, and a message taken off a project by
 * `unassignMessage` must still have somewhere to have come from.
 *
 * Pure, so the decision is testable without a store: the store call is the
 * caller's, and it is made OUTSIDE the transaction — blob I/O inside one holds
 * row locks across a network round trip.
 * ==========================================================================
 */
export type MimeLocation =
  | { kind: "none" }
  | { kind: "already"; pathname: string }
  | { kind: "copy"; from: string; to: string };

export function planMimeLocation(
  storedPath: string | null | undefined,
  projectId: string,
  messageId: string,
): MimeLocation {
  if (!storedPath) return { kind: "none" };
  const from = blobPathname(String(storedPath));
  // An uploaded .eml is already under the project the person chose, because
  // the browser could only have put it there. Nothing to copy.
  if (from.startsWith(projectUploadPrefix(projectId))) return { kind: "already", pathname: from };
  return {
    kind: "copy",
    from: assertMailboxScopedPathname(from),
    to: `${projectUploadPrefix(projectId)}emails/${messageId}.eml`,
  };
}

type AssignInput = {
  messageId: string;
  projectId: string;
  kind: "auto" | "manual";
  actor: string;
  /** Required for a manual assignment: the version the person was looking at. */
  expectedVersion?: number;
};

async function assignInTransaction(
  txn: TxnSql,
  input: AssignInput,
  /** The project-scoped pathname the caller copied the message to, if it had to. */
  mimePathname: string | null,
): Promise<AssignResult & { attemptId: string | null }> {
  const rows = await txn`
    select id, project_id, routing_status, version, mime_attachment_id, intake_run_id,
           mailbox_storage_path, subject, mime_size, fetch_status
    from email_messages where id = ${input.messageId}
    for update
  `;
  const message = rows[0];
  if (!message) throw new DomainConflictError("not_found", "No such email.", { status: 404 });

  if (input.expectedVersion !== undefined && Number(message.version) !== input.expectedVersion) {
    throw new DomainConflictError(
      "message_version_stale",
      "This email changed while you had it open. Reload before assigning it.",
    );
  }

  // Already on a different project, with a run: that is a reassignment, which
  // has to deal with whatever the reviewer has already applied.
  if (message.routing_status === "assigned" && String(message.project_id) !== input.projectId) {
    throw new DomainConflictError(
      "already_assigned",
      "This email is already on another project. Move it from there rather than assigning it twice.",
    );
  }

  const projects = await txn`select id, status from projects where id = ${input.projectId}`;
  const project = projects[0];
  if (!project) throw new DomainConflictError("unknown_project", "No such project.", { status: 400 });
  if (String(project.status) === "archived") {
    throw new DomainConflictError("project_archived", "That project is archived.", { status: 400 });
  }

  // A replay: the run exists, its read was dispatched the first time round.
  if (message.intake_run_id) {
    return {
      messageId: input.messageId,
      projectId: input.projectId,
      runId: String(message.intake_run_id),
      read: false,
      attemptId: null,
    };
  }

  const existing = await txn`
    select id from intake_runs where registration_request_id = ${emailRegistrationKey(input.messageId)}
  `;
  if (existing[0]) {
    await txn`
      update email_messages set intake_run_id = ${existing[0].id}, updated_by = ${input.actor}
      where id = ${input.messageId}
    `;
    return {
      messageId: input.messageId,
      projectId: input.projectId,
      runId: String(existing[0].id),
      read: false,
      attemptId: null,
    };
  }

  // The message, under the project's own prefix, as the thing the confirm will
  // attach to its change set. `attachments` is polymorphic, so `entity_type`
  // names this table rather than carrying a foreign key.
  let attachmentId = message.mime_attachment_id ? String(message.mime_attachment_id) : null;
  if (!attachmentId && message.mailbox_storage_path) {
    const attachment = await txn`
      insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
      values ('email_messages', ${input.messageId}, 'mime',
              ${mimePathname ?? String(message.mailbox_storage_path)},
              ${`${String(message.subject ?? "email").slice(0, 120).replace(/[^\w .-]+/g, " ").trim() || "email"}.eml`},
              'message/rfc822', ${message.mime_size ?? null}, ${input.actor})
      returning id
    `;
    attachmentId = attachment[0] ? String(attachment[0].id) : null;
  }

  const run = await txn`
    insert into intake_runs
      (project_id, attachment_id, batch_id, source_kind, document_kind, status,
       registration_request_id, created_by, updated_by)
    values (${input.projectId}, ${attachmentId}, null, 'spec_document', 'email', 'pending',
            ${emailRegistrationKey(input.messageId)}, ${input.actor}, ${input.actor})
    returning id
  `;
  if (!run[0]) throw new Error("the email import was not recorded");
  const runId = String(run[0].id);

  // THE CAP COVERS AN EMAIL TOO, because it is the same money. A message has
  // no pack, so it counts against the project's batch-less reads rather than
  // against whatever pack happens to be uploading — holding a person's click
  // behind eleven documents would read as the app ignoring it.
  const scope = { projectId: input.projectId, batchId: null };
  let opened: string | null = null;
  if (await takeReadSlot(txn, scope)) {
    opened = await openAttempt(txn, runId, randomUUID(), input.actor, "pending");
    if (!opened) throw new Error("the email was recorded but could not be queued for reading");
  } else {
    await deferRead(txn, runId, input.actor);
  }

  await txn`
    update email_messages
    set project_id = ${input.projectId}, routing_status = 'assigned',
        assigned_by = ${input.actor}, assigned_at = now(), assignment_kind = ${input.kind},
        mime_attachment_id = ${attachmentId}, intake_run_id = ${runId}, updated_by = ${input.actor}
    where id = ${input.messageId}
  `;

  return { messageId: input.messageId, projectId: input.projectId, runId, read: true, attemptId: opened };
}

/**
 * Put the message where the project can read it, and answer with that path.
 *
 * Returns null when there is nothing to do — no stored file, or a file already
 * under this project's prefix — in which case the transaction falls back to
 * the path on the row.
 *
 * `copy` is the store's own server-side copy: the bytes never enter this
 * process, so a 30MB message costs a request rather than a buffer. A failure
 * here REFUSES the assignment rather than recording one whose read can never
 * succeed — nothing has been written at that point, the message is still held,
 * and the button is still there.
 */
async function copyMimeUnderProject(input: AssignInput): Promise<string | null> {
  const rows = await sql`
    select mailbox_storage_path, mime_attachment_id from email_messages where id = ${input.messageId}
  `;
  const row = rows[0];
  // A replay: the attachment exists, so its path is already whatever it is.
  if (!row || row.mime_attachment_id) return null;

  let plan;
  try {
    plan = planMimeLocation(
      row.mailbox_storage_path === null || row.mailbox_storage_path === undefined
        ? null
        : String(row.mailbox_storage_path),
      input.projectId,
      input.messageId,
    );
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) {
      throw new DomainConflictError("mime_unreadable", cause.message, { status: 400 });
    }
    throw cause;
  }
  if (plan.kind !== "copy") return null;

  try {
    // `addRandomSuffix: false` so the path is the identity: a second attempt
    // after a failed assignment overwrites its own copy rather than leaving a
    // second one nothing points at.
    await copy(plan.from, plan.to, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "message/rfc822",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  } catch (cause) {
    console.error("email mime copy failed", cause);
    throw new DomainConflictError(
      "mime_copy_failed",
      "This email's file could not be copied onto the project, so it was not placed. Try again.",
      { status: 502 },
    );
  }
  return plan.to;
}

/**
 * Put a message on a project and start its read.
 *
 * Returns even when the dispatch fails: the message is assigned and the run
 * exists either way, the failure is recorded on the run where the review
 * screens already render it with a Retry, and telling somebody their email did
 * not arrive when it did would be worse.
 */
export async function assignMessage(
  input: AssignInput,
): Promise<AssignResult & { dispatchError: string | null; waitingForSlot: boolean }> {
  // The copy happens FIRST and outside the transaction: a store round trip
  // inside one holds the message's row lock across a network call, and
  // db-transaction.ts forbids exactly that. It is safe to do before the guards
  // because it writes nothing anybody reads — a copy made for an assignment
  // that is then refused is an orphaned file under a project prefix, not a
  // message on a project.
  const mimePathname = await copyMimeUnderProject(input);

  const result = await withTransaction((txn) => assignInTransaction(txn, input, mimePathname));

  // No attempt means one of two things and they are not the same: a REPLAY,
  // which returns the run it already made and has nothing to say, or a read
  // the cap deferred, which starts on its own when a slot frees. Neither is a
  // dispatch FAILURE, so neither goes in `dispatchError` — a screen that
  // painted "it starts shortly" the way it paints "it did not reach the queue"
  // would send somebody looking for a Retry button they must not press.
  if (!result.attemptId) {
    return { ...result, dispatchError: null, waitingForSlot: result.read };
  }

  const failure = await publishAttempt(result.runId, result.attemptId, input.actor);
  return { ...result, dispatchError: failure ? failure.error : null, waitingForSlot: false };
}

/**
 * Take a message off its project.
 *
 * Refused once anything has been applied: those answers exist, they carry this
 * run as their source, and moving the message would leave them pointing at a
 * project the email is no longer on. Undoing an applied answer is something a
 * person does on the record, on purpose.
 */
export async function unassignMessage(
  messageId: string,
  { actor, expectedVersion }: { actor: string; expectedVersion: number },
): Promise<{ messageId: string }> {
  return withTransaction(async (txn) => {
    const rows = await txn`
      select id, version, intake_run_id from email_messages where id = ${messageId} for update
    `;
    const message = rows[0];
    if (!message) throw new DomainConflictError("not_found", "No such email.", { status: 404 });
    if (Number(message.version) !== expectedVersion) {
      throw new DomainConflictError(
        "message_version_stale",
        "This email changed while you had it open. Reload before moving it.",
      );
    }

    if (message.intake_run_id) {
      const runs = await txn`
        select parsed from intake_runs where id = ${message.intake_run_id} for update
      `;
      const staged = runs[0]?.parsed as { lines?: { reviewStatus?: string }[] } | null;
      const applied = (staged?.lines ?? []).filter((line) => line.reviewStatus === "applied").length;
      if (applied > 0) {
        throw new DomainConflictError(
          "already_applied",
          `${applied} answer${applied === 1 ? "" : "s"} from this email ${applied === 1 ? "has" : "have"} already been confirmed on this project. Undo them on the records first if this was the wrong project.`,
        );
      }
      // The run stays: it is what the model was paid to produce, and deleting
      // it would spend the money again on the next project.
      await txn`
        update intake_runs set status = 'confirmed', updated_by = ${actor}
        where id = ${message.intake_run_id} and status in ('parsed', 'pending', 'failed')
      `;
    }

    await txn`
      update email_messages
      set project_id = null, routing_status = 'unassigned', assigned_by = null, assigned_at = null,
          assignment_kind = null, intake_run_id = null,
          routing_reason = 'Taken off its project by a person.', updated_by = ${actor}
      where id = ${messageId}
    `;
    return { messageId };
  });
}

/** Mark a message as needing nothing, or put it back. Never deletes: dismissing is a decision. */
export async function triageMessage(
  messageId: string,
  {
    triage,
    actor,
    expectedVersion,
  }: { triage: "open" | "nothing_to_record" | "not_specification"; actor: string; expectedVersion: number },
): Promise<{ messageId: string; triage: string }> {
  const rows = await sql`
    update email_messages
    set triage = ${triage},
        triaged_by = ${triage === "open" ? null : actor},
        triaged_at = ${triage === "open" ? null : new Date().toISOString()},
        updated_by = ${actor}
    where id = ${messageId} and version = ${expectedVersion}
    returning id, triage
  `;
  if (!rows[0]) {
    throw new DomainConflictError(
      "message_version_stale",
      "This email changed while you had it open. Reload and try again.",
    );
  }
  return { messageId: String(rows[0].id), triage: String(rows[0].triage) };
}
