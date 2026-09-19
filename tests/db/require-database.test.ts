// The one test in this directory that always runs.
//
// ============================================================================
// THE SKIP THAT READ AS A PASS.
//
// Every other file here is gated by `describeIfDb` (see `db-tier.ts`), so with
// no `DATABASE_URL` the tier skips and `npm test` exits 0 with a green summary.
// That is correct for pure-library work and it is how CI runs. It is NOT
// correct for the run that closes a stage or reports a change as proven, and
// nothing distinguished the two: the same command printed the same green.
//
// So this file says, in words, which of the two just happened.
//
// - `REQUIRE_DB_TESTS=1` and no `DATABASE_URL` -> FAIL. `npm run checks` sets
//   the variable, so the run that is supposed to prove something cannot come
//   back green having skipped a fifth of itself.
// - no `REQUIRE_DB_TESTS` and no `DATABASE_URL` -> pass, and print the reason
//   beside vitest's own skipped count. The count was always printed; what was
//   missing was the word "because".
//
// It is ONE file rather than a refusal inside `describeIfDb`, which would raise
// the same failure twenty-six times and bury anything else that was red.
// ============================================================================
import { describe, it, expect } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const required = process.env.REQUIRE_DB_TESTS === "1";

const HOW =
  "Set DATABASE_URL to the sandbox and run it again: " +
  "`node --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run` " +
  "with DATABASE_URL in .env.local, which is what `npm run checks` does. " +
  "To run without a database, unset REQUIRE_DB_TESTS — the tier then skips, " +
  "which is correct for pure-library work and is how CI runs.";

describe("the database tier", () => {
  it("ran, or says why it did not", () => {
    if (databaseUrl) {
      expect(databaseUrl.length).toBeGreaterThan(0);
      return;
    }

    if (required) {
      expect.fail(
        "REQUIRE_DB_TESTS=1 asks for the database tier and DATABASE_URL is not set, " +
          "so every test in tests/db skipped and this run proves nothing about any " +
          "write path. " +
          HOW,
      );
    }

    // Not required, so skipping is the right answer -- but say so, because a
    // green summary with a skipped count nobody reads is what this whole file
    // is about.
    console.log(
      "DATABASE_URL is not set: every test in tests/db skipped, and the run's " +
        "`skipped` count is theirs. That is correct for pure-library work. " +
        "Run `npm run checks` (REQUIRE_DB_TESTS=1) to make the tier required.",
    );
  });
});
