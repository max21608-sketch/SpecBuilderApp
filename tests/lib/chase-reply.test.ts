// Does an email read as a reply to a chase we sent? Pure.
import { describe, expect, it } from "vitest";
import { matchReplyToChase, type SentDraft } from "@/lib/chase-reply";
import type { EmailEnvelope } from "@/lib/email-envelope";

const draft: SentDraft = {
  id: "d1",
  projectId: "p1",
  recipientEmail: "jane@designers.test",
  ccEmail: "p17726@benwhistler.test",
  subject: "P17726 Panther — outstanding specification information (4 needed to quote across 3 items)",
  sentAt: "2026-09-12T10:00:00.000Z",
  recipientName: "Jane Doe",
};

function envelope(overrides: Partial<EmailEnvelope> = {}): EmailEnvelope {
  return {
    messageId: "<r1@x.test>",
    inReplyTo: null,
    references: [],
    from: { name: "Jane Doe", address: "jane@designers.test" },
    replyTo: [],
    to: [],
    cc: [],
    subject: "RE: P17726 Panther — outstanding specification information (4 needed to quote across 3 items)",
    date: "2026-09-16T09:00:00.000Z",
    headers: [],
    textBody: "Seat height 440mm.",
    htmlBody: null,
    attachments: [],
    ...overrides,
  };
}

describe("matchReplyToChase", () => {
  it("is confident when the sender and the subject both agree", () => {
    const match = matchReplyToChase(envelope(), [draft]);
    expect(match?.kind).toBe("confident");
    expect(match?.draft.id).toBe("d1");
  });

  it("strips a thread's accumulated prefixes before comparing", () => {
    const match = matchReplyToChase(
      envelope({ subject: `RE: FW: RE: ${draft.subject}` }),
      [draft],
    );
    expect(match?.kind).toBe("confident");
  });

  it("matches a reply to a staging draft, whose subject carried a prefix", () => {
    const staged = { ...draft, subject: `[STAGING] ${draft.subject}` };
    const match = matchReplyToChase(envelope(), [staged]);
    expect(match?.kind).toBe("confident");
  });

  // A sender alone is somebody who writes often; a subject alone is a thread
  // somebody else was copied into. Both are hints, neither is a match.
  it("reports a sender-only match as a hint, not a match", () => {
    const match = matchReplyToChase(envelope({ subject: "Panther — new drawings" }), [draft]);
    expect(match?.kind).toBe("sender_only");
  });

  it("reports a subject-only match as a hint, not a match", () => {
    const match = matchReplyToChase(
      envelope({ from: { name: "Someone Else", address: "other@designers.test" } }),
      [draft],
    );
    expect(match?.kind).toBe("subject_only");
  });

  it("matches on the Cc address too, because the project inbox is the Cc", () => {
    const match = matchReplyToChase(
      envelope({ from: { name: null, address: "p17726@benwhistler.test" } }),
      [draft],
    );
    expect(match?.kind).toBe("confident");
  });

  it("prefers the most recent chase when the same person was asked twice", () => {
    const older = { ...draft, id: "d0", sentAt: "2026-08-01T10:00:00.000Z" };
    const match = matchReplyToChase(envelope(), [older, draft]);
    expect(match?.draft.id).toBe("d1");
  });

  it("returns nothing for an unrelated message", () => {
    expect(
      matchReplyToChase(
        envelope({ from: { name: null, address: "spam@x.test" }, subject: "Newsletter" }),
        [draft],
      ),
    ).toBeNull();
  });

  it("returns nothing when there are no sent chases at all", () => {
    expect(matchReplyToChase(envelope(), [])).toBeNull();
  });
});
