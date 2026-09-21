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
import { createHash } from "node:crypto";
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

// ============================================================================
// TWO RUNS AT ONCE CLAIMED THE SAME PROJECT NUMBER.
//
// `projects.bws_project_number` is unique, and every fixture here wrote its own
// literal — `__QA P90014`, `__QA P00028`. Alone, each file passes. Two full
// db-tier runs against the one sandbox, which is this plan's normal state with
// two agents working, and the second to arrive dies in `beforeAll` on
// `projects_bws_project_number_key` and then AGAIN in `afterAll` with "invalid
// input syntax for type uuid" because `projectId` was never assigned — two red
// messages that read as unrelated defects and send somebody hunting. Found
// twice on 2026-09-21 before it was written down.
//
// So a number is asked for rather than typed, and it carries a suffix that is
// the same for every call in ONE process and different between processes. The
// pid is what makes two concurrent runs disjoint (no two live processes share
// one); the start time is what stops a recycled pid from colliding with rows a
// crashed run left behind. Within a run it is stable, so a fixture another
// test in the same file looks up by number still finds it.
//
// THE `__QA ` PREFIX AND ITS SPACE SURVIVE EXACTLY, because that prefix is
// what `tools/qa-clean.mjs` and every `like '__QA%'` predicate sweep on. The
// suffix goes on the END for the same reason.
//
// The consequence, deliberately: an aborted run's rows no longer block the next
// one, so nothing has to pre-delete them by number — they simply sit in the
// sandbox until `npm run db:qa-clean` sweeps them, which is what that script is
// for.
// ============================================================================
const QA_PREFIX = "__QA ";

/**
 * The suffix for one process, from its pid and when it started. Exported so a
 * pure test can assert that two different processes cannot produce one suffix
 * without having to start two.
 */
export function qaSuffixFor(pid: number, startedAtMs: number): string {
  return createHash("sha1").update(`${pid}:${Math.round(startedAtMs)}`).digest("hex").slice(0, 6);
}

const RUN_SUFFIX = qaSuffixFor(process.pid, performance.timeOrigin);

/**
 * A `__QA ` identifier unique to this process. `qaNumber("P90014")` gives
 * `__QA P90014-1f3a9c`, so two concurrent runs never claim one unique key and a
 * single run always asks for the same value.
 */
export function qaNumber(base: string): string {
  return `${QA_PREFIX}${base}-${RUN_SUFFIX}`;
}

/** This process's suffix, for a test that needs to reason about it. */
export const QA_RUN_SUFFIX = RUN_SUFFIX;
