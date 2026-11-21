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
// A FILE CAN HOLD SEVERAL DOCUMENTS (open intake, 2026-11-20). The look is a
// survey, and a file it finds two or more parts in shows a box per part
// (`UploadFileParts.tsx`); the press registers one READ per reader
// (`upload-reads.ts`), each with its own place and request id. A file with one
// read is a file row exactly as before. Still ONE charged look per file.
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
import { pathnameSafeName, projectUploadPrefix } from "@/lib/upload-paths";
import { guessKindFromName } from "@/lib/document-name-guess";
import SuggestButton from "@/components/ui/SuggestButton";
import Button from "@/components/ui/Button";
import { checkUploadCounted } from "@/lib/upload-check";
import { isPdfUpload, pdfUploadVerdict, type UploadVerdict } from "@/lib/upload-limits";
import UploadFileParts from "@/components/projects/UploadFileParts";
import {
  kindOfPart,
  nextRequestId,
  readsOf,
  serverAnswered,
  SKIP_PART,
  type ClassifiedPart,
  type PartReadState,
  type PartRow,
} from "@/lib/upload-reads";
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
   * WHY, in full — one click away, never instead of `error`, which is the one
   * short sentence (Max, 2026-10-15). Today: a PDF bill whose text is not a
   * table, naming the page and the columns the reader saw.
   */
  errorDetail: string | null;
  /**
   * HELD BECAUSE TWO READINGS DISAGREE (C1): the model named another kind and
   * the PDF's text is a bill's table. Amber, with the next step in it, and
   * gone once a person has said what it is and it registers.
   */
  held: string | null;
  /**
   * THE MODEL'S READING, where it CONTRADICTS the name's (K1, 2026-11-20): the
   * box keeps the name's suggestion and this is offered beside it, both one
   * click, neither filed. Empty where there is no disagreement.
   */
  alternative: string;
  alternativeEvidence: string | null;
  /**
   * A HELD FILE'S SUGGESTED READER (a bill or schedule whose cells read as a
   * bill's), OFFERED BESIDE AN EMPTY BOX and never in it — `alternative`'s
   * rule, for its reason (2026-11-21, the review): shown in the box, the
   * suggestion could not be accepted there (choosing the option a select
   * already shows fires no change event, prod-ready F6), and a box showing a
   * kind reads as answered when nothing has been. Kept out of `suggested`,
   * too, so no path that reads `suggested` (`settledKind`) can file it.
   */
  heldSuggestion: string;
  heldSuggestionEvidence: string | null;
  /** The survey's own note on the file — what it set aside, merged or saw — in slate on the row. */
  surveyNote: string | null;
  /**
   * EVERY PART LEFT OUT, NOTHING REGISTERED. Settled — no person is wanted —
   * and not read: the row says "Nothing read from this file." and the tally
   * does not count it as being read.
   */
  nothingRead: boolean;
  /**
   * Stored and registered, and its read is queued behind the pack's in-flight
   * cap. NOT `error`: this is the ordinary outcome for the fourth document
   * onwards and it needs nobody, so it is said in slate beside the file rather
   * than in the red reserved for a read that did not reach the queue.
   */
  note: string | null;
  /**
   * AN EMAIL ALREADY HELD (2026-11-20): the inbox has this message (same
   * Message-ID), on this project or another, so nothing was recorded or read
   * and `note` is the server's sentence naming where it is. It holds the
   * panel open like a failure does — the redirect used to send the person to
   * the new pack's page, which was empty when the email was all the press
   * held ("That pack is not on this project"), and the sentence was gone.
   */
  duplicate: boolean;
  /**
   * THE RUN AN EMAIL'S REGISTRATION MADE, for the email's own review page
   * (F1, 2026-11-20). An email joins no pack — `assignMessage` files its read
   * with `batch_id` null — so a press that uploaded only emails has no pack to
   * go to, and goes here instead, where the Documents tab's "Emails" row links.
   */
  emailRunId: string | null;
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
  /** The browser's page count, passed to classify as a hint. Null when not counted. */
  pages: number | null;
  /**
   * THE FILE'S PARTS, where the look found two or more to read (open intake).
   * Null for every single-kind file, which keeps today's row exactly: one
   * box, one registration, `registrationRequestId` above.
   */
  parts: PartRow[] | null;
  /**
   * One request id PER READ, by the read's key (`readsOf`), made the first
   * time the read is sent and kept for a retry of it — never shared between
   * reads, and replaced once the server has answered it with an error
   * (`nextRequestId`). How each read WENT is on its parts (`PartRow.read`),
   * never here: a key changes with a kind, and a part's registration must
   * not (`upload-reads.ts`).
   */
  readIds: Record<string, string>;
};

/**
 * The model's evidence, and what a PDF bill's text read as.
 *
 * A PDF BILL CODE COULD NOT READ says, before it is registered, that the model
 * will transcribe it and that it is charged (C2): the statement of the charge
 * belongs on the row, as it does for every document read on registration —
 * the row that files it, and since F4 (2026-11-20) the row that offers it.
 */
function withPdfBill(
  evidence: string | null,
  pdfBill: { lines: number; pages: number; transcribe?: true; reason?: string } | null,
): string | null {
  if (pdfBill?.transcribe) {
    return `${evidence ?? ""} ${pdfBill.reason ?? ""} The model will transcribe it when you open the review${pdfBill.pages ? ` (${pdfBill.pages} page${pdfBill.pages === 1 ? "" : "s"})` : ""} — one charged read — and mark every line for you to check against its page.`
      .replace(/\s+/g, " ")
      .trim();
  }
  if (pdfBill) {
    return `${evidence ?? ""} Its text reads as a table: ${pdfBill.lines} line${pdfBill.lines === 1 ? "" : "s"} on ${pdfBill.pages} page${pdfBill.pages === 1 ? "" : "s"}.`.trim();
  }
  return evidence;
}

/** What will be used for a file: what somebody chose, else what was read. */
const kindOf = (item: Queued) => item.choice || item.suggested;

/** A file's parts as `readsOf` takes them. */
const partKinds = (parts: PartRow[]) => parts.map((part) => ({ place: part.place, kind: kindOfPart(part), read: part.read }));

/**
 * Has a person said enough for the press to act on this held file? A file
 * row: its box. A file with parts: EVERY part — a file half answered
 * registers nothing (`readsOf`).
 */
const answered = (item: Queued) => (item.parts ? !readsOf(partKinds(item.parts)).blocked : Boolean(item.choice));

/** One part of the look's answer as the row holds it. */
function partRowOf(part: ClassifiedPart): PartRow {
  const base = { place: part.place, choice: "", held: part.held, error: part.unsupported, errorDetail: part.unsupportedDetail, read: null, offered: "" };
  // A COVER OR AN INDEX STARTS AT "DON'T READ THIS PART", and it is the
  // look's reading, shown and one change away like any other.
  if (part.nothingToRead) {
    return { ...base, suggested: SKIP_PART, settled: true, evidence: part.evidence || "Nothing here is read for a specification." };
  }
  const read = choiceFor(part.decision);
  if (read) return { ...base, suggested: read, settled: true, evidence: withPdfBill(part.evidence, part.decision ? part.pdfBill : null) ?? "" };
  // HELD, WITH OR WITHOUT A SUGGESTION: offered beside an empty box, filed by nobody.
  return { ...base, suggested: "", settled: false, offered: choiceFor(part.suggestion), evidence: part.evidence };
}

/**
 * HELD BECAUSE THE NAME AND THE MODEL DISAGREE (K1), and nobody has said which.
 *
 * ITS BOX SHOWS WHAT THE PRESS COUNTS (prod-ready F6, 2026-11-20): nothing.
 * It showed the name's kind, in amber, while the press read "Read the 0 you
 * have named" — the person saw their answer already in the box and was stuck,
 * because only the suggestion could record it (choosing the option a select
 * already shows fires no change). So the box is empty until somebody chooses,
 * in the box or by either suggestion; neither side is picked for them.
 */
const disputed = (item: Queued) =>
  item.status === "needs-kind" && Boolean(item.alternative || item.heldSuggestion) && !item.choice;

/** The kind the row's box shows. */
const shownKind = (item: Queued) => (disputed(item) ? "" : kindOf(item));

/**
 * What the row says under its box: the model's evidence where its reading of a
 * disputed file is the one chosen — in the box or by the suggestion — so a
 * bill the model will transcribe says what that costs when the press spends
 * it (F4); the name's, or the model's unheld reading, otherwise.
 */
const shownEvidence = (item: Queued) => {
  if (item.alternative && item.choice === item.alternative) return item.alternativeEvidence ?? item.evidence;
  if (item.heldSuggestion && item.choice === item.heldSuggestion) return item.heldSuggestionEvidence ?? item.evidence;
  return item.evidence;
};

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
      if (item.status !== "refused" && (item.parts ? item.parts.some((part) => part.choice || part.suggested) : shownKind(item))) {
        acc.identified += 1;
      }
      if (item.status === "registering" || (item.status === "done" && !item.note && !item.duplicate && !item.nothingRead)) acc.beingRead += 1;
      // Registered, and its read is queued behind the pack's in-flight cap. It
      // starts on its own and needs nobody, which is why it is not in the
      // column that says somebody is wanted.
      if (item.status === "done" && item.note && !item.duplicate) acc.waitingForSlot += 1;
      if (item.status === "needs-kind") acc.waitingForYou += 1;
      if (item.status === "failed") acc.failed += 1;
      return acc;
    },
    { stored: 0, identified: 0, beingRead: 0, waitingForSlot: 0, waitingForYou: 0, failed: 0 },
  );
}

export default function IntakeBatchUpload({
  projectId,
  onUploaded,
  onRegistered,
}: {
  projectId: string;
  /** Everything in the press is settled: the parent may close this panel. */
  onUploaded?: () => void;
  /**
   * Something registered, but a file is still waiting on a person (held for a
   * kind, or failed). The parent refreshes what it shows and must NOT close
   * this panel: the held rows, and the reason each one failed, exist nowhere
   * else.
   */
  onRegistered?: () => void;
}) {
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
        errorDetail: null,
        held: null,
        alternative: "",
        alternativeEvidence: null,
        heldSuggestion: "",
        heldSuggestionEvidence: null,
        surveyNote: null,
        nothingRead: false,
        note: null,
        duplicate: false,
        emailRunId: null,
        warning: null,
        tooLarge: false,
        failure: null,
        sentToModel: false,
        pages: null,
        parts: null,
        readIds: {},
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
  const heldAndAnswered = held.filter(answered);

  // ============================================================================
  // THIRTY BOXES, SET IN ONE GO (plan any-bill, step 3). Max, on the Miami
  // Beach pack: assigning thirty dropdowns by hand is a chore, and most of a
  // pack is drawings.
  //
  // A BULK CHOICE IS A PERSON'S CHOICE, exactly as picking the select is: it
  // writes `choice`, which the press never second-guesses and never pays to
  // look at. It writes it DIRECTLY, never by driving the select — a select
  // already showing "Shop drawings" fires no change event when Shop drawings
  // is chosen, which is the level-picker trap, and the point here is that
  // agreeing with thirty suggestions takes one press.
  // ============================================================================
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [bulkKind, setBulkKind] = useState("");
  /**
   * A row whose kind can still be set: not registered, not refused — and a
   * WHOLE FILE. A file with parts has a kind per part, and a bulk choice
   * written over all of them would be the bulk control deciding a mix.
   */
  const settable = pending.filter((item) => !item.parts);
  const tickedRows = settable.filter((item) => ticked.has(item.key));
  const allTicked = settable.length > 0 && tickedRows.length === settable.length;
  /**
   * WHAT "ALL UNSET" TOUCHES: a PDF whose box is empty — no person's choice,
   * and nothing read off its name or its pages. A box already showing a
   * suggestion is not unset, and overwriting a name that says "BOQ" with Shop
   * drawings would be the bulk control guessing louder than the guess. A
   * spreadsheet is left alone because a drawing set is never one: an unset
   * .xlsx is a bill or a schedule far more often, and reading it under the
   * drawings prompt spends a charged read on the wrong question.
   */
  const unsetDrawings = settable.filter((item) => !kindOf(item) && isPdfUpload(item.file.name, item.file.type));

  const setChoice = (keys: Set<string>, value: string) =>
    setQueue((current) => current.map((item) => (keys.has(item.key) ? { ...item, choice: value } : item)));

  function applyBulk() {
    if (!bulkKind || tickedRows.length === 0) return;
    setChoice(new Set(tickedRows.map((item) => item.key)), bulkKind);
    setTicked(new Set());
  }

  /**
   * THE PACK, created the first time a file is about to be REGISTERED into it.
   *
   * It used to be created before the loop, and on pilot (2026-09-23) a
   * thirty-file upload whose every look failed left two intake batches holding
   * nothing — a pack nobody delivered, listed as though somebody had. Created
   * here, a press that registers nothing creates nothing: not an upload that
   * fails to store, and not a file held for a kind. Returns null, with the
   * banner set, when the pack itself could not be made.
   *
   * AND NOT AN EMAIL (F1, 2026-11-20). An email's read is filed with no pack
   * (`assignMessage`, `batch_id` null: it counts against the project's
   * batch-less slots), so a pack made for one held nothing, the batches list
   * hid it, and the redirect to it said "That pack is not on this project".
   * The press never calls this for an email, and the label counts only the
   * files that can be in the pack.
   */
  async function ensureBatch(): Promise<string | null> {
    if (batchId.current) return batchId.current;
    const files = queue.filter((item) => kindOf(item) !== "email").length;
    const batch = await apiFetch<{ batch: { id: string } }>(`/api/projects/${projectId}/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: `${files} document${files === 1 ? "" : "s"}` }),
    });
    if (!batch.ok) {
      setError(batch.error);
      return null;
    }
    batchId.current = batch.data.batch.id;
    return batchId.current;
  }

  /**
   * A MIXED FILE'S READS, one registration per reader (`readsOf`), each with
   * its own request id and its outcome recorded ON THE PARTS it covers. A
   * registered part is never sent again, whatever its box says since; a read
   * whose answer was lost is re-sent exactly; a refused one is free to be
   * answered again. Returns false where the pack itself could not be made,
   * which stops the press as it does for a single file.
   */
  async function registerReads(item: Queued, parts: PartRow[], pathname: string): Promise<boolean> {
    const plan = readsOf(partKinds(parts));
    if (plan.blocked) {
      update(item.key, { status: "needs-kind" });
      return true;
    }
    const ids = { ...item.readIds };
    let rows = parts;
    const onParts = (indexes: number[], patch: (row: PartRow) => PartRow) => {
      rows = rows.map((row, index) => (indexes.includes(index) ? patch(row) : row));
    };
    let heldAgain = false;
    for (const read of plan.reads) {
      const entry = CHOICES.find((option) => option.value === read.kind);
      if (!entry) continue;
      const batch = await ensureBatch();
      if (!batch) return false;
      ids[read.key] ??= crypto.randomUUID();
      const sent = { key: read.key, kind: read.kind, part: read.part };
      // IN DOUBT FROM THE MOMENT IT IS SENT: a press interrupted here has
      // sent a request whose answer nobody saw.
      onParts(read.partIndexes, (row) => ({ ...row, read: { state: "registering", message: null, registered: false, inDoubt: sent } }));
      update(item.key, { status: "registering", failure: null, held: null, readIds: { ...ids }, parts: rows });
      const res = await apiFetch<{
        importId?: string;
        autoRead?: { dispatched: boolean; error?: string; waiting?: boolean; note?: string };
      }>("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          batchId: batch,
          importType: entry.importType,
          documentKind: entry.documentKind,
          pathname,
          filename: item.file.name,
          contentType: item.file.type,
          size: item.file.size,
          registrationRequestId: ids[read.key],
          ...(read.part ? { part: read.part } : {}),
        }),
      });
      if (!res.ok) {
        ids[read.key] = nextRequestId(ids[read.key]!, res);
        const detail = typeof res.data?.detail === "string" ? res.data.detail : null;
        if (res.status === 400 && detail && entry.importType === "boq") {
          // A BILL WHOSE TEXT IS NOT A TABLE: its parts go back to a person,
          // as a whole file's box does (C1), with the reason on them. Nothing
          // was registered for them, so they are free to be answered again.
          heldAgain = true;
          onParts(read.partIndexes, (row) => ({ ...row, choice: "", suggested: "", settled: false, offered: "", error: res.error, errorDetail: detail, read: null }));
        } else {
          const answered = serverAnswered(res);
          onParts(read.partIndexes, (row) => ({
            ...row,
            read: { state: "failed", message: res.error, registered: false, inDoubt: answered ? null : sent },
          }));
        }
        continue;
      }
      const autoRead = res.data.autoRead;
      const waiting = autoRead?.dispatched === false && autoRead.waiting === true;
      const state: PartReadState =
        autoRead && !autoRead.dispatched && !waiting
          ? // REGISTERED, and its read did not reach the queue: the run exists
            // and the pack screen offers the retry, so the part is locked as
            // added, with the reason in red beside it.
            { state: "failed", message: autoRead.error ?? "Stored, but not queued for reading.", registered: true, inDoubt: null }
          : { state: waiting ? "waiting" : "done", message: waiting ? (autoRead?.note ?? null) : null, registered: true, inDoubt: null };
      onParts(read.partIndexes, (row) => ({ ...row, read: state }));
    }
    const failed = rows.some((row) => row.read?.state === "failed" && !row.read.registered);
    const anyRegistered = rows.some((row) => row.read?.registered);
    const waitingNote = rows.find((row) => row.read?.state === "waiting")?.read?.message ?? null;
    update(item.key, {
      parts: rows,
      readIds: { ...ids },
      status: heldAgain ? "needs-kind" : failed ? "failed" : "done",
      progress: heldAgain || failed ? item.progress : 100,
      // The tally reads `note` as "waiting for a slot"; the parts say which.
      note: !heldAgain && !failed ? waitingNote : null,
      // Every part left out: settled, and nothing read.
      nothingRead: !heldAgain && !failed && !anyRegistered,
      error: null,
    });
    return true;
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
        if (item.status === "needs-kind" && !answered(item) && item.key !== onlyKey) continue;

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
            const blob = await upload(`${projectUploadPrefix(projectId)}${pathnameSafeName(item.file.name)}`, item.file, {
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
        let parts = item.parts;
        if (!choice && !parts) {
          update(item.key, { status: "reading", failure: null });
          const asked = await apiFetch<{
            decision: { importType: string; documentKind: string | null } | null;
            /** Known, and not something this app reads — a scan, or a PDF bill whose text is not a table. */
            unsupported?: string | null;
            unsupportedDetail?: string | null;
            /**
             * A bill in a PDF whose text reads as a table: how much of it. Or,
             * with `transcribe`, one code could not read, which the model
             * transcribes when the review opens (C2): why, and how many pages.
             */
            pdfBill?: { lines: number; pages: number; transcribe?: true; reason?: string } | null;
            /** Held: the model filed it as something else, and its text reads as a bill. */
            held?: string | null;
            /** Held because the NAME says another kind: what the model read it as (K1). */
            modelDecision?: { importType: string; documentKind: string | null } | null;
            /** Held, with a reader suggested: a bill or a schedule whose cells read as a bill's. */
            suggestion?: { importType: string; documentKind: string | null } | null;
            /** Two or more parts to read: the file is answered per part. */
            parts?: ClassifiedPart[];
            evidence?: string;
            titleText?: string | null;
            charged?: boolean;
            /** The survey's note on the file as a whole. */
            note?: string | null;
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
          // A PDF BILL SAYS WHAT ITS TEXT READ AS, beside why it is a bill:
          // the lines are put back by code at registration, and the count is
          // the first thing to check against the PDF.
          const pdfBill = asked.data.decision ? (asked.data.pdfBill ?? null) : null;
          const evidence = withPdfBill(asked.data.evidence ?? null, pdfBill);
          update(item.key, {
            sentToModel: item.sentToModel || asked.data.charged !== false,
            // The survey's own note: shown on the row, single file or parts.
            surveyNote: asked.data.note?.trim() || null,
          });
          // A MIXED FILE: a kind per part, and the press goes on to its reads
          // only once every part has one — the look's reading or a person's.
          if (asked.data.parts && asked.data.parts.length > 0) {
            parts = asked.data.parts.map(partRowOf);
            const blocked = readsOf(partKinds(parts)).blocked;
            // The name's guess was for the file as one kind; it goes, so the
            // footer stops counting it as filled in from the name.
            update(item.key, { parts, status: blocked ? "needs-kind" : item.status, note: null, suggested: "", suggestedFrom: null, evidence: null });
            if (blocked) continue;
          } else {
            // HELD WITH A READER SUGGESTED (a bill or schedule whose cells read
            // as a bill's): offered BESIDE an empty box, one click to accept,
            // and nothing registered until somebody does. The name's guess was
            // for the file it named; the document's reading replaces it.
            if (asked.data.held && asked.data.suggestion) {
              update(item.key, {
                status: "needs-kind",
                held: asked.data.held,
                heldSuggestion: choiceFor(asked.data.suggestion),
                heldSuggestionEvidence: asked.data.evidence ?? null,
                suggested: "",
                suggestedFrom: null,
                evidence: null,
                note: null,
              });
              continue;
            }
            // THE NAME AND THE MODEL DISAGREE (K1): held, with the name's
            // suggestion kept in the box and the model's offered beside it. A
            // person chooses; nothing is registered or read until they do.
            //
            // AND THE MODEL'S READING CARRIES ITS COST (F4): a bill the model
            // will transcribe says so beside the offer, as the unheld row does.
            if (asked.data.held && asked.data.modelDecision) {
              update(item.key, {
                status: "needs-kind",
                held: asked.data.held,
                alternative: choiceFor(asked.data.modelDecision),
                alternativeEvidence: withPdfBill(asked.data.evidence ?? null, asked.data.pdfBill ?? null),
              });
              continue;
            }
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
              update(item.key, { status: "needs-kind", error: unsupported, errorDetail: asked.data.unsupportedDetail ?? null });
              continue;
            }

            // THE MODEL AND THE PDF'S TEXT DISAGREE (C1): the model named some
            // other kind and the text is a bill's table. Held, in amber, with the
            // next step in the sentence; the model's own reading stays beside it.
            const held = asked.data.held ?? null;
            if (held) {
              update(item.key, { status: "needs-kind", held });
              continue;
            }

            if (!choice) {
              // Uploaded and kept. A second press registers it once somebody has
              // said what it is, with no second upload and no second reading.
              update(item.key, { status: "needs-kind" });
              continue;
            }
          }
        }

        // A MIXED FILE IS REGISTERED AS ITS READS, one per reader.
        if (parts) {
          if (!(await registerReads(item, parts, pathname))) return;
          continue;
        }

        const entry = CHOICES.find((option) => option.value === choice);
        if (!entry) {
          update(item.key, { status: "needs-kind" });
          continue;
        }

        // AN EMAIL IS REGISTERED WITH NO PACK (F1): its read is filed with none
        // whatever is sent, so asking for one only made an empty pack.
        const email = entry.documentKind === "email";
        const id = email ? null : await ensureBatch();
        if (!email && !id) return;

        update(item.key, { status: "registering", failure: null, held: null });
        const res = await apiFetch<{
          importId?: string;
          autoRead?: { dispatched: boolean; error?: string; waiting?: boolean; note?: string };
          /** An email the inbox already holds (audit B8): nothing was recorded or read. */
          duplicateOf?: { messageId: string };
          note?: string;
        }>("/api/imports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            ...(id ? { batchId: id } : {}),
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
          // A BILL WHOSE PDF TEXT IS NOT A TABLE is HELD, not failed: pressing
          // again would read the same text the same way. The kind is cleared
          // so a person says what it is instead (C1).
          const detail = typeof res.data?.detail === "string" ? res.data.detail : null;
          // THE SERVER ANSWERED, SO THE NEXT SEND IS A NEW REQUEST. Its replay
          // guard hands the same id the FIRST attempt back, failed or not, so
          // a retry under it could never succeed; only a lost answer keeps it.
          const registrationRequestId = nextRequestId(item.registrationRequestId, res);
          if (res.status === 400 && detail && entry.importType === "boq") {
            update(item.key, { status: "needs-kind", choice: "", suggested: "", error: res.error, errorDetail: detail, registrationRequestId });
          } else {
            update(item.key, { status: "failed", error: res.error, errorDetail: null, registrationRequestId });
          }
          continue;
        }
        // AN EMAIL THE INBOX ALREADY HOLDS. Not a failure and not a new read:
        // the server's sentence names the message that exists and where.
        if (res.data.duplicateOf) {
          update(item.key, {
            status: "done",
            progress: 100,
            error: null,
            duplicate: true,
            note: res.data.note ?? "This email is already in the inbox, so nothing was recorded or read again.",
          });
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
          emailRunId: email ? (res.data.importId ?? null) : null,
        });
      }

      // ONLY WHEN NOTHING IS STILL WAITING ON A PERSON — both the redirect and
      // closing the panel. Navigating away from a file the app could not
      // identify would lose it: it is uploaded, it is in no batch row, and this
      // screen is the only place that knows. Closing the panel loses it just
      // as surely, and that is what `onUploaded` used to do on every press —
      // the parent unmounts this component — so on pilot (2026-09-23) thirty
      // files that had each failed with a reason vanished together and read as
      // "one mass fail". A press that leaves anything held only asks the
      // parent to refresh.
      //
      // WITH NO PACK, AN EMAIL'S OWN REVIEW (F1). A press of emails only made
      // no pack: one email goes to its review page, where the Documents tab's
      // "Emails" row links; several close the panel over that Documents card,
      // whose "Emails" group lists them. With a pack, the pack, as always —
      // the emails beside it are under "Emails" too.
      //
      // A FILE WHOSE EVERY PART WAS LEFT OUT made nothing, so a press of only
      // such files has no pack and no email to go to: the panel stays, with
      // "Nothing read from this file." on the row, rather than closing on a
      // press that did nothing anyone can see.
      setQueue((current) => {
        const id = batchId.current;
        const waiting = current.some((row) => row.status === "needs-kind" || row.status === "failed" || row.duplicate);
        const emails = current.filter((row) => row.emailRunId);
        if (waiting) {
          queueMicrotask(() => onRegistered?.());
        } else if (!id && emails.length === 0 && current.some((row) => row.nothingRead)) {
          // Nothing registered anywhere: nothing to refresh, nothing to show elsewhere.
        } else {
          queueMicrotask(() => onUploaded?.());
          if (id) window.location.href = `/dashboard/projects/${projectId}/intake/${id}`;
          else if (emails.length === 1) window.location.href = `/dashboard/imports/${emails[0]!.emailRunId}`;
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
  //
  // NOR A FILE HELD FOR A PERSON (F4, 2026-11-20): the press skips one whose
  // box nobody has answered — "Try identifying again" is its own press — so
  // counting it promised a call the press does not make.
  const toIdentify = pending.filter((item) => !item.parts && !settledKind(item) && item.status !== "needs-kind").length;
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
  //
  // AND A FILE PARTLY READ IS NOT "NOT IDENTIFIED" (2026-11-21, the review): a
  // file whose bill part came back held after its drawings registered has
  // been identified and read in part. It is counted, and said, apart.
  const heldPartly = held.filter((item) => item.parts?.some((part) => part.read?.registered));
  // NOR IS A FILE WHOSE SURVEY CAME BACK IN PARTS, one of which needs a
  // person (the walk, 2026-11-21): it was identified, part by part. It has its
  // own count and its own sentence; "could not be identified" is kept for a
  // file that genuinely came back unidentified.
  const heldForPart = held.filter((item) => item.parts && !heldPartly.includes(item));
  const heldUnread = held.filter((item) => !item.parts);
  const heldSent = heldUnread.filter((item) => item.sentToModel).length;

  // A PART IN A READ IS NEVER RE-ANSWERED: the box is disabled, and this
  // refuses too, because a disabled select is a screen and not a guarantee.
  const choosePart = (key: string, index: number, value: string) =>
    setQueue((current) =>
      current.map((item) =>
        item.key === key && item.parts
          ? {
              ...item,
              parts: item.parts.map((part, at) =>
                at === index && !part.read?.registered && !part.read?.inDoubt ? { ...part, choice: value, error: null, errorDetail: null } : part,
              ),
            }
          : item,
      ),
    );

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
            — .csv included, quantities and all — or a PDF whose text is a
            table (`pdf-bill.ts`), and `.xls` and its relations are refused,
            here in the browser, with the way out. */}
        <p className="mt-1 text-xs text-neutral-500">
          A bill of quantities reads from {SPREADSHEET_EXTENSIONS.join(", ")}, or a PDF printed from a spreadsheet;
          drawings and specification sheets from PDF; an email as a saved .eml. An older .xls has to be saved as
          .xlsx first.
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
                One press: each file is stored and read. Nothing is left for the press to identify, so there is nothing
                to spend on working that out — just a full charged read for every specification document, and a bill
                of quantities is read by code and costs nothing.
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

      {/* Two or more: a bulk control over one file is the row's own select. */}
      {settable.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="inline-flex items-center gap-2 text-neutral-700">
            <input
              type="checkbox"
              aria-label="Tick every file"
              checked={allTicked}
              ref={(box) => {
                if (box) box.indeterminate = tickedRows.length > 0 && !allTicked;
              }}
              onChange={() => setTicked(allTicked ? new Set() : new Set(settable.map((item) => item.key)))}
              disabled={busy}
            />
            {tickedRows.length > 0 ? `${tickedRows.length} ticked` : "Tick all"}
          </label>
          <span className="text-neutral-500">Set the ticked ones to</span>
          <select
            aria-label="Kind for the ticked files"
            value={bulkKind}
            onChange={(event) => setBulkKind(event.target.value)}
            disabled={busy}
            className="border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-900"
          >
            <option value="">Choose a kind…</option>
            {CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <Button size="xs" onClick={applyBulk} disabled={busy || !bulkKind || tickedRows.length === 0}>
            Apply
          </Button>
          {unsetDrawings.length > 0 && (
            <Button
              size="xs"
              className="ml-auto"
              title="Every PDF whose kind is still unset. A suggested kind is left as it is."
              onClick={() => setChoice(new Set(unsetDrawings.map((item) => item.key)), "shop_drawings")}
              disabled={busy}
            >
              All unset → Shop drawings ({unsetDrawings.length})
            </Button>
          )}
        </div>
      )}

      {queue.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 border border-neutral-200 rounded">
          {queue.map((item) => {
            // AMBER MEANS THE APP ANSWERED THIS AND NOBODY HAS CHECKED. The
            // same treatment a guessed dimension slot gets on a review card.
            const unchecked = Boolean(item.suggested) && !item.choice;
            return (
              <li key={item.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                {item.status !== "done" && item.status !== "refused" && !item.parts ? (
                  <input
                    type="checkbox"
                    aria-label={`Tick ${item.file.name}`}
                    checked={ticked.has(item.key)}
                    onChange={() =>
                      setTicked((current) => {
                        const next = new Set(current);
                        if (next.has(item.key)) next.delete(item.key);
                        else next.add(item.key);
                        return next;
                      })
                    }
                    disabled={busy}
                  />
                ) : (
                  // Held in place so the names line up.
                  <span className="inline-block w-[13px]" aria-hidden />
                )}
                <span className="text-sm text-neutral-900 flex-1 min-w-[12rem] truncate" title={item.file.name}>
                  {item.file.name}
                </span>

                {!item.parts && (
                <select
                  aria-label={`Kind of ${item.file.name}`}
                  value={shownKind(item)}
                  onChange={(event) => update(item.key, { choice: event.target.value })}
                  disabled={busy || item.status === "done"}
                  className={`border rounded px-2 py-1 text-sm text-neutral-900 ${
                    unchecked ? "border-amber-400 bg-amber-50" : "border-neutral-300"
                  }`}
                >
                  <option value="">{disputed(item) ? "— say which —" : "What is this?"}</option>
                  {CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                )}

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
                  {item.status === "done" && (item.nothingRead ? "Nothing read" : "Added")}
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
                {item.parts ? (
                  // A MIXED FILE: a box per part, and nothing about the file
                  // as a whole to accept.
                  <UploadFileParts
                    fileName={item.file.name}
                    parts={item.parts}
                    choices={CHOICES}
                    shortLabel={shortLabel}
                    busy={busy}
                    locked={item.status === "done"}
                    onChoose={(index, value) => choosePart(item.key, index, value)}
                  />
                ) : unchecked ? (
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
                  shownEvidence(item) && <p className="w-full text-xs text-neutral-500">{shownEvidence(item)}</p>
                )}
                {/* THE MODEL'S READING, where it contradicts the name's (K1):
                    one click, as the name's is, and neither filed. */}
                {item.alternative && !item.choice && item.status === "needs-kind" && (
                  <SuggestButton
                    className="w-full"
                    value={shortLabel(item.alternative)}
                    evidence={item.alternativeEvidence ? `The model read: ${item.alternativeEvidence}` : "The model's reading"}
                    onAccept={() => update(item.key, { choice: item.alternative })}
                    disabled={busy}
                  />
                )}
                {/* A HELD FILE'S SUGGESTION, beside its empty box: one click
                    records it, which the box could not. */}
                {item.heldSuggestion && !item.choice && item.status === "needs-kind" && (
                  <SuggestButton
                    className="w-full"
                    value={shortLabel(item.heldSuggestion)}
                    evidence={item.heldSuggestionEvidence ?? ""}
                    onAccept={() => update(item.key, { choice: item.heldSuggestion })}
                    disabled={busy}
                  />
                )}
                {item.error && <p className="w-full text-xs text-red-700">{item.error}</p>}
                {item.error && item.errorDetail && (
                  <details className="w-full text-xs text-neutral-600">
                    <summary className="cursor-pointer select-none">Why</summary>
                    <p className="mt-1">{item.errorDetail}</p>
                  </details>
                )}
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
                {item.warning && <p className="w-full text-xs text-amber-700">{item.warning}</p>}
                {item.held && <p className="w-full text-xs text-amber-700">{item.held}</p>}
                {item.note && <p className="w-full text-xs text-neutral-500">{item.note}</p>}
                {item.nothingRead && <p className="w-full text-xs text-neutral-500">Nothing read from this file.</p>}
                {item.surveyNote && <p className="w-full text-xs text-neutral-500 whitespace-pre-line break-words">{item.surveyNote}</p>}
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
        {heldUnread.length > 0 && (
          <p className="text-xs text-amber-700">
            {heldUnread.length === 1 ? "One file could not be identified" : `${heldUnread.length} files could not be identified`} —
            say what {heldUnread.length === 1 ? "it is" : "they are"} and press again. Nothing has been read for{" "}
            {heldUnread.length === 1 ? "it" : "them"}
            {heldSent === 0 ? (
              <>, so nothing has been charged.</>
            ) : heldSent === heldUnread.length ? (
              <>
                ; {heldUnread.length === 1 ? "it was" : `all ${heldUnread.length} were`} sent to the model to be identified, one small
                call each.
              </>
            ) : (
              <>
                ; {heldSent} {heldSent === 1 ? "was" : "were"} sent to the model to be identified, one small call each,
                and the other {heldUnread.length - heldSent} {heldUnread.length - heldSent === 1 ? "was" : "were"} never sent, so
                nothing was charged for {heldUnread.length - heldSent === 1 ? "it" : "those"}.
              </>
            )}
          </p>
        )}
        {heldForPart.length > 0 && (
          <p className="text-xs text-amber-700">
            {heldForPart.length === 1 ? "One file has a part that needs you" : `${heldForPart.length} files have a part that needs you`} —
            say what it is and press again. Nothing has been read for {heldForPart.length === 1 ? "it" : "them"} yet;{" "}
            {heldForPart.length === 1 ? "it was" : "each was"} sent to the model once to be identified.
          </p>
        )}
        {heldPartly.length > 0 && (
          <p className="text-xs text-amber-700">
            {heldPartly.length === 1 ? "One file is partly read" : `${heldPartly.length} files are partly read`} — say what the
            rest of {heldPartly.length === 1 ? "it is" : "them is"} and press again. The parts already added are being read.
          </p>
        )}
      </div>

    </div>
  );
}
