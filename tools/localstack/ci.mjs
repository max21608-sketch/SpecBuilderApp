#!/usr/bin/env node
// The database tier in CI: the whole suite with REQUIRE_DB_TESTS=1, against a
// local Postgres, through the local stack's server and preload (audit H1).
//
//   node tools/localstack/ci.mjs [vitest args...]
//
// Run by `.github/workflows/ci.yml` after `db/run-migrations.mjs` and
// `db/run-seed.mjs`. It reads NO env file: the workflow declares LOCAL_STACK,
// APP_ENV, DATABASE_ENVIRONMENT and DATABASE_URL, and `ci-env.mjs` fills the
// rest and takes the money-spending keys out. Rehearse it on a Mac exactly as
// CI runs it, with nothing else in the environment:
//
//   env -i PATH="$PATH" HOME="$HOME" LOCAL_STACK=1 APP_ENV=development \
//     DATABASE_ENVIRONMENT=sandbox DATABASE_URL=postgres://<you>@localhost:<port>/<db> \
//     LOCAL_STACK_PORT=3111 node tools/localstack/ci.mjs
//
// A port already in use is REFUSED in words, never taken over: on a machine
// running dev:local, 3101 is somebody else's stack server and its blob store.
//
// VITEST_MAX_FORKS defaults to the CPU count, capped at 4. vitest.config.ts
// records what oversubscription does to the component tier's 5 s bounds
// (sixteen forks on eight CPUs), and a private repository's hosted runner has
// two CPUs, where a fixed 4 is the same two-to-one.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ciStackEnv } from "./ci-env.mjs";
import { bin, localStackEnv, run } from "./run.mjs";
import { startStackServer } from "./server.mjs";

let madeBlobDir = null;
const built = ciStackEnv(process.env, {
  makeBlobDir: () => (madeBlobDir = mkdtempSync(path.join(os.tmpdir(), "specbuilder-ci-blob-"))),
});
built.VITEST_MAX_FORKS ??= String(Math.max(1, Math.min(4, os.availableParallelism())));
const env = localStackEnv({}, built);

let stack;
try {
  stack = await startStackServer(env);
} catch (error) {
  if (error?.code === "EADDRINUSE") {
    console.error(
      `[ci] Port ${env.LOCAL_STACK_PORT} is already in use. Set LOCAL_STACK_PORT to a free port; the server on it was left alone.`,
    );
    process.exit(1);
  }
  throw error;
}
console.log(
  `[ci] stack server on http://127.0.0.1:${stack.port}; database ${new URL(env.DATABASE_URL).host}; blobs in ${env.LOCAL_BLOB_DIR}; ${env.VITEST_MAX_FORKS} forks`,
);

let code = 1;
try {
  code = await run("tests (database tier required)", bin("vitest"), ["run", ...process.argv.slice(2)], env);
} finally {
  await stack.close().catch(() => {});
  // Only a directory this run made; a named LOCAL_BLOB_DIR is somebody's.
  if (madeBlobDir) rmSync(madeBlobDir, { recursive: true, force: true });
}
console.log(code === 0 ? "\n[ci] database tier passed." : `\n[ci] database tier FAILED (exit ${code}).`);
process.exit(code);
