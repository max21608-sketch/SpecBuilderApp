import { describe, expect, it } from "vitest";
import { isMockupDrawing, resolveDrawingItem } from "@/lib/drawing-document";
import type { RecordEntry } from "@/lib/record-refs";

const record = (id: string, code: string, runId: string, runName: string, onMockupPhase: boolean): RecordEntry => ({
  id, recordNo: 1, label: `P00001-${id}`, itemDescription: "Desk", categoryId: null, categoryName: null,
  refs: [code], boqCodes: [code], runId, runName, parentId: null, variantLabel: null, version: 1, onMockupPhase,
});

describe("a mock-up drawing rests on the title block or the drawing number, never on a caption", () => {
  it("a caption ending (MUR) alone is not a mock-up drawing", () => {
    const item = { itemCodeRaw: "FUR-05", itemCodes: ["FUR-05", "DESK (MUR)", "AM-ID-PL-FUR-05"], mockup: { is: true, evidence: 'Sheet caption reads "DESK (MUR)"' } };
    expect(isMockupDrawing(item, "AM-ID-PL-FUR-05 Desk.pdf")).toBe(false);
  });
  it("the title block's MOCKUP ROOM is", () => {
    const item = { itemCodeRaw: "FUR-05", itemCodes: ["FUR-05"], mockup: { is: true, evidence: "Title block 'MOCKUP ROOM FURNITURE DETAILS'" } };
    expect(isMockupDrawing(item, null)).toBe(true);
    expect(isMockupDrawing({ ...item, mockup: { is: true, evidence: "drawing title 'MOCK-UP-ROOM'" } }, null)).toBe(true);
  });
  it("a MUR segment in the drawing number is", () => {
    const item = { itemCodeRaw: "FUR-05", itemCodes: ["FUR-05", "AM-ID-MUR-FUR-05"], mockup: { is: true, evidence: "caption" } };
    expect(isMockupDrawing(item, null)).toBe(true);
    expect(isMockupDrawing({ itemCodeRaw: "FUR-05", mockup: { is: true, evidence: "x" } }, "AM-ID-MUR-FUR-05.pdf")).toBe(true);
  });
  it("the read's no is a no, whatever the codes say", () => {
    expect(isMockupDrawing({ itemCodeRaw: "FUR-05", mockup: { is: false, evidence: null } }, "AM-ID-MUR-FUR-05.pdf")).toBe(false);
  });
});

describe("a drawing not marked mock-up does not write to a mock-up item unless a person ticks it", () => {
  it("lists the mock-up phase but leaves it out of the suggestion, and says why", () => {
    // The mock-up copy of the SAME line: it matches by code in its own phase.
    const records = [record("main", "PL-FUR-05", "r-main", "MAIN", false), record("mock", "PL-FUR-05", "r-mock", "Mock-up", true)];
    const staged = { schemaVersion: 4 as const, filename: "AM-ID-PL-FUR-05 Desk.pdf" };
    const item = { itemCodeRaw: "FUR-05", itemCodes: ["FUR-05", "DESK (MUR)", "AM-ID-PL-FUR-05"], mockup: { is: true, evidence: 'caption "DESK (MUR)"' } };
    const resolution = resolveDrawingItem(staged as never, item as never, records);
    expect(resolution.suggested).toEqual(["main"]);
    expect(resolution.runs.some((run) => run.status === "matched" && run.record.id === "mock")).toBe(true);
    expect(resolution.mockup?.message).toMatch(/left unticked/);
  });
});
