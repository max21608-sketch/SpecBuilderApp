// Builds a downloadable .eml (RFC 5322 message) from a generated draft, so the
// person chasing can open it directly in Outlook rather than copy-pasting.
// Single-part text/html or text/plain, quoted-printable, plus `X-Unsent: 1` so
// Outlook opens it as an editable/sendable draft instead of as received mail.
//
// Deliberately single-part: no multipart, no boundary, no attachments. The
// whole safety argument for this file is that it is small enough to read.
//
// The app never sends. This builds a file a human opens and sends themselves.
const QP_LINE_LIMIT = 76; // RFC 2045 hard cap on a quoted-printable line, including the soft-break "="

function qpEncodeLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  const units: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    const isLastByte = i === bytes.length - 1;
    if (b === 0x09 || b === 0x20) {
      // Trailing whitespace must be encoded so mail clients don't strip it.
      units.push(isLastByte ? `=${b.toString(16).toUpperCase().padStart(2, "0")}` : String.fromCharCode(b));
    } else if (b >= 33 && b <= 126 && b !== 0x3d) {
      units.push(String.fromCharCode(b));
    } else {
      units.push(`=${b.toString(16).toUpperCase().padStart(2, "0")}`);
    }
  }

  const wrapped: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current.length + unit.length > QP_LINE_LIMIT - 1) {
      wrapped.push(`${current}=`);
      current = "";
    }
    current += unit;
  }
  wrapped.push(current);
  return wrapped.join("\r\n");
}

export function quotedPrintableEncode(text: string): string {
  return text
    .split("\n")
    .map(qpEncodeLine)
    .join("\r\n");
}

// Header values must be ASCII (RFC 5322); the subject now contains an en
// dash, so non-ASCII values become RFC 2047 encoded-words -- split into
// short chunks because a single encoded-word may not exceed 75 chars, and
// joined with folding whitespace (which decoders drop between them).
export function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const chunks: string[] = [];
  let chunk = "";
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 33) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((c) => `=?utf-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`).join("\r\n ");
}

// Characters RFC 5322 calls "specials": a display name containing one of them
// is not a valid atom sequence and has to be quoted, or the address parses as
// something else entirely. A bare comma is the dangerous one -- `Lecoadic,
// Scotto <a@b>` reads as TWO recipients, one of them malformed.
const ADDRESS_SPECIALS = /[()<>[\]:;@\\,."]/;

/**
 * Builds one `Display Name <mailbox>` header value safely.
 *
 * Concatenating the two by hand is what this replaces. A name is quoted when it
 * contains specials, RFC 2047 encoded when it is not ASCII (an encoded-word is
 * NOT allowed inside a quoted string, so those two cases are exclusive), and
 * dropped entirely when it is blank.
 */
export function formatAddress(name: string | null | undefined, email: string): string {
  const address = stripHeaderBreaks(email).trim();
  if (!address) return "";

  const display = stripHeaderBreaks(name ?? "").trim();
  if (!display) return address;

  // Non-ASCII: encoded-word, which may not be wrapped in quotes.
  if (!/^[\x20-\x7e]*$/.test(display)) {
    return `${encodeHeaderValue(display)} <${address}>`;
  }
  if (ADDRESS_SPECIALS.test(display)) {
    return `"${display.replace(/([\\"])/g, "\\$1")}" <${address}>`;
  }
  return `${display} <${address}>`;
}

export type BuildEmlInput = {
  from: string; // "Name <email>"
  to: string; // "Name <email>", or "" when no address could be resolved
  /**
   * Copied recipients, already formatted. Empty or absent emits no Cc header at
   * all -- an empty `Cc:` line is not the same as no Cc, and some clients
   * surface it as a blank recipient chip.
   */
  cc?: string;
  subject: string;
  body: string;
  format: "text" | "html";
  date: Date;
};

// Address headers are built from register names and
// the signed-in user's name, none of which forbid CR/LF -- an interior newline
// would inject arbitrary headers (Bcc:, Reply-To:) into a message a human is
// about to send from Outlook. Fold any CR/LF run to a single space.
function stripHeaderBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export function buildEml({ from, to, cc, subject, body, format, date }: BuildEmlInput): string {
  const ccValue = stripHeaderBreaks(cc ?? "").trim();
  const headers = [
    `From: ${stripHeaderBreaks(from)}`,
    `To: ${stripHeaderBreaks(to)}`,
    ...(ccValue ? [`Cc: ${ccValue}`] : []),
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${date.toUTCString()}`,
    `X-Unsent: 1`,
    `MIME-Version: 1.0`,
    `Content-Type: ${format === "html" ? "text/html" : "text/plain"}; charset="utf-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n${quotedPrintableEncode(body)}\r\n`;
}
