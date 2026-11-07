// Pure tier: the chase's two question loaders share ONE select list and read
// a record's facts once per RECORD, never once per question (audit F13, 5.4 A2).
//
// `loadOutstanding` and `loadQuestionsByKey` carried ~50 copied lines, and each
// computed six correlated subqueries (parent number, parent refs, parent qty,
// group number, variant count, own refs) for every QUESTION row: ~117,000
// subselects on a 300-line project. The facts now come from a per-record CTE
// joined once, and the select list is `OUTSTANDING_QUESTION_SELECT`, which the
// driver cannot interpolate, so this reads the source and fails on a loader
// that drifts from it (the CHASE_HEADING_PREDICATE pattern).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OUTSTANDING_QUESTION_SELECT, OUTSTANDING_RECORD_FACTS } from "@/lib/chase-drafts";

function fold(text: string): string {
  return text
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

const source = readFileSync(path.join(process.cwd(), "src/lib/chase-drafts.ts"), "utf8");

/** The SQL template inside one exported function. */
function queryOf(name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("\nexport ", start + 1));
  const match = /\b(?:sql|exec)`([\s\S]*?)`/.exec(body);
  expect(match, name).not.toBeNull();
  return fold(match![1]!);
}

describe("the two question loaders", () => {
  for (const name of ["loadOutstanding", "loadQuestionsByKey"]) {
    it(`${name} selects exactly the shared list`, () => {
      expect(queryOf(name)).toContain(`select ${fold(OUTSTANDING_QUESTION_SELECT)} from spec_records r`);
    });

    it(`${name} reads a record's facts from the per-record CTE, joined once`, () => {
      const query = queryOf(name);
      expect(query).toContain(fold(OUTSTANDING_RECORD_FACTS));
      expect(query).toContain("join facts on facts.record_id = r.id");
      // No per-question subselect left in the select list: every "(select"
      // is inside the CTE or the WHERE clause's heading predicate.
      const selectList = query.slice(query.indexOf(`select ${fold(OUTSTANDING_QUESTION_SELECT)}`));
      const listOnly = selectList.slice(0, selectList.indexOf(" from spec_records r"));
      expect(listOnly).not.toContain("(select");
    });
  }
});
