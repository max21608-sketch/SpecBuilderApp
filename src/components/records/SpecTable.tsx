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
import Button, { buttonClass } from "@/components/ui/Button";
import { unallocatedQty } from "@/lib/record-variants";
import { NO_MATRIX_CATEGORY_EXPLANATION, type Gate } from "@/lib/gates";
import AddItem from "@/components/records/AddItem";
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
  status: string; retired_at: string | null; retired_by: string | null;
  qty: number | null; designer: string | null; area: string | null; boq_category: string | null;
  refs: string | null; run_id: string; run_name: string; attribute_count: string;
  /** A fabric split (0024): the bill line this configuration belongs to. */
  parent_id: string | null;
  variant_label: string | null;
  /** A configuration carries no client ref of its own — it shows its parent's. */
  parent_refs: string | null;
  /** Live configurations under this record. More than none makes it a HEADING. */
  variant_count: string;
  /** What its configurations have taken of the bill's quantity. */
  variant_qty: string;
  category_name: string | null; category_family: string | null; requirements_authored: boolean;
  spec_total: string; spec_settled: string; spec_tbc: string; spec_missing: string;
  ready_total: string; ready_settled: string; ready_tbc: string; ready_missing: string;
  level: string | null;
  /** A level this app guessed. Advisory: it tiers nothing until accepted. */
  level_suggested: string | null;
  level_suggested_reason: string | null;
  /** Derived per read, never stored: see /api/records. */
  waiting: number;
  /** null where the record has no level — not the same as "nothing is blocking". */
  to_quote_outstanding: number | null;
  to_quote_waiting: number;
  /**
   * Outstanding per gate, from Matthew's matrix (0026). NULL where this
   * record's category is not one of the nine his matrix covers — printed as
   * "—", never as zero, because "no rules written yet" and "nothing left to
   * do" are different answers.
   */
  gates: Record<Gate, number> | null;
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
  const [retiredCount, setRetiredCount] = useState(0);
  // Out by default. The export takes only active records, so a table that
  // listed retired ones beside the rest would describe a different set from
  // the file.
  const [showRetired, setShowRetired] = useState(false);
  const [acceptingLevels, setAcceptingLevels] = useState(false);
  const [categories, setCategories] = useState<{ id: string; family: string; name: string }[]>([]);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ projectId, runId });
    if (showRetired) query.set("includeRetired", "1");
    const res = await apiFetch<{
      records: SpecRecord[];
      programme: ProgrammeDates;
      retiredCount: number;
      categories: { id: string; family: string; name: string }[];
    }>(`/api/records?${query.toString()}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRecords(res.data.records);
    setProgramme(res.data.programme);
    setRetiredCount(Number(res.data.retiredCount ?? 0));
    setCategories(res.data.categories ?? []);
  }, [projectId, runId, showRetired]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Agree with every level this run's records were guessed. */
  async function acceptLevels() {
    setAcceptingLevels(true);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/levels/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      // Reload first, then report: this table clears its banner on a
      // successful load, so setting the message first would flash a refusal
      // and then show nothing at all.
      await load();
      if (!res.ok) setError(res.error);
    } finally {
      // Always, so a non-JSON error cannot leave the button dead.
      setAcceptingLevels(false);
    }
  }

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!records) return <Spinner label="Loading spec records" />;

  const n = (value: string) => Number(value);
  const today = todayLocal();
  const daysLate = daysUntilSpecsAgreed(programme?.specsAgreedBy ?? null, today);
  const overdueBy = daysLate === null ? null : -daysLate;
  const withSpecs = records.filter((record) => n(record.attribute_count) > 0).length;
  const uncategorised = records.filter((record) => !record.category_name).length;
  // Records carrying a level this app guessed and nobody has agreed to. Until
  // somebody does, every one of them is unquotable-by-unknown rather than
  // unquotable-by-answer, which is not the same thing and reads the same.
  const suggestedLevels = records.filter((record) => !record.level && record.level_suggested).length;

  // The export URL is a plain link, never apiFetch: the helper always reads the
  // body as text, and a workbook is bytes.
  const exportHref = `/api/projects/${projectId}/export?runId=${runId}`;

  return (
    <>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {records.length} record{records.length === 1 ? "" : "s"} · {withSpecs} with specs captured
          {uncategorised > 0 && <> · {uncategorised} with no checklist yet</>}
          {/* Said out loud, so "38 records" cannot quietly mean "38 of 41".
              A record retired by a BOQ revision is out of the export, and a
              BWS job created from it is NOT deleted by that absence — so
              somebody has to be able to find it. */}
          {retiredCount > 0 && (
            <>
              {" · "}
              <Button size="xs" variant="quiet" onClick={() => setShowRetired((value) => !value)}>
                {showRetired ? `hide the ${retiredCount} retired` : `${retiredCount} retired — show`}
              </Button>
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          {/* ADDING AN ITEM BY HAND is offered even on an empty run — that is
              the case it exists for. Until 0028 a record could only be created
              by confirming a bill, so a project whose documents are drawings
              and emails could not be started at all. */}
          <AddItem projectId={projectId} runId={runId} categories={categories} onAdded={load} />
        </div>
        {records.length > 0 && (
          <div className="flex items-center gap-2">
            {/* Anchors, because the browser has to fetch the file — but they
                produce a document, so they look like the actions they are. */}
            <a href={exportHref} className={buttonClass("primary")}>
              Export this run (.xlsx)
            </a>
            <a href={`${exportHref}&format=csv`} className={buttonClass("secondary")}>
              .csv
            </a>
            <a
              href={`/api/projects/${projectId}/export/check-sheet?runId=${runId}`}
              className={buttonClass("secondary")}
            >
              Check sheet
            </a>
            {/* THE QUOTE LINES, which are not the BWS file. Eight of Matthew's
                twelve columns; the four this app cannot fill are named below
                rather than left as gaps somebody prices off. */}
            <a
              href={`/api/projects/${projectId}/export/quote?runId=${runId}`}
              className={buttonClass("secondary")}
            >
              Quote lines
            </a>
          </div>
        )}
      </div>

      {/* ONE CLICK FOR THE RUN, because 59 records must not mean 59 visits —
          the same reason the drafts screen carries an inline level picker. It
          is still a person agreeing: the level of every record is on this
          screen with what it was guessed from, and this accepts only what is
          already suggested. */}
      {suggestedLevels > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <span>
            {suggestedLevels} record{suggestedLevels === 1 ? "" : "s"} carr{suggestedLevels === 1 ? "ies" : "y"} a
            level this app guessed from the bill and the drawings. Nothing is sorted into what blocks a quote until
            you agree with it — each one shows its reading in the Needed to quote column.
          </span>
          <Button
            size="xs"
            variant="secondary"
            disabled={acceptingLevels}
            onClick={() => void acceptLevels()}
          >
            {acceptingLevels ? "Accepting…" : `Accept all ${suggestedLevels}`}
          </Button>
        </div>
      )}

      {records.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          No records here yet. Import a bill of quantities, or add an item by hand.
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
                  <th className="text-left font-medium px-3 py-2">Needed to quote</th>
                  <th className="text-left font-medium px-3 py-2">TG0</th>
                  <th className="text-left font-medium px-3 py-2">TG1</th>
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
                    // Everything outstanding on this record has been asked and
                    // nobody has replied yet. That is a different state from
                    // "nobody has done anything", and the dot says so.
                    allChased: outstanding > 0 && record.waiting >= outstanding,
                    specsAgreedBy: programme?.specsAgreedBy ?? null,
                    today,
                  });
                  const dot = urgency === "action_required" && !anyMissing ? "bg-amber-500" : DOTS[urgency];
                  const attributes = n(record.attribute_count);
                  return (
                    <tr
                      key={record.id}
                      className={record.status === "retired" ? "bg-neutral-50 text-neutral-400" : "hover:bg-neutral-50"}
                      title={
                        record.status === "retired"
                          ? `Retired${record.retired_by ? ` by ${record.retired_by}` : ""}${record.retired_at ? ` on ${new Date(record.retired_at).toLocaleDateString()}` : ""}. Not in the export.`
                          : undefined
                      }
                    >
                      <td className="px-3 py-2 text-neutral-500 tabular-nums">
                        <span
                          title={URGENCY_LABELS[urgency]}
                          className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${dot}`}
                        />
                        {record.record_no}
                      </td>
                      {/* ==================================================
                          A CONFIGURATION IS SHOWN UNDER ITS BILL LINE.
                          It is sorted there by the query, indented here, and
                          named the way a person says it: S-201 A. Its own
                          `record_no` is just the next free number in the
                          project, so on its own it reads as an unrelated line.
                          ================================================== */}
                      <td className={`px-3 py-2 font-medium ${record.status === "retired" ? "text-neutral-400 line-through" : "text-neutral-900"}`}>
                        {record.variant_label ? (
                          <span className="pl-4 text-neutral-900">
                            <span className="text-neutral-400">└ </span>
                            {record.parent_refs ?? record.refs ?? "—"} {record.variant_label}
                          </span>
                        ) : (
                          (record.refs ?? "—")
                        )}
                        {/* A HEADING, not an item. Its configurations are what
                            the export ships — and a row that stayed silent
                            would read as an item nobody had specced. */}
                        {n(record.variant_count) > 0 && (
                          <span className="block text-xs font-normal text-neutral-500">
                            {n(record.variant_count)} configurations — they are what the export carries, not this line
                          </span>
                        )}
                      </td>
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
                      <td className="px-3 py-2 text-neutral-700 tabular-nums">
                        {record.qty ?? "—"}
                        {/* THE BILL'S QUANTITY IS NOT APPORTIONED BY ANYTHING.
                            The bill says 45 of S-201 and never says how many
                            are fabric A. Splitting it has a price attached, so
                            the table says how much is unaccounted for rather
                            than dividing it. */}
                        {n(record.variant_count) > 0 &&
                          record.qty !== null &&
                          unallocatedQty(record.qty, [n(record.variant_qty)]) !== 0 && (
                            <span className="block text-xs text-amber-800" title="Set a quantity on each configuration.">
                              {unallocatedQty(record.qty, [n(record.variant_qty)])} not allocated
                            </span>
                          )}
                      </td>
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
                      <td className="px-3 py-2 tabular-nums">
                        {record.to_quote_outstanding === null ? (
                          <Link
                            href={`/dashboard/records/${record.id}`}
                            className="text-amber-800 underline hover:text-amber-900"
                            title={
                              record.level_suggested
                                ? `Suggested ${record.level_suggested} — ${record.level_suggested_reason ?? "guessed"}. Nothing is sorted into what blocks a quote until somebody accepts it.`
                                : "No level set, so nothing on this record can be sorted into what blocks a quote."
                            }
                          >
                            {/* A SUGGESTION IS NOT A LEVEL, and the wording has
                                to keep saying so: the number in this column is
                                what blocks a quote, and it stays unavailable
                                until a person agrees. */}
                            {record.level_suggested ? `${record.level_suggested}?` : "Set level"}
                          </Link>
                        ) : record.to_quote_outstanding > 0 ? (
                          <span className="text-red-700 font-medium">
                            {record.to_quote_outstanding}
                            {record.to_quote_waiting > 0 && (
                              <span className="ml-1 text-xs text-blue-700 font-normal">
                                ({record.to_quote_waiting} asked)
                              </span>
                            )}
                          </span>
                        ) : record.category_name ? (
                          <span className="text-green-700">Can quote</span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      {/* THE GATES. Same numbers the record screen shows,
                          from the same `gateStatus` — a table that disagreed
                          with the screen it links to would be worse than no
                          column. */}
                      {(["TG0", "TG1"] as const).map((gate) => (
                        <td key={gate} className="px-3 py-2 tabular-nums">
                          {record.gates === null ? (
                            <span className="text-neutral-400" title={NO_MATRIX_CATEGORY_EXPLANATION}>
                              —
                            </span>
                          ) : record.gates[gate] > 0 ? (
                            <span className="text-red-700 font-medium">{record.gates[gate]}</span>
                          ) : (
                            <span className="text-green-700">✓</span>
                          )}
                        </td>
                      ))}
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
          {/* THE STANDING EXPLANATION GOES LAST. It is a permanent caveat about
              a file, not news about this run, and at the top it pushed the
              records themselves below the fold on every visit. */}
          <p className="mt-2 text-xs text-neutral-500">
            <strong>Quote lines</strong> is a different file: eight of the twelve columns Matthew&rsquo;s quote sheet
        carries. The prices, the UUID and the image URL are blank because this app holds none of them, and the
        interliner, stone, mattress and delivery lines are not generated — the interliner quantity is the fabric
        metreage, which this app deliberately does not hold. A person adds those and prices the file.
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        The export is always every record in scope — a BWS import replaces the fields it is given, so a partial file
            would erase what it left out. It carries no job number: it is a file to read, not to import. The check sheet
            is the same data one line per field, naming the document and page each value came from, for reading against
            the pack.
          </p>
        </>
      )}
    </>
  );
}
