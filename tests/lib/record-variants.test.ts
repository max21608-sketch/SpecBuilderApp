import { describe, expect, it } from "vitest";
import {
  nextVariantLabel,
  parentIsSupersededBy,
  unallocatedQty,
  variantName,
} from "@/lib/record-variants";

describe("nextVariantLabel", () => {
  it("names the first two variants A and B", () => {
    expect(nextVariantLabel([])).toBe("A");
    expect(nextVariantLabel(["A"])).toBe("B");
    expect(nextVariantLabel(["A", "B", "C"])).toBe("D");
  });

  it("does not reuse the letter of a retired variant", () => {
    // Somebody quoted "S-201 B" in an email. That has to keep meaning the
    // thing they quoted — the same reason a retired record keeps its number.
    expect(nextVariantLabel(["A", "B"])).toBe("C");
  });

  it("ignores nulls and case", () => {
    expect(nextVariantLabel([null, "a", null])).toBe("B");
  });

  it("returns null rather than inventing AA", () => {
    const all = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    expect(nextVariantLabel(all)).toBeNull();
  });
});

describe("variantName", () => {
  it("is the client's ref with our letter after it", () => {
    expect(variantName("S-201", "A", "AP364-009")).toBe("S-201 A");
  });

  it("leaves an unsplit record exactly as it was", () => {
    expect(variantName("S-201", null, "AP364-009")).toBe("S-201");
  });

  it("falls back to the record label, still with the letter", () => {
    expect(variantName(null, "B", "AP364-009")).toBe("AP364-009 B");
    expect(variantName("   ", "B", "AP364-009")).toBe("AP364-009 B");
  });
});

describe("parentIsSupersededBy", () => {
  it("drops a bill line out of the export once it has a live variant", () => {
    expect(parentIsSupersededBy(1)).toBe(true);
    expect(parentIsSupersededBy(2)).toBe(true);
  });

  it("puts it back when every variant is retired", () => {
    // It is still a line on the bill, 45 off, and a file that omitted it would
    // wipe every BWS field it holds.
    expect(parentIsSupersededBy(0)).toBe(false);
  });
});

describe("unallocatedQty", () => {
  it("says how much of the bill line is still unaccounted for", () => {
    expect(unallocatedQty(45, [null, null])).toBe(45);
    expect(unallocatedQty(45, [30, null])).toBe(15);
    expect(unallocatedQty(45, [30, 15])).toBe(0);
  });

  it("does not clamp an over-allocation away", () => {
    // Variants adding up to more than the bill line is a real mistake, and
    // hiding it behind a Math.max is how it reaches a quotation.
    expect(unallocatedQty(45, [30, 30])).toBe(-15);
  });

  it("says nothing when the bill line said nothing", () => {
    expect(unallocatedQty(null, [30])).toBeNull();
  });
});
