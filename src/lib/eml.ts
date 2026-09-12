// Builds a downloadable .eml (RFC 5322 message) from a generated draft,
// so Lenate can open it directly in Outlook rather than copy-pasting.
// Single-part text/html (current drafts) or text/plain (legacy pre-0007
// drafts), quoted-printable, plus `X-Unsent: 1` so Outlook opens it as an
// editable/sendable draft instead of as received mail.
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

export type BuildEmlInput = {
  from: string; // "Name <email>"
  to: string; // "Name <email>", or "" when no address could be resolved
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

export function buildEml({ from, to, subject, body, format, date }: BuildEmlInput): string {
  const headers = [
    `From: ${stripHeaderBreaks(from)}`,
    `To: ${stripHeaderBreaks(to)}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${date.toUTCString()}`,
    `X-Unsent: 1`,
    `MIME-Version: 1.0`,
    `Content-Type: ${format === "html" ? "text/html" : "text/plain"}; charset="utf-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n${quotedPrintableEncode(body)}\r\n`;
}
