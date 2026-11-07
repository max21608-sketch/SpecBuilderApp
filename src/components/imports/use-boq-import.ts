"use client";

// The bill review's loader and its mutation verbs: what `useBoqImport` returns
// is what the review page used, named the same. Moved out of
// src/app/dashboard/imports/[id]/page.tsx on 2026-11-06 (audit 5.3, cut A).
//
// THE PAGE CALLS IT, FOR EVERY DOCUMENT KIND. One GET of `/api/imports/[id]`
// serves all five review screens, and the page dispatches on what it returns,
// so the load is the page's before it is the bill's. The verbs are the bill
// review's own and do nothing for any other kind; nothing else calls them.
//
// Every verb is the same request it was on the page, in the same order, and
// keeps the same discipline about the reload: where a refusal must survive
// the reload it triggers, the reload comes first and the report after.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { type Registers } from "@/components/imports/SpecDocumentReview";
import { type EmailMessage } from "@/components/imports/EmailHeader";
import { suggestedCategoryId } from "@/lib/bill-category";
import type { PdfBillSource } from "@/lib/pdf-bill-source";
import type { PdfTranscription, TranscriptionRecord } from "@/lib/pdf-bill-checks";
import type { BillSheetNotice } from "@/lib/bill-sheet-notices";
import type { BoqRowKind, RowKindFields } from "@/lib/boq-row-kinds";
import type { ReviewDescription } from "@/components/imports/BillDescription";
import type { BillUnitOverride, SlotOverride } from "@/lib/bill-description";
import type { BillPictureOverride, BoqRowImages } from "@/lib/bill-row-image";
import type { PictureChoice } from "@/components/imports/BillPicturePanel";
import type { FabricLinePlan } from "@/lib/bill-fabric-filing";
import type { LinePairing } from "@/lib/boq-reconcile";
import type { BoqKeptCell } from "@/lib/boq-roles";
import type { ColumnsPanelSheet } from "@/components/imports/BoqColumnsPanel";
import type { NonFurnitureGuess } from "@/lib/non-furniture-guess";

export type Line = {
  replaces?: { recordId: string; recordVersion: number } | null;
  index: number; lineNo: number; designer: string | null; boqCategory: string | null;
  area: string | null; code: string | null; itemDescription: string; productReference: string | null;
  qty: number | null; qtyUnit: string | null;
  // The quantity cell as printed, only where it is not a count. See `BoqLine`.
  qtyRaw?: string;
  // The description cell as printed, where it breaks over lines — see `BoqLine`.
  itemDescriptionRaw?: string;
  // Present only where the bill has the column (v4) — see `BoqLine`.
  subArea?: string | null; sourceLine?: string | null; notes?: string | null;
  // The bill's mock-up figure as printed, and the cells of the columns kept in
  // notes — each present only where the sheet has the column. See `BoqLine`.
  mockupQtyRaw?: string | null; kept?: BoqKeptCell[];
  // The bill's finish-code column (COM CODE), where the sheet has it: the code
  // a finish line is filed under (`fabricFilingCode`).
  finishCode?: string | null;
  categoryId: string | null; categoryStatus: string;
  // What a suggested category was read from; see `StagedBoqLine`.
  categoryReason?: string | null;
  categoryCandidates?: { id: string; name: string }[]; ignored: boolean;
  // Guessed at parse time, corrected here. `chosen` is what makes it a
  // decision the quote gate may read; see db/migrations/0025.
  level?: string | null; levelStatus?: string; levelReason?: string | null;
  /**
   * WHICH TAB THIS VALUE WAS DECIDED ON, where it was not this one.
   *
   * A bill's tabs are phases quoting the same codes, so a decision about
   * `S-100` on MUR is a decision about the item — see `src/lib/boq-carry.ts`.
   * A carried value arrives as `chosen`, because that is what it is; this is
   * what keeps it honest about whose tab it was taken on, and it is what
   * protects a person's own choice here from the next carry.
   *
   * OPTIONAL, and absent is the ordinary state: nothing carried into this row.
   */
  levelCarriedFrom?: string | null; categoryCarriedFrom?: string | null;
  // "This may not be furniture", asked at staging. ABSENT on a bill staged
  // before the question existed, which `nonFurnitureOf` answers at read time.
  nonFurnitureSuggested?: NonFurnitureGuess | null;
  // A reviewer's slot changes on the size line, and the version of that map
  // the screen was drawn with — sent back with every change.
  slotOverridesVersion?: number;
  // The unit a reviewer said for a size that prints none, and that choice's
  // own version — sent back with every change, one line or the sheet's "all".
  unitOverride?: string; unitOverrideVersion?: number;
  // The picture a person chose for the row — a crop, or none — and its own
  // version, sent back with every change (`effectiveRowImage`).
  picture?: BillPictureOverride | null;
  pictureVersion?: number;
} & RowKindFields;

export type Category = { id: string; slug: string; family: string; name: string; requirements_authored: boolean };
export type Sheet = Omit<ColumnsPanelSheet, "lines"> & {
  sheetName: string; proposedRunName: string; headerRow: number; skippedRows: number;
  ignored: boolean; ignoredReason: string | null;
  replacesRunId?: string | null;
  metadata: { revision: string | null; date: string | null; notes: string[] };
  lines: Line[];
};
export type ProjectRun = {
  id: string; name: string; status: string; boq_revision: string | null; boq_date: string | null;
  record_count: number;
};
export type ReconciledRecord = {
  id: string; version: number; label: string; itemDescription: string; qty: number | null;
  /** Its live configurations' short labels (`12.1`), which follow it. */
  configurations?: string[];
};
export type Reconciliation = {
  lines: {
    index: number; lineNo: number; code: string | null;
    status: "paired" | "new" | "ambiguous" | "restore";
    /** The reviewer's stored decision; a `paired` line that is not accepted is only a suggestion. */
    accepted?: boolean;
    suggestedRecordId: string | null;
    candidates: string[];
    /** Retired lines of the phase carrying this line's code, offered back. */
    restoreCandidates?: string[];
    deltas: { field: string; label: string; was: string | null; now: string | null }[];
  }[];
  missing: {
    recordId: string; label: string; itemDescription: string; codes: string[];
    attributeCount: number; hasImage: boolean; settledAnswers: number;
    configurations?: string[];
    /** The line a suggested pairing offers it to; still retired until accepted. */
    suggestedFor?: number;
  }[];
  counts: {
    paired: number; changed: number; new: number; ambiguous: number; missing: number;
    restored?: number; suggested?: number;
  };
  records: ReconciledRecord[];
  /** The phase's lines an earlier revision retired (audit 2026-11-06, C14). */
  retired?: ReconciledRecord[];
};
export type Import = {
  id: string; status: string; version: number; error: string | null; source_kind: string;
  document_kind: string | null; project_id: string;
  bws_project_number: string; project_name: string; filename: string | null;
  /** Whether the original is stored, so a failed bill can be read again from it. */
  has_source?: boolean;
  /** What a model's structure read left on the run (`/suggest-columns`). */
  model_metadata?: { structureRead?: StructureReadState; transcription?: TranscriptionRecord } | null;
  parsed: {
    schemaVersion: 3 | 4;
    filename: string | null;
    sourcePreserved?: boolean;
    sheets: Sheet[];
    // The pictures the workbook prints on its rows (`bill-images.ts`).
    rowImages?: BoqRowImages;
    rowImagesNote?: string | null;
    // The PDF a bill was read from by its text, and each line's page (`pdf-bill.ts`).
    pdfSource?: PdfBillSource;
    // A PDF code could not read, transcribed by the model (C2): waiting or done, and what its checks need.
    pdfTranscription?: PdfTranscription;
  } | null;
};

/** The parts of `model_metadata.structureRead` the screen reads. */
export type StructureReadState = {
  pending?: { requestId: string; at: string; sheets: string[] } | null;
  sheets?: Record<string, { at: string; ok: boolean; outcome: string }>;
};

export type BoqImport = ReturnType<typeof useBoqImport>;

export function useBoqImport(id: string) {
  const router = useRouter();
  const [data, setData] = useState<{
    import: Import;
    categories: Category[];
    registers: Registers | null;
    message: EmailMessage | null;
    runs: ProjectRun[];
    reconciliation: Record<number, Reconciliation>;
    billSpecs: { id: string; status: string } | null;
    /** Per sheet, per staged line index: what its description cell becomes. */
    descriptions: Record<number, Record<number, ReviewDescription>>;
    /** The confirm reads (or read) this bill's descriptions, so there is no charged read to offer. */
    descriptionsRead: boolean;
    /** Per sheet, per staged line index: what a finish line does to the finishes library, in words. */
    fabricFilings: Record<number, Record<number, FabricLinePlan>>;
    /** Per sheet: its mock-up count and whether no item line carries a code (`billSheetNotices`). */
    sheetNotices: Record<number, BillSheetNotice>;
  } | null>(null);
  /**
   * WHAT THE CONFIRM'S MOCK-UP STEP LEFT FOR A PERSON — an item a revision
   * left on the mock-up phase, or one it could not add — said here after the
   * reload, because navigating away would swallow it.
   */
  const [mockupNotice, setMockupNotice] = useState<string | null>(null);
  /**
   * WHETHER A RELOAD IS IN FLIGHT, and it is now RENDERED.
   *
   * This was `const [, setLoading] = useState(false)` — the value discarded,
   * so `setLoading` was a bare re-render and the screen showed nothing while
   * it reloaded (found-in-use 2026-09-21). Most actions here do not set
   * `busy`: changing a line's category or a tab's name just awaits `load()`,
   * which takes a second or two against the sandbox and gave no feedback at
   * all.
   *
   * IT IS NOT WHAT MAKES THE BANNER SURVIVE A RELOAD, which the entry
   * suspected. `load()` on this screen never clears `error` on success — the
   * drawings screens' `reloadThen` exists because THEIR loader does — so the
   * message survives whatever this state does.
   */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * WHAT A PRESS DID ON THE TABS THE REVIEWER IS NOT LOOKING AT.
   *
   * Not an error and not a suggestion: a decision they took, reported where
   * they took it. It clears on the next action, like the banner above it.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ lineNo: number; code: string | null }[]>([]);
  const [specsBusy, setSpecsBusy] = useState(false);

  // `quiet` skips the loading state. The spec-document view re-reads every
  // three seconds while a document is being read, and blanking the screen out
  // from under someone reading it would make the page unusable.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const res = await apiFetch<{
      import: Import;
      categories?: Category[];
      registers?: Registers;
      message?: EmailMessage | null;
      runs?: ProjectRun[];
      reconciliation?: Record<number, Reconciliation>;
      billSpecs?: { id: string; status: string } | null;
      descriptions?: Record<number, Record<number, ReviewDescription>>;
      descriptionsRead?: boolean;
      fabricFilings?: Record<number, Record<number, FabricLinePlan>>;
      sheetNotices?: Record<number, BillSheetNotice>;
    }>(`/api/imports/${id}`);
    if (!quiet) setLoading(false);
    if (!res.ok) { setError(res.error); return; }
    setData({
      import: res.data.import,
      categories: res.data.categories ?? [],
      registers: res.data.registers ?? null,
      message: res.data.message ?? null,
      runs: res.data.runs ?? [],
      reconciliation: res.data.reconciliation ?? {},
      billSpecs: res.data.billSpecs ?? null,
      descriptions: res.data.descriptions ?? {},
      descriptionsRead: res.data.descriptionsRead ?? false,
      fabricFilings: res.data.fabricFilings ?? {},
      sheetNotices: res.data.sheetNotices ?? {},
    });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function setLine(
    sheetIndex: number,
    index: number,
    patch: {
      categoryId?: string | null;
      level?: string | null;
      ignored?: boolean;
      replaces?: LinePairing | null;
    },
  ) {
    setError(null);
    setNotice(null);
    const res = await apiFetch<{ carried?: number; carriedTo?: string }>(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, index, ...patch }),
    });
    if (!res.ok) { setError(res.error); return; }
    // WHAT IT DID SOMEWHERE ELSE, SAID OUT LOUD. The receiving row carries the
    // sentence, but the person is looking at the tab they decided on — so
    // without this a press that changed three tabs looks like a press that
    // changed one cell.
    const carried = res.data?.carried ?? 0;
    if (carried > 0) {
      setNotice(
        `Also filled in on ${carried} line${carried === 1 ? "" : "s"} carrying the same client ref${
          res.data?.carriedTo ? ` — ${res.data.carriedTo}` : ""
        }. Each says where it came from and can be changed there.`,
      );
    }
    await load();
  }

  /**
   * A ROW'S PICTURE, as a person chose it: a crop, the bill's own, or none.
   * Sent with the version of the choice the screen was drawn with, so a
   * choice made in another tab refuses this one rather than being quietly
   * replaced — the refusal is reported AFTER the reload, or the reload would
   * clear it (`reloadThen`'s rule). Resolves true where it was recorded.
   */
  async function setPicture(sheetIndex: number, line: Line, picture: PictureChoice): Promise<boolean> {
    setError(null);
    setNotice(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, index: line.index, picture, pictureVersion: line.pictureVersion ?? 0 }),
    });
    await load(true);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    return true;
  }

  /** A sheet's run name, or dropping the tab. Addressed the same way. */
  async function setSheet(
    sheetIndex: number,
    patch: { runName?: string; ignored?: boolean; replacesRunId?: string | null },
  ) {
    setError(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, ...patch }),
    });
    if (!res.ok) { setError(res.error); return; }
    await load();
  }

  /**
   * Accept every suggested level on one tab.
   *
   * One press, one line at a time, because the staged bill's own PATCH route is
   * per line — 59 records must not mean 59 visits, and the alternative is a new
   * bulk route for a screen whose confirm is about to write all of them anyway.
   * It reloads ONCE at the end rather than after every line, or the table
   * re-renders under the reviewer twenty-two times.
   */
  async function acceptAllLevels(sheetIndex: number, lines: Line[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    // Each accepted level carries to the same client ref on the other tabs, so
    // the sentence at the end is the TOTAL — one count for one press, rather
    // than twelve notices the last of which is the only one anybody reads.
    let carried = 0;
    try {
      for (const line of lines) {
        if (!line.level) continue;
        const res = await apiFetch<{ carried?: number }>(`/api/imports/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sheetIndex, index: line.index, level: line.level }),
        });
        if (!res.ok) {
          setError(res.error);
          break;
        }
        carried += res.data?.carried ?? 0;
      }
      if (carried > 0) {
        setNotice(
          `Also filled in on ${carried} line${carried === 1 ? "" : "s"} on the other phases carrying the same client ` +
            `refs. Each says where it came from and can be changed there.`,
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Accept every suggested CATEGORY on one tab (audit 2026-11-06, G8).
   *
   * A guess is no longer written unless somebody accepts it, so a 300-line
   * bill must not mean 300 clicks. The set is the one the button counted
   * (`suggestedCategoryId`, the confirm's own rule read the other way), each
   * accepted through the same per-line PATCH a single click uses, and ONE
   * reload at the end, for `acceptAllLevels`' reason.
   */
  async function acceptAllCategories(sheetIndex: number, lines: Line[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    let carried = 0;
    try {
      for (const line of lines) {
        const categoryId = suggestedCategoryId(line);
        if (!categoryId) continue;
        const res = await apiFetch<{ carried?: number }>(`/api/imports/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sheetIndex, index: line.index, categoryId }),
        });
        if (!res.ok) {
          setError(res.error);
          break;
        }
        carried += res.data?.carried ?? 0;
      }
      if (carried > 0) {
        setNotice(
          `Also filled in on ${carried} line${carried === 1 ? "" : "s"} on the other phases carrying the same client ` +
            `refs. Each says where it came from and can be changed there.`,
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Accept every SUGGESTED pairing on one tab: each line whose code is on
   * exactly one record of the phase it revises.
   *
   * A suggestion is not a pairing until it is stored. The confirm writes only
   * what is stored (`replaces`), and a select pre-filled with the suggestion
   * fired no change when somebody "agreed" with it, so the line confirmed as a
   * NEW item and the record the screen said it continued was retired (found
   * 2026-11-06 building audit 1.2). Every pairing it stores carries the
   * version shown, as a hand pairing does; one reload at the end, for
   * `acceptAllLevels`' reason.
   */
  async function acceptAllPairings(sheetIndex: number, pairs: { index: number; recordId: string; recordVersion: number }[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      for (const pair of pairs) {
        const res = await apiFetch(`/api/imports/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sheetIndex,
            index: pair.index,
            replaces: { recordId: pair.recordId, recordVersion: pair.recordVersion },
          }),
        });
        if (!res.ok) {
          setError(res.error);
          break;
        }
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ignore every line the app has asked about as packaging or delivery.
   *
   * The SET comes from `linesToIgnore`, which is what the count on the button
   * was computed from — one reading, so the control cannot ignore something its
   * own label did not count. Sequential PATCHes and ONE reload, for the reason
   * `acceptAllLevels` does it that way: the staged bill's route is per line,
   * and reloading after each would re-render the table forty times.
   *
   * Every one of them is reversible from the Include checkbox, which is what
   * makes a batch action acceptable here at all (house/conventions §5).
   */
  async function ignoreAllSuggested(sheetIndex: number, lines: Line[]) {
    setBusy(true);
    setError(null);
    try {
      for (const line of lines) {
        const res = await apiFetch(`/api/imports/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sheetIndex, index: line.index, ignored: true }),
        });
        if (!res.ok) {
          setError(res.error);
          break;
        }
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * READ THE WHOLE BILL AGAIN from its stored source — free, by code. For a
   * bill that failed (every one refused before 0040 included) and for one
   * staged before its columns were recorded. Reload first, then report.
   */
  async function readAgain() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/imports/${id}/columns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reread", version: data.import.version }),
      });
      await load();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Read again from the stored spreadsheet. Nothing was charged and nothing is confirmed.");
    } finally {
      setBusy(false);
    }
  }

  /** A line's kind, set by a person. The route checks the item against the live sheet. */
  /**
   * WHAT A PART OF A LINE'S SIZE IS — a person's answer, before the confirm.
   * The server checks it against the live line and the version of the line's
   * slot changes this screen was drawn with; the plan it recomposes is what
   * the reload shows. Reload first, then report.
   */
  async function setSlot(sheetIndex: number, line: Line, key: string, slot: SlotOverride | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/imports/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sheetIndex,
          index: line.index,
          slotOverride: { key, slot },
          slotOverridesVersion: line.slotOverridesVersion ?? 0,
        }),
      });
      await load(true);
      if (!res.ok) setError(res.error);
    } finally {
      setBusy(false);
    }
  }

  /** The unit of one line's size that prints none, or null to take it back. */
  async function setUnit(sheetIndex: number, line: Line, unit: BillUnitOverride | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/imports/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sheetIndex,
          index: line.index,
          unitOverride: unit,
          unitOverrideVersion: line.unitOverrideVersion ?? 0,
        }),
      });
      await load(true);
      if (!res.ok) setError(res.error);
    } finally {
      setBusy(false);
    }
  }

  /**
   * ONE UNIT FOR EVERY LINE THE PANEL COUNTED, in one request: the lines whose
   * size prints no unit and that nobody has set yet, each with the version it
   * was drawn at. A wrong row is then corrected on its own select.
   */
  async function setUnitAll(sheetIndex: number, lines: Line[], unit: BillUnitOverride) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/imports/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sheetIndex,
          unitOverrideAll: unit,
          lines: lines.map((line) => ({ index: line.index, unitOverrideVersion: line.unitOverrideVersion ?? 0 })),
        }),
      });
      await load(true);
      if (!res.ok) setError(res.error);
      else setNotice(`The unit of ${lines.length} size${lines.length === 1 ? "" : "s"} is set to ${unit}. Each row says so, and can be changed on its own.`);
    } finally {
      setBusy(false);
    }
  }

  async function setLineKind(sheetIndex: number, index: number, rowKind: BoqRowKind, finishForRow: number | null) {
    setError(null);
    setNotice(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, index, rowKind, ...(finishForRow === null ? {} : { finishForRow }) }),
    });
    await load();
    if (!res.ok) setError(res.error);
  }

  /**
   * READ THE SPECIFICATIONS IN THIS BILL — one read, charged, on the button.
   * Registers this bill's own stored file as a specification document; a
   * second press returns the read the first one started.
   */
  async function readSpecifications() {
    setSpecsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ importId: string; reused?: boolean; autoRead?: { dispatched: boolean; error?: string } }>(
        `/api/imports/${id}/read-specifications`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      await load(true);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.autoRead && !res.data.autoRead.dispatched && res.data.autoRead.error) {
        setError(`Registered, but its read did not start: ${res.data.autoRead.error} Retry it from the Documents tab.`);
        return;
      }
      setNotice(
        res.data.reused
          ? "The specifications in this bill are already being read — nothing more was charged."
          : "Reading the specifications in this bill. They arrive as a document to review, like any other.",
      );
    } finally {
      setSpecsBusy(false);
    }
  }

  async function confirm() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setBlocked([]);
    try {
      const res = await apiFetch<{
        imported: number;
        projectId: string;
        runs: number;
        mockup?: { skipped: number; left: number; message: string } | null;
      }>(`/api/imports/${id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: data.import.version }),
      });
      if (!res.ok) {
        setError(res.error);
        const lines = (res.data?.lines as { lineNo: number; code: string | null }[] | undefined) ?? [];
        setBlocked(lines);
        return;
      }
      // THE MOCK-UP STEP LEFT SOMETHING FOR A PERSON: stay, reload, THEN say
      // it — the confirmed screen offers the next step beside it.
      const mockup = res.data.mockup;
      if (mockup && (mockup.left > 0 || mockup.skipped > 0)) {
        await load();
        setMockupNotice(mockup.message);
        return;
      }
      // The project's run tabs, with the first one selected. A bill with three
      // tabs has just become three runs, and they are never shown merged.
      router.push(`/dashboard/projects/${res.data.projectId}?tab=spec`);
    } finally {
      setBusy(false);
    }
  }

  return {
    data,
    load,
    loading,
    error,
    setError,
    notice,
    setNotice,
    busy,
    blocked,
    mockupNotice,
    specsBusy,
    setLine,
    setPicture,
    setSheet,
    acceptAllLevels,
    acceptAllCategories,
    acceptAllPairings,
    ignoreAllSuggested,
    readAgain,
    setSlot,
    setUnit,
    setUnitAll,
    setLineKind,
    readSpecifications,
    confirm,
  };
}
