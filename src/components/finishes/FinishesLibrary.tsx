"use client";

// The project's finishes library.
//
// Sorted by the client's own code, because that is how their schedule is
// organised and how they will ask about it. Each row says what the code means
// and which line items carry it — "if that code changes, it needs to change on
// all of them" is the requirement this page exists for, and the count is the
// first half of the answer.
//
// THE LIBRARY IS THE TRUTH. Editing a finish here changes what every linked
// item's export cell says and recomposes each one's checklist answer. The one
// thing it cannot move is an answer somebody typed — that stays theirs — so
// the result names those items rather than letting them quietly fall behind.
//
// ---- SEARCHING AND FILTERING -------------------------------------------
//
// A real project's library is a scroll, and the question is usually "what is
// the fabric on the MAIN RUN chairs" rather than "show me everything". So:
// free text over the code and everything recorded about it AND the items that
// carry it, a KIND dropdown, and a RUN dropdown.
//
// All three are client-side over the payload that is already loaded — there is
// no second request and no spinner between typing and seeing.
//
// THE RUN FILTER NARROWS WHAT IS LISTED, NEVER WHAT AN EDIT TOUCHES. A finish
// is project-scoped by design (`project_finishes` is unique on
// (project_id, code_norm)), so correcting one while looking at a single run
// still corrects it on every run. The used-on count therefore stays the TOTAL
// and the edit panel goes on quoting the total; the run filter adds "n on
// <run>" beside it rather than replacing it. Showing the filtered count as
// though it were the blast radius is how somebody edits a confirmed fabric
// believing it reaches two items when it reaches eleven.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import { FINISH_KINDS, FINISH_KIND_LABELS, type FinishKind } from "@/lib/finishes";
import FinishSwatch from "@/components/finishes/FinishSwatch";
import Button from "@/components/ui/Button";

type UsedOn = {
  recordId: string;
  label: string;
  itemDescription: string;
  runId: string;
  runName: string;
  attributeLabel: string;
};
type Finish = {
  id: string; code: string; code_norm: string; kind: FinishKind | null;
  description: string | null; supplier_raw: string | null; reference: string | null; colour: string | null;
  notes: string | null; state: "confirmed" | "tbc"; status: "active" | "retired";
  version: number; retired_at: string | null; retired_by: string | null;
  updated_at: string; updated_by: string | null;
  swatch_attachment_id: string | null;
  used_on: UsedOn[];
};
type Run = { id: string; name: string };
type Payload = {
  project: { id: string; number: string; name: string };
  finishes: Finish[];
  runs: Run[];
  unlinked: { code: string; records: number }[];
};

type Draft = {
  code: string; kind: string; description: string; supplierRaw: string;
  reference: string; colour: string; notes: string; state: "confirmed" | "tbc"; reason: string;
};

const draftOf = (finish: Finish): Draft => ({
  code: finish.code,
  kind: finish.kind ?? "",
  description: finish.description ?? "",
  supplierRaw: finish.supplier_raw ?? "",
  reference: finish.reference ?? "",
  colour: finish.colour ?? "",
  notes: finish.notes ?? "",
  state: finish.state,
  reason: "",
});

/** "Not said" is a real answer and gets its own option, not an absence. */
const NO_KIND = "__none__";

/**
 * Everything about a finish a person might type to find it: the code, what the
 * library records, and the items that carry it — because "the Panther bench
 * fabric" is how somebody looks for a code they cannot remember.
 */
function haystack(finish: Finish): string {
  return [
    finish.code,
    finish.kind ? FINISH_KIND_LABELS[finish.kind] : "",
    finish.description,
    finish.supplier_raw,
    finish.reference,
    finish.colour,
    finish.notes,
    ...finish.used_on.map((use) => `${use.label} ${use.itemDescription} ${use.runName} ${use.attributeLabel}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function FinishesLibrary({ projectId }: { projectId: string }) {
  const id = projectId;
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [runFilter, setRunFilter] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/projects/${id}/finishes`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Reload first, report afterwards — a reload clears the banner. */
  async function reloadThen(message: string | null, ok: boolean) {
    await load();
    if (!ok) setError(message);
    else {
      setError(null);
      setNote(message);
    }
  }

  async function save(finish: Finish) {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ recordsTouched: number; recordsWithManualAnswers: { label: string }[] }>(
        `/api/projects/${id}/finishes/${finish.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: finish.version,
            reason: draft.reason || undefined,
            code: draft.code,
            kind: draft.kind ? (draft.kind as FinishKind) : null,
            description: draft.description || null,
            supplierRaw: draft.supplierRaw || null,
            reference: draft.reference || null,
            colour: draft.colour || null,
            notes: draft.notes || null,
            state: draft.state,
          }),
        },
      );
      if (!res.ok) {
        await reloadThen(res.error, false);
        return;
      }
      const stuck = res.data.recordsWithManualAnswers ?? [];
      await reloadThen(
        `Updated on ${res.data.recordsTouched} item${res.data.recordsTouched === 1 ? "" : "s"}.` +
          (stuck.length > 0
            ? ` ${stuck.length} of them (${stuck.map((row) => row.label).join(", ")}) has a value somebody typed by hand, so it did not follow — change it there if it should.`
            : ""),
        true,
      );
      setEditing(null);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  /**
   * FILING A FINISH UNDER ITS KIND, FROM THE ROW.
   *
   * The kind filter is dead until something records a kind, and nothing does:
   * `kind` is never inferred, deliberately — `classifyGroup` already guesses a
   * group from the words in a label, and a second guess stacked on it fills the
   * register with confident mistakes. So a person says it, and saying it has to
   * cost one click or nobody will file eleven codes.
   *
   * Offered only on a TBC finish, which is the route's own rule rather than a
   * new one: a CONFIRMED finish is a decision, and changing one needs a reason,
   * which is what the Edit panel collects.
   */
  async function setKind(finish: Finish, kind: string) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${id}/finishes/${finish.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // EVERY field, not just the one that changed. `editFinish` REPLACES the
        // row — an omitted field is written as null — so a patch carrying only
        // the kind would quietly wipe the description, supplier and reference
        // off the finish it was filing.
        body: JSON.stringify({
          version: finish.version,
          code: finish.code,
          kind: kind ? (kind as FinishKind) : null,
          description: finish.description,
          supplierRaw: finish.supplier_raw,
          reference: finish.reference,
          colour: finish.colour,
          notes: finish.notes,
          state: finish.state,
        }),
      });
      await reloadThen(
        res.ok
          ? `${finish.code} is ${kind ? FINISH_KIND_LABELS[kind as FinishKind].toLowerCase() : "no longer filed under a kind"}.`
          : res.error,
        res.ok,
      );
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!newCode.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${id}/finishes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: newCode.trim() }),
      });
      await reloadThen(res.ok ? `Added ${newCode.trim()}.` : res.error, res.ok);
      if (res.ok) setNewCode("");
    } finally {
      setBusy(false);
    }
  }

  // Counts for the dropdowns, over the WHOLE active library rather than the
  // filtered view: a number that moves as you narrow is a number nobody can
  // use to decide where to look next.
  const active = useMemo(() => (data?.finishes ?? []).filter((finish) => finish.status === "active"), [data]);
  const retired = useMemo(() => (data?.finishes ?? []).filter((finish) => finish.status === "retired"), [data]);

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const finish of active) {
      const key = finish.kind ?? NO_KIND;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [active]);

  const runCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const finish of active) {
      for (const runId of new Set(finish.used_on.map((use) => use.runId))) {
        counts.set(runId, (counts.get(runId) ?? 0) + 1);
      }
    }
    return counts;
  }, [active]);

  // Every word has to land somewhere, so "mor black" finds the black Moore
  // without having to remember which field each word is in.
  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const matches = useCallback(
    (finish: Finish) => {
      if (kindFilter === NO_KIND) {
        if (finish.kind !== null) return false;
      } else if (kindFilter && finish.kind !== kindFilter) {
        return false;
      }
      if (runFilter && !finish.used_on.some((use) => use.runId === runFilter)) return false;
      if (terms.length === 0) return true;
      const hay = haystack(finish);
      return terms.every((term) => hay.includes(term));
    },
    [kindFilter, runFilter, terms],
  );

  const filtering = Boolean(query.trim() || kindFilter || runFilter);
  const shownActive = useMemo(() => active.filter(matches), [active, matches]);
  const shownRetired = useMemo(() => retired.filter(matches), [retired, matches]);
  const runName = data?.runs.find((run) => run.id === runFilter)?.name ?? null;

  function clearFilters() {
    setQuery("");
    setKindFilter("");
    setRunFilter("");
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading finishes" />;

  return (
    <div>
      <h2 className="text-lg font-semibold text-neutral-900">Finishes library</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Every finish code this project&rsquo;s documents carry, and the items that use it. Correcting one here corrects
        it on every linked item at once — which is the only way to correct one, because a client finish code exists
        nowhere but on their drawings.
      </p>

      {error && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      {note && <p className="mt-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{note}</p>}

      {data.unlinked.length > 0 && (
        <div className="mt-3 border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm">
          <p className="text-amber-900">
            {data.unlinked.length} code{data.unlinked.length === 1 ? "" : "s"} on the drawings {data.unlinked.length === 1 ? "is" : "are"} not
            in the library yet, so correcting {data.unlinked.length === 1 ? "it" : "them"} once is not possible:
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {data.unlinked.map((row) => `${row.code} (${row.records} item${row.records === 1 ? "" : "s"})`).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Run <code className="font-mono">npm run db:backfill-finishes -- --apply</code> to bring them in.
          </p>
        </div>
      )}

      {/* FIND ONE. Text, kind, run — the three ways a person asks for a finish
          out loud. All of it narrows the LIST; none of it narrows an edit. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm border border-neutral-200 bg-neutral-50 rounded-lg px-3 py-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a code, a description, or an item"
          className="border border-neutral-300 rounded px-2 py-1 w-72 max-w-full"
          aria-label="Search the finishes library"
        />
        <select
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
          className="border border-neutral-300 rounded px-2 py-1 bg-white"
          aria-label="Filter by kind"
        >
          <option value="">All kinds ({active.length})</option>
          {FINISH_KINDS.filter((kind) => kindCounts.has(kind)).map((kind) => (
            <option key={kind} value={kind}>
              {FINISH_KIND_LABELS[kind]} ({kindCounts.get(kind)})
            </option>
          ))}
          {kindCounts.has(NO_KIND) && (
            <option value={NO_KIND}>Kind not said ({kindCounts.get(NO_KIND)})</option>
          )}
        </select>
        <select
          value={runFilter}
          onChange={(event) => setRunFilter(event.target.value)}
          className="border border-neutral-300 rounded px-2 py-1 bg-white"
          aria-label="Filter by run"
        >
          <option value="">All runs</option>
          {data.runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name} ({runCounts.get(run.id) ?? 0})
            </option>
          ))}
        </select>
        {filtering && (
          <Button size="xs" variant="quiet" onClick={clearFilters}>
            Clear
          </Button>
        )}
        {filtering && (
          <span className="text-xs text-neutral-500">
            {shownActive.length} of {active.length} finish{active.length === 1 ? "" : "es"}
          </span>
        )}
      </div>

      {/* A dropdown offering one option reads as broken. It is not: nothing
          infers a kind, so until somebody files these codes there is nothing to
          filter by, and the row's own picker is where that happens. */}
      {active.length > 0 && kindCounts.size === 1 && kindCounts.has(NO_KIND) && (
        <p className="mt-2 text-xs text-neutral-500">
          No finish has a kind recorded yet, so there is nothing to filter by — nothing guesses whether a code is a
          fabric or a timber. Set one on any row and it becomes a filter.
        </p>
      )}

      {/* The one thing a filter must not be allowed to imply. */}
      {runFilter && (
        <p className="mt-2 text-xs text-neutral-500">
          Showing the finishes used on <span className="text-neutral-700">{runName}</span>. A finish belongs to the
          project, not to a run — editing one still changes it on every run that uses it.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <input
          value={newCode}
          onChange={(event) => setNewCode(event.target.value)}
          placeholder="CH-01.1"
          className="border border-neutral-300 rounded px-2 py-1"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={!newCode.trim() || busy}
          className="border border-neutral-300 rounded px-3 py-1 hover:bg-neutral-50 disabled:opacity-50"
        >
          Add a finish
        </button>
      </div>

      {active.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          No finishes yet. They arrive when a drawing naming a finish code is confirmed, or you can add one above.
        </p>
      ) : shownActive.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          Nothing in the library matches.{" "}
          <button type="button" onClick={clearFilters} className="underline hover:text-neutral-900">
            Clear the filters
          </button>{" "}
          to see all {active.length}.
        </p>
      ) : (
        <ul className="mt-4 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
          {shownActive.map((finish) => {
            const onRun = runFilter ? finish.used_on.filter((use) => use.runId === runFilter).length : 0;
            return (
            <li key={finish.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <FinishSwatch finishId={finish.id} hasSwatch={Boolean(finish.swatch_attachment_id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-sm font-medium text-neutral-900">{finish.code}</span>
                    {finish.state === "tbc" ? (
                      <select
                        value={finish.kind ?? ""}
                        disabled={busy}
                        onChange={(event) => void setKind(finish, event.target.value)}
                        aria-label={`Kind of ${finish.code}`}
                        className={`text-xs border rounded px-1 py-0.5 bg-white disabled:opacity-50 ${
                          finish.kind ? "border-neutral-200 text-neutral-600" : "border-dashed border-neutral-300 text-neutral-400"
                        }`}
                      >
                        <option value="">Kind?</option>
                        {FINISH_KINDS.map((kind) => (
                          <option key={kind} value={kind}>{FINISH_KIND_LABELS[kind]}</option>
                        ))}
                      </select>
                    ) : (
                      finish.kind && <span className="text-xs text-neutral-500">{FINISH_KIND_LABELS[finish.kind]}</span>
                    )}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded border ${
                        finish.state === "confirmed"
                          ? "text-green-700 border-green-300 bg-green-50"
                          : "text-amber-800 border-amber-300 bg-amber-50"
                      }`}
                    >
                      {finish.state === "confirmed" ? "Confirmed" : "TBC"}
                    </span>
                    {/* The TOTAL, always. The run filter adds to it; it never
                        replaces it. */}
                    <Button size="xs" variant="quiet" onClick={() => setExpanded(expanded === finish.id ? null : finish.id)}>
                      used on {finish.used_on.length} item{finish.used_on.length === 1 ? "" : "s"}
                      {runFilter && <span className="ml-1 text-neutral-500">· {onRun} on {runName}</span>}
                    </Button>
                    <Button
                      size="xs"
                      className="ml-auto"
                      onClick={() => {
                        setEditing(editing === finish.id ? null : finish.id);
                        setDraft(draftOf(finish));
                      }}
                    >
                      {editing === finish.id ? "Cancel" : "Edit"}
                    </Button>
                  </div>
                  <p className="mt-0.5 text-sm text-neutral-700">
                    {finish.description ?? <span className="text-neutral-400">Nothing recorded yet</span>}
                    {finish.supplier_raw && <span className="text-neutral-500"> · {finish.supplier_raw}</span>}
                    {finish.reference && <span className="text-neutral-500"> · {finish.reference}</span>}
                    {finish.colour && <span className="text-neutral-500"> · {finish.colour}</span>}
                  </p>
                  {finish.notes && <p className="mt-0.5 text-xs text-neutral-500">{finish.notes}</p>}
                </div>
              </div>

              {expanded === finish.id && (
                <ul className="mt-2 ml-1 border-l-2 border-neutral-200 pl-3 space-y-0.5">
                  {finish.used_on.length === 0 ? (
                    <li className="text-xs text-neutral-500">
                      Nothing uses this yet. It can be retired without affecting any item.
                    </li>
                  ) : (
                    /* EVERY use, including the runs the filter is hiding: this
                       list is what an edit reaches, and a filtered one would
                       understate it. */
                    finish.used_on.map((use) => (
                      <li key={`${use.recordId}:${use.attributeLabel}`} className="text-xs">
                        <Link href={`/dashboard/records/${use.recordId}`} className="text-neutral-700 underline hover:text-neutral-900">
                          <span className="font-mono">{use.label}</span> {use.itemDescription}
                        </Link>
                        <span className={runFilter && use.runId === runFilter ? "text-neutral-600" : "text-neutral-400"}>
                          {" "}· {use.runName} · as {use.attributeLabel}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}

              {editing === finish.id && draft && (
                <div className="mt-3 border border-neutral-300 rounded-lg bg-neutral-50 px-3 py-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <label className="text-neutral-600">
                      Code
                      <input
                        value={draft.code}
                        onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white font-mono"
                      />
                    </label>
                    <label className="text-neutral-600">
                      Kind
                      <select
                        value={draft.kind}
                        onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      >
                        <option value="">— not said —</option>
                        {FINISH_KINDS.map((kind) => (
                          <option key={kind} value={kind}>{FINISH_KIND_LABELS[kind]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-neutral-600 sm:col-span-2">
                      What it is
                      <input
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        placeholder="Yarn Collective Tessarae"
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600">
                      Supplier (as written)
                      <input
                        value={draft.supplierRaw}
                        onChange={(event) => setDraft({ ...draft, supplierRaw: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600">
                      Reference
                      <input
                        value={draft.reference}
                        onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
                        placeholder="YC04158 - 01"
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600">
                      Colourway
                      <input
                        value={draft.colour}
                        onChange={(event) => setDraft({ ...draft, colour: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600">
                      State
                      <select
                        value={draft.state}
                        onChange={(event) => setDraft({ ...draft, state: event.target.value as "confirmed" | "tbc" })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      >
                        <option value="tbc">TBC — not decided</option>
                        <option value="confirmed">Confirmed</option>
                      </select>
                    </label>
                    <label className="text-neutral-600 sm:col-span-2">
                      Notes
                      <input
                        value={draft.notes}
                        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600 sm:col-span-2">
                      Why is this changing?
                      <input
                        value={draft.reason}
                        onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                        placeholder={
                          finish.state === "confirmed"
                            ? "Required — this finish is confirmed and is on live items"
                            : "Optional while the finish is still TBC"
                        }
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                  </div>
                  {/* The TOTAL again, whatever the run filter says. */}
                  <p className="mt-2 text-xs text-neutral-500">
                    Saving changes what all {finish.used_on.length} linked item{finish.used_on.length === 1 ? "" : "s"} show
                    and export{runFilter ? ", on every run, not only the one being shown" : ""}. An answer somebody typed
                    by hand stays theirs and will be named.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void save(finish)}
                      disabled={busy}
                      className="border border-neutral-300 rounded px-3 py-1 text-sm bg-white hover:bg-neutral-100 disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <FinishSwatch.Upload finishId={finish.id} projectId={id} onDone={() => void load()} />
                  </div>
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}

      {shownRetired.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Retired</h3>
          <ul className="mt-1 text-sm text-neutral-500">
            {shownRetired.map((finish) => (
              <li key={finish.id} className="font-mono">
                {finish.code}
                {finish.retired_by && <span className="font-sans"> · retired by {finish.retired_by}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
