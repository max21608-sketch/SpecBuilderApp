// The LOCAL STACK's stand-in for Vercel Queues, and nothing else.
//
// ============================================================================
// WHY THIS EXISTS
//
// `send()` from @vercel/queue talks to the real Vercel queue service even under
// `next dev` — it needs an OIDC token from `vercel env pull`, sends the message
// to Vercel, and only then calls the local handler. On the local stack
// (docs/environments.md) there is no Vercel project to talk to, and sending to
// the real one would be a write to a company system. So when — and only when —
// the local stack asks for it, a document read is run IN THIS PROCESS, after
// the caller's commit, by the same function the consumer route runs.
//
// WHAT IT BYPASSES: the queue transport and its signed callback
// (handleCallback), the visibility timeout, and the platform's redelivery
// schedule. WHAT STILL RUNS, unchanged: openAttempt / publishAttempt around it,
// and inside `runDocumentExtraction` the whole claim protocol — the
// (run, attempt, claim token) fence on every write, the claim expiry, the
// per-attempt claim cap, the busy outcome, and the three-reads-per-pack slot
// hand-off. Delivery is mimicked just enough for the route's own rules to
// hold: idempotent per key within the process, a thrown or busy outcome is
// redelivered, and after MAX_DELIVERIES the terminal failure is recorded the
// way the route records it.
//
// THE GUARD: LOCAL_QUEUE=inline alone does nothing. It must come with
// LOCAL_STACK=1, APP_ENV=development and a DATABASE_URL on localhost — the
// same three the rest of the local stack checks (tools/localstack/guard.mjs).
// LOCAL_QUEUE=inline anywhere else THROWS rather than falling through to the
// real queue, so a mis-set deployment fails its publish loudly (an ambiguous
// dispatch error, retryable) instead of reading nothing or reading twice.
// `npm run dev:local` sets LOCAL_QUEUE=inline; the env file does not, so the
// database tier (whose tests stub the publisher) never sees it.
// ============================================================================
import type { ExtractionQueueMessage } from "@/lib/extraction-queue";
import { MAX_DELIVERIES } from "@/lib/extraction-claim";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True when the local stack has asked for in-process reads. Throws if asked for anywhere else. */
export function localQueueRequested(): boolean {
  if (process.env.LOCAL_QUEUE !== "inline") return false;
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    host = "";
  }
  if (process.env.LOCAL_STACK !== "1" || process.env.APP_ENV !== "development" || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      "LOCAL_QUEUE=inline is for the local stack only (LOCAL_STACK=1, APP_ENV=development, a localhost DATABASE_URL). Refusing to publish.",
    );
  }
  return true;
}

const seen = new Set<string>();
const REDELIVERY_DELAY_MS = [2_000, 5_000, 10_000];

/** Accept the message, then run it after the caller returns — the caller has already committed. */
export function runLocally(message: ExtractionQueueMessage, idempotencyKey: string): void {
  if (message.kind !== "document-intake") {
    throw new Error("The local stack runs document reads only; mail ingestion is disabled here.");
  }
  if (seen.has(idempotencyKey)) return; // a retried publish of the same attempt is one message
  seen.add(idempotencyKey);
  setTimeout(() => void deliver(message, 1).catch((e) => console.error("[local-queue] delivery crashed", e)), 0);
}

async function deliver(message: Extract<ExtractionQueueMessage, { kind: "document-intake" }>, deliveryCount: number) {
  const { runDocumentExtraction, recordExtractionFailure } = await import("@/lib/extraction-run");
  try {
    const outcome = await runDocumentExtraction({
      extractionId: message.extractionId,
      attemptId: message.attemptId,
      actor: message.requestedBy,
    });
    if (outcome.outcome === "busy") throw new Error(`busy: ${outcome.reason}`);
    console.log(`[local-queue] read ${message.extractionId} settled: ${outcome.outcome} (delivery ${deliveryCount})`);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    if (deliveryCount < MAX_DELIVERIES) {
      const delay = REDELIVERY_DELAY_MS[Math.min(deliveryCount - 1, REDELIVERY_DELAY_MS.length - 1)];
      console.warn(`[local-queue] read ${message.extractionId} delivery ${deliveryCount} threw (${error}); redelivering in ${delay}ms`);
      setTimeout(
        () => void deliver(message, deliveryCount + 1).catch((e) => console.error("[local-queue] delivery crashed", e)),
        delay,
      );
      return;
    }
    console.error(`[local-queue] read ${message.extractionId} gave up after ${deliveryCount} deliveries: ${error}`);
    await recordExtractionFailure(
      message.extractionId,
      message.attemptId,
      `${error} (gave up after ${deliveryCount} attempts)`,
      message.requestedBy,
    ).catch((e) => console.error("[local-queue] could not record the failure", e));
  }
}
