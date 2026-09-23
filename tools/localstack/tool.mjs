// Run one read-only tool script against the LOCAL stack:
//
//   node --env-file=.env.localstack.local tools/localstack/tool.mjs tools/spec-gap.ts <args>
//
// A tool that loads the app's registers goes through the app's own neon()
// driver, which on the local stack needs the stack server's /sql endpoint. If
// a `dev:local` or a checks run already has it up, it is reused; otherwise one
// is started for the run and closed after. The guard refuses anything but a
// local database, as everywhere in the stack.
import net from "node:net";
import { assertLocalStack, stackPort } from "./guard.mjs";
import { startStackServer } from "./server.mjs";
import { bin, localStackEnv, run } from "./run.mjs";

assertLocalStack("a local-stack tool");
const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error("usage: node --env-file=.env.localstack.local tools/localstack/tool.mjs <script.ts> [args]");
  process.exit(2);
}

const port = stackPort();
const listening = await new Promise((resolve) => {
  const socket = net.connect(port, "127.0.0.1", () => {
    socket.end();
    resolve(true);
  });
  socket.on("error", () => resolve(false));
});

const env = localStackEnv();
const stack = listening ? null : await startStackServer(env);
const code = await run("tool", bin("tsx"), [script, ...args], env);
if (stack) await stack.close().catch(() => {});
process.exit(code);
