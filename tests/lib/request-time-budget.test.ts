// The transcription route's model deadline is counted from the REQUEST
// (review 2026-11-16, item 1.7).
//
// The 740 s deadline started when the model call did, after the PDF had been
// read and its text extracted, and no abort was passed. A slow start ran past
// `maxDuration` (800 s), the platform killed the function with no failure
// written, and the claim it left blocked a retry. The budget is now taken off
// the request's own clock, so the contract holds against the platform's.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_DURATION_SECONDS, MODEL_DEADLINE_MS, RUN_ABORT_MS, requestTimeBudget } from "@/lib/extraction-claim";

describe("requestTimeBudget", () => {
  it("gives the whole budget to a request that has spent nothing", () => {
    expect(requestTimeBudget(1_000, 1_000)).toEqual({ modelDeadlineMs: MODEL_DEADLINE_MS, abortMs: RUN_ABORT_MS });
  });

  it("takes the time already spent off both the model's deadline and the abort", () => {
    expect(requestTimeBudget(0, 90_000)).toEqual({
      modelDeadlineMs: MODEL_DEADLINE_MS - 90_000,
      abortMs: RUN_ABORT_MS - 90_000,
    });
  });

  it("keeps model < abort < maxDuration on the request's clock, however slow the start", () => {
    for (const spent of [0, 1, 30_000, 300_000, 600_000, MODEL_DEADLINE_MS - 1]) {
      const budget = requestTimeBudget(0, spent);
      expect(budget).not.toBeNull();
      expect(spent + budget!.modelDeadlineMs).toBe(MODEL_DEADLINE_MS);
      expect(spent + budget!.modelDeadlineMs).toBeLessThan(spent + budget!.abortMs);
      expect(spent + budget!.abortMs).toBeLessThan(MAX_DURATION_SECONDS * 1000);
    }
  });

  it("leaves no model time once the deadline has passed on the request's clock", () => {
    expect(requestTimeBudget(0, MODEL_DEADLINE_MS)).toBeNull();
    expect(requestTimeBudget(0, MODEL_DEADLINE_MS + 5_000)).toBeNull();
  });
});

describe("the transcription route", () => {
  const route = readFileSync(join(process.cwd(), "src/app/api/imports/[id]/transcribe/route.ts"), "utf8");

  it("passes the request's budget to the model call: a deadline and an abort signal", () => {
    expect(route).toMatch(/const startedAt = Date\.now\(\);/);
    expect(route).toMatch(/requestTimeBudget\(startedAt, Date\.now\(\)\)/);
    expect(route).toMatch(/deadlineMs: budget\.modelDeadlineMs/);
    expect(route).toMatch(/signal: AbortSignal\.timeout\(budget\.abortMs\)/);
  });
});
