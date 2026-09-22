// The statement a guarded transaction died on reaches the log.
//
// The pure tier holds the WORDING (`tests/lib/db-transaction-failure.test.ts`).
// This holds the half that needs a real driver: that `withTransaction` attaches
// the failing statement to the error pg throws, so the log line names what was
// running rather than only that something was.
//
// Source: found-in-use 2026-09-20, "An answer typed on the infill screen is
// refused on the LOCAL dev server, and only there" — three refusals whose
// SQLSTATE nobody could recover afterwards.
import { it, expect } from "vitest";
import { describeIfDb } from "./db-tier";
import {
  withTransaction,
  isRetryablePostgresError,
  describeTransactionFailure,
  failedStatementOf,
} from "@/lib/db-transaction";

describeIfDb("a guarded transaction that times out", () => {
  it("carries the statement it died on, and names the SQLSTATE", async () => {
    // A statement timeout, provoked deliberately and cheaply: the helper's own
    // budget is 15s, so the transaction tightens it for itself. `set local`
    // dies with the transaction either way.
    const thrown = await withTransaction(async (sql) => {
      await sql`set local statement_timeout = 200`;
      await sql`select pg_sleep(5)`;
      return null;
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(thrown).not.toBeNull();
    expect(isRetryablePostgresError(thrown)).toBe(true);

    const failed = failedStatementOf(thrown);
    expect(failed).not.toBeNull();
    expect(failed?.statement).toContain("pg_sleep");
    expect(failed?.elapsedMs).toBeGreaterThan(0);

    const line = describeTransactionFailure(thrown);
    expect(line).toContain("sqlstate=57014");
    expect(line).toContain("statement_timeout");
    expect(line).toContain("pg_sleep");
    expect(line).toMatch(/after=\d+ms/);
  });

  it("carries no parameter VALUES into the log", async () => {
    const secret = "NDA client material that must never reach a log";
    const thrown = await withTransaction(async (sql) => {
      await sql`set local statement_timeout = 200`;
      await sql`select ${secret}::text, pg_sleep(5)`;
      return null;
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    const line = describeTransactionFailure(thrown);
    expect(line).not.toContain(secret);
    // The tagged template writes `$1`, which is what makes that true.
    expect(failedStatementOf(thrown)?.statement).toContain("$1");
  });
});
