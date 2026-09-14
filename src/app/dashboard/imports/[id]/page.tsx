"use client";

// The review screen. Everything here is a draft: nothing has been written to a
// spec record until Confirm.
//
// Category suggestions are shown with the document's own wording next to them,
// and an ambiguous match offers candidates rather than picking one. A line the
// matcher could not resolve stays blank — a plausible guess in a field a human
// skims past is worse than an obvious gap.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import SpecDocumentReview, { type Registers, type SpecImport } from "@/components/imports/SpecDocumentReview";
import DrawingsReview from "@/components/imports/DrawingsReview";
import PreambleReview from "@/components/imports/PreambleReview";

type Line = {
  index: number; lineNo: number; designer: string | null; boqCategory: string | null;
  area: string | null; code: string | null; itemDescription: string; productReference: string | null;
  qty: number | null; qtyUnit: string | null;
  categoryId: string | null; categoryStatus: string;
  categoryCandidates?: { id: string; name: string }[]; ignored: boolean;
};
type Category = { id: string; slug: string; family: string; name: string; requirements_authored: boolean };
type Sheet = {
  sheetName: string; proposedRunName: string; headerRow: number; skippedRows: number;
  ignored: boolean; ignoredReason: string | null;
  metadata: { revision: string | null; date: string | null; notes: string[] };
  lines: Line[];
};
type Import = {
  id: string; status: string; version: number; error: string | null; source_kind: string;
  document_kind: string | null;
  bws_project_number: string; project_name: string; filename: string | null;
  parsed: { schemaVersion: 2; filename: string | null; sourcePreserved?: boolean; sheets: Sheet[] } | null;
};

const STATUS_LABEL: Record<string, string> = {
  confident: "matched",
  ambiguous: "several possible",
  none: "no match",
  chosen: "chosen",
  pending: "",
};

export default function ReviewImportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ import: Import; categories: Category[]; registers: Registers | null } | null>(null);
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ lineNo: number; code: string | null }[]>([]);

  // `quiet` skips the loading state. The spec-document view re-reads every
  // three seconds while a document is being read, and blanking the screen out
  // from under someone reading it would make the page unusable.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const res = await apiFetch<{ import: Import; categories?: Category[]; registers?: Registers }>(
      `/api/imports/${id}`,
    );
    if (!quiet) setLoading(false);
    if (!res.ok) { setError(res.error); return; }
    setData({ import: res.data.import, categories: res.data.categories ?? [], registers: res.data.registers ?? null });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function setLine(sheetIndex: number, index: number, patch: { categoryId?: string | null; ignored?: boolean }) {
    setError(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, index, ...patch }),
    });
    if (!res.ok) { setError(res.error); return; }
    await load();
  }

  /** A sheet's run name, or dropping the tab. Addressed the same way. */
  async function setSheet(sheetIndex: number, patch: { runName?: string; ignored?: boolean }) {
    setError(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, ...patch }),
    });
    if (!res.ok) { setError(res.error); return; }
    await load();
  }

  async function confirm() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setBlocked([]);
    try {
      const res = await apiFetch<{ imported: number; projectId: string; runs: number }>(`/api/imports/${id}/confirm`, {
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
      router.push(`/dashboard/records?projectId=${res.data.projectId}`);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading import" />;

  const run = data.import;
  const sheets = run.parsed?.sheets ?? [];
  const activeSheets = sheets.filter((sheet) => !sheet.ignored);
  const activeLines = activeSheets.flatMap((sheet) => sheet.lines.filter((line) => !line.ignored));

  // Four documents, four review screens, one route. Each staged shape is edited
  // by the screen that understands it; nothing shares a component with a shape
  // it cannot display.
  if (run.document_kind === "shop_drawings") {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-neutral-900">
          Review drawings — {run.bws_project_number} {run.project_name}
        </h1>
        <DrawingsReview importId={run.id} />
      </div>
    );
  }

  if (run.document_kind === "preamble") {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-neutral-900">
          Review preamble — {run.bws_project_number} {run.project_name}
        </h1>
        <PreambleReview importId={run.id} />
      </div>
    );
  }

  if (run.source_kind === "spec_document") {
    if (!data.registers) return <Spinner label="Loading the document" />;
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-neutral-900">
          Review document — {run.bws_project_number} {run.project_name}
        </h1>
        <SpecDocumentReview
          data={{ import: run as unknown as SpecImport, registers: data.registers }}
          reload={() => load()}
          quietReload={() => load(true)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">
        Review import — {run.bws_project_number} {run.project_name}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        {run.filename ? <span className="font-medium">{run.filename}</span> : "Uploaded file"}
        {run.parsed && <> · {sheets.length} sheet{sheets.length === 1 ? "" : "s"} · {activeLines.length} lines</>}
      </p>
      <p className="mt-1 text-sm text-neutral-600">
        Each sheet becomes a RUN — a sub-quote with its own quantities. The same item code in two runs is two
        records, on purpose. Rename a run to whatever you call it, and drop any sheet that is not part of the job.
      </p>

      {run.parsed?.sourcePreserved === false && (
        <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded px-3 py-2">
          <strong>The source file was not kept.</strong> There is no blob store configured, so this import
          read the spreadsheet and discarded it. The records below will have no document to check back against.
        </p>
      )}

      {run.status === "confirmed" && (
        <p className="mt-3 text-sm text-neutral-700 bg-neutral-100 border border-neutral-300 rounded px-3 py-2">
          This import has already been confirmed.
        </p>
      )}

      {error && (
        <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
          {blocked.length > 0 && (
            <ul className="mt-1 list-disc list-inside">
              {blocked.map((line) => (
                <li key={line.lineNo}>Row {line.lineNo}{line.code ? ` (${line.code})` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sheets.map((sheet, sheetIndex) => (
        <section key={sheet.sheetName + String(sheetIndex)} className={`mt-6 ${sheet.ignored ? "opacity-50" : ""}`}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-neutral-500">
              Run name
              <input
                defaultValue={sheet.proposedRunName}
                disabled={run.status !== "parsed" || sheet.ignored}
                onBlur={(event) => {
                  if (event.target.value.trim() === sheet.proposedRunName) return;
                  void setSheet(sheetIndex, { runName: event.target.value });
                }}
                className="mt-1 block border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-900 disabled:opacity-50"
              />
            </label>
            <p className="text-xs text-neutral-500">
              sheet “{sheet.sheetName}”, header row {sheet.headerRow} · {sheet.lines.length} lines
              {sheet.skippedRows > 0 && <> · {sheet.skippedRows} non-item row(s) skipped</>}
              {sheet.metadata?.revision && <> · revision {sheet.metadata.revision}</>}
              {sheet.metadata?.date && <> · dated {sheet.metadata.date}</>}
            </p>
            <button
              type="button"
              disabled={run.status !== "parsed"}
              onClick={() => void setSheet(sheetIndex, { ignored: !sheet.ignored })}
              className="text-xs text-neutral-600 underline hover:text-neutral-900 disabled:opacity-50"
            >
              {sheet.ignored ? "Include this sheet" : "Drop this sheet"}
            </button>
          </div>

          {sheet.ignoredReason && <p className="mt-1 text-xs text-neutral-500">{sheet.ignoredReason}</p>}
          {(sheet.metadata?.notes?.length ?? 0) > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              From above the header: {sheet.metadata.notes.join(" · ")}
            </p>
          )}

          {!sheet.ignored && (
            <div className="mt-2 overflow-x-auto border border-neutral-200 rounded-lg bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Row</th>
                    <th className="text-left font-medium px-3 py-2">Code</th>
                    <th className="text-left font-medium px-3 py-2">Description (as written)</th>
                    <th className="text-left font-medium px-3 py-2">Area</th>
                    <th className="text-left font-medium px-3 py-2">Qty</th>
                    <th className="text-left font-medium px-3 py-2">Category (optional)</th>
                    <th className="text-left font-medium px-3 py-2"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {sheet.lines.map((line) => (
                    <tr key={line.index} className={line.ignored ? "opacity-40" : undefined}>
                      <td className="px-3 py-2 text-neutral-500">{line.lineNo}</td>
                      <td className="px-3 py-2 font-medium text-neutral-900">{line.code ?? "—"}</td>
                      <td className="px-3 py-2">
                        {line.itemDescription}
                        {line.productReference && <span className="text-neutral-500"> · {line.productReference}</span>}
                      </td>
                      <td className="px-3 py-2 text-neutral-700">{line.area ?? line.boqCategory ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-700">
                        {line.qty ?? "—"}
                        {line.qtyUnit && <span className="text-neutral-400"> {line.qtyUnit}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={line.categoryId ?? ""}
                          disabled={run.status !== "parsed" || line.ignored}
                          onChange={(e) => setLine(sheetIndex, line.index, { categoryId: e.target.value || null })}
                          className="border border-neutral-300 rounded px-2 py-1 text-sm max-w-xs disabled:opacity-50"
                        >
                          <option value="">— not yet —</option>
                          {data.categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.family === "upholstery" ? "Uph" : "Cab"} · {category.name}
                            </option>
                          ))}
                        </select>
                        {line.categoryStatus !== "chosen" && STATUS_LABEL[line.categoryStatus] && (
                          <span className={`ml-2 text-xs ${line.categoryStatus === "confident" ? "text-green-700" : "text-amber-800"}`}>
                            {STATUS_LABEL[line.categoryStatus]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={run.status !== "parsed"}
                          onClick={() => setLine(sheetIndex, line.index, { ignored: !line.ignored })}
                          className="text-xs text-neutral-600 underline hover:text-neutral-900 disabled:opacity-50"
                        >
                          {line.ignored ? "Restore" : "Ignore"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={confirm}
          disabled={busy || run.status !== "parsed" || activeLines.length === 0}
          className="text-sm px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy
            ? "Importing…"
            : `Confirm ${activeLines.length} line${activeLines.length === 1 ? "" : "s"} in ${activeSheets.length} run${activeSheets.length === 1 ? "" : "s"}`}
        </button>
        <span className="text-sm text-neutral-500">
          A line with no category still imports — it simply has no checklist yet.
        </span>
      </div>
    </div>
  );
}
