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
// NOTE: this route exists but has no consumer until a deploy lands that
// declares its topic in vercel.json under `experimentalTriggers`. Messages
// sent before then sit in the topic undelivered.
import { handleCallback, type MessageMetadata } from "@vercel/queue";
import { type ExtractionQueueMessage } from "@/lib/extraction-queue";
import { runDocumentExtraction, recordExtractionFailure } from "@/lib/extraction-run";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_DELIVERIES = 4;

const queueHandler = handleCallback<ExtractionQueueMessage>(
  async (message, metadata) => {
    try {
      if (message.kind === "document-intake") {
        await runDocumentExtraction({ extractionId: message.extractionId, actor: message.requestedBy });
      } else {
        throw new Error("Unknown extraction queue message");
      }
    } catch (cause) {
      if (metadata.deliveryCount < MAX_DELIVERIES) throw cause;
      // Out of attempts. Write a terminal status so the screen stops waiting
      // on something that is never coming.
      await recordTerminalFailure(message, cause, metadata);
    }
  },
  {
    // Longer than the 300s function ceiling, so a run that uses its whole
    // budget is not redelivered underneath itself — which would have two
    // invocations racing for the same claim.
    visibilityTimeoutSeconds: 600,
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
  await recordExtractionFailure(message.extractionId, detail, message.requestedBy);
}
