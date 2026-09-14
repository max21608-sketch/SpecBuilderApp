"use client";

// Reviewing a set of shop drawings, one item card at a time.
//
// ============================================================================
// THE CARD IS THE ITEM, AND THE ITEM IS THE UNIT OF COMMIT.
//
// One page of the drawing set is one item, and that item can legitimately
// belong to the same code in SEVERAL runs — the mock-up, the main run and the
// value-engineered run all quote S-100, at different quantities, from one
// drawing. So the card shows every run it lands in as a tick, and confirming
// writes to all of them at once or to none.
//
// Unticking a run is how you say "the VE version is different". That is a
// decision, recorded as one: a run the reviewer never saw (because the bill was
// confirmed after this page loaded) is neither ticked nor unticked, and the
// confirm refuses rather than guessing.
//
// NOTHING HERE IS PRE-SELECTED WHERE THE ANSWER IS UNKNOWN. A run holding the
// code twice shows its candidates as buttons with nothing chosen; a page whose
// figures mix 190 and 735 gets no unit at all. A wrong unit reads as a real
// measurement and nothing downstream questions it.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { usePoll } from "@/lib/use-poll";
import Spinner from "@/components/ui/Spinner";
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_UNITS,
  DOCUMENT_KIND_LABELS,
  type AttributeGroup,
  type AttributeState,
} from "@/lib/spec-vocab";
import type { DrawingItem, DrawingObservation, StagedDrawings } from "@/lib/drawing-document";

type RunResolution =
  | { runId: string; runName: string; status: "matched"; record: { id: string; label: string; itemDescription: string } }
  | { runId: string; runName: string; status: "ambiguous"; candidates: { id: string; label: string; itemDescription: string }[] };

type ItemResolution = {
  id: string;
  resolution: { runs: RunResolution[]; suggested: string[] };
  targets: string[];
  blockers: { code: string; message: string; observationId?: string; runId?: string }[];
};

type Run = {
  id: string;
  status: string;
  version: number;
  error: string | null;
  document_kind: "shop_drawings";
  filename: string | null;
  claim_live: boolean | null;
  within_deadline: boolean | null;
  claim_count: number;
  parsed: StagedDrawings | null;
};

type SpecField = { id: string; json_id: number; name: string; field_category: string };

export default function DrawingsReview({ importId }: { importId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [resolution, setResolution] = useState<ItemResolution[]>([]);
  const [specFields, setSpecFields] = useState<SpecField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showApplied, setShowApplied] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  // Server-acked state is held separately from what the reviewer is typing, so
  // a reload cannot wipe an unsaved edit and an autosave cannot fight the input.
  const [drafts, setDrafts] = useState<Record<string, Partial<DrawingObservation>>>({});
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    const res = await apiFetch<{
      import: Run;
      resolution?: ItemResolution[];
      specFields?: SpecField[];
    }>(`/api/imports/${importId}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRun(res.data.import);
    setResolution(res.data.resolution ?? []);
    setSpecFields(res.data.specFields ?? []);
  }, [importId]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = run?.status === "queued" || run?.status === "parsing";
  usePoll(load, { intervalMs: 3000, active: Boolean(waiting) });

  const byItem = useMemo(() => new Map(resolution.map((entry) => [entry.id, entry])), [resolution]);

  async function startExtraction(action: "start" | "retry-dispatch" | "restart-expired") {
    if (!run) return;
    setBusy("extract");
    setError(null);
    try {
      const res = await apiFetch(`/api/imports/${importId}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: run.version, requestId: crypto.randomUUID(), action }),
      });
      if (!res.ok) setError(res.error);
      await load();
    } finally {
      setBusy(null);
    }
  }

  /** Serialised: two autosaves racing would each write the other's stale copy. */
  function queueSave(fn: () => Promise<void>) {
    saveChain.current = saveChain.current.then(fn, fn);
    return saveChain.current;
  }

  async function saveObservation(item: DrawingItem, observation: DrawingObservation, changes: Record<string, unknown>) {
    await queueSave(async () => {
      const res = await apiFetch(`/api/imports/${importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          observationId: observation.id,
          expectedVersion: observation.version,
          changes,
        }),
      });
      if (!res.ok) setError(res.error);
      await load();
    });
  }

  async function saveTargets(item: DrawingItem, ticked: string[], unticked: string[]) {
    await queueSave(async () => {
      const res = await apiFetch(`/api/imports/${importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, expectedVersion: item.version, changes: { ticked, unticked } }),
      });
      if (!res.ok) setError(res.error);
      await load();
    });
  }

  async function review(item: DrawingItem, observations: DrawingObservation[], action: "confirm" | "ignore" | "restore") {
    if (!run) return;
    // Every queued edit lands before the commit, or the versions sent will be
    // the ones the screen had before the last keystroke.
    await saveChain.current;
    setBusy(item.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/imports/${importId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          itemId: item.id,
          ...(action === "confirm" ? { itemVersion: item.version } : {}),
          observations: observations.map((observation) => ({ id: observation.id, version: observation.version })),
        }),
      });
      if (!res.ok) setError(res.error);
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!run) return error ? <p className="mt-6 text-sm text-red-700">{error}</p> : <Spinner label="Loading" />;

  // ---- not read yet --------------------------------------------------------
  if (run.status === "pending" || run.status === "failed") {
    return (
      <div className="mt-6 max-w-xl mx-auto border border-neutral-200 rounded-lg bg-white p-6 text-center">
        <p className="text-sm text-neutral-600">
          {run.filename ?? "This document"} · {DOCUMENT_KIND_LABELS.shop_drawings}
        </p>
        {run.status === "failed" && run.error && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-left">{run.error}</p>
        )}
        <p className="mt-3 text-sm text-neutral-700">
          The item codes and dimensions on these pages are drawn, not typed — only the model reading the page as an
          image can get them. This is the step that {run.status === "failed" ? "charges again." : "costs money."}
        </p>
        <button
          type="button"
          onClick={() => void startExtraction("start")}
          disabled={busy !== null}
          className="mt-4 text-sm px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy === "extract" ? "Starting…" : run.status === "failed" ? "Retry extraction" : "Read the drawings"}
        </button>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  // ---- in flight -----------------------------------------------------------
  if (waiting) {
    const restartable =
      (run.status === "parsing" && run.claim_live === false) ||
      (run.status === "queued" && run.within_deadline === false) ||
      run.claim_count >= 4;
    return (
      <div className="mt-6 max-w-xl mx-auto border border-neutral-200 rounded-lg bg-white p-6">
        <Spinner label="Reading the drawings" />
        <p className="mt-3 text-sm text-neutral-600">
          A long drawing set can take a few minutes. You can leave this page — it carries on without you.
        </p>
        {run.error && (
          <p className="mt-3 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
            Last attempt reported: {run.error}
          </p>
        )}
        {restartable && (
          <button
            type="button"
            onClick={() => void startExtraction("restart-expired")}
            disabled={busy !== null}
            className="mt-4 text-sm px-3 py-1.5 rounded border border-amber-400 text-amber-900 hover:bg-amber-50 disabled:opacity-50"
          >
            Start again (may be charged again)
          </button>
        )}
      </div>
    );
  }

  const staged = run.parsed;
  if (!staged || staged.items.length === 0) {
    return (
      <p className="mt-6 text-sm text-neutral-700">
        No items were found in this drawing set. That is a result, not an error — check the document is the one you
        meant, and that its pages are drawings rather than a scan.
      </p>
    );
  }

  const pendingItems = staged.items.filter((item) => item.observations.some((o) => o.reviewStatus === "pending"));
  const unresolved = pendingItems.filter((item) => (byItem.get(item.id)?.targets.length ?? 0) === 0);

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {staged.items.length} item{staged.items.length === 1 ? "" : "s"} · {pendingItems.length} still to review
        </p>
        <a
          href={`/api/imports/${importId}/source`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-neutral-600 hover:text-neutral-900 underline"
        >
          Open the original drawings
        </a>
      </div>

      {staged.documentNotes && (
        <p className="mt-3 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
          The model noted: {staged.documentNotes}
        </p>
      )}

      {unresolved.length > 0 && (
        <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {unresolved.length} item{unresolved.length === 1 ? "" : "s"} match no record yet. Confirm this pack&apos;s bill
          of quantities and reload — nothing needs re-reading, and you will not be charged again.
        </p>
      )}

      <div className="mt-4 space-y-4">
        {pendingItems.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            importId={importId}
            resolution={byItem.get(item.id)}
            specFields={specFields}
            drafts={drafts}
            setDrafts={setDrafts}
            busy={busy === item.id}
            onSaveObservation={saveObservation}
            onSaveTargets={saveTargets}
            onReview={review}
          />
        ))}
      </div>

      <CollapsedList
        title="Ignored"
        open={showIgnored}
        onToggle={() => setShowIgnored((value) => !value)}
        items={staged.items}
        status="ignored"
        onRestore={(item, observation) => void review(item, [observation], "restore")}
      />
      <CollapsedList
        title="Applied"
        open={showApplied}
        onToggle={() => setShowApplied((value) => !value)}
        items={staged.items}
        status="applied"
      />
    </div>
  );
}

// ---- one item ---------------------------------------------------------------

function ItemCard({
  item,
  importId,
  resolution,
  specFields,
  drafts,
  setDrafts,
  busy,
  onSaveObservation,
  onSaveTargets,
  onReview,
}: {
  item: DrawingItem;
  importId: string;
  resolution: ItemResolution | undefined;
  specFields: SpecField[];
  drafts: Record<string, Partial<DrawingObservation>>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Partial<DrawingObservation>>>>;
  busy: boolean;
  onSaveObservation: (item: DrawingItem, observation: DrawingObservation, changes: Record<string, unknown>) => Promise<void>;
  onSaveTargets: (item: DrawingItem, ticked: string[], unticked: string[]) => Promise<void>;
  onReview: (item: DrawingItem, observations: DrawingObservation[], action: "confirm" | "ignore" | "restore") => Promise<void>;
}) {
  const pending = item.observations.filter((o) => o.reviewStatus === "pending");
  const targets = resolution?.targets ?? [];
  const blockers = resolution?.blockers ?? [];
  const blockerFor = (observationId: string) => blockers.filter((b) => b.observationId === observationId);

  const toggleRun = (recordId: string, on: boolean) => {
    const ticked = new Set(item.targets?.ticked ?? resolution?.resolution.suggested ?? []);
    const unticked = new Set(item.targets?.unticked ?? []);
    if (on) {
      ticked.add(recordId);
      unticked.delete(recordId);
    } else {
      ticked.delete(recordId);
      unticked.add(recordId);
    }
    void onSaveTargets(item, [...ticked], [...unticked]);
  };

  return (
    <div className="border border-neutral-200 rounded-lg bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3 border-b border-neutral-100">
        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            {item.itemCodeRaw ?? "No item code on this page"}
            {item.itemNameRaw && <span className="ml-2 text-sm font-normal text-neutral-600">{item.itemNameRaw}</span>}
          </h3>
          <p className="text-xs text-neutral-500">
            {item.page ? (
              <a
                href={`/api/imports/${importId}/source#page=${item.page}`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-neutral-900"
              >
                Page {item.page}
              </a>
            ) : (
              "Page unknown"
            )}
            {item.confidence === "low" && <span className="ml-2 text-amber-700">code was hard to read</span>}
          </p>
        </div>
      </div>

      {/* Which runs this drawing applies to. */}
      <div className="px-4 py-3 border-b border-neutral-100">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Applies to</p>
        {(resolution?.resolution.runs.length ?? 0) === 0 && (
          <p className="mt-1 text-sm text-amber-900">
            No record carries this code yet. Confirm the bill of quantities for this pack, then reload.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-4">
          {resolution?.resolution.runs.map((run) =>
            run.status === "matched" ? (
              <label key={run.runId} className="flex items-center gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  checked={targets.includes(run.record.id)}
                  onChange={(event) => toggleRun(run.record.id, event.target.checked)}
                />
                <span>
                  {run.runName}
                  <span className="ml-1 text-xs text-neutral-500">
                    {run.record.label} · {run.record.itemDescription}
                  </span>
                </span>
              </label>
            ) : (
              <div key={run.runId} className="text-sm">
                <p className="text-amber-900">
                  {run.runName} has {run.candidates.length} lines with this code — choose which one:
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {/* Candidates, never a pre-selected guess. */}
                  {run.candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => toggleRun(candidate.id, true)}
                      className={`text-xs px-2 py-1 rounded border ${
                        targets.includes(candidate.id)
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      {candidate.label} · {candidate.itemDescription}
                    </button>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      {/* The specs themselves. */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="px-4 py-2 font-medium">Group</th>
            <th className="px-2 py-2 font-medium">Label</th>
            <th className="px-2 py-2 font-medium">Value</th>
            <th className="px-2 py-2 font-medium">Unit</th>
            <th className="px-2 py-2 font-medium">BWS field</th>
            <th className="px-2 py-2 font-medium">State</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {pending.map((observation) => {
            const draft = drafts[observation.id] ?? {};
            const value = draft.value !== undefined ? draft.value : observation.value;
            const rowBlockers = blockerFor(observation.id);
            return (
              <tr key={observation.id} className={rowBlockers.length ? "bg-amber-50/40" : undefined}>
                <td className="px-4 py-2 align-top">
                  <select
                    value={observation.attrGroup}
                    onChange={(event) =>
                      void onSaveObservation(item, observation, { attrGroup: event.target.value as AttributeGroup })
                    }
                    className="border border-neutral-300 rounded px-1 py-0.5 text-xs"
                  >
                    {ATTRIBUTE_GROUPS.map((group) => (
                      <option key={group} value={group}>
                        {ATTRIBUTE_GROUP_LABELS[group]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 align-top text-neutral-700">{observation.labelRaw ?? "—"}</td>
                <td className="px-2 py-2 align-top">
                  <input
                    value={value ?? ""}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [observation.id]: { ...draft, value: event.target.value } }))
                    }
                    onBlur={(event) => {
                      if (event.target.value === (observation.value ?? "")) return;
                      void onSaveObservation(item, observation, { value: event.target.value || null });
                    }}
                    className="w-full border border-neutral-300 rounded px-2 py-1 text-sm"
                  />
                  {observation.valueRaw !== null && observation.valueRaw !== observation.value && (
                    <p className="mt-0.5 text-xs text-neutral-400">drawing said: {observation.valueRaw}</p>
                  )}
                  {observation.materialCodeRaw && (
                    <p className="mt-0.5 text-xs text-neutral-500">code {observation.materialCodeRaw}</p>
                  )}
                </td>
                <td className="px-2 py-2 align-top">
                  {observation.attrGroup === "dimension" ? (
                    <select
                      value={observation.unit ?? ""}
                      onChange={(event) =>
                        void onSaveObservation(item, observation, { unit: event.target.value || null })
                      }
                      className={`border rounded px-1 py-0.5 text-xs ${
                        observation.unit === null ? "border-amber-400 bg-amber-50" : "border-neutral-300"
                      }`}
                    >
                      <option value="">Choose…</option>
                      {ATTRIBUTE_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                  {observation.unitSuggested && observation.unit && (
                    <p className="mt-0.5 text-xs text-amber-700">guessed from the figures</p>
                  )}
                </td>
                <td className="px-2 py-2 align-top">
                  {observation.attrGroup === "dimension" ? (
                    <span className="text-xs text-neutral-500">Dimensions</span>
                  ) : (
                    <select
                      value={observation.specFieldId ?? ""}
                      onChange={(event) =>
                        void onSaveObservation(item, observation, { specFieldId: event.target.value || null })
                      }
                      className="border border-neutral-300 rounded px-1 py-0.5 text-xs max-w-[12rem]"
                    >
                      <option value="">No BWS field</option>
                      {specFields.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-2 py-2 align-top">
                  <select
                    value={observation.state ?? ""}
                    onChange={(event) =>
                      void onSaveObservation(item, observation, { state: (event.target.value || null) as AttributeState | null })
                    }
                    className={`border rounded px-1 py-0.5 text-xs ${
                      observation.state === null ? "border-amber-400 bg-amber-50" : "border-neutral-300"
                    }`}
                  >
                    <option value="">Choose…</option>
                    <option value="confirmed">Stated</option>
                    <option value="tbc">TBC</option>
                  </select>
                </td>
                <td className="px-4 py-2 align-top text-right">
                  <button
                    type="button"
                    onClick={() => void onReview(item, [observation], "ignore")}
                    className="text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    Ignore
                  </button>
                </td>
                {rowBlockers.length > 0 && (
                  <td colSpan={7} className="px-4 pb-2 text-xs text-amber-900">
                    {rowBlockers.map((blocker) => blocker.message).join(" ")}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-neutral-100">
        <p className="text-xs text-neutral-500">
          {blockers.length > 0
            ? blockers.filter((b) => !b.observationId).map((b) => b.message).join(" ")
            : `Writes ${pending.length} spec${pending.length === 1 ? "" : "s"} to ${targets.length} record${targets.length === 1 ? "" : "s"}.`}
        </p>
        <button
          type="button"
          onClick={() => void onReview(item, pending, "confirm")}
          disabled={busy || blockers.length > 0 || pending.length === 0 || targets.length === 0}
          className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Confirming…" : `Confirm ${pending.length} spec${pending.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

// ---- reviewed rows ----------------------------------------------------------
// Kept in place with a flipped status, never removed: that is what makes ids
// stable and restore trivial.

function CollapsedList({
  title,
  open,
  onToggle,
  items,
  status,
  onRestore,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  items: DrawingItem[];
  status: "ignored" | "applied";
  onRestore?: (item: DrawingItem, observation: DrawingObservation) => void;
}) {
  const rows = items.flatMap((item) =>
    item.observations.filter((o) => o.reviewStatus === status).map((observation) => ({ item, observation })),
  );
  if (rows.length === 0) return null;

  return (
    <div className="mt-6">
      <button type="button" onClick={onToggle} className="text-sm text-neutral-600 hover:text-neutral-900">
        {open ? "▾" : "▸"} {title} ({rows.length})
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-neutral-100 border border-neutral-200 rounded bg-white">
          {rows.map(({ item, observation }) => (
            <li key={observation.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="text-neutral-500 w-24 truncate">{item.itemCodeRaw ?? "—"}</span>
              <span className="flex-1 text-neutral-800">
                {observation.labelRaw}: {observation.value ?? observation.valueRaw ?? "—"}
              </span>
              {status === "applied" ? (
                <span className="text-xs text-neutral-500">
                  on {observation.applied?.attributeIds.length ?? 0} record
                  {(observation.applied?.attributeIds.length ?? 0) === 1 ? "" : "s"}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRestore?.(item, observation)}
                  className="text-xs text-neutral-500 hover:text-neutral-900"
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
