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
import Disclosure, { DisclosureList } from "@/components/ui/Disclosure";
import { DOCUMENT_KIND_LABELS } from "@/lib/spec-vocab";
import type { DrawingItem, DrawingObservation, StagedDrawings } from "@/lib/drawing-document";
import ItemCard, {
  BulkUnit,
  type ItemResolution,
  type RecordChoice,
  type SpecField,
} from "@/components/imports/DrawingItemCard";

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

export default function DrawingsReview({ importId }: { importId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [resolution, setResolution] = useState<ItemResolution[]>([]);
  const [specFields, setSpecFields] = useState<SpecField[]>([]);
  const [records, setRecords] = useState<RecordChoice[]>([]);
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
      records?: RecordChoice[];
    }>(`/api/imports/${importId}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRun(res.data.import);
    setResolution(res.data.resolution ?? []);
    setSpecFields(res.data.specFields ?? []);
    setRecords(res.data.records ?? []);
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

  async function setBulkUnit(scope: "item" | "run", unit: "mm" | "cm", itemId?: string) {
    await queueSave(async () => {
      const res = await apiFetch(`/api/imports/${importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bulkUnit: { scope, unit, ...(itemId ? { itemId } : {}) } }),
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
  // Counted from the observations rather than from the blockers, so the offer
  // stands whether or not the card has other reasons it cannot commit.
  const unitsOutstanding = pendingItems.reduce(
    (total, item) =>
      total +
      item.observations.filter(
        (o) => o.reviewStatus === "pending" && o.attrGroup === "dimension" && o.unit === null && o.value?.trim(),
      ).length,
    0,
  );

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

      {/* Offered only where it is the answer. A set whose pages print their
          units, or whose figures agree, needs nothing here — showing the
          control anyway would invite overwriting a unit the page stated. */}
      {unitsOutstanding > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <span>
            {unitsOutstanding} dimension{unitsOutstanding === 1 ? "" : "s"} across this document still need a unit.
          </span>
          <BulkUnit
            label="Set every one to:"
            disabled={busy !== null}
            onSet={(unit) => void setBulkUnit("run", unit)}
          />
          <span className="text-xs">
            Setting a project default on the overview does this for future documents.
          </span>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {pendingItems.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            importId={importId}
            resolution={byItem.get(item.id)}
            specFields={specFields}
            records={records}
            drafts={drafts}
            setDrafts={setDrafts}
            busy={busy === item.id}
            onSaveObservation={saveObservation}
            onSaveTargets={saveTargets}
            onSetBulkUnit={setBulkUnit}
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

  return (
    <Disclosure title={title} count={rows.length} open={open} onToggle={onToggle}>
      <DisclosureList>
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
      </DisclosureList>
    </Disclosure>
  );
}
