// Fetching one message from the app mailbox and recording it.
//
// ============================================================================
// THE STUB ROW IS WRITTEN FIRST, AND THAT IS THE WHOLE IDEMPOTENCY DESIGN
//
// A notification and a delta poll can both name the same mail; Graph redelivers;
// a worker can die mid-fetch. So the FIRST thing this does is insert a row
// keyed on `(mailbox, graph_message_id)` with `on conflict do nothing`. Zero
// rows back means somebody else has it, and this delivery acks without doing
// anything. That is cheaper and more reliable than any lock, and it survives a
// restart because the row is already committed.
//
// A stub left `pending` by a worker that died is taken over after ten minutes —
// long enough that a slow fetch is never stolen from, short enough that a
// message is not stuck for an afternoon.
//
// ---- NOTHING HERE WRITES TO THE MAILBOX ----------------------------------
//
// No PATCH, no `isRead`, no move, no delete. The Entra grant is `Mail.Read` and
// would refuse one anyway; the point is that there is no code path to audit.
// `docs/integration.md`'s checklist item "reading left every message unread"
// holds by construction rather than by care.
// ============================================================================
import { put } from "@vercel/blob";
import { sql } from "@/lib/db";
import { DomainConflictError, withTransaction } from "@/lib/db-transaction";
import { MAILBOX_PREFIX } from "@/lib/blob-source";
import {
  GraphError,
  assertGraphId,
  graphBytes,
  graphJson,
  mailIngestionEnabled,
  mailboxPath,
} from "@/lib/graph-client";
import { autoAssignDecision, describeHeld, describeRouting, routeMessage, ROUTER_ACTOR } from "@/lib/email-routing";
import {
  findDuplicateMessage,
  loadRoutingRegisters,
  loadSentDrafts,
  lockMessageIdentity,
  mimeSha256,
} from "@/lib/email-ingest";
import { parseEnvelope, type EmailEnvelope } from "@/lib/email-envelope";
import { matchReplyToChase } from "@/lib/chase-reply";
import { assignMessage } from "@/lib/email-registration";
import type { ExtractionQueueMessage } from "@/lib/extraction-queue";

/** Over this and the message is recorded WITHOUT its MIME, flagged, never refused. */
export const MAX_MIME_BYTES = 30 * 1024 * 1024;
const STUB_TAKEOVER_MINUTES = 10;

type MailIngestMessage = Extract<ExtractionQueueMessage, { kind: "mail-ingest" }>;

export type IngestOutcome =
  | { outcome: "stored"; messageId: string; assigned: boolean }
  /** `messageId` is the row that already holds this email, where there is one. */
  | { outcome: "duplicate"; messageId: string | null }
  | { outcome: "gone"; messageId: string }
  | { outcome: "skipped"; reason: string };

type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  receivedDateTime?: string;
  subject?: string;
  hasAttachments?: boolean;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  replyTo?: { emailAddress?: { name?: string; address?: string } }[];
  internetMessageHeaders?: { name?: string; value?: string }[];
  body?: { contentType?: string; content?: string };
};

const SELECT =
  "id,internetMessageId,conversationId,receivedDateTime,subject,hasAttachments," +
  "from,toRecipients,ccRecipients,replyTo,internetMessageHeaders,body";

function people(list: GraphMessage["toRecipients"]): { name: string | null; address: string }[] {
  return (list ?? [])
    .map((entry) => ({
      name: entry.emailAddress?.name?.trim() || null,
      address: (entry.emailAddress?.address ?? "").trim().toLowerCase(),
    }))
    .filter((person) => person.address);
}

/** Graph's JSON as an envelope, for when the MIME could not be stored. */
function envelopeFromGraph(message: GraphMessage): EmailEnvelope {
  const from = message.from?.emailAddress?.address
    ? {
        name: message.from.emailAddress.name?.trim() || null,
        address: message.from.emailAddress.address.trim().toLowerCase(),
      }
    : null;
  return {
    messageId: message.internetMessageId ?? null,
    inReplyTo: null,
    references: [],
    from,
    replyTo: people(message.replyTo),
    to: people(message.toRecipients),
    cc: people(message.ccRecipients),
    subject: message.subject ?? null,
    date: message.receivedDateTime ? new Date(message.receivedDateTime).toISOString() : null,
    headers: (message.internetMessageHeaders ?? []).map((header) => ({
      name: String(header.name ?? ""),
      value: String(header.value ?? "").replace(/\s*\r?\n\s+/g, " ").trim(),
    })),
    textBody: message.body?.contentType?.toLowerCase() === "text" ? (message.body.content ?? null) : null,
    htmlBody: message.body?.contentType?.toLowerCase() === "html" ? (message.body.content ?? null) : null,
    attachments: [],
  };
}

/**
 * `mailbox/<slug>/<yyyy>/<mm>/<id>.eml` — outside any project prefix, because no
 * project is known yet.
 *
 * This is why `assignMessage` COPIES the message under the project that claims
 * it. Every read in `blob-source.ts` is scoped to `projects/<id>/`, so a run
 * pointed at a path under this prefix cannot be read at all — which is exactly
 * what happened the first time a message arriving this way was assigned.
 */
export function mailboxStoragePath(mailbox: string, graphMessageId: string, received: Date): string {
  const slug = mailbox.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const yyyy = String(received.getUTCFullYear());
  const mm = String(received.getUTCMonth() + 1).padStart(2, "0");
  const safeId = graphMessageId.replace(/[^A-Za-z0-9_-]/g, "");
  return `${MAILBOX_PREFIX}${slug}/${yyyy}/${mm}/${safeId}.eml`;
}

/**
 * One message, start to finish.
 *
 * THROWS for anything retryable, so the platform redelivers. Returns for
 * anything terminal — a duplicate, or a message that has been deleted — because
 * throwing those would burn deliveries on an answer that will not change.
 */
export async function ingestGraphMessage(job: MailIngestMessage): Promise<IngestOutcome> {
  if (!mailIngestionEnabled()) return { outcome: "skipped", reason: "mail ingestion is not enabled" };

  const mailbox = job.mailbox;
  const graphMessageId = assertGraphId(job.graphMessageId);
  const actor = job.requestedBy || "system:microsoft-graph";

  // 1. Claim it by existing. Committed immediately, so a restart cannot lose
  //    the claim and a second delivery sees it.
  const stub = await sql`
    insert into email_messages (mailbox, origin, graph_message_id, fetch_status, routing_status,
                                routing_reason, created_by, updated_by)
    values (${mailbox}, 'graph', ${graphMessageId}, 'pending', 'unassigned',
            'not read yet', ${actor}, ${actor})
    on conflict (mailbox, graph_message_id) where graph_message_id is not null do nothing
    returning id
  `;

  let messageId = stub[0] ? String(stub[0].id) : null;
  if (!messageId) {
    const existing = await sql`
      select id, fetch_status, updated_at from email_messages
      where mailbox = ${mailbox} and graph_message_id = ${graphMessageId}
    `;
    const row = existing[0];
    if (!row) return { outcome: "duplicate", messageId: null };
    const stale =
      String(row.fetch_status) === "pending" &&
      Date.now() - new Date(String(row.updated_at)).getTime() > STUB_TAKEOVER_MINUTES * 60_000;
    if (!stale) return { outcome: "duplicate", messageId: String(row.id) };
    // A worker died holding this. Take it over.
    messageId = String(row.id);
  }

  // 2. The envelope, from Graph, by id.
  let message: GraphMessage;
  try {
    message = await graphJson<GraphMessage>(
      `${mailboxPath(`/messages/${encodeURIComponent(graphMessageId)}`)}?$select=${SELECT}`,
    );
  } catch (cause) {
    if (cause instanceof GraphError && cause.status === 404) {
      // Deleted before we reached it. Terminal, and recorded: a row that
      // vanishes is a row nobody can ask about.
      await sql`
        update email_messages set fetch_status = 'gone', updated_by = ${actor}
        where id = ${messageId} and fetch_status = 'pending'
      `;
      return { outcome: "gone", messageId };
    }
    throw cause;
  }

  // 2b. THE SAME EMAIL BY ANOTHER ROUTE (audit B8). A redirect and a cc, or a
  //     person who uploaded it before it arrived here, put the same message
  //     in the app mailbox twice under two Graph ids, and the stub key cannot
  //     see that. Asked first by Message-ID, before a byte is fetched; asked
  //     again by Message-ID AND the bytes when the stub is filled, under the
  //     identity locks, which is the answer that counts.
  const known = await findDuplicateMessage(
    sql,
    { internetMessageId: message.internetMessageId ?? null, sha256: null },
    messageId,
  );
  if (known) return await dropDuplicateStub(messageId, known.messageId);

  // 3. The message itself, kept whole. A parsed body is a reading of the email;
  //    the .eml is the email.
  const received = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();
  const storagePath = mailboxStoragePath(mailbox, graphMessageId, received);
  let mimeStored = false;
  let mimeSize: number | null = null;
  let mimeError: string | null = null;
  let envelope: EmailEnvelope | null = null;
  let parseError: string | null = null;
  let sha256: string | null = null;

  const mime = await graphBytes(mailboxPath(`/messages/${encodeURIComponent(graphMessageId)}/$value`), MAX_MIME_BYTES);
  if ("tooLarge" in mime) {
    mimeError = `The message is ${(mime.size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_MIME_BYTES / 1024 / 1024}MB limit, so it was recorded without its original file.`;
    mimeSize = mime.size;
  } else {
    // `addRandomSuffix: false` on purpose: the path IS the idempotency, so a
    // re-run overwrites rather than accumulating copies.
    await put(storagePath, mime.bytes, {
      access: "private",
      addRandomSuffix: false,
      contentType: "message/rfc822",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    mimeStored = true;
    mimeSize = mime.bytes.byteLength;
    sha256 = mimeSha256(mime.bytes);
    try {
      envelope = await parseEnvelope(mime.bytes);
    } catch (cause) {
      parseError = cause instanceof Error ? cause.message : String(cause);
    }
  }
  if (!envelope) envelope = envelopeFromGraph(message);
  // WHO GRAPH SAYS IT WAS SENT TO, beside who the bytes say (audit A8). The
  // MIME keeps its own To and Cc, exactly as sent; this is the mailbox's own
  // server's account of the delivered item, and routing reads only this as
  // vouching for a project inbox.
  envelope = {
    ...envelope,
    reportedRecipients: [...people(message.toRecipients), ...people(message.ccRecipients)].map(
      (person) => person.address,
    ),
  };

  // 4. Attachment metadata only. Bytes are never fetched: a file's kind is
  //    declared by a person and reading one costs money.
  let attachments: { filename: string | null; contentType: string; size: number; isRfc822: boolean }[] = [];
  if (message.hasAttachments) {
    try {
      const listed = await graphJson<{ value: { name?: string; contentType?: string; size?: number; "@odata.type"?: string }[] }>(
        `${mailboxPath(`/messages/${encodeURIComponent(graphMessageId)}/attachments`)}?$select=id,name,contentType,size`,
      );
      attachments = (listed.value ?? []).map((a) => ({
        filename: a.name ?? null,
        contentType: (a.contentType ?? "application/octet-stream").toLowerCase(),
        size: Number(a.size ?? 0),
        isRfc822:
          (a.contentType ?? "").toLowerCase().startsWith("message/rfc822") ||
          String(a["@odata.type"] ?? "").includes("itemAttachment"),
      }));
    } catch {
      // A listing failure must not lose the message. The panel says how many
      // there are from the envelope instead.
      attachments = envelope.attachments;
    }
  }

  // 5. Where does it belong?
  const routing = routeMessage(envelope, await loadRoutingRegisters());
  const chaseProjectId = routing.status === "assigned" ? routing.projectId : null;
  const chase = chaseProjectId
    ? matchReplyToChase(envelope, await loadSentDrafts(chaseProjectId))
    : null;

  // What the router will decide, so a held row says WHY in the same write.
  const decision = autoAssignDecision(routing);
  const held = describeHeld(decision);
  const routingReason = held ? `${describeRouting(routing)}. ${held}` : describeRouting(routing);

  // 6. Fill the stub, fenced on it still being ours, unless the inbox already
  //    holds this email: the look and the fill are one transaction under the
  //    identity locks, so two routes delivering it at once record it once.
  const identity = { internetMessageId: envelope.messageId, sha256 };
  const filledEnvelope = envelope;
  const fill = await withTransaction(async (txn) => {
    await lockMessageIdentity(txn, identity);
    const duplicate = await findDuplicateMessage(txn, identity, messageId);
    if (duplicate) return { duplicateOf: duplicate.messageId, filled: false };
    const rows = await txn`
      update email_messages
      set fetch_status = 'fetched', fetch_error = null,
          internet_message_id = ${filledEnvelope.messageId}, conversation_id = ${message.conversationId ?? null},
          in_reply_to = ${filledEnvelope.inReplyTo},
          references_raw = ${filledEnvelope.references.length ? filledEnvelope.references.join(" ") : null},
          from_addr = ${filledEnvelope.from?.address ?? null}, from_name = ${filledEnvelope.from?.name ?? null},
          to_addrs = ${JSON.stringify(filledEnvelope.to)}::jsonb,
          cc_addrs = ${JSON.stringify(filledEnvelope.cc)}::jsonb,
          reply_to_addrs = ${JSON.stringify(filledEnvelope.replyTo)}::jsonb,
          subject = ${filledEnvelope.subject}, received_at = ${received.toISOString()},
          has_attachments = ${attachments.length > 0},
          attachments_meta = ${JSON.stringify(attachments)}::jsonb,
          headers_raw = ${JSON.stringify(filledEnvelope.headers)}::jsonb,
          body_text = ${filledEnvelope.textBody}, parse_error = ${parseError},
          mailbox_storage_path = ${mimeStored ? storagePath : null},
          mime_size = ${mimeSize}, mime_sha256 = ${sha256}, mime_stored = ${mimeStored}, mime_error = ${mimeError},
          routing_status = ${routing.status === "assigned" ? "unassigned" : routing.status},
          routing_reason = ${routingReason},
          routing_candidates = ${JSON.stringify(routing.candidates)}::jsonb,
          chase_draft_id = ${chase?.draft.id ?? null}, chase_match = ${chase?.kind ?? null},
          updated_by = ${actor}
      where id = ${messageId} and fetch_status = 'pending'
      returning id
    `;
    return { duplicateOf: null, filled: Boolean(rows[0]) };
  });
  if (fill.duplicateOf) return await dropDuplicateStub(messageId, fill.duplicateOf);
  if (!fill.filled) {
    // Somebody else filled it while we were fetching. Not an error: their row
    // says the same things.
    return { outcome: "duplicate", messageId };
  }

  // 7. THE TWO STRONGEST SIGNALS ASSIGN THEMSELVES, AND NOTHING ELSE DOES.
  //
  //    `autoAssignDecision` is the single reading of that rule — mail at a
  //    project's own inbox, or forwarded from it, starts its charged read with
  //    nobody watching; a subject reference, a known sender and an ambiguous
  //    outcome all wait on the Inbox screen with routing's own sentence. The
  //    decision lives beside the signals it reads rather than here, so the one
  //    other thing that will ever act on it cannot come to a different answer.
  //    Since A8 "strongest" also means VOUCHED FOR: a forwarding header or a
  //    To line with nothing Exchange or Graph stamped behind it is held.
  if (decision.assign) {
    try {
      await assignMessage({
        messageId,
        projectId: decision.projectId,
        kind: "auto",
        // The ROUTER placed it, not the fetcher: the trail has to say what
        // decided, because "the mailbox connector" is where the message came
        // from and not why it landed on this project.
        actor: ROUTER_ACTOR,
      });
      return { outcome: "stored", messageId, assigned: true };
    } catch (cause) {
      // The message IS recorded and IS readable; only the placement failed —
      // a copy the store refused, or a project archived since the registers
      // were read. Throwing here would burn a delivery on an answer that will
      // not change, and would leave a stored message reported as a failed
      // ingest: off the inbox's held list, which is the one state in this
      // feature that silently stops work. So it stays HELD, with the reason on
      // the row, and the Assign button is still there.
      const why = cause instanceof Error ? cause.message : String(cause);
      // Composed OUTSIDE the query: a backtick inside a tagged sql template
      // closes it, and esbuild then reports the syntax error thirty lines away.
      // The DAILY CAP (audit A5) is not a failure, and its sentence already
      // says what happens next, so it stands on its own after routing's.
      const reason =
        cause instanceof DomainConflictError && cause.code === "auto_read_cap"
          ? describeRouting(routing) + ". " + why
          : describeRouting(routing) + ". It could not be placed automatically: " + why;
      await sql`
        update email_messages
        set routing_reason = ${reason}, updated_by = ${actor}
        where id = ${messageId}
      `;
      return { outcome: "stored", messageId, assigned: false };
    }
  }

  return { outcome: "stored", messageId, assigned: false };
}

/**
 * This delivery is an email the inbox already holds: remove the stub this
 * delivery claimed, and ack. Fenced on the stub still being ours and still
 * unfilled, so nothing anybody has seen is ever removed. Removing it rather
 * than keeping a second row is the point (audit B8): a kept row is a second
 * message on the held list and a second Assign button for the same read.
 */
async function dropDuplicateStub(stubId: string, existingId: string): Promise<IngestOutcome> {
  await sql`delete from email_messages where id = ${stubId} and fetch_status = 'pending'`;
  return { outcome: "duplicate", messageId: existingId };
}

/** Deliveries exhausted. The inbox screen renders this with a Retry. */
export async function recordIngestFailure(
  mailbox: string,
  graphMessageId: string,
  error: string,
  actor: string,
): Promise<void> {
  await sql`
    update email_messages
    set fetch_status = 'failed', fetch_error = ${error.slice(0, 2000)}, updated_by = ${actor}
    where mailbox = ${mailbox} and graph_message_id = ${graphMessageId} and fetch_status = 'pending'
  `;
}
