// The consumer for long document extractions.
//
// Deliberately NOT a session route: this is reached by the platform, not by a
// browser. It is excluded from the middleware matcher and authenticates itself
// through handleCallback's signed protocol. Adding it to the matcher breaks
// every background job with a 401 that looks like a platform outage.
//
// Four deliveries, not forty. A retry here is a fresh high-effort model run
// costing real money, and the faults worth retrying (a blob 5xx, a DB blip)
// either clear quickly or not at all. The run function decides what is
// retryable: it throws only for infrastructure faults, and a model refusal
// writes 'failed' and returns without throwing.
//
// A BUSY outcome THROWS. A duplicate delivery that finds a live claim is not a
// success: by the next delivery either the work is done (and that delivery
// skips cheaply) or the claim has expired and that delivery is the recovery.
// Acking it here would spend the delivery recovery depends on.
//
// NOTE: this route has no consumer until a deploy lands that declares its topic
// in vercel.json under `experimentalTriggers`. Messages sent before then sit in
// the topic undelivered.
import { handleCallback, type MessageMetadata } from "@vercel/queue";
import { type ExtractionQueueMessage } from "@/lib/extraction-queue";
import { runDocumentExtraction, recordExtractionFailure } from "@/lib/extraction-run";
import { MAX_DELIVERIES, VISIBILITY_TIMEOUT_SECONDS } from "@/lib/extraction-claim";

export const runtime = "nodejs";
// A LITERAL, not MAX_DURATION_SECONDS. Next reads route segment config
// statically and refuses an imported identifier here:
//   "Unknown identifier MAX_DURATION_SECONDS at maxDuration"
// — which fails the whole deployment at "Collecting page data", AFTER the
// compile step reports success. Keep it equal to MAX_DURATION_SECONDS and to
// vercel.json; tests/lib/extraction-timing.test.ts asserts all three agree,
// because the number cannot be shared by import.
export const maxDuration = 300;

// The trigger schema is picky and rejecting it fails the whole deployment
// before any app code runs: `type` must be exactly `queue/v1beta` (the variant
// that takes a `consumer`), and the cap is `maxDeliveries` -- an earlier
// chassis wrote `maxAttempts`, which is not a key at all. MAX_DELIVERIES here
// must equal the value in vercel.json; if the two disagree, either a job is
// abandoned with the screen still polling, or a paid model call is retried more
// times than intended.
const queueHandler = handleCallback<ExtractionQueueMessage>(
  async (message, metadata) => {
    try {
      if (message.kind !== "document-intake") throw new Error("Unknown extraction queue message");

      const outcome = await runDocumentExtraction({
        extractionId: message.extractionId,
        attemptId: message.attemptId,
        actor: message.requestedBy,
      });

      // Not an error worth a stack trace, but not a success either: throwing
      // is what makes the platform redeliver, which is the recovery path.
      if (outcome.outcome === "busy") throw new Error(`busy: ${outcome.reason}`);
    } catch (cause) {
      if (metadata.deliveryCount < MAX_DELIVERIES) throw cause;
      // Out of attempts. Write a terminal status so the screen stops waiting on
      // something that is never coming -- unless another invocation holds a
      // live claim, which recordExtractionFailure checks for itself.
      await recordTerminalFailure(message, cause, metadata);
    }
  },
  {
    // Longer than the function ceiling, so a run that uses its whole budget is
    // not redelivered underneath itself -- which would have two invocations
    // racing for the same claim.
    visibilityTimeoutSeconds: VISIBILITY_TIMEOUT_SECONDS,
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(300, 15 * 2 ** Math.min(metadata.deliveryCount, 4)),
    }),
  },
);

export async function POST(request: Request): Promise<Response> {
  return queueHandler(request);
}

async function recordTerminalFailure(
  message: ExtractionQueueMessage,
  cause: unknown,
  metadata: MessageMetadata,
): Promise<void> {
  const error = cause instanceof Error ? cause.message : String(cause);
  const detail = `${error} (gave up after ${metadata.deliveryCount} attempts)`;
  await recordExtractionFailure(message.extractionId, message.attemptId, detail, message.requestedBy);
}
