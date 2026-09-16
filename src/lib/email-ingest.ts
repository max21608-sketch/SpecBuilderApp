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
import { sql } from "@/lib/db";
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
export async function recordMessage(input: {
  mailbox: string;
  origin: "graph" | "upload";
  bytes: Buffer;
  storagePath: string;
  mimeSize: number;
  actor: string;
  intendedProjectId?: string | null;
  graphMessageId?: string | null;
}): Promise<RecordedMessage> {
  let envelope: EmailEnvelope;
  let parseError: string | null = null;
  try {
    envelope = await parseEnvelope(input.bytes);
  } catch (cause) {
    // A message that will not parse is still a message somebody sent. It is
    // recorded, held, and shown with the reason — never dropped.
    parseError = cause instanceof Error ? cause.message : String(cause);
    envelope = {
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
    };
  }

  const registers = await loadRoutingRegisters();
  const routing = routeMessage(envelope, registers);

  const chaseProjectId =
    input.intendedProjectId ?? (routing.status === "assigned" ? routing.projectId : null);

  let chase: { draftId: string; kind: string } | null = null;
  if (chaseProjectId) {
    const match = matchReplyToChase(envelope, await loadSentDrafts(chaseProjectId));
    if (match) chase = { draftId: match.draft.id, kind: match.kind };
  }
  const rows = await sql`
    insert into email_messages
      (mailbox, origin, fetch_status, graph_message_id, internet_message_id, conversation_id,
       in_reply_to, references_raw, from_addr, from_name, to_addrs, cc_addrs, reply_to_addrs,
       subject, received_at, has_attachments, attachments_meta, headers_raw, body_text, parse_error,
       mailbox_storage_path, mime_size, mime_stored,
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
       ${input.storagePath}, ${input.mimeSize}, true,
       ${routing.status === "assigned" ? "unassigned" : routing.status}, ${describeRouting(routing)},
       ${JSON.stringify(routing.candidates)}::jsonb,
       ${chase?.draftId ?? null}, ${chase?.kind ?? null}, ${input.actor}, ${input.actor})
    returning id
  `;
  const id = rows[0] ? String(rows[0].id) : "";
  if (!id) throw new Error("the email was not recorded");

  return { id, routing, envelope, chase };
}
