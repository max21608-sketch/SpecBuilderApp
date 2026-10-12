// Pilot walk, 2026-10-12: the Documents list offered "Read the specifications
// in this bill — one read, charged" on a bill whose confirm had read its
// description cells, which the server refuses. One predicate now decides both.
import { describe, expect, it } from "vitest";
import { billDescriptionsReadAtConfirm } from "@/lib/bill-specifications";

const bill = (lines: unknown[], extra: Record<string, unknown> = {}) => ({
  schemaVersion: 4,
  filename: "bill.xlsx",
  sheets: [{ sheetName: "BILL", lines, ...extra }],
});

describe("billDescriptionsReadAtConfirm", () => {
  it("is true where an item line's description cell carried specifications", () => {
    const lines = [{ index: 0, lineNo: 9, itemDescription: "Stool", itemDescriptionRaw: "Stool\nSizes (mm): W 450 x D 450 x SH 460" }];
    expect(billDescriptionsReadAtConfirm(bill(lines))).toBe(true);
  });

  it("is false for a bill of one-line descriptions, an ignored sheet, an older shape and nothing", () => {
    expect(billDescriptionsReadAtConfirm(bill([{ index: 0, lineNo: 9, itemDescription: "Stool" }]))).toBe(false);
    const lines = [{ index: 0, lineNo: 9, itemDescription: "Stool", itemDescriptionRaw: "Stool\nSizes (mm): W 450 x D 450" }];
    expect(billDescriptionsReadAtConfirm(bill(lines, { ignored: true }))).toBe(false);
    expect(billDescriptionsReadAtConfirm({ schemaVersion: 2, sheets: [] })).toBe(false);
    expect(billDescriptionsReadAtConfirm(null)).toBe(false);
  });
});
