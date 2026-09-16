// Pure tier. Fixtures are synthetic; the column NAMES are the BWS schema, which
// is what this repo commits — never a row of a real export.
import { describe, it, expect } from "vitest";
import {
  composeCheckSheet,
  columnLetter,
  checkSheetFilename,
  CHECK_SHEET_HEADER,
} from "@/lib/export-check-sheet";
import { BWS_EXPORT_COLUMNS, type ExportAttribute, type ExportRecord, type ExportScope } from "@/lib/bws-export";

const record = (overrides: Partial<ExportRecord> = {}): ExportRecord => ({
  id: "rec-1",
  recordNo: 1,
  label: "P00001-001",
  itemDescription: "Sofa",
  qty: 14,
  area: "Rooms",
  runName: "Main run",
  boqCodes: ["X-100"],
  ...overrides,
});

const attribute = (overrides: Partial<ExportAttribute> = {}): ExportAttribute => ({
  id: "attr-1",
  recordId: "rec-1",
  attrGroup: "dimension",
  label: "WIDTH",
  value: "1900",
  unit: "mm",
  dimensionSlot: "W",
  materialCode: null,
  specFieldJsonId: 3,
  state: "confirmed",
  sortOrder: 0,
  sourceFilename: "S-100.pdf",
  sourcePage: 2,
  ...overrides,
});

const scope = (overrides: Partial<ExportScope> = {}): ExportScope => ({
  projectName: "Example Hotel",
  client: "Example Client Ltd",
  runName: "Main run",
  records: [record()],
  attributes: [],
  answers: [],
  ...overrides,
});

// 109 columns less the 27 job columns that hold BWS-owned vocabularies this app
// has never known. Hard-coded so that a BWS column insertion trips a test
// rather than quietly changing how much a reviewer is asked to read.
const FIELDS_PER_RECORD = 82;

// The 27 in the A-AE block that this app leaves blank on purpose: their values
// are BWS-owned vocabularies, or things only BWS knows (Id, Job Number).
const JOB_COLUMNS_BWS_OWNS = BWS_EXPORT_COLUMNS.slice(0, 31)
  .map((c) => c.name)
  .filter((name) => !["Client", "Project Ref", "Name", "Item Count"].includes(name));

const column = (rows: string[][], name: string) => rows.filter((row) => row[5] === name);
const cell = (rows: string[][], name: string) => column(rows, name)[0];

describe("columnLetter", () => {
  it("is the spreadsheet letter for a position, not a stored value", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(31)).toBe("AF"); // the first spec field
    expect(columnLetter(BWS_EXPORT_COLUMNS.length - 1)).toBe("DE");
  });
});

describe("composeCheckSheet", () => {
  it("asks about every field of every record, populated or not", () => {
    const sheet = composeCheckSheet(scope());
    expect(sheet.header).toEqual(CHECK_SHEET_HEADER);
    expect(sheet.rows).toHaveLength(FIELDS_PER_RECORD);
    // The failure worth catching is a field the pack states and the file does
    // not carry, so a blank cell must still be a line to check.
    expect(cell(sheet.rows, "Main timber finish")?.[7]).toBe("");
  });

  it("includes a record that has nothing on it", () => {
    const sheet = composeCheckSheet(
      scope({ records: [record(), record({ id: "rec-2", recordNo: 2, label: "P00001-002", boqCodes: [] })] }),
    );
    expect(sheet.rows).toHaveLength(FIELDS_PER_RECORD * 2);
    expect(sheet.rows.filter((row) => row[0] === "P00001-002")).toHaveLength(FIELDS_PER_RECORD);
  });

  it("leaves out the job columns that are blank by design", () => {
    const sheet = composeCheckSheet(scope());
    // BWS owns these vocabularies; this app has never known their values.
    expect(column(sheet.rows, "Status")).toHaveLength(0);
    expect(column(sheet.rows, "KAM")).toHaveLength(0);
    expect(column(sheet.rows, "Job Number")).toHaveLength(0);
    // The four it does fill are this repo's judgement and need checking most.
    expect(cell(sheet.rows, "Name")?.[7]).toBe("Sofa");
    expect(cell(sheet.rows, "Item Count")?.[7]).toBe("14");
    expect(cell(sheet.rows, "Client")?.[7]).toBe("Example Client Ltd");
    expect(cell(sheet.rows, "Project Ref")?.[7]).toBe("Example Hotel");
  });

  it("names every page a composed cell was built from", () => {
    const sheet = composeCheckSheet(
      scope({
        attributes: [
          attribute(),
          attribute({ label: "SEAT HEIGHT", value: "440", dimensionSlot: "SH", sortOrder: 1, sourceFilename: "S-101.pdf", sourcePage: 1 }),
        ],
      }),
    );
    const dimensions = cell(sheet.rows, "Dimensions");
    expect(dimensions?.[7]).toBe("W1900 x SH440mm");
    expect(dimensions?.[8]).toBe("Document");
    // Both, because the reviewer sent to one page cannot check the figure on
    // the other.
    expect(dimensions?.[9]).toBe("S-100.pdf, S-101.pdf");
    expect(dimensions?.[10]).toBe("1, 2");
  });

  it("says where a non-dimension value came from", () => {
    const sheet = composeCheckSheet(
      scope({
        attributes: [attribute({ attrGroup: "material", label: "SOFA", value: "Yarn YC04158", unit: null, dimensionSlot: null, specFieldJsonId: 1 })],
        answers: [{ recordId: "rec-1", specFieldJsonId: 4, value: "Walnut, satin lacquer" }],
      }),
    );
    expect(cell(sheet.rows, "COM 1")?.slice(7, 11)).toEqual(["Yarn YC04158", "Document", "S-100.pdf", "2"]);
    // An answer is somebody filling in a checklist: there is no page to open.
    expect(cell(sheet.rows, "Main timber finish")?.slice(7, 11)).toEqual(["Walnut, satin lacquer", "Checklist", "", ""]);
    expect(cell(sheet.rows, "Client Code")?.slice(7, 11)).toEqual(["X-100", "BOQ line", "", ""]);
  });

  it("carries TBC through as itself", () => {
    const sheet = composeCheckSheet(
      scope({
        attributes: [attribute({ attrGroup: "material", label: "SOFA", value: null, unit: null, dimensionSlot: null, specFieldJsonId: 1, state: "tbc" })],
      }),
    );
    // Blank says nobody looked; TBC says the client has not decided. A check
    // sheet that flattened them would have a reviewer chase a settled question.
    expect(cell(sheet.rows, "COM 1")?.[7]).toBe("TBC");
  });

  it("leaves the reviewer's three columns empty", () => {
    const sheet = composeCheckSheet(scope({ attributes: [attribute()] }));
    // A check that arrives pre-answered is the app agreeing with itself.
    for (const row of sheet.rows) expect(row.slice(11)).toEqual(["", "", ""]);
  });

  it("stays in the export's own column order, by record", () => {
    const sheet = composeCheckSheet(scope({ records: [record({ id: "rec-2", recordNo: 2, label: "P00001-002" }), record()] }));
    expect(sheet.rows[0]?.[0]).toBe("P00001-001");
    // A reviewer who finds a wrong cell here has to point at it in the export,
    // so the lines run in the file's own column order with the by-design blanks
    // lifted out — not sorted by anything this sheet finds convenient.
    const expected = BWS_EXPORT_COLUMNS.map((c, index) => ({ c, index }))
      .filter(({ c }) => !JOB_COLUMNS_BWS_OWNS.includes(c.name))
      .map(({ index }) => columnLetter(index));
    expect(sheet.rows.slice(0, FIELDS_PER_RECORD).map((row) => row[4])).toEqual(expected);
  });
});

describe("checkSheetFilename", () => {
  it("cannot be mistaken for the export", () => {
    expect(checkSheetFilename("P17726", "MAIN RUN", "xlsx")).toBe("P17726 - MAIN RUN - export check sheet.xlsx");
    expect(checkSheetFilename("P17726", null, "csv")).toBe("P17726 - export check sheet.csv");
  });

  it("strips what a Content-Disposition header cannot carry", () => {
    expect(checkSheetFilename('P1"7726\n', "A/B", "csv")).toBe("P17726 - AB - export check sheet.csv");
  });
});
