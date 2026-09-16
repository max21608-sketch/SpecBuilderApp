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
// ---- THE PROTOCOL IS THE DOCUMENT ONE, UNCHANGED -------------------------
//
// `openAttempt` inside the transaction that inserts the run; `publishAttempt`
// AFTER the commit. A run committed at `pending` with a message already
// published against it is a paid call against state that may not exist.
// `registration_request_id` is `email:<messageId>`, so a replayed assignment
// returns the run it already made instead of opening a second attempt.
// ============================================================================
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { DomainConflictError, withTransaction, type TxnSql } from "@/lib/db-transaction";
import { openAttempt, publishAttempt } from "@/lib/extraction-dispatch";

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

type AssignInput = {
  messageId: string;
  projectId: string;
  kind: "auto" | "manual";
  actor: string;
  /** Required for a manual assignment: the version the person was looking at. */
  expectedVersion?: number;
};

async function assignInTransaction(txn: TxnSql, input: AssignInput): Promise<AssignResult & { attemptId: string | null }> {
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
      values ('email_messages', ${input.messageId}, 'mime', ${String(message.mailbox_storage_path)},
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

  const attemptId = randomUUID();
  const opened = await openAttempt(txn, runId, attemptId, input.actor, "pending");
  if (!opened) throw new Error("the email was recorded but could not be queued for reading");

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
 * Put a message on a project and start its read.
 *
 * Returns even when the dispatch fails: the message is assigned and the run
 * exists either way, the failure is recorded on the run where the review
 * screens already render it with a Retry, and telling somebody their email did
 * not arrive when it did would be worse.
 */
export async function assignMessage(input: AssignInput): Promise<AssignResult & { dispatchError: string | null }> {
  const result = await withTransaction((txn) => assignInTransaction(txn, input));

  if (!result.attemptId) {
    return { ...result, dispatchError: null };
  }

  const failure = await publishAttempt(result.runId, result.attemptId, input.actor);
  return { ...result, dispatchError: failure ? failure.error : null };
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
