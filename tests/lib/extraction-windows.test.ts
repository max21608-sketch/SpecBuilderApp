// One charged read made of several calls (audit H4: `extraction-windows.ts`
// had no direct test). Pure: the model call is stubbed, so nothing is spent,
// and every row is invented.
//
// What the module's header promises, held here:
//   - a document that is not a spreadsheet, or one with no rows, is ONE call;
//   - a long sheet is read in windows of `ROWS_PER_WINDOW`, at most
//     `WINDOWS_IN_FLIGHT` at once, and past `MAX_WINDOWS` it is refused
//     before any call, in words, with nothing charged;
//   - the windows' proposals come back as one list in row order, their usage
//     summed and a line per window for `model_metadata`;
//   - a failure in any window is the read's failure: the others are aborted,
//     no further window starts, and the error names the part;
//   - a confirmed bill's own heading rows and its fabric lines shape the
//     windows.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetData } from "read-excel-file/node";
import type { ExtractionFailure, ExtractionOptions, ExtractionResult } from "@/lib/anthropic";
import type { DocumentSource } from "@/lib/intake-source";
import type { RawProposal } from "@/lib/extraction-schema";
import type { BillRowIndex } from "@/lib/bill-rows";
import { MAX_WINDOWS, ROWS_PER_WINDOW, WINDOWS_IN_FLIGHT } from "@/lib/spreadsheet-windows";

type Call = { source: DocumentSource; options: ExtractionOptions; settle: (result: ExtractionResult) => void };
const model = vi.hoisted(() => ({
  calls: [] as Call[],
  inFlight: 0,
  peak: 0,
  /** How a call answers on its own; null leaves it for the test to settle. */
  answer: null as null | ((call: Call, index: number) => ExtractionResult),
}));

vi.mock("@/lib/anthropic", () => ({
  extractSpecDocument: (source: DocumentSource, _kind: string, options: ExtractionOptions = {}) =>
    new Promise<ExtractionResult>((resolve) => {
      model.inFlight += 1;
      model.peak = Math.max(model.peak, model.inFlight);
      const call: Call = {
        source,
        options,
        settle: (result) => {
          model.inFlight -= 1;
          resolve(result);
        },
      };
      model.calls.push(call);
      const index = model.calls.length - 1;
      // Answer on a later tick, so the lanes genuinely overlap.
      if (model.answer) setTimeout(() => call.settle(model.answer!(call, index)), 0);
    }),
}));

import { readSpecDocument } from "@/lib/extraction-windows";

beforeEach(() => {
  model.calls.length = 0;
  model.inFlight = 0;
  model.peak = 0;
  model.answer = null;
});

/** A heading row, then `n` item rows from row 2, each "ZZ-<row>". */
function sheet(n: number): SheetData {
  return [["Code", "Item Description", "Qty"], ...Array.from({ length: n }, (_, i) => [`ZZ-${i + 2}`, `Item ${i + 2}`, 1])];
}

function spreadsheet(n: number, name = "S"): DocumentSource {
  return { type: "spreadsheet", text: "(the whole workbook)", sheets: [{ sheet: name, data: sheet(n) }] };
}

function proposal(row: number | null): RawProposal {
  return { refRaw: row === null ? null : `ZZ-${row}`, attributeRaw: "Finish", valueRaw: "TIM-21", page: null, sourceSheet: null, sourceRow: row, confidence: null, note: null };
}

/** The first data row a window's text was sent, read back off the numbered text. */
function firstRowOf(call: Call): number | null {
  const text = (call.source as { text?: string }).text ?? "";
  const rows = [...text.matchAll(/^(\d+): /gm)].map((match) => Number(match[1]));
  return rows.filter((row) => row !== 1)[0] ?? null;
}

/** A successful window: one proposal on its first data row. */
function ok(call: Call, index: number): ExtractionResult {
  return {
    ok: true,
    output: { outputKind: "observations", data: { proposals: [proposal(firstRowOf(call))], documentNotes: "Notes once." } },
    model: "claude-test",
    rawResponse: { window: index },
    usage: { input_tokens: 100, output_tokens: 10 },
    requestId: `req-${index}`,
    elapsedMs: 5,
  };
}

function failure(retryable: boolean): ExtractionFailure {
  return { ok: false, retryable, code: retryable ? "overloaded" : "refusal", error: "The model said no.", elapsedMs: 1 };
}

describe("one call where there is nothing to window", () => {
  it("a PDF is one call, with no window lines", async () => {
    model.answer = ok;
    const { result, windows } = await readSpecDocument({ type: "pdf", base64: "JVBERi0=" }, "ffe_schedule");
    expect(model.calls).toHaveLength(1);
    expect(windows).toBeNull();
    expect(result.ok).toBe(true);
    expect(model.calls[0]!.options.instruction).toBeUndefined();
  });

  it("a spreadsheet with no rows to read is one call of the whole text", async () => {
    model.answer = ok;
    const { windows } = await readSpecDocument(
      { type: "spreadsheet", text: "(empty)", sheets: [{ sheet: "S", data: [[null, null]] }] },
      "ffe_schedule",
    );
    expect(model.calls).toHaveLength(1);
    expect((model.calls[0]!.source as { text: string }).text).toBe("(empty)");
    expect(windows).toBeNull();
  });

  it("a sheet within one window keeps that call's own raw response and usage", async () => {
    model.answer = ok;
    const { result, windows } = await readSpecDocument(spreadsheet(ROWS_PER_WINDOW), "ffe_schedule");
    expect(model.calls).toHaveLength(1);
    expect(windows).toBeNull();
    if (!result.ok) throw new Error(result.error);
    expect(result.rawResponse).toEqual({ window: 0 });
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 10 });
    expect(model.calls[0]!.options.instruction).toMatch(/numbered rows/);
    expect(model.calls[0]!.options.instruction).not.toMatch(/part 1 of/);
  });
});

describe("a long sheet, read in windows", () => {
  it("reads 300 rows in eight windows, never more than three at once, merged in row order", async () => {
    model.answer = ok;
    const { result, windows } = await readSpecDocument(spreadsheet(300), "ffe_schedule");
    const expected = Math.ceil(300 / ROWS_PER_WINDOW);
    expect(model.calls).toHaveLength(expected);
    expect(model.peak).toBe(WINDOWS_IN_FLIGHT);
    if (!result.ok || result.output.outputKind !== "observations") throw new Error("expected observations");
    expect(result.output.data.proposals.map((entry) => entry.sourceRow)).toEqual(
      Array.from({ length: expected }, (_, i) => 2 + i * ROWS_PER_WINDOW),
    );
    // One note, said once however many windows repeated it.
    expect(result.output.data.documentNotes).toBe("Notes once.");
    expect(result.usage).toEqual({ input_tokens: 100 * expected, output_tokens: 10 * expected });
    expect(result.rawResponse).toEqual({ windows: Array.from({ length: expected }, (_, i) => ({ window: i })) });
    expect(windows?.map((entry) => [entry.part, entry.rows, entry.proposals])).toEqual(
      Array.from({ length: expected }, (_, i) => [i + 1, `S ${2 + i * 40}-${Math.min(301, 41 + i * 40)}`, 1]),
    );
    // Each call is told which part it is.
    expect(model.calls[2]!.options.instruction).toMatch(new RegExp(`part 3 of ${expected}`));
  });

  it("refuses a sheet past the most one read takes BEFORE any call, saying the numbers", async () => {
    model.answer = ok;
    const rows = MAX_WINDOWS * ROWS_PER_WINDOW + 1;
    const { result, windows } = await readSpecDocument(spreadsheet(rows), "ffe_schedule");
    expect(model.calls).toHaveLength(0);
    expect(windows).toBeNull();
    expect(result).toMatchObject({ ok: false, retryable: false, code: "too_large" });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain(`${rows} rows`);
    expect(result.error).toContain(`${MAX_WINDOWS * ROWS_PER_WINDOW}`);
    expect(result.error).toMatch(/Nothing was read or charged/);
  });

  it("stops at the first failed window: the others are aborted, no new one starts, and the part is named", async () => {
    const pending = readSpecDocument(spreadsheet(300), "ffe_schedule");
    await vi.waitFor(() => expect(model.calls).toHaveLength(WINDOWS_IN_FLIGHT));
    // Part 2 fails; parts 1 and 3 are still in flight.
    model.calls[1]!.settle(failure(true));
    await vi.waitFor(() => expect(model.calls[0]!.options.signal?.aborted).toBe(true));
    expect(model.calls[2]!.options.signal?.aborted).toBe(true);
    // The two survivors come back (an aborted call still answers).
    model.calls[0]!.settle(ok(model.calls[0]!, 0));
    model.calls[2]!.settle(failure(true));
    const { result, windows } = await pending;
    expect(model.calls).toHaveLength(WINDOWS_IN_FLIGHT);
    expect(result).toMatchObject({ ok: false, retryable: true, code: "overloaded" });
    if (result.ok) throw new Error("expected a failure");
    expect(result.error).toBe(`Part 2 of 8 (rows S 42-81): The model said no.`);
    // What the windows that did answer cost is still counted.
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 10 });
    expect(windows?.[1]?.requestId).toBeNull();
  });

  it("keeps a terminal failure terminal", async () => {
    model.answer = (call, index) => (index === 0 ? failure(false) : ok(call, index));
    const { result } = await readSpecDocument(spreadsheet(95), "ffe_schedule");
    expect(result).toMatchObject({ ok: false, retryable: false, code: "refusal" });
  });

  it("aborts every window when the caller's own signal fires", async () => {
    const caller = new AbortController();
    const pending = readSpecDocument(spreadsheet(95), "ffe_schedule", { signal: caller.signal });
    await vi.waitFor(() => expect(model.calls).toHaveLength(3));
    caller.abort();
    expect(model.calls.every((call) => call.options.signal?.aborted)).toBe(true);
    for (const [index, call] of model.calls.entries()) call.settle(ok(call, index));
    await pending;
  });
});

describe("a confirmed bill shapes its windows", () => {
  it("repeats the bill's own heading rows and keeps a fabric line with the item above it", async () => {
    model.answer = ok;
    const data: SheetData = [
      ["Example Project"],
      ["Code", "Item Description", "Qty"],
      ...Array.from({ length: 45 }, (_, i) => [`ZZ-${i + 3}`, `Item ${i + 3}`, 1]),
    ];
    // Row 42 opens window two under a plain plan; here it is a fabric line
    // under row 41, so it is read with it.
    const billRows: BillRowIndex = {
      billRunId: "00000000-0000-4000-8000-000000000001",
      sheets: [
        {
          sheet: "S",
          headerRows: [2],
          rows: new Map([[42, { recordId: "r41", codeRaw: "ZZ-42", itemRow: 41 }]]),
        },
      ],
    };
    const { windows } = await readSpecDocument({ type: "spreadsheet", text: "", sheets: [{ sheet: "S", data }] }, "ffe_schedule", {
      billRows,
    });
    expect(windows?.map((entry) => entry.rows)).toEqual(["S 1-42", "S 43-47"]);
    const second = (model.calls[1]!.source as { text: string }).text;
    expect(second).toMatch(/^2: \["Code","Item Description","Qty"\]$/m);
    expect(second).not.toMatch(/^1: /m);
  });
});
