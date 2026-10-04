#!/usr/bin/env tsx
// Score a drawings read against the golden, with no database, queue or blob store.
//
//   npm run eval:drawings -- --golden <dir> --files <dir> --model claude-opus-5 \
//       --effort high --pipeline v3 --label baseline-opus5 [--only <substr>] [--concurrency 3]
//   npm run eval:drawings -- --golden <dir> --rescore baseline-opus5 [--only <substr>]
//
// ============================================================================
// A LIVE RUN SPENDS MONEY: one charged model call per PDF in --files. Nothing
// asks first. Narrow it with --only.
//
// It calls `extractSpecDocument` itself — the app's own request, prompt and
// response checks — with the harness overrides (model, effort, prompt
// variant), and SAVES every raw response, usage and timing to
// `~/dev/localstack/drawings-eval/<label>/`, OUTSIDE the repo: a response is
// a real client document read back, and it never enters a commit.
//
// `--rescore <label>` re-stages those saved responses with the CURRENT code
// and scores them again, with no API call. That is what makes a change to
// staging, grouping or conversion measurable for nothing.
//
// The score goes through the app's own staging and the read-time pipeline the
// review screen runs (tools/drawings-golden.ts says why). Files with no golden
// are read and listed, but not scored. Only VERIFIED golden entries are the
// score; drafts are totalled beside them.
// ============================================================================
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  EXTRACTION_EFFORT,
  EXTRACTION_MODEL,
  extractSpecDocument,
  readExtractionResponse,
  tokenUsage,
  type ExtractionEffort,
  type TokenUsage,
} from "../src/lib/anthropic";
import { prepareDocumentSource } from "../src/lib/intake-source";
import {
  GOLDEN_SLOTS,
  parseGolden,
  readFromModelOutput,
  scoreDrawingRead,
  totalScores,
  type DocumentScore,
  type DrawingRead,
  type GoldenDocument,
  type ScoreTotals,
} from "./drawings-golden";

// ---- arguments ---------------------------------------------------------------

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1] ?? null;
  const prefixed = process.argv.find((value) => value.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : null;
}

const EFFORTS: ExtractionEffort[] = ["low", "medium", "high", "xhigh", "max"];
const PIPELINES = ["v3"] as const;
const EVAL_ROOT = path.join(os.homedir(), "dev", "localstack", "drawings-eval");

/** $ per million tokens, input / output. Cache writes are 1.25x input, reads 0.1x. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

function costOf(model: string, tokens: TokenUsage | null): number | null {
  const price = PRICES[model];
  if (!price || !tokens) return null;
  return (
    (tokens.inputTokens * price.input +
      tokens.cacheCreationInputTokens * price.input * 1.25 +
      tokens.cacheReadInputTokens * price.input * 0.1 +
      tokens.outputTokens * price.output) /
    1_000_000
  );
}

function usage(message: string): never {
  console.error(message);
  console.error(
    "usage: npm run eval:drawings -- --golden <dir> --files <dir> --model <id> --effort <level> --pipeline v3 --label <name> [--only <substr>] [--concurrency 3]\n" +
      "       npm run eval:drawings -- --golden <dir> --rescore <label> [--only <substr>]",
  );
  process.exit(2);
}

// ---- the golden ---------------------------------------------------------------

async function listFiles(dir: string, extension: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) out.push(...(await listFiles(full, extension, true)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) out.push(full);
  }
  return out.sort();
}

async function loadGoldens(dir: string | null): Promise<Map<string, GoldenDocument>> {
  const out = new Map<string, GoldenDocument>();
  if (!dir) return out;
  for (const file of await listFiles(dir, ".json", true)) {
    const golden = parseGolden(JSON.parse(await readFile(file, "utf8")), path.relative(dir, file));
    if (out.has(golden.file)) throw new Error(`Two golden files describe ${golden.file}.`);
    out.set(golden.file, golden);
  }
  return out;
}

// ---- one document ------------------------------------------------------------

type Saved = {
  file: string;
  label: string;
  pipeline: string;
  modelRequested: string;
  modelServed: string | null;
  effort: ExtractionEffort;
  ok: boolean;
  code: string | null;
  error: string | null;
  requestId: string | null;
  elapsedMs: number;
  usage: unknown;
  tokens: TokenUsage | null;
  savedAt: string;
  rawResponse: unknown;
};

type Outcome = {
  file: string;
  saved: Saved;
  read: DrawingRead | null;
  readError: string | null;
  score: DocumentScore | null;
};

function savedPath(label: string, file: string): string {
  return path.join(EVAL_ROOT, label, `${file}.json`);
}

function stageSaved(saved: Saved, goldens: Map<string, GoldenDocument>): Outcome {
  let read: DrawingRead | null = null;
  let readError: string | null = saved.ok ? null : `${saved.code}: ${saved.error}`;
  if (saved.rawResponse && typeof saved.rawResponse === "object") {
    const parsed = readExtractionResponse(saved.rawResponse as Parameters<typeof readExtractionResponse>[0], "shop_drawings");
    if (parsed.ok && parsed.output.outputKind === "drawing_items") {
      read = readFromModelOutput(parsed.output.data, saved.file);
      readError = null;
    } else if (!parsed.ok) {
      readError = `${parsed.code}: ${parsed.error}`;
    }
  }
  const golden = goldens.get(saved.file);
  return { file: saved.file, saved, read, readError, score: golden && read ? scoreDrawingRead(golden, read) : null };
}

async function readLive(
  pdf: string,
  options: { label: string; model: string; effort: ExtractionEffort; pipeline: string },
): Promise<Saved> {
  const file = path.basename(pdf);
  const startedAt = Date.now();
  let saved: Saved;
  try {
    const source = await prepareDocumentSource(await readFile(pdf), file, "application/pdf");
    const result = await extractSpecDocument(source, "shop_drawings", {
      model: options.model,
      effort: options.effort,
      promptVariant: options.pipeline,
    });
    saved = {
      file,
      label: options.label,
      pipeline: options.pipeline,
      modelRequested: options.model,
      modelServed: result.ok ? result.model : (result.model ?? null),
      effort: options.effort,
      ok: result.ok,
      code: result.ok ? null : result.code,
      error: result.ok ? null : result.error,
      requestId: result.requestId ?? null,
      elapsedMs: result.elapsedMs,
      usage: result.usage ?? null,
      tokens: tokenUsage(result.usage),
      savedAt: new Date().toISOString(),
      rawResponse: result.rawResponse ?? null,
    };
  } catch (cause) {
    saved = {
      file,
      label: options.label,
      pipeline: options.pipeline,
      modelRequested: options.model,
      modelServed: null,
      effort: options.effort,
      ok: false,
      code: "harness",
      error: cause instanceof Error ? cause.message : String(cause),
      requestId: null,
      elapsedMs: Date.now() - startedAt,
      usage: null,
      tokens: null,
      savedAt: new Date().toISOString(),
      rawResponse: null,
    };
  }
  await writeFile(savedPath(options.label, file), JSON.stringify(saved, null, 2));
  return saved;
}

async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- printing ----------------------------------------------------------------

const pad = (value: string, width: number) => (value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length));
const ratio = (a: number, b: number) => (b === 0 ? "-" : `${a}/${b}`);

function slotSummary(score: DocumentScore): string {
  let correct = 0;
  let scored = 0;
  let wrong = 0;
  let missing = 0;
  let extra = 0;
  for (const item of score.items) {
    for (const key of GOLDEN_SLOTS) {
      const outcome = item.slots[key].outcome;
      if (outcome === "absent_ok") continue;
      if (outcome !== "extra") scored += 1;
      if (outcome === "correct") correct += 1;
      else if (outcome === "missing" || outcome === "unconverted") missing += 1;
      else if (outcome === "extra") extra += 1;
      else wrong += 1;
    }
  }
  return `${correct}/${scored} ok ${wrong}w ${missing}m ${extra}x`;
}

function printTable(outcomes: Outcome[], modelForCost: (saved: Saved) => string): void {
  console.log(
    [
      pad("document", 38),
      pad("items g/r", 9),
      pad("group", 6),
      pad("slots", 22),
      pad("conf", 5),
      pad("finish", 7),
      pad("rows", 5),
      pad("in/out tok", 15),
      pad("sec", 6),
      pad("$", 6),
    ].join(" "),
  );
  for (const outcome of outcomes) {
    const { saved, read, score } = outcome;
    const tokens = saved.tokens;
    const cost = costOf(modelForCost(saved), tokens);
    const cells = score
      ? [
          `${score.items.length}/${read?.items.length ?? 0}`,
          ratio(score.items.filter((item) => item.groupingExact).length, score.items.length),
          slotSummary(score),
          ratio(score.items.filter((item) => item.configurations.namesExact).length, score.items.length),
          ratio(
            score.items.reduce((t, item) => t + item.finishes.found, 0),
            score.items.reduce((t, item) => t + item.finishes.golden, 0),
          ),
          String(score.items.reduce((t, item) => t + item.rowsToReview, 0)),
        ]
      : [`-/${read?.items.length ?? 0}`, "-", outcome.readError ? `FAILED ${outcome.readError}` : "unscored (no golden)", "-", "-", String(read?.items.reduce((t, item) => t + item.rowsToReview, 0) ?? "-")];
    console.log(
      [
        pad(outcome.file, 38),
        pad(cells[0]!, 9),
        pad(cells[1]!, 6),
        pad(cells[2]!, 22),
        pad(cells[3]!, 5),
        pad(cells[4]!, 7),
        pad(cells[5]!, 5),
        pad(tokens ? `${tokens.inputTokens}/${tokens.outputTokens}` : "-", 15),
        pad((saved.elapsedMs / 1000).toFixed(0), 6),
        pad(cost === null ? "-" : cost.toFixed(2), 6),
      ].join(" "),
    );
    if (score && process.argv.includes("--detail")) {
      for (const item of score.items) {
        const slots = GOLDEN_SLOTS.map((key) => `${key}:${item.slots[key].outcome}${item.slots[key].note ? ` (${item.slots[key].note})` : ""}`)
          .filter((text) => !text.includes("absent_ok"))
          .join("  ");
        console.log(`    ${item.goldenCodes.join("/")} -> ${item.matched.join(" + ") || "NOT FOUND"}  ${item.cell ?? ""}`);
        console.log(`      ${slots}`);
      }
      for (const extra of score.extraItems) console.log(`    extra item read: ${extra}`);
    }
  }
}

function printTotals(name: string, totals: ScoreTotals): void {
  if (totals.items === 0 && totals.documents === 0) return;
  const s = totals.slots;
  console.log(
    `${name}: ${totals.documents} documents, ${totals.items} items | grouping exact ${ratio(totals.groupingExact, totals.items)}` +
      ` | bill code resolved ${ratio(totals.billCodesResolved, totals.billCodes)}` +
      ` | slots correct ${s.correct}, wrong slot ${s.wrong_slot}, wrong value ${s.wrong_value}, unconverted ${s.unconverted}, missing ${s.missing}, extra ${s.extra}` +
      ` | configurations exact ${ratio(totals.configurationNamesExact, totals.items)}` +
      ` | finish codes ${ratio(totals.finishesFound, totals.finishesGolden)}` +
      ` | rows to review ${totals.rowsToReview} (${totals.rowsFlagged} flagged)` +
      ` | extra items ${totals.extraItems}`,
  );
}

// ---- main ----------------------------------------------------------------------

async function main(): Promise<void> {
  const goldenDir = arg("golden");
  const only = arg("only");
  const rescore = arg("rescore");
  const goldens = await loadGoldens(goldenDir);
  const matchesOnly = (file: string) => !only || file.toLowerCase().includes(only.toLowerCase());

  let outcomes: Outcome[];
  if (rescore) {
    const dir = path.join(EVAL_ROOT, rescore);
    if (!existsSync(dir)) usage(`Nothing saved under ${dir}.`);
    const files = (await listFiles(dir, ".json", false)).filter((file) => !path.basename(file).startsWith("_"));
    const saved: Saved[] = [];
    for (const file of files) saved.push(JSON.parse(await readFile(file, "utf8")) as Saved);
    outcomes = saved.filter((entry) => matchesOnly(entry.file)).map((entry) => stageSaved(entry, goldens));
    console.log(`Re-scored ${outcomes.length} saved responses from ${dir} with the current code. No API call.`);
  } else {
    const filesDir = arg("files") ?? usage("--files is required for a live run.");
    const label = arg("label") ?? usage("--label is required for a live run.");
    const pipeline = arg("pipeline") ?? "v3";
    if (!(PIPELINES as readonly string[]).includes(pipeline)) usage(`--pipeline must be one of: ${PIPELINES.join(", ")}.`);
    const model = arg("model") ?? EXTRACTION_MODEL;
    const effort = (arg("effort") ?? EXTRACTION_EFFORT) as ExtractionEffort;
    if (!EFFORTS.includes(effort)) usage(`--effort must be one of: ${EFFORTS.join(", ")}.`);
    const concurrency = Number(arg("concurrency") ?? 3);
    if (!process.env.ANTHROPIC_API_KEY) usage("ANTHROPIC_API_KEY is not set (npm run eval:drawings reads .env.localstack.local).");

    const pdfs = (await listFiles(filesDir, ".pdf", false)).filter((file) => matchesOnly(path.basename(file)));
    if (pdfs.length === 0) usage(`No PDFs in ${filesDir}${only ? ` matching "${only}"` : ""}.`);
    await mkdir(path.join(EVAL_ROOT, label), { recursive: true });
    console.log(
      `Reading ${pdfs.length} PDF(s) on ${model} at ${effort}, pipeline ${pipeline}, ${concurrency} at a time. ` +
        `Each is a CHARGED call. Saving to ${path.join(EVAL_ROOT, label)}.`,
    );
    const saved = await pool(pdfs, concurrency, async (pdf) => {
      const entry = await readLive(pdf, { label, model, effort, pipeline });
      console.log(`  ${entry.ok ? "read" : "FAILED"} ${entry.file} in ${(entry.elapsedMs / 1000).toFixed(0)}s${entry.ok ? "" : ` — ${entry.code}: ${entry.error}`}`);
      return entry;
    });
    outcomes = saved.map((entry) => stageSaved(entry, goldens));
    await writeFile(
      path.join(EVAL_ROOT, label, "_run.json"),
      JSON.stringify({ model, effort, pipeline, files: pdfs.map((pdf) => path.basename(pdf)), finishedAt: new Date().toISOString() }, null, 2),
    );
  }

  outcomes.sort((a, b) => a.file.localeCompare(b.file));
  console.log("");
  printTable(outcomes, (saved) => saved.modelServed ?? saved.modelRequested);

  const scores = outcomes.flatMap((outcome) => (outcome.score ? [outcome.score] : []));
  const totals = totalScores(scores);
  const tokens = outcomes.reduce(
    (sum, outcome) => {
      const t = outcome.saved.tokens;
      const cost = costOf(outcome.saved.modelServed ?? outcome.saved.modelRequested, t);
      return {
        input: sum.input + (t?.inputTokens ?? 0),
        output: sum.output + (t?.outputTokens ?? 0),
        cost: sum.cost + (cost ?? 0),
        seconds: sum.seconds + outcome.saved.elapsedMs / 1000,
      };
    },
    { input: 0, output: 0, cost: 0, seconds: 0 },
  );
  console.log("");
  printTotals("VERIFIED (the score)", totals.verified);
  printTotals("unverified drafts", totals.unverified);
  const unscored = outcomes.filter((outcome) => !outcome.score).length;
  console.log(
    `${outcomes.length} documents (${unscored} unscored) | ${tokens.input} input / ${tokens.output} output tokens | ` +
      `$${tokens.cost.toFixed(2)} estimated | ${tokens.seconds.toFixed(0)}s of model time` +
      (rescore ? " (as originally read)" : ""),
  );

  const label = rescore ?? arg("label");
  if (label) {
    await writeFile(
      path.join(EVAL_ROOT, label, rescore ? "_rescore.json" : "_scores.json"),
      JSON.stringify({ scoredAt: new Date().toISOString(), totals, scores }, null, 2),
    );
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
