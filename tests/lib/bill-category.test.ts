// A bill line's category is written only where a person chose it (audit
// 2026-11-06, G8). The db tier proves the confirm; this holds the rule.
import { describe, expect, it } from "vitest";
import { categoryToWrite, suggestedCategoryId } from "@/lib/bill-category";

describe("a bill line's category", () => {
  it("is written only when chosen", () => {
    expect(categoryToWrite({ categoryId: "cat-1", categoryStatus: "chosen" })).toBe("cat-1");
    for (const status of ["suggested", "confident", "ambiguous", "none", "pending", undefined]) {
      expect(categoryToWrite({ categoryId: "cat-1", categoryStatus: status })).toBeNull();
    }
  });

  it("is a suggestion while it carries an id nobody chose", () => {
    expect(suggestedCategoryId({ categoryId: "cat-1", categoryStatus: "suggested" })).toBe("cat-1");
    expect(suggestedCategoryId({ categoryId: "cat-1", categoryStatus: "confident" })).toBe("cat-1");
    expect(suggestedCategoryId({ categoryId: "cat-1", categoryStatus: "chosen" })).toBeNull();
    expect(suggestedCategoryId({ categoryId: null, categoryStatus: "ambiguous" })).toBeNull();
  });
});
