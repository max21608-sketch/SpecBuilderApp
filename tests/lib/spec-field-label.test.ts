// The two BWS fields a screen names differently (Matthew and Max, 2026-10-15).
//
// The map's ids and BWS names are held against the seeded register, read as a
// FILE, so a BWS rename or a renumbering fails here rather than putting the
// old name back on a screen with nothing saying so.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPEC_FIELD_DISPLAY_NAMES, fieldDisplayName, fieldDisplayNameWithBws } from "@/lib/spec-field-label";

const seeded = new Map(
  [...readFileSync(path.join(process.cwd(), "db/seed/0001_spec_fields.sql"), "utf8").matchAll(/^\s*\((\d+),\s*'[A-Z]+',\s*'((?:[^']|'')*)'/gm)].map(
    (match) => [Number(match[1]), match[2]!.replace(/''/g, "'")] as const,
  ),
);

describe("the display-name map", () => {
  it("names fields the register holds, under the register's own names", () => {
    expect(seeded.size).toBeGreaterThan(50);
    for (const entry of SPEC_FIELD_DISPLAY_NAMES) {
      expect(seeded.get(entry.jsonId)).toBe(entry.bwsName);
    }
  });

  it("gives no display name that is another field's BWS name", () => {
    const bwsNames = new Set([...seeded.values()].map((name) => name.toLowerCase()));
    for (const entry of SPEC_FIELD_DISPLAY_NAMES) expect(bwsNames.has(entry.displayName.toLowerCase())).toBe(false);
  });
});

describe("fieldDisplayName", () => {
  it("renames fields 4 and 5 by id or by BWS's name", () => {
    expect(fieldDisplayName("Main timber finish", 4)).toBe("Timber finish 1");
    expect(fieldDisplayName("Main metal finish", 5)).toBe("Metal finish 1");
    expect(fieldDisplayName("  main  METAL finish ")).toBe("Metal finish 1");
  });

  it("leaves every other field as BWS names it", () => {
    expect(fieldDisplayName("Metal Finish 2", 35)).toBe("Metal Finish 2");
    expect(fieldDisplayName(" COM 1 ")).toBe("COM 1");
    expect(fieldDisplayName(null)).toBeNull();
  });

  it("prints both where a reader checks against the BWS file", () => {
    expect(fieldDisplayNameWithBws("Main metal finish", 5)).toBe("Metal finish 1 (BWS: Main metal finish)");
    expect(fieldDisplayNameWithBws("COM 1", 1)).toBe("COM 1");
  });
});
