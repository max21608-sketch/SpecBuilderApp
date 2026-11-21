// Pure tier. The read of part of a file (open intake, 2026-11-20): what the
// model is SENT, and what the source holds.
//
//   * A part of a PDF sends the whole file and, after the prompt, the
//     instruction naming its pages. A whole PDF sends exactly the request it
//     always sent — the document and the prompt, nothing after.
//   * A part of a workbook keeps only its sheets, in the text AND in `sheets`,
//     and a sheet the file does not hold fails the read in words.
//   * The local replay key gains the part, so two parts of one PDF never
//     replay one saved answer.
//
// NO MODEL IS CALLED: the SDK's transport is stubbed, as in
// `anthropic-request.test.ts`. Every sheet name and figure is invented.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { partInstruction, partKey, type SourcePart } from "@/lib/source-part";
import { replayedResponse } from "@/lib/local-read-replay";

const plainStream = vi.hoisted(() => vi.fn());
const betaStream = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const Real = actual.default;
  class Stubbed extends Real {
    constructor(options: ConstructorParameters<typeof Real>[0]) {
      super(options);
      (this as unknown as { messages: unknown }).messages = { stream: plainStream };
      (this as unknown as { beta: unknown }).beta = { messages: { stream: betaStream } };
    }
  }
  return { ...actual, default: Stubbed };
});

const savedKey = process.env.ANTHROPIC_API_KEY;
const PART: SourcePart = { kind: "pages", ranges: [{ from: 1, to: 11 }, { from: 31, to: 44 }] };
const PDF = { type: "pdf" as const, base64: Buffer.from("%PDF-1.4").toString("base64") };
const ITEMS = { documentNotes: "", nonItemPages: [], items: [] };

beforeEach(() => {
  vi.resetModules();
  plainStream.mockReset();
  betaStream.mockReset();
  betaStream.mockReturnValue({
    finalMessage: async () => ({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(ITEMS) }],
      usage: {},
    }),
    request_id: "req_test",
  });
  process.env.ANTHROPIC_API_KEY = "__qa-not-a-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

function sentContent(): { type: string; text?: string }[] {
  const body = betaStream.mock.calls[0]?.[0] as { messages: { content: { type: string; text?: string }[] }[] };
  return body.messages[0]!.content;
}

describe("the request for a PDF", () => {
  it("is the document and the prompt, and nothing after them, for a whole file", async () => {
    const { extractSpecDocument } = await import("@/lib/anthropic");
    expect(await extractSpecDocument(PDF, "shop_drawings")).toMatchObject({ ok: true });
    const content = sentContent();
    expect(content.map((block) => block.type)).toEqual(["document", "text"]);
  });

  it("adds the part's instruction AFTER the prompt for a part, and still sends the whole file", async () => {
    const { extractSpecDocument } = await import("@/lib/anthropic");
    const instruction = partInstruction(PART)!;
    expect(await extractSpecDocument(PDF, "shop_drawings", { instruction, part: PART })).toMatchObject({ ok: true });
    const content = sentContent();
    expect(content.map((block) => block.type)).toEqual(["document", "text", "text"]);
    expect((content[0] as unknown as { source: { data: string } }).source.data).toBe(PDF.base64);
    expect(content[2]!.text).toBe(instruction);
  });
});

describe("the source of a workbook", () => {
  async function workbook(): Promise<Buffer> {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Furniture").addRows([
      ["Code", "Item"],
      ["SX11A", "Lounge chair"],
    ]);
    book.addWorksheet("Finishes").addRows([
      ["Code", "Finish"],
      ["FAB-01", "Wool bouclé"],
    ]);
    book.addWorksheet("Notes").addRows([["General notes"]]);
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("holds every sheet for a whole file, as before", async () => {
    const { prepareDocumentSource } = await import("@/lib/intake-source");
    const source = await prepareDocumentSource(await workbook(), "Schedules.xlsx", XLSX);
    if (source.type !== "spreadsheet") throw new Error("not a spreadsheet");
    expect(source.sheets?.map((sheet) => sheet.sheet)).toEqual(["Furniture", "Finishes", "Notes"]);
  });

  it("holds only the part's sheets, in the text and in the sheets", async () => {
    const { prepareDocumentSource } = await import("@/lib/intake-source");
    const source = await prepareDocumentSource(await workbook(), "Schedules.xlsx", XLSX, {
      kind: "sheets",
      sheets: ["Notes", "Furniture"],
    });
    if (source.type !== "spreadsheet") throw new Error("not a spreadsheet");
    // The WORKBOOK's order, whatever order the part named them in.
    expect(source.sheets?.map((sheet) => sheet.sheet)).toEqual(["Furniture", "Notes"]);
    expect(source.text).toContain('<sheet name="Furniture">');
    expect(source.text).toContain('<sheet name="Notes">');
    expect(source.text).not.toContain("Finishes");
    expect(source.text).not.toContain("FAB-01");
  });

  it("fails in words on a sheet the workbook does not hold", async () => {
    const { prepareDocumentSource } = await import("@/lib/intake-source");
    await expect(
      prepareDocumentSource(await workbook(), "Schedules.xlsx", XLSX, { kind: "sheets", sheets: ["Furniture", "Lighting"] }),
    ).rejects.toThrow(
      "This read is for sheet “Lighting”, which this workbook does not hold. A sheet may have been renamed since the file was surveyed — upload it again.",
    );
  });

  it("refuses a part of the wrong kind for the file", async () => {
    const { prepareDocumentSource } = await import("@/lib/intake-source");
    await expect(prepareDocumentSource(await workbook(), "Schedules.xlsx", XLSX, PART)).rejects.toThrow(
      "This read is for some pages of a PDF, and this file is not a PDF.",
    );
    await expect(
      prepareDocumentSource(Buffer.from("%PDF-1.4"), "Pack.pdf", "application/pdf", { kind: "sheets", sheets: ["A"] }),
    ).rejects.toThrow("This read is for some sheets of a workbook, and this file is not an .xlsx workbook.");
  });
});

describe("the local replay key", () => {
  it("answers a part only from its own saved answer, and a whole file as before", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replay-part-"));
    const base64 = Buffer.from("%PDF synthetic pack").toString("base64");
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    fs.writeFileSync(path.join(dir, "whole.json"), JSON.stringify({ ok: true, rawResponse: { which: "whole" } }));
    fs.writeFileSync(path.join(dir, "part.json"), JSON.stringify({ ok: true, rawResponse: { which: "part" } }));
    fs.writeFileSync(
      path.join(dir, "index.json"),
      JSON.stringify({ [sha(base64)]: "whole.json", [sha(base64 + partKey(PART))]: "part.json" }),
    );
    const env = { LOCAL_STACK: "1", APP_ENV: "development", LOCAL_READ_REPLAY_DIR: dir };
    expect(replayedResponse(base64, env)).toEqual({ which: "whole" });
    expect(replayedResponse(base64, env, partKey(PART))).toEqual({ which: "part" });
    expect(replayedResponse(base64, env, partKey({ kind: "pages", ranges: [{ from: 12, to: 30 }] }))).toBeNull();
  });
});
