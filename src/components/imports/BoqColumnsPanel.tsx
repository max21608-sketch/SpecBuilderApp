"use client";

// Which column of a bill is which — said by a person, on the sheet itself.
//
// ============================================================================
// A BILL IS NEVER REFUSED FOR ITS HEADINGS; IT IS MAPPED HERE.
//
// The Aman pricing document headed its code column "Spec Code", and until
// 0040 that was the end of it: no header found, the run failed, and nothing on
// any screen let anybody say "that column is the code". This panel is where
// they say it. It shows the sheet's first rows as a grid, the row the headings
// are on, and one role per column pre-filled with what the reader already
// knew — each badged by WHERE that came from, because a mapping nobody can see
// the origin of is a mapping nobody checks.
//
// Four things about it are load-bearing.
//
//   * READING IS FREE AND WRITES ONLY THE DRAFT. "Read the bill with these
//     columns" re-reads the stored spreadsheet by code (`/api/imports/[id]/
//     columns`) and replaces this sheet's staged lines. No model, no charge,
//     nothing confirmed; the lines table appears underneath as it always did.
//   * THE SAME VALIDATION AS THE ROUTE, in words, before anything is sent
//     (`columnsFromSelections`, `columnMappingProblem` — one leaf, both sides).
//     A disabled button with no sentence beside it is a form nobody can finish.
//   * A SAVED LAYOUT IS NEVER APPLIED UNSEEN. The page keeps this panel open on
//     any sheet a layout read until the reviewer closes it once, and "Close"
//     records that they did.
//   * "REMEMBER" SAVES WHAT WAS READ, not what the selects say. A layout is
//     saved from the sheet's staged mapping, so it is offered only once the
//     selects match it — otherwise the name would go on a mapping that never
//     produced a line.
// ============================================================================
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import {
  BOQ_MAPPING_SOURCE_LABELS,
  BOQ_ROLES,
  BOQ_ROLE_LABELS,
  columnLetter,
  columnMappingProblem,
  columnsFromSelections,
  isBoqRole,
  type BoqColumnRef,
  type BoqMappingSource,
  type BoqReadRole,
  type BoqRole,
} from "@/lib/boq-roles";

/** The parts of a staged sheet this panel reads. All optional: a v3 sheet has none. */
export type ColumnsPanelSheet = {
  sheetName: string;
  headerRow: number;
  headerRows?: number;
  ignored: boolean;
  lines: unknown[];
  columns?: Partial<Record<BoqReadRole, BoqColumnRef>>;
  headings?: string[];
  mappingSource?: BoqMappingSource;
  layout?: { id: string; name: string } | null;
  mappingEvidence?: Partial<Record<BoqReadRole, string>>;
  needsColumns?: boolean;
  columnsNote?: string | null;
  columnsChecked?: boolean;
  preview?: string[][];
  /** What a model's reading dropped, in words (Step 2). */
  structure?: { notes?: string[] } | null;
};

/**
 * The badge under a select says where its role came from. A model's reading is
 * a guess (yellow) until a person has checked it; a saved layout is a person's
 * decision about ANOTHER bill (blue, worth a look); a heading the app knows is
 * plain; a select changed here and not yet read is amber, because what the
 * selects say is not yet what the lines were read with.
 */
const BADGE_TONE: Record<string, "plain" | "info" | "guess" | "warn"> = {
  [BOQ_MAPPING_SOURCE_LABELS.synonym]: "plain",
  [BOQ_MAPPING_SOURCE_LABELS.layout]: "info",
  [BOQ_MAPPING_SOURCE_LABELS.person]: "plain",
  [BOQ_MAPPING_SOURCE_LABELS.model]: "guess",
  "changed here": "warn",
};

/** The role each column is read as, in column order, from the staged mapping. */
function selectionsOf(sheet: ColumnsPanelSheet, width: number): (BoqRole | null)[] {
  const out: (BoqRole | null)[] = Array.from({ length: width }, () => null);
  for (const [role, ref] of Object.entries(sheet.columns ?? {})) {
    if (!ref || !isBoqRole(role)) continue;
    if (ref.index >= 0 && ref.index < width) out[ref.index] = role;
  }
  return out;
}

export default function BoqColumnsPanel({
  importId,
  sheetIndex,
  sheet,
  version,
  editable,
  sourceKept = true,
  onRead,
  onClose,
  onIgnoreSheet,
  onAsk,
  asking = false,
}: {
  importId: string;
  sheetIndex: number;
  sheet: ColumnsPanelSheet;
  /** The run's version the screen was loaded at; every write is fenced on it. */
  version: number;
  /** False once the bill is confirmed, or while the page is busy. */
  editable: boolean;
  /**
   * False where the bill was posted without its original being kept: there is
   * nothing to read again, so the panel says so rather than offering a read
   * the route will refuse.
   */
  sourceKept?: boolean;
  /**
   * After a successful write: the page reloads, THEN reports. A screen that
   * clears its banner on a successful load would otherwise swallow the message.
   */
  onRead: (message: string | null) => Promise<void>;
  /** Close the panel. Absent on a sheet that has no columns yet — it cannot be closed. */
  onClose?: () => void;
  /** "Not a bill — ignore this sheet": the sheet-level drop the page already has. */
  onIgnoreSheet: () => void;
  /**
   * "Ask the model to read the columns" — one small, charged read of this
   * sheet's layout. Absent where nothing can be read (no stored original, or
   * the bill is confirmed).
   */
  onAsk?: () => void;
  /** The model is reading this bill's columns right now. */
  asking?: boolean;
}) {
  const preview = useMemo(() => sheet.preview ?? [], [sheet.preview]);
  const width = preview.reduce((widest, row) => Math.max(widest, row.length), 0);
  const staged = useMemo(() => selectionsOf(sheet, width), [sheet, width]);

  const [headerRow, setHeaderRow] = useState<number | null>(sheet.headerRow > 0 ? sheet.headerRow : null);
  const [headerRows, setHeaderRows] = useState<1 | 2>(sheet.headerRows === 2 ? 2 : 1);
  const [selections, setSelections] = useState<(BoqRole | null)[]>(staged);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layoutName, setLayoutName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  // THE SAME TWO CHECKS THE ROUTE MAKES, before anything is sent.
  const mapped = columnsFromSelections(selections);
  const problem =
    mapped.problem ??
    (headerRow === null
      ? "Click the row number the column headings are on."
      : columnMappingProblem({ columns: mapped.columns, headerRow, headerRows, rowCount: preview.length, width }));

  /** A layout's or a model's mapping nobody has agreed to yet. */
  const needsCheck = (sheet.mappingSource === "layout" || sheet.mappingSource === "model") && !sheet.columnsChecked;

  const unchanged =
    !sheet.needsColumns &&
    headerRow === sheet.headerRow &&
    headerRows === (sheet.headerRows === 2 ? 2 : 1) &&
    selections.every((role, index) => (role === "ignore" ? null : role) === (staged[index] ?? null));

  /**
   * Click a row number: that row is the header. SHIFT-click the row directly
   * above or below the chosen one: the two are read as one header, the way a
   * heading merged down two rows is read — the lower of the two is the one the
   * items start under.
   */
  function pickHeader(rowNo: number, shift: boolean) {
    setError(null);
    if (shift && headerRow !== null && headerRows === 1 && Math.abs(rowNo - headerRow) === 1) {
      setHeaderRow(Math.max(rowNo, headerRow));
      setHeaderRows(2);
      return;
    }
    setHeaderRow(rowNo);
    setHeaderRows(1);
  }

  async function read() {
    if (problem || headerRow === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ lines: number; skippedRows: number; ignored: boolean }>(
        `/api/imports/${importId}/columns`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sheetIndex, headerRow, headerRows, columns: mapped.columns, version }),
        },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const lines = res.data.lines ?? 0;
      await onRead(
        lines === 0
          ? `“${sheet.sheetName}” read with these columns, and no line was found under the header.`
          : `“${sheet.sheetName}” read with these columns: ${lines} line${lines === 1 ? "" : "s"}. Nothing is confirmed yet.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!onClose) return;
    // A sheet a saved layout or a MODEL read stays open until somebody has
    // LOOKED, and closing it is that record — for a model's reading it is also
    // what the confirm waits for. Anything else just closes.
    if (needsCheck && editable) {
      setBusy(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/imports/${importId}/columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "checked", sheetIndex, version }),
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        await onRead(null);
      } finally {
        setBusy(false);
      }
    }
    onClose();
  }

  async function remember() {
    const name = layoutName.trim();
    if (!name) {
      setError("Give the layout a name — the specifier and the document, so the next person knows which it is.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await apiFetch<{ layout: { name: string } }>(`/api/boq-layouts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ importId, sheetIndex, name }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(res.data.layout?.name ?? name);
      setLayoutName("");
    } finally {
      setBusy(false);
    }
  }

  if (preview.length === 0) {
    // A v3 sheet: staged before a bill's first rows were kept. There is no
    // grid to show, and the way to one is reading the bill again.
    return (
      <Note tone="info" title="This bill was staged before its columns were recorded.">
        Read it again from the stored spreadsheet to see and change its columns. That replaces the lines below and
        the choices made on them.
      </Note>
    );
  }

  const sourceLabel = sheet.mappingSource ? BOQ_MAPPING_SOURCE_LABELS[sheet.mappingSource] : null;
  const readButton = (
    <Button
      variant="primary"
      size="xs"
      disabled={!editable || busy || asking || problem !== null || !sourceKept}
      onClick={() => void read()}
    >
      {busy ? "Reading…" : "Read the bill with these columns"}
    </Button>
  );

  return (
    <section
      aria-label={`Columns of ${sheet.sheetName}`}
      className="mt-4 rounded-[10px] border border-neutral-200 bg-white"
    >
      <h2 className="flex flex-wrap items-center gap-2.5 border-b border-neutral-200 px-4 py-3 text-th font-bold uppercase tracking-wider text-neutral-500">
        Columns
        {sheet.layout && sheet.mappingSource === "layout" && (
          <span className="font-medium normal-case tracking-normal text-neutral-700">
            Read with the <b>{sheet.layout.name}</b> layout
          </span>
        )}
        {sheet.mappingSource === "model" && (
          <span className="font-medium normal-case tracking-normal text-neutral-700">Read by the model</span>
        )}
        <span className="flex-1" />
        {/* THE PRIMARY ACTION IS IN THE HEADER ROW, beside the model's, so both
            are visible without scrolling past a 25-row grid at 1920 × 1080. */}
        <span className="flex flex-wrap items-center gap-2 normal-case tracking-normal">
          {onAsk && (
            <Button
              size="xs"
              disabled={!editable || busy || asking || !sourceKept}
              title="One small read of this sheet's layout, charged. The model never copies a cell."
              onClick={onAsk}
            >
              {asking ? "Reading the columns…" : "Ask the model to read the columns"}
            </Button>
          )}
          {readButton}
          {onClose && (
            <Button size="xs" disabled={busy || asking} onClick={() => void close()}>
              {needsCheck ? "The columns are right — close" : "Close"}
            </Button>
          )}
        </span>
      </h2>

      <div className="px-4 pt-3 text-[12.5px] leading-5 text-neutral-700">
        {sheet.needsColumns ? (
          <p>{sheet.columnsNote ?? "Nobody has said which column is which on this sheet yet. Set the columns below."}</p>
        ) : sheet.mappingSource === "model" ? (
          <p>
            The model read this sheet&rsquo;s header, its columns and its row kinds; every cell below was then read
            by code from the stored spreadsheet. Check each column against the sheet, and the row kinds in the lines
            table, then press <b>The columns are right</b> — the confirm waits for it.
          </p>
        ) : sheet.mappingSource === "layout" ? (
          <p>
            A saved layout matched every heading it names on this sheet. Check each column below against the sheet
            before confirming — a layout is a person&rsquo;s decision about a different bill.
          </p>
        ) : (
          <p>
            Each column below says what it is read as and where that came from. Change any of them and read the
            bill again; reading again replaces this sheet&rsquo;s {sheet.lines.length} line
            {sheet.lines.length === 1 ? "" : "s"} and the choices made on them. Prices, costs and pictures are never
            read.
          </p>
        )}
        <p className="mt-1 text-xs text-neutral-500">
          Click a row number to make it the header. Shift-click the row next to it to read two rows as one header.
          {onAsk && " Asking the model is one small read, charged; setting the columns yourself is free."}
        </p>
        {(sheet.structure?.notes?.length ?? 0) > 0 && (
          <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
            {sheet.structure?.notes?.map((note) => <li key={note}>{note}</li>)}
          </ul>
        )}
      </div>

      {/* THE GRID. Its own bounded scroll box in both directions, so the
          column row can stick to the top of it: this wrapper is MEANT to be
          the scroll container, which is the opposite of the chase table's
          trap, where a wrapper became one by accident. */}
      <div className="mx-4 mt-3 max-h-[440px] overflow-auto rounded border border-neutral-200">
        <Table>
          <thead>
            <tr>
              <Th className="sticky left-0 top-0 z-20 border-r">Row</Th>
              {Array.from({ length: width }, (_, index) => {
                const role = selections[index] ?? null;
                const stagedRole = staged[index] ?? null;
                const badge =
                  role && role !== "ignore" && role === stagedRole && sourceLabel
                    ? sourceLabel
                    : role !== stagedRole
                      ? "changed here"
                      : null;
                return (
                  <Th key={index} className="sticky top-0 z-10 min-w-[160px] align-top normal-case tracking-normal">
                    <span className="block font-mono text-[11px] text-neutral-500">{columnLetter(index)}</span>
                    <select
                      aria-label={`Column ${columnLetter(index)} is read as`}
                      value={role ?? ""}
                      disabled={!editable || busy}
                      onChange={(event) => {
                        setError(null);
                        const next = [...selections];
                        next[index] = isBoqRole(event.target.value) ? event.target.value : null;
                        setSelections(next);
                      }}
                      className="mt-1 block w-full rounded border border-neutral-300 px-1.5 py-1 text-xs font-normal text-neutral-900 disabled:opacity-50"
                    >
                      <option value="">— not read —</option>
                      {BOQ_ROLES.filter((option) => option !== "ignore").map((option) => (
                        <option key={option} value={option}>
                          {BOQ_ROLE_LABELS[option]}
                        </option>
                      ))}
                    </select>
                    {badge && (
                      <span className="mt-1 block">
                        <Chip tone={BADGE_TONE[badge] ?? "plain"}>{badge}</Chip>
                      </span>
                    )}
                    {role && role !== "ignore" && sheet.mappingEvidence?.[role as BoqReadRole] && role === stagedRole && (
                      <span className="mt-1 block text-[10.5px] font-normal text-neutral-500">
                        {sheet.mappingEvidence[role as BoqReadRole]}
                      </span>
                    )}
                  </Th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, rowIndex) => {
              const rowNo = rowIndex + 1;
              const isHeader = headerRow !== null && rowNo <= headerRow && rowNo > headerRow - headerRows;
              const above = headerRow !== null && rowNo <= headerRow - headerRows;
              return (
                <Tr key={rowNo} tone={isHeader ? "info" : "plain"} className={above ? "text-neutral-400" : undefined}>
                  <Td className="sticky left-0 z-[5] border-r bg-white !px-1 !py-1">
                    <button
                      type="button"
                      disabled={!editable || busy}
                      aria-pressed={isHeader}
                      aria-label={`Row ${rowNo} is the header`}
                      onClick={(event) => pickHeader(rowNo, event.shiftKey)}
                      className={`w-full rounded px-1.5 py-0.5 text-right font-mono text-[11px] disabled:cursor-not-allowed ${
                        isHeader ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                      }`}
                    >
                      {rowNo}
                    </button>
                  </Td>
                  {Array.from({ length: width }, (_, index) => (
                    <Td
                      key={index}
                      className={`max-w-[260px] !py-1 text-[12px] ${isHeader ? "font-semibold text-neutral-900" : ""} ${
                        selections[index] && selections[index] !== "ignore" ? "" : "text-neutral-400"
                      }`}
                    >
                      <span className="block truncate" title={row[index] ?? ""}>
                        {row[index] ?? ""}
                      </span>
                    </Td>
                  ))}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <p className="mx-4 mt-1 text-[11px] text-neutral-500">
        The first {preview.length} rows of the sheet. Every row under the header is read.
      </p>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Button disabled={!editable || busy} onClick={onIgnoreSheet}>
          Not a bill — ignore this sheet
        </Button>
        <span className="text-xs text-neutral-500">Free — the stored spreadsheet is read by code. Nothing is confirmed.</span>
      </div>

      {!sourceKept && (
        <p className="px-4 pb-3 text-[12.5px] text-amber-800">
          The original of this bill was not kept when it was uploaded, so it cannot be read with new columns. Upload
          the file again.
        </p>
      )}
      {problem && editable && sourceKept && (
        <p className="px-4 pb-3 text-[12.5px] text-amber-800" role="status">
          {problem}
        </p>
      )}
      {error && (
        <div className="px-4 pb-3">
          <Note tone="danger" className="mt-0">
            {error}
          </Note>
        </div>
      )}

      {/* REMEMBER — only once what the selects say is what was read. */}
      {!sheet.needsColumns && editable && (
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-4 py-3 text-[12.5px]">
          <label className="text-neutral-700" htmlFor={`layout-name-${sheetIndex}`}>
            Remember these columns as
          </label>
          <input
            id={`layout-name-${sheetIndex}`}
            value={layoutName}
            disabled={busy || !unchanged}
            onChange={(event) => setLayoutName(event.target.value)}
            placeholder="Specifier — document"
            className="w-72 rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50"
          />
          <Button size="xs" disabled={busy || !unchanged || layoutName.trim() === ""} onClick={() => void remember()}>
            Remember
          </Button>
          <span className="text-xs text-neutral-500">
            {unchanged
              ? "The next bill whose headings match every one of these reads on its own, with this panel open."
              : "Read the bill with these columns first — a layout remembers what was read."}
          </span>
          {saved && (
            <span className="w-full text-xs text-emerald-800" role="status">
              Saved as “{saved}”.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
