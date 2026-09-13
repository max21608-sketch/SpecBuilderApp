// Pure unit tests for the .eml builder -- no DB/network cost.
import { describe, expect, it } from "vitest";
import { buildEml, encodeHeaderValue, formatAddress, quotedPrintableEncode } from "@/lib/eml";

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

describe("buildEml — Cc", () => {
  const base = {
    from: "Max de Groot <max@benwhistler.com>",
    to: "Tristan Auer <studio@example.test>",
    subject: "P17231 — outstanding specification information",
    body: "Good morning,",
    format: "html" as const,
    date: new Date("2026-09-13T09:00:00Z"),
  };

  it("emits a Cc header immediately after To", () => {
    const headerBlock = buildEml({ ...base, cc: "p17231@benwhistler.com" }).split("\r\n\r\n")[0] ?? "";
    const lines = headerBlock.split("\r\n");
    const toIndex = lines.findIndex((l) => l.startsWith("To:"));
    expect(lines[toIndex + 1]).toBe("Cc: p17231@benwhistler.com");
  });

  // An empty `Cc:` is not the same as no Cc -- some clients render it as a
  // blank recipient chip the sender then has to delete.
  it("emits no Cc header at all when there is no copied recipient", () => {
    for (const cc of [undefined, "", "   "]) {
      const eml = buildEml({ ...base, cc });
      expect(eml.split("\r\n\r\n")[0]).not.toContain("Cc:");
    }
  });

  it("does not let a CRLF in the Cc value inject a header", () => {
    const eml = buildEml({ ...base, cc: "p17231@benwhistler.com\r\nBcc: attacker@example.test" });
    const headerBlock = eml.split("\r\n\r\n")[0] ?? "";
    expect(headerBlock.split("\r\n").some((line) => line.startsWith("Bcc:"))).toBe(false);
    expect(headerBlock).toContain("Cc: p17231@benwhistler.com Bcc: attacker@example.test");
  });
});

describe("formatAddress", () => {
  it("returns a bare mailbox when there is no display name", () => {
    expect(formatAddress(null, "a@b.test")).toBe("a@b.test");
    expect(formatAddress("  ", "a@b.test")).toBe("a@b.test");
  });

  it("leaves a plain ASCII name unquoted", () => {
    expect(formatAddress("Tristan Auer", "ta@example.test")).toBe("Tristan Auer <ta@example.test>");
  });

  // The reason this function exists: a bare comma splits one recipient into
  // two, the second of them malformed.
  it("quotes a name containing a comma so it stays ONE recipient", () => {
    expect(formatAddress("Lecoadic, Scotto", "lcs@example.test")).toBe('"Lecoadic, Scotto" <lcs@example.test>');
  });

  it("escapes quotes and backslashes inside a quoted name", () => {
    expect(formatAddress('A "B" \\ C,', "x@y.test")).toBe('"A \\"B\\" \\\\ C," <x@y.test>');
  });

  it("RFC 2047-encodes a non-ASCII name rather than quoting it", () => {
    const formatted = formatAddress("Bérénice Lécoadic", "bl@example.test");
    expect(formatted).toMatch(/^=\?utf-8\?B\?/);
    expect(formatted.endsWith("<bl@example.test>")).toBe(true);
    // An encoded-word is not permitted inside a quoted string.
    expect(formatted).not.toContain('"');
    expect(/^[\x20-\x7e]*$/.test(formatted)).toBe(true);
  });

  it("strips CR/LF from both halves", () => {
    const formatted = formatAddress("A\r\nBcc: x@y.test", "good@z.test\r\nBcc: q@r.test");
    expect(formatted).not.toContain("\r");
    expect(formatted).not.toContain("\n");
  });

  it("returns an empty string when there is no address to format", () => {
    expect(formatAddress("Someone", "")).toBe("");
  });
});
