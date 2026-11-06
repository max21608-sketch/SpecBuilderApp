// An email whose `Date:` header is not a date is still an email (audit E8,
// 2026-11-06).
//
// `parseEnvelope` turned the header into ISO with `new Date(raw).toISOString()`,
// which THROWS on anything it cannot read ("Invalid time value"). postal-mime
// hands the raw header back unchanged when it cannot parse it, so a message
// with `Date: sometime last week` threw at every step that parses it:
// registration, Graph ingestion, and the worker's source preparation, where it
// failed a paid read with a RangeError nobody could connect to a header. The
// header is kept as written and the date is null; the model is shown both.
import { describe, expect, it, vi } from "vitest";
import { buildEmailModelText, parseEnvelope } from "@/lib/email-envelope";
import { prepareDocumentSource } from "@/lib/intake-source";

function eml(date: string): Buffer {
  return Buffer.from(
    `From: Hayley <hayley@example.test>\r\nTo: specs@example.test\r\nSubject: __QA fabric\r\nDate: ${date}\r\n\r\nThe armchair is in __QA Wool.\r\n`,
  );
}

describe("an email's Date header", () => {
  it("is read as ISO where it is a date", async () => {
    const envelope = await parseEnvelope(eml("Mon, 14 Sep 2026 10:00:00 +0100"));
    expect(envelope.date).toBe("2026-09-14T09:00:00.000Z");
    expect(envelope.dateRaw).toBe("Mon, 14 Sep 2026 10:00:00 +0100");
  });

  it("is kept as written, with no date, where it is not one", async () => {
    const envelope = await parseEnvelope(eml("sometime last week"));
    expect(envelope.date).toBeNull();
    expect(envelope.dateRaw).toBe("sometime last week");
    expect(envelope.textBody).toContain("__QA Wool");
    const { text } = buildEmailModelText(envelope);
    expect(text).toContain("Date: sometime last week (not a date this app could read)");
  });

  it("does not stop the worker preparing the read", async () => {
    const source = await prepareDocumentSource(eml("sometime last week"), "fabric.eml", "message/rfc822");
    expect(source.type).toBe("email");
    expect(source.type === "email" && source.text).toContain("__QA Wool");
  });
});

describe("an email the worker cannot parse at all", () => {
  it("fails the read with a sentence that says it was the email, not a bare parser error", async () => {
    vi.resetModules();
    vi.doMock("@/lib/email-envelope", () => ({
      parseEnvelope: async () => {
        throw new RangeError("Invalid time value");
      },
      buildEmailModelText: () => ({ text: "", truncated: false }),
    }));
    const { prepareDocumentSource: prepare } = await import("@/lib/intake-source");
    await expect(prepare(eml("x"), "fabric.eml", "message/rfc822")).rejects.toThrow(
      /This email could not be read.*Invalid time value/,
    );
    vi.doUnmock("@/lib/email-envelope");
  });
});
