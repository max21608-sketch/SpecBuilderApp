// The queue long document extractions run on.
//
// A model call at high effort runs for minutes. Run inline in the request that
// triggered it, it holds a connection open for the whole run, which the
// platform is free to cut -- and a cut connection leaves the row at
// 'processing' with a screen that never updates. So the HTTP route only
// enqueues; the work happens in the consumer, off the request.
//
// One topic, one consumer, a discriminated union of message kinds. Add a kind
// here and a branch in the consumer; do not add a second topic unless the work
// genuinely needs different retry or timeout settings, because each topic needs
// its own `experimentalTriggers` entry in vercel.json and has no consumer at
// all until that deploy lands.
import { send } from "@vercel/queue";

export const EXTRACTION_QUEUE_TOPIC = "document-extraction";

// `requestedBy` is the session email of whoever asked for the extraction. The
// consumer has no session of its own, and this is a real acting user rather
// than a system actor, so it is what lands in `updated_by`.
// `attemptId` is what makes a redelivery safe. Every worker write is fenced on
// it, so a message belonging to a superseded attempt writes zero rows instead
// of clobbering the attempt that replaced it.
//
// M1's BOQ import is a deterministic XLSX read and does not come through here
// at all.
export type ExtractionQueueMessage =
  | {
      kind: "document-intake";
      extractionId: string;
      attemptId: string;
      requestedBy: string;
    }
  // Fetching one message from the app mailbox: a short, cheap, retry-safe job,
  // not a model call. It shares this topic rather than taking a second one
  // because a new topic has NO CONSUMER until its vercel.json entry deploys,
  // and the retry settings that suit a five-minute extraction suit a
  // thirty-second fetch well enough. The paid read it may lead to goes through
  // the `document-intake` path like every other document.
  | {
      kind: "mail-ingest";
      mailbox: string;
      graphMessageId: string;
      source: "notification" | "delta" | "retry";
      requestedBy: string;
    };

/**
 * Stable per (run, attempt) -- NEVER Date.now(). A retried publish of the same
 * attempt must be recognised as the same message, or one press of Extract
 * becomes two paid pipelines.
 */
export function extractionIdempotencyKey(runId: string, attemptId: string): string {
  return `spec-document:${runId}:${attemptId}`;
}

/**
 * Stable per (mailbox, message). A notification and a delta poll naming the
 * same mail must be one job, not two — and even if both get through, the
 * unique index on `email_messages (mailbox, graph_message_id)` is the second
 * line.
 */
export function mailIngestIdempotencyKey(mailbox: string, graphMessageId: string): string {
  return `mail-ingest:${mailbox}:${graphMessageId}`;
}

export async function enqueueExtractionJob(
  message: ExtractionQueueMessage,
  idempotencyKey: string,
): Promise<void> {
  await send(EXTRACTION_QUEUE_TOPIC, message, {
    idempotencyKey,
    retentionSeconds: 7 * 24 * 60 * 60,
  });
}
