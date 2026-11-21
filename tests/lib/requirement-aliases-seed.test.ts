// Pure tier: seed 0016's aliases, loaded the way `loadSpecRegisters` loads
// them and run through the REAL resolver (`resolveProposals`), on the
// armchairs sheet as seed 0003 writes it (decision G of 2026-11-20).
//
// The matcher scores overlap / the SMALLER word set, so every word of an
// alias attracts a one-word label that contains it (design finding 14). The
// seed is therefore the multi-word or the evidently-safe forms only, chosen
// after reading `vocab:gap`'s near misses on the local corpus; this holds what
// must land and what must not.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProposals, type Registers, type RequirementEntry } from "@/lib/spec-document";
import type { RawProposal } from "@/lib/extraction-schema";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const SLUG = "armchairs-benches-stools-sofas";

/** BWS field names by json_id, off seed 0001. */
const fieldNames = new Map<number, string>();
for (const match of read("db/seed/0001_spec_fields.sql").matchAll(/\((\d+), '[A-Z]+', '((?:[^']|'')*)'/g)) {
  fieldNames.set(Number(match[1]), match[2]!.replace(/''/g, "'"));
}

/** The sheet's questions as seed 0003 writes them, keyed by seed_key. */
const requirements: (RequirementEntry & { seedKey: string })[] = [];
for (const line of read("db/seed/0003_requirements.sql").split("\n")) {
  if (!line.includes(`slug = '${SLUG}'`)) continue;
  const m = /'(spec_field|readiness)', (?:\(select id from spec_fields where json_id = (\d+)\)|NULL), '((?:[^']|'')*)', (?:NULL|'(?:[^']|'')*'), '((?:[^']|'')*)', \d+, '[^']*', 'seed', 'seed', '([^']+)'\)/.exec(line);
  if (!m) continue;
  requirements.push({
    id: m[5]!,
    seedKey: m[5]!,
    categoryId: "cat",
    kind: m[1] as "spec_field" | "readiness",
    prompt: m[3]!.replace(/''/g, "'"),
    section: m[4]!,
    specFieldName: m[2] ? (fieldNames.get(Number(m[2])) ?? null) : null,
    aliases: [],
  });
}

/** Seed 0016's (seed_key, term) pairs. */
const aliases: { seedKey: string; term: string }[] = [...read("db/seed/0016_requirement_aliases.sql").matchAll(/\('((?:field|key|q):[^']+)', '((?:[^']|'')*)'\)/g)].map(
  (m) => ({ seedKey: m[1]!, term: m[2]!.replace(/''/g, "'") }),
);

function registers(withAliases: boolean): Registers {
  return {
    records: [
      {
        id: "rec",
        recordNo: 1,
        label: "T1-001",
        itemDescription: "Lobby armchair",
        categoryId: "cat",
        categoryName: "Armchairs",
        refs: ["S-1"],
        boqCodes: ["S-1"],
        runId: "run",
        runName: "Main",
        parentId: null,
        variantLabel: null,
        version: 1,
      },
    ],
    requirements: requirements.map((q) => ({
      ...q,
      aliases: withAliases ? aliases.filter((a) => a.seedKey === q.seedKey).map((a) => a.term) : [],
    })),
    answers: [],
  };
}

let n = 0;
function landsOn(label: string, value: string, withAliases = true): string | null {
  const raw: RawProposal = { refRaw: "S-1", attributeRaw: label, valueRaw: value, page: 1, sourceSheet: null, sourceRow: null, confidence: "high", note: null };
  const [proposal] = resolveProposals([raw], registers(withAliases), () => `p${++n}`);
  return proposal?.requirementId ?? null;
}

describe("seed 0016 — which drawing labels answer which question", () => {
  it("reads the seed files it claims to", () => {
    expect(requirements.length).toBeGreaterThan(40);
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) expect(requirements.some((q) => q.seedKey === alias.seedKey), alias.seedKey).toBe(true);
  });

  it("lands SWIVEL, and a swivel base, on the swivel question", () => {
    expect(landsOn("SWIVEL", "360 return")).toBe("field:232");
    expect(landsOn("Swivel base", "360 return")).toBe("field:232");
    // Without the alias a swivel base reached nothing.
    expect(landsOn("Swivel base", "360 return", false)).toBeNull();
  });

  it("lands STUDS / NAILING on the stud question", () => {
    expect(landsOn("STUDS / NAILING", "Antique brass, close nailed")).toBe("field:16");
    expect(landsOn("NAILING", "Antique brass")).toBe("field:16");
    expect(landsOn("STUDS / NAILING", "Antique brass", false)).toBeNull();
  });

  it("does NOT land FIRE, GLIDES, a seat fabric or a seat height on any aliased question", () => {
    const aliased = new Set(aliases.map((a) => a.seedKey));
    for (const [label, value] of [
      ["FIRE", "BS 7176 medium hazard"],
      ["GLIDES", "Felt glides"],
      ["Seat fabric", "FB-CH-02A"],
      ["Seat height", "Approx. as drawing"],
      ["BASE", "Oak"],
      ["cushions", "double stitching"],
    ] as const) {
      const landed = landsOn(label, value);
      expect(landed === null || !aliased.has(landed), `${label} -> ${landed}`).toBe(true);
    }
  });
});
