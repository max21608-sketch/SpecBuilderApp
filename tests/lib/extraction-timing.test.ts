// The timing inequalities are a CONTRACT, not tuning. Each of these encodes a
// specific failure that happens when the ordering is broken, and the failures
// are expensive: two workers billing one attempt, a run killed mid-write, a
// redelivery that can never do anything.
//
// If you change one of these numbers, this test tells you which of the others
// you just broke.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLAIM_EXPIRY_SECONDS,
  MAX_CLAIMS_PER_ATTEMPT,
  MAX_DELIVERIES,
  MAX_DURATION_SECONDS,
  MODEL_DEADLINE_MS,
  RUN_ABORT_MS,
  VISIBILITY_TIMEOUT_SECONDS,
} from "@/lib/extraction-claim";

describe("extraction timing contract", () => {
  it("gives the model less time than the run, and the run less than the platform", () => {
    // Otherwise a failure is never written down: the model is still waiting
    // when the run is cut, or the run is still writing when the function is.
    expect(MODEL_DEADLINE_MS).toBeLessThan(RUN_ABORT_MS);
    expect(RUN_ABORT_MS).toBeLessThan(MAX_DURATION_SECONDS * 1000);
  });

  it("leaves room to persist a failure after each deadline", () => {
    expect(RUN_ABORT_MS - MODEL_DEADLINE_MS).toBeGreaterThanOrEqual(15_000);
    expect(MAX_DURATION_SECONDS * 1000 - RUN_ABORT_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("cannot expire a claim while its own invocation is still legitimately running", () => {
    // If it could, a second worker claims the same attempt and both pay.
    expect(CLAIM_EXPIRY_SECONDS).toBeGreaterThan(MAX_DURATION_SECONDS);
  });

  it("does not redeliver before the claim it left behind can be taken", () => {
    // If it did, every redelivery would be a guaranteed busy no-op and the
    // recovery path would never fire.
    expect(VISIBILITY_TIMEOUT_SECONDS).toBeGreaterThan(CLAIM_EXPIRY_SECONDS);
  });

  it("bounds what one press of Extract can cost", () => {
    expect(MAX_CLAIMS_PER_ATTEMPT).toBe(MAX_DELIVERIES);
    expect(MAX_CLAIMS_PER_ATTEMPT).toBeLessThanOrEqual(4);
  });

  // The constants and vercel.json must agree. If they disagree, either a job is
  // abandoned with the screen still polling, or a paid model call is retried
  // more times than intended -- and nothing in either file would say so.
  it("agrees with the deployed trigger in vercel.json", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      functions: Record<string, { maxDuration: number; experimentalTriggers: Record<string, unknown>[] }>;
    };
    const fn = config.functions["src/app/api/queues/[topic]/route.ts"];
    expect(fn?.maxDuration).toBe(MAX_DURATION_SECONDS);

    const trigger = fn?.experimentalTriggers?.[0] as
      | { type: string; topic: string; consumer: string; maxDeliveries: number }
      | undefined;
    expect(trigger?.maxDeliveries).toBe(MAX_DELIVERIES);
    // The exact shape the kit fixed on 2026-09-13. `queue/v2beta` and
    // `maxAttempts` are both wrong, and a wrong trigger fails the whole
    // deployment before any app code runs.
    expect(trigger?.type).toBe("queue/v1beta");
    expect(trigger?.consumer).toBeTruthy();
    expect(trigger?.topic).toBe("document-extraction");
  });
});
