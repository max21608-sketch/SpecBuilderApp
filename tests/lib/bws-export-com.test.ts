// Pure tier — decision F (2026-11-20) renames COM 1/2/3 to Fabric 1/2/3 ON
// SCREENS and prints FABRIC or COM on the QUOTE. The BWS file is not touched:
// `bws-export.ts` was not opened by that build, and this holds its 109
// columns, names and ids, byte for byte, and a COM 1 cell as it composes.
//
// The digest is of the columns as they stood at 8db3611, the commit before
// the build. A BWS column change is a deliberate edit to this test as well.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BWS_EXPORT_COLUMNS, composeWorkbook, toCsv, type ExportAttribute, type ExportScope } from "@/lib/bws-export";
import type { Finish } from "@/lib/finishes";

const COLUMNS_AT_8DB3611 = "a4ca49b4b28f6e6b1305d4f86261a10bf7a877801fffc09748842df841e546d9";

const fabric: Finish = {
  id: "fin-com",
  code: "FB-01",
  codeNorm: "FB-01",
  codeOrigin: "client",
  kind: "fabric",
  description: "Pierre Frey Teddy Mohair",
  supplierRaw: null,
  reference: "F2500017",
  colour: null,
  state: "confirmed",
  standard: null,
};

const attribute: ExportAttribute = {
  id: "attr-1",
  recordId: "rec-1",
  attrGroup: "material",
  label: "SOFA",
  value: "FB-01",
  unit: null,
  qualifier: null,
  dimensionSlot: null,
  materialCode: "FB-01",
  finish: fabric,
  specFieldJsonId: 1,
  state: "confirmed",
  sortOrder: 0,
  sourceFilename: "drawings.pdf",
  sourcePage: 1,
};

const scope: ExportScope = {
  projectName: "Example Hotel",
  client: "Example Client Ltd",
  runName: "Main run",
  records: [{ id: "rec-1", recordNo: 1, label: "P00001-001", itemDescription: "Sofa", qty: 14, area: "Rooms", runName: "Main run", boqCodes: ["X-100"] }],
  attributes: [attribute],
  answers: [],
};

describe("the BWS file after decision F", () => {
  it("keeps its 109 columns, names and ids exactly", () => {
    expect(BWS_EXPORT_COLUMNS).toHaveLength(109);
    const digest = createHash("sha256")
      .update(BWS_EXPORT_COLUMNS.map((column) => `${column.name}|${column.jsonId ?? ""}`).join("\n"))
      .digest("hex");
    expect(digest).toBe(COLUMNS_AT_8DB3611);
  });

  it("still heads the column COM 1, never Fabric 1, and composes its cell from the library as before", () => {
    const workbook = composeWorkbook(scope);
    const index = BWS_EXPORT_COLUMNS.findIndex((column) => column.jsonId === 1);
    expect(workbook.jobs.headerNames[index]).toBe("COM 1");
    expect(workbook.jobs.headerIds[index]).toBe("1");
    expect(workbook.jobs.rows[0]?.[index]).toContain("Pierre Frey Teddy Mohair");
    const csv = toCsv([workbook.jobs.headerNames, ...workbook.jobs.rows]);
    expect(csv.split("\n")[0]).toContain("COM 1");
    expect(csv).not.toContain("Fabric 1");
  });
});
