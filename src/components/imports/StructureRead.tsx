"use client";

// The model's read of a bill's STRUCTURE, as the review screen drives it: the
// automatic read, the press that asks again, the polling while another tab
// reads, what the screen says meanwhile, and each sheet's Columns panel. Moved
// out of src/app/dashboard/imports/[id]/page.tsx on 2026-11-06 (audit 5.3, cut A).
//
// The model reads the layout, never a cell (CLAUDE.md, "A bill is never
// refused; it is mapped"); code then reads every cell from the stored file.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import Note from "@/components/ui/Note";
import BoqColumnsPanel from "@/components/imports/BoqColumnsPanel";
import { sheetColumnsId } from "@/lib/needs-you";
import { sheetWantsStructureRead } from "@/lib/boq-structure-wanted";
import type { BoqImport, Import, Sheet, StructureReadState } from "@/components/imports/use-boq-import";

/** A claim this old is a request that died, and the screen stops waiting on it. */
const STRUCTURE_CLAIM_MS = 330_000;

export function structurePending(state: StructureReadState | undefined): boolean {
  const pending = state?.pending;
  return Boolean(pending && Date.now() - new Date(pending.at).getTime() < STRUCTURE_CLAIM_MS);
}

/**
 * THE STRUCTURE READ'S STATE AND ITS TWO EFFECTS.
 *
 * The review page calls it AFTER its own next-step and pack effects and before
 * anything renders, which is where these lines sat on the page: effects run in
 * the order they are declared, so the automatic read is still dispatched after
 * those two reads, and on every document kind (it acts only on a bill).
 */
export function useStructureRead({
  id,
  data,
  load,
  setNotice,
}: { id: string } & Pick<BoqImport, "data" | "load" | "setNotice">) {
  /**
   * THE MODEL IS READING THIS BILL'S COLUMNS, from this tab — `all` for the
   * automatic read, or the sheet a panel's button asked about. A read another
   * tab started shows the same sentence, from the server's own claim.
   */
  const [asking, setAsking] = useState<"all" | number | null>(null);
  /** Why the last structure read did not land, with the retry beside it. */
  const [structureError, setStructureError] = useState<string | null>(null);
  /** Once per visit: the automatic read never fires twice from one screen. */
  const autoAsked = useRef(false);

  /**
   * ASK THE MODEL TO READ THE COLUMNS — one small read, charged. `sheetIndex`
   * absent is the automatic read of every live sheet nobody could map. A
   * request id per press, so a retried request is answered from the record
   * rather than read (and charged) again. Reload first, then report.
   */
  const askModel = useCallback(
    async (sheetIndex?: number) => {
      if (!data) return;
      setAsking(sheetIndex ?? "all");
      setStructureError(null);
      setNotice(null);
      try {
        const requestId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
        const res = await apiFetch<{ nothing?: boolean; charged?: number }>(`/api/imports/${id}/suggest-columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: data.import.version,
            requestId,
            ...(sheetIndex === undefined ? {} : { sheetIndex }),
          }),
        });
        await load(true);
        if (!res.ok) {
          const code = (res.data as { code?: string } | null)?.code;
          // Another tab's read is not a failure: this screen waits for it.
          if (code === "structure_read_running") setNotice(res.error);
          else setStructureError(res.error);
          return;
        }
        // No notice on success: the yellow banner that the reload brings up
        // says the same thing, on every sheet the model read, until the
        // reviewer checks it — two banners for one fact is one to ignore.
      } finally {
        setAsking(null);
      }
    },
    [data, id, load, setNotice],
  );

  /**
   * THE AUTOMATIC READ: once, the first time this screen opens a bill with a
   * live sheet nobody could map — or one the known headings mapped with no
   * quantity column (`sheetWantsStructureRead`) — and no structure read on
   * record. Never on a
   * bill whose original was not kept (there is nothing to re-read with the
   * answer), never while another tab's read is in flight, and never twice
   * from one visit.
   */
  useEffect(() => {
    if (!data || autoAsked.current) return;
    const bill = data.import;
    if (bill.source_kind !== "boq_xlsx" || bill.status !== "parsed" || bill.has_source === false) return;
    if (bill.parsed?.sourcePreserved === false) return;
    const state = bill.model_metadata?.structureRead;
    if (structurePending(state)) return;
    const wanted = (bill.parsed?.sheets ?? []).some((sheet) =>
      sheetWantsStructureRead(sheet, Boolean(state?.sheets?.[sheet.sheetName])),
    );
    if (!wanted) return;
    autoAsked.current = true;
    void askModel();
  }, [data, askModel]);

  /** Another tab is reading: look again quietly until its claim clears. */
  const otherTabReading = asking === null && structurePending(data?.import.model_metadata?.structureRead);
  useEffect(() => {
    if (!otherTabReading) return;
    const timer = setInterval(() => void load(true), 4000);
    return () => clearInterval(timer);
  }, [otherTabReading, load]);

  return { asking, structureError, askModel };
}

/** What the screen says while the model reads the columns, when it did not, and when it did and nobody has checked. */
export function StructureReadNotes({
  reading,
  asking,
  structureError,
  canAsk,
  onAskAgain,
  status,
  unchecked,
}: {
  reading: boolean;
  asking: "all" | number | null;
  structureError: string | null;
  /** Whether a read can be asked for at all: a parsed bill whose original was kept. */
  canAsk: boolean;
  onAskAgain: () => void;
  status: string;
  /** Live sheets whose columns a model read and nobody has agreed to. */
  unchecked: Pick<Sheet, "sheetName">[];
}) {
  return (
    <>
      {/* THE MODEL IS READING THE COLUMNS — said before it answers, with the
          charge, because the screen is otherwise a panel nobody should start
          filling in while the reading is about to replace it. */}
      {reading && (
        <Note tone="info" title="Reading the columns…">
          One small read, charged. The model reads the layout — the header, what each column is and which rows
          are finish lines, sections or subtotals — and code then reads every cell from the stored spreadsheet.
          {asking === null && " It was started from another tab or a moment ago; this screen shows the result when it lands."}
        </Note>
      )}
      {structureError && !reading && (
        <Note
          tone="warn"
          title="The model did not read the columns."
          actions={
            canAsk ? (
              <Button size="sm" onClick={onAskAgain}>
                Ask again
              </Button>
            ) : undefined
          }
        >
          {structureError} The Columns panel still works by hand, and that is free.
        </Note>
      )}
      {/* A MODEL'S COLUMNS, NOT YET AGREED TO. Yellow, because it is a guess
          until a person has looked; the confirm refuses until they say so. */}
      {status === "parsed" && unchecked.length > 0 && (
        <Note tone="guess" title="Columns and row kinds read by the model — check them.">
          {unchecked.length === 1 ? (
            <>
              On <span className="font-mono">{unchecked[0]?.sheetName}</span>, check each column on the panel and
              the Kind of each line, then press <b>The columns are right</b>.
            </>
          ) : (
            <>
              On {unchecked.map((sheet) => sheet.sheetName).join(", ")}, check each column and the Kind of each line,
              then press <b>The columns are right</b> on each.
            </>
          )}{" "}
          The model never typed a value: every code, description and quantity below was read by code.
        </Note>
      )}
    </>
  );
}

/**
 * ONE SHEET'S COLUMNS PANEL, where a "needs you" link about its columns lands,
 * and the free re-read offered when the panel has no rows to show.
 */
export function SheetColumns({
  run,
  sheet,
  sheetIndex,
  open,
  busy,
  reading,
  setPanel,
  onRead,
  onSetSheet,
  onAsk,
  onReadAgain,
}: {
  run: Pick<Import, "id" | "version" | "status" | "parsed" | "has_source">;
  sheet: Sheet;
  sheetIndex: number;
  open: boolean;
  busy: boolean;
  reading: boolean;
  setPanel: (open: boolean) => void;
  /** After the panel wrote: reload, then say what happened. */
  onRead: (message: string | null) => Promise<void>;
  onSetSheet: (patch: { ignored: boolean }) => Promise<void>;
  /** Asks the model about this sheet; absent where no read can be asked for. */
  onAsk: (() => void) | undefined;
  onReadAgain: () => Promise<void>;
}) {
  return (
    <>
      {/* Where a "needs you" link about this sheet's columns lands. */}
      <div id={sheetColumnsId(sheetIndex)} className="rounded-[10px]">
      {open && (
        <BoqColumnsPanel
          // Re-mounted when what was READ changes, so a successful read
          // shows the new mapping — and NOT on every autosave, which
          // bumps the version and would throw away half-set selects.
          key={`${sheetIndex}:${sheet.headerRow}:${sheet.headerRows ?? 1}:${JSON.stringify(sheet.columns ?? {})}`}
          importId={run.id}
          sheetIndex={sheetIndex}
          sheet={sheet}
          version={run.version}
          editable={run.status === "parsed"}
          sourceKept={run.parsed?.sourcePreserved !== false && run.has_source !== false}
          onRead={onRead}
          onClose={sheet.needsColumns ? undefined : () => setPanel(false)}
          onIgnoreSheet={() => {
            setPanel(false);
            void onSetSheet({ ignored: true });
          }}
          onAsk={onAsk}
          asking={reading}
        />
      )}
      </div>
      {open && (sheet.preview?.length ?? 0) === 0 && run.status === "parsed" && run.has_source && (
        <div className="mt-2">
          <Button size="sm" disabled={busy} onClick={() => void onReadAgain()}>
            {busy ? "Reading…" : "Read the whole bill again"}
          </Button>
        </div>
      )}
    </>
  );
}
