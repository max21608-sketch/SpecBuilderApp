// Pure tier — pasting a finishes list, and what it refuses to decide.
import { describe, it, expect } from "vitest";
import { parseFinishList, previewFinishList } from "@/lib/finish-bulk";

describe("parseFinishList", () => {
  it("takes one code per line and an optional description", () => {
    expect(parseFinishList("WD-05\nCH-01.1, Ceruse finish oak\nMT-02\tAntique brass")).toEqual([
      { code: "WD-05", description: null, lineNo: 1 },
      { code: "CH-01.1", description: "Ceruse finish oak", lineNo: 2 },
      { code: "MT-02", description: "Antique brass", lineNo: 3 },
    ]);
  });

  it("splits on a spaced dash, and not on one inside a code", () => {
    // `WD-05` is a code with a hyphen in it. Only a SPACED dash separates.
    expect(parseFinishList("WD-05 - Natural oak")).toEqual([
      { code: "WD-05", description: "Natural oak", lineNo: 1 },
    ]);
  });

  it("ignores blank lines and keeps the line number of what it kept", () => {
    expect(parseFinishList("\n\nWD-05\n\n")).toEqual([{ code: "WD-05", description: null, lineNo: 3 }]);
  });
});

describe("previewFinishList — nothing is created before it is shown", () => {
  const held = [{ code: "WD-05", codeNorm: "WD-05" }];

  it("says which are new, which the project already holds, and which repeat", () => {
    const preview = previewFinishList(
      parseFinishList("WD-05\nCH-01.1\nch-01.1\nMT-02"),
      held,
    );
    expect(preview.rows.map((row) => row.status)).toEqual([
      "already held",
      "new",
      "repeated in this list",
      "new",
    ]);
    expect(preview.newCount).toBe(2);
    expect(preview.rows[0]?.heldAs).toBe("WD-05");
  });

  it("folds case and whitespace and NOTHING ELSE", () => {
    // normaliseFinishCode's rule: CH-01.1 and CH-01-1 stay two finishes,
    // because a normaliser clever enough to merge them is clever enough to
    // merge two codes a client meant to keep apart.
    const preview = previewFinishList(parseFinishList("CH-01.1\nCH-01-1"), []);
    expect(preview.newCount).toBe(2);
  });
});
