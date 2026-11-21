// Pure tier. The one thing that can silently break the checklist's fold.
//
// The project-wide section is matched by the SEED's exact string, so a re-seed
// that renames it would leave the fold looking for a section nobody writes any
// more: the questions come back inline, nothing errors, and the only sign is
// nineteen rows about the project appearing above the four about the item.
// This is the assertion that fails instead.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_WIDE_SECTION } from "@/lib/checklist-sections";

const SEED_DIR = join(process.cwd(), "db", "seed");

describe("the project-wide checklist section", () => {
  it("is a section the requirement seed actually writes", () => {
    const seeds = readdirSync(SEED_DIR)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(SEED_DIR, name), "utf8"));
    // Quoted, and followed by the sort order — the shape of a `section`
    // column value in the requirements insert, rather than any mention of the
    // words anywhere in a comment.
    const written = seeds.some((sql) => sql.includes(`'${PROJECT_WIDE_SECTION}'`));
    expect(written).toBe(true);
  });

  it("is not a phrase the screen invented", () => {
    // Read the other way round: whatever the seed's project section is called,
    // this constant has to be it. If the seed writes a section nobody folds,
    // the fold is dead and this says which string to move to.
    const requirements = readFileSync(join(SEED_DIR, "0003_requirements.sql"), "utf8");
    const sections = new Set(
      [...requirements.matchAll(/'readiness', NULL, '[^']*', NULL, '([^']*)'/g)].map((match) => match[1]!),
    );
    expect([...sections]).toContain(PROJECT_WIDE_SECTION);
  });

  it("holds the two questions decision C answers once per PROJECT (2026-11-20), on every sheet that asks them", () => {
    const requirements = readFileSync(join(SEED_DIR, "0003_requirements.sql"), "utf8").split("\n");
    for (const key of [
      "q:visible-fixinings-standard-ral-9005-powder-coated",
      "q:the-client-is-expecting-exact-copy-from-their-drawing-or-there-is-possibility-of-sugestion-bw-standards-sabos-metal-bars-curved-back-leg-thickness-etc",
    ]) {
      const rows = requirements.filter((line) => line.includes(`'${key}')`));
      expect(rows.length, key).toBeGreaterThan(0);
      for (const row of rows) expect(row, key).toContain(`'${PROJECT_WIDE_SECTION}', `);
    }
  });

  // "Interliner required?" went back to a per-item question (review of the
  // chase build, 2026-11-21): six CABINETRY sheets ask it too, and one press on
  // the project card wrote an interliner onto every unanswered table and
  // wardrobe, into the BWS "FR Interliner" cell and the quote's FR INTERLINER
  // line. It is per item, in its original section, on every sheet.
  it("keeps Interliner required? (field:74) per item, in Build details, on every sheet", () => {
    const requirements = readFileSync(join(SEED_DIR, "0003_requirements.sql"), "utf8").split("\n");
    const rows = requirements.filter((line) => line.includes(`'field:74')`));
    expect(rows.length).toBe(15);
    for (const row of rows) {
      expect(row).toContain(`'Build details', `);
      expect(row).not.toContain(`'${PROJECT_WIDE_SECTION}', `);
    }
  });
});
