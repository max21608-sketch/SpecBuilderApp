"use client";

// Dropping a whole tender pack in at once.
//
// A pack is a preamble, a bill of quantities and a drawing set, delivered
// together. Uploading them one at a time — the old flow navigated away after
// each file — made three unrelated runs out of one delivery, in whatever order
// somebody happened to click.
//
// ============================================================================
// ONE PRESS. THE APP WORKS OUT WHAT EACH FILE IS.
//
// Every file's kind used to be typed into a dropdown, and the reason was sound:
// a bill of quantities and an FF&E schedule are both .xlsx, so the bytes cannot
// say which pipeline a file belongs in, and a schedule fed to the BOQ parser
// would stage a project's worth of wrong records. A filename hint sat beside
// each row as grey text the screen refused to act on.
//
// A filename is not the only evidence a document carries. Its cover page, its
// sheet names and its columns all say what it is, and a person settles it in
// two seconds by looking. So the press uploads each file, asks the model what
// it is, fills the box in and reads it — and every answer is FLAGGED with the
// evidence it was read from, because the reviewer is the one who decides.
//
// A FILE THE MODEL CANNOT SETTLE IS HELD, not guessed at. It stays on this
// screen with an empty box and nothing is read for it, which costs nothing.
// Choosing one by hand always wins over the suggestion.
//
// STARTING AN INTAKE SPENDS MONEY, and this screen is still where that is said:
// one small call per file to work out what it is, then one full read per
// specification document. A bill of quantities is parsed by code and costs
// nothing to read.
// ============================================================================
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { apiFetch } from "@/lib/api-fetch";
import { INTAKE_UPLOAD_ACCEPT, SPREADSHEET_EXTENSIONS, legacySpreadsheetAdvice } from "@/lib/intake-source-types";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/spec-vocab";
import { projectUploadPrefix } from "@/lib/blob-source";

/** What a person calls the thing, in the order a pack is read. */
const CHOICES: { value: string; label: string; importType: "boq" | "spec_document"; documentKind: DocumentKind | null }[] = [
  // Listed first because it is read first WHEN THERE IS ONE. Nothing requires a
  // pack to include a preamble, and plenty of projects have none.
  { value: "preamble", label: "Preamble (general conditions)", importType: "spec_document", documentKind: "preamble" },
  { value: "boq", label: "Bill of quantities (creates the records)", importType: "boq", documentKind: null },
  { value: "shop_drawings", label: "Shop drawings (specs per item)", importType: "spec_document", documentKind: "shop_drawings" },
  { value: "ffe_schedule", label: DOCUMENT_KIND_LABELS.ffe_schedule, importType: "spec_document", documentKind: "ffe_schedule" },
  { value: "spec_bible", label: DOCUMENT_KIND_LABELS.spec_bible, importType: "spec_document", documentKind: "spec_bible" },
  { value: "finishes_schedule", label: DOCUMENT_KIND_LABELS.finishes_schedule, importType: "spec_document", documentKind: "finishes_schedule" },
  { value: "fabric_schedule", label: DOCUMENT_KIND_LABELS.fabric_schedule, importType: "spec_document", documentKind: "fabric_schedule" },
  // A saved .eml, dragged out of Outlook. Same pipeline as a schedule: read,
  // staged as proposals, reviewed, confirmed — with the message kept whole as
  // the evidence the change carries.
  { value: "email", label: "Email (.eml saved from Outlook)", importType: "spec_document", documentKind: "email" },
  { value: "other", label: DOCUMENT_KIND_LABELS.other, importType: "spec_document", documentKind: "other" },
];

/** The app's two fields, back to the one word this screen's dropdown uses. */
function choiceFor(decision: { importType: string; documentKind: string | null } | null): string {
  if (!decision) return "";
  return (
    CHOICES.find(
      (choice) => choice.importType === decision.importType && choice.documentKind === decision.documentKind,
    )?.value ?? ""
  );
}

type Queued = {
  key: string;
  file: File;
  /** A person's own choice, which always beats the suggestion. */
  choice: string;
  /** What the model read it as, and why. Never applied without being shown. */
  suggested: string;
  evidence: string | null;
  /**
   * `refused` is terminal and `failed` is not, which is the whole difference:
   * pressing again retries a failed upload, and there is nothing to retry
   * about a file format this app does not read (variance matrix row 5). It is
   * also why a refused file is not in `pending` — it must not be counted in
   * what the press is about to store, read and charge for.
   */
  status: "waiting" | "uploading" | "reading" | "registering" | "needs-kind" | "done" | "failed" | "refused";
  /** Kept so a file held for a kind is not uploaded a second time. */
  pathname: string | null;
  registrationRequestId: string;
  progress: number;
  error: string | null;
  /**
   * Stored and registered, and its read is queued behind the pack's in-flight
   * cap. NOT `error`: this is the ordinary outcome for the fourth document
   * onwards and it needs nobody, so it is said in slate beside the file rather
   * than in the red reserved for a read that did not reach the queue.
   */
  note: string | null;
};

/** What will be used for a file: what somebody chose, else what was read. */
const kindOf = (item: Queued) => item.choice || item.suggested;

export default function IntakeBatchUpload({ projectId, onUploaded }: { projectId: string; onUploaded?: () => void }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setQueue((current) => [
      ...current,
      ...Array.from(files).map((file) => ({
        key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        choice: "",
        suggested: "",
        evidence: null,
        // A SPREADSHEET FORMAT NOTHING READS IS REFUSED IN THE BROWSER, before
        // a byte is stored (variance matrix row 5). The server refuses it too —
        // this is a screen and a screen is never the guarantee — but an `.xls`
        // that was stored, classified and then refused has spent a model call
        // and left a file in the store for a bill nobody can read.
        status: (legacySpreadsheetAdvice(file.name) ? "refused" : "waiting") as Queued["status"],
        pathname: null,
        // Generated ONCE per file and reused on every retry, so a lost response
        // cannot register the same upload twice.
        registrationRequestId: crypto.randomUUID(),
        progress: 0,
        error: legacySpreadsheetAdvice(file.name),
        note: null,
      })),
    ]);
  }

  const update = (key: string, patch: Partial<Queued>) =>
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  // A refused file is out of this count on purpose: it is not going to be
  // stored, read or charged for, so it must not appear in the sentence that
  // says how many will be.
  const pending = queue.filter((item) => item.status !== "done" && item.status !== "refused");
  const held = queue.filter((item) => item.status === "needs-kind");
  const heldAndAnswered = held.filter((item) => item.choice);

  async function start() {
    if (pending.length === 0) return;
    setBusy(true);
    setError(null);

    try {
      let id = batchId;
      if (!id) {
        const batch = await apiFetch<{ batch: { id: string } }>(`/api/projects/${projectId}/batches`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label: `${queue.length} document${queue.length === 1 ? "" : "s"}` }),
        });
        if (!batch.ok) {
          setError(batch.error);
          return;
        }
        id = batch.data.batch.id;
        setBatchId(id);
      }

      // Sequential, so a failure names the file it belongs to and the others
      // still land. A pack whose drawings failed is still a pack with a bill.
      for (const item of queue) {
        if (item.status === "done") continue;
        // Nothing to retry about a format this app cannot read.
        if (item.status === "refused") continue;
        // HELD FOR A KIND AND STILL UNANSWERED. Skipped rather than guessed at:
        // reading it under the wrong prompt spends a call on output that
        // answers a different question.
        if (item.status === "needs-kind" && !item.choice) continue;

        let pathname = item.pathname;
        try {
          if (!pathname) {
            update(item.key, { status: "uploading", progress: 0, error: null });
            // Bytes go browser -> blob store directly, never through a route
            // handler: a real drawing set is well over the request-body ceiling.
            // The store is PRIVATE and stays that way — NDA client documents.
            const blob = await upload(`${projectUploadPrefix(projectId)}${item.file.name}`, item.file, {
              access: "private",
              handleUploadUrl: "/api/uploads/token",
              clientPayload: projectId,
              onUploadProgress: ({ percentage }) => update(item.key, { progress: Math.round(percentage) }),
            });
            pathname = blob.pathname;
            update(item.key, { pathname });
          }
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          update(item.key, { status: "failed", error: `Could not be stored: ${detail}` });
          continue;
        }

        // WHAT IS IT? Only where nobody has said. A person's choice is never
        // second-guessed, and a file already classified is never re-read.
        let choice = kindOf(item);
        if (!choice) {
          update(item.key, { status: "reading" });
          const asked = await apiFetch<{
            decision: { importType: string; documentKind: string | null } | null;
            /** Known, and not something this app reads — a bill inside a PDF. */
            unsupported?: string | null;
            evidence?: string;
            titleText?: string | null;
          }>("/api/imports/classify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              pathname,
              filename: item.file.name,
              contentType: item.file.type,
            }),
          });
          const suggested = asked.ok ? choiceFor(asked.data.decision) : "";
          const evidence = asked.ok ? (asked.data.evidence ?? null) : asked.error;
          update(item.key, { suggested, evidence });
          choice = suggested;

          // KNOWN, AND NOT SOMETHING THIS APP READS (§6.10.a row 8). Different
          // from "nobody knows yet": the file stays, the dropdown stays open in
          // case the answer was wrong, and the reason is printed as an error
          // rather than as the grey evidence line — because there is an action
          // in it, and it is not on this screen.
          const unsupported = asked.ok ? (asked.data.unsupported ?? null) : null;
          if (unsupported) {
            update(item.key, { status: "needs-kind", error: unsupported });
            continue;
          }

          if (!choice) {
            // Uploaded and kept. A second press registers it once somebody has
            // said what it is, with no second upload and no second reading.
            update(item.key, { status: "needs-kind" });
            continue;
          }
        }

        const entry = CHOICES.find((option) => option.value === choice);
        if (!entry) {
          update(item.key, { status: "needs-kind" });
          continue;
        }

        update(item.key, { status: "registering" });
        const res = await apiFetch<{
          importId: string;
          autoRead?: { dispatched: boolean; error?: string; waiting?: boolean; note?: string };
        }>("/api/imports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            batchId: id,
            importType: entry.importType,
            documentKind: entry.documentKind,
            pathname,
            filename: item.file.name,
            contentType: item.file.type,
            size: item.file.size,
            registrationRequestId: item.registrationRequestId,
          }),
        });
        if (!res.ok) {
          update(item.key, { status: "failed", error: res.error });
          continue;
        }
        // Stored and registered, but its read did not reach the queue. NOT a
        // failed upload -- the file is there and the pack screen offers the
        // retry -- so it is said next to the file rather than thrown away.
        const autoRead = res.data.autoRead;
        const waiting = autoRead?.dispatched === false && autoRead.waiting === true;
        update(item.key, {
          status: "done",
          progress: 100,
          error: autoRead && !autoRead.dispatched && !waiting ? (autoRead.error ?? "Stored, but not queued for reading.") : null,
          note: waiting ? (autoRead.note ?? null) : null,
        });
      }

      onUploaded?.();
      // ONLY WHEN NOTHING IS STILL WAITING ON A PERSON. Navigating away from a
      // file the app could not identify would lose it — it is uploaded, it is
      // in no batch row, and this screen is the only place that knows.
      setQueue((current) => {
        if (!current.some((row) => row.status === "needs-kind" || row.status === "failed")) {
          window.location.href = `/dashboard/projects/${projectId}/intake/${id}`;
        }
        return current;
      });
    } finally {
      // Always reset, so an HTML error page or a network failure cannot leave
      // the button disabled with no way back.
      setBusy(false);
    }
  }

  const label = busy
    ? "Working…"
    : held.length > 0
      ? `Read the ${heldAndAnswered.length} you have named`
      : `Start intake${pending.length ? ` (${pending.length})` : ""}`;

  return (
    <div className="mt-3 border border-neutral-200 rounded-lg bg-white p-3">
      {error && (
        <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={`rounded border-2 border-dashed px-4 py-6 text-center ${
          dragging ? "border-neutral-900 bg-neutral-50" : "border-neutral-300"
        }`}
      >
        <p className="text-sm text-neutral-700">
          Drop the pack here — the BOQ, the drawings, and the preamble if the project has one.
        </p>
        {/* WHAT IT ACCEPTS, SAID BEFORE THE PRESS. Measured rather than
            assumed (§6.10.a row 5): a bill reads from {SPREADSHEET_EXTENSIONS}
            — .csv included, quantities and all — and `.xls` and its relations
            are refused, here in the browser, with the way out. */}
        <p className="mt-1 text-xs text-neutral-500">
          A bill of quantities reads from {SPREADSHEET_EXTENSIONS.join(", ")}; drawings and specification sheets from
          PDF; an email as a saved .eml. An older .xls has to be saved as .xlsx first.
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={INTAKE_UPLOAD_ACCEPT}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="mt-2 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-50 disabled:opacity-50"
        >
          Choose files
        </button>
      </div>

      {queue.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 border border-neutral-200 rounded">
          {queue.map((item) => {
            // AMBER MEANS THE APP ANSWERED THIS AND NOBODY HAS CHECKED. The
            // same treatment a guessed dimension slot gets on a review card.
            const unchecked = Boolean(item.suggested) && !item.choice;
            return (
              <li key={item.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-sm text-neutral-900 flex-1 min-w-[12rem] truncate" title={item.file.name}>
                  {item.file.name}
                </span>

                <select
                  value={kindOf(item)}
                  onChange={(event) => update(item.key, { choice: event.target.value })}
                  disabled={busy || item.status === "done"}
                  className={`border rounded px-2 py-1 text-sm text-neutral-900 ${
                    unchecked ? "border-amber-400 bg-amber-50" : "border-neutral-300"
                  }`}
                >
                  <option value="">What is this?</option>
                  {CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>

                <span className="text-xs text-neutral-500 w-24 text-right">
                  {item.status === "uploading" && `${item.progress}%`}
                  {item.status === "reading" && "Looking…"}
                  {item.status === "registering" && "Registering…"}
                  {item.status === "needs-kind" && <span className="text-amber-700">Say which</span>}
                  {item.status === "done" && "Added"}
                  {item.status === "failed" && <span className="text-red-700">Failed</span>}
                  {item.status === "refused" && <span className="text-red-700">Cannot be read</span>}
                </span>

                {item.status !== "done" && !busy && (
                  <button
                    type="button"
                    onClick={() => setQueue((current) => current.filter((row) => row.key !== item.key))}
                    className="text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    Remove
                  </button>
                )}

                {/* WHAT IT WAS READ FROM, so the suggestion can be checked
                    against the file rather than taken on trust. */}
                {item.evidence && (
                  <p className={`w-full text-xs ${unchecked ? "text-amber-700" : "text-neutral-500"}`}>
                    {item.evidence}
                  </p>
                )}
                {item.error && <p className="w-full text-xs text-red-700">{item.error}</p>}
                {item.note && <p className="w-full text-xs text-neutral-500">{item.note}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || pending.length === 0 || (held.length > 0 && heldAndAnswered.length === 0)}
          className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {label}
        </button>
        {held.length > 0 && (
          <p className="text-xs text-amber-700">
            {held.length === 1 ? "One file could not be identified" : `${held.length} files could not be identified`} —
            say what {held.length === 1 ? "it is" : "they are"} and press again. Nothing has been read for{" "}
            {held.length === 1 ? "it" : "them"}, so nothing has been charged.
          </p>
        )}
      </div>

      {/* Stated before the press, because the press is what spends the money.
          Deliberately not a confirm dialog: every document in a tender pack is
          going to be read, and a modal per pack is ceremony rather than a
          decision. */}
      <p className="mt-2 text-xs text-neutral-500">
        {pending.length === 0 ? (
          <>Drop the pack above. Nothing is read, and nothing is charged, until you press.</>
        ) : (
          <>
            One press: each file is stored, looked at to work out what it is, and then read. That is{" "}
            {pending.length === 1 ? "one small call" : `${pending.length} small calls`} to identify{" "}
            {pending.length === 1 ? "it" : "them"}, and a full charged read for every specification document — a bill of
            quantities is read by code and costs nothing. Anything the app cannot identify waits for you rather than
            being guessed at. What it decides is shown with its reasons, and reviewing what comes back is still yours.
          </>
        )}
      </p>
    </div>
  );
}
