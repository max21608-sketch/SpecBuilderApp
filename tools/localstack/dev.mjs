#!/usr/bin/env node
// npm run dev:local — the local stack: the stack server (blob store + SQL
// endpoint) and `next dev` on port 3100, with document reads run in-process.
//
//   node --env-file=.env.localstack.local tools/localstack/dev.mjs [--port=3100]
//
// Ctrl-C stops both. See docs/environments.md, "The local stack".
import { spawn } from "node:child_process";
import { startStackServer } from "./server.mjs";
import { bin, localStackEnv, repoRoot } from "./run.mjs";

const portArg = process.argv.find((a) => a.startsWith("--port="));
const port = portArg ? portArg.slice("--port=".length) : "3100";

const env = localStackEnv({ LOCAL_QUEUE: "inline", PORT: port });
const stack = await startStackServer(env);
console.log(`[localstack] stack server on http://127.0.0.1:${stack.port} — database ${new URL(env.DATABASE_URL).host}`);
console.log(`[localstack] app on http://localhost:${port}`);

const next = spawn(bin("next"), ["dev", "-p", port], { cwd: repoRoot, env, stdio: "inherit" });

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (next.exitCode === null) next.kill("SIGTERM");
  await stack.close().catch(() => {});
  process.exit(code);
}
next.on("exit", (code) => void stop(code ?? 0));
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
