// Write <replayDir>/index.json for `src/lib/local-read-replay.ts`: one entry per
// PDF in <filesDir> whose saved harness response (<savedDir>/<name>.json) read OK.
//   node tools/localstack/replay-index.mjs <filesDir> <savedDir> <replayDir>
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const [filesDir, savedDir, replayDir] = process.argv.slice(2);
if (!filesDir || !savedDir || !replayDir) throw new Error("usage: replay-index.mjs <filesDir> <savedDir> <replayDir>");
fs.mkdirSync(replayDir, { recursive: true });
const indexPath = path.join(replayDir, "index.json");
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : {};
let added = 0;
for (const name of fs.readdirSync(filesDir).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
  const saved = path.join(savedDir, `${name}.json`);
  if (!fs.existsSync(saved) || !JSON.parse(fs.readFileSync(saved, "utf8")).ok) continue;
  const base64 = fs.readFileSync(path.join(filesDir, name)).toString("base64");
  index[createHash("sha256").update(base64).digest("hex")] = path.resolve(saved);
  added += 1;
}
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`${added} entries added; ${Object.keys(index).length} in ${indexPath}`);
