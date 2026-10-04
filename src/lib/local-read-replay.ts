// ============================================================================
// LOCAL STACK ONLY: answer a document read from a SAVED response instead of
// the API. Built 2026-10-04 when the API account ran out of credit halfway
// through the intake rebuild: the drawings review had to be checked against
// the 40 real reads already paid for, and re-reading them would have spent
// the same money twice.
//
// It is OFF unless all three hold — the local-queue rule (`local-queue.ts`):
//   LOCAL_STACK=1, APP_ENV=development, and LOCAL_READ_REPLAY_DIR set.
// Production sets none of them, and `env.ts` refuses a deployment whose
// APP_ENV and database disagree, so this can never answer a real read.
//
// The directory holds `index.json` — { "<sha256 of the document's base64>":
// "<saved harness response file>" } — written by
// `tools/localstack/replay-index.mjs` from an `eval:drawings` label. A
// document with no entry falls through to the API exactly as before.
// ============================================================================
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function readReplayEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LOCAL_STACK === "1" && env.APP_ENV === "development" && Boolean(env.LOCAL_READ_REPLAY_DIR);
}

/** The saved raw model response for this document's bytes, or null. */
export function replayedResponse(base64: string, env: Record<string, string | undefined> = process.env): unknown | null {
  if (!readReplayEnabled(env)) return null;
  const dir = String(env.LOCAL_READ_REPLAY_DIR);
  try {
    const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as Record<string, string>;
    const sha = createHash("sha256").update(base64).digest("hex");
    const file = index[sha];
    if (!file) return null;
    const saved = JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(dir, file), "utf8")) as { ok?: boolean; rawResponse?: unknown };
    return saved.ok && saved.rawResponse ? saved.rawResponse : null;
  } catch {
    return null;
  }
}
