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
// `registration_request_id` is `email:<messageId>:<projectId>`, so a replayed
// assignment returns the run it already made instead of opening a second
// attempt.
//
// ---- THE KEY NAMES THE PROJECT, OR UNASSIGN IS A DEAD END (audit A1) -----
//
// It was `email:<messageId>`, one run per message forever. That was right
// until a message could be taken OFF a project: `unassignMessage` keeps the
// run (it is what the model was paid to produce), so assigning the message to
// the right project found the wrong project's run by its key, linked it,
// answered 200, and never set the project. The message read "unassigned"
// while pointing at a run on the project it had just been taken off, and
// Unassign is the only remedy the auto-assign gate promises.
//
// So the key carries the project. On a project the message has been read on
// before, assigning it again RE-LINKS that run and reads nothing; on any other
// it is a new run, a new copy of the `.eml` under that project, and a new
// charged read, which the inbox says before the click. A key written before
// this change has no project in it; it still belongs to the project its run
// is on, so it is read as that project's key there and nowhere else.
// ============================================================================
import { randomUUID } from "node:crypto";
import { copy } from "@vercel/blob";
import { sql } from "@/lib/db";
import { DomainConflictError, withTransaction, type TxnSql } from "@/lib/db-transaction";
import { openAttempt, publishAttempt } from "@/lib/extraction-dispatch";
import { takeReadSlot, deferRead } from "@/lib/extraction-slots";
import { autoReadCapSentence, autoReadDailyCap, isAutomaticActor, takeAutomaticRead } from "@/lib/auto-read-cap";
import {
  assertMailboxScopedPathname,
  assertProjectScopedPathname,
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

/**
 * `email:<message>:<project>`: one run per message PER PROJECT, whatever
 * retries happen. A message moved to another project is a new read there.
 */
export function emailRegistrationKey(messageId: string, projectId: string): string {
  return `email:${messageId}:${projectId}`;
}

/**
 * The key as it was written before A1: the message alone. Read, never written,
 * and only ever matched together with the run's own `project_id`, because such
 * a run is correctly linked to the project it was made on and to no other.
 */
export function legacyEmailRegistrationKey(messageId: string): string {
  return `email:${messageId}`;
}

/**
 * Every key this message has ever been registered under starts with this.
 * For a `like` over `registration_request_id`: the projects it has been read
 * on, which is what the inbox needs to say whether an assignment is charged.
 */
export function emailRegistrationKeyPrefix(messageId: string): string {
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
  options: {
    /**
     * For a message a person UPLOADED: the project registration scope-checked
     * the upload against (`readTrustedBlob` in `/api/imports`). Its file sits
     * under that project's prefix, not the mailbox's, and moving the message
     * to another project has to copy it from there. Nothing else may be a
     * source outside the mailbox: a stored path under some other project is
     * still refused, whatever wrote it.
     */
    uploadedTo?: string | null;
  } = {},
): MimeLocation {
  if (!storedPath) return { kind: "none" };
  const from = blobPathname(String(storedPath));
  // An uploaded .eml is already under the project the person chose, because
  // the browser could only have put it there. Nothing to copy.
  if (from.startsWith(projectUploadPrefix(projectId))) return { kind: "already", pathname: from };
  const to = `${projectUploadPrefix(projectId)}emails/${messageId}.eml`;
  if (options.uploadedTo) return { kind: "copy", from: assertProjectScopedPathname(from, options.uploadedTo), to };
  return { kind: "copy", from: assertMailboxScopedPathname(from), to };
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

  // A replay: the message is on this project (the guard above refused any
  // other) and its run exists; the read was dispatched the first time round.
  // Only an ASSIGNED message is a replay. A row unassigned before A1 kept the
  // old project's run in `intake_run_id`, and treating that as a replay is the
  // defect itself.
  if (message.routing_status === "assigned" && message.intake_run_id) {
    return {
      messageId: input.messageId,
      projectId: input.projectId,
      runId: String(message.intake_run_id),
      read: false,
      attemptId: null,
    };
  }

  // A project this message has been read on before: put it back on the run it
  // already has. Nothing is read and nothing is copied (`copyMimeUnderProject`
  // asks the same question), and the message takes that run's `.eml` as its
  // own again, because the confirm attaches `mime_attachment_id` as evidence.
  const existing = await txn`
    select id, attachment_id, status, parsed is null as unread,
           (select count(*)::int from jsonb_array_elements(coalesce(parsed -> 'lines', '[]'::jsonb)) line
             where line ->> 'reviewStatus' = 'pending') as pending
    from intake_runs
    where project_id = ${input.projectId}
      and registration_request_id in (
        ${emailRegistrationKey(input.messageId, input.projectId)},
        ${legacyEmailRegistrationKey(input.messageId)}
      )
    for update
  `;
  const previous = existing[0];
  if (previous) {
    // `unassignMessage` settled the run as `confirmed` so nothing went on
    // offering it for review. Back on its project that is no longer true, and
    // `confirmed` means "no pending proposals remain": a run with pending
    // lines is `parsed` again, and one that was never read is `failed` with
    // the reason, so the review screen offers a person the (charged) read
    // rather than calling an unread email reviewed.
    if (String(previous.status) === "confirmed" && Number(previous.pending) > 0) {
      await txn`update intake_runs set status = 'parsed', updated_by = ${input.actor} where id = ${previous.id}`;
    } else if (String(previous.status) === "confirmed" && previous.unread) {
      await txn`
        update intake_runs
        set status = 'failed', updated_by = ${input.actor},
            error = 'This email was taken off the project before it was read. Reading it is one charged model call.'
        where id = ${previous.id}
      `;
    }
    await txn`
      update email_messages
      set project_id = ${input.projectId}, routing_status = 'assigned',
          assigned_by = ${input.actor}, assigned_at = now(), assignment_kind = ${input.kind},
          mime_attachment_id = ${previous.attachment_id ?? null}, intake_run_id = ${previous.id},
          updated_by = ${input.actor}
      where id = ${input.messageId}
    `;
    return {
      messageId: input.messageId,
      projectId: input.projectId,
      runId: String(previous.id),
      read: false,
      attemptId: null,
    };
  }

  // The message, under the project's own prefix, as the thing the confirm will
  // attach to its change set. `attachments` is polymorphic, so `entity_type`
  // names this table rather than carrying a foreign key. An attachment the row
  // still names is reused only where it is under THIS project's prefix: a row
  // unassigned before A1 kept the old project's copy, which this project's
  // read is refused.
  let attachmentId: string | null = null;
  if (message.mime_attachment_id) {
    const held = await txn`select storage_path from attachments where id = ${message.mime_attachment_id}`;
    const path = held[0]?.storage_path ? String(held[0].storage_path) : "";
    if (path && blobPathname(path).startsWith(projectUploadPrefix(input.projectId))) {
      attachmentId = String(message.mime_attachment_id);
    }
  }
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

  // A READ NOBODY PRESSED ANYTHING FOR IS COUNTED (audit A5). Over the
  // project's daily cap the assignment is refused HERE, before a run exists,
  // and the router's caller holds the message with this sentence and the
  // project named, where one click on the inbox is a person's read. Checked
  // after the re-link above, because putting a message back on a run it
  // already has reads nothing and spends nothing.
  if (isAutomaticActor(input.actor)) {
    const cap = autoReadDailyCap();
    if (!(await takeAutomaticRead(txn, input.projectId, cap))) {
      throw new DomainConflictError("auto_read_cap", autoReadCapSentence(cap), { status: 429 });
    }
  }

  const run = await txn`
    insert into intake_runs
      (project_id, attachment_id, batch_id, source_kind, document_kind, status,
       registration_request_id, created_by, updated_by)
    values (${input.projectId}, ${attachmentId}, null, 'spec_document', 'email', 'pending',
            ${emailRegistrationKey(input.messageId, input.projectId)}, ${input.actor}, ${input.actor})
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
    select em.mailbox_storage_path, em.origin, em.routing_status,
           exists (
             select 1 from intake_runs r
             where r.project_id = ${input.projectId}
               and r.registration_request_id in (
                 ${emailRegistrationKey(input.messageId, input.projectId)},
                 ${legacyEmailRegistrationKey(input.messageId)}
               )
           ) as read_here,
           (select r.project_id from intake_runs r join attachments a on a.id = r.attachment_id
             where r.registration_request_id like ${`${emailRegistrationKeyPrefix(input.messageId)}%`}
               and a.storage_path = em.mailbox_storage_path
             order by r.created_at limit 1) as uploaded_to
    from email_messages em where em.id = ${input.messageId}
  `;
  const row = rows[0];
  // On a project already (a replay, or a refusal the transaction words), or
  // going back to a project it has a run on (a re-link, which reads the copy
  // that run already has): nothing to copy.
  if (!row || row.routing_status === "assigned" || row.read_here) return null;

  let plan;
  try {
    plan = planMimeLocation(
      row.mailbox_storage_path === null || row.mailbox_storage_path === undefined
        ? null
        : String(row.mailbox_storage_path),
      input.projectId,
      input.messageId,
      {
        // An upload's file is under the project it was uploaded to, which its
        // first run records. A Graph arrival is under the mailbox and has none.
        uploadedTo: String(row.origin) === "upload" && row.uploaded_to ? String(row.uploaded_to) : null,
      },
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
        select parsed, status,
               floor(extract(epoch from (now() - coalesce(processing_started_at, queued_at, updated_at))) / 60)::int as minutes
          from intake_runs where id = ${message.intake_run_id} for update
      `;
      // A READ IN FLIGHT FINISHES ON THE OLD PROJECT (audit 5.4 A9). The
      // worker owns a queued or parsing run through its claim, so taking the
      // message off here would leave a paid read landing on a project the
      // message no longer names, and the next project would pay again. The
      // screen already shows the read as running; refusing until it lands is
      // the cheap honest answer, and Unassign works the moment it has.
      const status = String(runs[0]?.status ?? "");
      if (status === "queued" || status === "parsing") {
        const minutes = Math.max(0, Number(runs[0]?.minutes ?? 0));
        const ago = minutes === 0 ? "under a minute ago" : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
        throw new DomainConflictError(
          "read_in_flight",
          `Its read is still running (started ${ago}). Wait for it, then take it off.`,
        );
      }
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
          -- The copy under the old project stays (it is that run's evidence),
          -- and so does the arrival copy; the MESSAGE stops naming the old
          -- one, or the next project's read is handed a path it is refused.
          mime_attachment_id = null,
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
