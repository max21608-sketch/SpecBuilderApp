// The timing inequalities are a CONTRACT, not tuning. Each of these encodes a
// specific failure that happens when the ordering is broken, and the failures
// are expensive: two workers billing one attempt, a run killed mid-write, a
// redelivery that can never do anything.
//
// If you change one of these numbers, this test tells you which of the others
// you just broke.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BUSY_REDELIVERY_MARGIN_SECONDS,
  ClaimBusyError,
  CLAIM_EXPIRY_SECONDS,
  MAX_REDELIVERY_DELAY_SECONDS,
  redeliveryDelaySeconds,
  MAX_CLAIMS_PER_ATTEMPT,
  MAX_DELIVERIES,
  MAX_DURATION_SECONDS,
  MAX_IN_FLIGHT_READS_PER_PACK,
  MODEL_DEADLINE_MS,
  RUN_ABORT_MS,
  VISIBILITY_TIMEOUT_SECONDS,
} from "@/lib/extraction-claim";
import { MAX_WINDOWS, MEASURED_READ, ROWS_PER_WINDOW, WINDOWS_IN_FLIGHT } from "@/lib/spreadsheet-windows";
import { MAX_TOKENS } from "@/lib/anthropic";
import { TRANSCRIPTION_CLAIM_MS } from "@/lib/pdf-bill-checks";
import { CLASSIFY_DEADLINE_MS, LARGE_CLASSIFY_DEADLINE_MS } from "@/lib/document-classify";
import { STRUCTURE_DEADLINE_MS } from "@/lib/boq-structure";

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

  it("lets a pack make progress at all", () => {
    // A cap of zero registers documents nothing will ever read, and the pack
    // screen would show eleven documents waiting for a slot that cannot free.
    expect(MAX_IN_FLIGHT_READS_PER_PACK).toBeGreaterThanOrEqual(1);
  });

  it("bounds how long a pack of thirty can take to work through", () => {
    // The cap trades concurrency for a rate somebody can survive, and the
    // trade has a worst case: ceil(N / cap) waves, each bounded by the
    // function's own limit. Stated here so lowering the cap to 1 fails a test
    // rather than quietly making a pack of thirty an overnight job.
    //
    // Widened 2026-09-23 with the move to Opus and an 800s function: Max said
    // read time does not matter against accuracy, and a read runs in the
    // background. The bound still has to be one a cap of 1 FAILS (thirty
    // documents × 800s is 6h40m), because that is the mistake it exists for.
    const waves = (n: number) => Math.ceil(n / MAX_IN_FLIGHT_READS_PER_PACK);
    expect(waves(11) * MAX_DURATION_SECONDS).toBeLessThanOrEqual(60 * 60);
    expect(waves(30) * MAX_DURATION_SECONDS).toBeLessThanOrEqual(3 * 60 * 60);
    expect(30 * MAX_DURATION_SECONDS).toBeGreaterThan(3 * 60 * 60);
  });

  it("fits a spreadsheet's row windows inside one invocation, by the measured rate", () => {
    // One attempt holds all of a document's windows, and one attempt is one
    // invocation. Measured 2026-09-23: 101 rows, 65,057 output tokens, 498s.
    // So a window must stay well under the output ceiling, and the waves of
    // windows must fit the model deadline — with room for a denser bill.
    const msPerRow = MEASURED_READ.elapsedMs / MEASURED_READ.rows;
    const tokensPerRow = MEASURED_READ.outputTokens / MEASURED_READ.rows;
    expect(ROWS_PER_WINDOW * tokensPerRow).toBeLessThan(MAX_TOKENS / 2);
    const waves = Math.ceil(MAX_WINDOWS / WINDOWS_IN_FLIGHT);
    expect(waves * ROWS_PER_WINDOW * msPerRow).toBeLessThan(MODEL_DEADLINE_MS * 0.9);
    // And the limit is what the plan needs: a 300-line bill in one read.
    expect(MAX_WINDOWS * ROWS_PER_WINDOW).toBeGreaterThanOrEqual(300);
    // Sequential windows would not have fitted, which is why they run in waves.
    expect(MAX_WINDOWS * ROWS_PER_WINDOW * msPerRow).toBeGreaterThan(RUN_ABORT_MS);
  });

  it("bounds what one press of Extract can cost", () => {
    expect(MAX_CLAIMS_PER_ATTEMPT).toBe(MAX_DELIVERIES);
    expect(MAX_CLAIMS_PER_ATTEMPT).toBeLessThanOrEqual(4);
  });

  // maxDuration cannot be imported into a route segment config -- Next reads
  // that statically and rejects an identifier, failing the deployment after the
  // compile step has already said "Compiled successfully". So the literal in the
  // route is checked against the constant here instead.
  it("the queue route's literal maxDuration equals the constant", () => {
    const route = readFileSync("src/app/api/queues/[topic]/route.ts", "utf8");
    const match = /export const maxDuration = (\d+);/.exec(route);
    expect(match?.[1]).toBe(String(MAX_DURATION_SECONDS));
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

  // ---- a busy redelivery (audit D8) ----------------------------------------

  it("redelivers a BUSY message only after the claim it met has expired", () => {
    // The ordinary backoff (30, 60, 120 s) lands inside a 900 s claim every
    // time, so a delivery that met a live claim was busy again, three times,
    // and the recovery `busy` promises never ran. Asserting visibility > claim
    // was beside the point: a thrown busy comes back when the retry handler
    // says, not when visibility lapses.
    for (let delivery = 1; delivery < MAX_DELIVERIES; delivery += 1) {
      // A claim taken a moment ago: its whole life is still ahead of it.
      const wait = redeliveryDelaySeconds(new ClaimBusyError("live", CLAIM_EXPIRY_SECONDS), delivery);
      expect(wait).toBeGreaterThan(CLAIM_EXPIRY_SECONDS);
      expect(wait).toBeLessThanOrEqual(MAX_REDELIVERY_DELAY_SECONDS);
      // And a claim nearly out is waited for as long as it has left, plus the margin.
      expect(redeliveryDelaySeconds(new ClaimBusyError("live", 200), delivery)).toBeGreaterThanOrEqual(200 + BUSY_REDELIVERY_MARGIN_SECONDS);
    }
    // Everything else keeps the short backoff: a blob 5xx clears quickly, and
    // its claim was released before the throw.
    expect([1, 2, 3].map((delivery) => redeliveryDelaySeconds(new Error("blob 503"), delivery))).toEqual([30, 60, 120]);
  });

  it("the queue route's retry handler is that function", () => {
    const route = readFileSync("src/app/api/queues/[topic]/route.ts", "utf8");
    expect(route).toMatch(/retry: \(error, metadata\) => \(\{ afterSeconds: redeliveryDelaySeconds\(error, metadata\.deliveryCount\) \}\)/);
    expect(route).toMatch(/throw new ClaimBusyError\(/);
  });

  // ---- every route that declares a maxDuration (audit C15) -----------------
  //
  // The inequality is model deadline < run abort < maxDuration < claim, and
  // it was asserted for the queue route only. The transcription route kept a
  // claim EQUAL to its maxDuration (800 s), so a request the platform had
  // just killed still looked like one in flight, and a second press could
  // overlap a first that was still writing. Every route declaring a
  // maxDuration is listed here with the timings it runs under; a new one
  // fails until somebody says which apply to it.

  type RouteTiming = {
    maxDurationSeconds: number;
    /** The longest model call the route makes, if it makes one. */
    modelDeadlineMs?: number;
    /** A run-level abort between the model deadline and the platform's. */
    abortMs?: number;
    /** How long a press is held as "in flight" against a second one. */
    claimMs?: number;
  };

  const suggestColumnsClaim = (() => {
    const route = readFileSync("src/app/api/imports/[id]/suggest-columns/route.ts", "utf8");
    const match = /const CLAIM_EXPIRES_MS = STRUCTURE_DEADLINE_MS \+ ([\d_]+);/.exec(route);
    return match ? STRUCTURE_DEADLINE_MS + Number(match[1]!.replace(/_/g, "")) : NaN;
  })();

  const NO_MODEL = { maxDurationSeconds: 60 };
  const ROUTES: Record<string, RouteTiming> = {
    "src/app/api/queues/[topic]/route.ts": {
      maxDurationSeconds: MAX_DURATION_SECONDS,
      modelDeadlineMs: MODEL_DEADLINE_MS,
      abortMs: RUN_ABORT_MS,
      claimMs: CLAIM_EXPIRY_SECONDS * 1000,
    },
    "src/app/api/imports/[id]/transcribe/route.ts": {
      maxDurationSeconds: 800,
      modelDeadlineMs: MODEL_DEADLINE_MS,
      claimMs: TRANSCRIPTION_CLAIM_MS,
    },
    "src/app/api/imports/[id]/suggest-columns/route.ts": {
      maxDurationSeconds: 300,
      modelDeadlineMs: STRUCTURE_DEADLINE_MS,
      claimMs: suggestColumnsClaim,
    },
    "src/app/api/imports/classify/route.ts": {
      maxDurationSeconds: 300,
      modelDeadlineMs: Math.max(CLASSIFY_DEADLINE_MS, LARGE_CLASSIFY_DEADLINE_MS),
    },
    // No model call: the limit is the platform's and nothing waits on a claim.
    "src/app/api/imports/route.ts": NO_MODEL,
    "src/app/api/imports/[id]/confirm/route.ts": NO_MODEL,
    "src/app/api/imports/[id]/columns/route.ts": NO_MODEL,
    "src/app/api/imports/[id]/read-specifications/route.ts": NO_MODEL,
    "src/app/api/imports/[id]/read-furniture/route.ts": NO_MODEL,
    "src/app/api/drafts/generate/route.ts": NO_MODEL,
    "src/app/api/drafts/[id]/edit/route.ts": NO_MODEL,
    "src/app/api/projects/[id]/export/route.ts": NO_MODEL,
    "src/app/api/projects/[id]/export/check-sheet/route.ts": NO_MODEL,
    "src/app/api/projects/[id]/export/costing/route.ts": NO_MODEL,
    "src/app/api/projects/[id]/export/quote/route.ts": NO_MODEL,
    "src/app/api/cron/sweep-reads/route.ts": NO_MODEL,
    "src/app/api/cron/graph-renew/route.ts": NO_MODEL,
    "src/app/api/cron/graph-delta/route.ts": NO_MODEL,
    "src/app/api/graph/notifications/route.ts": { maxDurationSeconds: 10 },
  };

  function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return routeFiles(path);
      return name === "route.ts" ? [path] : [];
    });
  }

  const declared = new Map(
    routeFiles("src/app")
      .map((file) => [file, /export const maxDuration = (\d+);/.exec(readFileSync(file, "utf8"))?.[1]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .map(([file, value]) => [file, Number(value)]),
  );

  it("knows every route that declares a maxDuration, at the value it declares", () => {
    expect([...declared.keys()].sort()).toEqual(Object.keys(ROUTES).sort());
    for (const [file, value] of declared) expect(value, file).toBe(ROUTES[file]!.maxDurationSeconds);
  });

  it("orders model deadline < abort < maxDuration < claim on every route that has them", () => {
    for (const [file, timing] of Object.entries(ROUTES)) {
      const chain = [timing.modelDeadlineMs, timing.abortMs, timing.maxDurationSeconds * 1000, timing.claimMs].filter(
        (value): value is number => value !== undefined,
      );
      for (let i = 1; i < chain.length; i += 1) {
        expect(chain[i - 1]!, `${file}: step ${i} of ${chain.join(" < ")}`).toBeLessThan(chain[i]!);
      }
    }
  });

  it("gives a transcription claim the extraction claim's margin over its maxDuration", () => {
    const route = ROUTES["src/app/api/imports/[id]/transcribe/route.ts"]!;
    expect(TRANSCRIPTION_CLAIM_MS - route.maxDurationSeconds * 1000).toBeGreaterThanOrEqual(
      (CLAIM_EXPIRY_SECONDS - MAX_DURATION_SECONDS) * 1000,
    );
  });

  it("names no model-calling route as model-free", () => {
    // Only a call made in the route's own file is caught (the functions that
    // call a model, by name); it is the check that a route added to the
    // NO_MODEL rows above did not bring a model call with it.
    const modelCalls = /\b(extractSpecDocument|readSpecDocument|classifyDocument|readBillStructure|transcribePdfBill)\(/;
    for (const [file, timing] of Object.entries(ROUTES)) {
      if (timing.modelDeadlineMs !== undefined) continue;
      expect(modelCalls.test(readFileSync(file, "utf8")), file).toBe(false);
    }
  });
});
