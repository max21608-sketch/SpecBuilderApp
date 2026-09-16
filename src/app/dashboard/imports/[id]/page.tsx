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
  replaces?: { recordId: string; recordVersion: number } | null;
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
  replacesRunId?: string | null;
  metadata: { revision: string | null; date: string | null; notes: string[] };
  lines: Line[];
};
type ProjectRun = {
  id: string; name: string; status: string; boq_revision: string | null; boq_date: string | null;
  record_count: number;
};
type Reconciliation = {
  lines: {
    index: number; lineNo: number; code: string | null;
    status: "paired" | "new" | "ambiguous";
    suggestedRecordId: string | null;
    candidates: string[];
    deltas: { field: string; label: string; was: string | null; now: string | null }[];
  }[];
  missing: {
    recordId: string; label: string; itemDescription: string; codes: string[];
    attributeCount: number; hasImage: boolean; settledAnswers: number;
  }[];
  counts: { paired: number; changed: number; new: number; ambiguous: number; missing: number };
  records: { id: string; version: number; label: string; itemDescription: string; qty: number | null }[];
};
type Import = {
  id: string; status: string; version: number; error: string | null; source_kind: string;
  document_kind: string | null;
  bws_project_number: string; project_name: string; filename: string | null;
  parsed: { schemaVersion: 3; filename: string | null; sourcePreserved?: boolean; sheets: Sheet[] } | null;
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
  const [data, setData] = useState<{
    import: Import;
    categories: Category[];
    registers: Registers | null;
    runs: ProjectRun[];
    reconciliation: Record<number, Reconciliation>;
  } | null>(null);
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ lineNo: number; code: string | null }[]>([]);

  // `quiet` skips the loading state. The spec-document view re-reads every
  // three seconds while a document is being read, and blanking the screen out
  // from under someone reading it would make the page unusable.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const res = await apiFetch<{
      import: Import;
      categories?: Category[];
      registers?: Registers;
      runs?: ProjectRun[];
      reconciliation?: Record<number, Reconciliation>;
    }>(`/api/imports/${id}`);
    if (!quiet) setLoading(false);
    if (!res.ok) { setError(res.error); return; }
    setData({
      import: res.data.import,
      categories: res.data.categories ?? [],
      registers: res.data.registers ?? null,
      runs: res.data.runs ?? [],
      reconciliation: res.data.reconciliation ?? {},
    });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function setLine(
    sheetIndex: number,
    index: number,
    patch: { categoryId?: string | null; ignored?: boolean; replaces?: { recordId: string; recordVersion: number } | null },
  ) {
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
      // The project's run tabs, with the first one selected. A bill with three
      // tabs has just become three runs, and they are never shown merged.
      router.push(`/dashboard/projects/${res.data.projectId}?tab=spec`);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading import" />;

  const run = data.import;
  const sheets = run.parsed?.sheets ?? [];
  // The runs this bill could revise, and the live per-sheet reconciliation.
  // Both come from the server on every read: a record retired or paired since
  // the page loaded has to show as it is now.
  const runs = data.runs.filter((projectRun) => projectRun.status === "active");
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

      {sheets.map((sheet, sheetIndex) => {
        const reconciliation = data.reconciliation[sheetIndex] ?? null;
        const pairingFor = (index: number) => reconciliation?.lines.find((line) => line.index === index) ?? null;
        return (
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

          {/* IS THIS A NEW RUN, OR A REVISION OF ONE?
              Never chosen automatically. A revised bill that silently replaced
              a run would rewrite quantities on records somebody is already
              working from; one that silently made a new run leaves the work
              stranded on the old copy. Both are consequential, so a person
              says which. */}
          {!sheet.ignored && runs.length > 0 && run.status === "parsed" && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <label className="text-neutral-600">
                This sheet is
                <select
                  value={sheet.replacesRunId ?? ""}
                  disabled={busy}
                  onChange={(event) => void setSheet(sheetIndex, { replacesRunId: event.target.value || null })}
                  className="ml-2 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
                >
                  <option value="">a new run</option>
                  {runs.map((projectRun) => (
                    <option key={projectRun.id} value={projectRun.id}>
                      a revision of “{projectRun.name}” ({projectRun.record_count} items
                      {projectRun.boq_revision ? `, ${projectRun.boq_revision}` : ""})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {reconciliation && (
            <div className="mt-2 border border-blue-300 bg-blue-50 rounded-lg px-4 py-3 text-sm">
              <p className="text-blue-900">
                <span className="font-medium">{reconciliation.counts.changed} changed</span> ·{" "}
                {reconciliation.counts.paired - reconciliation.counts.changed} unchanged · {reconciliation.counts.new} new ·{" "}
                {reconciliation.counts.missing} no longer listed
                {reconciliation.counts.ambiguous > 0 && (
                  <> · <span className="font-medium text-amber-800">{reconciliation.counts.ambiguous} to pair by hand</span></>
                )}
              </p>
              <p className="mt-0.5 text-xs text-blue-800">
                Items carried forward keep their record — and with it their drawings, their specs, their picture and
                their answers. Only the bill&rsquo;s own columns are written over.
              </p>
              {reconciliation.missing.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-blue-900">
                    Not in this revision — these will be retired, not deleted:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {reconciliation.missing.map((missing) => (
                      <li key={missing.recordId} className="text-xs text-blue-900">
                        <span className="font-mono">{missing.label}</span> {missing.itemDescription}
                        {missing.codes.length > 0 && <span className="text-blue-700"> · {missing.codes.join(", ")}</span>}
                        {/* Named, not counted. A record with 14 specs and a
                            picture is somebody's afternoon, and pairing it is
                            usually what was meant. */}
                        {(missing.attributeCount > 0 || missing.hasImage || missing.settledAnswers > 0) && (
                          <span className="text-amber-800">
                            {" — carries "}
                            {[
                              missing.attributeCount > 0 ? `${missing.attributeCount} spec${missing.attributeCount === 1 ? "" : "s"}` : null,
                              missing.settledAnswers > 0 ? `${missing.settledAnswers} answer${missing.settledAnswers === 1 ? "" : "s"}` : null,
                              missing.hasImage ? "a picture" : null,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                            . Pair it with a line above, or it stops being live.
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
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
                    {reconciliation && <th className="text-left font-medium px-3 py-2">Against the run</th>}
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
                      {reconciliation && (
                        <td className="px-3 py-2 align-top">
                          {(() => {
                            const pairing = pairingFor(line.index);
                            if (!pairing || line.ignored) return <span className="text-neutral-400">—</span>;
                            return (
                              <div>
                                <select
                                  value={line.replaces?.recordId ?? (pairing.status === "paired" ? (pairing.suggestedRecordId ?? "") : "")}
                                  disabled={run.status !== "parsed" || busy}
                                  onChange={(event) => {
                                    const recordId = event.target.value;
                                    const record = reconciliation.records.find((row) => row.id === recordId);
                                    void setLine(sheetIndex, line.index, {
                                      // The VERSION the reviewer is looking at
                                      // travels with the pairing, so a record
                                      // edited since refuses the confirm rather
                                      // than being quietly overwritten.
                                      replaces: record ? { recordId: record.id, recordVersion: record.version } : null,
                                    });
                                  }}
                                  className={`border rounded px-2 py-1 text-xs max-w-[13rem] disabled:opacity-50 ${
                                    pairing.status === "ambiguous" && !line.replaces
                                      ? "border-amber-400 bg-amber-50"
                                      : "border-neutral-300"
                                  }`}
                                >
                                  <option value="">new item</option>
                                  {reconciliation.records.map((record) => (
                                    <option key={record.id} value={record.id}>
                                      {record.label} · {record.itemDescription.slice(0, 32)}
                                    </option>
                                  ))}
                                </select>
                                {pairing.status === "ambiguous" && !line.replaces && (
                                  <p className="mt-0.5 text-xs text-amber-800">
                                    This code is on {pairing.candidates.length} records. Choose which one, or leave it
                                    as a new item.
                                  </p>
                                )}
                                {pairing.deltas.length > 0 && (
                                  <ul className="mt-0.5 text-xs text-neutral-600">
                                    {pairing.deltas.map((delta) => (
                                      <li key={delta.field}>
                                        {delta.label}: <span className="line-through text-neutral-400">{delta.was ?? "—"}</span>{" "}
                                        → <span className="text-neutral-900">{delta.now ?? "—"}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {pairing.status === "paired" && pairing.deltas.length === 0 && (
                                  <p className="mt-0.5 text-xs text-neutral-500">unchanged</p>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      )}
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
        );
      })}

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
