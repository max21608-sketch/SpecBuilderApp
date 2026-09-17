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
import { MAILBOX_PREFIX } from "@/lib/blob-source";
import {
  GraphError,
  assertGraphId,
  graphBytes,
  graphJson,
  mailIngestionEnabled,
  mailboxPath,
} from "@/lib/graph-client";
import { describeRouting, routeMessage } from "@/lib/email-routing";
import { loadRoutingRegisters, loadSentDrafts } from "@/lib/email-ingest";
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

  // 3. The message itself, kept whole. A parsed body is a reading of the email;
  //    the .eml is the email.
  const received = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();
  const storagePath = mailboxStoragePath(mailbox, graphMessageId, received);
  let mimeStored = false;
  let mimeSize: number | null = null;
  let mimeError: string | null = null;
  let envelope: EmailEnvelope | null = null;
  let parseError: string | null = null;

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
    try {
      envelope = await parseEnvelope(mime.bytes);
    } catch (cause) {
      parseError = cause instanceof Error ? cause.message : String(cause);
    }
  }
  if (!envelope) envelope = envelopeFromGraph(message);

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

  // 6. Fill the stub, fenced on it still being ours.
  const filled = await sql`
    update email_messages
    set fetch_status = 'fetched', fetch_error = null,
        internet_message_id = ${envelope.messageId}, conversation_id = ${message.conversationId ?? null},
        in_reply_to = ${envelope.inReplyTo},
        references_raw = ${envelope.references.length ? envelope.references.join(" ") : null},
        from_addr = ${envelope.from?.address ?? null}, from_name = ${envelope.from?.name ?? null},
        to_addrs = ${JSON.stringify(envelope.to)}::jsonb,
        cc_addrs = ${JSON.stringify(envelope.cc)}::jsonb,
        reply_to_addrs = ${JSON.stringify(envelope.replyTo)}::jsonb,
        subject = ${envelope.subject}, received_at = ${received.toISOString()},
        has_attachments = ${attachments.length > 0},
        attachments_meta = ${JSON.stringify(attachments)}::jsonb,
        headers_raw = ${JSON.stringify(envelope.headers)}::jsonb,
        body_text = ${envelope.textBody}, parse_error = ${parseError},
        mailbox_storage_path = ${mimeStored ? storagePath : null},
        mime_size = ${mimeSize}, mime_stored = ${mimeStored}, mime_error = ${mimeError},
        routing_status = ${routing.status === "assigned" ? "unassigned" : routing.status},
        routing_reason = ${describeRouting(routing)},
        routing_candidates = ${JSON.stringify(routing.candidates)}::jsonb,
        chase_draft_id = ${chase?.draft.id ?? null}, chase_match = ${chase?.kind ?? null},
        updated_by = ${actor}
    where id = ${messageId} and fetch_status = 'pending'
    returning id
  `;
  if (!filled[0]) {
    // Somebody else filled it while we were fetching. Not an error: their row
    // says the same things.
    return { outcome: "duplicate", messageId };
  }

  // 7. Confident routing assigns, which is what starts the charged read. An
  //    ambiguous outcome never does: two projects matching equally well is a
  //    decision, and it waits on the Inbox screen for a person.
  if (routing.status === "assigned") {
    await assignMessage({
      messageId,
      projectId: routing.projectId,
      kind: "auto",
      actor: "system:microsoft-graph",
    });
    return { outcome: "stored", messageId, assigned: true };
  }

  return { outcome: "stored", messageId, assigned: false };
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
