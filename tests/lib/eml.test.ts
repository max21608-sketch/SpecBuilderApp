// Pure unit tests for the .eml builder -- no DB/network cost.
import { describe, expect, it } from "vitest";
import { buildEml, encodeHeaderValue, quotedPrintableEncode } from "@/lib/eml";

describe("quotedPrintableEncode", () => {
  it("encodes multi-byte UTF-8 characters (emoji, bullet, curly apostrophe)", () => {
    expect(quotedPrintableEncode("very well! \u{1F642}")).toBe("very well! =F0=9F=99=82");
    expect(quotedPrintableEncode("• 5m")).toBe("=E2=80=A2 5m");
    expect(quotedPrintableEncode("it’s")).toBe("it=E2=80=99s");
  });

  it("leaves plain ASCII text untouched", () => {
    expect(quotedPrintableEncode("Good afternoon,")).toBe("Good afternoon,");
  });

  it("preserves line breaks and encodes trailing whitespace before one", () => {
    const encoded = quotedPrintableEncode("line one \nline two");
    expect(encoded).toBe("line one=20\r\nline two");
  });

  it("soft-wraps lines longer than the RFC 2045 limit with a trailing '='", () => {
    const longLine = "a".repeat(100);
    const encoded = quotedPrintableEncode(longLine);
    const segments = encoded.split("\r\n");
    expect(segments.length).toBeGreaterThan(1);
    for (const seg of segments.slice(0, -1)) {
      expect(seg.endsWith("=")).toBe(true);
      expect(seg.length).toBeLessThanOrEqual(76);
    }
    // round-trips back to the original once soft breaks are undone
    expect(segments.map((s) => s.replace(/=$/, "")).join("")).toBe(longLine);
  });
});

describe("buildEml", () => {
  const base = {
    from: "Lenate de Villiers <lenate.devilliers@benwhistler.com>",
    to: "Romo <sales@romo.com>",
    subject: "Trade Pricing and Availability Request – Project Pembroke",
    body: "Good afternoon,\n\nMany thanks,\nLenate",
    format: "text" as const,
    date: new Date("2026-07-01T16:05:29Z"),
  };

  it("includes X-Unsent: 1 so Outlook opens it as an editable draft", () => {
    expect(buildEml(base)).toContain("X-Unsent: 1\r\n");
  });

  it("includes standard RFC 5322 / MIME headers (text/plain for legacy drafts)", () => {
    const eml = buildEml(base);
    expect(eml).toContain("From: Lenate de Villiers <lenate.devilliers@benwhistler.com>\r\n");
    expect(eml).toContain("To: Romo <sales@romo.com>\r\n");
    expect(eml).toContain("MIME-Version: 1.0\r\n");
    expect(eml).toContain('Content-Type: text/plain; charset="utf-8"\r\n');
    expect(eml).toContain("Content-Transfer-Encoding: quoted-printable\r\n");
  });

  it("RFC 2047-encodes a non-ASCII subject so the header stays pure ASCII", () => {
    const eml = buildEml(base); // subject contains the en dash
    const headerBlock = eml.split("\r\n\r\n")[0] ?? "";
    expect(headerBlock).toContain("Subject: =?utf-8?B?");
    expect([...headerBlock].every((ch) => ch.charCodeAt(0) <= 0x7f)).toBe(true);
    expect(encodeHeaderValue("plain ascii subject")).toBe("plain ascii subject");
    // decoders join adjacent encoded-words, dropping the folding whitespace
    const decoded = encodeHeaderValue(base.subject)
      .split(/\r\n /)
      .map((w) => Buffer.from(w.replace(/^=\?utf-8\?B\?/, "").replace(/\?=$/, ""), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe(base.subject);
  });

  it("declares text/html for html drafts and soft-wraps their long table rows", () => {
    const longRow = `<tr><td style="border:1px solid #999999">13 m</td><td style="border:1px solid #999999">Romo</td><td style="border:1px solid #999999">Bullion Fringe</td></tr>`;
    const eml = buildEml({ ...base, format: "html", body: `<div><table>${longRow}</table></div>` });
    expect(eml).toContain('Content-Type: text/html; charset="utf-8"\r\n');
    const bodyBlock = eml.split("\r\n\r\n")[1] ?? "";
    for (const seg of bodyBlock.split("\r\n")) {
      expect(seg.length).toBeLessThanOrEqual(76);
    }
    // undo soft breaks and QP escapes ('=' itself encodes as =3D) -> original html
    const joined = bodyBlock.trimEnd().split("\r\n").map((s) => s.replace(/=$/, "")).join("");
    const decoded = Buffer.from(
      joined.replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
      "latin1",
    ).toString("utf8");
    expect(decoded).toContain(longRow);
  });

  it("separates headers from the quoted-printable body with a blank line", () => {
    const eml = buildEml(base);
    const [headerBlock, bodyBlock] = eml.split("\r\n\r\n");
    expect(headerBlock).toContain("Subject:");
    expect(bodyBlock).toContain("Good afternoon,");
  });

  it("allows an empty To header when no recipient email could be resolved", () => {
    const eml = buildEml({ ...base, to: "" });
    expect(eml).toContain("To: \r\n");
  });

  // A register name is only validated as "non-empty", so an
  // interior CRLF would inject headers into a message a human then sends.
  it("does not let a CRLF in an address name inject a header", () => {
    const eml = buildEml({ ...base, to: "Acme\r\nBcc: attacker@example.com <sales@acme.test>" });
    const headerBlock = eml.split("\r\n\r\n")[0] ?? "";
    expect(headerBlock.split("\r\n").some((line) => line.startsWith("Bcc:"))).toBe(false);
    expect(headerBlock).toContain("To: Acme Bcc: attacker@example.com <sales@acme.test>");
  });

  it("does not let a CRLF in the From name split the message", () => {
    const eml = buildEml({ ...base, from: "Lenate\r\n\r\nInjected body <lenate@benwhistler.com>" });
    const [headerBlock] = eml.split("\r\n\r\n");
    expect(headerBlock).toContain("Content-Transfer-Encoding: quoted-printable");
  });
});
