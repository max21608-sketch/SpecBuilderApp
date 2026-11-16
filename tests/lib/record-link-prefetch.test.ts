// A record link drawn once PER ROW does not prefetch (review 4A, G14,
// 2026-11-16).
//
// A `<Link>` prefetches its page when it scrolls into view. The fill-in screen
// learnt on 2026-09-20 what that costs in a table of hundreds of rows: one
// record-page render per row, all at once, against the server everybody else
// is using. The fill-in links carried `prefetch={false}` from then on; the
// phase table (356 record links on the 79-record local project), the chase
// screen and the other per-row lists did not. A person opens a handful of the
// records a table lists, and a click without a prefetch is one render.
//
// Read from the SOURCE, as the vocabulary guard is: a new per-row link in one
// of these files that forgets the flag fails here, not on the server.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The screens that draw a record link per row of a list that can run to hundreds. */
const PER_ROW_FILES = [
  "src/components/records/SpecTable.tsx",
  "src/components/drafts/ChaseQuestionTable.tsx",
  "src/components/drafts/ChaseDraftCard.tsx",
  "src/app/dashboard/drafts/page.tsx",
  "src/components/infill/InfillTable.tsx",
  "src/components/infill/InfillRow.tsx",
  "src/components/infill/UncategorisedBlock.tsx",
  "src/components/projects/ProjectWideCard.tsx",
  "src/components/finishes/FinishesLibrary.tsx",
  "src/components/history/ProjectHistory.tsx",
];

/** Every `<Link …>` opening tag whose href is a record page, with its line. */
function recordLinks(source: string): { line: number; tag: string }[] {
  const found: { line: number; tag: string }[] = [];
  for (const match of source.matchAll(/<Link\b/g)) {
    let i = match.index! + match[0].length;
    let depth = 0;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    const tag = source.slice(match.index!, i + 1);
    if (tag.includes("/dashboard/records/")) {
      found.push({ line: source.slice(0, match.index!).split("\n").length, tag });
    }
  }
  return found;
}

describe("a per-row record link does not prefetch", () => {
  it.each(PER_ROW_FILES)("%s", (file) => {
    const links = recordLinks(readFileSync(path.join(root, file), "utf8"));
    expect(links.length).toBeGreaterThan(0);
    const missing = links.filter((link) => !/\bprefetch=\{false\}/.test(link.tag)).map((link) => `${file}:${link.line}`);
    expect(missing).toEqual([]);
  });

  it("the reader finds a multi-line tag and ignores a `>` inside an expression", () => {
    const source = `
      <Link
        href={\`/dashboard/records/\${a > b ? x : y}\`}
        className="u"
      >
      <Link href="/dashboard/projects/1">`;
    const links = recordLinks(source);
    expect(links).toHaveLength(1);
    expect(links[0]!.line).toBe(2);
  });
});
