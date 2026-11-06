// Pure tier — every chase query carries the split-heading clause.
//
// The driver cannot interpolate a SQL fragment, so `CHASE_HEADING_PREDICATE`
// cannot be shared by reference: each query writes it out. The audit of
// 2026-11-06 found the clause written eleven times and MISSING from three
// queries (the chase's own `loadQuestionsByKey`, and the levelless and
// unauthored blocker lists), and each omission let a split bill line, a
// heading the export never ships, be chased or listed as work. This reads the
// sources and fails on a query over `spec_records r` that lacks it, or lacks
// the active-phase clause beside it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHASE_HEADING_PREDICATE } from "@/lib/chase-drafts";

const FILES = [
  "src/lib/chase-drafts.ts",
  "src/lib/item-tgq-load.ts",
  "src/app/api/drafts/route.ts",
];

/** Comments out, whitespace folded, no space just inside a bracket. */
function fold(text: string): string {
  return text
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

/** Every tagged SQL template in a source file, by the tag names this repo uses. */
function templates(source: string): string[] {
  return [...source.matchAll(/\b(?:sql|exec|txn)`([\s\S]*?)`/g)].map((match) => match[1] ?? "");
}

describe("the split-heading clause", () => {
  for (const file of FILES) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const queries = templates(source).filter((query) => /from spec_records r\b/.test(query));

    it(`${file} has at least one query over spec_records r (so this test reads something)`, () => {
      expect(queries.length).toBeGreaterThan(0);
    });

    for (const [index, query] of queries.entries()) {
      it(`${file}, query ${index + 1}: excludes a heading and a retired phase`, () => {
        const folded = fold(query);
        expect(folded).toContain(fold(CHASE_HEADING_PREDICATE));
        expect(folded).toContain("run.status = 'active'");
      });
    }
  }

  it("the constant is the clause loadExportScope uses", () => {
    const scope = fold(readFileSync(path.join(process.cwd(), "src/lib/export-scope.ts"), "utf8"));
    expect(scope).toContain(fold(CHASE_HEADING_PREDICATE));
  });
});
