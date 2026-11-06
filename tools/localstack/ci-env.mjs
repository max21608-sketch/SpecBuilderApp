// The environment the database tier runs under in CI (audit H1, 2026-11-06),
// built in one place so a local rehearsal of the CI run and the CI run itself
// are the same suite.
//
// ============================================================================
// CI RAN A FIFTH OF THE SUITE AND REPORTED GREEN.
//
// `.github/workflows/ci.yml` ran `npm test` with no DATABASE_URL, so every file
// under tests/db skipped: the confirm paths, the export scope, the
// change-history coverage assertion and every CHECK guard. The tier does not
// need the sandbox. It needs a Postgres and something answering Neon's
// SQL-over-HTTP protocol, which is exactly what the local stack is, so CI runs
// the local stack: a `postgres` service container, the stack server
// (`server.mjs`) and the preload (`preload.mjs`), behind the same guard.
//
// What the workflow DECLARES, in YAML where a reader sees it, is the guard's
// three: LOCAL_STACK=1, APP_ENV=development, a localhost DATABASE_URL (plus
// DATABASE_ENVIRONMENT=sandbox, which src/lib/env.ts pairs with development).
// What this file fills is plumbing nobody should have to copy into YAML:
//
// - THE BLOB URLS ARE DERIVED FROM THE PORT, ALWAYS. The SDK is told where the
//   Blob API is by VERCEL_BLOB_API_URL, and the server listens on
//   LOCAL_STACK_PORT. If the two disagree, every upload in the suite goes to
//   whatever else is on the other port. On a machine where a dev stack is
//   already up on 3101, that is ANOTHER PERSON'S STORE, and the run would
//   still pass. So a rehearsal on another port moves both together.
// - THE STORE IS A FRESH TEMPORARY DIRECTORY unless one is named. CI has no
//   home folder worth keeping, and a rehearsal must not write test blobs
//   among copies of real client documents in ~/dev/localstack/blob.
// - NO KEY THAT SPENDS MONEY OR REACHES A COMPANY SYSTEM SURVIVES. CI holds no
//   Anthropic key, no Graph secret and no Capsule token, so a rehearsal that
//   kept the ones in .env.localstack.local would prove a different suite: a
//   test that quietly needed the real key would pass here and fail there.
//   VERIFY_MODEL goes too, so tests/manual/verify-model.test.ts stays skipped.
// - MAIL AND EMAIL ARE DISABLED, whatever the base says. Nothing in CI sends
//   or ingests, and a test that needs either mode sets it for itself.
// ============================================================================
import { randomBytes } from "node:crypto";
import { assertLocalStack, stackPort } from "./guard.mjs";

/** Taken out of the environment before anything runs. */
export const CI_STRIPPED = [
  "ANTHROPIC_API_KEY",
  "VERIFY_MODEL",
  "CAPSULE_API_TOKEN",
  "GRAPH_TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "GRAPH_MAILBOX",
  "GRAPH_CLIENT_STATE",
  "CRON_SECRET",
  // dev:local's in-process queue. The suite stubs the publisher; checks:local
  // never set this either.
  "LOCAL_QUEUE",
];

/**
 * The environment for the stack server and the vitest run, from `base`.
 * `makeBlobDir` is called only when LOCAL_BLOB_DIR is unset, and returns the
 * directory to use (CI passes a fresh temporary one). Throws, through the
 * guard, when `base` is not a local-stack environment.
 */
export function ciStackEnv(base, { makeBlobDir }) {
  assertLocalStack("the CI database tier", base);
  const env = { ...base };
  for (const key of CI_STRIPPED) delete env[key];

  const port = stackPort(env);
  env.LOCAL_STACK_PORT = String(port);
  env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${port}/api`;
  // `localhost`, not 127.0.0.1, as .env.localstack.example says: the browser's
  // copy. Nothing in the suite is a browser; it is kept equal to what dev:local
  // runs so a test reading it sees the shape it would see there.
  env.NEXT_PUBLIC_VERCEL_BLOB_API_URL = `http://localhost:${port}/api`;
  if (!env.LOCAL_BLOB_DIR) env.LOCAL_BLOB_DIR = makeBlobDir();
  if (!String(env.BLOB_READ_WRITE_TOKEN ?? "").startsWith("vercel_blob_rw_localstack")) {
    env.BLOB_READ_WRITE_TOKEN = `vercel_blob_rw_localstack_${randomBytes(16).toString("hex")}`;
  }
  if (!env.AUTH_SECRET) env.AUTH_SECRET = randomBytes(32).toString("hex");

  env.EMAIL_MODE = "disabled";
  env.MAIL_INGESTION_MODE = "disabled";
  env.REQUIRE_DB_TESTS = "1";
  return env;
}
