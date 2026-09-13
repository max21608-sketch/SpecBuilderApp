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

type Line = {
  index: number; lineNo: number; designer: string | null; boqCategory: string | null;
  code: string | null; itemDescription: string; productReference: string | null; qty: number | null;
  categoryId: string | null; categoryStatus: string;
  categoryCandidates?: { id: string; name: string }[]; ignored: boolean;
};
type Category = { id: string; slug: string; family: string; name: string; requirements_authored: boolean };
type Import = {
  id: string; status: string; version: number; error: string | null;
  bws_project_number: string; project_name: string; filename: string | null;
  parsed: { sheet: string; headerRow: number; skippedRows: number; sourcePreserved?: boolean; lines: Line[] } | null;
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
  const [data, setData] = useState<{ import: Import; categories: Category[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ lineNo: number; code: string | null }[]>([]);

  const load = useCallback(async () => {
    const res = await apiFetch<{ import: Import; categories: Category[] }>(`/api/imports/${id}`);
    if (!res.ok) { setError(res.error); return; }
    setData({ import: res.data.import, categories: res.data.categories });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function setLine(index: number, patch: { categoryId?: string | null; ignored?: boolean }) {
    setError(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ index, ...patch }),
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
      const res = await apiFetch<{ imported: number; projectId: string }>(`/api/imports/${id}/confirm`, {
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
  const lines = run.parsed?.lines ?? [];
  const active = lines.filter((line) => !line.ignored);
  const needCategory = active.filter((line) => !line.categoryId).length;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">
        Review import — {run.bws_project_number} {run.project_name}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        {run.filename ? <span className="font-medium">{run.filename}</span> : "Uploaded file"}
        {run.parsed && <> · sheet “{run.parsed.sheet}”, header row {run.parsed.headerRow} · {lines.length} lines
          {run.parsed.skippedRows > 0 && <> · {run.parsed.skippedRows} non-item row(s) skipped</>}</>}
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

      <div className="mt-4 overflow-x-auto border border-neutral-200 rounded-lg bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Row</th>
              <th className="text-left font-medium px-3 py-2">Code</th>
              <th className="text-left font-medium px-3 py-2">Description (as written)</th>
              <th className="text-left font-medium px-3 py-2">Qty</th>
              <th className="text-left font-medium px-3 py-2">Category</th>
              <th className="text-left font-medium px-3 py-2"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {lines.map((line) => (
              <tr key={line.index} className={line.ignored ? "opacity-40" : undefined}>
                <td className="px-3 py-2 text-neutral-500">{line.lineNo}</td>
                <td className="px-3 py-2 font-medium text-neutral-900">{line.code ?? "—"}</td>
                <td className="px-3 py-2">
                  {line.itemDescription}
                  {line.productReference && <span className="text-neutral-500"> · {line.productReference}</span>}
                </td>
                <td className="px-3 py-2 text-neutral-700">{line.qty ?? "—"}</td>
                <td className="px-3 py-2">
                  <select
                    value={line.categoryId ?? ""}
                    disabled={run.status !== "parsed" || line.ignored}
                    onChange={(e) => setLine(line.index, { categoryId: e.target.value || null })}
                    className="border border-neutral-300 rounded px-2 py-1 text-sm max-w-xs disabled:opacity-50"
                  >
                    <option value="">— choose —</option>
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
                    onClick={() => setLine(line.index, { ignored: !line.ignored })}
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

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={confirm}
          disabled={busy || run.status !== "parsed" || needCategory > 0 || active.length === 0}
          className="text-sm px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Importing…" : `Confirm ${active.length} line${active.length === 1 ? "" : "s"}`}
        </button>
        {needCategory > 0 && (
          <span className="text-sm text-amber-800">
            {needCategory} line{needCategory === 1 ? "" : "s"} still need a category.
          </span>
        )}
      </div>
    </div>
  );
}
