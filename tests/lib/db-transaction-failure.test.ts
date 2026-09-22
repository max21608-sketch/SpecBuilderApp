// A 503 reading "try again" with nothing in the log behind it is a symptom
// nobody can chase. `describeTransactionFailure` is what the route now logs;
// these hold that it NAMES which of the three retryable outcomes happened, and
// that it carries no client data.
//
// Source: found-in-use 2026-09-20, "An answer typed on the infill screen is
// refused on the LOCAL dev server, and only there".
import { describe, it, expect } from "vitest";
import { describeTransactionFailure, isRetryablePostgresError } from "@/lib/db-transaction";

function pgError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe("describeTransactionFailure", () => {
  it("names a lock timeout apart from a statement timeout", () => {
    const lock = describeTransactionFailure(pgError("55P03", "canceling statement due to lock timeout"));
    const statement = describeTransactionFailure(pgError("57014", "canceling statement due to statement timeout"));

    expect(lock).toContain("sqlstate=55P03");
    expect(lock).toContain("lock_not_available");
    expect(statement).toContain("sqlstate=57014");
    expect(statement).toContain("statement_timeout");
    // The whole point: the two are distinguishable in the log.
    expect(lock).not.toEqual(statement);
  });

  it("names a deadlock, which is a lock-order defect rather than contention", () => {
    const line = describeTransactionFailure(pgError("40P01", "deadlock detected"));
    expect(line).toContain("40P01");
    expect(line).toContain("deadlock_detected");
  });

  it("says the statement is unknown rather than inventing one", () => {
    expect(describeTransactionFailure(pgError("57014", "canceled"))).toContain("statement=unknown");
  });

  it("reports an error carrying no SQLSTATE at all", () => {
    const line = describeTransactionFailure(new Error("connection terminated"));
    expect(line).toContain("no SQLSTATE");
    expect(line).toContain("connection terminated");
  });

  it("agrees with isRetryablePostgresError about which codes are the retryable ones", () => {
    for (const code of ["40001", "40P01", "55P03", "57014"]) {
      expect(isRetryablePostgresError(pgError(code, "x"))).toBe(true);
      expect(describeTransactionFailure(pgError(code, "x"))).not.toContain("unrecognised");
    }
    expect(isRetryablePostgresError(pgError("23505", "duplicate key"))).toBe(false);
    expect(describeTransactionFailure(pgError("23505", "duplicate key"))).toContain("unrecognised");
  });
});
