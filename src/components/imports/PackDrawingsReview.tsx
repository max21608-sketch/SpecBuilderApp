"use client";

// Every drawing document in one pack, on one screen.
//
// A drawing set used to be one PDF. The real Panther pack is eleven: one
// combined shop-drawing set plus ten per-item specification sheets. Reviewed
// one run at a time that is eleven screens and eleven Extract buttons for one
// delivery — and nothing can see across them, so the two failures that only
// appear at pack level stay invisible.
//
// THE CONFIRM BOUNDARY DOES NOT MOVE. Every card still commits against its OWN
// run, through the same route the single-document screen uses, with that run's
// item versions. This screen is a view. A batch-level confirm would replace the
// one atomic boundary confirm-drawings.ts exists to be, and a half-applied pack
// is a far worse failure than a half-applied card.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { upload } from "@vercel/blob/client";
import { projectUploadPrefix } from "@/lib/blob-source";
import type { CroppedImage } from "@/lib/pdf-crop";

import { usePoll } from "@/lib/use-poll";
import { intakeStatusLabel, isIntakeRunWorking } from "@/lib/intake-status";
import Spinner from "@/components/ui/Spinner";
import type { DrawingItem, DrawingObservation, StagedDrawings } from "@/lib/drawing-document";
import ItemCard, {
  BulkUnit,
  type ItemResolution,
  type RecordChoice,
  type SpecField,
} from "@/components/imports/DrawingItemCard";

type Run = {
  importId: string;
  filename: string | null;
  status: string;
  error: string | null;
  version: number;
  staged: StagedDrawings | null;
  items: ItemResolution[];
};

type Duplicate = {
  recordId: string;
  recordLabel: string | null;
  cards: { importId: string; filename: string | null; itemId: string; itemCodeRaw: string | null }[];
};

type Repeated = {
  label: string;
  value: string | null;
  attrGroup: string;
  occurrences: { importId: string; itemId: string; observationId: string; version: number }[];
};

type Payload = {
  batch: { id: string; label: string | null };
  runs: Run[];
  records: RecordChoice[];
  specFields: SpecField[];
  duplicates: Duplicate[];
  repeated: Repeated[];
};

export default function PackDrawingsReview({ projectId, batchId }: { projectId: string; batchId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<DrawingObservation>>>({});
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  // The crop each card currently holds, kept in a ref rather than state: it
  // changes on every re-render of a picker and nothing on this screen needs to
  // re-render when it does.
  const images = useRef<Map<string, CroppedImage | null>>(new Map());
  const rememberImage = useCallback((itemId: string, image: CroppedImage | null) => {
    images.current.set(itemId, image);
  }, []);

  /**
   * Upload the crop, at confirm time and not before.
   *
   * A card that is never confirmed leaves no bytes in the store. The pathname
   * is scoped to the project, which the token route checks at issue, the
   * confirm route re-checks against the run's own project, and every later read
   * checks again -- three times, because a check in only one of them is a check
   * the other two skipped.
   */
  async function uploadImage(itemId: string, projectId: string) {
    const image = images.current.get(itemId);
    if (!image) return null;
    const blob = await upload(
      `${projectUploadPrefix(projectId)}item-images/${itemId}-${Date.now()}.png`,
      image.blob,
      {
        access: "private",
        handleUploadUrl: "/api/uploads/token",
        clientPayload: projectId,
        contentType: "image/png",
      },
    );
    return {
      pathname: blob.pathname,
      filename: `${itemId}.png`,
      width: image.width,
      height: image.height,
      size: image.blob.size,
    };
  }


  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(
      `/api/projects/${encodeURIComponent(projectId)}/batches/${encodeURIComponent(batchId)}/drawings`,
    );
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
  }, [projectId, batchId]);

  /**
   * Say what an action returned, AFTER the reload it triggers.
   *
   * `load()` clears the banner when it succeeds — right for a poll, wrong
   * directly after a failed action: a 409 from a confirm was set and then wiped
   * by the reload that followed it, so a conflict showed NOTHING and the card
   * just looked as though the click had not registered. The reload still has to
   * happen (the refused request means this screen is out of date), so the
   * message is put back after it.
   */
  async function reloadThen(failure: string | null) {
    await load();
    if (failure) setError(failure);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const runs = useMemo(() => data?.runs ?? [], [data]);
  const inFlight = runs.some((run) => isIntakeRunWorking(run.status));
  usePoll(load, { intervalMs: 3000, active: inFlight });

  /** Serialised: two autosaves racing would each write the other's stale copy. */
  function queueSave(fn: () => Promise<void>) {
    saveChain.current = saveChain.current.then(fn, fn);
    return saveChain.current;
  }

  /** Which run a card belongs to. Every write on this screen needs it. */
  const runOf = useCallback(
    (itemId: string) => runs.find((run) => run.staged?.items.some((item) => item.id === itemId)),
    [runs],
  );

  async function saveObservation(item: DrawingItem, observation: DrawingObservation, changes: Record<string, unknown>) {
    const run = runOf(item.id);
    if (!run) return;
    await queueSave(async () => {
      const res = await apiFetch(`/api/imports/${run.importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, observationId: observation.id, expectedVersion: observation.version, changes }),
      });
      await reloadThen(res.ok ? null : res.error);
    });
  }

  async function saveTargets(item: DrawingItem, ticked: string[], unticked: string[]) {
    const run = runOf(item.id);
    if (!run) return;
    await queueSave(async () => {
      const res = await apiFetch(`/api/imports/${run.importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, expectedVersion: item.version, changes: { ticked, unticked } }),
      });
      await reloadThen(res.ok ? null : res.error);
    });
  }

  async function setBulkUnit(scope: "item" | "run", unit: "mm" | "cm", itemId?: string) {
    // `scope: "run"` here means EVERY drawing document in the pack, which is
    // one request per run rather than one request. Each is still atomic on its
    // own run; there is no pack-wide transaction and there should not be.
    const targets = scope === "item" ? [runOf(itemId ?? "")].filter(Boolean) : runs.filter((run) => run.staged);
    await queueSave(async () => {
      let failure: string | null = null;
      for (const run of targets) {
        if (!run) continue;
        const res = await apiFetch(`/api/imports/${run.importId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bulkUnit: { scope, unit, ...(itemId ? { itemId } : {}) } }),
        });
        if (!res.ok) {
          failure = res.error;
          break;
        }
      }
      await reloadThen(failure);
    });
  }

  async function review(item: DrawingItem, observations: DrawingObservation[], action: "confirm" | "ignore" | "restore") {
    const run = runOf(item.id);
    if (!run) return;
    await saveChain.current;
    setBusy(item.id);
    setError(null);
    try {
      // Before the confirm, so a failed upload refuses the card rather than
      // committing its specs and silently losing the picture.
      let image = null;
      if (action === "confirm") {
        try {
          image = await uploadImage(item.id, projectId);
        } catch (cause) {
          setError(
            `The picture could not be stored, so nothing was confirmed: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          );
          return;
        }
      }
      const res = await apiFetch(`/api/imports/${run.importId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          itemId: item.id,
          ...(action === "confirm" ? { itemVersion: item.version, image } : {}),
          observations: observations.map((observation) => ({ id: observation.id, version: observation.version })),
        }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Ignore every copy of a repeated line, one card at a time.
   *
   * IGNORE ONLY, and not confirm. The confirm route requires the submitted set
   * to be a card's WHOLE live pending set, because the record is the unit of
   * commit — so "confirm these fourteen lines across ten cards" is a thing it
   * correctly refuses. Ignoring a subset is allowed, and it is reversible:
   * every copy comes back under Ignored.
   */
  async function ignoreRepeated(group: Repeated) {
    await saveChain.current;
    setBusy(`repeat:${group.label}`);
    setError(null);
    try {
      const byCard = new Map<string, { importId: string; itemId: string; refs: { id: string; version: number }[] }>();
      for (const occurrence of group.occurrences) {
        const key = `${occurrence.importId}\u0000${occurrence.itemId}`;
        const entry = byCard.get(key) ?? { importId: occurrence.importId, itemId: occurrence.itemId, refs: [] };
        entry.refs.push({ id: occurrence.observationId, version: occurrence.version });
        byCard.set(key, entry);
      }
      let failure: string | null = null;
      for (const card of byCard.values()) {
        const res = await apiFetch(`/api/imports/${card.importId}/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "ignore", itemId: card.itemId, observations: card.refs }),
        });
        if (!res.ok) {
          failure = res.error;
          break;
        }
      }
      await reloadThen(failure);
    } finally {
      setBusy(null);
    }
  }

  /** One Extract per unread drawing document, in sequence. */
  async function readAll() {
    const unread = runs.filter((run) => run.status === "pending" || run.status === "failed");
    if (unread.length === 0) return;
    // The single-file button carries this warning; a bulk button would hide it
    // N times over, so it is stated with the count before anything is spent.
    const ok = window.confirm(
      `Send ${unread.length} drawing document${unread.length === 1 ? "" : "s"} to the model?\n\n` +
        `That is ${unread.length} separate call${unread.length === 1 ? "" : "s"}, and each one is charged.`,
    );
    if (!ok) return;

    setBusy("read-all");
    setError(null);
    try {
      let failure: string | null = null;
      for (const run of unread) {
        // Version read fresh per run: the extract route refuses a mismatch
        // rather than starting a second attempt, and this screen holds no
        // version of its own.
        const current = await apiFetch<{ import: { version: number } }>(`/api/imports/${run.importId}`);
        if (!current.ok) {
          failure = current.error;
          break;
        }
        const res = await apiFetch(`/api/imports/${run.importId}/extract`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedVersion: current.data.import.version,
            requestId: crypto.randomUUID(),
            action: "start",
          }),
        });
        if (!res.ok) {
          failure = res.error;
          break;
        }
      }
      await reloadThen(failure);
    } finally {
      // Always reset: an HTML error page must not leave the button spinning.
      setBusy(null);
    }
  }

  if (!data) return error ? <p className="mt-6 text-sm text-red-700">{error}</p> : <Spinner label="Loading the pack" />;

  if (runs.length === 0) {
    return (
      <p className="mt-6 text-sm text-neutral-700">
        This pack has no drawing documents. Upload them on the project and declare their kind as shop drawings.
      </p>
    );
  }

  const cards = runs.flatMap((run) =>
    (run.staged?.items ?? [])
      .filter((item) => item.observations.some((observation) => observation.reviewStatus === "pending"))
      .map((item) => ({ run, item })),
  );
  const unread = runs.filter((run) => run.status === "pending" || run.status === "failed");
  const unitsOutstanding = cards.reduce(
    (total, { item }) =>
      total +
      item.observations.filter(
        (o) => o.reviewStatus === "pending" && o.attrGroup === "dimension" && o.unit === null && o.value?.trim(),
      ).length,
    0,
  );

  return (
    <div className="mt-6">
      {error && <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {runs.length} drawing document{runs.length === 1 ? "" : "s"} · {cards.length} item
          {cards.length === 1 ? "" : "s"} still to review
        </p>
        <Link
          href={`/dashboard/projects/${projectId}/intake/${batchId}`}
          className="text-sm text-neutral-600 hover:text-neutral-900 underline"
        >
          Back to the pack
        </Link>
      </div>

      {/* Which files are in, and what state each is in. At one PDF per line
          item this list IS the progress bar. */}
      <ul className="mt-3 border border-neutral-200 rounded-lg divide-y divide-neutral-100 bg-white">
        {runs.map((run) => (
          <li key={run.importId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1 min-w-[12rem] truncate text-neutral-900" title={run.filename ?? undefined}>
              {run.filename ?? "Unnamed file"}
            </span>
            <span className="text-xs text-neutral-600">{intakeStatusLabel(run.status)}</span>
            {isIntakeRunWorking(run.status) && <Spinner label="" />}
            {run.error && <span className="w-full text-xs text-red-700">{run.error}</span>}
            <Link
              href={`/dashboard/imports/${run.importId}`}
              className="text-xs text-neutral-500 underline hover:text-neutral-900"
            >
              On its own
            </Link>
          </li>
        ))}
      </ul>

      {unread.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
          <span>
            {unread.length} document{unread.length === 1 ? "" : "s"} not read yet.
          </span>
          <button
            type="button"
            onClick={() => void readAll()}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {busy === "read-all" ? "Starting…" : `Read all ${unread.length}`}
          </button>
          <span className="text-xs text-neutral-500">
            One model call per document, each charged.
          </span>
        </div>
      )}

      {/* ---- the two pack-level diagnostics ---- */}

      {data.duplicates.length > 0 && (
        <div className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <p className="font-medium">
            {data.duplicates.length} record{data.duplicates.length === 1 ? " is" : "s are"} described by more than one
            document in this pack.
          </p>
          <p className="mt-1 text-xs">
            Dimensions are exempt from the one-value-per-field rule by design, so confirming both writes both sets and
            nothing will complain. Decide which document wins before confirming the second — these sheets usually say
            the signed shop drawings take precedence.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {data.duplicates.map((entry) => (
              <li key={entry.recordId}>
                <span className="font-medium">{entry.recordLabel ?? entry.recordId}</span>
                {" — "}
                {entry.cards.map((card) => `${card.itemCodeRaw ?? "?"} in ${card.filename ?? "an unnamed file"}`).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.repeated.length > 0 && (
        <div className="mt-3 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
          <p className="font-medium text-neutral-900">
            {data.repeated.length} line{data.repeated.length === 1 ? "" : "s"} appear on three or more items.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Usually the package conditions every specification sheet repeats. Ignoring one here ignores every copy, and
            every copy can be restored on its own document.
          </p>
          <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200 rounded bg-white">
            {data.repeated.map((group) => (
              <li key={`${group.label}-${group.value}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="flex-1 min-w-[14rem] text-neutral-800">
                  <span className="text-neutral-500">{group.label}:</span> {group.value}
                </span>
                <span className="text-neutral-500">
                  on {new Set(group.occurrences.map((o) => o.itemId)).size} items
                </span>
                <button
                  type="button"
                  onClick={() => void ignoreRepeated(group)}
                  disabled={busy !== null}
                  className="px-2 py-0.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                >
                  {busy === `repeat:${group.label}` ? "Ignoring…" : "Ignore on all"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unitsOutstanding > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <span>
            {unitsOutstanding} dimension{unitsOutstanding === 1 ? "" : "s"} across this pack still need a unit.
          </span>
          <BulkUnit label="Set every one to:" disabled={busy !== null} onSet={(unit) => void setBulkUnit("run", unit)} />
          <span className="text-xs">Setting a project default on the overview does this for future packs.</span>
        </div>
      )}

      {/* ---- the cards, one per item, whichever file it came from ---- */}
      <div className="mt-4 space-y-4">
        {cards.map(({ run, item }) => (
          <div key={item.id}>
            <p className="mb-1 text-xs text-neutral-500">{run.filename ?? "Unnamed file"}</p>
            <ItemCard
              item={item}
              importId={run.importId}
              resolution={run.items.find((entry) => entry.id === item.id)}
              specFields={data.specFields}
              records={data.records}
              drafts={drafts}
              setDrafts={setDrafts}
              busy={busy === item.id}
              onSaveObservation={saveObservation}
              onSaveTargets={saveTargets}
              onSetBulkUnit={setBulkUnit}
              onImage={rememberImage}
              onReview={review}
            />
          </div>
        ))}
      </div>

      {cards.length === 0 && runs.some((run) => run.staged) && (
        <p className="mt-6 text-sm text-neutral-700">
          Nothing left to review in this pack. Settled answers are a different question — the records screen is where
          those live.
        </p>
      )}
    </div>
  );
}
