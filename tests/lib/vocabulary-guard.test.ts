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
import { CHANGE_SET_KIND_LABELS } from "@/lib/change-sets";
import { SPECS_SHEET_HEADER } from "@/lib/bws-export";
import { CHECK_SHEET_HEADER } from "@/lib/export-check-sheet";
import { CORE_FIELDS } from "@/lib/snapshot-diff";

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

/**
 * Parse a `.ts` file as TypeScript and only a `.tsx` file as TSX. Read as TSX,
 * a `.ts` file's angle-bracket cast or generic arrow (`<T>(rows) => …`) opens
 * a JSX element, and every literal after it went unread without an error: the
 * server scan below read six fewer refusals than the source holds until this
 * was found.
 */
function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
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
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, scriptKind(file));
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

  // THE NAMES `src/lib` PUTS IN FRONT OF A PERSON, held one by one.
  //
  // THE SCAN IS NOT WIDENED TO `src/lib`, AND THAT IS THE DECISION, NOT AN
  // OMISSION (re-taken 2026-09-22, when the versions diff was found labelling
  // a phase "Run"). `src/lib` is where the SQL, the error codes, the column
  // names and the change-set KINDS live, and every one of them says "run"
  // correctly and permanently: `spec_runs`, `run_id`, `runId` as the API word
  // and the query parameter every link written before the rename points at,
  // `intake_runs` -- a document READ, which was never a phase and whose
  // screens say "read" or "document". A scanner over that directory reports
  // hundreds of hits, of which the handful that matter would be found by
  // reading an allowlist nobody maintains; the guard's own header makes that
  // argument and it still holds. A pattern loose enough to miss those is loose
  // enough to miss the regression.
  //
  // So the rule here is: every `src/lib` collection a person READS is named in
  // this test, explicitly. Four of them now -- two workbook headings somebody
  // reads in Excel, the labels on the project's change trail, and the headings
  // on a record's version diff, which is where "Run" survived four days after
  // the rename because nothing was looking at it.
  //
  // ADDING A RENDERED NAME SET TO `src/lib` MEANS ADDING A LINE HERE. That is
  // the cost of not scanning, stated so the next person pays it deliberately.
  it("names a phase, not a run, in the trail and in the two long-form sheets", () => {
    const run = /\brun\b/i;
    const labels = Object.entries(CHANGE_SET_KIND_LABELS).filter(([, label]) => run.test(label));
    expect(labels, `Change-set LABELS say run; the keys (run_retire, run_create) stay: ${JSON.stringify(labels)}`).toEqual([]);
    expect(SPECS_SHEET_HEADER.filter((name) => run.test(name))).toEqual([]);
    expect(CHECK_SHEET_HEADER.filter((name) => run.test(name))).toEqual([]);
    // The keys are the schema's and must NOT have been renamed with the label.
    expect(CHANGE_SET_KIND_LABELS.run_retire).toBe("Phase retired");
    expect(CHANGE_SET_KIND_LABELS.run_create).toBe("Phase added by hand");
  });

  it("names a phase, not a run, on a record's version diff", () => {
    const run = /\brun\b/i;
    const offenders = CORE_FIELDS.filter((entry) => run.test(entry.label)).map((entry) => entry.label);
    expect(
      offenders,
      `A version diff's row headings are read by a person: ${offenders.join(", ")}`,
    ).toEqual([]);
    // The one that was wrong, named, so the fix cannot be undone by a rename
    // that happens to avoid the word.
    expect(CORE_FIELDS.find((entry) => entry.field === "runName")?.label).toBe("Phase");
    // AND THE KEY IS UNTOUCHED. `field` names the atom it reads off
    // `RecordAtoms` and is the diff row's React key; nobody reads it, and
    // renaming it beside the label is how the two halves of this rule get
    // confused with each other.
    expect(CORE_FIELDS.some((entry) => entry.field === "runName")).toBe(true);
  });

  it("reads the screens it claims to read", () => {
    // A guard that silently scanned nothing would pass for ever. The two
    // directories together are ~60 files; the floor only has to be non-trivial.
    const files = DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(40);
  });
});

// ============================================================================
// THE SENTENCES THE SERVER SENDS A PERSON (audit 2026-11-06, G15).
//
// The screens print a refused request's `error` verbatim, so the second
// argument of every `DomainConflictError` and the `error` / `message` of every
// `json({...})` body under `src/lib` and `src/app/api` is screen text that
// happens to be written on the server. Four days after the rename, three of
// them still said "run" ("not marked as revising a run", "choose which runs
// this drawing applies to"), ten printed a raw status word nobody chose ("This
// import is parsing, not open for editing"), and fifteen told a reviewer the
// row was "edited in another tab" when the only other writer was usually their
// own autosave.
//
// This does NOT re-open the decision above not to scan `src/lib` whole. It
// reads only the literals INSIDE those two places — the SQL, the codes, the
// column names and `intake_runs` are never in them — so the allowlist that
// argument predicted does not appear. What it cannot see, stated: a message
// built into a variable first and passed by name, and a refusal thrown as a
// plain `Error` that a route turns into a sentence. Both are rarer than a
// literal and both are the next place to look if "run" comes back.
//
// BOTH BLIND SPOTS ARE NOW READ (audit 5.4 A8): a message passed by NAME is
// followed to a `const` with a literal initialiser in the same file, and a
// `new Error(...)` under `src/app/api` is read as a refusal, because a route's
// catch turns its message into the `error` a screen prints. What is still not
// seen: a message built from parts at run time (a `let`, a function's return).
// ============================================================================

const SERVER_DIRS = ["src/lib", "src/app/api"];

/**
 * Files whose "import" sentences wait on another coder (5.3 is splitting this
 * route into handlers on the same day). Each entry is a debt, not a rule.
 */
const IMPORT_WORD_PENDING = new Set([path.join("src", "app", "api", "imports", "[id]", "route.ts")]);

/**
 * The helpers that turn a status into words a person chose. A template span
 * calling one of these is the fix, never an offence.
 */
const STATUS_WORD_HELPERS = new Set(["documentStateWords", "documentNextStep", "reviewedWord", "draftStateWords"]);

/**
 * The two refusals that NAME the writer, from the row's own `updated_by`, and
 * say "someone else" only where the row holds no name. They are telling the
 * truth about who; exact text, as the scanner joins it.
 */
const NAMES_THE_WRITER = new Set([
  "… was changed by … someone else … while you were editing. Reload and try again.",
  "This project was changed by … someone else … while you were editing. Reload and try again.",
]);

type ServerMessage = { file: string; line: number; text: string; statusSpans: string[] };

function serverMessages(file: string): ServerMessage[] {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, scriptKind(file));
  const found: ServerMessage[] = [];
  const collect = (root: ts.Node) => {
    const texts: string[] = [];
    const statusSpans: string[] = [];
    const walk = (node: ts.Node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        texts.push(node.text);
      }
      if (ts.isTemplateSpan(node)) {
        const expression = node.expression;
        const helper =
          ts.isCallExpression(expression) && STATUS_WORD_HELPERS.has(expression.expression.getText(sf));
        // `run.status`, `entry.reviewStatus`, `String(draft.status)`, a bare
        // `status` -- a value the database holds, printed as though a person
        // had chosen the word.
        if (!helper && /status/i.test(expression.getText(sf))) statusSpans.push(expression.getText(sf));
      }
      ts.forEachChild(node, walk);
    };
    walk(root);
    const { line } = sf.getLineAndCharacterOfPosition(root.getStart(sf));
    found.push({ file: path.relative(ROOT, file), line: line + 1, text: texts.join(" … ").replace(/\s+/g, " ").trim(), statusSpans });
  };
  // `const MESSAGE = "...";` anywhere in the file, for a message passed by name.
  const constants = new Map<string, ts.Expression>();
  const gather = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer) || ts.isTemplateExpression(node.initializer))
    ) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, gather);
  };
  gather(sf);
  const message = (node: ts.Expression) => (ts.isIdentifier(node) && constants.has(node.text) ? constants.get(node.text)! : node);
  const inRoute = path.relative(ROOT, file).startsWith(path.join("src", "app", "api"));
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && node.expression.getText(sf) === "DomainConflictError" && node.arguments?.[1]) {
      collect(message(node.arguments[1]));
    }
    if (inRoute && ts.isNewExpression(node) && node.expression.getText(sf) === "Error" && node.arguments?.[0]) {
      collect(message(node.arguments[0]));
    }
    if (
      ts.isPropertyAssignment(node) &&
      ["error", "message"].includes(node.name.getText(sf)) &&
      ts.isObjectLiteralExpression(node.parent) &&
      ts.isCallExpression(node.parent.parent) &&
      /(^|\.)json$/.test(node.parent.parent.expression.getText(sf))
    ) {
      collect(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const SERVER_MESSAGES = SERVER_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).sort().flatMap(serverMessages);
const where = (hit: ServerMessage) => `  ${hit.file}:${hit.line}  ${JSON.stringify(hit.text)}`;

describe("server vocabulary: what a refused request says to a person", () => {
  it("says phase, never run", () => {
    const offenders = SERVER_MESSAGES.filter((hit) => RUN_WORD.test(hit.text));
    expect(
      offenders.map(where),
      `A refusal's sentence is screen text. A sub-quote is a PHASE; a document read is a "read" or a "document":\n${offenders.map(where).join("\n")}`,
    ).toEqual([]);
  });

  it("says document or bill, never import (audit 5.4 A8)", () => {
    // "No such import." and "This import changed" were the database's word for
    // an intake run, printed to a person who had uploaded a DOCUMENT. The
    // split route is listed until its owner takes the one-line change.
    const offenders = SERVER_MESSAGES.filter(
      // "A BWS import" is BWS's own word for loading the export, and right.
      (hit) => /\bimports?\b/i.test(hit.text.replace(/\bBWS import/g, "")) && !IMPORT_WORD_PENDING.has(hit.file),
    );
    expect(offenders.map(where), `Say "document" or "bill" (src/lib/intake-status.ts):\n${offenders.map(where).join("\n")}`).toEqual([]);
  });

  it("never blames another tab, or a person, it cannot see", () => {
    // The sentence knows only that the version moved since this screen loaded.
    // Usually the other writer was the reviewer's own autosave or a second
    // screen of their own; "another tab" sent people looking for a tab that did
    // not exist, and "someone else" accused a colleague who was not there.
    const offenders = SERVER_MESSAGES.filter(
      (hit) => /another tab|someone else|somebody else/i.test(hit.text) && !NAMES_THE_WRITER.has(hit.text),
    );
    expect(offenders.map(where), `Say "changed since this screen loaded":\n${offenders.map(where).join("\n")}`).toEqual([]);
  });

  it("keeps no named-writer exception that has stopped matching", () => {
    const seen = new Set(SERVER_MESSAGES.map((hit) => hit.text));
    expect([...NAMES_THE_WRITER].filter((text) => !seen.has(text))).toEqual([]);
  });

  it("never prints a status word nobody chose", () => {
    // "This import is parsing" is the database talking. A status goes through
    // one of STATUS_WORD_HELPERS, which name the state and the next step.
    const offenders = SERVER_MESSAGES.filter((hit) => hit.statusSpans.length > 0);
    const report = offenders.map((hit) => `${where(hit)}  {${hit.statusSpans.join(", ")}}`).join("\n");
    expect(offenders.map(where), `Print a status through a word helper in src/lib/intake-status.ts or src/lib/draft-status.ts:\n${report}`).toEqual([]);
  });

  it("reads the refusals it claims to read", () => {
    // ~430 DomainConflictError sites when this was written. A floor, so a
    // scanner that silently matched nothing cannot pass for ever.
    expect(SERVER_MESSAGES.length).toBeGreaterThan(400);
  });
});
