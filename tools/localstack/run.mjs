// Shared by `npm run dev:local` and `npm run checks:local`: the environment a
// local-stack child process runs under, and a way to run one.
//
// Every child gets three things on top of .env.localstack.local (which the npm
// script loads with --env-file, so nothing here reads another env file):
//
//   NODE_OPTIONS=--import=<preload>   reroutes the two hard-coded SDK hosts to
//                                     the stack server, and refuses company hosts
//   __NEXT_PROCESSED_ENV=true         tells Next its env is already loaded, so it
//                                     never reads a .env.local sitting in the
//                                     checkout — which points at the sandbox
//   FORCE_COLOR=1                     so piped output keeps its colour
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertLocalStack } from "./guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");
const preloadUrl = pathToFileURL(path.join(here, "preload.mjs")).href;

export function localStackEnv(extra = {}) {
  assertLocalStack("a local-stack command");
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    if (existsSync(path.join(repoRoot, name))) {
      console.warn(`[localstack] ${name} exists in this checkout; it is NOT loaded (__NEXT_PROCESSED_ENV is set).`);
    }
  }
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${preloadUrl}`].filter(Boolean).join(" ");
  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    __NEXT_PROCESSED_ENV: "true",
    FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
    ...extra,
  };
}

/** Run one command to completion; resolves with its exit code. */
export function run(label, command, args, env) {
  console.log(`\n[localstack] ${label}: ${command} ${args.join(" ")}`);
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: "inherit" });
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    child.on("error", (error) => {
      console.error(`[localstack] ${label} could not start:`, error.message);
      resolve(1);
    });
  });
}

export function bin(name) {
  return path.join(repoRoot, "node_modules", ".bin", name);
}
