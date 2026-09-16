// Parsing an email. Synthetic fixtures only — real client mail never enters
// this repo, the same rule as every other document.
import { describe, expect, it } from "vitest";
import { buildEmailModelText, parseEnvelope, stripReplyPrefixes } from "@/lib/email-envelope";

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
