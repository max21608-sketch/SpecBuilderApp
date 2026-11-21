// What a file's PARTS become at the press: one registration per reader.
//
// ============================================================================
// THE TRAP: REGISTERING A PART, OR SHARING A REQUEST ID BETWEEN READS.
//
// The survey answers in parts, and the app registers READS: every part of one
// file that goes to the same reader, together (open-intake build design, "The
// one idea"). The merged Panther pack is drawings on pages 1–11 and
// specification sheets on 31–44, both read by the drawings reader, whose job
// is to say that S-200's sheet and its drawing are ONE item — registered as
// two reads, the armchair would be staged twice and a person left to notice.
//
// Each read carries its OWN `registrationRequestId`. The server answers a
// repeat of an id with the FIRST run it made for it, even a failed one
// (`spec-registration.ts`, and the bill paths since 1b) — so two reads sharing
// one id would return the first read's run for the second, silently. And an id
// is replaced whenever the server ANSWERED a registration with an error
// (`nextRequestId`): sent again, the answered id would only be handed the
// failed first attempt back. It is kept only where no answer arrived, which is
// the lost response the guard exists for.
//
// NOTHING IS REGISTERED FOR A FILE WITH A PART NOBODY HAS ANSWERED. A file
// half registered — its bill read, its held drawings not — is the state no
// screen can show and nobody can finish.
//
// A LEAF: the upload screen and the classify route both import it, so it may
// import no server module (`client-server-boundary.test.ts`).
// ============================================================================
import type { DocumentGenre, KindDecision } from "@/lib/document-kinds";
import type { PartPlace } from "@/lib/pack-survey-types";
import { partKey, partLabel, unionParts, type SourcePart } from "@/lib/source-part";

/** The box value that says a part is left out of every read. */
export const SKIP_PART = "skip";

/** What a PDF bill's text read as, as the upload row reports it. */
export type PdfBillNote = { lines: number; pages: number; transcribe?: true; reason?: string };

/** One part of a file as the classify route answers it, where the file has two or more. */
export type ClassifiedPart = {
  place: PartPlace;
  genre: DocumentGenre;
  /** The reader, or null where a person must say (held, unclear, nothing to read, refused). */
  decision: KindDecision | null;
  certain: boolean;
  evidence: string;
  /** Why it is held, in amber above its box, where there is more to say than "say which". */
  held: string | null;
  /** A held part's suggested reader: shown in its box, never filed until accepted. */
  suggestion: KindDecision | null;
  /** Known, and not something this app reads (a PDF bill whose text is no table). */
  unsupported: string | null;
  unsupportedDetail: string | null;
  itemCodes: string[];
  finishCodes: string[];
  pdfBill: PdfBillNote | null;
  /** A cover, an index, a blank page: its box starts at "Don't read this part". */
  nothingToRead: boolean;
};

/**
 * One part as the upload screen holds it between presses. `choice` is a
 * person's and always wins; `suggested` is the app's, and counts without a
 * click only where `settled` — an unheld reading of the part, or a part with
 * nothing to read. A HELD part's suggestion (the bill a bill-or-schedule part
 * reads as) is shown and offered, and registers nothing until accepted.
 */
export type PartRow = {
  place: PartPlace;
  choice: string;
  suggested: string;
  settled: boolean;
  evidence: string;
  held: string | null;
  error: string | null;
  errorDetail: string | null;
};

/** The kind the press reads a part as, or "" while a person has still to say. */
export const kindOfPart = (part: Pick<PartRow, "choice" | "suggested" | "settled">): string =>
  part.choice || (part.settled ? part.suggested : "");

/**
 * The part a place is registered as, or null for the whole file. A row range
 * of a sheet is registered as the whole SHEET: a sheet is the smallest part of
 * a workbook a read takes (the design, "Not built"), which is why such a part
 * is held for a person rather than chosen for them.
 */
export function partOfPlace(place: PartPlace): SourcePart | null {
  switch (place.kind) {
    case "pages":
      return { kind: "pages", ranges: [{ from: place.from, to: place.to }] };
    case "sheet":
      return { kind: "sheets", sheets: [place.sheet] };
    case "body":
    case "whole":
      return null;
  }
}

/**
 * Where a part is, in the words every screen uses (`partLabel`): `pages 1–12`,
 * `sheet “Finishes”`. A row range says its rows, because the read will take
 * the whole sheet and the person choosing should see that it is a slice.
 */
export function placeLabel(place: PartPlace): string {
  if (place.kind === "sheet" && (place.fromRow != null || place.toRow != null)) {
    return `rows ${place.fromRow ?? 1}–${place.toRow ?? "end"} of sheet “${place.sheet}”`;
  }
  const part = partOfPlace(place);
  if (part) return partLabel(part);
  return place.kind === "body" ? "the email's text" : "the whole file";
}

/** One registration the press makes for a file. */
export type UploadRead = {
  /** The box value: a CHOICES value on the upload screen. */
  kind: string;
  /** What the read takes in; null for the whole file. */
  part: SourcePart | null;
  /** Which of the file's parts it covers, by index. */
  partIndexes: number[];
  /** `kind` and the canonical part, so a read is the same read on every press. */
  key: string;
};

export type ReadsOf = { blocked: true; reads: [] } | { blocked: false; reads: UploadRead[] };

/**
 * A file's parts, each with the kind its box holds ("" for unanswered,
 * `SKIP_PART` for left out), as the reads to register.
 *
 * Grouped by kind in the order each kind first appears. A read's part is the
 * union of its parts' places — and is NULL, the whole file, where every part
 * of the file is in that one read, so a file whose parts all go one way is
 * registered exactly as a single-kind file always was. A read containing a
 * part whose place is the whole file is the whole file.
 *
 * Blocked, with no reads at all, while any part is unanswered.
 */
export function readsOf(parts: { place: PartPlace; kind: string }[]): ReadsOf {
  if (parts.some((part) => !part.kind)) return { blocked: true, reads: [] };
  const groups = new Map<string, number[]>();
  parts.forEach((part, index) => {
    if (part.kind === SKIP_PART) return;
    const members = groups.get(part.kind) ?? [];
    members.push(index);
    groups.set(part.kind, members);
  });
  const reads: UploadRead[] = [];
  for (const [kind, partIndexes] of groups) {
    const everything = partIndexes.length === parts.length;
    let part: SourcePart | null = null;
    if (!everything) {
      const places = partIndexes.map((index) => partOfPlace(parts[index]!.place));
      part = places.includes(null) ? null : places.reduce<SourcePart>((acc, next) => unionParts(acc, next!), places[0]!);
    }
    reads.push({ kind, part, partIndexes, key: `${kind}|${part ? partKey(part) : "whole"}` });
  }
  return { blocked: false, reads };
}

/**
 * The request id to send NEXT time, given how the last registration with
 * `current` went. A new one where the server answered with its own refusal —
 * the same id would only be handed that first, failed attempt back — and the
 * same one where no answer of the app's arrived: the request may have landed,
 * and the replay guard is what makes sending it again safe. A gateway page
 * that is not the app's JSON (`data: null`) is no answer from the app.
 */
export function nextRequestId(
  current: string,
  last: { ok: boolean; status: number; data: unknown },
  fresh: () => string = () => crypto.randomUUID(),
): string {
  if (last.ok) return current;
  const answered = last.status !== 0 && last.data !== null && last.data !== undefined;
  return answered ? fresh() : current;
}
