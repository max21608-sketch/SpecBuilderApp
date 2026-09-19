// The database tier's gate, in ONE place.
//
// ============================================================================
// A GREEN SUITE THAT RAN A FIFTH OF ITSELF.
//
// `npm test` with no `DATABASE_URL` reports 960 passed and exits 0. The 283
// tests in this directory did not run — they skipped — and two people have
// already read that green as "the database tier passed". Skipping is the right
// default: a pure-library change needs no sandbox, and CI has none to point at
// (`.github/workflows/ci.yml` says so). What was missing is a way to DEMAND the
// tier, so that the run which is supposed to prove a change fails rather than
// quietly covers a fifth of the suite.
//
// `REQUIRE_DB_TESTS=1` is that demand, and `npm run checks` sets it. The
// refusal itself is one test in `require-database.test.ts` rather than 26
// copies of the same failure — this file goes on skipping, because 26 identical
// red suites say no more than one does and bury whatever else is red.
//
// Twenty-five files each declared `const describeIfDb = databaseUrl ? describe
// : describe.skip` and nothing shared it, so the tier had twenty-five chances
// to drift apart about what gating means. It has one now.
// ============================================================================
import { describe } from "vitest";

const databaseUrl = process.env.DATABASE_URL;

// ============================================================================
// FIVE SECONDS IS A LOCAL DEFAULT AND THIS TIER IS NOT LOCAL.
//
// Every test here opens a connection to a Neon database in London and does real
// work over it. Measured on 2026-09-19 (stage 0.3): `GET /api/projects` takes
// 1.5-2.1s per call against the sandbox, a two-confirm test takes 3.7s when its
// file runs alone — and both crossed vitest's 5s default under the contention
// of a full run, which reads as a regression and is not one. A marginal bound
// that only fails when everything else is running is a red suite nobody can
// read, and the fix had been applied one test at a time as each one crossed.
//
// 30s is deliberately generous against measured seconds: this bound exists to
// distinguish a hung connection from a slow one, not to police performance.
// Anything genuinely slow is a finding for `found-in-use.md` (the projects list
// already is one), never a bound raised to hide it.
//
// IT IS A SUITE OPTION, NOT `testTimeout` IN `vitest.config.ts`, and that is
// the whole point: a global value would hand the same 30s to the pure and
// component tiers, where nothing touches a network and a test that stops
// responding should say so in five seconds. Those two tiers keep the default
// because this bound is reachable only through `describeIfDb`, which only this
// directory calls. A per-test bound still wins over it, which is how a test
// that genuinely needs longer asks for it in the one place a reader will look.
// ============================================================================
export const DB_TEST_TIMEOUT = 30_000;

/**
 * Declare a database-tier suite. Runs with `DATABASE_URL` set, skips without
 * it, and carries the tier's timeout either way.
 */
export function describeIfDb(name: string, factory: () => void): void {
  if (!databaseUrl) {
    describe.skip(name, factory);
    return;
  }
  describe(name, { timeout: DB_TEST_TIMEOUT }, factory);
}
