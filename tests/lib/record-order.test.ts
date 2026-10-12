// The phase table's order by client reference (F3, 2026-10-12). Pure,
// synthetic records.
import { describe, expect, it } from "vitest";
import { orderRecords } from "@/lib/record-order";

const rec = (id: string, client_code: string | null, parent_id: string | null = null) => ({ id, client_code, parent_id });

describe("orderRecords", () => {
  // Bill order, as the query returns it: a configuration directly under its line.
  const bill = [
    rec("a", "ZZ-FUR-22"),
    rec("b", "ZZ-FUR-13"),
    rec("b1", "ZZ-FUR-13", "b"),
    rec("b2", "ZZ-FUR-13", "b"),
    rec("c", "ZZ-FUR-22"),
    rec("d", null),
    rec("e", "QQ-FUR-13"),
    rec("f", "ZZ-FUR-19/21"),
    rec("h", "ZZ-FUR-19"),
    rec("g", "ZZ.FUR.22"),
  ];

  it("returns bill order untouched", () => {
    expect(orderRecords(bill, "bill").map((r) => r.id)).toEqual(bill.map((r) => r.id));
  });

  it("sorts by the folded client code, ties in bill order, no code last, a zone kept apart", () => {
    // `ZZ-FUR-19/21` sits beside ZZ-FUR-19, not after ZZ-FUR-22 as a number would.
    expect(orderRecords(bill, "ref").map((r) => r.id)).toEqual(["e", "b", "b1", "b2", "h", "f", "a", "c", "g", "d"]);
  });

  it("keeps a configuration under its line even where its own position would split them", () => {
    const lines = [rec("x", "ZZ-FUR-02"), rec("y", "ZZ-FUR-01"), rec("y1", "ZZ-FUR-01", "y"), rec("z", "ZZ-FUR-01")];
    expect(orderRecords(lines, "ref").map((r) => r.id)).toEqual(["y", "y1", "z", "x"]);
  });

  it("orders a configuration whose line is not listed by the code it reads", () => {
    expect(orderRecords([rec("x", "ZZ-FUR-02"), rec("y1", "ZZ-FUR-01", "y")], "ref").map((r) => r.id)).toEqual(["y1", "x"]);
  });
});
