// The local stack's one guard, shared by every piece of it.
//
// The local stack (docs/environments.md, "The local stack") runs the whole app
// on one Mac: a local Postgres, a folder standing in for Vercel Blob, and the
// extraction queue run in-process. Each of those pieces REROUTES something a
// deployment sends to a real service, so each must be impossible to switch on
// anywhere but here. They all call this, and it refuses unless all three hold:
//
//   LOCAL_STACK=1                 the operator asked for the local stack
//   APP_ENV=development           it is not a deployment
//   DATABASE_URL host is local    localhost or 127.0.0.1, never a neon.tech host
//
// DATABASE_ENVIRONMENT stays `sandbox` because src/lib/env.ts accepts only
// sandbox / pilot / production and `development` must pair with sandbox. The
// HOST is the check that means something; the label is only what env.ts needs.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function localStackProblem(env = process.env) {
  if (env.LOCAL_STACK !== "1") return "LOCAL_STACK is not 1.";
  if (env.APP_ENV !== "development") return `APP_ENV is ${env.APP_ENV ?? "unset"}, not development.`;
  let host = "";
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {
    return "DATABASE_URL is not a URL.";
  }
  if (!LOCAL_HOSTS.has(host)) return `DATABASE_URL points at ${host || "nothing"}, not localhost.`;
  return null;
}

export function assertLocalStack(what, env = process.env) {
  const problem = localStackProblem(env);
  if (problem) {
    throw new Error(`Refusing to start ${what}: this is local-stack only. ${problem}`);
  }
}

/** The port the stack server (blob + SQL-over-HTTP) listens on. */
export function stackPort(env = process.env) {
  const port = Number(env.LOCAL_STACK_PORT ?? 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("LOCAL_STACK_PORT is not a port.");
  return port;
}

/** The fake store id inside BLOB_READ_WRITE_TOKEN (`vercel_blob_rw_<id>_<secret>`). */
export function localStoreId(env = process.env) {
  const [, , , storeId = ""] = String(env.BLOB_READ_WRITE_TOKEN ?? "").split("_");
  if (!storeId.startsWith("localstack")) {
    throw new Error("BLOB_READ_WRITE_TOKEN must be a local-stack token (vercel_blob_rw_localstack_<secret>).");
  }
  return storeId;
}
