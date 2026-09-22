// The sweeper's deployment contract, and the sentence it leaves behind.
//
// The sweep's behaviour is held in the database tier, where it can be driven
// against real rows. What is here is the half no unit test of the function
// would notice: a cron whose path does not resolve to a route is a job that
// silently never runs, and nothing about it would fail — the attempts would
// simply go on not being settled, which is the state this whole item exists to
// end.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { ATTEMPT_DEADLINE_HOURS } from "@/lib/extraction-claim";
import { EXPIRED_ATTEMPT_ERROR, SWEEP_LIMIT } from "@/lib/extraction-sweep";

const CRON_PATH = "/api/cron/sweep-reads";

describe("the expired-attempt sweep", () => {
  it("is deployed as a cron whose path is a route that exists", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: { path: string; schedule: string }[];
    };
    const cron = config.crons?.find((entry) => entry.path === CRON_PATH);
    expect(cron).toBeTruthy();
    // Hourly. What it settles is already a day old, so a quarter-hourly sweep
    // of the whole database would buy nothing.
    expect(cron?.schedule).toMatch(/^\d+ \* \* \* \*$/);
    expect(existsSync(`src/app${CRON_PATH}/route.ts`)).toBe(true);
  });

  it("says what happened and what the way out costs", () => {
    // The row a reviewer meets. It has to carry both halves: nothing is coming
    // for this document, and pressing Read is a new charged call rather than a
    // free resumption of the one that died.
    expect(EXPIRED_ATTEMPT_ERROR).toContain(String(ATTEMPT_DEADLINE_HOURS));
    expect(EXPIRED_ATTEMPT_ERROR).toContain("charged");
  });

  it("is bounded, so an incident cannot become one long-running function", () => {
    expect(SWEEP_LIMIT).toBeGreaterThan(0);
    expect(SWEEP_LIMIT).toBeLessThanOrEqual(100);
  });
});
