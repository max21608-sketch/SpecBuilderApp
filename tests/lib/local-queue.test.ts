// The local stack's queue behaves as the real one does where a read is
// verified (audit 5.4 A12).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ClaimBusyError, redeliveryDelaySeconds } from "@/lib/extraction-claim";
import { DEDUP_WINDOW_MS, acceptKey, localRedeliveryDelayMs } from "@/lib/local-queue";

describe("the local queue", () => {
  it("waits out a busy claim as the route does, not 2, 5 and 10 seconds", () => {
    // 2/5/10 s all land inside a 900 s claim, so locally a busy redelivery met
    // the same live claim three times and recorded a terminal failure the real
    // queue never would.
    const busy = new ClaimBusyError("claimed", 600);
    expect(localRedeliveryDelayMs(busy, 1)).toBe(redeliveryDelaySeconds(busy, 1) * 1000);
    expect(localRedeliveryDelayMs(busy, 1)).toBeGreaterThan(600_000);
    const other = new Error("blob 503");
    expect(localRedeliveryDelayMs(other, 2)).toBe(redeliveryDelaySeconds(other, 2) * 1000);
  });

  it("throws the route's busy error, so the delay reads the claim", () => {
    const source = readFileSync("src/lib/local-queue.ts", "utf8");
    expect(source).toContain("new ClaimBusyError(");
    expect(source).not.toMatch(/REDELIVERY_DELAY_MS/);
  });

  it("drops a replayed key inside the queue's dedup window and takes it after", () => {
    // @vercel/queue: "Dedup window: min(retention, 24h)"; this app's retention is 7 days.
    expect(DEDUP_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    const seen = new Map<string, number>();
    expect(acceptKey(seen, "run:attempt", 0)).toBe(true);
    expect(acceptKey(seen, "run:attempt", DEDUP_WINDOW_MS - 1)).toBe(false);
    expect(acceptKey(seen, "run:attempt", DEDUP_WINDOW_MS + 1)).toBe(true);
    expect(acceptKey(seen, "run:other", 5)).toBe(true);
  });
});
