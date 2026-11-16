// The export scope never comes back SHORT (review 2026-11-16, item 1.1).
//
// `loadExportScope` read the record ids, then the atoms for them, and skipped
// any id whose atoms were missing. A record retired or split between the two
// reads was dropped from the file without a word — and a BWS import replaces
// rather than merges, so the short file wipes that record's fields on upload.
// A missing atom is now a refusal of the whole file.
import { describe, expect, it } from "vitest";
import { collectScopeRows } from "@/lib/export-scope";
import type { RecordAtoms } from "@/lib/record-atoms";

function atomsFor(id: string): RecordAtoms {
  return {
    schemaVersion: 1,
    project: { number: "P90010", name: "QA", client: null },
    record: { id, recordNo: id } as unknown as RecordAtoms["record"],
    runId: "run",
    runName: "MAIN",
    status: "active",
    categoryId: null,
    categoryName: null,
    level: null,
    productReference: null,
    designer: null,
    boqCategory: null,
    parentId: null,
    splitReason: null,
    refs: [],
    attributes: [],
    answers: [],
    itemImage: null,
  };
}

describe("collectScopeRows", () => {
  it("returns every record the id list named, in its order", () => {
    const atoms = new Map(["b", "a"].map((id) => [id, atomsFor(id)]));
    const rows = collectScopeRows(["a", "b"], atoms);
    expect("error" in rows).toBe(false);
    if ("error" in rows) return;
    expect(rows.records.map((record) => record.id)).toEqual(["a", "b"]);
  });

  it("refuses the whole file when one record's atoms are missing, rather than returning a shorter list", () => {
    const atoms = new Map(["a", "c"].map((id) => [id, atomsFor(id)]));
    const rows = collectScopeRows(["a", "b", "c"], atoms);
    expect(rows).toEqual({
      error: expect.stringMatching(/changed while this file was being built.*Download it again\./),
      status: 409,
    });
  });
});
