#!/usr/bin/env tsx
// Where the app's reading of a document stops, measured against every document
// it has actually been given.
//
//   npm run vocab:gap
//   npm run vocab:gap -- --project=<projects.id>     one project's documents
//
// READ ONLY. No UPDATE, no INSERT, no DELETE, so there is no --apply and no
// --yes-production. It still prints the resolved host first, because
// `house/conventions.md` §3 is about knowing which database answered.
//
// ============================================================================
// WHY THIS EXISTS
//
// `requirement_aliases` has been empty since 0006 and "seed it from verified
// pilot wording" has sat in CLAUDE.md as an outstanding item ever since,
// with one measurement behind it: "attribute matching measured 1/7 on the M2
// sample". Seven observations, recorded as a sentence, no longer reproducible.
//
// Asked for on 2026-09-17 after the email pipeline learnt dimensions and
// finishes: "now do the aliases for the remaining questions". The answer turned
// out to be that there are none to seed, and that is a finding worth being able
// to re-run rather than a claim to take on trust — the corpus grows every time
// somebody uploads a document, and the day a chase reply lands is the day this
// changes.
//
// It reimplements NOTHING. `readDimension`, `readFinish` and `matchName` are
// the functions the resolver itself calls, in the order it calls them, so a
// label this reports as unplaced is one the review screen will show unplaced.
//
// ============================================================================
// THE THREE QUESTIONS IT ANSWERS
//
//   1. What do the documents actually say?      — the corpus
//   2. What can the app not place, and what      — the gap, and the DANGER
//      would it have wrongly placed it as?         list a looser rule creates
//   3. Is the matcher itself the problem?        — BWS's own vocabulary,
//                                                   matched against itself
//
// Question 3 is the control. If a document using BWS's own field name does not
// reach the question that asks for that field, the matcher is broken and no
// amount of vocabulary will fix it. If it does, then an unplaced label is a
// document saying something the cheat sheets do not ask — which is not a
// matching problem and must not be "fixed" with an alias.
// ============================================================================
import { sql } from "@/lib/db";
import { readDimension } from "@/lib/spec-dimensions";
import { readFinish } from "@/lib/spec-finishes";
import { matchName, scoreMatch, wordSet, type MatchCandidate } from "@/lib/matching";

// Kept in step with tools/dump-drawing-run.ts, which declares it the same way.
const DATABASE_ENVIRONMENTS = ["sandbox", "production"];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with: npm run vocab:gap   (reads .env.local)");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (!DATABASE_ENVIRONMENTS.includes(environment)) {
  console.error(`DATABASE_ENVIRONMENT must be one of: ${DATABASE_ENVIRONMENTS.join(", ")}.`);
  process.exit(1);
}
let host = "unknown host";
try {
  host = new URL(databaseUrl).host;
} catch {
  // A malformed URL fails at connect time with a better message than this one.
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})  [read only]\n`);

const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.slice("--project=".length) ?? null;

// ---- 1. the corpus ---------------------------------------------------------

type Observed = { label: string; value: string | null; where: string };

const runs = projectArg
  ? await sql`select document_kind, source_kind, parsed from intake_runs
              where project_id = ${projectArg} and parsed is not null`
  : await sql`select document_kind, source_kind, parsed from intake_runs where parsed is not null`;

const observed: Observed[] = [];
for (const run of runs) {
  const parsed = run.parsed as {
    lines?: { raw?: { attributeRaw?: string | null; valueRaw?: string | null } }[];
    items?: { observations?: { labelRaw?: string | null; valueRaw?: string | null; attrGroup?: string }[] }[];
  } | null;
  if (!parsed) continue;

  // A spec document (schedule, email, preamble) stages proposals…
  for (const line of parsed.lines ?? []) {
    if (line.raw?.attributeRaw) {
      observed.push({ label: line.raw.attributeRaw, value: line.raw.valueRaw ?? null, where: String(run.document_kind) });
    }
  }
  // …a drawing stages observations under items.
  for (const item of parsed.items ?? []) {
    for (const row of item.observations ?? []) {
      if (row.labelRaw) {
        observed.push({ label: row.labelRaw, value: row.valueRaw ?? null, where: `drawing:${row.attrGroup ?? "?"}` });
      }
    }
  }
}

const distinct = new Map<string, Observed>();
for (const row of observed) {
  const key = row.label.trim().toLowerCase();
  if (!distinct.has(key)) distinct.set(key, row);
}

// ---- the register, scoped the way the resolver scopes it -------------------

// Two statements rather than one with an interpolated fragment: a nested
// tagged template is not a value the driver can bind.
const categoryRows = projectArg
  ? await sql`select distinct category_id from spec_records
              where category_id is not null and project_id = ${projectArg}`
  : await sql`select distinct category_id from spec_records where category_id is not null`;
const categoryIds = categoryRows.map((row) => String(row.category_id));

const requirementRows = categoryIds.length
  ? await sql`
      select q.id, q.category_id, q.prompt, f.name as field_name
      from requirements q
      left join spec_fields f on f.id = q.spec_field_id
      where q.category_id = any(${categoryIds}::uuid[])
    `
  : [];

const allCandidates: MatchCandidate[] = requirementRows.flatMap((row) => {
  const out: MatchCandidate[] = [{ id: String(row.id), name: String(row.prompt) }];
  if (row.field_name) out.push({ id: String(row.id), name: String(row.field_name) });
  return out;
});

// ---- 2. what lands, and what does not --------------------------------------

type Route = "dimension" | "finish" | "question" | "unplaced";
const routed = new Map<Route, Observed[]>([
  ["dimension", []],
  ["finish", []],
  ["question", []],
  ["unplaced", []],
]);

// The resolver's own order: a dimension carries a slot, a finish carries a BWS
// field, and only what is neither is matched against a question.
for (const row of distinct.values()) {
  let route: Route = "unplaced";
  if (readDimension(row.label, row.value)) route = "dimension";
  else if (readFinish(row.label, row.value)) route = "finish";
  else if (matchName(row.label, allCandidates).status !== "none") route = "question";
  routed.get(route)?.push(row);
}

console.log(`CORPUS  ${observed.length} observations across ${runs.length} staged documents, ${distinct.size} distinct labels\n`);
for (const route of ["dimension", "finish", "question", "unplaced"] as Route[]) {
  console.log(`  ${String(routed.get(route)?.length ?? 0).padStart(4)}  ${route}`);
}

const unplaced = routed.get("unplaced") ?? [];
if (unplaced.length > 0) {
  console.log(`\nUNPLACED, by document kind\n`);
  for (const row of [...unplaced].sort((a, b) => a.where.localeCompare(b.where) || a.label.localeCompare(b.label))) {
    console.log(`  [${row.where.padEnd(18)}] ${row.label.slice(0, 44).padEnd(46)} ${(row.value ?? "").slice(0, 44).replace(/\s+/g, " ")}`);
  }
}

// ---- the DANGER list -------------------------------------------------------
//
// An unplaced label that ALMOST matched is the one somebody will reach for an
// alias to fix. Printing what it would have landed on is what stops them:
// decision 10 in docs/plans/README.md is that lowering the cutoff turns "no
// match" into "confidently wrong", and every row here is that trade in one line.

const near = unplaced
  .map((row) => {
    const words = wordSet(row.label);
    let best: { name: string; score: number } = { name: "", score: 0 };
    for (const candidate of allCandidates) {
      const score = scoreMatch(words, wordSet(candidate.name));
      if (score > best.score) best = { name: candidate.name, score };
    }
    return { ...row, ...best };
  })
  .filter((row) => row.score > 0)
  .sort((a, b) => b.score - a.score);

if (near.length > 0) {
  console.log(`\nNEAR MISSES — what a looser rule or an invented alias would write (cutoff ${0.8})\n`);
  for (const row of near) {
    console.log(`  ${row.score.toFixed(2)}  ${row.label.slice(0, 38).padEnd(40)} -> ${row.name.slice(0, 60)}`);
  }
  console.log(`\n  Read every line above before seeding anything. A row here is only an`);
  console.log(`  alias candidate if the arrow points at the question the document MEANT.`);
}

// ---- 3. the control: does the matcher understand BWS's own words? ----------

const byCategory = new Map<string, MatchCandidate[]>();
for (const row of requirementRows) {
  const list = byCategory.get(String(row.category_id)) ?? [];
  list.push({ id: String(row.id), name: String(row.prompt) });
  if (row.field_name) list.push({ id: String(row.id), name: String(row.field_name) });
  byCategory.set(String(row.category_id), list);
}

let placed = 0;
const control: string[] = [];
const withField = requirementRows.filter((row) => row.field_name);
for (const row of withField) {
  const result = matchName(String(row.field_name), byCategory.get(String(row.category_id)) ?? []);
  // The collapse `resolveProposals` applies: several TERMS pointing at ONE
  // requirement is agreement, not ambiguity.
  const ids =
    result.status === "confident" ? [result.id] : result.status === "ambiguous" ? [...new Set(result.candidates.map((c) => c.id))] : [];
  if (ids.length === 1 && ids[0] === String(row.id)) placed += 1;
  else control.push(`${String(row.field_name)}  ->  ${ids.length} candidates`);
}

console.log(`\nCONTROL — a document using BWS's OWN field name for a question`);
console.log(`  ${placed}/${withField.length} reach the question that asks for that field`);
for (const line of control.slice(0, 15)) console.log(`  unreached: ${line}`);
console.log(
  placed === withField.length
    ? `\n  The matcher is not the limit. An unplaced label is a document saying\n  something the cheat sheets do not ask — which an alias cannot fix.`
    : `\n  Some questions cannot be reached by their own BWS name. Fix that before\n  seeding vocabulary: an alias stacked on a broken match hides the cause.`,
);

process.exit(0);
