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
import { formatDay } from "@/lib/format-day";

import { usePoll } from "@/lib/use-poll";
import { intakeStatusLabel, intakeStatusTone, isIntakeRunWorking } from "@/lib/intake-status";
import Spinner from "@/components/ui/Spinner";
import Button, { buttonClass } from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import NextStepAction from "@/components/ui/NextStepAction";
import type { ItemLevel } from "@/lib/spec-vocab";
import { useNextStep } from "@/lib/use-next-step";
import PageBody from "@/components/ui/PageBody";
import Card from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Tip from "@/components/ui/Tip";
import Note from "@/components/ui/Note";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import type { DrawingItem, DrawingObservation, StagedDrawings } from "@/lib/drawing-document";
import ItemCard, {
  BulkUnit,
  type ItemResolution,
  type RecordChoice,
  type SpecField,
} from "@/components/imports/DrawingItemCard";
import ConfigurationCard from "@/components/imports/ConfigurationCard";
import { cardHasPending, configurationCards } from "@/lib/configuration-cards";

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

export default function PackDrawingsReview({
  projectId,
  batchId,
  packDay,
}: {
  projectId: string;
  batchId: string;
  /** The day the pack was delivered, `YYYY-MM-DD`, for the crumb. */
  packDay?: string | null;
}) {
  const [data, setData] = useState<Payload | null>(null);
  /** What the project needs next — see the note in `DrawingsReview`. */
  const step = useNextStep(projectId);
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

  /**
   * The swatch chip each finish row currently holds, by observation id.
   *
   * Same ref-not-state treatment as the item pictures above, and the same
   * upload-at-confirm rule: a card nobody commits leaves no bytes in the
   * store, and the `project_finishes` row a swatch attaches to does not exist
   * until the confirm creates it.
   */
  const swatches = useRef<Map<string, { image: CroppedImage; page: number | null } | null>>(new Map());
  // THE PAGE IS THE ONE THAT WAS CROPPED, not the card's. A two-page item
  // prints its chips on whichever page prints them, and a swatch citing the
  // page the row was read from would be a false provenance rather than a
  // missing one.
  const rememberSwatch = useCallback((observationId: string, image: CroppedImage | null, page: number | null) => {
    swatches.current.set(observationId, image ? { image, page } : null);
  }, []);

  /** The crops for the rows being confirmed, uploaded together. */
  async function uploadSwatches(observationIds: string[], projectId: string) {
    const out: {
      observationId: string;
      pathname: string;
      filename: string;
      width: number;
      height: number;
      size: number;
      page: number | null;
    }[] = [];
    for (const observationId of observationIds) {
      const crop = swatches.current.get(observationId);
      if (!crop) continue;
      const { image, page } = crop;
      const blob = await upload(
        `${projectUploadPrefix(projectId)}finish-swatches/${observationId}-${Date.now()}.png`,
        image.blob,
        { access: "private", handleUploadUrl: "/api/uploads/token", clientPayload: projectId, contentType: "image/png" },
      );
      out.push({
        observationId,
        pathname: blob.pathname,
        filename: `${observationId}.png`,
        width: image.width,
        height: image.height,
        size: image.blob.size,
        page,
      });
    }
    return out;
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


  /**
   * A LEVEL, THROUGH THE LEVELS ROUTE — never through the confirm.
   *
   * Item 1.15. The drawing is where the evidence for a level first appears (the
   * brass leg is on page 2, not on the bill), so the card carries the control —
   * but the write goes to `/levels/accept`, which is the one boundary for a
   * level. A card's confirm request carries no level, so one acknowledgement
   * can never cover two decisions, and the level never blocks the card.
   *
   * ONE REQUEST for the whole fan-out, which is ONE `level_set` change set: the
   * same drawing quoted by three phases is one decision, not three entries in
   * the trail.
   *
   * RELOAD FIRST, REPORT AFTER: this screen clears its banner on a successful
   * load, so setting the error and then reloading showed a refusal for a few
   * milliseconds and then nothing at all.
   */
  async function setLevel(projectId: string, recordIds: string[], level: ItemLevel) {
    setBusy("level");
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/levels/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordIds, level }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      setBusy(null);
    }
  }

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

  /**
   * Several rows in one go, saved and reloaded ONCE.
   *
   * The configuration card edits one shared measurement and writes it to the
   * matching row on every configuration's page. Four separate autosaves would
   * be four reloads under the reviewer's cursor.
   */
  async function saveObservations(
    edits: { item: DrawingItem; observation: DrawingObservation; changes: Record<string, unknown> }[],
  ) {
    if (edits.length === 0) return;
    await queueSave(async () => {
      const failures: string[] = [];
      for (const edit of edits) {
        const run = runOf(edit.item.id);
        if (!run) continue;
        const res = await apiFetch(`/api/imports/${run.importId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            itemId: edit.item.id,
            observationId: edit.observation.id,
            expectedVersion: edit.observation.version,
            changes: edit.changes,
          }),
        });
        if (!res.ok) failures.push(res.error);
      }
      await reloadThen(failures.length > 0 ? failures[0]! : null);
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

  /**
   * One item's specs, committed. Returns the failure text, or null.
   *
   * No reload and no busy flag of its own, so a caller can put several of these
   * in a row and report once. Each is still one atomic request naming ONE
   * staged item.
   */
  async function confirmItem(
    item: DrawingItem,
    observations: DrawingObservation[],
    action: "confirm" | "ignore" | "restore",
  ): Promise<string | null> {
    const run = runOf(item.id);
    if (!run) return "That page is no longer part of this pack. Reload.";
    // Before the confirm, so a failed upload refuses the card rather than
    // committing its specs and silently losing the picture.
    let image = null;
    let swatchList: Awaited<ReturnType<typeof uploadSwatches>> = [];
    if (action === "confirm") {
      try {
        image = await uploadImage(item.id, projectId);
        swatchList = await uploadSwatches(
          observations.map((observation) => observation.id),
          projectId,
        );
      } catch (cause) {
        return `The picture could not be stored, so nothing was confirmed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`;
      }
    }
    const res = await apiFetch(`/api/imports/${run.importId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        itemId: item.id,
        ...(action === "confirm"
          ? { itemVersion: item.version, image, ...(swatchList.length > 0 ? { swatches: swatchList } : {}) }
          : {}),
        observations: observations.map((observation) => ({ id: observation.id, version: observation.version })),
      }),
    });
    return res.ok ? null : res.error;
  }

  async function review(item: DrawingItem, observations: DrawingObservation[], action: "confirm" | "ignore" | "restore") {
    await saveChain.current;
    setBusy(item.id);
    setError(null);
    try {
      await reloadThen(await confirmItem(item, observations, action));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Every configuration of one code, confirmed in letter order.
   *
   * Each is its own atomic request, so a refusal on B leaves A applied -- the
   * correct state, and what the reloaded card then shows. What must not happen
   * is a silent partial, so the message names what was written, what was
   * refused and what was never attempted.
   */
  async function reviewMany(
    key: string,
    entries: { label: string; item: DrawingItem; observations: DrawingObservation[] }[],
  ) {
    await saveChain.current;
    setBusy(key);
    setError(null);
    try {
      const done: string[] = [];
      for (const [index, entry] of entries.entries()) {
        const failure = await confirmItem(entry.item, entry.observations, "confirm");
        if (failure) {
          const notAttempted = entries.slice(index + 1).map((rest) => rest.label);
          await reloadThen(
            [
              done.length > 0 ? `${done.join(" and ")} confirmed.` : null,
              `${entry.label} refused: ${failure} Nothing was written for it.`,
              notAttempted.length > 0
                ? `${notAttempted.join(" and ")} ${notAttempted.length === 1 ? "was" : "were"} not attempted.`
                : null,
            ]
              .filter(Boolean)
              .join(" "),
          );
          return;
        }
        done.push(entry.label);
      }
      await reloadThen(null);
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

  // ---- the band ------------------------------------------------------------
  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader
        crumbs={[
          {
            label: packDay ? `Pack delivered ${formatDay(packDay)}` : "The pack",
            href: `/dashboard/projects/${projectId}/intake/${batchId}`,
          },
        ]}
        title="Drawings in this pack"
        subtitle={
          data
            ? `${data.runs.length} drawing document${data.runs.length === 1 ? "" : "s"}, reviewed together — one card per item code, whichever file it came from`
            : undefined
        }
      />
      <PageBody width="wide">{children}</PageBody>
    </>
  );

  if (!data) return error ? <Note tone="danger">{error}</Note> : <Spinner label="Loading the pack" />;

  if (runs.length === 0) {
    return shell(
      <Card title="No drawings in this pack">
        <p className="text-neutral-700">
          This pack has no drawing documents. Upload them on the project and declare their kind as shop drawings.
        </p>
      </Card>,
    );
  }

  // ==========================================================================
  // GROUPED PER RUN, NEVER ACROSS RUNS.
  //
  // The letters come from `variantLettersByItem` over ONE staged run's items,
  // on the server and in the confirm route alike. So `S-201` drawn once in file
  // X and once in file Y is letter A in BOTH, and both write to the same
  // variant -- a card that showed them as A and B would promise a split the
  // confirm does not make. The pack's own `duplicateTargets` banner below is
  // what reports that case, and it stays.
  // ==========================================================================
  const cards = runs.flatMap((run) =>
    run.staged
      ? configurationCards(run.staged.items, new Map(run.items.map((entry) => [entry.id, entry])), run.staged)
          .filter(cardHasPending)
          .map((card) => ({ run, card }))
      : [],
  );
  const pendingItems = runs.flatMap((run) =>
    (run.staged?.items ?? []).filter((item) => item.observations.some((observation) => observation.reviewStatus === "pending")),
  );
  const unread = runs.filter((run) => run.status === "pending" || run.status === "failed");
  const unitsOutstanding = pendingItems.reduce(
    (total, item) =>
      total +
      item.observations.filter(
        (o) => o.reviewStatus === "pending" && o.attrGroup === "dimension" && o.unit === null && o.value?.trim(),
      ).length,
    0,
  );

  return shell(
    <>
      {error && <Note tone="danger">{error}</Note>}

      {/* Which files are in, and what state each is in. At one PDF per line
          item this list IS the progress bar. */}
      <Card
        flush
        title={
          <>
            The documents
            <span className="font-medium normal-case tracking-normal text-neutral-500">
              {cards.length} item{cards.length === 1 ? "" : "s"} still to review
            </span>
          </>
        }
        actions={
          unread.length > 0 ? (
            <Button variant="primary" size="xs" onClick={() => void readAll()} disabled={busy !== null}>
              {busy === "read-all" ? "Starting…" : `Read all ${unread.length} — each is charged`}
            </Button>
          ) : undefined
        }
      >
        <Table>
          <thead>
            <tr>
              <Th>File</Th>
              <Th>State</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Tr
                key={run.importId}
                tone={run.status === "failed" ? "danger" : run.status === "parsed" ? "warn" : "plain"}
              >
                <Td>
                  <span className="block truncate" title={run.filename ?? undefined}>
                    {run.filename ?? "Unnamed file"}
                  </span>
                  {run.error && <span className="mt-0.5 block text-xs text-neutral-500">{run.error}</span>}
                </Td>
                <Td>
                  <Chip tone={intakeStatusTone(run.status)} dot={isIntakeRunWorking(run.status)}>
                    {intakeStatusLabel(run.status)}
                  </Chip>
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <Link
                      href={`/dashboard/imports/${run.importId}`}
                      className={buttonClass("quiet", "xs", "no-underline")}
                    >
                      On its own
                    </Link>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* ---- the two pack-level diagnostics ---- */}

      {data.duplicates.length > 0 && (
        <Note
          tone="warn"
          title={`${data.duplicates.length} record${data.duplicates.length === 1 ? " is" : "s are"} described by more than one document in this pack.`}
        >
          Dimensions are exempt from the one-value-per-field rule by design, so confirming both writes both sets and
          nothing will complain. Decide which document wins before confirming the second — these sheets usually say the
          signed shop drawings take precedence.
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {data.duplicates.map((entry) => (
              <li key={entry.recordId}>
                <span className="font-medium">{entry.recordLabel ?? entry.recordId}</span>
                {" — "}
                {entry.cards
                  .map((card) => `${card.itemCodeRaw ?? "?"} in ${card.filename ?? "an unnamed file"}`)
                  .join(", ")}
              </li>
            ))}
          </ul>
        </Note>
      )}

      {data.repeated.length > 0 && (
        <Card
          flush
          title={
            <>
              {data.repeated.length} line{data.repeated.length === 1 ? "" : "s"} appear on three or more items
              <span className="font-medium normal-case tracking-normal text-neutral-500">
                usually the package conditions every specification sheet repeats
              </span>
              <Tip>
                Ignoring one here ignores every copy, and every copy can be restored on its own document.
              </Tip>
            </>
          }
        >
          <Table>
            <thead>
              <tr>
                <Th>The line</Th>
                <Th>On</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.repeated.map((group) => (
                <Tr key={`${group.label}-${group.value}`}>
                  <Td>
                    <span className="text-neutral-500">{group.label}:</span> {group.value}
                  </Td>
                  <Td muted>{new Set(group.occurrences.map((o) => o.itemId)).size} items</Td>
                  <Td>
                    <div className="flex justify-end">
                      <Button
                        size="xs"
                        variant="quiet"
                        onClick={() => void ignoreRepeated(group)}
                        disabled={busy !== null}
                      >
                        {busy === `repeat:${group.label}` ? "Ignoring…" : "Ignore on all"}
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {unitsOutstanding > 0 && (
        <Note
          tone="warn"
          actions={<BulkUnit label="Set every one to:" disabled={busy !== null} onSet={(unit) => void setBulkUnit("run", unit)} />}
        >
          {unitsOutstanding} dimension{unitsOutstanding === 1 ? "" : "s"} across this pack still need a unit. Setting a
          project default on the overview does this for future packs.
        </Note>
      )}

      {/* ---- the cards, one per code, whichever file it came from ---- */}
      {cards.map(({ run, card }) => (
        <div key={`${run.importId}:${card.id}`}>
          {/* Above the card, because the grouping is about the ITEM and the file
              is only where this page of it came from. */}
          <p className="mt-4 text-xs text-neutral-500">{run.filename ?? "Unnamed file"}</p>
          {card.kind === "single" ? (
            <ItemCard
              item={card.item}
              pages={card.pages}
              importId={run.importId}
              resolution={run.items.find((entry) => entry.id === card.item.id)}
              specFields={data.specFields}
              records={data.records}
              drafts={drafts}
              setDrafts={setDrafts}
              busy={busy === card.item.id}
              onSaveObservation={saveObservation}
              onSaveTargets={saveTargets}
              onSetBulkUnit={setBulkUnit}
              onImage={rememberImage}
              onSwatch={rememberSwatch}
              onReview={review}
              onSetLevel={(recordIds, level) => setLevel(projectId, recordIds, level)}
            />
          ) : (
            <ConfigurationCard
              card={card}
              importId={run.importId}
              specFields={data.specFields}
              records={data.records}
              drafts={drafts}
              setDrafts={setDrafts}
              busy={busy}
              onSaveObservation={saveObservation}
              onSaveObservations={saveObservations}
              onSaveTargets={saveTargets}
              onSetBulkUnit={setBulkUnit}
              onReview={review}
              onReviewMany={reviewMany}
              onImage={rememberImage}
              onSwatch={rememberSwatch}
              onSetLevel={(recordIds, level) => setLevel(projectId, recordIds, level)}
            />
          )}
        </div>
      ))}

      {/* THE END OF THE PACK, SAID OUT LOUD — the same box the single-document
          screen shows, because it does not matter which of the two a reviewer
          happened to finish on. "Review complete", never "complete": settled
          answers are a different question. */}
      {cards.length === 0 && runs.some((run) => run.staged) && (
        /* The same box the single-document screen shows, carrying the same
           next step: it must not matter which of the two a reviewer finished
           on. */
        <Note tone="good" title="Review complete" actions={<NextStepAction step={step} size="sm" />}>
          Nothing left to review in this pack. Settled answers are a different question — the records screen is where
          those live.
        </Note>
      )}

      {/* Where a reviewer goes next. The bottom of this screen was a dead end.

          ONLY ONCE THERE IS NOTHING LEFT TO REVIEW — §0.3's one-primary rule,
          the same reading as the single-document screen. A pack with cards on
          it already has its primary on each card, and a step beside them
          proposes a different next move in the same weight. While cards are
          pending the way back is demoted too, because the primary is the
          card's Confirm. */}
      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-4">
        {cards.length === 0 && <NextStepAction step={step} />}
        <Link
          href={`/dashboard/projects/${projectId}`}
          className={buttonClass(cards.length === 0 && !step ? "primary" : "secondary", "sm", "no-underline")}
        >
          Open the project page
        </Link>
      </div>
    </>,
  );
}
