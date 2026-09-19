// A sub-quote is a PHASE on every screen, because that is the BWS word.
//
// Matthew, 2026-09-18: "Can we change run to phase? Because that matches BWS."
// The rename landed in one pass, because a half-renamed vocabulary reads as two
// concepts rather than one. Nothing in the compiler can hold it afterwards: the
// TABLE is still `spec_runs`, the column is still `run_id`, the API word is
// still `runId` and every link written before today points at `?tab=<runId>` —
// so `run` stays correct in code and is wrong in text, and a type cannot tell
// the two apart. That is what this test is for, and it is the `tone.test.ts`
// pattern: a rule the compiler cannot hold, held by a test that reads source.
//
// It reads `src/components/**` and `src/app/dashboard/**` with the TypeScript
// parser rather than a regex over lines, because the two halves it has to
// separate — a string a person reads and a string the machine reads — are a
// syntax question. What counts as user-facing here:
//
//   - every JSX text node
//   - every string and template literal, EXCEPT a literal type (`"item" |
//     "run"`), a module specifier, a property KEY, a path (`/api/…/runs`), and
//     a single bare word passed as a call argument (`setBulkUnit("run", unit)`)
//
// The last exclusion is the one with a cost: a one-word label passed straight
// into a function — `setError("Run")` — would not be seen. It buys the
// separation of the four internal `scope: "item" | "run"` call sites from
// prose, and a one-word label is not how this app writes one. Everything else
// a reviewer would read on screen is in scope, including a ternary's two
// halves (`runsWritten === 1 ? "run" : "runs"`), which is where three of the
// original hits were hiding.
//
// A false positive is ALLOWLISTED with its reason, never fixed by loosening
// the pattern — a pattern loose enough to miss the exception is loose enough to
// miss the regression. The second test fails when an allowlist entry no longer
// matches anything, so the list cannot rot.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIRS = ["src/components", "src/app/dashboard"];

/** `run`, `Run`, `runs`, `RUN` — as a whole word, not inside `runId` or `run-name`. */
const RUN_WORD = /(?<![\w-])runs?(?![\w-])/i;

/**
 * The strings that say "run" on purpose. Each is the exact text as the scanner
 * reads it, whitespace collapsed.
 */
const ALLOWED: { text: string; why: string }[] = [
  {
    text: "npm run db:backfill-finishes -- --apply",
    why: "A shell command printed for a person to copy. `npm run` is npm's word, not ours.",
  },
  {
    text: "MAIN RUN",
    why: "The placeholder on Add a phase: a real tab name off the pilot's own bill (MUR, MAIN RUN). It is an example of what a client wrote, not our vocabulary for it.",
  },
];

type Hit = { file: string; line: number; text: string };

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Is this literal something a person reads, or something the machine reads? */
function isUserFacingLiteral(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isLiteralTypeNode(parent)) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node) return false;
  if (ts.isCallExpression(parent) && parent.arguments.includes(node) && !/\s/.test(node.text)) return false;
  if (/^[./]|:\/\//.test(node.text)) return false;
  return true;
}

function userFacingText(file: string): Hit[] {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: Hit[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isJsxText(node)) text = node.text;
    else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (isUserFacingLiteral(node as ts.StringLiteralLike)) text = node.text;
    }
    if (text && RUN_WORD.test(text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      hits.push({ file: path.relative(ROOT, file), line: line + 1, text: text.replace(/\s+/g, " ").trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const ALL_HITS = DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).sort().flatMap(userFacingText);

describe("screen vocabulary: a sub-quote is a phase", () => {
  it("says phase, never run, in anything a person reads", () => {
    const allowed = new Set(ALLOWED.map((entry) => entry.text));
    const offenders = ALL_HITS.filter((hit) => !allowed.has(hit.text));
    // Named file, line and string, so the next person fixes it in a minute.
    const report = offenders.map((hit) => `  ${hit.file}:${hit.line}  ${JSON.stringify(hit.text)}`).join("\n");
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `A sub-quote is a PHASE on screen (BWS's word). Rename the text, or add it to ALLOWED in this file with the reason it is not a phase — an intake run is a DOCUMENT READ, and the word for that is "read" or "document", never "phase":\n${report}`,
    ).toEqual([]);
  });

  it("keeps no allowlist entry that has stopped matching anything", () => {
    const seen = new Set(ALL_HITS.map((hit) => hit.text));
    const stale = ALLOWED.filter((entry) => !seen.has(entry.text)).map((entry) => entry.text);
    expect(stale, `Allowlisted strings no longer in the source — delete them: ${stale.join(", ")}`).toEqual([]);
  });

  it("reads the screens it claims to read", () => {
    // A guard that silently scanned nothing would pass for ever. The two
    // directories together are ~60 files; the floor only has to be non-trivial.
    const files = DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(40);
  });
});
