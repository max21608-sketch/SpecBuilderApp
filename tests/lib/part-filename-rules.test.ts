// Pure tier. A FILENAME NAMES A FILE, NOT A PART (open intake; the design's
// trap 7). A read of part of a file takes neither its drawing number nor its
// mock-up flag from the file's name; a whole file still does, exactly as
// before. The shapes are `mockup-resolution.test.ts`'s; every code is invented.
import { describe, expect, it } from "vitest";
import { ownFilename, resolveDrawingItem, type DrawingItem, type StagedDrawings } from "@/lib/drawing-document";
import type { RecordEntry } from "@/lib/record-refs";
import type { SourcePart } from "@/lib/source-part";

const PART: SourcePart = { kind: "pages", ranges: [{ from: 1, to: 11 }] };

function record(id: string, code: string, runId: string, over: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id,
    recordNo: 1,
    label: `P00001-${id}`,
    itemDescription: "Dresser stool",
    categoryId: null,
    categoryName: null,
    refs: [code],
    boqCodes: [code],
    runId,
    runName: runId,
    parentId: null,
    variantLabel: null,
    version: 1,
    ...over,
  };
}

const GR = record("gr", "GR-ZQ-08", "run-gr");
const PL = record("pl", "PL-ZQ-08", "run-pl");
const MOCK_GR = record("mu-gr", "GR-ZQ-08", "run-mu", { onMockupPhase: true });

function item(code: string, mockup?: DrawingItem["mockup"]): DrawingItem {
  return {
    id: "i1",
    version: 1,
    page: 1,
    itemCodeRaw: code,
    itemNameRaw: null,
    confidence: "high",
    targets: null,
    observations: [],
    ...(mockup ? { mockup } : {}),
  };
}

type Staged = Pick<StagedDrawings, "schemaVersion" | "codeGroups" | "filename" | "sourcePart">;
const whole = (filename: string): Staged => ({ schemaVersion: 2, codeGroups: [], filename });
const part = (filename: string): Staged => ({ ...whole(filename), sourcePart: PART });

describe("ownFilename", () => {
  it("is the filename for a whole file and nothing for a part of one", () => {
    expect(ownFilename(whole("AB-CD-PL-ZQ-08.pdf"))).toBe("AB-CD-PL-ZQ-08.pdf");
    expect(ownFilename({ ...whole("AB-CD-PL-ZQ-08.pdf"), sourcePart: null })).toBe("AB-CD-PL-ZQ-08.pdf");
    expect(ownFilename(part("AB-CD-PL-ZQ-08.pdf"))).toBeNull();
  });
});

describe("the drawing number", () => {
  it("settles a page code that ends two bill codes from a WHOLE file's name, as before", () => {
    const resolution = resolveDrawingItem(whole("AB-CD-PL-ZQ-08.pdf"), item("ZQ-08"), [GR, PL]);
    expect(resolution.suggested).toEqual(["pl"]);
  });

  it("settles nothing from the name of a file this read is only part of", () => {
    const resolution = resolveDrawingItem(part("AB-CD-PL-ZQ-08.pdf"), item("ZQ-08"), [GR, PL]);
    expect(resolution.suggested).toEqual([]);
  });
});

describe("the mock-up flag", () => {
  const marked = item("GR-ZQ-08", { is: true, evidence: "MUR in the drawing number" });

  it("comes from a WHOLE file's MUR segment, as before", () => {
    expect(resolveDrawingItem(whole("AB-CD-MUR-ZQ-08.pdf"), marked, [GR, PL, MOCK_GR]).suggested).toEqual(["mu-gr"]);
  });

  it("never comes from the name of a file this read is only part of", () => {
    const resolution = resolveDrawingItem(part("AB-CD-MUR-ZQ-08 and specs.pdf"), marked, [GR, PL, MOCK_GR]);
    // Read as the bill's own drawing: its line suggested, the mock-up phase left unticked.
    expect(resolution.suggested).toEqual(["gr"]);
    expect(resolution.mockup?.message).toMatch(/this is not a mock-up drawing/);
  });

  it("still comes from the page's own title block in a part", () => {
    const titled = item("GR-ZQ-08", { is: true, evidence: "MOCKUP ROOM in the title block" });
    expect(resolveDrawingItem(part("Pack.pdf"), titled, [GR, PL, MOCK_GR]).suggested).toEqual(["mu-gr"]);
  });
});
