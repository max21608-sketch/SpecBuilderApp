// One charged read of a specification document, made of one call or of
// several over a spreadsheet's row windows (`spreadsheet-windows.ts` has the
// measurement and the arithmetic).
//
// ============================================================================
// ONE ATTEMPT, SEVERAL CALLS, ONE RESULT.
//
// The worker owns the attempt — the claim, the fence, the staged write — and
// calls this where it used to call `extractSpecDocument` once. Everything the
// worker does with a result is unchanged, because this RETURNS one: the
// windows' proposals merged in row order, their usage summed, their raw
// responses kept side by side, and a line per window for `model_metadata`.
//
// A FAILURE IN ANY WINDOW IS THE READ'S FAILURE. The first one stops the
// others (their calls are aborted, so nothing more is spent on a result that
// will not be staged) and is returned as it came, prefixed with which part it
// was. Terminal stays terminal and retryable stays retryable — so a transient
// fault in window 3 releases the attempt and the redelivery reads ALL the
// windows again, paying twice for the ones that had landed. That is the cost
// of one attempt holding one result, and it is stated rather than hidden; the
// fix is windows as separate queue messages, which this does not build.
//
// Only the OBSERVATION kinds are windowed. A preamble or a drawing set is one
// call, as before: their shapes do not merge by row.
// ============================================================================
import { extractSpecDocument, type ExtractionFailure, type ExtractionResult } from "@/lib/anthropic";
import type { DocumentSource } from "@/lib/intake-source";
import type { DocumentKind } from "@/lib/spec-vocab";
import type { BillRowIndex } from "@/lib/bill-rows";
import type { RawProposal } from "@/lib/extraction-schema";
import {
  MAX_WINDOWS,
  ROWS_PER_WINDOW,
  WINDOWS_IN_FLIGHT,
  mergeWindowProposals,
  planRowWindows,
  windowInstruction,
  windowText,
  type RowWindow,
} from "@/lib/spreadsheet-windows";

/** One window's call, as `model_metadata.windows` records it. */
export type WindowCall = {
  part: number;
  rows: string;
  requestId: string | null;
  usage: unknown;
  elapsedMs: number;
  proposals: number;
};

function rowsOf(window: RowWindow): string {
  return window.slices.map((slice) => `${slice.sheet} ${slice.firstRow}-${slice.lastRow}`).join(", ");
}

function sumUsage(usages: unknown[]): { input_tokens: number; output_tokens: number } {
  let input = 0;
  let output = 0;
  for (const usage of usages) {
    const entry = (usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown };
    input += Number(entry.input_tokens) || 0;
    output += Number(entry.output_tokens) || 0;
  }
  return { input_tokens: input, output_tokens: output };
}

export async function readSpecDocument(
  source: DocumentSource,
  documentKind: DocumentKind,
  options: { signal?: AbortSignal; billRows?: BillRowIndex | null } = {},
): Promise<{ result: ExtractionResult; windows: WindowCall[] | null }> {
  if (source.type !== "spreadsheet" || !source.sheets) {
    return { result: await extractSpecDocument(source, documentKind, { signal: options.signal }), windows: null };
  }

  const bill = options.billRows ?? null;
  const sheetOf = (name: string) => bill?.sheets.find((entry) => entry.sheet === name) ?? null;
  const windows = planRowWindows(source.sheets, {
    // A bill's own heading, where the bill's confirm already found it.
    headerRowsFor: (name) => {
      const rows = sheetOf(name)?.headerRows ?? [];
      return rows.length > 0 ? rows : null;
    },
    // A fabric line stays with the item above it.
    keepWithPrevious: (name, row) => (sheetOf(name)?.rows.get(row)?.itemRow ?? null) !== null,
  });
  if (windows.length === 0) {
    return { result: await extractSpecDocument(source, documentKind, { signal: options.signal }), windows: null };
  }

  const rowCount = windows.reduce((total, window) => total + window.dataRows, 0);
  if (windows.length > MAX_WINDOWS) {
    return {
      result: {
        ok: false,
        retryable: false,
        code: "too_large",
        error: `This spreadsheet has ${rowCount} rows to read, and one read takes at most ${MAX_WINDOWS * ROWS_PER_WINDOW} (${MAX_WINDOWS} parts of ${ROWS_PER_WINDOW} rows). Split it into smaller files and upload them separately. Nothing was read or charged.`,
        elapsedMs: 0,
      },
      windows: null,
    };
  }

  const startedAt = Date.now();
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  const results: (ExtractionResult | null)[] = windows.map(() => null);
  let failure: { index: number; result: ExtractionFailure } | null = null;

  let next = 0;
  const lane = async () => {
    while (next < windows.length && !failure) {
      const index = next;
      next += 1;
      const window = windows[index]!;
      let result: ExtractionResult;
      try {
        result = await extractSpecDocument({ type: "spreadsheet", text: windowText(source.sheets!, window) }, documentKind, {
          signal,
          instruction: windowInstruction(window, windows.length),
        });
      } catch (cause) {
        // `windowText` refusing a window too large to send: about THIS file.
        result = {
          ok: false,
          retryable: false,
          code: "too_large",
          error: cause instanceof Error ? cause.message : String(cause),
          elapsedMs: 0,
        };
      }
      results[index] = result;
      if (!result.ok && !failure) {
        failure = { index, result };
        stop.abort();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WINDOWS_IN_FLIGHT, windows.length) }, lane));

  const calls: WindowCall[] = windows.map((window, index) => {
    const result = results[index];
    return {
      part: index + 1,
      rows: rowsOf(window),
      requestId: result?.ok ? result.requestId : (result?.requestId ?? null),
      usage: result?.usage ?? null,
      elapsedMs: result?.elapsedMs ?? 0,
      proposals: result?.ok && result.output.outputKind === "observations" ? result.output.data.proposals.length : 0,
    };
  });

  const failed = failure as { index: number; result: ExtractionFailure } | null;
  if (failed) {
    const prefix = windows.length > 1 ? `Part ${failed.index + 1} of ${windows.length} (rows ${rowsOf(windows[failed.index]!)}): ` : "";
    return {
      result: { ...failed.result, error: `${prefix}${failed.result.error}`, usage: sumUsage(calls.map((call) => call.usage)) },
      windows: calls,
    };
  }

  const outputs: RawProposal[][] = [];
  const notes: string[] = [];
  let model = "";
  for (const result of results) {
    if (!result?.ok || result.output.outputKind !== "observations") {
      // Unreachable for an observation kind; said rather than assumed.
      return {
        result: {
          ok: false,
          retryable: false,
          code: "schema",
          error: "A part of this document came back in a shape that cannot be merged by row.",
          elapsedMs: Date.now() - startedAt,
        },
        windows: calls,
      };
    }
    outputs.push(result.output.data.proposals);
    if (result.output.data.documentNotes && !notes.includes(result.output.data.documentNotes)) {
      notes.push(result.output.data.documentNotes);
    }
    model = result.model;
  }

  const firstOk = results[0];
  return {
    result: {
      ok: true,
      output: {
        outputKind: "observations",
        data: { proposals: mergeWindowProposals(windows, outputs), documentNotes: notes.length ? notes.join("\n") : null },
      },
      model,
      rawResponse: windows.length === 1 && firstOk?.ok ? firstOk.rawResponse : { windows: results.map((result) => (result?.ok ? result.rawResponse : null)) },
      usage: windows.length === 1 && firstOk?.ok ? firstOk.usage : sumUsage(calls.map((call) => call.usage)),
      requestId: firstOk?.ok ? firstOk.requestId : null,
      elapsedMs: Date.now() - startedAt,
    },
    windows: windows.length > 1 ? calls : null,
  };
}
