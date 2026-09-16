"use client";

// The spec table for ONE RUN. Never for several at once.
//
// `runId` is required, and that is the point rather than an accident of the
// call sites. A BOQ's tabs are sub-quotes -- a mock-up run, a main run, a
// value-engineered run -- quoting the SAME item codes at different quantities,
// so a table holding all three shows three of everything with no column that
// says which is which. There used to be a second screen that mounted this
// without a run and did exactly that; it was deleted rather than fixed,
// because the merged view is not a view anybody wanted.
//
// Extracted from the page so the project screen can mount one per run tab. The
// SPECS CAPTURED column is the intake stage's own measure: how much a client
// document has actually said about each item. The cheat-sheet counts beside it
// measure a checklist that a record may not even have been given yet, which is
// why an uncategorised record reads as "no checklist yet" rather than as a
// failure — intake no longer waits for that decision.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import {
  SPECS_AGREED_LABEL,
  URGENCY_LABELS,
  daysUntilSpecsAgreed,
  hasProgramme,
  recordUrgency,
  todayLocal,
  type ProgrammeDates,
  type RecordUrgency,
} from "@/lib/project-programme";

export type SpecRecord = {
  id: string; record_no: number; item_description: string; product_reference: string | null;
  qty: number | null; designer: string | null; area: string | null; boq_category: string | null;
  refs: string | null; run_id: string; run_name: string; attribute_count: string;
  category_name: string | null; category_family: string | null; requirements_authored: boolean;
  spec_total: string; spec_settled: string; spec_tbc: string; spec_missing: string;
  ready_total: string; ready_settled: string; ready_tbc: string; ready_missing: string;
};

const DOTS: Record<RecordUrgency, string> = {
  complete: "bg-green-500",
  waiting: "bg-blue-500",
  action_required: "bg-red-500",
  overdue: "bg-red-600 ring-2 ring-red-300",
};

function Counts({ settled, tbc, missing, total }: { settled: number; tbc: number; missing: number; total: number }) {
  if (total === 0) return <span className="text-neutral-400">—</span>;
  return (
    <span className="tabular-nums">
      <span className="text-green-700">{settled}</span>
      <span className="text-neutral-400"> / </span>
      <span className={tbc > 0 ? "text-amber-700 font-medium" : "text-neutral-400"}>{tbc}</span>
      <span className="text-neutral-400"> / </span>
      <span className={missing > 0 ? "text-red-700 font-medium" : "text-neutral-400"}>{missing}</span>
    </span>
  );
}

export default function SpecTable({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const [records, setRecords] = useState<SpecRecord[] | null>(null);
  const [programme, setProgramme] = useState<ProgrammeDates | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ projectId, runId });
    const res = await apiFetch<{ records: SpecRecord[]; programme: ProgrammeDates }>(`/api/records?${query.toString()}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRecords(res.data.records);
    setProgramme(res.data.programme);
  }, [projectId, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!records) return <Spinner label="Loading spec records" />;

  const n = (value: string) => Number(value);
  const today = todayLocal();
  const daysLate = daysUntilSpecsAgreed(programme?.specsAgreedBy ?? null, today);
  const overdueBy = daysLate === null ? null : -daysLate;
  const withSpecs = records.filter((record) => n(record.attribute_count) > 0).length;
  const uncategorised = records.filter((record) => !record.category_name).length;

  // The export URL is a plain link, never apiFetch: the helper always reads the
  // body as text, and a workbook is bytes.
  const exportHref = `/api/projects/${projectId}/export?runId=${runId}`;

  return (
    <>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {records.length} record{records.length === 1 ? "" : "s"} · {withSpecs} with specs captured
          {uncategorised > 0 && <> · {uncategorised} with no checklist yet</>}
        </p>
        {records.length > 0 && (
          <div className="flex items-center gap-2">
            <a
              href={exportHref}
              className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700"
            >
              Export this run (.xlsx)
            </a>
            <a href={`${exportHref}&format=csv`} className="text-sm text-neutral-600 underline hover:text-neutral-900">
              .csv
            </a>
            <a
              href={`/api/projects/${projectId}/export/check-sheet?runId=${runId}`}
              className="text-sm text-neutral-600 underline hover:text-neutral-900"
            >
              Check sheet
            </a>
          </div>
        )}
      </div>

      {records.length > 0 && (
        <p className="mt-1 text-xs text-neutral-500">
          The export is always every record in scope — a BWS import replaces the fields it is given, so a partial file
          would erase what it left out. It carries no job number: it is a file to read, not to import. The check sheet is
          the same data one line per field, naming the document and page each value came from, for reading against the
          pack.
        </p>
      )}

      {records.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          No records here yet. Import a bill of quantities to create them.
        </p>
      ) : (
        <>
          {overdueBy !== null && overdueBy > 0 && (
            <p className="mt-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              {SPECS_AGREED_LABEL} {programme?.specsAgreedBy} — {overdueBy} day{overdueBy === 1 ? "" : "s"} ago.
              Everything still outstanding below is overdue.
            </p>
          )}

          {/* An absent date is NOT "on time". Saying nothing here would let a
              project with no programme read as a healthy one. */}
          {programme && !programme.specsAgreedBy && (
            <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {hasProgramme(programme)
                ? `No date for ${SPECS_AGREED_LABEL.toLowerCase()}, so nothing here can be flagged overdue.`
                : "No programme recorded for this project, so nothing here can be flagged overdue — which is not the same as being on time."}
            </p>
          )}

          <div className="mt-3 overflow-x-auto border border-neutral-200 rounded-lg bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left font-medium px-3 py-2">No.</th>
                  <th className="text-left font-medium px-3 py-2">Client ref</th>
                  <th className="text-left font-medium px-3 py-2">Item</th>
                  <th className="text-left font-medium px-3 py-2">Area</th>
                  <th className="text-left font-medium px-3 py-2">Qty</th>
                  <th className="text-left font-medium px-3 py-2">Specs captured</th>
                  <th className="text-left font-medium px-3 py-2">Category</th>
                  <th className="text-left font-medium px-3 py-2">Spec fields</th>
                  <th className="text-left font-medium px-3 py-2">Readiness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {records.map((record) => {
                  const outstanding =
                    n(record.spec_tbc) + n(record.spec_missing) + n(record.ready_tbc) + n(record.ready_missing);
                  const anyMissing = n(record.spec_missing) + n(record.ready_missing) > 0;
                  const urgency = recordUrgency({
                    outstanding,
                    allChased: false,
                    specsAgreedBy: programme?.specsAgreedBy ?? null,
                    today,
                  });
                  const dot = urgency === "action_required" && !anyMissing ? "bg-amber-500" : DOTS[urgency];
                  const attributes = n(record.attribute_count);
                  return (
                    <tr key={record.id} className="hover:bg-neutral-50">
                      <td className="px-3 py-2 text-neutral-500 tabular-nums">
                        <span
                          title={URGENCY_LABELS[urgency]}
                          className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${dot}`}
                        />
                        {record.record_no}
                      </td>
                      <td className="px-3 py-2 font-medium text-neutral-900">{record.refs ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/dashboard/records/${record.id}`}
                          className="text-neutral-900 underline hover:text-neutral-600"
                        >
                          {record.item_description}
                        </Link>
                        {record.product_reference && (
                          <span className="text-neutral-500"> · {record.product_reference}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-700">{record.area ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-700 tabular-nums">{record.qty ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {attributes > 0 ? (
                          <span className="text-neutral-900">{attributes}</span>
                        ) : (
                          <span className="text-neutral-400">none yet</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-700">
                        {record.category_name ?? <span className="text-neutral-400">no checklist yet</span>}
                        {record.category_name && !record.requirements_authored && (
                          <span className="ml-1 text-xs text-amber-800">(not yet defined)</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Counts
                          settled={n(record.spec_settled)}
                          tbc={n(record.spec_tbc)}
                          missing={n(record.spec_missing)}
                          total={n(record.spec_total)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Counts
                          settled={n(record.ready_settled)}
                          tbc={n(record.ready_tbc)}
                          missing={n(record.ready_missing)}
                          total={n(record.ready_total)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
