// Neon Postgres client. Lazily initialised so `next build` doesn't require
// DATABASE_URL to be set at build time (only at request time).
import { neon } from "@neondatabase/serverless";
import { getEnvironment } from "./env";

type SqlFn = ReturnType<typeof neon>;

let cached: SqlFn | undefined;

function client(): SqlFn {
  if (!cached) {
    getEnvironment(); // throws if APP_ENV/DATABASE_ENVIRONMENT are unset or mismatched
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = neon(url);
  }
  return cached;
}

export type Row = Record<string, unknown>;

// Tagged-template query function, e.g. sql`select 1 where id = ${id}`.
// Kept as a plain function (not `client()` directly) so callers always go
// through the lazy-init check above. Return type is pinned to Row[] rather
// than inferred from neon's overloaded signature, which otherwise collapses
// to a union callers can't index into without a cast at every call site.
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  return client()(strings, ...values) as Promise<Row[]>;
}

// The raw neon tagged-template client, exposed for the few call sites that need
// its `.transaction([...])` batch API (multiple statements committed
// atomically over the HTTP driver's single request). Unlike the `sql` wrapper
// above, queries built from this client are query DESCRIPTORS that can either
// be awaited individually or passed as an array to `.transaction(...)`. Reach
// for `sql` by default; use this only when you genuinely need atomicity across
// several statements (e.g. the intake group-commit).
export function txnClient(): SqlFn {
  return client();
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
