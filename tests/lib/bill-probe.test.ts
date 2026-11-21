// A part torn between a bill and a schedule is tried by the bill reader, and
// what it found is said in one sentence — pure (`bill-probe.ts`).
import { describe, expect, it } from "vitest";
import { billProbeEvidence, isBillOrScheduleDoubt, probeOfPdfBill, probeOfSheets } from "@/lib/bill-probe";
import { parseBoqSheets } from "@/lib/boq-import";

const part = (over: Partial<Parameters<typeof isBillOrScheduleDoubt>[0]>) => ({
  genre: "ffe_schedule" as const,
  certain: false,
  weighedAgainst: "bill_of_quantities" as const,
  nothingToRead: false,
  ...over,
});

describe("isBillOrScheduleDoubt", () => {
  it("is a doubt between a bill and an FF&E schedule, either way round", () => {
    expect(isBillOrScheduleDoubt(part({}))).toBe(true);
    expect(isBillOrScheduleDoubt(part({ genre: "bill_of_quantities", weighedAgainst: "ffe_schedule" }))).toBe(true);
  });

  it("is never a certain answer, another pair, a doubt naming nothing, or a cover", () => {
    expect(isBillOrScheduleDoubt(part({ certain: true }))).toBe(false);
    expect(isBillOrScheduleDoubt(part({ weighedAgainst: "finishes_schedule" }))).toBe(false);
    expect(isBillOrScheduleDoubt(part({ genre: "shop_drawings" }))).toBe(false);
    expect(isBillOrScheduleDoubt(part({ weighedAgainst: null }))).toBe(false);
    expect(isBillOrScheduleDoubt(part({ genre: "bill_of_quantities", weighedAgainst: "bill_of_quantities" }))).toBe(false);
    expect(isBillOrScheduleDoubt(part({ nothingToRead: true }))).toBe(false);
  });
});

describe("billProbeEvidence", () => {
  it("says the lines and the columns, in the design's words", () => {
    expect(billProbeEvidence({ lines: 26, code: true, description: true, quantity: true })).toBe(
      "Reads as a bill: 26 lines; code and quantity columns found.",
    );
    expect(billProbeEvidence({ lines: 1, code: false, description: true, quantity: true })).toBe(
      "Reads as a bill: 1 line; description and quantity columns found.",
    );
  });

  it("says nothing where it does not read as a bill", () => {
    expect(billProbeEvidence(null)).toBeNull();
    expect(billProbeEvidence({ lines: 0, code: true, description: true, quantity: true })).toBeNull();
    expect(billProbeEvidence({ lines: 5, code: true, description: true, quantity: false })).toBeNull();
    expect(billProbeEvidence({ lines: 5, code: false, description: false, quantity: true })).toBeNull();
  });
});

describe("probeOfPdfBill", () => {
  it("finds code and description among the header's labels under the bill reader's headings", () => {
    const read = { ok: true as const, header: ["FF&E CODE", "DESCRIPTION", "ORDER QTY"], quantityColumn: 2, rows: [{}, {}] as never, pageCount: 1 };
    expect(probeOfPdfBill(read)).toEqual({ lines: 2, code: true, description: true, quantity: true });
    expect(probeOfPdfBill({ ...read, header: ["ROOM", "ORDER QTY"] })).toEqual({ lines: 2, code: false, description: false, quantity: true });
  });

  it("is nothing for a PDF whose text is not a table", () => {
    expect(probeOfPdfBill({ ok: false, code: "no_quantity_column", detail: "" })).toBeNull();
  });
});

describe("probeOfSheets", () => {
  const bill = [
    ["Code", "Description", "Qty"],
    ["QA-1", "Chair", 2],
    ["QA-2", "Sofa", 1],
  ];
  const rooms = [
    ["Room", "Product"],
    ["Lobby", "Lamp"],
  ];

  it("counts the lines of the sheets in the part that the reader read", () => {
    const parsed = parseBoqSheets(
      [
        { sheet: "Bill", data: bill },
        { sheet: "Other", data: bill },
      ],
      {},
      { part: { kind: "sheets", sheets: ["Bill"] } },
    );
    expect(probeOfSheets(parsed)).toEqual({ lines: 2, code: true, description: true, quantity: true });
  });

  it("is nothing for a sheet the reader could not map", () => {
    expect(probeOfSheets(parseBoqSheets([{ sheet: "Rooms", data: rooms }], {}))).toBeNull();
  });
});
