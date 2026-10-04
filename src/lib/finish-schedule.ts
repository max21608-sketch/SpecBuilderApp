// A finishes schedule, staged as a LIST OF FINISHES and read against the
// project's finishes library.
//
// ============================================================================
// THE PACK'S ORDER IS BILL → FINISHES SCHEDULE → DRAWINGS (Matthew's D1,
// 2026-10-01): "you load a finishes schedule, if there is one … that then sets
// up the list … of all the finishes that are being expected." A drawing read
// after that lands on finishes the library already holds.
//
// Until 2026-10-04 a finishes schedule was read with the generic observations
// tool, which has no field for a finish code, so the one thing the document
// exists to define could not reach the library. It is now read as ENTRIES
// (`FINISHES_SCHEDULE_TOOL`), staged here as `schemaVersion: 2` with
// `kind: "finishes_schedule"`. A run read before that is a version 1
// `StagedSpecDocument` (proposals) and keeps the old review screen; nothing is
// upgraded in place, because inventing a code an old read never carried is the
// inference this shape exists to remove.
//
// PURE. The verdict against the library is computed on READ, by the same
// function the review GET and the confirm call — the `proposalBlockers()`
// rule — because the library moves between the paid read and the review.
// ============================================================================
import type { RawFinishEntry } from "@/lib/extraction-schema";
import {
  foldFinishDescription,
  normaliseFinishCode,
  resolveFinishCode,
  type Finish,
  type FinishKind,
} from "@/lib/finishes";
import { suggestFinishKind, type FinishKindSuggestion } from "@/lib/finish-kind-guess";

export const FINISH_SCHEDULE_SCHEMA_VERSION = 2 as const;

export type FinishOtherLine = { labelRaw: string | null; valueRaw: string | null };

export type FinishScheduleEntry = {
  id: string;
  version: number;
  page: number | null;
  /** What the document printed, every one verbatim or null. */
  codeRaw: string | null;
  kindRaw: string | null;
  nameRaw: string | null;
  descriptionRaw: string | null;
  substrateRaw: string | null;
  finishRaw: string | null;
  colourRaw: string | null;
  sheenRaw: string | null;
  supplierRaw: string | null;
  referenceRaw: string | null;
  appliesToRaw: string | null;
  statusRaw: string | null;
  otherRaw: FinishOtherLine[];
  /**
   * The kind a PERSON filed, by a click. Null until then, and never written
   * by the app: the suggestion is computed and shown, not stored.
   */
  kind: FinishKind | null;
  reviewStatus: "pending" | "ignored" | "applied";
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** What the confirm did with it. `unchanged`: the library already said so. */
  applied: { outcome: "created" | "filled" | "enriched" | "unchanged"; finishId: string | null } | null;
};

export type StagedFinishSchedule = {
  schemaVersion: typeof FINISH_SCHEDULE_SCHEMA_VERSION;
  kind: "finishes_schedule";
  filename: string | null;
  documentNotes: string | null;
  entries: FinishScheduleEntry[];
};

let stagingCounter = 0;
const nextId = (): string =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `finish-entry-${Date.now()}-${(stagingCounter += 1)}`;

export function stageFinishSchedule(
  entries: RawFinishEntry[],
  filename: string | null,
  documentNotes: string | null,
  makeId: () => string = nextId,
): StagedFinishSchedule {
  return {
    schemaVersion: FINISH_SCHEDULE_SCHEMA_VERSION,
    kind: "finishes_schedule",
    filename,
    documentNotes,
    entries: entries.map((entry) => ({
      id: makeId(),
      version: 1,
      page: entry.page,
      codeRaw: entry.codeRaw,
      kindRaw: entry.kindRaw,
      nameRaw: entry.nameRaw,
      descriptionRaw: entry.descriptionRaw,
      substrateRaw: entry.substrateRaw,
      finishRaw: entry.finishRaw,
      colourRaw: entry.colourRaw,
      sheenRaw: entry.sheenRaw,
      supplierRaw: entry.supplierRaw,
      referenceRaw: entry.referenceRaw,
      appliesToRaw: entry.appliesToRaw,
      statusRaw: entry.statusRaw,
      otherRaw: entry.otherRaw.map((line) => ({ labelRaw: line.labelRaw, valueRaw: line.valueRaw })),
      kind: null,
      reviewStatus: "pending",
      reviewedAt: null,
      reviewedBy: null,
      applied: null,
    })),
  };
}

/** A version 2 schedule. False for a version 1 proposals document, which keeps its old screen. */
export function isStagedFinishSchedule(parsed: unknown): parsed is StagedFinishSchedule {
  const doc = parsed as Partial<StagedFinishSchedule> | null;
  return Boolean(
    doc &&
      typeof doc === "object" &&
      doc.kind === "finishes_schedule" &&
      doc.schemaVersion === FINISH_SCHEDULE_SCHEMA_VERSION &&
      Array.isArray(doc.entries),
  );
}

/**
 * Staged JSON is data from the past, so a field a later version adds is read
 * defensively here rather than trusted — the `assertStagedDrawings` lesson.
 */
export function assertStagedFinishSchedule(parsed: unknown): StagedFinishSchedule {
  if (!isStagedFinishSchedule(parsed)) {
    throw new Error("This document was not staged as a finishes schedule. Read it again.");
  }
  return {
    ...parsed,
    entries: parsed.entries.map((entry) => ({
      ...entry,
      otherRaw: Array.isArray(entry.otherRaw) ? entry.otherRaw : [],
      kind: entry.kind ?? null,
      applied: entry.applied ?? null,
    })),
  };
}

// ============================================================================
// THE CODE THE LIBRARY FILES IT UNDER.
//
// The schedule prints its codes as THREE STACKED BOXES — `AB` over `TIM` over
// `01` — which a reader transcribes `AB TIM 01` (invented codes, the real
// shape). The same document's own prose writes the finish `AB-TIM-01` ("To
// match AB-TIM-01", "to match TIM-02.1"),
// the bill writes `GR-FAB-04`, and the drawings path already reads a stacked
// tag into the hyphenated form (`stackedTagCode` in material-words.ts). Filed
// verbatim, the schedule's `AB TIM 01` and a drawing's `AB-TIM-01` would be two
// library rows for one timber — and `normaliseFinishCode` is right not to
// merge them, because a hyphen is not whitespace.
//
// So the stacked shape, and ONLY that shape, is written hyphenated, and
// `codeRaw` keeps what the page printed; the screen shows both. It is wider
// than `stackedTagCode` in one respect, and deliberately: the schedule carries
// sub-codes (`AB TIM 02.1`) and writes them hyphenated itself (`TIM-02.1`).
// The drawings' fold is NOT widened from here — that would re-read every pack
// already staged — and the difference is reported, not hidden.
//
// Anything that is not three groups separated by whitespace and nothing else
// (`CH-01.1`, `WD-05`, `AB TIM 01 walnut`) is filed exactly as printed.
// ============================================================================
const STACKED_SCHEDULE_CODE = /^\s*([A-Za-z]{2,4})\s+([A-Za-z]{2,4})\s+(\d{1,4}(?:\.\d{1,3})?[A-Za-z]?)\s*$/;

export function scheduleCode(codeRaw: string | null | undefined): string | null {
  const raw = codeRaw?.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const stacked = STACKED_SCHEDULE_CODE.exec(raw);
  if (stacked) return `${stacked[1]}-${stacked[2]}-${stacked[3]}`.toUpperCase();
  return raw;
}

// ============================================================================
// WHAT THE LIBRARY ROW WOULD SAY.
//
// The entry's own words, never rephrased. Substrate, finish, colour and sheen
// are each kept APART, labelled, in the description — prose, not new columns:
// separate columns wait for Matthew's TGQ answer and Claudia's sheets.
//
// ONE LINE, "; " between the parts — NOT a line each, which is what the brief
// asked for. `composeFinishCell` renders the description into the BWS export,
// the quote and the costing sheet, and a newline inside a BWS cell is a
// file-format change to the file that overwrites rather than fails (the
// `EXPORT_QUALIFIER_MODE` rule, which a test pins). A label per part keeps them
// apart just as well.
//
// `colour` is NOT written to the library's own colour column: the composer
// appends that column to the cell, so the colour would print twice.
// Provenance — the page, where it is used, its status, every other labelled
// line — goes in `notes`, which no export reads.
// ============================================================================
const clean = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
};

export type ComposedScheduleFinish = {
  description: string | null;
  supplierRaw: string | null;
  reference: string | null;
  notes: string | null;
};

export function composeScheduleFinish(
  entry: Pick<
    FinishScheduleEntry,
    | "nameRaw"
    | "descriptionRaw"
    | "substrateRaw"
    | "finishRaw"
    | "colourRaw"
    | "sheenRaw"
    | "supplierRaw"
    | "referenceRaw"
    | "appliesToRaw"
    | "statusRaw"
    | "otherRaw"
    | "page"
  >,
  filename: string | null = null,
): ComposedScheduleFinish {
  const head = [clean(entry.nameRaw), clean(entry.descriptionRaw)].filter((part): part is string => part !== null);
  const labelled = (
    [
      ["Substrate", entry.substrateRaw],
      ["Finish", entry.finishRaw],
      ["Colour", entry.colourRaw],
      ["Sheen", entry.sheenRaw],
    ] as const
  )
    .map(([label, value]) => {
      const text = clean(value);
      return text ? `${label}: ${text}` : null;
    })
    .filter((part): part is string => part !== null);
  const descriptionParts = [...(head.length > 0 ? [head.join(", ")] : []), ...labelled];

  const source = filename ? `From ${filename}${entry.page ? `, page ${entry.page}` : ""}` : entry.page ? `Page ${entry.page}` : null;
  const other = (entry.otherRaw ?? [])
    .map((line) => {
      const value = clean(line.valueRaw);
      if (!value) return null;
      const label = clean(line.labelRaw);
      return label ? `${label}: ${value}` : value;
    })
    .filter((part): part is string => part !== null);
  const notesParts = [
    source,
    clean(entry.appliesToRaw) ? `Used for: ${clean(entry.appliesToRaw)}` : null,
    clean(entry.statusRaw) ? `Status: ${clean(entry.statusRaw)}` : null,
    ...other,
  ].filter((part): part is string => part !== null);

  return {
    description: descriptionParts.length > 0 ? descriptionParts.join("; ") : null,
    supplierRaw: clean(entry.supplierRaw),
    reference: clean(entry.referenceRaw),
    notes: notesParts.length > 0 ? notesParts.join("; ") : null,
  };
}

// ============================================================================
// THE KIND IS SUGGESTED AND FILED BY A CLICK — the library's own rule.
//
// The schedule's own word for the section ("TIMBER") is read FIRST, through
// `suggestFinishKind` and nothing else, so the evidence a person sees is the
// document filing it. Only where it says nothing are the entry's own material
// words read — after the section word, because a timber described as having a
// "water-based lacquer" finish would otherwise read as a paint.
// ============================================================================
export function suggestEntryKind(
  entry: Pick<FinishScheduleEntry, "kindRaw" | "nameRaw" | "descriptionRaw">,
  code: string | null,
): FinishKindSuggestion | null {
  const section = clean(entry.kindRaw);
  if (section) {
    const bySection = suggestFinishKind({ code: "", description: section });
    if (bySection) return { kind: bySection.kind, reason: `the schedule files it under “${section}”` };
  }
  const words = [clean(entry.nameRaw), clean(entry.descriptionRaw)].filter(Boolean).join(" ");
  return suggestFinishKind({ code: code ?? "", description: words || null });
}

// ============================================================================
// THE VERDICT, PER ENTRY, AGAINST THE LIVE LIBRARY.
//
//   new        — the library does not hold the code. The confirm creates it.
//   fills      — the library holds the code with NO description yet (a drawing
//                or a pasted list named it and nobody described it). The
//                confirm fills the EMPTY fields only — the edit-once rule.
//   agrees     — the library holds the code and already says this. Nothing to
//                write; ticking it closes the entry.
//   enriches   — the library holds the code, still TBC, and its description
//                is CONTAINED in the schedule's (folded by case and whitespace
//                and nothing else): a bill wrote "Antique Bronze", the
//                schedule says "ANTIQUE BRONZE; Finish: Antique". The detailed
//                source is taken whole — Max, 2026-10-04: the finishes library
//                comes first and a detailed source should be taken in whole.
//                The confirm REPLACES the description. A CONFIRMED row never
//                reaches this verdict: a person decided it, so a difference
//                there stays a conflict.
//   conflict   — the library holds the code and has COMMITTED to a different
//                description. Nothing is written; a person decides which is
//                out of date. The drawings' CONFLICT rule, unchanged.
//   repeated   — an earlier entry in this document still waiting carries the
//                same code. Only the first is filed.
//   no_code    — nothing to key a library row on. Listed, never filed.
// ============================================================================
export type LibraryFinish = Finish & { version: number; notes: string | null };

export type FillField = "description" | "supplier" | "reference" | "notes" | "kind";

export type ScheduleVerdict =
  | { status: "no_code" }
  | { status: "new"; code: string; codeNorm: string }
  | { status: "repeated"; code: string; firstEntryId: string }
  | { status: "fills"; code: string; finish: LibraryFinish; fills: FillField[] }
  | { status: "agrees"; code: string; finish: LibraryFinish }
  | { status: "enriches"; code: string; finish: LibraryFinish; saysInstead: string }
  | { status: "conflict"; code: string; finish: LibraryFinish; saysInstead: string };

export const VERDICT_LABELS: Record<ScheduleVerdict["status"], string> = {
  new: "new",
  fills: "already held, no description yet",
  agrees: "already held and agreeing",
  enriches: "agrees and adds detail",
  conflict: "already held and DIFFERENT",
  repeated: "repeated in this document",
  no_code: "no code",
};

/** Whether the confirm writes nothing for it, and the entry therefore stays for a person. */
export function verdictIsSkipped(verdict: ScheduleVerdict): boolean {
  return verdict.status === "conflict" || verdict.status === "repeated" || verdict.status === "no_code";
}

function fillsFor(finish: LibraryFinish, composed: ComposedScheduleFinish, kind: FinishKind | null): FillField[] {
  const empty = (value: string | null | undefined) => !value?.trim();
  const fills: FillField[] = [];
  if (empty(finish.description) && composed.description) fills.push("description");
  if (empty(finish.supplierRaw) && composed.supplierRaw) fills.push("supplier");
  if (empty(finish.reference) && composed.reference) fills.push("reference");
  if (empty(finish.notes) && composed.notes) fills.push("notes");
  if (!finish.kind && kind) fills.push("kind");
  return fills;
}

/**
 * Whether the schedule's description is the held one with more said: the
 * held row is still TBC and its words, folded by case and whitespace ONLY,
 * appear whole inside the schedule's. No other fuzziness — `normaliseFinishCode`'s
 * rule applied to a description, because a looser fold is how two different
 * finishes come to read as one.
 */
export function addsDetail(finish: Pick<LibraryFinish, "state" | "description">, says: string): boolean {
  if (finish.state === "confirmed") return false;
  const held = foldFinishDescription(finish.description ?? "");
  if (!held) return false;
  return foldFinishDescription(says).includes(held);
}

export type ScheduleReviewRow = {
  entryId: string;
  /** The code the library files it under, or null. */
  code: string | null;
  composed: ComposedScheduleFinish;
  /** Null for an entry already applied or ignored. */
  verdict: ScheduleVerdict | null;
  suggestion: FinishKindSuggestion | null;
};

/**
 * Every entry's reading, in document order. Called by the review GET and by
 * the confirm, so the screen and the write cannot disagree.
 */
export function reviewFinishSchedule(staged: StagedFinishSchedule, library: readonly LibraryFinish[]): ScheduleReviewRow[] {
  const firstPending = new Map<string, string>();
  return staged.entries.map((entry) => {
    const code = scheduleCode(entry.codeRaw);
    const composed = composeScheduleFinish(entry, staged.filename);
    const suggestion = entry.kind ? null : suggestEntryKind(entry, code);
    if (entry.reviewStatus !== "pending") return { entryId: entry.id, code, composed, verdict: null, suggestion };
    if (!code) return { entryId: entry.id, code, composed, verdict: { status: "no_code" }, suggestion };

    const codeNorm = normaliseFinishCode(code);
    const earlier = firstPending.get(codeNorm);
    if (earlier) {
      return { entryId: entry.id, code, composed, verdict: { status: "repeated", code, firstEntryId: earlier }, suggestion };
    }
    firstPending.set(codeNorm, entry.id);

    const resolution = resolveFinishCode(code, composed.description, [...library]);
    let verdict: ScheduleVerdict;
    if (resolution.status === "new") verdict = { status: "new", code, codeNorm };
    else if (resolution.status === "conflict") {
      const finish = resolution.finish as LibraryFinish;
      verdict = addsDetail(finish, resolution.saysInstead)
        ? { status: "enriches", code, finish, saysInstead: resolution.saysInstead }
        : { status: "conflict", code, finish, saysInstead: resolution.saysInstead };
    } else if (resolution.status === "matched") {
      const finish = resolution.finish as LibraryFinish;
      const fills = fillsFor(finish, composed, entry.kind);
      verdict = finish.description?.trim() || fills.length === 0 ? { status: "agrees", code, finish } : { status: "fills", code, finish, fills };
    } else {
      verdict = { status: "no_code" };
    }
    return { entryId: entry.id, code, composed, verdict, suggestion };
  });
}

export function hasPendingEntries(doc: StagedFinishSchedule): boolean {
  return doc.entries.some((entry) => entry.reviewStatus === "pending");
}
