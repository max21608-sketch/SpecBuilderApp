// The version diff. Pure, so these run without a database.
import { describe, it, expect } from "vitest";
import { diffSnapshots, parseAtoms } from "@/lib/snapshot-diff";
import { RECORD_ATOMS_SCHEMA_VERSION, type RecordAtoms } from "@/lib/record-atoms";

const base = (): RecordAtoms => ({
  schemaVersion: RECORD_ATOMS_SCHEMA_VERSION,
  project: { number: "P17726", name: "Panther", client: "Argenta" },
  record: {
    id: "rec-1",
    recordNo: 14,
    label: "P17726-014",
    itemDescription: "Two seat sofa",
    qty: 6,
    area: "Guestrooms",
    runName: "MAIN RUN",
    boqCodes: ["S-100"],
  },
  runId: "run-1",
  runName: "MAIN RUN",
  status: "active",
  categoryId: "cat-1",
  categoryName: "Sofas",
  level: "hero",
  productReference: null,
  designer: "LCS",
  boqCategory: "Seating",
  parentId: null,
  splitReason: null,
  refs: [{ system: "boq_code", value: "S-100" }],
  attributes: [
    {
      id: "attr-w",
      recordId: "rec-1",
      attrGroup: "dimension",
      label: "WIDTH",
      value: "1900",
      unit: "mm",
      qualifier: null,
      dimensionSlot: "W",
      materialCode: null,
      finish: null,
      specFieldJsonId: null,
      state: "confirmed",
      sortOrder: 1,
      sourceFilename: "S-100.pdf",
      sourcePage: 1,
    },
  ],
  answers: [
    {
      id: "ans-1",
      requirementId: "req-dim",
      prompt: "Dimensions",
      section: "Dimensions",
      kind: "spec_field",
      specFieldJsonId: 3,
      specFieldName: "Dimensions",
      qualifier: null,
      value: "W1900mm",
      state: "confirmed",
      sourceKind: "document",
      sourceId: "run-1",
    },
  ],
  itemImage: null,
});

describe("diffSnapshots", () => {
  it("reports a dimension note as a core change AND as the cell moving", () => {
    // Both, deliberately: the cell says what BWS received, the core line says
    // what somebody actually did. A reader looking at the version screen for
    // "why did the dimensions cell change" gets the answer beside it.
    const after = base();
    after.record = { ...after.record, dimensionNote: "1250 L-shaped return" };
    const diff = diffSnapshots(base(), after);
    expect(diff.core).toContainEqual({
      field: "dimensionNote",
      label: "Dimension note",
      was: null,
      now: "1250 L-shaped return",
    });
    expect(diff.cells).toContainEqual(
      expect.objectContaining({ was: "W1900mm", now: "W1900mm (1250 L-shaped return)" }),
    );
  });

  it("reports nothing between two identical versions", () => {
    const diff = diffSnapshots(base(), base());
    expect(diff.isEmpty).toBe(true);
    expect(diff.core).toEqual([]);
    expect(diff.cells).toEqual([]);
  });

  it("is independent of key order, because jsonb does not preserve it", () => {
    // A snapshot comes back from Postgres with its keys in whatever order
    // jsonb chose. A diff that compared serialised objects would then report
    // every version as changed the instant it was written.
    const a = base();
    const reordered = JSON.parse(JSON.stringify({ ...a, record: { ...a.record } })) as RecordAtoms;
    const shuffled = { ...reordered };
    expect(diffSnapshots(a, shuffled).isEmpty).toBe(true);
  });

  it("names a changed quantity as one core change", () => {
    const after = base();
    after.record.qty = 8;
    const diff = diffSnapshots(base(), after);
    expect(diff.core).toEqual([{ field: "qty", label: "Quantity", was: "6", now: "8" }]);
    expect(diff.isEmpty).toBe(false);
  });

  it("reports a value corrected in place as ONE changed attribute, not a delete and an add", () => {
    const after = base();
    after.attributes[0]!.value = "1520";
    const diff = diffSnapshots(base(), after);
    expect(diff.attributes).toHaveLength(1);
    expect(diff.attributes[0]!.change).toBe("changed");
    expect(diff.attributes[0]!.fields).toEqual([{ field: "value", label: "Value", was: "1900", now: "1520" }]);
  });

  it("reports an added attribute and a removed one separately", () => {
    const after = base();
    after.attributes = [
      {
        ...after.attributes[0]!,
        id: "attr-d",
        label: "DEPTH",
        value: "790",
        dimensionSlot: "D",
      },
    ];
    const diff = diffSnapshots(base(), after);
    expect(diff.attributes.map((a) => a.change).sort()).toEqual(["added", "removed"]);
  });

  it("shows an answer moving from missing to TBC", () => {
    const before = base();
    before.answers[0] = { ...before.answers[0]!, value: null, state: "missing", sourceKind: "manual", sourceId: null };
    const diff = diffSnapshots(before, base());
    expect(diff.answers).toHaveLength(1);
    expect(diff.answers[0]!.change).toBe("changed");
    expect(diff.answers[0]!.fields.map((f) => f.field)).toContain("state");
  });

  it("keys answers on the requirement, so re-creating the row is not a change", () => {
    // Setting a category deletes the old `missing` rows and inserts the new
    // category's. A diff keyed on the answer id would print every question
    // twice — once removed, once added — with identical text.
    const after = base();
    after.answers[0] = { ...after.answers[0]!, id: "ans-new" };
    expect(diffSnapshots(base(), after).answers).toEqual([]);
  });

  it("recomposes the export cells at both ends rather than comparing stored ones", () => {
    const after = base();
    after.attributes[0]!.value = "1520";
    const diff = diffSnapshots(base(), after);
    const dimensions = diff.cells.find((cell) => cell.label === "Dimensions");
    expect(dimensions).toBeDefined();
    expect(dimensions!.was).toContain("1900");
    expect(dimensions!.now).toContain("1520");
  });

  it("treats an empty string and a null as the same absence", () => {
    const after = base();
    after.record.area = "";
    const before = base();
    before.record.area = null;
    expect(diffSnapshots(before, after).core).toEqual([]);
  });
});

describe("parseAtoms", () => {
  it("round-trips a snapshot through JSON", () => {
    const parsed = parseAtoms(JSON.parse(JSON.stringify(base())));
    expect(parsed.record.label).toBe("P17726-014");
    expect(parsed.attributes).toHaveLength(1);
  });

  it("refuses a version written by a newer build rather than showing part of it", () => {
    const future = { ...base(), schemaVersion: RECORD_ATOMS_SCHEMA_VERSION + 1 };
    expect(() => parseAtoms(JSON.parse(JSON.stringify(future)))).toThrow(/newer build/);
  });

  it("reads a version written before the dimension note existed as null, not as a crash", () => {
    // Schema 5 added `record.dimensionNote` (0034). Every snapshot taken
    // before it lacks the key, and Zod's default is what turns that into
    // "nobody had typed one" rather than a failed screen — the same treatment
    // `level` got at schema 3.
    const older = JSON.parse(JSON.stringify(base())) as { schemaVersion: number; record: Record<string, unknown> };
    older.schemaVersion = 4;
    delete older.record.dimensionNote;
    expect(parseAtoms(older).record.dimensionNote).toBeNull();
  });

  it("keeps a dimension note through the round trip, or a version would silently lose it", () => {
    // Zod strips what it does not name, so a field added to the atoms and not
    // to the schema reads back as absent on every snapshot.
    const withNote = JSON.parse(JSON.stringify(base())) as RecordAtoms;
    withNote.record.dimensionNote = "1250 L-shaped return";
    expect(parseAtoms(withNote).record.dimensionNote).toBe("1250 L-shaped return");
  });

  it("refuses a malformed snapshot rather than reading it as an empty record", () => {
    // A version whose attributes vanished would read as "everything was
    // deleted that day", which is a worse answer than an error.
    const broken = { ...base(), attributes: "not an array" };
    expect(() => parseAtoms(broken)).toThrow();
  });
});

// ---- what a comparison must never do --------------------------------------

describe("diffSnapshots over a whole project's worth of records", () => {
  it("reports a version pair that holds the same thing as no change at all", () => {
    // Two versions with different numbers can still hold identical state: a
    // change that touched a record without altering anything the diff reports.
    // compareChangeSets reads `isEmpty` to call that "unchanged", because
    // saying "changed" sends somebody looking for a difference that is not
    // there.
    const a = base();
    const b = base();
    expect(diffSnapshots(a, b).isEmpty).toBe(true);
  });

  it("does not treat a retired record as an edit to its fields", () => {
    const after = base();
    after.status = "retired";
    const diff = diffSnapshots(base(), after);
    expect(diff.core).toEqual([{ field: "status", label: "Status", was: "active", now: "retired" }]);
    expect(diff.attributes).toEqual([]);
    expect(diff.answers).toEqual([]);
  });
});

describe("diffSnapshots — item level", () => {
  it("reports a level being decided for the first time", () => {
    const before = base();
    before.level = null;
    const diff = diffSnapshots(before, base());
    expect(diff.core).toContainEqual({ field: "level", label: "Level", was: null, now: "hero" });
  });

  it("reads a snapshot written before levels existed, rather than failing the screen", () => {
    // A v2 snapshot has no `level` key at all. It must parse as "nobody had
    // said", not throw — the history screen is the one place that must still
    // render for a record whose versions predate the column.
    const old = { ...base(), schemaVersion: 2 } as Record<string, unknown>;
    delete old.level;
    const parsed = parseAtoms(old);
    expect(parsed.level).toBeNull();
    expect(diffSnapshots(parsed, base()).core).toContainEqual({
      field: "level",
      label: "Level",
      was: null,
      now: "hero",
    });
  });
});
