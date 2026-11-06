// Pure tier. Audit D6 (2026-11-06): a drawing whose FIRST code misses the bill
// and whose SECOND code matches it exactly. A version 4 read lists the title
// block's code first (`ZQ-08`) and the drawing number's full code after it
// (`UP-ZQ-08`). The resolver used to return an EMPTY resolution as soon as any
// later code matched exactly, so the card said "No record carries this item
// code yet" about an item the bill plainly lists. Every code here is invented.
import { describe, it, expect } from "vitest";
import { oneLinePerPhase, resolveDrawingTargets, resolveStagedItem } from "@/lib/drawing-document";
import type { RecordEntry } from "@/lib/record-refs";

function record(code: string, overrides: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id: `rec-${code}-${overrides.runId ?? "run-main"}`,
    recordNo: 1,
    label: "P00001-001",
    itemDescription: "Bedframe",
    categoryId: null,
    categoryName: null,
    refs: [code],
    boqCodes: [code],
    runId: "run-main",
    runName: "Main",
    parentId: null,
    variantLabel: null,
    version: 1,
    ...overrides,
  };
}

describe("resolveDrawingTargets — a later code that matches exactly", () => {
  it("resolves to the record the second code names", () => {
    const bill = [record("UP-ZQ-08"), record("LV-ZQ-08")];
    const resolution = resolveDrawingTargets("ZQ-08", bill, { codes: ["ZQ-08", "UP-ZQ-08"] });
    expect(resolution.suggested).toEqual(["rec-UP-ZQ-08-run-main"]);
    expect(resolution.runs).toHaveLength(1);
    expect(resolution.runs[0]!.status).toBe("matched");
    // An exact match needs no amber sentence; the code-end step never ran.
    expect(resolution.matchedBy).toBeUndefined();
  });

  it("fans out per phase, as an exact first code does", () => {
    const bill = [
      record("UP-ZQ-08"),
      record("UP-ZQ-08", { runId: "run-ve", runName: "VE" }),
      record("LV-ZQ-08"),
    ];
    const resolution = resolveDrawingTargets("ZQ-08", bill, { codes: ["ZQ-08", "UP-ZQ-08"] });
    expect([...resolution.suggested].sort()).toEqual(["rec-UP-ZQ-08-run-main", "rec-UP-ZQ-08-run-ve"]);
  });

  it("several later codes naming the SAME records are one answer", () => {
    const bill = [record("UP-ZQ-08", { refs: ["UP-ZQ-08", "UPZQ08"], boqCodes: ["UP-ZQ-08", "UPZQ08"] })];
    const resolution = resolveDrawingTargets("ZQ-08", bill, { codes: ["ZQ-08", "UP-ZQ-08", "UPZQ08"] });
    expect(resolution.suggested).toEqual(["rec-UP-ZQ-08-run-main"]);
  });

  it("two codes naming DIFFERENT records choose nothing, and never the first", () => {
    const bill = [record("UP-ZQ-08"), record("LV-ZQ-08")];
    const resolution = resolveDrawingTargets("ZQ-08", bill, { codes: ["ZQ-08", "LV-ZQ-08", "UP-ZQ-08"] });
    expect(resolution.suggested).toEqual([]);
    expect(resolution.runs).toHaveLength(1);
    const run = resolution.runs[0]!;
    expect(run.status).toBe("ambiguous");
    if (run.status !== "ambiguous") throw new Error("unreachable");
    expect(run.candidates.map((candidate) => candidate.id).sort()).toEqual([
      "rec-LV-ZQ-08-run-main",
      "rec-UP-ZQ-08-run-main",
    ]);
    // The page is ONE item: the reviewer picks one line per phase.
    expect(oneLinePerPhase(resolution)).toBe(true);
    expect(resolution.matchedBy?.message).toMatch(/LV-ZQ-08/);
    expect(resolution.matchedBy?.message).toMatch(/UP-ZQ-08/);
  });

  it("a version 4 item titled by its short code and numbered by its full one resolves", () => {
    const bill = [record("UP-ZQ-08"), record("LV-ZQ-08")];
    const resolution = resolveStagedItem(
      { schemaVersion: 4, codeGroups: [], filename: "AB-CD-UP-ZQ-08 Bed frame.pdf" } as never,
      { itemCodeRaw: "ZQ-08", itemCodes: ["ZQ-08", "UP-ZQ-08"] },
      bill,
    );
    expect(resolution.suggested).toEqual(["rec-UP-ZQ-08-run-main"]);
  });

  it("an exact first code is unchanged: it wins, whatever a later code says", () => {
    const bill = [record("ZQ-08"), record("UP-ZQ-08")];
    const resolution = resolveDrawingTargets("ZQ-08", bill, { codes: ["ZQ-08", "UP-ZQ-08"] });
    expect(resolution.suggested).toEqual(["rec-ZQ-08-run-main"]);
  });
});
