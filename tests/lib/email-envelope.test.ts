// Parsing an email. Synthetic fixtures only — real client mail never enters
// this repo, the same rule as every other document.
import { describe, expect, it } from "vitest";
import {
  buildEmailModelText,
  parseEnvelope,
  readAttachment,
  sameListedAttachment,
  stripReplyPrefixes,
} from "@/lib/email-envelope";

function eml(headers: string, body: string): Buffer {
  return Buffer.from(`${headers.trim()}\r\n\r\n${body}`, "utf8");
}

const plain = eml(
  `From: Jane Doe <jane@designers.test>
To: Project Panther <p17726@benwhistler.test>
Subject: RE: P17726 Panther - outstanding specification information
Date: Wed, 16 Sep 2026 10:30:00 +0100
Message-ID: <abc123@designers.test>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8`,
  "Seat height is 440mm.\r\nThe fabric is CH-01.1.\r\n",
);

describe("parseEnvelope", () => {
  it("reads the envelope of a plain-text message", async () => {
    const envelope = await parseEnvelope(plain);
    expect(envelope.from).toEqual({ name: "Jane Doe", address: "jane@designers.test" });
    expect(envelope.to).toEqual([{ name: "Project Panther", address: "p17726@benwhistler.test" }]);
    expect(envelope.subject).toContain("outstanding specification information");
    expect(envelope.messageId).toBe("<abc123@designers.test>");
    expect(envelope.textBody).toContain("Seat height is 440mm.");
    expect(envelope.date).toBe("2026-09-16T09:30:00.000Z");
  });

  it("falls back to the HTML part when there is no plain one", async () => {
    const html = eml(
      `From: a@b.test
To: c@d.test
Subject: Fabric
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8`,
      "<p>The fabric is <b>CH-01.1</b>.</p>",
    );
    const envelope = await parseEnvelope(html);
    expect(envelope.textBody ?? "").not.toContain("CH-01.1");
    const { text } = buildEmailModelText(envelope);
    // Rendered to text, tags gone, the value intact.
    expect(text).toContain("The fabric is CH-01.1.");
    expect(text).not.toContain("<b>");
  });

  it("unfolds a header that arrived across two lines", async () => {
    // Exchange folds long headers. A routing match on a mailbox address must
    // not be defeated by where the line happened to break.
    const folded = eml(
      `From: a@b.test
To: c@d.test
Subject: Folded
X-MS-Exchange-Inbox-Rules-Loop:
 p17726@benwhistler.test`,
      "body",
    );
    const envelope = await parseEnvelope(folded);
    const header = envelope.headers.find((h) => h.name.toLowerCase() === "x-ms-exchange-inbox-rules-loop");
    expect(header?.value).toBe("p17726@benwhistler.test");
  });

  it("decodes an RFC 2047 subject rather than showing its encoding", async () => {
    const encoded = eml(
      `From: a@b.test
To: c@d.test
Subject: =?utf-8?B?Q2hhaXNlIGxvbmd1ZSDigJQgZGltZW5zaW9ucw==?=`,
      "body",
    );
    const envelope = await parseEnvelope(encoded);
    expect(envelope.subject).toBe("Chaise longue — dimensions");
  });

  it("lists an attached forward as a message, not as a document", async () => {
    const forwarded = eml(
      `From: a@b.test
To: c@d.test
Subject: FW: spec
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="BOUND"`,
      [
        "--BOUND",
        "Content-Type: text/plain",
        "",
        "See attached.",
        "--BOUND",
        'Content-Type: message/rfc822; name="original.eml"',
        'Content-Disposition: attachment; filename="original.eml"',
        "",
        "From: x@y.test",
        "Subject: inner",
        "",
        "inner body",
        "--BOUND--",
        "",
      ].join("\r\n"),
    );
    const envelope = await parseEnvelope(forwarded);
    expect(envelope.attachments.some((a) => a.isRfc822)).toBe(true);
  });
});

describe("buildEmailModelText", () => {
  it("puts the envelope in front of the body", async () => {
    const { text } = buildEmailModelText(await parseEnvelope(plain));
    expect(text).toContain("From: Jane Doe <jane@designers.test>");
    expect(text).toContain("Subject: RE: P17726 Panther");
    expect(text.indexOf("From:")).toBeLessThan(text.indexOf("Seat height"));
  });

  it("marks the quoted history instead of deleting it", async () => {
    // A reply quotes the question it answers, so throwing it away throws away
    // what "yes, 720mm" refers to.
    const reply = eml(
      `From: a@b.test
To: c@d.test
Subject: RE: spec`,
      [
        "Yes, 720mm is right.",
        "",
        "On Tue, 15 Sep 2026 at 09:00, Ben Whistler wrote:",
        "> What is the overall height?",
        "",
      ].join("\r\n"),
    );
    const { text } = buildEmailModelText(await parseEnvelope(reply));
    expect(text).toContain("Yes, 720mm is right.");
    expect(text).toContain("[quoted earlier message follows]");
    expect(text).toContain("What is the overall height?");
    expect(text).toContain("[end of quoted message]");
    expect(text.indexOf("Yes, 720mm")).toBeLessThan(text.indexOf("[quoted earlier"));
  });

  it("does not treat a message that opens with a pasted forward as all quote", async () => {
    // "From:" on the first line is a pasted forward, not a quote boundary.
    // Cutting there would hide the entire message.
    const pasted = eml(
      `From: a@b.test
To: c@d.test
Subject: FW`,
      ["From: client@x.test", "Sent: Monday", "", "The seat height is 450mm.", ""].join("\r\n"),
    );
    const { text } = buildEmailModelText(await parseEnvelope(pasted));
    expect(text).toContain("The seat height is 450mm.");
  });

  it("drops the quoted history first when the message is too long", async () => {
    const long = "x".repeat(150_000);
    const huge = eml(
      `From: a@b.test
To: c@d.test
Subject: long`,
      [`The width is 1900mm. ${long}`, "", "On Tue, 15 Sep 2026 at 09:00, Ben Whistler wrote:", `> ${long}`].join(
        "\r\n",
      ),
    );
    const { text, truncated } = buildEmailModelText(await parseEnvelope(huge));
    expect(truncated).toBe(true);
    expect(text).toContain("The width is 1900mm.");
    expect(text).not.toContain("[quoted earlier message follows]");
  });
});

describe("stripReplyPrefixes", () => {
  it("strips a thread's accumulated prefixes, in any case and language Outlook writes", () => {
    expect(stripReplyPrefixes("RE: FW: Re: P17726 Panther")).toBe("P17726 Panther");
    expect(stripReplyPrefixes("AW: WG: Panther")).toBe("Panther");
    expect(stripReplyPrefixes("Panther")).toBe("Panther");
  });

  it("leaves a subject whose first word merely looks like a prefix", () => {
    expect(stripReplyPrefixes("Revised drawings attached")).toBe("Revised drawings attached");
  });
});

// ============================================================================
// AN EMAIL WHOSE SPECIFICATION IS IN AN ATTACHED PDF — Stage 2 variance row 4.
//
// The body is read as it always was; the attachment is LISTED and never read,
// because a document's kind is declared by a person and reading one is a
// charged call. What this pins is that the list is right and that the bytes are
// reachable by the index the list shows — the two disagreeing about which file
// is number three would have somebody download the wrong document believing it
// was the one they clicked.
//
// The PDF is four invented bytes. Nothing real, and nothing is parsed out of it.
// ============================================================================
describe("an email carrying attachments", () => {
  const pdfBytes = Buffer.from("%PDF-1.7 invented", "utf8");
  const withAttachments = Buffer.from(
    [
      "From: Jane Doe <jane@designers.test>",
      "To: Project Panther <p17726@benwhistler.test>",
      "Subject: RE: X-100 - sizes attached",
      "Date: Wed, 16 Sep 2026 10:30:00 +0100",
      "Message-ID: <att1@designers.test>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="B1"',
      "",
      "--B1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Sizes are in the attached sheet. Fabric is CH-01.1.",
      "--B1",
      'Content-Type: application/pdf; name="X-100 sizes.pdf"',
      "Content-Disposition: attachment; filename=\"X-100 sizes.pdf\"",
      "Content-Transfer-Encoding: base64",
      "",
      pdfBytes.toString("base64"),
      "--B1",
      'Content-Type: message/rfc822; name="forwarded.eml"',
      'Content-Disposition: attachment; filename="forwarded.eml"',
      "",
      "From: someone@else.test",
      "Subject: the original",
      "",
      "the original body",
      "--B1--",
      "",
    ].join("\r\n"),
    "utf8",
  );

  it("lists each attachment with its name, type and size, and marks a forwarded message", async () => {
    const envelope = await parseEnvelope(withAttachments);
    // The body is still read: the attachment does not replace it.
    expect(envelope.textBody).toContain("Fabric is CH-01.1");
    expect(envelope.attachments).toHaveLength(2);
    const [sheet, forwarded] = envelope.attachments;
    expect(sheet?.filename).toBe("X-100 sizes.pdf");
    expect(sheet?.contentType).toBe("application/pdf");
    expect(sheet?.size).toBe(pdfBytes.byteLength);
    expect(sheet?.isRfc822).toBe(false);
    // A forwarded message is a different thing from a document and says so on
    // the screen, because registering one as an intake document is wrong.
    expect(forwarded?.isRfc822).toBe(true);
  });

  it("hands back ONE attachment's bytes, by the index the list shows", async () => {
    const found = await readAttachment(withAttachments, 0);
    expect(found?.meta.filename).toBe("X-100 sizes.pdf");
    expect(found?.bytes.equals(pdfBytes)).toBe(true);
    // The index is taken against the same parse that produced the list.
    expect((await readAttachment(withAttachments, 1))?.meta.filename).toBe("forwarded.eml");
  });

  it("refuses an index the message does not have, rather than guessing one", async () => {
    expect(await readAttachment(withAttachments, 2)).toBeNull();
    expect(await readAttachment(withAttachments, -1)).toBeNull();
    expect(await readAttachment(withAttachments, 1.5)).toBeNull();
    // A message with no attachments has none to hand back.
    expect(await readAttachment(plain, 0)).toBeNull();
  });

  it("never inlines an attachment into the text the model reads", async () => {
    // A charged read of the body must not become a charged read of everything
    // that came with it: the kind of each file is a person's declaration.
    const { text } = buildEmailModelText(await parseEnvelope(withAttachments));
    expect(text).toContain("Sizes are in the attached sheet");
    expect(text).not.toContain("%PDF");
    expect(text).not.toContain(pdfBytes.toString("base64"));
  });
});

// ============================================================================
// WHAT POSTAL-MIME 4 CHANGED (2026-11-20, 3.0.0 -> 4.2.1 for GHSA-f2hq-32vh-53cc)
//
// Every `.eml` this app holds is parsed by postal-mime, so the upgrade was read
// against a synthetic corpus under both versions before it landed. These pin
// the differences that reach what a person sees or what the model is sent.
// Invented messages only.
// ============================================================================
describe("postal-mime 4", () => {
  const forward = [
    "From: Client <client@x.test>",
    "To: d@designers.test",
    "Subject: the original",
    "",
    "The seat height is 450mm.",
    "",
  ].join("\r\n");

  it("hands back an attached calendar invite's bytes, which arrive as a Uint8Array", async () => {
    // Read as 0 bytes and refused for download until this change: postal-mime
    // decodes `text/calendar` itself, and only ArrayBuffer and string were read.
    const invite = eml(
      `From: a@b.test
To: c@d.test
Subject: site visit
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="C"`,
      [
        "--C",
        "Content-Type: text/plain",
        "",
        "Invite attached.",
        "--C",
        "Content-Type: text/calendar; method=request; charset=utf-8",
        'Content-Disposition: attachment; filename="visit.ics"',
        "",
        "BEGIN:VCALENDAR",
        "END:VCALENDAR",
        "--C--",
        "",
      ].join("\r\n"),
    );
    const envelope = await parseEnvelope(invite);
    expect(envelope.attachments[0]?.filename).toBe("visit.ics");
    expect(envelope.attachments[0]?.size).toBeGreaterThan(0);
    const found = await readAttachment(invite, 0);
    expect(found?.bytes.toString("utf8")).toContain("BEGIN:VCALENDAR");
    expect(found?.bytes.byteLength).toBe(envelope.attachments[0]?.size);
  });

  it("hands back an attached forward byte for byte, line endings included", async () => {
    // 3.0.0 rewrote the CRLFs of a 7bit part to LF, so the .eml a person
    // downloaded was not the one that was sent.
    const message = eml(
      `From: a@b.test
To: c@d.test
Subject: FW: spec
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="F"`,
      [
        "--F",
        "Content-Type: text/plain",
        "",
        "Attached.",
        "--F",
        'Content-Type: message/rfc822; name="orig.eml"',
        'Content-Disposition: attachment; filename="orig.eml"',
        "",
        forward,
        "--F--",
        "",
      ].join("\r\n"),
    );
    const found = await readAttachment(message, 0);
    expect(found?.meta.isRfc822).toBe(true);
    expect(found?.bytes.toString("utf8")).toBe(forward);
  });

  it("lists a base64-encoded forward with no disposition as a forwarded message, and keeps its text out of the read", async () => {
    // 3.0.0 decoded it and rendered it INTO the body, so the model read it;
    // 4.1.4 keeps an encoded message/rfc822 part as an attachment (RFC 2046
    // allows only 7bit, 8bit or binary there). It is listed as a forward, which
    // the screen says is not an intake document, and a person decides.
    const message = eml(
      `From: a@b.test
To: c@d.test
Subject: FW: spec
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="G"`,
      [
        "--G",
        "Content-Type: text/plain",
        "",
        "Below.",
        "--G",
        "Content-Type: message/rfc822",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(forward, "utf8").toString("base64"),
        "--G--",
        "",
      ].join("\r\n"),
    );
    const envelope = await parseEnvelope(message);
    expect(envelope.attachments).toHaveLength(1);
    expect(envelope.attachments[0]?.isRfc822).toBe(true);
    const { text } = buildEmailModelText(envelope);
    expect(text).toContain("Below.");
    expect(text).not.toContain("450mm");
  });

  it("still renders an unencoded forward with no disposition into the body", async () => {
    // The common shape, unchanged: the forwarded text reaches the model, marked
    // as quoted history.
    const message = eml(
      `From: a@b.test
To: c@d.test
Subject: FW: spec
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="H"`,
      ["--H", "Content-Type: text/plain", "", "See below.", "--H", "Content-Type: message/rfc822", "", forward, "--H--", ""].join(
        "\r\n",
      ),
    );
    const envelope = await parseEnvelope(message);
    expect(envelope.attachments).toHaveLength(0);
    expect(buildEmailModelText(envelope).text).toContain("The seat height is 450mm.");
  });

  it("reads 8-bit text with no charset as windows-1252 rather than as replacement characters", async () => {
    const message = Buffer.concat([
      Buffer.from("From: a@b.test\r\nTo: c@d.test\r\nSubject: fabric\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: 8bit\r\n\r\n", "utf8"),
      // "Café – 10" in windows-1252: é is 0xE9, the en dash 0x96.
      Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x31, 0x30, 0x0d, 0x0a]),
    ]);
    expect((await parseEnvelope(message)).textBody).toContain("Café – 10");
  });
});

// ============================================================================
// THE FILE SENT IS THE FILE CLICKED (2026-11-20). The download route compares
// what a fresh parse holds at an index with what registration LISTED there.
// The route's own refusal is proven in tests/db/email-attachment-route.test.ts.
// ============================================================================
describe("sameListedAttachment", () => {
  const fresh = { filename: "X-100 sizes.pdf", contentType: "application/pdf", size: 28, isRfc822: false };

  it("agrees with the entry registration wrote for the same file", () => {
    expect(sameListedAttachment({ ...fresh }, fresh, { sizeComparable: true })).toBe(true);
  });

  it("refuses a different name, type or kind at the same index", () => {
    expect(sameListedAttachment({ ...fresh, filename: "forwarded.eml" }, fresh, { sizeComparable: true })).toBe(false);
    expect(sameListedAttachment({ ...fresh, filename: null }, fresh, { sizeComparable: true })).toBe(false);
    expect(sameListedAttachment({ ...fresh, contentType: "message/rfc822" }, fresh, { sizeComparable: true })).toBe(false);
    expect(sameListedAttachment({ ...fresh, isRfc822: true }, fresh, { sizeComparable: true })).toBe(false);
    expect(sameListedAttachment(undefined, fresh, { sizeComparable: true })).toBe(false);
  });

  it("compares the size only where this parser wrote the list", () => {
    // An upload's list is parseEnvelope's own, so a different count is a
    // different reading. A Graph arrival lists Graph's count, which is not
    // known to be the decoded bytes, so it cannot be held to it.
    expect(sameListedAttachment({ ...fresh, size: 0 }, fresh, { sizeComparable: true })).toBe(false);
    expect(sameListedAttachment({ ...fresh, size: 4096 }, fresh, { sizeComparable: false })).toBe(true);
  });
});
