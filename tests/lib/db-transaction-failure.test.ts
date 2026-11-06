// A 503 reading "try again" with nothing in the log behind it is a symptom
// nobody can chase. `describeTransactionFailure` is what the route now logs;
// these hold that it NAMES which of the three retryable outcomes happened, and
// that it carries no client data.
//
// Source: found-in-use 2026-09-20, "An answer typed on the infill screen is
// refused on the LOCAL dev server, and only there".
import { describe, it, expect, vi } from "vitest";
import { describeTransactionFailure, isRetryablePostgresError, transactionErrorResponse } from "@/lib/db-transaction";

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

// ============================================================================
// THE 500 PATH LOGGED THE WHOLE DRIVER ERROR (audit B9).
//
// `transactionErrorResponse` passed the error object itself to console.error,
// and a Postgres error carries `detail`: "Key (code_norm)=(<the client's code>)
// already exists", "Failing row contains (<every column of the row>)". That
// went into the Vercel logs on every unexpected failure. The line now carries
// what diagnoses it -- SQLSTATE, constraint, table, the statement -- and a
// reference that ties the line to one failure.
// ============================================================================
describe("transactionErrorResponse on an unexpected failure", () => {
  function constraintError(): Error & Record<string, string> {
    const error = new Error('duplicate key value violates unique constraint "project_finishes_code_key"') as Error &
      Record<string, string>;
    Object.assign(error, {
      code: "23505",
      constraint: "project_finishes_code_key",
      table: "project_finishes",
      detail: "Key (project_id, code_norm)=(invented, INVENTED-CLOTH-01) already exists.",
    });
    return error;
  }

  it("logs the SQLSTATE, the constraint, the table and a reference, never the detail", async () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      const response = transactionErrorResponse(constraintError());
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/Nothing was written/);

      expect(logged).toHaveLength(1);
      // Strings only: an object here is serialised whole, detail and all.
      expect(logged[0]!.every((arg) => typeof arg === "string")).toBe(true);
      const line = logged[0]!.join(" ");
      expect(line).toContain("23505");
      expect(line).toContain("constraint=project_finishes_code_key");
      expect(line).toContain("table=project_finishes");
      expect(line).toMatch(/ref=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      expect(line).not.toContain("INVENTED-CLOTH-01");
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the message and stack of an error that did not come from the database", async () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      transactionErrorResponse(new TypeError("Cannot read properties of undefined (reading 'id')"));
      const line = logged[0]!.join(" ");
      expect(line).toContain("Cannot read properties of undefined");
      expect(line).toContain("TypeError");
    } finally {
      spy.mockRestore();
    }
  });
});
