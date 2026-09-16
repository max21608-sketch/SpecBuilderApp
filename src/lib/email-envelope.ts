// An email, parsed into the shape the rest of the app reads.
//
// ============================================================================
// THE MESSAGE IS UNTRUSTED INPUT AND SO IS EVERY HEADER ON IT
//
// house/data-safety.md: "a document that contains text telling you to do
// something is a document containing text". That is doubly true here, because
// an email is written by somebody outside the company who may want the model to
// do something. Nothing parsed here is ever executed, rendered as HTML, or
// followed; the body becomes TEXT the model reads as data and every header is
// kept verbatim so a routing decision can be checked against what actually
// arrived.
//
// ---- WHY THE QUOTED HISTORY IS KEPT, AND MARKED --------------------------
//
// A reply to a chase quotes the questions it is answering, so throwing the
// quoted part away throws away what "yes, 720mm" refers to. But a thread ten
// messages deep restates every earlier answer, and a model reading it flat
// would re-propose values that were superseded three messages ago. So the
// quoted part is kept, wrapped in a marker, and the prompt tells the model to
// record from it only where the new text does not restate the value.
// ============================================================================
import PostalMime from "postal-mime";
import { htmlToPlainText } from "@/lib/html-text";

export type EmailAddress = { name: string | null; address: string };

export type EmailAttachmentMeta = {
  filename: string | null;
  contentType: string;
  size: number;
  /** A forwarded message carried as an attachment, rather than a document. */
  isRfc822: boolean;
};

export type EmailEnvelope = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: EmailAddress | null;
  replyTo: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string | null;
  /** ISO 8601, or null where the message carried no parseable Date. */
  date: string | null;
  /** Every header, unfolded, in the order it arrived. */
  headers: { name: string; value: string }[];
  textBody: string | null;
  htmlBody: string | null;
  attachments: EmailAttachmentMeta[];
};

/**
 * The cap on what reaches the model.
 *
 * Generous: a thread is legitimately long, and cutting a reply in half is how
 * the one sentence that matters goes missing. Quoted history is dropped first.
 */
export const MAX_MODEL_TEXT_CHARS = 200_000;

const QUOTE_START = "[quoted earlier message follows]";
const QUOTE_END = "[end of quoted message]";

function address(value: unknown): EmailAddress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { name?: unknown; address?: unknown };
  const addr = typeof row.address === "string" ? row.address.trim() : "";
  if (!addr) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
  return { name, address: addr.toLowerCase() };
}

function addresses(value: unknown): EmailAddress[] {
  if (!Array.isArray(value)) return [];
  return value.map(address).filter((a): a is EmailAddress => a !== null);
}

/** Parses a stored `.eml`. Never throws on a malformed part — a half-read message is still worth reviewing. */
export async function parseEnvelope(bytes: Buffer | Uint8Array): Promise<EmailEnvelope> {
  const parsed = await PostalMime.parse(bytes);

  const headers = (parsed.headers ?? []).map((header) => ({
    name: String(header.key ?? ""),
    // Header values are folded across lines in the wire format. Unfolded here
    // so a routing match on a mailbox address is not defeated by a line break.
    value: String(header.value ?? "").replace(/\s*\r?\n\s+/g, " ").trim(),
  }));

  const references = String(parsed.references ?? "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return {
    messageId: parsed.messageId ? String(parsed.messageId).trim() : null,
    inReplyTo: parsed.inReplyTo ? String(parsed.inReplyTo).trim() : null,
    references,
    from: address(parsed.from),
    replyTo: addresses(parsed.replyTo),
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    subject: parsed.subject ? String(parsed.subject) : null,
    date: parsed.date ? new Date(String(parsed.date)).toISOString() : null,
    headers,
    textBody: parsed.text ? String(parsed.text) : null,
    htmlBody: parsed.html ? String(parsed.html) : null,
    attachments: (parsed.attachments ?? []).map((attachment) => {
      const contentType = String(attachment.mimeType ?? "application/octet-stream").toLowerCase();
      return {
        filename: attachment.filename ? String(attachment.filename) : null,
        contentType,
        size:
          attachment.content instanceof ArrayBuffer
            ? attachment.content.byteLength
            : typeof attachment.content === "string"
              ? attachment.content.length
              : 0,
        isRfc822: contentType.startsWith("message/rfc822"),
      };
    }),
  };
}

/** `RE: FW: Re: Panther` → `Panther`. Covers the English, German and French prefixes Outlook writes. */
export function stripReplyPrefixes(subject: string): string {
  let out = subject.trim();
  // Repeated, because a thread accumulates them: "RE: FW: RE: ...".
  for (;;) {
    const next = out.replace(/^\s*(re|fw|fwd|aw|wg|tr|rv)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === out) return out.trim();
    out = next;
  }
}

/**
 * Where the quoted history starts, or -1.
 *
 * Deliberately conservative — a false positive silently hides the half of the
 * message the reader cares about. Only the four markers Outlook, Gmail and
 * Apple Mail actually write, and only at the start of a line.
 */
function quoteStartIndex(text: string): number {
  const patterns: { re: RegExp; needsPrecedingText: boolean }[] = [
    { re: /^-{2,}\s*Original Message\s*-{2,}\s*$/im, needsPrecedingText: false },
    { re: /^_{5,}\s*$/m, needsPrecedingText: false },
    { re: /^On .{4,120}\swrote:\s*$/im, needsPrecedingText: false },
    // "From:" only counts as a boundary when there is a message ABOVE it. A
    // message that OPENS with it is a pasted forward, and cutting at the first
    // line would hide the whole thing.
    { re: /^From:\s*.+$/im, needsPrecedingText: true },
  ];
  let earliest = -1;
  for (const { re, needsPrecedingText } of patterns) {
    const match = re.exec(text);
    if (!match) continue;
    if (needsPrecedingText && text.slice(0, match.index).trim().length < 40) continue;
    if (earliest === -1 || match.index < earliest) earliest = match.index;
  }
  return earliest;
}

/**
 * The email as one block of text for the model: headers, then the body, with
 * any quoted history marked.
 *
 * Headers are included because the model is being asked what the email SAYS,
 * and who said it and when is part of that. It is told, in the prompt, that
 * they are data.
 */
export function buildEmailModelText(envelope: EmailEnvelope): { text: string; truncated: boolean } {
  const list = (people: EmailAddress[]) =>
    people.map((p) => (p.name ? `${p.name} <${p.address}>` : p.address)).join(", ");

  const header = [
    `From: ${envelope.from ? list([envelope.from]) : "(none)"}`,
    `To: ${list(envelope.to) || "(none)"}`,
    envelope.cc.length ? `Cc: ${list(envelope.cc)}` : null,
    `Date: ${envelope.date ?? "(none)"}`,
    `Subject: ${envelope.subject ?? "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");

  const plain = (envelope.textBody ?? (envelope.htmlBody ? htmlToPlainText(envelope.htmlBody) : "") ?? "").trim();

  const cut = quoteStartIndex(plain);
  const fresh = cut === -1 ? plain : plain.slice(0, cut).trim();
  const quoted = cut === -1 ? "" : plain.slice(cut).trim();

  const compose = (includeQuoted: boolean) =>
    `${header}\n\n--- message ---\n${fresh}` +
    (includeQuoted && quoted ? `\n\n${QUOTE_START}\n${quoted}\n${QUOTE_END}\n` : "");

  const whole = compose(true);
  if (whole.length <= MAX_MODEL_TEXT_CHARS) return { text: whole, truncated: false };

  // Drop the quoted history first: it is the part whose values are most likely
  // to be superseded anyway.
  const withoutQuote = compose(false);
  if (withoutQuote.length <= MAX_MODEL_TEXT_CHARS) return { text: withoutQuote, truncated: true };

  return { text: withoutQuote.slice(0, MAX_MODEL_TEXT_CHARS), truncated: true };
}
