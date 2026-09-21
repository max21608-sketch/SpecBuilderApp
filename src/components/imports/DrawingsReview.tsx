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
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { buttonClass } from "@/components/ui/Button";
import { upload } from "@vercel/blob/client";
import { projectUploadPrefix } from "@/lib/blob-source";
import type { CroppedImage } from "@/lib/pdf-crop";

import { usePoll } from "@/lib/use-poll";
import Spinner from "@/components/ui/Spinner";
import Disclosure, { DisclosureList } from "@/components/ui/Disclosure";
import PageHeader from "@/components/ui/PageHeader";
import NextStepAction from "@/components/ui/NextStepAction";
import { useNextStep } from "@/lib/use-next-step";
import PageBody from "@/components/ui/PageBody";
import Card from "@/components/ui/Card";
import Note from "@/components/ui/Note";
import DocumentState from "@/components/imports/DocumentState";
import { WAITING_FOR_SLOT_MESSAGE } from "@/lib/intake-status";
import Button from "@/components/ui/Button";
import Tabs from "@/components/ui/Tabs";
import { DOCUMENT_KIND_LABELS, type ItemLevel } from "@/lib/spec-vocab";
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
  id: string;
  /** Needed to scope an image upload to this project's own blob prefix. */
  project_id: string;
  status: string;
  version: number;
  error: string | null;
  document_kind: "shop_drawings";
  filename: string | null;
  claim_live: boolean | null;
  within_deadline: boolean | null;
  claim_count: number;
  /**
   * `pending` because the pack is already reading as many documents as it may,
   * rather than because nobody has asked for it. Computed by the GET route off
   * the marker the cap writes. Two different sentences on this screen, and only
   * one of them is a button somebody has to press.
   */
  waitingForSlot?: boolean | null;
  parsed: StagedDrawings | null;
};

export default function DrawingsReview({
  importId,
  crumb,
  packHref,
  packDrawingCount,
}: {
  importId: string;
  /** Where this document came from: its pack, or the project. Optional so the
   *  component-tier test can render the screen without a route around it. */
  crumb?: { label: string; href: string };
  /** The pack's combined drawings screen, when this document is in a pack. */
  packHref?: string;
  packDrawingCount?: number;
}) {
  const [run, setRun] = useState<Run | null>(null);
  /**
   * WHERE THIS REVIEWER GOES NEXT, decided by the project and not by this
   * screen. The bottom of the page used to read "Open the project page", which
   * is where — never what for; Matthew asked "at what point in the workflow do
   * you come to this?" on exactly this screen. It is fetched rather than passed
   * because this component is mounted from an import id and learns its project
   * only once the document has loaded; it reads the SAME endpoint the project
   * overview reads, and a failure costs the emphasis and never the route.
   */
  const nextAction = useNextStep(run?.project_id ?? null);
  const [resolution, setResolution] = useState<ItemResolution[]>([]);
  const [specFields, setSpecFields] = useState<SpecField[]>([]);
  const [records, setRecords] = useState<RecordChoice[]>([]);

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

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * WHICH TAB. Applied and Ignored were collapsible panels under the cards, so
   * on a pack with six items they sat below six full-height review cards and
   * were reached by scrolling past everything still to do. They are three
   * states of the same set of observations, and a tab each is how you get to
   * the one you want — with its count on it, so an empty Ignored says so
   * without being opened.
   */
  const [reviewTab, setReviewTab] = useState<"pending" | "applied" | "ignored">("pending");
  /**
   * Which card the navigator is pointing at.
   *
   * A SCROLL, NEVER A FILTER. Every card stays on the page — hiding the others
   * would make "confirm this one" mean something different depending on where
   * you had walked to, and the screen's own rule is that nothing is hidden from
   * a reviewer who has to rule on it.
   */
  const [current, setCurrent] = useState(0);

  // Server-acked state is held separately from what the reviewer is typing, so
  // a reload cannot wipe an unsaved edit and an autosave cannot fight the input.
  const [drafts, setDrafts] = useState<Record<string, Partial<DrawingObservation>>>({});
  // An action that succeeded and changed nothing yet — a read the cap deferred.
  // Held apart from `error` so that reads blue and a refusal reads red.
  const [notice, setNotice] = useState<string | null>(null);
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
  async function reloadThen(failure: string | null, notice: string | null = null) {
    await load();
    if (failure) setError(failure);
    // An outcome that is NOT a failure — a press the cap deferred — goes through
    // the same reload-first path, because `load()` clears whatever was set
    // before it. In the RED banner it would paint a working pack as broken.
    if (notice) setNotice(notice);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = run?.status === "queued" || run?.status === "parsing";
  // A DEFERRED READ STARTS ON ITS OWN, so this screen looks again rather than
  // saying "Waiting for a slot" until somebody reloads the page. NOT folded into
  // `waiting`, which is what selects the "Being read" body: this document is not
  // being read, it is queued behind three that are.
  const deferred = run?.status === "pending" && Boolean(run?.waitingForSlot);
  usePoll(load, { intervalMs: 3000, active: Boolean(waiting || deferred) });

  const byItem = useMemo(() => new Map(resolution.map((entry) => [entry.id, entry])), [resolution]);

  async function startExtraction(action: "start" | "retry-dispatch" | "restart-expired") {
    if (!run) return;
    setBusy("extract");
    setError(null);
    try {
      const res = await apiFetch<{ waiting?: boolean; note?: string }>(`/api/imports/${importId}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: run.version, requestId: crypto.randomUUID(), action }),
      });
      // 202 `waiting`: the press was right and the read is queued behind the
      // pack's three. It reported NOTHING, so the button looked broken.
      const held = res.ok && res.data.waiting === true;
      await reloadThen(res.ok ? null : res.error, held ? (res.data.note ?? WAITING_FOR_SLOT_MESSAGE) : null);
    } finally {
      setBusy(null);
    }
  }


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
      await reloadThen(res.ok ? null : res.error);
    });
  }

  /**
   * Several rows in one go, saved and reloaded ONCE.
   *
   * The configuration card edits one shared measurement and writes it to the
   * matching row on every configuration's page. Issued as separate autosaves
   * that would be four requests and four reloads under the reviewer's cursor;
   * batched, the screen refreshes once and a row somebody else has edited is
   * refused on its own without taking the others with it.
   */
  async function saveObservations(
    edits: { item: DrawingItem; observation: DrawingObservation; changes: Record<string, unknown> }[],
  ) {
    if (edits.length === 0) return;
    await queueSave(async () => {
      const failures: string[] = [];
      for (const edit of edits) {
        const res = await apiFetch(`/api/imports/${importId}`, {
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

  async function setBulkUnit(scope: "item" | "run", unit: "mm" | "cm", itemId?: string) {
    await queueSave(async () => {
      const res = await apiFetch(`/api/imports/${importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bulkUnit: { scope, unit, ...(itemId ? { itemId } : {}) } }),
      });
      await reloadThen(res.ok ? null : res.error);
    });
  }

  async function saveTargets(item: DrawingItem, ticked: string[], unticked: string[]) {
    await queueSave(async () => {
      const res = await apiFetch(`/api/imports/${importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, expectedVersion: item.version, changes: { ticked, unticked } }),
      });
      await reloadThen(res.ok ? null : res.error);
    });
  }

  /**
   * One item's specs, committed. Returns the failure text, or null.
   *
   * No reload and no busy flag of its own, so a caller can put several of these
   * in a row and report once. Each call is still one atomic request naming ONE
   * staged item -- the item is the unit of commit and that has not changed.
   */
  async function confirmItem(
    item: DrawingItem,
    observations: DrawingObservation[],
    action: "confirm" | "ignore" | "restore",
  ): Promise<string | null> {
    if (!run) return "This import is no longer loaded. Reload.";
    // Before the confirm, so a failed upload refuses the card rather than
    // committing its specs and silently losing the picture.
    let image = null;
    let swatchList: Awaited<ReturnType<typeof uploadSwatches>> = [];
    if (action === "confirm") {
      try {
        image = await uploadImage(item.id, run.project_id);
        swatchList = await uploadSwatches(
          observations.map((observation) => observation.id),
          run.project_id,
        );
      } catch (cause) {
        return `The picture could not be stored, so nothing was confirmed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`;
      }
    }
    const res = await apiFetch(`/api/imports/${importId}/confirm`, {
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
    // Every queued edit lands before the commit, or the versions sent will be
    // the ones the screen had before the last keystroke.
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
   * Each is its own atomic request, so a refusal on B leaves A applied -- which
   * is the correct state, and the reloaded card shows exactly that. What must
   * not happen is a silent partial: the message names what was written, what
   * was refused and what was never attempted.
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
              notAttempted.length > 0 ? `${notAttempted.join(" and ")} ${notAttempted.length === 1 ? "was" : "were"} not attempted.` : null,
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

  // ---- the band ------------------------------------------------------------
  //
  // Rendered by this component rather than by the route above it, for the
  // reason the email review's is: `PageHeader` is full-bleed and sits outside
  // `PageBody`, and the tabs, the counts on them and the item navigator all
  // read state that lives in here.
  const shell = (tabs: React.ReactNode, children: React.ReactNode) => (
    <>
      <PageHeader
        crumbs={crumb ? [crumb] : undefined}
        title={run?.filename ?? "Shop drawings"}
        subtitle={
          <>
            {DOCUMENT_KIND_LABELS.shop_drawings}
            {run?.parsed && (
              <>
                {" · "}
                {run.parsed.items.length} item{run.parsed.items.length === 1 ? "" : "s"}
              </>
            )}{" "}
            ·{" "}
            <a
              href={`/api/imports/${importId}/source`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 no-underline hover:underline"
            >
              open the PDF
            </a>
          </>
        }
        actions={
          packHref && (packDrawingCount ?? 0) > 1 ? (
            <Link href={packHref} className={buttonClass("secondary", "sm", "no-underline")}>
              Review all {packDrawingCount} drawings together
            </Link>
          ) : undefined
        }
        tabs={tabs}
      />
      <PageBody width="wide">{children}</PageBody>
    </>
  );

  /** Move the navigator, and put the card it names on screen. */
  function step(delta: number, count: number) {
    setCurrent((index) => {
      const next = Math.max(0, Math.min(count - 1, index + delta));
      // Optional-called: `scrollIntoView` is not implemented in jsdom, and a
      // navigator that threw in a component test would be a navigator nobody
      // could test.
      document.getElementById(`drawing-card-${next}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return next;
    });
  }

  if (!run) return error ? <Note tone="danger">{error}</Note> : <Spinner label="Loading" />;

  // ---- not read yet, or waiting for a slot ---------------------------------
  //
  // TWO STATES UNDER ONE `pending`, and this screen said the first for both.
  // "These drawings have not been read" beside a Read button is right for a
  // document waiting for a PERSON; for one the cap deferred it asks for a press
  // the app does not need. The chip is `DocumentState`, so the word here and the
  // word on the pack screen are one reading (`documentReviewLabel`).
  if (run.status === "pending" || run.status === "failed") {
    return shell(
      undefined,
      <Card title={deferred ? "These drawings are waiting for a slot" : "These drawings have not been read"}>
        <p className="text-neutral-600">
          {run.filename ?? "This document"} · {DOCUMENT_KIND_LABELS.shop_drawings}
        </p>
        <div className="mt-2">
          <DocumentState run={{ status: run.status, waitingForSlot: run.waitingForSlot }} />
        </div>
        {run.status === "failed" && run.error && <Note tone="danger">{run.error}</Note>}
        <p className="mt-3 text-neutral-700">
          {deferred ? (
            <>{WAITING_FOR_SLOT_MESSAGE} Reading the pages is what costs money, whenever it starts.</>
          ) : (
            <>
              The item codes and dimensions on these pages are drawn, not typed — only the model reading the page as an
              image can get them. This is the step that {run.status === "failed" ? "charges again." : "costs money."}
            </>
          )}
        </p>
        <Button
          variant={deferred ? "secondary" : "primary"}
          className="mt-3"
          onClick={() => void startExtraction("start")}
          disabled={busy !== null}
        >
          {busy === "extract"
            ? "Starting…"
            : deferred
              ? "Read it now"
              : run.status === "failed"
                ? "Retry extraction"
                : "Read the drawings"}
        </Button>
        {notice && <Note tone="info">{notice}</Note>}
        {error && <Note tone="danger">{error}</Note>}
      </Card>,
    );
  }

  // ---- in flight -----------------------------------------------------------
  if (waiting) {
    const restartable =
      (run.status === "parsing" && run.claim_live === false) ||
      (run.status === "queued" && run.within_deadline === false) ||
      run.claim_count >= 4;
    // Queued, never claimed: the publish may not have landed, and re-sending
    // the SAME attempt costs nothing new and cannot disturb a worker that
    // already has it. Without this the row spins for the whole 24-hour
    // deadline before `restartable` offers anything -- which stopped being a
    // rare state when every upload began dispatching its own read.
    const dispatchable = run.status === "queued" && run.claim_count === 0 && run.within_deadline !== false;
    return shell(
      undefined,
      <Card title="Being read">
        <Spinner label="Reading the drawings" />
        <p className="mt-3 text-neutral-600">
          A long drawing set can take a few minutes. You can leave this page — it carries on without you.
        </p>
        {run.error && <Note tone="plain">Last attempt reported: {run.error}</Note>}
        <div className="mt-3 flex gap-2">
          {dispatchable && (
            <Button
              onClick={() => void startExtraction("retry-dispatch")}
              disabled={busy !== null}
              title="Sends the same request again. It charges nothing new, and it will not disturb a worker that already has it."
            >
              {busy === "extract" ? "Retrying…" : "Retry dispatch"}
            </Button>
          )}
          {restartable && (
            <Button variant="danger" onClick={() => void startExtraction("restart-expired")} disabled={busy !== null}>
              Start again (may be charged again)
            </Button>
          )}
        </div>
      </Card>,
    );
  }

  const staged = run.parsed;
  if (!staged || staged.items.length === 0) {
    return shell(
      undefined,
      <Card title="Nothing to review">
        <p className="text-neutral-700">
          No items were found in this drawing set. That is a result, not an error — check the document is the one you
          meant, and that its pages are drawings rather than a scan.
        </p>
      </Card>,
    );
  }

  const pendingItems = staged.items.filter((item) => item.observations.some((o) => o.reviewStatus === "pending"));
  // What a finished review actually did, counted off the same rows the
  // collapsed lists below count. A screen that ends in silence reads as one
  // that did not register the last click.
  const appliedCount = staged.items.reduce(
    (total, item) => total + item.observations.filter((o) => o.reviewStatus === "applied").length,
    0,
  );
  const ignoredCount = staged.items.reduce(
    (total, item) => total + item.observations.filter((o) => o.reviewStatus === "ignored").length,
    0,
  );
  // The tab counts what a person still has to rule on: OBSERVATIONS, the same
  // unit the other two tabs count, so the three add up to the whole document.
  const pendingCount = staged.items.reduce(
    (total, item) => total + item.observations.filter((o) => o.reviewStatus === "pending").length,
    0,
  );
  const reviewComplete = pendingItems.length === 0;
  // Grouped into cards: one per code, one per page for a code drawn once.
  const cards = configurationCards(staged.items, byItem, staged).filter(cardHasPending);
  // Split, because the two have different answers. A page whose CODE matched
  // nothing is waiting for the bill of quantities; a page with no code at all
  // will never match one however many bills are confirmed, so sending its
  // reviewer to the BOQ is advice that cannot work.
  const noTarget = pendingItems.filter((item) => (byItem.get(item.id)?.targets.length ?? 0) === 0);
  const unresolved = noTarget.filter((item) => item.itemCodeRaw !== null);
  const codeless = noTarget.filter((item) => item.itemCodeRaw === null);
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

  const tabs = (
    // `useState`, not the URL: this strip is nested inside a review component
    // and nothing links into it.
    <Tabs
      label="Observations in this document"
      value={reviewTab}
      onChange={setReviewTab}
      items={[
        { id: "pending", label: "To review", count: pendingCount, tone: pendingCount > 0 ? "warn" : "plain" },
        { id: "applied", label: "Applied", count: appliedCount, tone: appliedCount > 0 ? "good" : "plain" },
        { id: "ignored", label: "Ignored", count: ignoredCount },
      ]}
    />
  );

  return shell(
    tabs,
    <>
      {error && <Note tone="danger">{error}</Note>}

      {/* THE END OF THE JOB, SAID OUT LOUD. Every card disappears as it is
          reviewed, so a finished document was an empty screen under a heading —
          indistinguishable from one whose cards had failed to load. */}
      {reviewComplete && (
        /* THE BOX CARRIES THE NEXT STEP, not a full stop. A finished review is
           the one moment a reviewer is certainly looking for what to do next. */
        <Note tone="good" title="Review complete" actions={<NextStepAction step={nextAction} size="sm" />}>
          All {staged.items.length} item{staged.items.length === 1 ? "" : "s"} in this document have been reviewed
          {appliedCount > 0 && <> · {appliedCount} spec{appliedCount === 1 ? "" : "s"} applied</>}
          {ignoredCount > 0 && <> · {ignoredCount} ignored</>}. Nothing here is waiting on you.
        </Note>
      )}

      {staged.documentNotes && <Note tone="plain">The model noted: {staged.documentNotes}</Note>}

      {unresolved.length > 0 && (
        <Note tone="warn">
          {unresolved.length} item{unresolved.length === 1 ? "" : "s"} match no record yet. Confirm this pack&apos;s
          bill of quantities and reload — nothing needs re-reading, and you will not be charged again.
        </Note>
      )}

      {codeless.length > 0 && (
        <Note tone="plain">
          {codeless.length} page{codeless.length === 1 ? "" : "s"} carr{codeless.length === 1 ? "ies" : "y"} no item
          code, so nothing matched {codeless.length === 1 ? "it" : "them"} — usually further views of the item on an
          earlier page. Each one is collapsed below: open it to say which record it is, or ignore the page.
        </Note>
      )}

      {/* Offered only where it is the answer. A set whose pages print their
          units, or whose figures agree, needs nothing here — showing the control
          anyway would invite overwriting a unit the page stated. */}
      {unitsOutstanding > 0 && (
        <Note
          tone="warn"
          actions={<BulkUnit label="Set every one to:" disabled={busy !== null} onSet={(unit) => void setBulkUnit("run", unit)} />}
        >
          {unitsOutstanding} dimension{unitsOutstanding === 1 ? "" : "s"} across this document still need a unit.
          Setting a project default on the overview does this for future documents.
        </Note>
      )}

      {/* WHERE YOU ARE IN THE SET. A six-card screen is six screens of
          scrolling, and the thing a reviewer loses is which item they are on.
          The navigator says it and moves between them; it is a scroll, not a
          filter, so nothing is ever hidden by it. */}
      {reviewTab === "pending" && cards.length > 1 && (() => {
        const card = cards[Math.min(current, cards.length - 1)];
        if (!card) return null;
        const code = card.kind === "single" ? (card.item.itemCodeRaw ?? "no code") : card.codeRaw;
        return (
          <Note
            tone="info"
            actions={
              <>
                <Button variant="quiet" size="xs" onClick={() => step(-1, cards.length)}>
                  ◀ Previous
                </Button>
                <Button variant="quiet" size="xs" onClick={() => step(1, cards.length)}>
                  Next ▶
                </Button>
              </>
            }
          >
            <b>
              Item {Math.min(current + 1, cards.length)} of {cards.length}
            </b>{" "}
            — <span className="font-mono">{code}</span>
            {card.kind === "configurations" && (
              <>
                , drawn on {card.members.length} pages as{" "}
                {card.split ? `${card.members.length} configurations` : "one item"}
              </>
            )}
            .
          </Note>
        );
      })()}

      {/* ONE CARD PER CODE. A code drawn on several pages is one item in
          several configurations -- same chair, different fabric -- and it is
          shown as one card with a chip per configuration, the geometry once
          and each configuration's own finishes below. A code drawn once is a
          plain card, unchanged. See src/lib/configuration-cards.ts. */}
      <div className={reviewTab === "pending" ? "" : "hidden"}>
        {cards.map((card, index) => (
          <div key={card.id} id={`drawing-card-${index}`} className="scroll-mt-4">
            {card.kind === "single" ? (
              <ItemCard
                item={card.item}
                pages={card.pages}
                importId={importId}
                resolution={byItem.get(card.item.id)}
                specFields={specFields}
                records={records}
                drafts={drafts}
                setDrafts={setDrafts}
                busy={busy === card.item.id}
                onSaveObservation={saveObservation}
                onSaveTargets={saveTargets}
                onSetBulkUnit={setBulkUnit}
                onImage={rememberImage}
                onSwatch={rememberSwatch}
                onReview={review}
                onSetLevel={(recordIds, level) => setLevel(run.project_id, recordIds, level)}
              />
            ) : (
              <ConfigurationCard
                card={card}
                importId={importId}
                specFields={specFields}
                records={records}
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
                onSetLevel={(recordIds, level) => setLevel(run.project_id, recordIds, level)}
              />
            )}
          </div>
        ))}
      </div>

      <CollapsedList
        title="Ignored"
        open={reviewTab === "ignored"}
        onToggle={() => setReviewTab(reviewTab === "ignored" ? "pending" : "ignored")}
        hideWhenClosed
        items={staged.items}
        status="ignored"
        onRestore={(item, observation) => void review(item, [observation], "restore")}
      />
      <CollapsedList
        title="Applied"
        open={reviewTab === "applied"}
        onToggle={() => setReviewTab(reviewTab === "applied" ? "pending" : "applied")}
        hideWhenClosed
        items={staged.items}
        status="applied"
      />

      {/* WHERE A REVIEWER GOES NEXT. Reviewing a drawing set is a step inside a
          project, and the bottom of this screen was a dead end: the only way
          back was the browser's own. It is navigation, so it is a link — but one
          wearing `buttonClass`, because at the foot of a long page an underlined
          phrase is not findable. */}
      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-4">
        {/* ONLY ONCE THE REVIEW IS DONE, which is §0.3's one-primary rule read
            strictly. A document with cards still pending already has its
            primary — the card's own Confirm — and the deployed screen carried
            both: `Confirm S-100 (2 configurations)` beside `Review 9
            documents`, one of the nine being the document being looked at. Two
            dark buttons proposing different next steps is the screen failing to
            say which one it is for.

            THE STEP IS THE PRIMARY AND IT READS WHAT IT LEADS TO. The project
            page stays reachable beside it, demoted: it is the way back, which
            is a different question from what to do next — and while cards are
            pending it is demoted too, because the primary is on the card. */}
        {reviewComplete && <NextStepAction step={nextAction} />}
        <Link
          href={`/dashboard/projects/${run.project_id}`}
          className={buttonClass(reviewComplete && !nextAction ? "primary" : "secondary", "sm", "no-underline")}
        >
          Open the project page
        </Link>
      </div>
    </>,
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
  hideWhenClosed,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  items: DrawingItem[];
  status: "ignored" | "applied";
  onRestore?: (item: DrawingItem, observation: DrawingObservation) => void;
  /** It is a TAB BODY now, so a closed one renders nothing rather than a header. */
  hideWhenClosed?: boolean;
}) {
  const rows = items.flatMap((item) =>
    item.observations.filter((o) => o.reviewStatus === status).map((observation) => ({ item, observation })),
  );

  if (hideWhenClosed && !open) return null;

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
              <Button size="xs" variant="quiet" onClick={() => onRestore?.(item, observation)}>
                Restore
              </Button>
            )}
          </li>
        ))}
      </DisclosureList>
    </Disclosure>
  );
}
