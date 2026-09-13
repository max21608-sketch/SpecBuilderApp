"use client";

// The completion view. Green when nothing is outstanding, amber when something
// is TBC, red when something has not been looked at.
//
// Spec fields and readiness questions are counted separately on purpose: a
// record whose BWS fields are all settled but whose deposit and TOE are not is
// not a record anybody should call finished.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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

type SpecRecord = {
  id: string; record_no: number; item_description: string; product_reference: string | null;
  qty: number | null; designer: string | null; area: string | null; refs: string | null;
  category_name: string | null; category_family: string | null; requirements_authored: boolean;
  spec_total: string; spec_settled: string; spec_tbc: string; spec_missing: string;
  ready_total: string; ready_settled: string; ready_tbc: string; ready_missing: string;
  waiting: number;
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

function RecordsTable() {
  const projectId = useSearchParams().get("projectId");
  const [records, setRecords] = useState<SpecRecord[] | null>(null);
  const [programme, setProgramme] = useState<ProgrammeDates | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setError("No project selected."); return; }
    const res = await apiFetch<{ records: SpecRecord[]; programme: ProgrammeDates }>(
      `/api/records?projectId=${encodeURIComponent(projectId)}`,
    );
    if (!res.ok) { setError(res.error); return; }
    setRecords(res.data.records);
    setProgramme(res.data.programme);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!records) return <Spinner label="Loading spec records" />;
  if (records.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No spec records yet. <Link className="underline" href="/dashboard/projects">Import a BOQ</Link> to create them.
      </p>
    );
  }

  const n = (value: string) => Number(value);
  const today = todayLocal();
  const daysLate = daysUntilSpecsAgreed(programme?.specsAgreedBy ?? null, today);
  const overdueBy = daysLate === null ? null : -daysLate;
  const complete = records.filter((r) => n(r.spec_tbc) + n(r.spec_missing) + n(r.ready_tbc) + n(r.ready_missing) === 0).length;

  return (
    <>
      <p className="mt-1 text-sm text-neutral-600">
        {records.length} records · {complete} with nothing outstanding. Counts are
        <span className="text-green-700"> settled</span> /
        <span className="text-amber-700"> TBC</span> /
        <span className="text-red-700"> missing</span>. A record is
        <span className="text-blue-700"> waiting</span> when every outstanding question has been asked, and
        <span className="text-red-700"> overdue</span> once {SPECS_AGREED_LABEL.toLowerCase()} has passed.
      </p>

      {/* Overdue is driven by ONE project date, so when it has passed every
          outstanding record is overdue at once. That makes a per-row chip pure
          repetition -- the row's dot already carries it -- and this banner the
          only place the fact is worth stating. */}
      {overdueBy !== null && overdueBy > 0 && (
        <p className="mt-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
          {SPECS_AGREED_LABEL} {programme?.specsAgreedBy} — {overdueBy} day{overdueBy === 1 ? "" : "s"} ago.
          Everything still outstanding below is overdue.{" "}
          <Link href={`/dashboard/projects/${projectId}`} className="underline">
            Check the programme
          </Link>
          .
        </p>
      )}

      {/* An absent date is NOT "on time". Saying nothing here would let a
          project with no programme read as a healthy one. */}
      {programme && !programme.specsAgreedBy && (
        <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {hasProgramme(programme)
            ? `No date for ${SPECS_AGREED_LABEL.toLowerCase()}, so nothing here can be flagged overdue.`
            : "No programme recorded for this project, so nothing here can be flagged overdue — which is not the same as being on time."}{" "}
          <Link href={`/dashboard/projects/${projectId}`} className="underline">
            Set the TOE dates
          </Link>
          .
        </p>
      )}

      <div className="mt-4 overflow-x-auto border border-neutral-200 rounded-lg bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">No.</th>
              <th className="text-left font-medium px-3 py-2">Client ref</th>
              <th className="text-left font-medium px-3 py-2">Item</th>
              <th className="text-left font-medium px-3 py-2">Category</th>
              <th className="text-left font-medium px-3 py-2">Qty</th>
              <th className="text-left font-medium px-3 py-2">Spec fields</th>
              <th className="text-left font-medium px-3 py-2">Readiness</th>
              <th className="text-left font-medium px-3 py-2">Chased</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {records.map((record) => {
              const outstanding = n(record.spec_tbc) + n(record.spec_missing) + n(record.ready_tbc) + n(record.ready_missing);
              const anyMissing = n(record.spec_missing) + n(record.ready_missing) > 0;
              // Waiting only counts when EVERY outstanding question has been
              // chased. One unasked question means the record still needs work,
              // and calling that "waiting" would hide it.
              const allChased = outstanding > 0 && record.waiting >= outstanding;
              const urgency = recordUrgency({
                outstanding,
                allChased,
                specsAgreedBy: programme?.specsAgreedBy ?? null,
                today,
              });
              // Amber is the one distinction the shared urgency does not carry:
              // outstanding but nothing actually missing means every gap is a
              // TBC somebody has looked at.
              const dot =
                urgency === "action_required" && !anyMissing ? "bg-amber-500" : DOTS[urgency];
              const dotLabel = URGENCY_LABELS[urgency];
              return (
                <tr key={record.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2 text-neutral-500 tabular-nums">
                    <span title={dotLabel} className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${dot}`} />
                    {record.record_no}
                  </td>
                  <td className="px-3 py-2 font-medium text-neutral-900">{record.refs ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/records/${record.id}`} className="text-neutral-900 underline hover:text-neutral-600">
                      {record.item_description}
                    </Link>
                    {record.product_reference && <span className="text-neutral-500"> · {record.product_reference}</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-700">
                    {record.category_name ?? <span className="text-red-700">none</span>}
                    {record.category_name && !record.requirements_authored && (
                      <span className="ml-1 text-xs text-amber-800">(not yet defined)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-700 tabular-nums">{record.qty ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Counts settled={n(record.spec_settled)} tbc={n(record.spec_tbc)} missing={n(record.spec_missing)} total={n(record.spec_total)} />
                  </td>
                  <td className="px-3 py-2">
                    <Counts settled={n(record.ready_settled)} tbc={n(record.ready_tbc)} missing={n(record.ready_missing)} total={n(record.ready_total)} />
                  </td>
                  <td className="px-3 py-2">
                    {record.waiting > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded border text-blue-800 border-blue-300 bg-blue-50">
                        {allChased ? "Waiting" : `${record.waiting} asked`}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function RecordsPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Spec table</h1>
      <Suspense fallback={<Spinner label="Loading" />}>
        <RecordsTable />
      </Suspense>
    </div>
  );
}
