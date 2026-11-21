"use client";

// The parts of ONE uploaded file, each with its own kind (open intake, 2026-11-20).
//
// ============================================================================
// THE TRAP: A FILE ROW'S RULES, DROPPED FOR A PART.
//
// A part is chosen the way a file is, and for the same reasons
// (`IntakeBatchUpload.tsx`): the app's reading fills the box in amber with
// what it read beside it, one click accepts it (`SuggestButton` — a select
// already showing a kind fires no change event when that kind is chosen),
// and a HELD part has nothing filed for it until somebody says. A part row
// that skipped any of that would be the one place on the screen where a
// guess files itself.
//
// "Don't read this part" is a CHOICE in the same box, not a missing answer:
// a cover or an index starts there, and a person can put any part there. It
// registers nothing and costs nothing.
//
// A PART IN A READ IS LOCKED: registered, or sent with no answer back. Its
// box cannot change, because a changed kind is a different read and the
// press would register the same pages again (`upload-reads.ts`).
//
// Rows only. Which parts become which READ, and the request ids, are
// `upload-reads.ts`; the press is the parent's.
// ============================================================================
import SuggestButton from "@/components/ui/SuggestButton";
import { partLocked, placeLabel, SKIP_PART, type PartRow } from "@/lib/upload-reads";

export type { PartReadState } from "@/lib/upload-reads";

const SKIP_LABEL = "Don't read this part";

export default function UploadFileParts({
  fileName,
  parts,
  choices,
  shortLabel,
  busy,
  locked,
  onChoose,
}: {
  fileName: string;
  parts: PartRow[];
  choices: { value: string; label: string }[];
  shortLabel: (value: string) => string;
  busy: boolean;
  /** Every read of the file is registered: nothing on it can change. */
  locked: boolean;
  onChoose: (index: number, value: string) => void;
}) {
  const label = (value: string) => (value === SKIP_PART ? SKIP_LABEL : shortLabel(value));
  return (
    <ul className="w-full min-w-0 divide-y divide-neutral-100 border-l-2 border-neutral-200 pl-3" aria-label={`Parts of ${fileName}`}>
      {parts.map((part, index) => {
        const where = placeLabel(part.place);
        // THE BOX SHOWS WHAT THE PRESS COUNTS: a person's choice, or an
        // unheld reading. A held part's suggestion is offered beside it.
        const shown = part.choice || (part.settled ? part.suggested : "");
        // AMBER MEANS THE APP ANSWERED THIS AND NOBODY HAS CHECKED, as on a file row.
        const unchecked = part.settled && Boolean(part.suggested) && !part.choice;
        const offer = part.choice ? "" : unchecked ? part.suggested : part.offered;
        const read = part.read;
        const inRead = partLocked(read);
        const waitingForYou = !part.choice && (!part.settled || !part.suggested);
        return (
          <li key={`${where}-${index}`} className="flex flex-wrap items-center gap-2 py-1.5 min-w-0">
            <span className="text-sm text-neutral-700 flex-1 min-w-[10rem] break-words">{where}</span>
            <select
              aria-label={`Kind of ${fileName}, ${where}`}
              value={shown}
              onChange={(event) => onChoose(index, event.target.value)}
              disabled={busy || locked || inRead}
              className={`border rounded px-2 py-1 text-sm text-neutral-900 ${
                unchecked ? "border-amber-400 bg-amber-50" : "border-neutral-300"
              }`}
            >
              <option value="">What is this part?</option>
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
              <option value={SKIP_PART}>{SKIP_LABEL}</option>
            </select>
            <span className="text-xs text-neutral-500 w-24 text-right">
              {read?.state === "registering" && "Registering…"}
              {read?.state !== "registering" && read?.registered && "Added"}
              {read?.state === "failed" && !read.registered && <span className="text-red-700">Failed</span>}
              {!read && waitingForYou && <span className="text-amber-700">Say which</span>}
            </span>
            {offer && !inRead ? (
              <SuggestButton
                className="w-full"
                value={label(offer)}
                evidence={part.evidence}
                onAccept={() => onChoose(index, offer)}
                disabled={busy || locked}
              />
            ) : (
              part.evidence && <p className="w-full text-xs text-neutral-500 break-words">{part.evidence}</p>
            )}
            {part.held && <p className="w-full text-xs text-amber-700">{part.held}</p>}
            {part.error && <p className="w-full text-xs text-red-700">{part.error}</p>}
            {part.error && part.errorDetail && (
              <details className="w-full text-xs text-neutral-600">
                <summary className="cursor-pointer select-none">Why</summary>
                <p className="mt-1">{part.errorDetail}</p>
              </details>
            )}
            {/* Failed, or registered and not queued: red either way, with the server's sentence. */}
            {read?.state === "failed" && read.message && <p className="w-full text-xs text-red-700">{read.message}</p>}
            {read?.state === "waiting" && read.message && <p className="w-full text-xs text-neutral-500">{read.message}</p>}
          </li>
        );
      })}
    </ul>
  );
}
