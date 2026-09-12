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
export type ExtractionQueueMessage = {
  // M2: one variant per extraction the app runs, e.g.
  //   | { kind: "ffe-schedule"; extractionId: string; requestedBy: string }
  // M1's BOQ import is a deterministic XLSX read and does not come through
  // here at all.
  kind: "document-intake";
  extractionId: string;
  requestedBy: string;
};

export async function enqueueExtractionJob(
  message: ExtractionQueueMessage,
  idempotencyKey: string,
): Promise<void> {
  await send(EXTRACTION_QUEUE_TOPIC, message, {
    idempotencyKey,
    retentionSeconds: 7 * 24 * 60 * 60,
  });
}
