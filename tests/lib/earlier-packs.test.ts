// The pack screen names what an earlier pack already did (pilot walk,
// 2026-10-12): a drawings-only pack is not a project with no bill.
import { describe, expect, it } from "vitest";
import { billFromEarlierPack, finishesFromEarlierPack, type ProjectDocument } from "@/lib/earlier-packs";

const doc = (over: Partial<ProjectDocument>): ProjectDocument => ({
  id: "d",
  source_kind: "pdf",
  document_kind: "shop_drawings",
  status: "confirmed",
  batch_id: "pack-2",
  batch_created_at: "2026-10-11T09:00:00Z",
  created_at: "2026-10-11T09:00:00Z",
  ...over,
});

const BILL = doc({
  id: "bill",
  source_kind: "boq_xlsx",
  document_kind: null,
  batch_id: "pack-1",
  batch_created_at: "2026-10-05T10:00:00Z",
  created_at: "2026-10-05T10:00:00Z",
  records_created: "67",
});

describe("billFromEarlierPack", () => {
  it("names the pack and the records of a bill confirmed in another pack", () => {
    expect(billFromEarlierPack([doc({}), BILL], "pack-2")).toBe(
      "Not in this pack. The project's bill was confirmed in the pack of 5 Oct 2026 — 67 records.",
    );
  });

  it("says nothing new where the bill is in this pack, unconfirmed, or absent", () => {
    expect(billFromEarlierPack([BILL], "pack-1")).toBeNull();
    expect(billFromEarlierPack([{ ...BILL, status: "parsed" }], "pack-2")).toBeNull();
    expect(billFromEarlierPack([doc({})], "pack-2")).toBeNull();
  });
});

describe("finishesFromEarlierPack", () => {
  it("names an earlier schedule, else the library's size, else nothing", () => {
    const schedule = doc({ document_kind: "finishes_schedule", batch_id: "pack-1", batch_created_at: "2026-10-04T08:00:00Z" });
    expect(finishesFromEarlierPack([schedule], "pack-2", 40)).toBe(
      "Not in this pack. A finishes schedule was confirmed in the pack of 4 Oct 2026.",
    );
    expect(finishesFromEarlierPack([BILL], "pack-2", 40)).toBe(
      "Not in this pack. The project's finishes library already holds 40 codes.",
    );
    expect(finishesFromEarlierPack([BILL], "pack-2", 0)).toBeNull();
  });
});
