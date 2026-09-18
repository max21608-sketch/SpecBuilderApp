"use client";

// The email a review is about: who sent it, when, and a link that opens it.
//
// NOTHING HERE RENDERS THE MESSAGE. An .eml body is untrusted HTML a stranger
// wrote, so "Open in Outlook" is a download and this panel shows only the
// envelope the server parsed. That is the same rule the change-set evidence
// link follows, and the reason both routes set `content-disposition:
// attachment` and `nosniff`.
//
// Attachments are LISTED, never registered automatically. A file's kind is
// declared by a person (a BOQ and an FF&E schedule are both .xlsx), and reading
// one costs money — so an attachment here is information, not an action.
import Link from "next/link";

export type EmailMessage = {
  id: string;
  from_addr: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  to_addrs: { name: string | null; address: string }[] | null;
  cc_addrs: { name: string | null; address: string }[] | null;
  attachments_meta: { filename: string | null; contentType: string; size: number; isRfc822: boolean }[] | null;
  has_attachments: boolean;
  routing_reason: string | null;
  chase_match: string | null;
  chase_subject: string | null;
  chase_sent_at: string | null;
  chase_recipient_name: string | null;
  chase_question_count: string | number | null;
  triage: string;
  /** Plain text only. The HTML body is never sent to a screen — see the route. */
  body_text?: string | null;
  version: number;
};

function people(list: { name: string | null; address: string }[] | null): string {
  if (!list || list.length === 0) return "—";
  return list.map((p) => (p.name ? `${p.name} <${p.address}>` : p.address)).join(", ");
}

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function EmailHeader({ message }: { message: EmailMessage }) {
  const from = message.from_name
    ? `${message.from_name} <${message.from_addr ?? "unknown"}>`
    : (message.from_addr ?? "unknown sender");
  const received = message.received_at
    ? new Date(message.received_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "an unknown time";
  const attachments = message.attachments_meta ?? [];
  const chaseCount = Number(message.chase_question_count ?? 0);

  return (
    <section className="mt-4 border border-neutral-200 rounded-lg bg-white">
      <div className="px-4 py-3 border-b border-neutral-100">
        <p className="text-sm font-medium text-neutral-900">{message.subject ?? "(no subject)"}</p>
        <p className="mt-0.5 text-sm text-neutral-700">
          From <span className="font-medium">{from}</span> · {received}
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">To: {people(message.to_addrs)}</p>
        {message.cc_addrs && message.cc_addrs.length > 0 && (
          <p className="text-xs text-neutral-500">Cc: {people(message.cc_addrs)}</p>
        )}
      </div>

      {message.routing_reason && (
        <p className="px-4 py-2 text-xs text-neutral-600 border-b border-neutral-100">
          On this project because {message.routing_reason}
        </p>
      )}

      {/* A confident match narrows an ambiguous question to the one this email
          was asked. Stated on screen so a reviewer can see WHY a proposal chose
          the question it did, and retarget it if the reading is wrong. */}
      {message.chase_match === "confident" && message.chase_sent_at && (
        <p className="px-4 py-2 text-xs text-blue-800 bg-blue-50 border-b border-blue-100">
          Reads as a reply to the chase sent{" "}
          {new Date(message.chase_sent_at).toLocaleDateString("en-GB")} to{" "}
          {message.chase_recipient_name ?? "the designer"}
          {chaseCount > 0 && ` — ${chaseCount} question${chaseCount === 1 ? "" : "s"}`}. Where a value could answer
          more than one question, the one that email asked is preferred.
        </p>
      )}
      {(message.chase_match === "sender_only" || message.chase_match === "subject_only") && (
        <p className="px-4 py-2 text-xs text-neutral-600 bg-neutral-50 border-b border-neutral-100">
          {message.chase_match === "sender_only"
            ? "From somebody we have chased, but the subject does not match that email."
            : "The subject matches a chase we sent, but this is not from the person we asked."}
        </p>
      )}

      <div className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`/api/email-messages/${message.id}/mime`}
          className="px-2 py-1 rounded text-xs border border-neutral-300 hover:bg-neutral-100 text-neutral-700"
        >
          Open in Outlook (.eml)
        </Link>
        <span className="text-xs text-neutral-500">
          Downloads the original message. Nothing here renders it.
        </span>
      </div>

      {attachments.length > 0 && (
        <div className="px-4 py-2 border-t border-neutral-100">
          <p className="text-xs text-neutral-500">
            {attachments.length} attachment{attachments.length === 1 ? "" : "s"}, not read. A document&rsquo;s kind is
            declared by a person, and reading one is a charged call — upload it as its own intake document.
          </p>
          <ul className="mt-1 text-xs text-neutral-700 space-y-0.5">
            {attachments.map((attachment, index) => (
              <li key={index}>
                {attachment.filename ?? "(unnamed)"} · {bytes(attachment.size)}
                {attachment.isRfc822 && <span className="ml-1 text-neutral-500">(a forwarded message)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
