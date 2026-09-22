// Short interactive transactions, for the operations whose guards have to run
// INSIDE the transaction.
//
// ============================================================================
// WHY THIS EXISTS AND WHEN NOT TO USE IT
//
// `txnClient().transaction([...])` in db.ts takes a PRE-BUILT ARRAY of
// statements over the HTTP driver. That is genuinely atomic, but it cannot
// branch: there is no point at which application code gets to look at an
// intermediate result and decide to abort. So every guard has to run before
// the transaction opens, in a separate request, under READ COMMITTED -- which
// means the thing you checked can change between the check and the write.
//
// That is fine for M1's BOQ confirm today only because its window is small. It
// is NOT fine for an operation that must prove "this answer is still at
// version N" or "this answer still does not exist" at the moment it writes.
//
// Use this helper ONLY for those. Ordinary reads and single-statement atomic
// updates stay on the HTTP driver -- including PATCH /api/answers/[id], whose
// one version-predicated UPDATE is already correct and does not need a second
// driver in its path.
//
// NEVER hold a transaction across Blob I/O, queue publishing, or a model call.
// Those take seconds to minutes; a transaction holding row locks that long
// blocks every other writer on the same project.
//
// Node runtime only (`pg` is not edge-safe). App Router routes default to the
// Node runtime, so no `export const runtime` is needed, but do not import this
// from middleware.
// ============================================================================
import pg from "pg";
import { getEnvironment } from "@/lib/env";
import { json, type Row } from "@/lib/db";

// Budgets. Deliberately well inside a route's own limit: a request that cannot
// get its locks in five seconds is contending with something, and failing
// loudly beats holding a connection open while the caller's HTTP request is
// killed out from under it.
const CONNECT_TIMEOUT_MS = 5_000;
const LOCK_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 15_000;

// A guard failed. Thrown INSIDE the callback so the helper rolls back before
// the route turns it into a response -- a SELECT that finds a conflict, or an
// UPDATE that returns zero rows, is not by itself a rollback.
export class DomainConflictError extends Error {
  readonly code: string;
  readonly status: number;
  readonly diff: unknown;

  constructor(code: string, message: string, options: { status?: number; diff?: unknown } = {}) {
    super(message);
    this.name = "DomainConflictError";
    this.code = code;
    this.status = options.status ?? 409;
    this.diff = options.diff ?? null;
  }
}

// COMMIT was sent and the answer never came back. This is the one case where
// "nothing was written" is NOT a safe thing to tell the user: the server may
// have committed and lost the response. Callers must re-read the durable state
// rather than retrying blind.
export class UncertainCommitError extends Error {
  constructor(cause: unknown) {
    super(
      "The change may or may not have been saved -- the database connection was lost while committing. " +
        "Reload before trying again, so you do not repeat an operation that already succeeded.",
    );
    this.name = "UncertainCommitError";
    this.cause = cause;
  }
}

// Parameterized tagged template, so call sites read like the rest of the app
// (`sql` in db.ts) and values can never be concatenated into the statement by
// accident.
//
// It returns ROWS ONLY, on purpose. Every mutation inside a transaction here
// must end in `returning ...` and have its row count checked -- that is how a
// guard is enforced, and a helper that also handed back `rowCount` would make
// it easy to skip.
export type TxnSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

// The statement that was running when a transaction failed, and how long it had
// been running. Attached to the error so `describeTransactionFailure` can say
// WHICH of the three retryable outcomes happened and where -- a 503 reading
// "try again" with nothing in the log behind it is a symptom nobody can chase.
//
// Only the TEXT is carried, never the values: this helper is a parameterised
// tagged template, so the text holds `$1`, `$2` and no client data. That is
// what makes it safe to log on a database holding NDA client material.
export type FailedStatement = { statement: string; elapsedMs: number };

const FAILED_STATEMENT = Symbol.for("specbuilder.failedStatement");

export function failedStatementOf(cause: unknown): FailedStatement | null {
  const carried = (cause as Record<symbol, unknown> | null)?.[FAILED_STATEMENT];
  if (!carried || typeof carried !== "object") return null;
  const { statement, elapsedMs } = carried as Partial<FailedStatement>;
  if (typeof statement !== "string" || typeof elapsedMs !== "number") return null;
  return { statement, elapsedMs };
}

function attachFailedStatement(cause: unknown, statement: string, elapsedMs: number): void {
  if (!cause || typeof cause !== "object") return;
  // Non-enumerable, so nothing that serialises the error into a response body
  // can pick it up by accident -- the statement is for the log only.
  if (failedStatementOf(cause)) return;
  Object.defineProperty(cause, FAILED_STATEMENT, {
    value: { statement, elapsedMs },
    enumerable: false,
    configurable: true,
  });
}

// One line for the log, kept to a single statement's worth: a 15 kB query would
// bury the SQLSTATE that is the point of the line.
const MAX_LOGGED_STATEMENT = 400;

function taggedSql(client: pg.Client): TxnSql {
  return async (strings, ...values) => {
    let text = "";
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i] ?? "";
      if (i < values.length) text += `$${i + 1}`;
    }
    const startedAt = Date.now();
    try {
      const result = await client.query(text, values);
      return result.rows as Row[];
    } catch (cause) {
      attachFailedStatement(cause, text, Date.now() - startedAt);
      throw cause;
    }
  };
}

/**
 * Runs `fn` inside BEGIN/COMMIT on a dedicated connection, rolling back if it
 * throws. The client is always closed.
 *
 * Acquire locks in the order documented in docs/plans -- project row (only
 * where project-wide serialization is actually needed), then the owning draft
 * or intake row, then records, then requirements, then answers, each by id.
 * Reversing it between two call sites is how a deadlock gets introduced.
 */
export async function withTransaction<T>(fn: (sql: TxnSql) => Promise<T>): Promise<T> {
  // Same guard the HTTP client applies: refuse to open a connection at all if
  // APP_ENV and DATABASE_ENVIRONMENT disagree.
  getEnvironment();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    // No `ssl` override. The Neon connection string carries sslmode=require and
    // pg honours it. Never relax verification to make the driver connect --
    // that is a silent downgrade on a database holding NDA client material.
  });

  await client.connect();

  let began = false;
  try {
    await client.query("begin");
    began = true;
    // SET LOCAL, not SET: scoped to this transaction, so it survives a pooled
    // (PgBouncer) endpoint in transaction mode, where a session-level SET
    // would be handed to some later unrelated caller.
    await client.query(`set local lock_timeout = ${LOCK_TIMEOUT_MS}`);
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    const result = await fn(taggedSql(client));

    try {
      await client.query("commit");
    } catch (cause) {
      // The work may be committed. Do not claim otherwise.
      throw new UncertainCommitError(cause);
    }
    began = false;
    return result;
  } catch (cause) {
    if (began) {
      // A failed rollback means the connection is already gone, which rolls
      // back anyway. Keep the original error -- it is the one worth reporting.
      await client.query("rollback").catch(() => {});
    }
    throw cause;
  } finally {
    await client.end().catch(() => {});
  }
}

// Postgres error codes worth distinguishing at a route boundary. A deadlock or
// a lock timeout is retryable by a human pressing the button again; a unique or
// FK violation is not.
const RETRYABLE_PG_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available (lock_timeout)
  "57014", // query_canceled (statement_timeout)
]);

export function isRetryablePostgresError(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_PG_CODES.has(code);
}

// The three retryable outcomes are three different problems with three
// different fixes -- a deadlock is a lock ORDER defect in this repo, a
// lock_timeout is somebody else holding a row, and a statement_timeout is a
// query (or a machine) that is too slow -- and until 2026-09-22 the route
// distinguished none of them. The 503 said "try again" and the log said
// nothing at all, which is why the infill screen's refusals on the local dev
// server could not be told apart from contention. See found-in-use,
// "An answer typed on the infill screen is refused on the LOCAL dev server".
const RETRYABLE_PG_NAMES: Record<string, string> = {
  "40001": "serialization_failure",
  "40P01": "deadlock_detected",
  "55P03": "lock_not_available (lock_timeout, 5s)",
  "57014": "query_canceled (statement_timeout, 15s, or a cancel)",
};

/**
 * One log line naming WHICH failure it was, the statement that was running and
 * how long it had run. Pure, so the wording is testable without a database.
 *
 * The statement is parameterised (`$1`, `$2`) and carries no client data.
 */
export function describeTransactionFailure(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  const sqlstate = typeof code === "string" ? code : "no SQLSTATE";
  const name = typeof code === "string" ? (RETRYABLE_PG_NAMES[code] ?? "unrecognised") : "unrecognised";
  const message = cause instanceof Error ? cause.message : String(cause);

  const parts = [`sqlstate=${sqlstate} (${name})`, `message=${message}`];
  const failed = failedStatementOf(cause);
  if (failed) {
    const statement = failed.statement.replace(/\s+/g, " ").trim();
    const clipped =
      statement.length > MAX_LOGGED_STATEMENT ? `${statement.slice(0, MAX_LOGGED_STATEMENT)}…` : statement;
    parts.push(`after=${failed.elapsedMs}ms`, `statement=${clipped}`);
  } else {
    parts.push("statement=unknown (failed outside a tagged statement)");
  }
  return parts.join(" · ");
}

/**
 * Maps a failure out of `withTransaction` to a response.
 *
 * Lives here rather than in a route because Next validates the exports of a
 * route module — a shared helper exported from one would fail the build — and
 * because every guarded route has to map these the same way or the client
 * cannot tell a conflict from an outage.
 */
export function transactionErrorResponse(cause: unknown): Response {
  if (cause instanceof DomainConflictError) {
    return json(
      {
        ok: false,
        conflict: cause.status === 409,
        code: cause.code,
        error: cause.message,
        ...(cause.diff ? { diff: cause.diff } : {}),
      },
      cause.status,
    );
  }

  if (cause instanceof UncertainCommitError) {
    // The one case where "nothing was written" would be a lie.
    console.error(`guarded transaction commit uncertain: ${describeTransactionFailure(cause.cause)}`);
    return json({ ok: false, code: "uncertain_commit", error: cause.message }, 503);
  }

  if (isRetryablePostgresError(cause)) {
    // Logged, not returned: the reviewer gets a sentence they can act on and
    // the log gets the SQLSTATE somebody can diagnose from.
    console.error(`guarded transaction contended: ${describeTransactionFailure(cause)}`);
    return json(
      {
        ok: false,
        code: "contended",
        error: "Someone else was changing this at the same moment. Nothing was written — try again.",
      },
      503,
    );
  }

  // Never return a raw driver message: it carries table and column names, and
  // a constraint violation can carry a fragment of the value that broke it.
  console.error(`guarded transaction failed: ${describeTransactionFailure(cause)}`, cause);
  return json({ ok: false, error: "Nothing was written. The operation failed; check the logs." }, 500);
}
