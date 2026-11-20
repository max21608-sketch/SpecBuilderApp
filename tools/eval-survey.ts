#!/usr/bin/env tsx
// Score the pack survey against an answer key, with no database, queue or blob store.
//
//   npm run eval:survey -- --golden <key.json | dir> --files <dir> --label <name> \
//       [--only <substr>] [--concurrency 3] [--min-iou 0.8] [--detail]
//   npm run eval:survey -- --golden <key.json | dir> --rescore <label> [--only <substr>] [--min-iou 0.8] [--detail]
//
// ============================================================================
// A LIVE RUN SPENDS MONEY: one charged call per file in --files, on the
// file-check model (`CLASSIFY_MODEL`, Haiku 5.5) — cents a file, a few cents
// a pack. Nothing asks first. Narrow it with --only.
//
// It calls `surveyFile` itself — the app's own request, prompt and checks —
// on the `DocumentSource` the upload builds (`prepareDocumentSource`), with
// the page count taken the way the classify route takes it (off the bytes,
// and pdfjs where the page tree is compressed, which is what the upload
// screen's own hint is). It SAVES the whole response, the `SurveyFile`, the
// file's shape, usage and timing to `~/dev/localstack/survey-eval/<label>/`,
// OUTSIDE the repo: a survey of a real pack quotes its codes and its title
// blocks, and never enters a commit.
//
// `--rescore <label>` re-reads every saved response with TODAY'S code and no
// API call — `surveyFromResponse`, the path a live call takes after its answer,
// so every exact decision the survey's code makes (dropped ranges, merged
// neighbours, cut codes) is today's — then groups with today's `groupPack` and
// scores with today's scorer. A response cut off at the token ceiling stays
// refused, as `surveyFile` refuses it: a re-score measures code over the same
// answers, never a partial answer the live path would not have used.
//
// The score is `tools/survey-golden.ts` (it says what is counted and why).
// Files with no key are read and listed, but not scored. Only VERIFIED keys
// are the score; drafts are totalled beside them.
// ============================================================================
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { tokenUsage, type TokenUsage } from "../src/lib/anthropic";
import { CLASSIFY_MODEL } from "../src/lib/document-classify";
import { countPdfPages, prepareDocumentSource, type DocumentSource } from "../src/lib/intake-source";
import { groupPack, surveyFile, surveyFromResponse, surveyShape, type SurveyFileShape } from "../src/lib/pack-survey";
import type { SurveyFile, SurveyGolden } from "../src/lib/pack-survey-types";
import {
  DEFAULT_MIN_IOU,
  describePlace,
  parseGolden,
  scoreSurvey,
  totalSurveyScores,
  type PackScore,
  type SurveyTotals,
} from "./survey-golden";

// ---- arguments ---------------------------------------------------------------

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1] ?? null;
  const prefixed = process.argv.find((value) => value.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : null;
}

function usage(message: string): never {
  console.error(message);
  console.error(
    "usage: npm run eval:survey -- --golden <key.json|dir> --files <dir> --label <name> [--only <substr>] [--concurrency 3] [--min-iou 0.8] [--detail]\n" +
      "       npm run eval:survey -- --golden <key.json|dir> --rescore <label> [--only <substr>] [--min-iou 0.8] [--detail]",
  );
  process.exit(2);
}

const EVAL_ROOT = path.join(os.homedir(), "dev", "localstack", "survey-eval");
/** What the upload takes. A .msg is not here for the reason `intakeSourceKind` gives. */
const SURVEYED_EXTENSIONS = [".pdf", ".xlsx", ".csv", ".tsv", ".eml"];

// ---- cost --------------------------------------------------------------------

type Rate = { input: number; output: number };
/**
 * $ per million tokens. Haiku 5.5 is priced by the size of the PROMPT: a
 * request whose input (cache reads and writes included) is over the threshold
 * pays the higher rate on all of it. Cache writes are 1.25x input, reads 0.1x.
 */
const PRICES: Record<string, { threshold: number; below: Rate; above: Rate }> = {
  "claude-haiku-5-5": { threshold: 100_000, below: { input: 0.1, output: 0.5 }, above: { input: 0.5, output: 2.5 } },
};

function costOf(model: string | null, tokens: TokenUsage | null): number | null {
  if (!model || !tokens) return null;
  const price = Object.entries(PRICES).find(([id]) => model === id || model.startsWith(`${id}-`))?.[1];
  if (!price) return null;
  const prompt = tokens.inputTokens + tokens.cacheCreationInputTokens + tokens.cacheReadInputTokens;
  const rate = prompt > price.threshold ? price.above : price.below;
  return (
    (tokens.inputTokens * rate.input +
      tokens.cacheCreationInputTokens * rate.input * 1.25 +
      tokens.cacheReadInputTokens * rate.input * 0.1 +
      tokens.outputTokens * rate.output) /
    1_000_000
  );
}

// ---- the keys ------------------------------------------------------------------

async function listFiles(dir: string, extensions: string[], recursive: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) out.push(...(await listFiles(full, extensions, true)));
    else if (entry.isFile() && extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))) out.push(full);
  }
  return out.sort();
}

/** One key file, or every key in a directory. A file two keys both claim is an error. */
async function loadKeys(target: string | null): Promise<SurveyGolden[]> {
  if (!target) return [];
  const paths = (await stat(target)).isDirectory() ? await listFiles(target, [".json"], true) : [target];
  const keys: SurveyGolden[] = [];
  const owner = new Map<string, string>();
  for (const file of paths) {
    const key = parseGolden(JSON.parse(await readFile(file, "utf8")), path.basename(file));
    for (const entry of key.files) {
      const claimed = owner.get(entry.file);
      if (claimed) throw new Error(`${entry.file} is in two keys: ${claimed} and ${key.pack}.`);
      owner.set(entry.file, key.pack);
    }
    keys.push(key);
  }
  return keys;
}

// ---- one file ------------------------------------------------------------------

/** The file's shape as `surveyShape` gave it, its sheet rows as an object so it survives JSON. */
type SavedShape = Omit<SurveyFileShape, "sheetRows"> & { sheetRows: Record<string, number> | null };

type Saved = {
  file: string;
  label: string;
  modelRequested: string;
  /** The model that answered, where anything did. */
  model: string | null;
  ok: boolean;
  code: string | null;
  error: string | null;
  charged: boolean;
  /** What code judged the answer against, so `--rescore` gives `surveyFromResponse` the same file. */
  shape: SavedShape | null;
  elapsedMs: number;
  usage: unknown;
  tokens: TokenUsage | null;
  savedAt: string;
  survey: SurveyFile | null;
  /** The whole response as the model gave it; null where the model was never reached. */
  response: unknown;
};

/**
 * The page count the classify route would have: the server's own count off
 * the page tree, then pdfjs (the upload screen's hint is pdfjs in the
 * browser). Null where neither can say — never guessed.
 */
async function pageCountOf(bytes: Buffer): Promise<number | null> {
  const counted = countPdfPages(bytes);
  if (counted !== null) return counted;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const holder = globalThis as unknown as { pdfjsWorker?: unknown };
    if (!holder.pdfjsWorker) holder.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
      .promise;
    try {
      return doc.numPages;
    } finally {
      await doc.destroy();
    }
  } catch {
    return null;
  }
}

function savedPath(label: string, file: string): string {
  return path.join(EVAL_ROOT, label, `${file}.json`);
}

async function surveyLive(fullPath: string, label: string): Promise<Saved> {
  const file = path.basename(fullPath);
  const startedAt = Date.now();
  let saved: Saved;
  let shape: SavedShape | null = null;
  try {
    const bytes = await readFile(fullPath);
    const source: DocumentSource = await prepareDocumentSource(bytes, file, "");
    const pageCount = source.type === "pdf" ? await pageCountOf(bytes) : null;
    const judged = surveyShape(source, { pageCount });
    shape = { ...judged, sheetRows: judged.sheetRows ? Object.fromEntries(judged.sheetRows) : null };
    const result = await surveyFile(source, { filename: file, pageCount });
    // A charged failure carries its usage too: it was paid for.
    const usageSeen = result.usage ?? null;
    saved = {
      file,
      label,
      modelRequested: CLASSIFY_MODEL,
      model: result.model,
      ok: result.ok,
      code: result.ok ? null : result.code,
      error: result.ok ? null : result.error,
      charged: result.ok ? true : result.charged,
      shape,
      elapsedMs: Date.now() - startedAt,
      usage: usageSeen,
      tokens: tokenUsage(usageSeen),
      savedAt: new Date().toISOString(),
      survey: result.ok ? result.survey : null,
      response: result.response ?? null,
    };
  } catch (cause) {
    saved = {
      file,
      label,
      modelRequested: CLASSIFY_MODEL,
      model: null,
      ok: false,
      code: "harness",
      error: cause instanceof Error ? cause.message : String(cause),
      charged: false,
      shape,
      elapsedMs: Date.now() - startedAt,
      usage: null,
      tokens: null,
      savedAt: new Date().toISOString(),
      survey: null,
      response: null,
    };
  }
  await writeFile(savedPath(label, file), JSON.stringify(saved, null, 2));
  return saved;
}

/**
 * A saved response read again with TODAY'S code (`surveyFromResponse`), or
 * the saved entry unchanged where there is nothing to re-read: no response
 * (the model was never reached), no shape, or a response cut off at the token
 * ceiling, which `surveyFile` refuses live and so is refused here too.
 */
function resurvey(entry: Saved): { entry: Saved; reread: boolean } {
  const response = entry.response as { content?: unknown[]; stop_reason?: unknown } | null;
  if (!response || typeof response !== "object" || !entry.shape) return { entry, reread: false };
  if (response.stop_reason === "max_tokens") return { entry, reread: false };
  const shape = { ...entry.shape, sheetRows: entry.shape.sheetRows ? new Map(Object.entries(entry.shape.sheetRows)) : null };
  const read = surveyFromResponse(response, { filename: entry.file, ...shape });
  return {
    entry: read.ok
      ? { ...entry, ok: true, code: null, error: null, survey: read.survey }
      : { ...entry, ok: false, code: "failed", error: read.error, survey: null },
    reread: true,
  };
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

// ---- printing ------------------------------------------------------------------

const pad = (value: string, width: number) => (value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length));
const ratio = (a: number, b: number) => (b === 0 ? "-" : `${a}/${b}`);

function printPack(score: PackScore, savedByFile: Map<string, Saved>, detail: boolean, lacks: string[]): void {
  console.log(`\n${score.pack} (${score.verified ? "VERIFIED" : "draft key"})`);
  console.log(
    [
      pad("file", 44),
      pad("exp", 4),
      pad("found", 6),
      pad("held", 5),
      pad("wrong", 6),
      pad("bnd", 4),
      pad("miss", 5),
      pad("extra", 6),
      pad("pgErr", 6),
      pad("items", 8),
      pad("finish", 8),
      pad("sec", 5),
      pad("$", 7),
    ].join(" "),
  );
  for (const file of score.files) {
    const saved = savedByFile.get(file.file);
    const cost = saved ? costOf(saved.model ?? saved.modelRequested, saved.tokens) : null;
    const c = file.counts;
    console.log(
      [
        pad(file.file, 44),
        pad(String(c.expected), 4),
        pad(String(c.found), 6),
        pad(String(c.held), 5),
        pad(String(c.wrong_kind), 6),
        pad(String(c.boundary), 4),
        pad(String(c.missed), 5),
        pad(String(c.extra), 6),
        pad(String(file.pageError), 6),
        pad(ratio(file.itemCodes.found, file.itemCodes.expected), 8),
        pad(ratio(file.finishCodes.found, file.finishCodes.expected), 8),
        pad(saved ? (saved.elapsedMs / 1000).toFixed(0) : "-", 5),
        pad(cost === null ? "-" : cost.toFixed(4), 7),
      ].join(" "),
    );
    if (!file.surveyed && saved) console.log(`    FAILED ${saved.code}: ${saved.error}`);
    if (detail) {
      for (const part of file.parts) {
        const codes = `items ${ratio(part.itemCodes.found, part.itemCodes.expected)}${part.itemCodes.missing.length ? ` (missing ${part.itemCodes.missing.join(", ")})` : ""}` +
          ` finishes ${ratio(part.finishCodes.found, part.finishCodes.expected)}${part.finishCodes.missing.length ? ` (missing ${part.finishCodes.missing.join(", ")})` : ""}`;
        console.log(`    ${pad(describePlace(part.place), 22)} ${pad(part.genre, 22)} -> ${part.outcome}${part.note ? ` (${part.note})` : ""}  ${codes}`);
      }
      for (const extra of file.extraParts) {
        console.log(`    extra: ${describePlace(extra.place)} ${extra.genre}${extra.held ? " (held)" : ""}`);
      }
      for (const place of file.skipped) console.log(`    nothing to read: ${describePlace(place)}`);
      const survey = saved?.survey;
      if (survey?.note) console.log(`    survey note: ${survey.note}`);
    }
  }
  console.log(
    `  items linked to files ${ratio(score.items.found, score.items.expected)}` +
      (score.items.extra.length ? `, ${score.items.extra.length} links the key does not make` : ""),
  );
  if (detail) {
    for (const link of score.items.missing) console.log(`    not linked: ${link.code} -> ${link.file}`);
    for (const link of score.items.extra) console.log(`    extra link: ${link.code} -> ${link.file}`);
  }
  if (lacks.length) console.log(`  the pack pass says it lacks: ${lacks.join(" | ")}`);
  if (score.notSurveyed.length) console.log(`  not in this run (not counted): ${score.notSurveyed.join(", ")}`);
}

function printTotals(name: string, totals: SurveyTotals): void {
  if (totals.packs === 0) return;
  const p = totals.parts;
  console.log(
    `${name}: ${totals.packs} pack(s), ${totals.files} files (${totals.failedFiles} failed) | parts ${p.expected}: ` +
      `found ${p.found}, held ${p.held}, wrong kind ${p.wrong_kind}, boundary ${p.boundary}, missed ${p.missed}, extra ${p.extra}` +
      ` | page boundary error ${totals.pageError}` +
      (totals.skipped ? ` | ${totals.skipped} set aside as nothing to read` : "") +
      ` | item codes ${ratio(totals.itemCodes.found, totals.itemCodes.expected)} (+${totals.itemCodes.extra})` +
      ` | finish codes ${ratio(totals.finishCodes.found, totals.finishCodes.expected)} (+${totals.finishCodes.extra})` +
      ` | item links ${ratio(totals.links.found, totals.links.expected)} (+${totals.links.extra})`,
  );
}

// ---- main ----------------------------------------------------------------------

async function main(): Promise<void> {
  const only = arg("only");
  const rescore = arg("rescore");
  const detail = process.argv.includes("--detail");
  const minIoU = Number(arg("min-iou") ?? DEFAULT_MIN_IOU);
  if (!(minIoU > 0 && minIoU <= 1)) usage("--min-iou must be a number above 0 and at most 1.");
  const keys = await loadKeys(arg("golden"));
  const matchesOnly = (file: string) => !only || file.toLowerCase().includes(only.toLowerCase());

  let saved: Saved[];
  let label: string;
  if (rescore) {
    label = rescore;
    const dir = path.join(EVAL_ROOT, rescore);
    if (!existsSync(dir)) usage(`Nothing saved under ${dir}.`);
    const files = (await listFiles(dir, [".json"], false)).filter((file) => !path.basename(file).startsWith("_"));
    saved = [];
    for (const file of files) saved.push(JSON.parse(await readFile(file, "utf8")) as Saved);
    saved = saved.filter((entry) => matchesOnly(entry.file));
    let reread = 0;
    saved = saved.map((entry) => {
      const again = resurvey(entry);
      if (again.reread) reread += 1;
      return again.entry;
    });
    console.log(
      `Re-scored ${saved.length} saved surveys from ${dir} with the current code (${reread} responses re-read through surveyFromResponse). No API call.`,
    );
  } else {
    const filesDir = arg("files") ?? usage("--files is required for a live run.");
    label = arg("label") ?? usage("--label is required for a live run.");
    const concurrency = Number(arg("concurrency") ?? 3);
    if (!Number.isInteger(concurrency) || concurrency < 1) usage("--concurrency must be a whole number of at least 1.");
    if (!process.env.ANTHROPIC_API_KEY) usage("ANTHROPIC_API_KEY is not set (npm run eval:survey reads .env.localstack.local).");

    const paths = (await listFiles(filesDir, SURVEYED_EXTENSIONS, false)).filter((file) => matchesOnly(path.basename(file)));
    if (paths.length === 0) usage(`No surveyable files in ${filesDir}${only ? ` matching "${only}"` : ""}.`);
    await mkdir(path.join(EVAL_ROOT, label), { recursive: true });
    console.log(
      `Surveying ${paths.length} file(s) on ${CLASSIFY_MODEL}, ${concurrency} at a time. ` +
        `Each is a CHARGED call. Saving to ${path.join(EVAL_ROOT, label)}.`,
    );
    saved = await pool(paths, concurrency, async (fullPath) => {
      const entry = await surveyLive(fullPath, label);
      console.log(
        `  ${entry.ok ? "surveyed" : "FAILED"} ${entry.file} in ${(entry.elapsedMs / 1000).toFixed(1)}s` +
          (entry.ok ? `, ${entry.survey?.parts.length ?? 0} part(s)` : ` — ${entry.code}: ${entry.error}`),
      );
      return entry;
    });
    await writeFile(
      path.join(EVAL_ROOT, label, "_run.json"),
      JSON.stringify({ model: CLASSIFY_MODEL, files: paths.map((file) => path.basename(file)), minIoU, finishedAt: new Date().toISOString() }, null, 2),
    );
  }

  const savedByFile = new Map(saved.map((entry) => [entry.file, entry]));
  const scores: PackScore[] = [];
  const keyed = new Set<string>();
  for (const key of keys) {
    const inPack = new Set(key.files.map((entry) => entry.file));
    key.files.forEach((entry) => keyed.add(entry.file));
    const mine = saved.filter((entry) => inPack.has(entry.file));
    const results = mine.flatMap((entry) => (entry.survey ? [entry.survey] : []));
    const grouping = groupPack(results);
    const score = scoreSurvey(key, results, grouping, { minIoU, failed: mine.filter((entry) => !entry.survey).map((entry) => entry.file) });
    if (score.files.length === 0) continue;
    scores.push(score);
    printPack(score, savedByFile, detail, grouping.lacks);
  }

  const unkeyed = saved.filter((entry) => !keyed.has(entry.file));
  if (unkeyed.length) {
    console.log("\nNo key (read, not scored):");
    for (const entry of unkeyed) {
      const parts = entry.survey?.parts.map((part) => `${describePlace(part.place)} ${part.genre}${part.certain ? "" : "?"}`).join("; ");
      console.log(`  ${entry.file}: ${entry.ok ? parts || "no parts" : `FAILED ${entry.code}: ${entry.error}`}`);
    }
  }

  const totals = totalSurveyScores(scores);
  const spend = saved.reduce(
    (sum, entry) => ({
      input: sum.input + (entry.tokens ? entry.tokens.inputTokens + entry.tokens.cacheCreationInputTokens + entry.tokens.cacheReadInputTokens : 0),
      output: sum.output + (entry.tokens?.outputTokens ?? 0),
      cost: sum.cost + (costOf(entry.model ?? entry.modelRequested, entry.tokens) ?? 0),
      seconds: sum.seconds + entry.elapsedMs / 1000,
    }),
    { input: 0, output: 0, cost: 0, seconds: 0 },
  );
  console.log("");
  printTotals("VERIFIED (the score)", totals.verified);
  printTotals("draft keys", totals.unverified);
  console.log(
    `${saved.length} files (${saved.filter((entry) => !entry.ok).length} failed, ${unkeyed.length} with no key) | ` +
      `${spend.input} input / ${spend.output} output tokens | $${spend.cost.toFixed(4)} estimated | ${spend.seconds.toFixed(0)}s of model time` +
      (rescore ? " (as originally surveyed)" : ""),
  );

  await writeFile(
    path.join(EVAL_ROOT, label, rescore ? "_rescore.json" : "_scores.json"),
    JSON.stringify({ scoredAt: new Date().toISOString(), minIoU, totals, scores }, null, 2),
  );
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
