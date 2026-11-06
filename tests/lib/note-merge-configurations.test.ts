// Pure tier. Audit D5 (2026-11-06): `mergeNoteBlocks` keyed a block on page and
// heading only. A version 4 unlabelled statement is staged as a plain `Note`
// carrying its OWN configurations, and the block kept the FIRST row's, so a
// "Type 3" note merged under a shared one was written to every configuration,
// and a shared one merged under a "Type 3" one to Type 3 alone. Invented text.
import { describe, it, expect } from "vitest";
import { mergeNoteBlocks, type DrawingObservation } from "@/lib/drawing-document";

function note(id: string, value: string, extra: Partial<DrawingObservation> = {}): DrawingObservation {
  return {
    id,
    version: 1,
    labelRaw: "Note",
    valueRaw: value,
    value,
    attrGroup: "note",
    unit: null,
    unitSuggested: false,
    dimensionSlot: null,
    slotSuggested: false,
    specFieldId: null,
    materialCodeRaw: null,
    state: "confirmed",
    stateReason: null,
    reviewStatus: "pending",
    page: 2,
    ...extra,
  } as DrawingObservation;
}

describe("mergeNoteBlocks — configurations", () => {
  it("a shared note and a Type 3 note on one page stay two rows", () => {
    const merged = mergeNoteBlocks([
      note("n1", "Frame to be kiln dried"),
      note("n2", "Seat in a contrasting welt", { configurations: ["Type 3"] }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.id === "n1")!.configurations ?? []).toEqual([]);
    expect(merged.find((row) => row.id === "n2")!.configurations).toEqual(["Type 3"]);
  });

  it("Type 2 and Type 3 notes under one heading stay apart, and each keeps its own", () => {
    const merged = mergeNoteBlocks([
      note("n1", "REMARKS: Welt in the seat cloth", { configurations: ["Type 2"] }),
      note("n2", "REMARKS: Welt in a contrast cloth", { configurations: ["Type 3"] }),
      note("n3", "REMARKS: Contrast cloth to be approved", { configurations: ["type 3"] }),
    ]);
    expect(merged).toHaveLength(2);
    const type3 = merged.find((row) => row.id === "n2")!;
    // The same configuration written in two cases is one configuration.
    expect(type3.value).toBe("Welt in a contrast cloth\nContrast cloth to be approved");
    expect(type3.configurations).toEqual(["Type 3"]);
    expect(merged.find((row) => row.id === "n1")!.configurations).toEqual(["Type 2"]);
  });

  it("the same set in a different order is one block", () => {
    const merged = mergeNoteBlocks([
      note("n1", "REMARKS: One", { configurations: ["Type 1", "Type 5"] }),
      note("n2", "REMARKS: Two", { configurations: ["Type 5", "Type 1"] }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("a reviewer's choice of configurations keeps a row out of a block that differs", () => {
    const merged = mergeNoteBlocks([
      note("n1", "REMARKS: One"),
      note("n2", "REMARKS: Two", { configurationsByReviewer: ["TYPE 3"] }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.id === "n2")!.configurationsByReviewer).toEqual(["TYPE 3"]);
  });

  it("notes with no configurations still merge as before", () => {
    const merged = mergeNoteBlocks([note("n1", "REMARKS: One"), note("n2", "REMARKS: Two")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.value).toBe("One\nTwo");
  });
});
