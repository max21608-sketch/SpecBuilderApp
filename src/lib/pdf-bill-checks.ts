// What code can check of a bill the model TRANSCRIBED from a PDF (workstream
// C2), and what the staged bill keeps so it can. A LEAF, like
// `pdf-bill-source.ts`: the bill review is a client component and computes
// these from the staged document, so nothing here may import the model client.
//
// ============================================================================
// THREE CHECKS, RE-RUN ON EVERY READ AND NEVER STORED, so a person changing
// the columns re-checks against the new mapping:
//
//   1. A total the PDF prints under the QUANTITY column against the sum of the
//      lines it totals (its page, its section, or the whole document). A
//      mismatch flags EVERY line it covers: code cannot tell which of them —
//      or the total itself — was mis-copied, and a person can, from the page.
//   2. Each line's code against its page's own text layer, but only on a page
//      whose text covers the table — at least one transcribed code IS in it.
//      A page whose only text is a stamp or a title block would otherwise flag
//      every line on it. A scan has no text, and the summary says so.
//   3. Every line the model said it could not read with certainty.
//
// None of them refuses the confirm. Max's approval (2026-10-15) is that every
// transcribed line is MARKED and CHECKED BY A PERSON; the person reviewing the
// bill is the gate, as for every bill, and these say where to look first.
// ============================================================================

/** A total the PDF printed, as the model transcribed it. */
export type PrintedTotal = {
  page: number;
  label: string;
  /** Which column of the transcribed sheet it totals, 0-based. */
  column: number;
  /** As printed. */
  valueRaw: string;
  scope: "page" | "section" | "document";
};

/**
 * WHAT A TRANSCRIBED BILL REMEMBERS, on the staged document beside
 * `pdfSource` (whose `pages` already say each line's page). Survives a
 * re-read of the columns, the `rowImages` rule: re-staging re-reads the
 * workbook, and these belong to the PDF, not to a staging.
 */
export type PdfTranscription = {
  /** `waiting`: registered, the model not yet asked. `done`: the sheet below is the transcription. */
  state: "waiting" | "done";
  /** Why code could not read it, in one short sentence (C1's refusal, or "it has no text layer"). */
  reason: string;
  pageCount: number | null;
  /** The model that served it, and when. Null while waiting. */
  model?: string | null;
  at?: string | null;
  totals?: PrintedTotal[];
  /**
   * Per page (index 0 is page 1), the PDF's own text for it, or null where
   * the page has none. A scanned page is null. Bounded per page.
   */
  pageText?: (string | null)[];
  /** Workbook row (a staged line's `lineNo`) → what the model doubted about it. */
  rowUnclear?: Record<string, string[]>;
  /** The model's notes and anything code dropped or doubted while merging. */
  notes?: string[];
};

/** What the checks need of a staged line. */
export type CheckedLine = {
  lineNo: number;
  code: string | null;
  qty: number | null;
  rowKind?: string;
};

export type LineCheck = {
  code: "total_mismatch" | "code_not_in_text" | "unclear";
  /** A few words, for the needs-you list and the line. */
  words: string;
  /** The whole sentence, behind "Why". */
  why: string;
};

export type TranscriptionCheckResult = {
  byLine: Map<number, LineCheck[]>;
  /** One sentence per check, whether it passed, failed or could not run. */
  summary: string[];
};

/** A printed figure as a number: `1,240` is 1240, `12 nr` is 12. Null when it is not one figure. */
export function printedNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "").replace(/(nr|no|ea|pcs?|units?)$/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const foldForText = (value: string) => value.replace(/\s+/g, "").toUpperCase();
/** Lines that are not counted in a printed total of quantities. */
const NOT_COUNTED = new Set(["section", "subtotal", "blank"]);

/** The checks, line by line. Pure. `pageOf` is `pdfPageOfLine` over the staged `pdfSource`. */
export function transcriptionChecks(input: {
  lines: readonly CheckedLine[];
  /** The column the bill's quantity is read from, or null while nobody has said. */
  qtyColumn: number | null;
  pageOf: (lineNo: number) => number | null;
  transcription: Pick<PdfTranscription, "totals" | "pageText" | "rowUnclear">;
}): TranscriptionCheckResult {
  const { lines, pageOf } = input;
  const totals = input.transcription.totals ?? [];
  const pageText = input.transcription.pageText ?? [];
  const rowUnclear = input.transcription.rowUnclear ?? {};
  const byLine = new Map<number, LineCheck[]>();
  const summary: string[] = [];
  const add = (lineNo: number, check: LineCheck) => {
    const list = byLine.get(lineNo) ?? [];
    if (!list.some((existing) => existing.code === check.code && existing.words === check.words)) list.push(check);
    byLine.set(lineNo, list);
  };
  const ordered = [...lines].sort((a, b) => a.lineNo - b.lineNo);

  // 1. Printed totals of the quantity.
  const qtyTotals = input.qtyColumn === null ? [] : totals.filter((total) => total.column === input.qtyColumn);
  if (input.qtyColumn === null) summary.push("The quantity column is not set yet, so the printed totals were not checked.");
  else if (qtyTotals.length === 0) summary.push("The PDF prints no total of the quantities, so they could not be added up against one.");
  for (const total of qtyTotals) {
    const printed = printedNumber(total.valueRaw);
    const label = total.label ? `“${total.label}”` : "total";
    if (printed === null) {
      summary.push(`Page ${total.page}'s ${label} (${total.valueRaw || "blank"}) is not one figure, so it was not checked.`);
      continue;
    }
    let covered: CheckedLine[];
    if (total.scope === "document") covered = ordered;
    else if (total.scope === "page") covered = ordered.filter((line) => pageOf(line.lineNo) === total.page);
    else {
      // A section: the lines up to its page, back to the last section heading.
      const upTo = ordered.filter((line) => (pageOf(line.lineNo) ?? 0) <= total.page);
      const start = upTo.map((line) => line.rowKind).lastIndexOf("section");
      covered = upTo.slice(start + 1);
    }
    covered = covered.filter((line) => !NOT_COUNTED.has(line.rowKind ?? "item"));
    const sum = covered.reduce((acc, line) => acc + (line.qty ?? 0), 0);
    const where =
      total.scope === "document" ? "the whole bill" : total.scope === "section" ? `the section ending on page ${total.page}` : `page ${total.page}`;
    if (Math.abs(sum - printed) < 1e-9) {
      summary.push(`The ${label} for ${where} (${total.valueRaw}) equals the quantities transcribed under it.`);
      continue;
    }
    const why = `The PDF prints ${total.valueRaw} as the ${label} for ${where}, and the quantities transcribed under it add up to ${sum}. One of them, or the total, was copied wrong: check each against page ${total.page}.`;
    summary.push(why);
    const words = `Quantities on ${total.scope === "document" ? "the bill" : `p.${total.page}`} add to ${sum}, not ${total.valueRaw}`;
    for (const line of covered) add(line.lineNo, { code: "total_mismatch", words, why });
  }

  // 2. Codes against the text layer.
  const pages = new Map<number, CheckedLine[]>();
  for (const line of ordered) {
    const page = pageOf(line.lineNo);
    if (page === null || !line.code?.trim()) continue;
    pages.set(page, [...(pages.get(page) ?? []), line]);
  }
  const textless: number[] = [];
  const notCovering: number[] = [];
  for (const [page, onPage] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
    const raw = pageText[page - 1] ?? null;
    if (!raw || !raw.trim()) {
      textless.push(page);
      continue;
    }
    const text = foldForText(raw);
    const found = new Set(onPage.filter((line) => text.includes(foldForText(line.code!))));
    if (found.size === 0) {
      notCovering.push(page);
      continue;
    }
    for (const line of onPage) {
      if (found.has(line)) continue;
      add(line.lineNo, {
        code: "code_not_in_text",
        words: `Code ${line.code} is not in p.${page}'s text`,
        why: `Page ${page} carries text a program can read, and the code ${line.code} transcribed on this line is not in it. The page may print it differently: check it against page ${page}.`,
      });
    }
  }
  if (textless.length > 0) {
    summary.push(
      textless.length === pages.size
        ? "No page of this PDF carries text a program can read, so no code could be checked against it."
        : `Page${textless.length === 1 ? "" : "s"} ${textless.join(", ")} carr${textless.length === 1 ? "ies" : "y"} no text a program can read, so the codes there could not be checked against it.`,
    );
  }
  if (notCovering.length > 0) {
    summary.push(
      `The text on page${notCovering.length === 1 ? "" : "s"} ${notCovering.join(", ")} holds none of the transcribed codes (it is not the table's), so the codes there were not checked against it.`,
    );
  }

  // 3. What the model could not read.
  for (const line of ordered) {
    const unclear = rowUnclear[String(line.lineNo)] ?? [];
    if (unclear.length === 0) continue;
    const page = pageOf(line.lineNo);
    add(line.lineNo, {
      code: "unclear",
      words: `Unclear: ${unclear.slice(0, 2).join(", ")}${unclear.length > 2 ? "…" : ""}`,
      why: `The model could not read ${unclear.join("; ")} on this line with certainty${page ? `: check it against page ${page}` : ""}.`,
    });
  }

  return { byLine, summary };
}

/** What `intake_runs.model_metadata.transcription` holds: the claim, and every call paid for. */
export type TranscriptionRecord = {
  pending?: { requestId: string; at: string } | null;
  lastRequestId?: string | null;
  model?: string;
  /** The last attempt's outcome in words. */
  outcome?: { at: string; ok: boolean; text: string; charged: boolean } | null;
  calls?: { part: number; pages: string; ok: boolean; requestId: string | null; usage: unknown; elapsedMs: number; model: string | null; error?: string; at: string }[];
};

/**
 * A claim this old is a request that died. The model's deadline (740 s) and a
 * minute; a literal, because this leaf may not import the server's timings.
 */
export const TRANSCRIPTION_CLAIM_MS = 800_000;

/** Is a transcription in flight right now, by its record? */
export function transcriptionPending(record: TranscriptionRecord | null | undefined, now = Date.now()): boolean {
  const pending = record?.pending;
  return Boolean(pending && now - new Date(pending.at).getTime() < TRANSCRIPTION_CLAIM_MS);
}
