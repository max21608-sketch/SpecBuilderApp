// Does this email read as a reply to a chase we sent?
//
// ============================================================================
// WHY NOT `In-Reply-To`
//
// The obvious mechanism does not work here. This app never sends: it writes an
// .eml with `X-Unsent: 1` and a person sends it from their own Outlook, and
// OUTLOOK assigns the Message-ID at that moment. The id the reply quotes is
// therefore one the app has never seen and cannot store.
//
// So the match is made on what the app does know: who the draft was addressed
// to, and the subject it generated. Both must agree for `confident` — a sender
// alone is somebody who writes often, and a subject alone is a thread somebody
// else was copied into.
//
// What a confident match BUYS is narrow and worth stating: where the resolver
// cannot tell which of several questions an observation answers, and exactly
// one of them was asked in that email, the email is the tie-break. That is a
// deterministic register — our own sent coverage — not a fuzzy guess, and the
// card badges it so a reviewer can retarget.
// ============================================================================
import type { EmailEnvelope } from "@/lib/email-envelope";
import { stripReplyPrefixes } from "@/lib/email-envelope";

export type SentDraft = {
  id: string;
  projectId: string;
  recipientEmail: string | null;
  ccEmail: string | null;
  subject: string;
  sentAt: string | null;
  recipientName: string | null;
};

export type ChaseMatchKind = "confident" | "sender_only" | "subject_only";
export type ChaseMatch = { draft: SentDraft; kind: ChaseMatchKind } | null;

/** The part of a generated subject that survives a reply. */
const SUBJECT_STEM = " — outstanding specification information";

const fold = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export function matchReplyToChase(envelope: EmailEnvelope, drafts: SentDraft[]): ChaseMatch {
  const senders = new Set(
    [envelope.from, ...envelope.replyTo].filter(Boolean).map((person) => fold(person!.address)),
  );
  const subject = fold(stripReplyPrefixes(envelope.subject ?? ""));

  let senderOnly: SentDraft | null = null;
  let subjectOnly: SentDraft | null = null;

  // Newest first, so a repeated chase to the same person matches the one they
  // are most likely replying to.
  const ordered = [...drafts].sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? "")));

  for (const draft of ordered) {
    const addressed = [fold(draft.recipientEmail), fold(draft.ccEmail)].filter(Boolean);
    const bySender = addressed.some((address) => senders.has(address));

    // The environment prefix is stripped off the front of the stored subject
    // before comparing: a reply to a staging draft still reads as a reply.
    const stored = fold(stripReplyPrefixes(draft.subject.replace(/^\s*\[[^\]]+\]\s*/, "")));
    const stem = stored.split(SUBJECT_STEM)[0] ?? stored;
    const bySubject = Boolean(stem) && subject.startsWith(`${stem}${SUBJECT_STEM}`.trim().slice(0, stem.length + 4));

    if (bySender && bySubject) return { draft, kind: "confident" };
    if (bySender && !senderOnly) senderOnly = draft;
    if (bySubject && !subjectOnly) subjectOnly = draft;
  }

  if (senderOnly) return { draft: senderOnly, kind: "sender_only" };
  if (subjectOnly) return { draft: subjectOnly, kind: "subject_only" };
  return null;
}

/** One line for the review screen's header panel. */
export function describeChaseMatch(match: NonNullable<ChaseMatch>, questionCount: number): string {
  const when = match.draft.sentAt ? new Date(match.draft.sentAt).toLocaleDateString("en-GB") : "an unknown date";
  const who = match.draft.recipientName ?? match.draft.recipientEmail ?? "someone";
  if (match.kind === "confident") {
    return `Reads as a reply to the chase sent ${when} to ${who} — ${questionCount} question${questionCount === 1 ? "" : "s"}.`;
  }
  if (match.kind === "sender_only") {
    return `From the person we chased on ${when}, but the subject does not match that email.`;
  }
  return `The subject matches the chase sent ${when} to ${who}, but this is not from them.`;
}
