// Coverage rows are written by ONE batched writer (audit F14, 5.4 A11).
//
// The edit route inserted them one statement at a time while holding the
// draft's lock: the same round-trip-per-row cost the generate route was fixed
// for on 2026-09-23 (492 inserts, 22.3 s of a 24.9 s transaction). Both now
// call `insertCoverageRows`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COVERAGE_CHUNK, coverageChunks } from "@/lib/draft-coverage-write";

describe("the coverage writer", () => {
  it("is the only place a route inserts coverage rows", () => {
    for (const file of ["src/app/api/drafts/generate/route.ts", "src/app/api/drafts/[id]/edit/route.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("insertCoverageRows(");
      expect(source, file).not.toMatch(/insert into email_draft_items/);
    }
  });

  it("numbers sort_order across chunks, never restarting at a chunk boundary", () => {
    const items = Array.from({ length: COVERAGE_CHUNK * 2 + 3 }, (_, index) => index);
    const chunks = coverageChunks(items);
    expect(chunks.map((chunk) => chunk.length)).toEqual([COVERAGE_CHUNK, COVERAGE_CHUNK, 3]);
    expect(chunks.flat().map((row) => row.sortOrder)).toEqual(items.map((index) => index + 1));
  });
});
