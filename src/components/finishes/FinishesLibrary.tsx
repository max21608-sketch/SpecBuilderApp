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
// ---- ELEVEN FINISHES ARE ROWS, NOT CARDS --------------------------------
//
// The approved mock-up (`docs/design/spec-builder-mockups.html`,
// `#finishes-library`) is a table: code, kind, description, state and use count
// all alignable down the page, which is what makes "which of these has no kind"
// a glance rather than a read. The bordered list this replaced put each of
// those five facts in a different place on every row.
//
// This component starts UNDER the project's tab strip. The title and the
// sentence that used to be here belong to the header band, which the project
// page owns — a second h1 lower down the page is the thing `PageHeader` exists
// to stop.
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
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import BulkAddFinishes from "@/components/finishes/BulkAddFinishes";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import { FINISH_KINDS, FINISH_KIND_LABELS, type FinishKind } from "@/lib/finishes";
import { suggestKindsFor } from "@/lib/finish-kind-guess";
import FinishSwatch from "@/components/finishes/FinishSwatch";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import SuggestButton from "@/components/ui/SuggestButton";
import { Table, Th, Td, Tr, GroupRow } from "@/components/ui/Table";

type UsedOn = {
  recordId: string;
  label: string;
  itemDescription: string;
  runId: string;
  runName: string;
  attributeLabel: string;
};
type Finish = {
  id: string; code: string; code_norm: string; code_origin: string; kind: FinishKind | null;
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

/** Swatch, code, kind, description, state, used on, edit. */
const COLUMNS = 7;

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

/**
 * Why nothing can be suggested for this code, in the words the row prints.
 *
 * `CH` is the standing example and the reason this sentence exists: the real
 * Panther set prints `CH-01.1` and `CH-01.2`, `CODE_PREFIXES` deliberately does
 * not map `CH`, and no page anywhere says what it means. Printing that is a
 * different thing from an empty cell — it says the guess was considered and
 * there was nothing to make it from, which is a question somebody can answer.
 */
function whyNoSuggestion(finish: Finish): string {
  const prefix = /^[A-Za-z]+/.exec(finish.code.trim())?.[0];
  if (prefix) return `no page says what ${prefix.toUpperCase()} means`;
  return "the code says nothing this app reads";
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
   * `kind` is still never INFERRED — nothing writes one on its own. What the
   * app does now is SUGGEST one, from the client's own code prefix and the
   * words of the description, and print the evidence beside it; a person's
   * click is what files it. That is the `level_suggested` rule (0025) in a
   * second place, and it is why the register cannot fill with confident
   * mistakes: every one of them was agreed to by somebody looking at the row.
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

  /**
   * FILE EVERY SUGGESTED KIND IN ONE ACT.
   *
   * Sends the ids and the versions and NOT the kinds: the route re-derives each
   * one from the live row, so this button can only file what the screen showed.
   * The whole lot lands under one change set, because eleven finishes filed in
   * one press is one thing that happened, not eleven.
   */
  async function fileAllKinds() {
    const pending = fileable;
    if (pending.length === 0) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ filed: { code: string; kind: string }[]; skipped: { code: string; why: string }[] }>(
        `/api/projects/${id}/finishes/kinds`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            finishes: pending.map((finish) => ({ id: finish.id, version: finish.version })),
          }),
        },
      );
      if (!res.ok) {
        await reloadThen(res.error, false);
        return;
      }
      // Name what was skipped. A count that quietly came back smaller than the
      // one on the button is how somebody believes a code was filed when it
      // was not.
      const filed = `${res.data.filed.length} finish${res.data.filed.length === 1 ? "" : "es"} filed`;
      const skipped = res.data.skipped.length
        ? ` · ${res.data.skipped.map((entry) => `${entry.code} not filed — ${entry.why}`).join("; ")}`
        : "";
      await reloadThen(`${filed}${skipped}`, true);
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

  /**
   * WHAT THE APP WOULD FILE EACH UNFILED ROW AS, and why.
   *
   * Derived on the client from the payload already loaded, like the filters —
   * there is no second request, and `suggestFinishKind` is the SAME pure
   * function the bulk route re-runs server-side against the live row. The
   * server deriving it again rather than trusting this list is the
   * `proposalBlockers()` rule: two readers, one implementation, so a button can
   * only ever file what the row beside it offered.
   */
  const suggestions = useMemo(
    () => new Map(suggestKindsFor(active).map((entry) => [entry.id, entry.suggestion])),
    [active],
  );

  /**
   * The rows "file all" would actually write, which is NOT every suggestion.
   *
   * A CONFIRMED finish is a decision, and changing one needs a reason the Edit
   * panel collects — the route's own rule, and the same reason the inline
   * picker has always been offered on TBC rows alone. Counting suggestions in
   * the banner and filing only the TBC ones would put a number on the button
   * that does not match what it does, which is the mismatch the check sheet
   * exists to prevent, in miniature.
   */
  const fileable = useMemo(
    () => active.filter((finish) => suggestions.has(finish.id) && finish.state === "tbc"),
    [active, suggestions],
  );

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

  /**
   * The rows in two blocks: everything the screen has something to say about,
   * then everything it has not.
   *
   * A code with no kind and nothing to suggest is not the same problem as a
   * code waiting for one click, and mixing them makes the second invisible.
   * The order INSIDE each block is the library's own — the client's code order,
   * which is how their schedule reads.
   */
  const withSomething = shownActive.filter((finish) => finish.kind !== null || suggestions.has(finish.id));
  const withNothing = shownActive.filter((finish) => finish.kind === null && !suggestions.has(finish.id));

  function clearFilters() {
    setQuery("");
    setKindFilter("");
    setRunFilter("");
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading finishes" />;

  const noKind = kindCounts.get(NO_KIND) ?? 0;

  /** One finish, as its data row plus whichever panels are open under it. */
  function rowsFor(finish: Finish) {
    const onRun = runFilter ? finish.used_on.filter((use) => use.runId === runFilter).length : 0;
    // Only where nothing is filed — `suggestKindsFor` skips a finish that
    // already carries a kind, because re-suggesting over one would be the app
    // second-guessing a person's decision.
    const suggestion = suggestions.get(finish.id);
    const uses = finish.used_on.length;
    return (
      <Fragment key={finish.id}>
        <Tr data-finish={finish.code}>
          <Td>
            <FinishSwatch finishId={finish.id} hasSwatch={Boolean(finish.swatch_attachment_id)} />
          </Td>
          <Td>
            <span className="font-mono font-semibold text-neutral-900">{finish.code}</span>
            {/* WHOSE CODE IT IS (0036). `BW-F-001` was minted by this app
                because the client's document gave the finish no code, and it
                never reaches the BWS export, the quote or the costing sheet —
                those show the description alone. A reader scanning the library
                against a client schedule has to be able to tell which codes
                they will not find on it. */}
            {finish.code_origin === "internal" && (
              <span className="mt-0.5 block text-[11px] text-neutral-500">ours — the client gave no code</span>
            )}
          </Td>
          <Td>
            {/* FILED, SUGGESTED, OR NOTHING TO SAY — three different states and
                they read differently. A filed kind is a decision somebody took
                and is a Chip; a suggestion is dashed blue with the evidence it
                was read from; a row with neither says what it could not read
                rather than showing an empty control. */}
            {finish.kind ? (
              <>
                <Chip>{FINISH_KIND_LABELS[finish.kind]}</Chip>
                {/* WHO LAST TOUCHED THE ROW, which is not quite "who filed the
                    kind": `updated_by` moves on any edit. Said as what it is. */}
                {finish.updated_by && (
                  <span className="mt-1 block text-[11px] text-neutral-500">last changed by {finish.updated_by}</span>
                )}
              </>
            ) : suggestion ? (
              <SuggestButton
                value={FINISH_KIND_LABELS[suggestion.kind]}
                evidence={suggestion.reason}
                busy={busy}
                onAccept={() => void setKind(finish, suggestion.kind)}
              />
            ) : (
              <span className="block text-[11px] text-neutral-500">{whyNoSuggestion(finish)}</span>
            )}
            {/* THE PICKER, ON A TBC FINISH ONLY — the route's own rule: a
                confirmed finish is a decision and changing it needs a reason,
                which the Edit panel collects.

                ITS VALUE IS ALWAYS EMPTY, never the kind the row already holds.
                A select already reading "Timber" fires no change event when
                somebody chooses Timber, so the one action recording their
                agreement would do nothing at all — the level picker's trap
                (0025), which a pre-filled correction control walks into just as
                easily as a pre-filled suggestion. */}
            {finish.state === "tbc" && (
              <select
                value=""
                disabled={busy}
                onChange={(event) => void setKind(finish, event.target.value)}
                aria-label={`Kind of ${finish.code}`}
                className="mt-1 block rounded border border-dashed border-neutral-300 bg-white px-1 py-0.5 text-xs text-neutral-500 disabled:opacity-50"
              >
                <option value="">{finish.kind ? "Change…" : suggestion ? "or…" : "Kind?"}</option>
                {FINISH_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{FINISH_KIND_LABELS[kind]}</option>
                ))}
              </select>
            )}
          </Td>
          <Td>
            {finish.description ? (
              <span className="text-neutral-700">{finish.description}</span>
            ) : (
              <span className="text-neutral-400">Nothing recorded yet</span>
            )}
            {(finish.supplier_raw || finish.reference || finish.colour) && (
              <span className="block text-[11px] text-neutral-500">
                {[finish.supplier_raw, finish.reference, finish.colour].filter(Boolean).join(" · ")}
              </span>
            )}
            {finish.notes && <span className="block text-[11px] text-neutral-500">{finish.notes}</span>}
          </Td>
          <Td>
            <Chip tone={finish.state === "confirmed" ? "good" : "warn"}>
              {finish.state === "confirmed" ? "Confirmed" : "TBC"}
            </Chip>
          </Td>
          {/* THE TOTAL, always. The run filter adds to it; it never replaces
              it — this number is what an edit reaches. */}
          <Td num>
            <Button
              size="xs"
              variant="quiet"
              aria-label={`used on ${uses} item${uses === 1 ? "" : "s"}${runFilter ? ` · ${onRun} on ${runName}` : ""}`}
              onClick={() => setExpanded(expanded === finish.id ? null : finish.id)}
            >
              {uses} item{uses === 1 ? "" : "s"}
            </Button>
            {runFilter && (
              <span className="block text-[11px] text-neutral-500">
                {onRun} on {runName}
              </span>
            )}
          </Td>
          <Td className="text-right">
            <Button
              size="xs"
              variant="quiet"
              onClick={() => {
                setEditing(editing === finish.id ? null : finish.id);
                setDraft(draftOf(finish));
              }}
            >
              {editing === finish.id ? "Cancel" : "Edit"}
            </Button>
          </Td>
        </Tr>

        {/* A PANEL SPANNING THE ROW IS ITS OWN `<tr>`, never an extra colSpan
            cell beside the data cells. */}
        {expanded === finish.id && (
          <tr>
            <td colSpan={COLUMNS} className="border-b border-neutral-100 bg-[#fcfcfc] px-4 py-2">
              {uses === 0 ? (
                <p className="text-xs text-neutral-500">
                  Nothing uses this yet. It can be retired without affecting any item.
                </p>
              ) : (
                /* EVERY use, including the runs the filter is hiding: this list
                   is what an edit reaches, and a filtered one would understate
                   it. */
                <ul className="space-y-0.5">
                  {finish.used_on.map((use) => (
                    <li key={`${use.recordId}:${use.attributeLabel}`} className="text-xs">
                      <Link href={`/dashboard/records/${use.recordId}`} className="text-neutral-700 underline hover:text-neutral-900">
                        <span className="font-mono">{use.label}</span> {use.itemDescription}
                      </Link>
                      <span className={runFilter && use.runId === runFilter ? "text-neutral-600" : "text-neutral-400"}>
                        {" "}· {use.runName} · as {use.attributeLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        )}

        {editing === finish.id && draft && (
          <tr>
            <td colSpan={COLUMNS} className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <label className="text-neutral-600">
                  Code
                  <input
                    value={draft.code}
                    onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1 font-mono"
                  />
                </label>
                <label className="text-neutral-600">
                  Kind
                  <select
                    value={draft.kind}
                    onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1"
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
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1"
                  />
                </label>
                <label className="text-neutral-600">
                  Supplier (as written)
                  <input
                    value={draft.supplierRaw}
                    onChange={(event) => setDraft({ ...draft, supplierRaw: event.target.value })}
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1"
                  />
                </label>
                <label className="text-neutral-600">
                  Reference
                  <input
                    value={draft.reference}
                    onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
                    placeholder="YC04158 - 01"
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1"
                  />
                </label>
                <label className="text-neutral-600">
                  Colourway
                  <input
                    value={draft.colour}
                    onChange={(event) => setDraft({ ...draft, colour: event.target.value })}
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1"
                  />
                </label>
                <label className="text-neutral-600">
                  State
                  <select
                    value={draft.state}
                    onChange={(event) => setDraft({ ...draft, state: event.target.value as "confirmed" | "tbc" })}
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1"
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
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1"
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
                    className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1"
                  />
                </label>
              </div>
              {/* The TOTAL again, whatever the phase filter says. */}
              <p className="mt-2 text-xs text-neutral-500">
                Saving changes what all {uses} linked item{uses === 1 ? "" : "s"} show and export
                {runFilter ? ", on every phase, not only the one being shown" : ""}. An answer somebody typed by hand
                stays theirs and will be named.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void save(finish)}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <FinishSwatch.Upload finishId={finish.id} projectId={id} onDone={() => void load()} />
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <div>
      {error && <Note tone="danger">{error}</Note>}
      {note && <Note tone="good">{note}</Note>}

      {/* WHAT THE LIBRARY CANNOT REACH. A code a drawing carries but the
          library does not hold is a code nobody can correct once, which is the
          one promise this screen makes. */}
      {data.unlinked.length > 0 && (
        <Note
          tone="warn"
          title={`${data.unlinked.length} code${data.unlinked.length === 1 ? "" : "s"} on the drawings ${
            data.unlinked.length === 1 ? "is" : "are"
          } not in the library yet,`}
        >
          so correcting {data.unlinked.length === 1 ? "it" : "them"} once is not possible:{" "}
          {data.unlinked.map((row, index) => (
            <span key={row.code}>
              {index > 0 && " · "}
              <span className="font-mono">{row.code}</span> ({row.records} item{row.records === 1 ? "" : "s"})
            </span>
          ))}
          .{" "}
          {/* Bringing them in LINKS the attributes to the library rows, which
              nothing in the app does: `createFinish` writes the row and leaves
              `record_attributes.finish_id` null, so a button here would appear
              to work and change nothing. The backfill is the action there is. */}
          Bring them in with <code className="font-mono">npm run db:backfill-finishes -- --apply</code>.
        </Note>
      )}

      {/* WHAT THE APP CAN FILE FOR YOU, and the one button that does it.
          Nothing here is written until it is pressed — the row's own dashed
          button files one, this files all of them, and both show the evidence.
          Offered only where something is actually unfiled, so it disappears the
          moment the library is in order rather than becoming furniture. */}
      {fileable.length > 0 && (
        <Note
          tone="info"
          title={`${noKind} of ${active.length} finish${active.length === 1 ? "" : "es"} ${
            noKind === 1 ? "has" : "have"
          } no kind,`}
          actions={
            <>
              <Button size="xs" variant="secondary" disabled={busy} onClick={() => void fileAllKinds()}>
                File all {fileable.length}
              </Button>
              <span className="text-[11px] text-neutral-500">nothing is filed without a click.</span>
            </>
          }
        >
          and the kind is what the screens group and filter by. {fileable.length === 1 ? "One" : fileable.length} can
          be read straight off the client&rsquo;s own code or its description — each is shown below as a suggestion
          with its reason.
        </Note>
      )}

      {/* A dropdown offering one option reads as broken. It is not: a kind is
          suggested but never written, so until somebody files these codes there
          is nothing to filter by. Said only when there is nothing to suggest
          either — otherwise the note above is the more useful sentence. */}
      {active.length > 0 && kindCounts.size === 1 && kindCounts.has(NO_KIND) && fileable.length === 0 && (
        <Note tone="plain">
          No finish has a kind recorded yet, so there is nothing to filter by — and nothing in these codes or their
          descriptions says whether they are a fabric or a timber. Set one on any row and it becomes a filter.
        </Note>
      )}

      {/* FIND ONE, AND ADD ONE. Text, kind, run — the three ways a person asks
          for a finish out loud. All of it narrows the LIST; none of it narrows
          an edit. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a code, a description, or an item"
          className="w-72 max-w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          aria-label="Search the finishes library"
        />
        <select
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
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
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          aria-label="Filter by phase"
        >
          <option value="">All phases</option>
          {data.runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name} ({runCounts.get(run.id) ?? 0})
            </option>
          ))}
        </select>
        {filtering && (
          <>
            <Button size="xs" variant="quiet" onClick={clearFilters}>
              Clear
            </Button>
            <span className="text-xs text-neutral-500">
              {shownActive.length} of {active.length} finish{active.length === 1 ? "" : "es"}
            </span>
          </>
        )}
        <span className="flex-1" />
        <input
          value={newCode}
          onChange={(event) => setNewCode(event.target.value)}
          placeholder="CH-01.1"
          aria-label="A finish code to add"
          className="w-32 rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <Button variant="secondary" disabled={!newCode.trim() || busy} onClick={() => void create()}>
          Add a finish
        </Button>
      </div>

      {/* AND A LIST, because "set these out from the outset" is a project's
          codes arriving together off a schedule, not one at a time. */}
      <div className="mt-2">
        <BulkAddFinishes projectId={projectId} onCreated={load} />
      </div>

      {/* The one thing a filter must not be allowed to imply. */}
      {runFilter && (
        <p className="mt-2 text-xs text-neutral-500">
          Showing the finishes used on <span className="text-neutral-700">{runName}</span>. A finish belongs to the
          project, not to a phase — editing one still changes it on every phase that uses it.
        </p>
      )}

      {active.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          No finishes yet. They arrive when a drawing naming a finish code is confirmed — or set the library out now
          from a list, which is the way to have the codes in place before the first drawing lands.
        </p>
      ) : shownActive.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          Nothing in the library matches.{" "}
          <Button size="xs" variant="quiet" onClick={clearFilters}>
            Clear the filters
          </Button>{" "}
          to see all {active.length}.
        </p>
      ) : (
        <Card flush className="mt-3">
          <Table>
            <thead>
              <tr>
                <Th className="w-[54px]" />
                <Th className="w-[13%]">Code</Th>
                <Th className="w-[15%]">Kind</Th>
                <Th className="w-[34%]">Description</Th>
                <Th className="w-[10%]">State</Th>
                <Th num className="w-[11%]">Used on</Th>
                <Th className="w-[70px]" />
              </tr>
            </thead>
            <tbody>
              {withSomething.map((finish) => rowsFor(finish))}
              {withNothing.length > 0 && (
                <GroupRow span={COLUMNS} aside="the code says nothing and no description has been recorded">
                  Nothing to suggest
                </GroupRow>
              )}
              {withNothing.map((finish) => rowsFor(finish))}
            </tbody>
          </Table>
        </Card>
      )}

      {shownRetired.length > 0 && (
        <Card title="Retired" className="mt-4">
          <ul className="text-sm text-neutral-500">
            {shownRetired.map((finish) => (
              <li key={finish.id} className="font-mono">
                {finish.code}
                {finish.retired_by && <span className="font-sans"> · retired by {finish.retired_by}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
