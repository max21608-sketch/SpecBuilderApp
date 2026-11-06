// Matching a revised bill against the run it revises.
//
// ============================================================================
// THIS RUNS AT REVIEW TIME, AND ITS OUTPUT IS A SUGGESTION.
//
// house/data-safety.md and confirm-boq.ts both say the confirm route re-runs
// no matching: what gets written is what the reviewer approved, because a
// fresh match at confirm time could pair a line with a record they never saw.
// Pairing a revised line to an existing record IS matching, so it happens
// here, the reviewer edits it, and their decision is stored on the staged line
// as `replaces`. The confirm reads that and nothing else.
//
// ---- ONE-TO-ONE ONLY -----------------------------------------------------
//
// A code that appears twice on either side pairs NOTHING. The pilot BOQ
// contains SX11A twice with different quantities, which is the case the whole
// record model exists for — and there is no rule that says which of two
// revised SX11A lines continues which of two existing SX11A records. Guessing
// would move a drawing onto the wrong item, silently, and nothing downstream
// would ever question it. So both sides are offered as candidates and a person
// decides.
//
// ---- A CODELESS LINE PAIRS NOTHING --------------------------------------
//
// The BOQ's code is the client ref and the only identity a line carries. A
// line with none ("Bench @ entrance") can only be new, and the record it might
// have continued can only be missing. The reviewer can still pair them by
// hand; this function will not.
//
// ---- AREA HAS TO BE DERIVED THE WAY THE CONFIRM WRITES IT ---------------
//
// confirm-boq.ts writes `effectiveArea(line)` into spec_records.area — the
// area, with a Sub-Area composed in where the bill has one, else the bill's
// category.
// Comparing the staged line's `area` against the stored one without that
// fallback reports a phantom change on every line whose bill left Area blank —
// which on the pilot is most of them.
// ============================================================================
// ---- ONE FOLD, THE MATCHING ONE -----------------------------------------
//
// `record-refs`' fold, which is the one `findRecordsByRef`, `groupItemsByCode`
// and `variantLettersByItem` all match by — NOT `boq-import`'s, which exists
// for the stored `ref_value_norm` column and keeps dots and dashes.
//
// It used to be `boq-import`'s, and the two disagree: `S 201` folded to
// `S201` while `S.201` stayed `S.201`, so a revised bill writing a code with
// a dot where the record holds a dash read as a NEW line beside a record NO
// LONGER LISTED — and confirming that retires the record, taking its
// drawings, its specs and its picture off the phase, silently. Variance
// matrix row 4: the same fold everywhere a code is matched.
//
// The looser fold collides more often. That is the safe direction and it is
// the fold's own argument: a collision it creates produces AMBIGUITY — both
// sides offered as candidates, nothing chosen — never a wrong pick.
//
// ---- A CONFIGURATION IS NEVER A CANDIDATE, AND A RETIRED LINE IS OFFERED --
//
// (audit 2026-11-06, 1.2.) A configuration (`parent_id` set, `S-301 TYPE 2`)
// carries no bill code of its own (0024), so no line can ever pair with it.
// Listed here, every one read as "no longer listed", and the confirm retired
// all five of S-301's: the bare bill line went back into the export in their
// place and a BWS import then wiped the five jobs. So the loader passes bill
// lines only, and each carries the SHORT LABELS of its live configurations,
// which follow it either way: carried when it is paired, retired when it is.
//
// A record an earlier revision RETIRED, whose code a later revision prints
// again, used to become a new record beside it, while the old one kept its
// drawings and specs out of sight. It is offered as `restoreCandidates`, and
// only offered: the reviewer's choice is stored on the line as `replaces`
// with `restore: true` (the same staged shape as a pairing), and two retired
// records on one code are both offered and neither chosen — SX11A again.
import { normaliseRef } from "@/lib/record-refs";
import { composeBoqArea } from "@/lib/boq-roles";

export type ExistingRecord = {
  id: string;
  version: number;
  recordNo: number;
  label: string;
  itemDescription: string;
  productReference: string | null;
  qty: number | null;
  designer: string | null;
  area: string | null;
  boqCategory: string | null;
  codes: string[];
  /** What would be lost if this record were retired rather than paired. */
  attributeCount: number;
  hasImage: boolean;
  settledAnswers: number;
  /**
   * The short labels of the record's LIVE configurations (`12.1`), in order.
   * They follow it: carried with it, or retired with it. Absent reads as none.
   */
  configurations?: string[];
};

/**
 * The record a line continues, at the version the reviewer was shown.
 * `restore` marks a record an earlier revision retired, brought back by this
 * line; without it the record must be live.
 */
export type LinePairing = { recordId: string; recordVersion: number; restore?: boolean };

export type RevisedLine = {
  index: number;
  lineNo: number;
  code: string | null;
  itemDescription: string;
  productReference: string | null;
  qty: number | null;
  designer: string | null;
  area: string | null;
  /** Present where the bill has a Sub-Area column; composed into the area. */
  subArea?: string | null;
  boqCategory: string | null;
  ignored: boolean;
  replaces: LinePairing | null;
};

export type FieldDelta = { field: string; label: string; was: string | null; now: string | null };

export type LineReconciliation = {
  index: number;
  lineNo: number;
  code: string | null;
  /**
   * `paired` — continues an existing record, either suggested or chosen.
   * `new` — nothing to continue.
   * `ambiguous` — the code matches more than one record, or more than one
   *   line carries it. Candidates offered; nothing chosen.
   * `restore` — the reviewer chose to bring back a record an earlier revision
   *   retired. Only ever the reviewer's choice.
   */
  status: "paired" | "new" | "ambiguous" | "restore";
  /**
   * True where the pairing (or restore) is the reviewer's STORED `replaces`.
   * A `paired` line that is not accepted is a suggestion: the confirm writes
   * only what is stored, so until somebody accepts it the line is a new item
   * and its record is retired. Shown as a suggestion, never as chosen.
   */
  accepted: boolean;
  suggestedRecordId: string | null;
  candidates: string[];
  /**
   * On a `new` line: the RETIRED records of this phase carrying its code,
   * offered to bring back. Never chosen here, however many there are.
   */
  restoreCandidates: string[];
  deltas: FieldDelta[];
};

export type MissingRecord = {
  recordId: string;
  label: string;
  itemDescription: string;
  codes: string[];
  /** What retiring it would take out of the live set. Named, never just counted. */
  attributeCount: number;
  hasImage: boolean;
  settledAnswers: number;
  /** The configurations retired with it, by short label. */
  configurations: string[];
  /**
   * The line a SUGGESTED pairing offers this record to, where one does. It is
   * still retired unless that suggestion is accepted, so it stays listed.
   */
  suggestedFor?: number;
};

export type SheetReconciliation = {
  lines: LineReconciliation[];
  missing: MissingRecord[];
  /**
   * `missing` counts records no line names at all; `suggested`, pairings
   * offered and not yet accepted (whose records are in `missing` too, with
   * `suggestedFor`, because the confirm retires them until accepted).
   */
  counts: {
    paired: number;
    changed: number;
    new: number;
    ambiguous: number;
    missing: number;
    restored: number;
    suggested: number;
  };
};

/**
 * A line's configurations in a few characters: `12.1–12.5` for a run of
 * three or more consecutive ones under one line, otherwise a list
 * (`12.1 and 12.3`). The labels are `recordShortLabel`'s, in order.
 */
export function configurationRange(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  const parts = labels.map((label) => /^(\d+)\.(\d+)$/.exec(label));
  const consecutive =
    labels.length >= 3 &&
    parts.every((part) => part !== null && part[1] === parts[0]?.[1]) &&
    parts.every((part, i) => i === 0 || Number(part?.[2]) === Number(parts[i - 1]?.[2]) + 1);
  if (consecutive) return `${labels[0]}–${labels[labels.length - 1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function show(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * The value confirm-boq writes into spec_records.area — and the confirm now
 * CALLS this, rather than repeating it, so a revision can never compare against
 * a value the confirm did not write.
 *
 * A Sub-Area composes in (`composeBoqArea`, `Guest Suites / Corridor`): a
 * revision of the same bill composes the same string and reads as unchanged.
 * A line from a bill with no Sub-Area column carries none, and reads exactly
 * as it always did.
 */
export function effectiveArea(line: {
  area: string | null;
  boqCategory: string | null;
  subArea?: string | null;
}): string | null {
  return composeBoqArea(line.area, line.subArea) ?? line.boqCategory ?? null;
}

export function lineDeltas(line: RevisedLine, record: ExistingRecord): FieldDelta[] {
  const pairs: { field: string; label: string; was: unknown; now: unknown }[] = [
    { field: "itemDescription", label: "Item", was: record.itemDescription, now: line.itemDescription },
    { field: "qty", label: "Quantity", was: record.qty, now: line.qty },
    { field: "productReference", label: "Product reference", was: record.productReference, now: line.productReference },
    { field: "designer", label: "Designer", was: record.designer, now: line.designer },
    { field: "area", label: "Area", was: record.area, now: effectiveArea(line) },
    { field: "boqCategory", label: "BOQ category", was: record.boqCategory, now: line.boqCategory },
  ];
  return pairs
    .map(({ field, label, was, now }) => {
      const a = show(was);
      const b = show(now);
      return a === b ? null : { field, label, was: a, now: b };
    })
    .filter((delta): delta is FieldDelta => delta !== null);
}

/**
 * How a revised sheet lines up against the run it revises.
 *
 * Pure. The reviewer's own `replaces` decisions win over any suggestion — a
 * line they have paired by hand is `paired` even where the code is ambiguous,
 * which is the whole point of offering candidates.
 */
export function reconcileSheet(
  lines: RevisedLine[],
  records: ExistingRecord[],
  /** The phase's bill lines an earlier revision retired: offered back, never chosen. */
  retired: ExistingRecord[] = [],
): SheetReconciliation {
  const live = lines.filter((line) => !line.ignored);

  // Codes on each side, folded the way every other matcher in the app folds
  // one — see the note on the import above.
  const byCode = (list: ExistingRecord[]) => {
    const map = new Map<string, ExistingRecord[]>();
    for (const record of list) {
      for (const key of new Set(record.codes.map(normaliseRef))) {
        if (!key) continue;
        map.set(key, [...(map.get(key) ?? []), record]);
      }
    }
    return map;
  };
  const recordsByCode = byCode(records);
  const retiredByCode = byCode(retired);
  const retiredById = new Map(retired.map((record) => [record.id, record]));
  const lineCountByCode = new Map<string, number>();
  for (const line of live) {
    const key = line.code ? normaliseRef(line.code) : "";
    if (!key) continue;
    lineCountByCode.set(key, (lineCountByCode.get(key) ?? 0) + 1);
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  /** Records a reviewer's stored pairing claims: these are carried forward. */
  const claimed = new Set<string>();
  /** Records a suggestion offers, by line: carried only once accepted. */
  const suggestedFor = new Map<string, number>();
  const out: LineReconciliation[] = [];

  for (const line of live) {
    // The reviewer's own decision to bring a retired record back.
    if (line.replaces?.restore) {
      const record = retiredById.get(line.replaces.recordId);
      out.push({
        index: line.index,
        lineNo: line.lineNo,
        code: line.code,
        status: "restore",
        accepted: true,
        suggestedRecordId: line.replaces.recordId,
        candidates: [],
        restoreCandidates: [],
        deltas: record ? lineDeltas(line, record) : [],
      });
      continue;
    }
    // The reviewer's own decision, first and unconditionally.
    if (line.replaces) {
      const record = byId.get(line.replaces.recordId);
      claimed.add(line.replaces.recordId);
      out.push({
        index: line.index,
        lineNo: line.lineNo,
        code: line.code,
        status: "paired",
        accepted: true,
        suggestedRecordId: line.replaces.recordId,
        candidates: [],
        restoreCandidates: [],
        deltas: record ? lineDeltas(line, record) : [],
      });
      continue;
    }

    const key = line.code ? normaliseRef(line.code) : "";
    const matches = key ? (recordsByCode.get(key) ?? []) : [];
    const linesWithCode = key ? (lineCountByCode.get(key) ?? 0) : 0;

    if (matches.length === 1 && linesWithCode === 1) {
      const record = matches[0] as ExistingRecord;
      suggestedFor.set(record.id, line.lineNo);
      out.push({
        index: line.index,
        lineNo: line.lineNo,
        code: line.code,
        status: "paired",
        accepted: false,
        suggestedRecordId: record.id,
        candidates: [],
        restoreCandidates: [],
        deltas: lineDeltas(line, record),
      });
      continue;
    }

    if (matches.length > 1 || (matches.length === 1 && linesWithCode > 1)) {
      // The SX11A case. Candidates, nothing chosen.
      out.push({
        index: line.index,
        lineNo: line.lineNo,
        code: line.code,
        status: "ambiguous",
        accepted: false,
        suggestedRecordId: null,
        candidates: matches.map((record) => record.id),
        restoreCandidates: [],
        deltas: [],
      });
      continue;
    }

    out.push({
      index: line.index,
      lineNo: line.lineNo,
      code: line.code,
      status: "new",
      accepted: false,
      suggestedRecordId: null,
      candidates: [],
      restoreCandidates: key ? (retiredByCode.get(key) ?? []).map((record) => record.id) : [],
      deltas: [],
    });
  }

  const missing: MissingRecord[] = records
    .filter((record) => !claimed.has(record.id))
    .map((record) => ({
      recordId: record.id,
      label: record.label,
      itemDescription: record.itemDescription,
      codes: record.codes,
      attributeCount: record.attributeCount,
      hasImage: record.hasImage,
      settledAnswers: record.settledAnswers,
      configurations: record.configurations ?? [],
      ...(suggestedFor.has(record.id) ? { suggestedFor: suggestedFor.get(record.id) } : {}),
    }));

  return {
    lines: out,
    missing,
    counts: {
      paired: out.filter((line) => line.status === "paired").length,
      changed: out.filter((line) => line.status === "paired" && line.deltas.length > 0).length,
      new: out.filter((line) => line.status === "new").length,
      ambiguous: out.filter((line) => line.status === "ambiguous").length,
      missing: missing.filter((record) => record.suggestedFor === undefined).length,
      restored: out.filter((line) => line.status === "restore").length,
      suggested: out.filter((line) => line.status === "paired" && !line.accepted).length,
    },
  };
}
