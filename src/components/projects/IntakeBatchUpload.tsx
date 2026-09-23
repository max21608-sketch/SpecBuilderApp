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
// AND THE NAMES ARE READ THE MOMENT THE FILES LAND (FIU 2026-09-22). All of the
// above was already true and the screen asked for the work anyway: eleven rows,
// eleven unset boxes, and the sentence explaining that the press does it at the
// BOTTOM in small grey text. Max: "I want it to read first and try and guess
// what the document is and then give you the option to change it … if we have
// 300 items, someone having to go through and do all of that manually is a real
// pain." His decision, the same day: a FILENAME rule, on drop.
//
// A NAME COSTS NOTHING AND SETTLES NOTHING. `guessKindFromName` fills the box
// before a byte is stored, flagged, with what it read quoted beside it — and
// the charged look at the document still happens at the press, where the
// sentence saying what that spends lives. So a name never lets the press skip
// the model: only a PERSON accepting the guess, or choosing a kind, does that,
// and the sentence counts the calls that are actually left. That is the
// `level_suggested` rule — the app guesses, shows what it read, and a person's
// action is what files it — and the acceptance is a `SuggestButton`, because
// picking the option a select is already showing fires no change event and the
// flag could never be cleared by agreeing with it.
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
import { INTAKE_UPLOAD_ACCEPT, SPREADSHEET_EXTENSIONS, unreadableUploadAdvice } from "@/lib/intake-source-types";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/spec-vocab";
import { projectUploadPrefix } from "@/lib/blob-source";
import { guessKindFromName } from "@/lib/document-name-guess";
import SuggestButton from "@/components/ui/SuggestButton";
import Button from "@/components/ui/Button";
import { checkUploadCounted } from "@/lib/upload-check";
import { isPdfUpload, pdfUploadVerdict, type UploadVerdict } from "@/lib/upload-limits";
import {
  CLASSIFY_FAILURE_BANNER,
  classifyFailureFromResponse,
  type ClassifyFailure,
  type ClassifyFailureCode,
} from "@/lib/classify-failure";

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

/**
 * The kind in two or three words, for the suggestion button.
 *
 * Read off `DOCUMENT_KIND_LABELS`, which is the app's own word for each kind,
 * rather than from a fourth list: the select's labels carry an explanation in
 * brackets ("Bill of quantities (creates the records)") and a button that long
 * wraps the row. A bill has no `documentKind` and is named here, once.
 */
function shortLabel(value: string): string {
  const choice = CHOICES.find((option) => option.value === value);
  if (!choice) return value;
  return choice.documentKind ? DOCUMENT_KIND_LABELS[choice.documentKind] : "Bill of quantities";
}

type Queued = {
  key: string;
  file: File;
  /** A person's own choice, which always beats the suggestion. */
  choice: string;
  /** What it was read as, and why. Never applied without being shown. */
  suggested: string;
  evidence: string | null;
  /**
   * WHICH READING IT CAME FROM, and it decides one thing: whether the press
   * may act on it without looking at the document. `model` means the file has
   * been looked at and asking again would spend a second call for the same
   * answer; `name` means only the filename has been read, which is free, and
   * is not a reason to skip the charged look.
   */
  suggestedFrom: "name" | "model" | null;
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
  /**
   * A PDF long enough that one read may not finish (`WARN_PDF_PAGES`). The
   * upload still proceeds; this is said on the row, in amber, and is not
   * `note`, which the tally reads as "waiting for a slot".
   */
  warning: string | null;
  /** Refused for its SIZE (bytes or pages), not its format — the label differs. */
  tooLarge: boolean;
  /**
   * THE LOOK FAILED, for a reason that is the app's and not the document's —
   * no API key, a rate limit, a timeout (FIU 2026-09-23, the pilot upload). Red
   * on the row with "Try identifying again", and NOT the grey evidence line: a
   * failure printed as evidence reads as "the app looked and could not tell".
   */
  failure: ClassifyFailure | null;
  /**
   * Whether this file has been SENT to the model to be identified, by any
   * press. The footer's "nothing has been charged" is only ever said of files
   * where this is false.
   */
  sentToModel: boolean;
  /** Identified by the reading model because it is too long for the fast one. */
  largeDocument: boolean;
  /** The browser's page count, passed to classify as a hint. Null when not counted. */
  pages: number | null;
};

/** What will be used for a file: what somebody chose, else what was read. */
const kindOf = (item: Queued) => item.choice || item.suggested;

/**
 * The kind the press may act on WITHOUT looking at the document.
 *
 * A person's choice, or a reading of the document itself. A NAME GUESS IS
 * DELIBERATELY NOT IN HERE: it fills the box so that a pack of eleven does not
 * meet somebody as eleven mandatory-looking questions, and that is all it does.
 * Letting it skip the classify call would make a filename decide which prompt a
 * charged read uses — and a file called "… - BOQ - …" whose contents are a
 * schedule is exactly the asymmetric case the classify prompt already guards.
 */
const settledKind = (item: Queued) => item.choice || (item.suggestedFrom === "model" ? item.suggested : "");

/**
 * WHAT THE PRESS HAS DONE SO FAR, counted once.
 *
 * `packTally`'s shape one screen earlier, and for its reason: the pack screen
 * prints this line and is reached by a redirect that only fires when nothing is
 * held, so on the pack where something needs a person the progress of the other
 * ten was exactly where nobody looked.
 *
 * A file can be counted in more than one column and that is right — a stored
 * file is still stored once it is being read. This is a progress line, not a
 * partition, and each number answers its own question.
 */
function uploadTally(queue: Queued[]) {
  return queue.reduce(
    (acc, item) => {
      if (item.pathname) acc.stored += 1;
      if (item.status !== "refused" && kindOf(item)) acc.identified += 1;
      if (item.status === "registering" || (item.status === "done" && !item.note)) acc.beingRead += 1;
      // Registered, and its read is queued behind the pack's in-flight cap. It
      // starts on its own and needs nobody, which is why it is not in the
      // column that says somebody is wanted.
      if (item.status === "done" && item.note) acc.waitingForSlot += 1;
      if (item.status === "needs-kind") acc.waitingForYou += 1;
      if (item.status === "failed") acc.failed += 1;
      return acc;
    },
    { stored: 0, identified: 0, beingRead: 0, waitingForSlot: 0, waitingForYou: 0, failed: 0 },
  );
}

export default function IntakeBatchUpload({ projectId, onUploaded }: { projectId: string; onUploaded?: () => void }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // A REF, not state: the batch is created inside the press's loop, and a
  // second file in the same loop has to see the id the first one made.
  const batchId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // ONE CHECK PER FILE, started the moment it is dropped so the row can say
  // what it found, and awaited again by the press so nothing is uploaded
  // before it has answered.
  const checks = useRef(new Map<string, Promise<{ verdict: UploadVerdict; pages: number | null }>>());

  const applyVerdict = (key: string, verdict: UploadVerdict, pages: number | null = null) => {
    if (verdict.kind === "refuse") update(key, { status: "refused", error: verdict.message, tooLarge: true, pages });
    else if (verdict.kind === "warn") update(key, { warning: verdict.message, pages });
    else update(key, { pages });
  };

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const rows = Array.from(files).map((file): Queued => {
        // READ THE NAME NOW, because it costs nothing. It abstains wherever two
        // kinds are possible — a bare "schedule" could be FF&E, finishes or
        // fabric — and an abstention leaves the row exactly as it has always
        // been, which is held rather than wrong.
        const named = unreadableUploadAdvice(file.name) ? null : guessKindFromName(file.name);
        return {
        key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        choice: "",
        suggested: named ? choiceFor(named.decision) : "",
        evidence: named ? named.evidence : null,
        suggestedFrom: (named ? "name" : null) as Queued["suggestedFrom"],
        // A FORMAT NOTHING READS IS REFUSED IN THE BROWSER, before a byte is
        // stored (variance matrix row 5). The server refuses it too — this is a
        // screen and a screen is never the guarantee — but an `.xls` that was
        // stored, classified and then refused has spent a model call and left a
        // file in the store for a bill nobody can read.
        //
        // AND AN OUTLOOK `.msg` (FIU 2026-09-21). `INTAKE_UPLOAD_ACCEPT` below
        // is the file PICKER's filter, which a file dropped on the zone never
        // passes through, and the store admits `.msg` because it is legitimate
        // evidence on a change set — so a dropped one reached the project's own
        // blob prefix and was refused only by the route. No charge and no run;
        // a stray blob.
        status: (unreadableUploadAdvice(file.name) ? "refused" : "waiting") as Queued["status"],
        pathname: null,
        // Generated ONCE per file and reused on every retry, so a lost response
        // cannot register the same upload twice.
        registrationRequestId: crypto.randomUUID(),
        progress: 0,
        error: unreadableUploadAdvice(file.name),
        note: null,
        warning: null,
        tooLarge: false,
        failure: null,
        sentToModel: false,
        largeDocument: false,
        pages: null,
        };
      });
    // TOO LARGE FOR ONE READ is refused here too, before a byte is stored:
    // the byte cap at once, the page count as soon as pdfjs has counted.
    for (const row of rows) {
      if (row.status === "refused" || !isPdfUpload(row.file.name, row.file.type)) continue;
      const bySize = pdfUploadVerdict({ bytes: row.file.size, pages: null });
      if (bySize.kind === "refuse") {
        row.status = "refused";
        row.error = bySize.message;
        row.tooLarge = true;
        continue;
      }
      const check = checkUploadCounted(row.file);
      checks.current.set(row.key, check);
      void check.then(({ verdict, pages }) => applyVerdict(row.key, verdict, pages));
    }
    setQueue((current) => [...current, ...rows]);
  }

  const update = (key: string, patch: Partial<Queued>) =>
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  // A refused file is out of this count on purpose: it is not going to be
  // stored, read or charged for, so it must not appear in the sentence that
  // says how many will be.
  const pending = queue.filter((item) => item.status !== "done" && item.status !== "refused");
  const held = queue.filter((item) => item.status === "needs-kind");
  const heldAndAnswered = held.filter((item) => item.choice);

  /**
   * THE PACK, created the first time a file is about to be REGISTERED into it.
   *
   * It used to be created before the loop, and on pilot (2026-09-23) a
   * thirty-file upload whose every look failed left two intake batches holding
   * nothing — a pack nobody delivered, listed as though somebody had. Created
   * here, a press that registers nothing creates nothing: not an upload that
   * fails to store, and not a file held for a kind. Returns null, with the
   * banner set, when the pack itself could not be made.
   */
  async function ensureBatch(): Promise<string | null> {
    if (batchId.current) return batchId.current;
    const batch = await apiFetch<{ batch: { id: string } }>(`/api/projects/${projectId}/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: `${queue.length} document${queue.length === 1 ? "" : "s"}` }),
    });
    if (!batch.ok) {
      setError(batch.error);
      return null;
    }
    batchId.current = batch.data.batch.id;
    return batchId.current;
  }

  /**
   * The press, over every file — or over ONE, for "Try identifying again". A
   * retry is the same path with the held-row guard lifted for that file: it is
   * already stored, so nothing is uploaded twice, and it is looked at again.
   */
  async function start(onlyKey: string | null = null) {
    if (pending.length === 0) return;
    setBusy(true);
    setError(null);

    try {
      // Sequential, so a failure names the file it belongs to and the others
      // still land. A pack whose drawings failed is still a pack with a bill.
      for (const item of queue) {
        if (onlyKey && item.key !== onlyKey) continue;
        if (item.status === "done") continue;
        // Nothing to retry about a format this app cannot read.
        if (item.status === "refused") continue;
        // HELD FOR A KIND AND STILL UNANSWERED. Skipped rather than guessed at:
        // reading it under the wrong prompt spends a call on output that
        // answers a different question. A retry of THIS file is the exception.
        if (item.status === "needs-kind" && !item.choice && item.key !== onlyKey) continue;

        let pathname = item.pathname;
        let pages = item.pages;
        if (!pathname) {
          // THE SIZE CHECK HAS TO HAVE ANSWERED before a byte is stored.
          const checked = await (checks.current.get(item.key) ?? checkUploadCounted(item.file));
          applyVerdict(item.key, checked.verdict, checked.pages);
          pages = checked.pages;
          if (checked.verdict.kind === "refuse") continue;
        }
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

        // WHAT IS IT? Only where nobody has said and nothing has LOOKED at it.
        // A person's choice is never second-guessed and a document is never
        // classified twice — but a NAME is not a reading, so a file the
        // filename rule guessed at is still looked at here.
        let choice = settledKind(item);
        if (!choice) {
          update(item.key, { status: "reading", failure: null });
          const asked = await apiFetch<{
            decision: { importType: string; documentKind: string | null } | null;
            /** Known, and not something this app reads — a bill inside a PDF. */
            unsupported?: string | null;
            evidence?: string;
            titleText?: string | null;
            charged?: boolean;
            largeDocument?: boolean;
          }>("/api/imports/classify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              pathname,
              filename: item.file.name,
              contentType: item.file.type,
              ...(pages ? { pages } : {}),
            }),
          });

          // THE LOOK FAILED — no key, a rate limit, a timeout, a 504 page.
          // Red, on the row, with the reason; held for a person, who can try
          // again or choose the kind by hand. Never the grey evidence line.
          if (!asked.ok) {
            const failure = classifyFailureFromResponse(asked.status, asked.data, asked.error);
            update(item.key, {
              status: "needs-kind",
              failure,
              sentToModel: item.sentToModel || failure.sent,
            });
            continue;
          }

          const read = choiceFor(asked.data.decision);
          const evidence = asked.data.evidence ?? null;
          update(item.key, {
            sentToModel: item.sentToModel || asked.data.charged !== false,
            largeDocument: asked.data.largeDocument === true,
          });
          if (read) {
            // THE DOCUMENT BEATS THE NAME, and the evidence moves with it: a
            // suggestion and the sentence under it are one reading, or the row
            // cites a cover page for something it worked out from a filename.
            update(item.key, { suggested: read, evidence, suggestedFrom: "model", note: null });
          } else {
            // IT LOOKED AND COULD NOT TELL. A name guess is KEPT — it is still
            // one click from being accepted — and what the document said goes
            // beside it in slate rather than replacing it.
            const named = item.suggestedFrom === "name";
            update(item.key, {
              evidence: named ? item.evidence : evidence,
              note: named && evidence ? `Looked at the document and could not tell: ${evidence}` : null,
            });
          }
          choice = read;

          // KNOWN, AND NOT SOMETHING THIS APP READS (§6.10.a row 8). Different
          // from "nobody knows yet": the file stays, the dropdown stays open in
          // case the answer was wrong, and the reason is printed as an error
          // rather than as the grey evidence line — because there is an action
          // in it, and it is not on this screen.
          const unsupported = asked.data.unsupported ?? null;
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

        const id = await ensureBatch();
        if (!id) return;

        update(item.key, { status: "registering", failure: null });
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
        const id = batchId.current;
        if (id && !current.some((row) => row.status === "needs-kind" || row.status === "failed")) {
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

  // WHAT THE PRESS STILL HAS TO PAY TO IDENTIFY. Not `pending.length`: a file
  // whose kind a person has said, or whose document has already been read, is
  // not asked about again — so a pack whose suggestions were all accepted costs
  // nothing to identify, and the sentence has to be able to say so.
  const toIdentify = pending.filter((item) => !settledKind(item)).length;
  const namedFromFilename = queue.filter((item) => item.suggestedFrom === "name" && !item.choice).length;
  const tally = uploadTally(queue);
  const showTally = busy || queue.some((item) => item.pathname);

  // ONE REASON, SAID ONCE. Two or more files whose look failed for the same
  // reason get one banner above the rows; each row keeps its own line. Thirty
  // red rows reading "not configured" are one problem, not thirty.
  const failureCounts = new Map<ClassifyFailureCode, number>();
  for (const item of queue) {
    if (item.failure && item.status === "needs-kind") {
      failureCounts.set(item.failure.code, (failureCounts.get(item.failure.code) ?? 0) + 1);
    }
  }
  const banners = [...failureCounts.entries()].filter(([, count]) => count >= 2);

  // THE FOOTER COUNTS WHAT WAS NEVER SENT. "Nothing has been charged" was
  // printed under every held file, including thirty the model had been asked
  // about and a pack where every call had failed for want of a key — true of
  // the second only by accident, and false of the first.
  const heldSent = held.filter((item) => item.sentToModel).length;

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

      {/* WHAT THE PRESS DOES, ABOVE THE ROWS (FIU 2026-09-22). It used to be
          the last thing on the component, below the button, in grey — so what a
          person MET was eleven boxes that looked mandatory, and the sentence
          saying the app fills them in was read afterwards if at all.

          It is still stated before the press, because the press is what spends
          the money, and it is deliberately not a confirm dialog: every document
          in a tender pack is going to be read, and a modal per pack is ceremony
          rather than a decision. */}
      <p className="mt-3 text-xs text-neutral-500">
        {pending.length === 0 ? (
          <>Drop the pack above. Nothing is read, and nothing is charged, until you press.</>
        ) : (
          <>
            {namedFromFilename > 0 && (
              <>
                {namedFromFilename === 1 ? "One file has been" : `${namedFromFilename} files have been`} filled in from{" "}
                {namedFromFilename === 1 ? "its" : "their"} name — that reads nothing, stores nothing and costs nothing.
                Accept each one or change it.{" "}
              </>
            )}
            {toIdentify === 0 ? (
              <>
                One press: each file is stored and read. Every file already has a kind, so there is nothing to spend on
                working that out — just a full charged read for every specification document, and a bill of quantities
                is read by code and costs nothing.
              </>
            ) : (
              <>
                One press: each file is stored, looked at to work out what it is, and then read. That is{" "}
                {toIdentify === 1 ? "one small call" : `${toIdentify} small calls`} to identify{" "}
                {toIdentify === 1 ? "it" : "them"}, and a full charged read for every specification document — a bill of
                quantities is read by code and costs nothing.
              </>
            )}{" "}
            Anything the app cannot identify waits for you rather than being guessed at. What it decides is shown with
            its reasons, and reviewing what comes back is still yours.
          </>
        )}
      </p>

      {/* HOW FAR IT HAS GOT. The pack screen's own line, one screen earlier,
          because the redirect to it only fires when nothing is held — so on the
          pack where something needs a person, the reading progress of the rest
          was on a screen nobody was looking at. */}
      {showTally && (
        <p className="mt-2 text-xs text-neutral-600">
          {tally.stored} stored · {tally.identified} identified · {tally.beingRead} being read · {tally.waitingForYou}{" "}
          waiting for you
          {tally.waitingForSlot > 0 && <> · {tally.waitingForSlot} waiting for a slot</>}
          {tally.failed > 0 && <span className="text-red-700"> · {tally.failed} could not be stored</span>}
        </p>
      )}

      {banners.map(([code, count]) => (
        <p
          key={code}
          role="alert"
          className="mt-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2"
        >
          <span className="font-medium">{count} files were not identified.</span> {CLASSIFY_FAILURE_BANNER[code]}
        </p>
      ))}

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
                  {item.status === "needs-kind" &&
                    (item.failure ? (
                      <span className="text-red-700">Not identified</span>
                    ) : (
                      <span className="text-amber-700">Say which</span>
                    ))}
                  {item.status === "done" && "Added"}
                  {item.status === "failed" && <span className="text-red-700">Failed</span>}
                  {item.status === "refused" && (
                    <span className="text-red-700">{item.tooLarge ? "Too large" : "Cannot be read"}</span>
                  )}
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

                {/* AGREEING WITH IT HAS TO BE POSSIBLE, and before this it was
                    not: the select's value IS the suggestion and its `onChange`
                    is the only thing that records a choice, so picking the
                    option already showing fired nothing and the amber flag
                    could never be cleared by agreeing with it. That is the
                    level-picker trap in a second place, and the answer is the
                    app's own primitive — dashed blue, its evidence required
                    beside it, one click to accept. The select stays, because
                    changing it to something else is the other half. */}
                {unchecked ? (
                  <SuggestButton
                    className="w-full"
                    value={shortLabel(item.suggested)}
                    evidence={item.evidence ?? ""}
                    onAccept={() => update(item.key, { choice: item.suggested })}
                    disabled={busy || item.status === "done"}
                  />
                ) : (
                  // WHAT IT WAS READ FROM, so a filed answer can still be
                  // checked against the file rather than taken on trust.
                  item.evidence && <p className="w-full text-xs text-neutral-500">{item.evidence}</p>
                )}
                {item.error && <p className="w-full text-xs text-red-700">{item.error}</p>}
                {item.failure && item.status === "needs-kind" && (
                  <div className="w-full flex flex-wrap items-center gap-2">
                    <p className="text-xs text-red-700">{item.failure.message}</p>
                    {/* THE FILE IS STORED, so this looks at it again and
                        uploads nothing. Choosing a kind in the box beside it
                        is the other way on, and needs no look at all. */}
                    {item.pathname && !item.choice && (
                      <Button variant="secondary" size="xs" onClick={() => void start(item.key)} disabled={busy}>
                        Try identifying again
                      </Button>
                    )}
                  </div>
                )}
                {item.largeDocument && (
                  <p className="w-full text-xs text-neutral-500">
                    Large document — identified with the reading model.
                  </p>
                )}
                {item.warning && <p className="w-full text-xs text-amber-700">{item.warning}</p>}
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
            {held.length === 1 ? "it" : "them"}
            {heldSent === 0 ? (
              <>, so nothing has been charged.</>
            ) : heldSent === held.length ? (
              <>
                ; {held.length === 1 ? "it was" : `all ${held.length} were`} sent to the model to be identified, one small
                call each.
              </>
            ) : (
              <>
                ; {heldSent} {heldSent === 1 ? "was" : "were"} sent to the model to be identified, one small call each,
                and the other {held.length - heldSent} {held.length - heldSent === 1 ? "was" : "were"} never sent, so
                nothing was charged for {held.length - heldSent === 1 ? "it" : "those"}.
              </>
            )}
          </p>
        )}
      </div>

    </div>
  );
}
