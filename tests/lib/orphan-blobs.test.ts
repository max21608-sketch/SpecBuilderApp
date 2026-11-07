// Which stored files no row names (audit 5.4 A10). Read only; the deciding is
// pure and held here.
import { describe, expect, it } from "vitest";
import { findOrphans } from "@/lib/orphan-blobs";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

describe("findOrphans", () => {
  it("names a project's file no attachment row names, and leaves a named one", () => {
    const result = findOrphans({
      stored: [`projects/${P1}/bill.xlsx`, `projects/${P1}/item-images/x.png`],
      named: [`projects/${P1}/bill.xlsx`],
      projectIds: [P1],
    });
    expect(result.orphans).toEqual([{ path: `projects/${P1}/item-images/x.png`, why: "no row names it" }]);
    expect(result.checked).toBe(2);
  });

  it("reads a stored row that is a full store URL as its pathname", () => {
    const result = findOrphans({
      stored: [`mailbox/inbox/a.eml`],
      named: ["https://store.example.test/mailbox/inbox/a.eml"],
      projectIds: [],
    });
    expect(result.orphans).toEqual([]);
  });

  it("says when a file's project no longer exists (deleted, its files left)", () => {
    const result = findOrphans({ stored: [`projects/${P2}/doc.pdf`], named: [], projectIds: [P1] });
    expect(result.orphans).toEqual([{ path: `projects/${P2}/doc.pdf`, why: "its project no longer exists" }]);
  });

  it("looks only under projects/ and mailbox/, and never offers to delete", () => {
    const result = findOrphans({ stored: ["somewhere/else.txt", "mailbox/x/y.eml"], named: [], projectIds: [] });
    expect(result.orphans.map((orphan) => orphan.path)).toEqual(["mailbox/x/y.eml"]);
    expect(result.checked).toBe(1);
    expect(Object.keys(result)).not.toContain("delete");
  });
});
