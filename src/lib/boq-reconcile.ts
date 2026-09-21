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
// confirm-boq.ts writes `line.area ?? line.boqCategory` into spec_records.area.
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
import { normaliseRef } from "@/lib/record-refs";

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
};

export type RevisedLine = {
  index: number;
  lineNo: number;
  code: string | null;
  itemDescription: string;
  productReference: string | null;
  qty: number | null;
  designer: string | null;
  area: string | null;
  boqCategory: string | null;
  ignored: boolean;
  replaces: { recordId: string; recordVersion: number } | null;
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
   */
  status: "paired" | "new" | "ambiguous";
  suggestedRecordId: string | null;
  candidates: string[];
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
};

export type SheetReconciliation = {
  lines: LineReconciliation[];
  missing: MissingRecord[];
  counts: { paired: number; changed: number; new: number; ambiguous: number; missing: number };
};

function show(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** The value confirm-boq writes into spec_records.area. */
export function effectiveArea(line: { area: string | null; boqCategory: string | null }): string | null {
  return line.area ?? line.boqCategory ?? null;
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
export function reconcileSheet(lines: RevisedLine[], records: ExistingRecord[]): SheetReconciliation {
  const live = lines.filter((line) => !line.ignored);

  // Codes on each side, folded the way every other matcher in the app folds
  // one — see the note on the import above.
  const recordsByCode = new Map<string, ExistingRecord[]>();
  for (const record of records) {
    for (const code of record.codes) {
      const key = normaliseRef(code);
      if (!key) continue;
      recordsByCode.set(key, [...(recordsByCode.get(key) ?? []), record]);
    }
  }
  const lineCountByCode = new Map<string, number>();
  for (const line of live) {
    const key = line.code ? normaliseRef(line.code) : "";
    if (!key) continue;
    lineCountByCode.set(key, (lineCountByCode.get(key) ?? 0) + 1);
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  const claimed = new Set<string>();
  const out: LineReconciliation[] = [];

  for (const line of live) {
    // The reviewer's own decision, first and unconditionally.
    if (line.replaces) {
      const record = byId.get(line.replaces.recordId);
      claimed.add(line.replaces.recordId);
      out.push({
        index: line.index,
        lineNo: line.lineNo,
        code: line.code,
        status: "paired",
        suggestedRecordId: line.replaces.recordId,
        candidates: [],
        deltas: record ? lineDeltas(line, record) : [],
      });
      continue;
    }

    const key = line.code ? normaliseRef(line.code) : "";
    const matches = key ? (recordsByCode.get(key) ?? []) : [];
    const linesWithCode = key ? (lineCountByCode.get(key) ?? 0) : 0;

    if (matches.length === 1 && linesWithCode === 1) {
      const record = matches[0] as ExistingRecord;
      claimed.add(record.id);
      out.push({
        index: line.index,
        lineNo: line.lineNo,
        code: line.code,
        status: "paired",
        suggestedRecordId: record.id,
        candidates: [],
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
        suggestedRecordId: null,
        candidates: matches.map((record) => record.id),
        deltas: [],
      });
      continue;
    }

    out.push({
      index: line.index,
      lineNo: line.lineNo,
      code: line.code,
      status: "new",
      suggestedRecordId: null,
      candidates: [],
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
    }));

  return {
    lines: out,
    missing,
    counts: {
      paired: out.filter((line) => line.status === "paired").length,
      changed: out.filter((line) => line.status === "paired" && line.deltas.length > 0).length,
      new: out.filter((line) => line.status === "new").length,
      ambiguous: out.filter((line) => line.status === "ambiguous").length,
      missing: missing.length,
    },
  };
}
