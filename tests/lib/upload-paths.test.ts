// A picture or an email's stored name: one ASCII segment rule (audit 5.4 A3).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asciiPathSegment } from "@/lib/upload-paths";

describe("asciiPathSegment", () => {
  it("keeps letters, digits, dot, underscore and hyphen, and runs everything else into one hyphen", () => {
    expect(asciiPathSegment("Ronnie Scott’s – swatch #2.png", 120)).toBe("Ronnie-Scott-s-swatch-2.png");
  });

  it("keeps the END of a long name, so the extension survives", () => {
    expect(asciiPathSegment(`${"a".repeat(200)}.eml`, 80)).toBe(`${"a".repeat(76)}.eml`);
  });

  it("is the only copy: the upload components call it", () => {
    for (const file of ["src/components/history/EvidenceUpload.tsx", "src/components/finishes/FinishSwatch.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("asciiPathSegment(");
      expect(source, file).not.toContain("[^A-Za-z0-9._-]");
    }
  });
});
