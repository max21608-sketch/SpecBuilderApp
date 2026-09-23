import { describe, expect, it } from "vitest";
import {
  DIFFERING_FIELD_JSON_IDS,
  VARIANT_LABEL_PATTERN,
  carryKey,
  checkConfigurationName,
  defaultSelection,
  defaultTicked,
  describeRetireEffect,
  describeExportEffect,
  foldConfigurationName,
  isDifferingField,
  sameOffer,
  stopsBeingExported,
  type CarryItem,
} from "@/lib/configuration-carry";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function item(overrides: Partial<CarryItem> & Pick<CarryItem, "id">): CarryItem {
  return {
    kind: "attribute",
    version: 1,
    label: overrides.id,
    value: "x",
    qualifier: null,
    state: "confirmed",
    jsonId: null,
    source: null,
    differing: false,
    ...overrides,
  };
}

describe("the configuration name", () => {
  it("is trimmed, collapsed and upper-cased", () => {
    expect(foldConfigurationName("  type   2 ")).toBe("TYPE 2");
    expect(foldConfigurationName("b")).toBe("B");
  });

  it("is the same pattern the database CHECK holds", () => {
    // 0024's `spec_records_variant_shape`. If a migration widens it, this test
    // is where the constant has to move with it.
    const migration = readFileSync(join(process.cwd(), "db/migrations/0024_record_variants.sql"), "utf8");
    expect(migration).toContain(`variant_label ~ '${VARIANT_LABEL_PATTERN.source}'`);
  });

  it("accepts what a drawing calls a configuration", () => {
    expect(checkConfigurationName("Type 2", [], "S-301")).toEqual({ ok: true, label: "TYPE 2" });
    expect(checkConfigurationName("c", [], "S-301")).toEqual({ ok: true, label: "C" });
  });

  it("refuses an empty name and one the CHECK would refuse, in words", () => {
    const empty = checkConfigurationName("   ", [], "S-301");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe("name_required");

    const long = checkConfigurationName("Configuration two", [], "S-301");
    expect(long.ok).toBe(false);
    if (!long.ok) {
      expect(long.code).toBe("name_shape");
      expect(long.message).toContain("up to 8 characters");
    }
    const odd = checkConfigurationName("A&B", [], "S-301");
    expect(odd.ok).toBe(false);
  });

  it("refuses a name already used, and a RETIRED one, however it is typed", () => {
    const live = checkConfigurationName("type 2", [{ label: "TYPE 2", status: "active" }], "S-301");
    expect(live).toMatchObject({ ok: false, code: "name_taken" });
    if (!live.ok) expect(live.message).toBe("S-301 already has a configuration called TYPE 2.");

    const retired = checkConfigurationName("b", [{ label: "B", status: "retired" }], "S-301");
    expect(retired).toMatchObject({ ok: false, code: "name_retired" });
    if (!retired.ok) expect(retired.message).toContain("never reused");
  });
});

describe("the differing fields", () => {
  it("are COM 1, COM 2 and COM 3, in that order — timber and metal are carried", () => {
    expect(DIFFERING_FIELD_JSON_IDS).toEqual([1, 2, 14]);
    expect(isDifferingField(1)).toBe(true);
    expect(isDifferingField(4)).toBe(false);
    expect(isDifferingField(5)).toBe(false);
    expect(isDifferingField(3)).toBe(false);
    expect(isDifferingField(null)).toBe(false);
  });

  it("each names a field the BWS register holds under that name", () => {
    const seed = readFileSync(join(process.cwd(), "db/seed/0001_spec_fields.sql"), "utf8");
    const named: Record<number, string> = { 1: "COM 1", 2: "COM 2", 14: "COM 3" };
    for (const id of DIFFERING_FIELD_JSON_IDS) expect(seed).toMatch(new RegExp(`\\(${id}, '[A-Z]+', '${named[id]}'`));
  });
});

describe("the default ticks", () => {
  const offered = [
    item({ id: "w", label: "W · Width" }),
    item({ id: "com1", label: "COM 1", jsonId: 1, differing: true }),
    item({ id: "note", kind: "dimension_note", label: "Dimension note" }),
    item({ id: "ans", kind: "answer", label: "Stitching spec" }),
    item({ id: "com2", label: "COM 2", jsonId: 2, differing: true }),
    item({ id: "timber", label: "Timber", jsonId: 4, differing: false }),
  ];

  it("ticks everything that is not a differing field", () => {
    expect(defaultTicked(offered[0]!)).toBe(true);
    expect(defaultTicked(offered[1]!)).toBe(false);
    expect([...defaultSelection(offered)].sort()).toEqual(["answer:ans", "attribute:timber", "attribute:w", "dimension_note:note"]);
  });

  it("says what stops being exported: everything left unticked, on the first split only", () => {
    const ticked = defaultSelection(offered);
    expect(stopsBeingExported(offered, ticked, false).map((row) => row.id)).toEqual(["com1", "com2"]);
    expect(stopsBeingExported(offered, ticked, true)).toEqual([]);
    expect(stopsBeingExported(offered, new Set(offered.map(carryKey)), false)).toEqual([]);
  });

  it("puts it in a sentence naming each one", () => {
    const stops = stopsBeingExported(offered, defaultSelection(offered), false);
    const sentence = describeExportEffect(stops, false, "S-301", "TYPE 2");
    expect(sentence).toContain("S-301 becomes a heading");
    expect(sentence).toContain("2 things you left unticked will stop being exported: COM 1, COM 2.");
    expect(describeExportEffect([], false, "S-301", "TYPE 2")).toContain("nothing stops being exported");
    expect(describeExportEffect([], true, "S-301", "TYPE 2")).toContain("already a heading");
  });
});

describe("the offer shown against the offer that is there", () => {
  const live = [
    { kind: "attribute" as const, id: "a", version: 1 },
    { kind: "answer" as const, id: "b", version: 3 },
  ];
  it("agrees on the same rows at the same versions, in any order", () => {
    expect(sameOffer([...live].reverse(), live)).toBe(true);
  });
  it("refuses a moved version, a missing row and an added one", () => {
    expect(sameOffer([{ ...live[0]!, version: 2 }, live[1]!], live)).toBe(false);
    expect(sameOffer([live[0]!], live)).toBe(false);
    expect(sameOffer([...live, { kind: "attribute", id: "c", version: 1 }], live)).toBe(false);
  });
});

describe("retiring a configuration", () => {
  it("says the bill line becomes an item again when it is the last live one", () => {
    expect(describeRetireEffect("S-301", "TYPE 2", 0)).toBe(
      "S-301 TYPE 2 stops being exported. It is the last live configuration, so S-301 becomes an item again and its own specs are exported again.",
    );
  });
  it("says the bill line stays a heading while others are live", () => {
    expect(describeRetireEffect("S-301", "TYPE 2", 1)).toContain("its other configuration is still exported");
    expect(describeRetireEffect("S-301", "TYPE 2", 3)).toContain("its other 3 configurations are still exported");
  });
});
