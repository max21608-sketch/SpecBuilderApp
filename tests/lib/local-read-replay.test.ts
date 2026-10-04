import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readReplayEnabled, replayedResponse } from "@/lib/local-read-replay";

describe("local read replay", () => {
  it("is off unless the local stack, development and a replay dir are all set", () => {
    expect(readReplayEnabled({ LOCAL_STACK: "1", APP_ENV: "development", LOCAL_READ_REPLAY_DIR: "/x" })).toBe(true);
    expect(readReplayEnabled({ LOCAL_STACK: "1", APP_ENV: "production", LOCAL_READ_REPLAY_DIR: "/x" })).toBe(false);
    expect(readReplayEnabled({ APP_ENV: "development", LOCAL_READ_REPLAY_DIR: "/x" })).toBe(false);
    expect(readReplayEnabled({ LOCAL_STACK: "1", APP_ENV: "development" })).toBe(false);
  });

  it("answers a known document from its saved response and nothing else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replay-"));
    const base64 = Buffer.from("%PDF synthetic").toString("base64");
    fs.writeFileSync(path.join(dir, "saved.json"), JSON.stringify({ ok: true, rawResponse: { model: "m", content: [] } }));
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ [createHash("sha256").update(base64).digest("hex")]: "saved.json" }));
    const env = { LOCAL_STACK: "1", APP_ENV: "development", LOCAL_READ_REPLAY_DIR: dir };
    expect(replayedResponse(base64, env)).toEqual({ model: "m", content: [] });
    expect(replayedResponse(Buffer.from("other").toString("base64"), env)).toBeNull();
    expect(replayedResponse(base64, { ...env, APP_ENV: "production" })).toBeNull();
  });
});
