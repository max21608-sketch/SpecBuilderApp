// The ledger a review screen reads its versions from (audit G1), and the
// versions a drawings PATCH says it wrote. Pure.
import { describe, expect, it } from "vitest";
import { VersionLedger, versionsWritten } from "@/lib/acked-versions";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";

function row(id: string, version: number): DrawingObservation {
  return { id, version } as DrawingObservation;
}
function item(id: string, version: number, observations: DrawingObservation[]): DrawingItem {
  return { id, version, observations } as DrawingItem;
}

describe("versionsWritten", () => {
  it("names every row and item whose version moved, and nothing else", () => {
    const before = [item("i1", 1, [row("a", 1), row("b", 4)]), item("i2", 2, [row("c", 1)])];
    // A slot swap: the row named and the row it displaced both move.
    const after = [item("i1", 1, [row("a", 2), row("b", 5)]), item("i2", 3, [row("c", 1)])];
    expect(versionsWritten(before, after)).toEqual({ items: { i2: 3 }, observations: { a: 2, b: 5 } });
  });

  it("is empty for a write that bumped nothing", () => {
    const same = [item("i1", 1, [row("a", 1)])];
    expect(versionsWritten(same, same)).toEqual({ items: {}, observations: {} });
  });
});

describe("VersionLedger", () => {
  it("sends the rendered version until a save says otherwise", () => {
    const ledger = new VersionLedger();
    expect(ledger.row("a", 1)).toBe(1);
    ledger.record({ observations: { a: 2 } });
    // The click's render still says 1; the save produced 2.
    expect(ledger.row("a", 1)).toBe(2);
  });

  it("takes a newer rendered version: a reload the reviewer has seen", () => {
    const ledger = new VersionLedger();
    ledger.record({ observations: { a: 2 } });
    expect(ledger.row("a", 5)).toBe(5);
  });

  it("never goes backwards when two responses land out of order", () => {
    const ledger = new VersionLedger();
    ledger.recordRow("a", 3);
    ledger.recordRow("a", 2);
    expect(ledger.row("a", 1)).toBe(3);
  });

  it("keeps items and rows apart, even under one id", () => {
    const ledger = new VersionLedger();
    ledger.record({ items: { x: 7 }, observations: {} });
    expect(ledger.item("x", 1)).toBe(7);
    expect(ledger.row("x", 1)).toBe(1);
  });

  it("ignores a response that carries no versions", () => {
    const ledger = new VersionLedger();
    ledger.record(undefined);
    ledger.record({});
    expect(ledger.row("a", 1)).toBe(1);
  });
});
