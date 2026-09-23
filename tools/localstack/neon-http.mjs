// Neon's SQL-over-HTTP protocol, answered by a local Postgres.
//
// src/lib/db.ts uses `neon()` from @neondatabase/serverless 0.10, which does
// not speak the Postgres wire protocol at all: every query is a POST of JSON to
// `https://<host>/sql` (for a host with no dot, like `localhost`, the host is
// used as is). A local Postgres cannot answer that, so this does, with `pg`.
// The preload (tools/localstack/preload.mjs) reroutes `https://localhost/sql`
// here. Nothing in the app changes.
//
// What the driver sends, read from its dist (0.10.4):
//   headers  Neon-Connection-String, Neon-Raw-Text-Output: true,
//            Neon-Array-Mode: true, and for a batch the optional
//            Neon-Batch-Isolation-Level / -Read-Only / -Deferrable
//   body     { query, params }  or  { queries: [{ query, params }, ...] }
// What it expects back:
//   200      { fields: [{ name, dataTypeID }], rows: [[text, ...]], command, rowCount }
//            or { results: [ that, ... ] } for a batch
//   400      { message, code, detail, hint, position, ... } — a Postgres error,
//            which the driver rebuilds field by field into a NeonDbError
// Raw text output means every value goes back as Postgres's own TEXT form and
// the DRIVER parses it by type oid — so this returns strings and parses nothing.
import pg from "pg";

const pools = new Map();

function poolFor(connectionString) {
  let pool = pools.get(connectionString);
  if (!pool) {
    const host = new URL(connectionString).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new Error(`The local SQL endpoint only serves a local database, not ${host}.`);
    }
    pool = new pg.Pool({ connectionString, max: 10 });
    pool.on("error", () => {});
    pools.set(connectionString, pool);
  }
  return pool;
}

// Every column comes back as text; the driver owns the parsing.
const RAW_TEXT = { getTypeParser: () => (value) => value };

async function runOne(client, { query, params }) {
  const result = await client.query({ text: query, values: params ?? [], rowMode: "array", types: RAW_TEXT });
  return {
    command: result.command,
    rowCount: result.rowCount,
    rows: result.rows,
    fields: (result.fields ?? []).map((f) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
      tableID: f.tableID,
      columnID: f.columnID,
      dataTypeSize: f.dataTypeSize,
      dataTypeModifier: f.dataTypeModifier,
      format: "text",
    })),
    rowAsArray: true,
  };
}

const ISOLATION = {
  ReadUncommitted: "read uncommitted",
  ReadCommitted: "read committed",
  RepeatableRead: "repeatable read",
  Serializable: "serializable",
};

const ERROR_FIELDS = [
  "severity", "code", "detail", "hint", "position", "internalPosition", "internalQuery",
  "where", "schema", "table", "column", "dataType", "constraint", "file", "line", "routine",
];

function errorBody(error) {
  const body = { message: error?.message ?? String(error) };
  for (const field of ERROR_FIELDS) if (error?.[field] !== undefined) body[field] = error[field];
  return body;
}

/** Answer one POST /sql. `headers` is a lower-cased header map, `body` the parsed JSON. */
export async function handleSql(headers, body) {
  const connectionString = headers["neon-connection-string"];
  if (!connectionString) return { status: 400, body: { message: "Missing Neon-Connection-String." } };

  let pool;
  try {
    pool = poolFor(connectionString);
  } catch (error) {
    return { status: 400, body: { message: error.message } };
  }

  const client = await pool.connect();
  try {
    if (Array.isArray(body?.queries)) {
      const level = ISOLATION[headers["neon-batch-isolation-level"]] ?? null;
      const readOnly = headers["neon-batch-read-only"] === "true";
      const deferrable = headers["neon-batch-deferrable"] === "true";
      const mode = [level ? `isolation level ${level}` : "", readOnly ? "read only" : "", deferrable ? "deferrable" : ""]
        .filter(Boolean)
        .join(" ");
      await client.query(`begin ${mode}`);
      try {
        const results = [];
        for (const q of body.queries) results.push(await runOne(client, q));
        await client.query("commit");
        return { status: 200, body: { results } };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        return { status: 400, body: errorBody(error) };
      }
    }
    try {
      return { status: 200, body: await runOne(client, body ?? {}) };
    } catch (error) {
      return { status: 400, body: errorBody(error) };
    }
  } finally {
    client.release();
  }
}

export async function closeSqlPools() {
  await Promise.all([...pools.values()].map((pool) => pool.end().catch(() => {})));
  pools.clear();
}
