// Pure tier. When "Start again (may be charged again)" may be offered, and the
// claim window every screen reads.
//
// Audit D7 (2026-11-06): the route and four review screens each wrote
// `claim_count >= 4` as "exhausted", which is also true while the FOURTH
// delivery is legitimately reading. The red Restart showed over a paid read in
// flight; pressing it opened a new attempt, the live worker's write was fenced
// out, and its output was thrown away.
//
// Audit D9: the single-document GET computed `claim_live` with a literal
// `interval '360 seconds'` that nobody moved when the claim went to 900 s, so
// between minute 6 and minute 15 of a real read the screen offered a Restart
// the route then refused.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { attemptRestartable, MAX_CLAIMS_PER_ATTEMPT } from "@/lib/extraction-claim";

const base = { claimCount: 1, withinDeadline: true, claimLive: false };

describe("attemptRestartable", () => {
  it("never over a live claim, even the last one the attempt is allowed", () => {
    expect(
      attemptRestartable({ ...base, status: "parsing", claimCount: MAX_CLAIMS_PER_ATTEMPT, claimLive: true }),
    ).toBe(false);
    expect(attemptRestartable({ ...base, status: "parsing", claimLive: true })).toBe(false);
  });

  it("over a claim nobody has renewed, or a budget spent with no claim live", () => {
    expect(attemptRestartable({ ...base, status: "parsing", claimLive: false })).toBe(true);
    expect(attemptRestartable({ ...base, status: "parsing", claimCount: MAX_CLAIMS_PER_ATTEMPT, claimLive: false })).toBe(true);
    // The fourth delivery released and threw; nothing is reading it now.
    expect(attemptRestartable({ ...base, status: "queued", claimCount: MAX_CLAIMS_PER_ATTEMPT })).toBe(true);
  });

  it("over a queued attempt past its deadline, and not before", () => {
    expect(attemptRestartable({ ...base, status: "queued", claimCount: 0, withinDeadline: false })).toBe(true);
    expect(attemptRestartable({ ...base, status: "queued", claimCount: 0, withinDeadline: true })).toBe(false);
  });

  it("never over a read that landed", () => {
    for (const status of ["parsed", "confirmed"]) {
      expect(attemptRestartable({ ...base, status, claimCount: MAX_CLAIMS_PER_ATTEMPT })).toBe(false);
    }
  });

  it("treats an unknown claim on a parsing row as live, so nothing is offered over it", () => {
    // A screen's payload carries `claim_live: null` when the column could not
    // be computed; unknown must never read as abandoned.
    expect(attemptRestartable({ ...base, status: "parsing", claimCount: MAX_CLAIMS_PER_ATTEMPT, claimLive: null })).toBe(false);
  });
});

// ---- the claim window is imported, never retyped -----------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("no literal claim window in src", () => {
  it("has no hard-coded seconds interval in SQL", () => {
    // Every claim, deadline and expiry in SQL is make_interval over an
    // imported constant. A literal is a second copy of a timing the contract
    // in extraction-claim.ts owns, and D9 is what a second copy does.
    const offenders = sourceFiles("src").flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /interval\s+'\s*\d+\s*(seconds?|secs?|minutes?|mins?)\s*'/i.test(line))
        .map(({ index }) => `${file}:${index + 1}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("every screen that offers Start again asks attemptRestartable", () => {
  it("has no screen deciding it with its own copy of the rule", () => {
    // Four screens carried `claim_count >= 4` beside the route's copy, and all
    // five agreed on the wrong answer over a live fourth claim (D7). A screen
    // offering the button must ask the function the route asks.
    const screens = sourceFiles("src/components").filter((file) => readFileSync(file, "utf8").includes('"restart-expired"'));
    expect(screens.length).toBeGreaterThanOrEqual(4);
    for (const file of screens) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toMatch(/attemptRestartable\(/);
      expect(text, file).not.toMatch(/claim_count\s*>=/);
    }
  });
});
