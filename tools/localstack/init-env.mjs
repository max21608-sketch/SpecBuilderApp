#!/usr/bin/env node
// Writes .env.localstack.local for the local stack, once.
//
//   node tools/localstack/init-env.mjs [--anthropic-from=<path to an env file>]
//
// It generates AUTH_SECRET and the fake blob token, points DATABASE_URL at
// localhost, and — only if asked — copies ANTHROPIC_API_KEY out of another env
// file. That file is READ AS TEXT FOR THAT ONE LINE: it is never loaded into
// this process, nothing else in it is looked at, and the key is never printed.
// Refuses to overwrite an existing .env.localstack.local.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const target = path.resolve(".env.localstack.local");
if (existsSync(target)) {
  console.error(`${target} already exists; not overwriting it.`);
  process.exit(1);
}

const fromArg = process.argv.find((a) => a.startsWith("--anthropic-from="));
let anthropicKey = "";
if (fromArg) {
  const source = fromArg.slice("--anthropic-from=".length);
  const line = readFileSync(source, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*ANTHROPIC_API_KEY\s*=/.test(l));
  anthropicKey = line ? line.replace(/^\s*ANTHROPIC_API_KEY\s*=\s*/, "").replace(/^["']|["']$/g, "").trim() : "";
  console.log(anthropicKey ? `ANTHROPIC_API_KEY copied (${anthropicKey.length} characters).` : "No ANTHROPIC_API_KEY line found; left blank.");
}

const user = os.userInfo().username;
const port = 3101;
const blobDir = path.join(os.homedir(), "dev", "localstack", "blob");

const lines = [
  "# Written by tools/localstack/init-env.mjs. Local stack only — see .env.localstack.example.",
  "LOCAL_STACK=1",
  "APP_ENV=development",
  "DATABASE_ENVIRONMENT=sandbox",
  `DATABASE_URL=postgres://${user}@localhost:5432/specbuilder_local`,
  `AUTH_SECRET=${randomBytes(32).toString("hex")}`,
  `ANTHROPIC_API_KEY=${anthropicKey}`,
  `BLOB_READ_WRITE_TOKEN=vercel_blob_rw_localstack_${randomBytes(16).toString("hex")}`,
  `LOCAL_STACK_PORT=${port}`,
  `VERCEL_BLOB_API_URL=http://127.0.0.1:${port}/api`,
  // `localhost`, not 127.0.0.1, for the BROWSER: @vercel/blob streams an
  // upload body unless the API URL starts with http://localhost, and Chrome
  // refuses a streamed body over HTTP/1.1 (net::ERR_ALPN_NEGOTIATION_FAILED).
  `NEXT_PUBLIC_VERCEL_BLOB_API_URL=http://localhost:${port}/api`,
  `LOCAL_BLOB_DIR=${blobDir}`,
  "APP_BASE_URL=http://localhost:3100",
  "EMAIL_MODE=disabled",
  "MAIL_INGESTION_MODE=disabled",
  "CRON_SECRET=",
  "GRAPH_TENANT_ID=",
  "GRAPH_CLIENT_ID=",
  "GRAPH_CLIENT_SECRET=",
  "GRAPH_MAILBOX=",
  "CAPSULE_API_TOKEN=",
  "",
];
writeFileSync(target, lines.join("\n"), { mode: 0o600 });
console.log(`Wrote ${target}.`);
