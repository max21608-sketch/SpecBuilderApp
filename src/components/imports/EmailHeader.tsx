"use client";

// The envelope of the email a review is about: who else it went to, what it
// reads as a reply to, and what came attached.
//
// ============================================================================
// THE SENDER, THE DATE AND THE PROJECT ARE NOT HERE ANY MORE.
//
// They are the screen's IDENTITY — who wrote this, when, and which project it
// landed on — so they belong in `PageHeader`'s subtitle beside the subject,
// which is the one h1. This panel used to repeat all of it in a box below the
// title, so the same four facts were on screen twice and the thing a reviewer
// actually came for — the specifications — started a screen further down.
//
// What is left is the part that is genuinely secondary: the other recipients,
// the chase this reads as a reply to, and the attachments. It lives on the
// message tab, beside the text it belongs to.
//
// NOTHING HERE RENDERS THE MESSAGE BODY AS MARKUP. An .eml body is untrusted
// HTML a stranger wrote, so the .eml link is a download and the body is shown
// as plain text. That is the same rule the change-set evidence link follows,
// and the reason both routes set `content-disposition: attachment` and
// `nosniff`.
//
// Attachments are LISTED, never registered automatically. A file's kind is
// declared by a person (a BOQ and an FF&E schedule are both .xlsx), and reading
// one costs money — so an attachment here is never read.
//
// WHAT IT NOW OFFERS, AND WHAT IT STILL WILL NOT DO (Stage 2 variance row 4).
// Specification arrives as an attachment constantly: the email says "sizes
// attached" and the sizes are in a PDF. Listing it was the whole of it, so
// reaching the bytes meant downloading the .eml, opening it in a mail client,
// saving the file out and uploading it — four steps, three of them outside this
// app. Each attachment now has a DOWNLOAD, which registers nothing and spends
// nothing.
//
// It is deliberately not a one-click "register this as its own document". The
// bytes live inside the .eml and nothing in the store addresses them, so that
// button would have to write a new blob AND start a charged read behind one
// press — two of this app's hard gates, one of which is the inbound-email gate
// itself. The words say what the next step costs and the pack upload is where
// a person takes it.
// ============================================================================
import Card from "@/components/ui/Card";
import Note from "@/components/ui/Note";
import { buttonClass } from "@/components/ui/Button";

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

export default function EmailEnvelope({ message, runId }: { message: EmailMessage; runId?: string }) {
  const attachments = message.attachments_meta ?? [];
  const chaseCount = Number(message.chase_question_count ?? 0);

  return (
    <Card title="The envelope">
      <p className="text-neutral-600">To: {people(message.to_addrs)}</p>
      {message.cc_addrs && message.cc_addrs.length > 0 && (
        <p className="text-neutral-600">Cc: {people(message.cc_addrs)}</p>
      )}

      {/* A confident match narrows an ambiguous question to the one this email
          was asked. Stated on screen so a reviewer can see WHY a proposal chose
          the question it did, and retarget it if the reading is wrong. */}
      {message.chase_match === "confident" && message.chase_sent_at && (
        <Note tone="info">
          Reads as a reply to the chase sent {new Date(message.chase_sent_at).toLocaleDateString("en-GB")} to{" "}
          {message.chase_recipient_name ?? "the designer"}
          {chaseCount > 0 && ` — ${chaseCount} question${chaseCount === 1 ? "" : "s"}`}. Where a value could answer
          more than one question, the one that email asked is preferred.
        </Note>
      )}
      {(message.chase_match === "sender_only" || message.chase_match === "subject_only") && (
        <Note tone="plain">
          {message.chase_match === "sender_only"
            ? "From somebody we have chased, but the subject does not match that email."
            : "The subject matches a chase we sent, but this is not from the person we asked."}
        </Note>
      )}

      {attachments.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="text-xs text-neutral-500">
            {attachments.length} attachment{attachments.length === 1 ? "" : "s"}, not read. A document&rsquo;s kind is
            declared by a person, and reading one is a charged call — download it and upload it as its own intake
            document to have it read.
          </p>
          <ul className="mt-1 space-y-1 text-xs text-neutral-700">
            {attachments.map((attachment, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <span>
                  {attachment.filename ?? "(unnamed)"} · {bytes(attachment.size)}
                  {attachment.isRfc822 && <span className="ml-1 text-neutral-500">(a forwarded message)</span>}
                </span>
                {/* An `<a href>`, because the browser does the fetching — the
                    case `buttonClass` exists for. It looks like the action it
                    is rather than like the links to a record beside it. The
                    route registers nothing: `download` is a read. */}
                {runId && (
                  <a
                    className={buttonClass("quiet", "xs")}
                    href={`/api/imports/${runId}/attachments/${index}`}
                    // The route already sets content-disposition: attachment,
                    // so this is belt and braces rather than the mechanism.
                    download={attachment.filename ?? undefined}
                  >
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
