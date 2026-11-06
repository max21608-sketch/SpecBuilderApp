// Recording an email that arrived, whoever brought it.
//
// Two ways in today, and they converge here on purpose:
//
//   * A person uploads a saved .eml against a project. Deliberate, so the
//     project is known and routing is only asked to confirm the choice.
//   * (Phase 2) The app mailbox delivers one by Microsoft Graph, with no
//     project known until the headers are read.
//
// Both produce an `email_messages` row with its envelope parsed, its headers
// kept verbatim, and a routing outcome. Nothing here reads the message with the
// model: that starts at ASSIGNMENT, which is where the money is spent.
//
// ---- THE SAME EMAIL TWICE IS ONE ROW (audit B8, 2026-11-06) ---------------
//
// 0021 indexed `internet_message_id` and gave the row a `mime_sha256`, and
// nothing read the first or wrote the second. So the same `.eml` uploaded
// twice was two messages, two runs and two charged reads, and the same mail
// reaching the app mailbox by two routes (a redirect AND a cc) was too. Every
// arrival now writes the hash, and before a message is recorded the inbox is
// asked for it: by Message-ID first, because that survives forwarding and
// re-saving, then by the bytes, for a message that carries no Message-ID. A
// match is OFFERED, never merged: the upload answers with the row it already
// is, and the Graph path records nothing.
import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { withTransaction, type TxnSql } from "@/lib/db-transaction";
import { parseEnvelope, type EmailEnvelope } from "@/lib/email-envelope";
import { describeRouting, routeMessage, type RoutingOutcome, type RoutingRegisters } from "@/lib/email-routing";
import { matchReplyToChase, type SentDraft } from "@/lib/chase-reply";

/** Projects and contacts, as the router needs them. One read per message. */
export async function loadRoutingRegisters(): Promise<RoutingRegisters> {
  const [projects, contacts] = await Promise.all([
    sql`select id, bws_project_number, name, shared_inbox, status from projects`,
    sql`select project_id, email from project_contacts where email is not null`,
  ]);
  return {
    projects: projects.map((row) => ({
      id: String(row.id),
      bwsProjectNumber: String(row.bws_project_number),
      name: String(row.name ?? ""),
      sharedInbox: row.shared_inbox === null || row.shared_inbox === undefined ? null : String(row.shared_inbox),
      status: String(row.status ?? "active"),
    })),
    contacts: contacts.map((row) => ({ projectId: String(row.project_id), email: String(row.email) })),
  };
}

/** Every sent chase on a project, for the reply hint. */
export async function loadSentDrafts(projectId: string): Promise<SentDraft[]> {
  const rows = await sql`
    select d.id, d.project_id, d.recipient_email, d.cc_email, d.subject, d.sent_at, d.recipient_name
    from email_drafts d
    where d.project_id = ${projectId} and d.status = 'sent'
    order by d.sent_at desc
    limit 50
  `;
  return rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    recipientEmail: row.recipient_email === null || row.recipient_email === undefined ? null : String(row.recipient_email),
    ccEmail: row.cc_email === null || row.cc_email === undefined ? null : String(row.cc_email),
    subject: String(row.subject ?? ""),
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : String(row.sent_at),
    recipientName: row.recipient_name === null || row.recipient_name === undefined ? null : String(row.recipient_name),
  }));
}

export type RecordedMessage = {
  id: string;
  routing: RoutingOutcome;
  envelope: EmailEnvelope;
  chase: { draftId: string; kind: string } | null;
};

/** The `.eml`'s SHA-256, hex. Written on every arrival, compared before recording. */
export function mimeSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A message the inbox already holds, as the upload screen and the inbox name it. */
export type DuplicateOf = {
  messageId: string;
  subject: string | null;
  projectId: string | null;
  bwsProjectNumber: string | null;
  routingStatus: string;
};

/**
 * Serialise two arrivals of the same email, so both cannot look, find nothing
 * and both insert. One advisory lock per key, in a fixed order, inside the
 * caller's transaction.
 */
export async function lockMessageIdentity(
  txn: TxnSql,
  identity: { internetMessageId: string | null; sha256: string | null },
): Promise<void> {
  const keys = [identity.internetMessageId, identity.sha256]
    .filter((key): key is string => Boolean(key))
    .map((key) => `email-identity:${key}`)
    .sort();
  for (const key of keys) await txn`select pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * The message the inbox already holds with this Message-ID, or else with
 * these exact bytes. Only a FETCHED row counts: a Graph stub still being read,
 * or one whose fetch failed, has said nothing yet about what it is.
 */
export async function findDuplicateMessage(
  db: TxnSql,
  identity: { internetMessageId: string | null; sha256: string | null },
  exceptId: string | null = null,
): Promise<DuplicateOf | null> {
  const shape = (row: Record<string, unknown> | undefined): DuplicateOf | null =>
    row
      ? {
          messageId: String(row.id),
          subject: row.subject === null || row.subject === undefined ? null : String(row.subject),
          projectId: row.project_id === null || row.project_id === undefined ? null : String(row.project_id),
          bwsProjectNumber:
            row.bws_project_number === null || row.bws_project_number === undefined
              ? null
              : String(row.bws_project_number),
          routingStatus: String(row.routing_status),
        }
      : null;

  if (identity.internetMessageId) {
    const byId = await db`
      select em.id, em.subject, em.project_id, em.routing_status, p.bws_project_number
      from email_messages em left join projects p on p.id = em.project_id
      where em.internet_message_id = ${identity.internetMessageId}
        and em.fetch_status = 'fetched'
        and (${exceptId}::uuid is null or em.id <> ${exceptId}::uuid)
      order by em.created_at, em.id
      limit 1
    `;
    if (byId[0]) return shape(byId[0]);
  }
  if (identity.sha256) {
    const byBytes = await db`
      select em.id, em.subject, em.project_id, em.routing_status, p.bws_project_number
      from email_messages em left join projects p on p.id = em.project_id
      where em.mime_sha256 = ${identity.sha256}
        and em.fetch_status = 'fetched'
        and (${exceptId}::uuid is null or em.id <> ${exceptId}::uuid)
      order by em.created_at, em.id
      limit 1
    `;
    if (byBytes[0]) return shape(byBytes[0]);
  }
  return null;
}

/** The sentence a screen says for a duplicate: what it is, and that nothing was read. */
export function describeDuplicate(duplicate: DuplicateOf): string {
  const subject = duplicate.subject ? `"${duplicate.subject}"` : "a message with no subject";
  const where =
    duplicate.routingStatus === "assigned" && duplicate.bwsProjectNumber
      ? `, on ${duplicate.bwsProjectNumber}`
      : ", on no project yet";
  return `This email is already in the inbox as ${subject}${where}. Nothing was recorded or read again.`;
}

type RecordInput = {
  mailbox: string;
  origin: "graph" | "upload";
  bytes: Buffer;
  storagePath: string;
  mimeSize: number;
  actor: string;
  intendedProjectId?: string | null;
  graphMessageId?: string | null;
  /**
   * For a tool standing in for Graph: the recipients Graph would have reported.
   * Routing reads them as stamped evidence (email-routing.ts). Never set from
   * an upload, whose bytes are all a person handed us.
   */
  reportedRecipients?: string[] | null;
};

async function readEnvelope(bytes: Buffer): Promise<{ envelope: EmailEnvelope; parseError: string | null }> {
  try {
    return { envelope: await parseEnvelope(bytes), parseError: null };
  } catch (cause) {
    // A message that will not parse is still a message somebody sent. It is
    // recorded, held, and shown with the reason — never dropped.
    return {
      parseError: cause instanceof Error ? cause.message : String(cause),
      envelope: {
        messageId: null,
        inReplyTo: null,
        references: [],
        from: null,
        replyTo: [],
        to: [],
        cc: [],
        subject: null,
        date: null,
        headers: [],
        textBody: null,
        htmlBody: null,
        attachments: [],
      },
    };
  }
}

/**
 * Insert one message, HELD.
 *
 * Nothing here assigns: `assignMessage` is the only thing that puts a message
 * on a project, because it is also what starts the paid read, and two places
 * doing that is two places to forget one half of it. The caller assigns
 * afterwards — an upload does it immediately with the project the person
 * chose, Graph ingestion only where routing was confident.
 *
 * `intendedProjectId` is the caller's choice where it has one, used only to
 * look up the chase this may be replying to. Routing runs regardless, so the
 * screen can say what the headers would have decided: a message uploaded to
 * the wrong project is worth noticing.
 */
export async function recordMessage(input: RecordInput): Promise<RecordedMessage> {
  const { envelope, parseError } = await readEnvelope(input.bytes);
  return insertMessage(sql, input, envelope, parseError, mimeSha256(input.bytes));
}

/**
 * `recordMessage`, unless the inbox already holds this email (audit B8). The
 * look and the insert are one transaction under the identity locks, so a
 * double-pressed upload cannot record it twice.
 */
export async function recordMessageUnlessKnown(
  input: RecordInput,
): Promise<{ recorded: RecordedMessage; duplicateOf: null } | { recorded: null; duplicateOf: DuplicateOf }> {
  const { envelope, parseError } = await readEnvelope(input.bytes);
  const identity = { internetMessageId: envelope.messageId, sha256: mimeSha256(input.bytes) };
  return withTransaction(async (txn) => {
    await lockMessageIdentity(txn, identity);
    const duplicateOf = await findDuplicateMessage(txn, identity);
    if (duplicateOf) return { recorded: null, duplicateOf };
    return { recorded: await insertMessage(txn, input, envelope, parseError, identity.sha256), duplicateOf: null };
  });
}

async function insertMessage(
  db: TxnSql,
  input: RecordInput,
  parsed: EmailEnvelope,
  parseError: string | null,
  sha256: string,
): Promise<RecordedMessage> {
  const envelope: EmailEnvelope = input.reportedRecipients
    ? { ...parsed, reportedRecipients: input.reportedRecipients.map((address) => address.trim().toLowerCase()) }
    : parsed;

  const registers = await loadRoutingRegisters();
  const routing = routeMessage(envelope, registers);

  const chaseProjectId =
    input.intendedProjectId ?? (routing.status === "assigned" ? routing.projectId : null);

  let chase: { draftId: string; kind: string } | null = null;
  if (chaseProjectId) {
    const match = matchReplyToChase(envelope, await loadSentDrafts(chaseProjectId));
    if (match) chase = { draftId: match.draft.id, kind: match.kind };
  }
  const rows = await db`
    insert into email_messages
      (mailbox, origin, fetch_status, graph_message_id, internet_message_id, conversation_id,
       in_reply_to, references_raw, from_addr, from_name, to_addrs, cc_addrs, reply_to_addrs,
       subject, received_at, has_attachments, attachments_meta, headers_raw, body_text, parse_error,
       mailbox_storage_path, mime_size, mime_sha256, mime_stored,
       routing_status, routing_reason, routing_candidates,
       chase_draft_id, chase_match, created_by, updated_by)
    values
      (${input.mailbox}, ${input.origin}, 'fetched', ${input.graphMessageId ?? null},
       ${envelope.messageId}, null, ${envelope.inReplyTo},
       ${envelope.references.length ? envelope.references.join(" ") : null},
       ${envelope.from?.address ?? null}, ${envelope.from?.name ?? null},
       ${JSON.stringify(envelope.to)}::jsonb, ${JSON.stringify(envelope.cc)}::jsonb,
       ${JSON.stringify(envelope.replyTo)}::jsonb,
       ${envelope.subject}, ${envelope.date}, ${envelope.attachments.length > 0},
       ${JSON.stringify(envelope.attachments)}::jsonb, ${JSON.stringify(envelope.headers)}::jsonb,
       ${envelope.textBody}, ${parseError},
       ${input.storagePath}, ${input.mimeSize}, ${sha256}, true,
       ${routing.status === "assigned" ? "unassigned" : routing.status}, ${describeRouting(routing)},
       ${JSON.stringify(routing.candidates)}::jsonb,
       ${chase?.draftId ?? null}, ${chase?.kind ?? null}, ${input.actor}, ${input.actor})
    returning id
  `;
  const id = rows[0] ? String(rows[0].id) : "";
  if (!id) throw new Error("the email was not recorded");

  return { id, routing, envelope, chase };
}
