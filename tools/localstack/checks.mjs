#!/usr/bin/env node
// npm run checks:local — the four checks, with the DATABASE TIER REQUIRED,
// against the local database rather than the sandbox.
//
//   node --env-file=.env.localstack.local tools/localstack/checks.mjs
//
// The same four as `npm run checks` (lint, typecheck, the suite with
// REQUIRE_DB_TESTS=1, next build), run in the same order and stopping at the
// first failure. The stack server runs for the suite, because src/lib/db.ts
// speaks Neon's HTTP protocol and only the stack server answers it locally.
// VITEST_MAX_FORKS is passed through (use 4 on a shared machine). `next build`
// overwrites .next: stop a dev server in this checkout first.
import { startStackServer } from "./server.mjs";
import { bin, localStackEnv, run } from "./run.mjs";

const env = localStackEnv();
const stack = await startStackServer(env);
console.log(`[localstack] stack server on http://127.0.0.1:${stack.port} — database ${new URL(env.DATABASE_URL).host}`);

let code = 0;
try {
  code = await run("lint", bin("eslint"), ["."], env);
  if (code === 0) code = await run("typecheck", bin("tsc"), ["--noEmit"], env);
  if (code === 0) code = await run("tests (database tier required)", bin("vitest"), ["run"], { ...env, REQUIRE_DB_TESTS: "1" });
  if (code === 0) code = await run("build", bin("next"), ["build"], env);
} finally {
  await stack.close().catch(() => {});
}
console.log(code === 0 ? "\n[localstack] checks:local passed." : `\n[localstack] checks:local FAILED (exit ${code}).`);
process.exit(code);
