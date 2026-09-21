// Pure tier — the db tier's fixture numbers.
//
// `qaNumber` is what stops two concurrent database-tier runs from claiming one
// `projects.bws_project_number`. It lives in `tests/db/db-tier.ts` with the
// tier's other shared pieces, and it is tested here because nothing about it
// needs a database: it is a string.
import { describe, it, expect } from "vitest";
import { qaNumber, qaSuffixFor, QA_RUN_SUFFIX } from "../db/db-tier";

describe("a QA fixture number", () => {
  it("keeps the `__QA ` prefix and its space, because the sweep matches on it", () => {
    // tools/qa-clean.mjs and every `like '__QA%'` predicate find a row by this
    // prefix alone. A suffix that went on the FRONT would leave those rows in
    // the sandbox for ever.
    expect(qaNumber("P90014").startsWith("__QA ")).toBe(true);
    expect(qaNumber("P90014")).toMatch(/^__QA P90014-[0-9a-f]{6}$/);
  });

  it("is the same value every time inside one process", () => {
    // A fixture another test in the same file looks up by number has to find
    // it, so this must not be random per call.
    expect(qaNumber("P00028")).toBe(qaNumber("P00028"));
  });

  it("keeps two bases apart", () => {
    expect(qaNumber("P00028")).not.toBe(qaNumber("P00028b"));
  });

  it("cannot collide with another process's suffix", () => {
    // The suffix is this process's pid and start time hashed. Two live
    // processes never share a pid, so two concurrent runs cannot produce one
    // number -- and a recycled pid differs by start time from the rows a
    // crashed run left behind. Both halves have to reach the hash, which is
    // what these three pairs assert.
    expect(qaSuffixFor(1000, 1_700_000_000_000)).not.toBe(qaSuffixFor(1001, 1_700_000_000_000));
    expect(qaSuffixFor(1000, 1_700_000_000_000)).not.toBe(qaSuffixFor(1000, 1_700_000_001_000));
    expect(qaSuffixFor(1000, 1_700_000_000_000)).toBe(qaSuffixFor(1000, 1_700_000_000_000));
    expect(QA_RUN_SUFFIX).toMatch(/^[0-9a-f]{6}$/);
    expect(qaNumber("P90014").endsWith(QA_RUN_SUFFIX)).toBe(true);
  });
});
