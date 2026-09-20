// What is outstanding on a project, counted once.
//
// ============================================================================
// WHY THIS IS A FUNCTION AND NOT A QUERY
//
// Four things print the to-quote figure — the phase table, the chase button,
// the project overview's tiles and (from 2.3) the infill screen — and the day
// any two of them disagree is the day nobody believes either. The rule that
// decides it is `questionTier`, which is TypeScript and not SQL, so the only
// way to measure it is to run the loader the screens run and count what comes
// back.
//
// That is what `npm run measure:outstanding` does. This file is the counting
// half: pure, so the aggregation has a test that needs no database, and the
// tool is left holding nothing but I/O and printing.
//
// IT COMPUTES NO TIER OF ITS OWN. `tier` arrives already decided on every
// `OutstandingQuestion`; a second reading here would be the fifth opinion
// rather than the measurement of the four.
// ============================================================================
import type { OutstandingQuestion } from "@/lib/chase-drafts";

/** What the aggregation needs. Structural, so a test fixture need not be a full row. */
export type MeasurableQuestion = Pick<
  OutstandingQuestion,
  | "recordId"
  | "recordLabel"
  | "itemDescription"
  | "categoryId"
  | "requirementId"
  | "requirementKind"
  | "prompt"
  | "fieldLabel"
  | "state"
  | "tier"
  | "level"
  | "parentId"
  | "area"
>;

export type RecordTally = {
  recordId: string;
  recordLabel: string;
  itemDescription: string;
  toQuote: number;
  later: number;
  noTier: number;
  total: number;
};

export type QuestionTally = {
  requirementId: string;
  prompt: string;
  fieldLabel: string | null;
  toQuote: number;
  /** How many RECORDS still owe this question an answer. */
  records: number;
  total: number;
};

export type OutstandingMeasurement = {
  questions: number;
  specField: number;
  readiness: number;
  missing: number;
  tbc: number;
  toQuote: number;
  later: number;
  /** Questions on a record with no level, which therefore have no tier at all. */
  noTier: number;
  /**
   * The to-quote figure split by WHICH model answered it. Matthew's matrix
   * where he wrote one for the category, 0019's seeded placeholder where he
   * did not — and the placeholder still says everything blocks a quote, so a
   * project weighted towards it is reporting a ceiling rather than a figure.
   */
  toQuoteFromMatrix: number;
  toQuoteFromFallback: number;
  recordsOnMatrix: number;
  recordsOnFallback: number;
  /** Records carrying at least one outstanding question. */
  records: number;
  /** Bill lines, counting a finish option under its parent — the chase screen's unit. */
  lines: number;
  /** Distinct areas the outstanding work sits in, plus how many rows have none. */
  areas: number;
  questionsWithNoArea: number;
  byRecord: RecordTally[];
  byQuestion: QuestionTally[];
};

/**
 * Count one project's outstanding questions.
 *
 * `matrixCategoryIds` is the key set of `loadTgqMatrices` — the categories
 * Matthew's matrix covers. Absence from it is the discriminator, exactly as it
 * is in `loadOutstanding`: a category he has never written falls back to
 * 0019's seed, and reporting the two together would hide that half the figure
 * is a placeholder.
 */
export function measureOutstanding(
  questions: readonly MeasurableQuestion[],
  matrixCategoryIds: ReadonlySet<string>,
): OutstandingMeasurement {
  const byRecord = new Map<string, RecordTally>();
  const byQuestion = new Map<string, QuestionTally & { recordIds: Set<string> }>();
  const lines = new Set<string>();
  const areas = new Set<string>();
  const recordsOnMatrix = new Set<string>();
  const recordsOnFallback = new Set<string>();

  let specField = 0;
  let readiness = 0;
  let missing = 0;
  let tbc = 0;
  let toQuote = 0;
  let later = 0;
  let noTier = 0;
  let toQuoteFromMatrix = 0;
  let toQuoteFromFallback = 0;
  let questionsWithNoArea = 0;

  for (const question of questions) {
    if (question.requirementKind === "readiness") readiness += 1;
    else specField += 1;
    if (question.state === "missing") missing += 1;
    if (question.state === "tbc") tbc += 1;

    const onMatrix = question.categoryId !== null && matrixCategoryIds.has(question.categoryId);
    if (onMatrix) recordsOnMatrix.add(question.recordId);
    else recordsOnFallback.add(question.recordId);

    if (question.tier === "to_quote") {
      toQuote += 1;
      if (onMatrix) toQuoteFromMatrix += 1;
      else toQuoteFromFallback += 1;
    } else if (question.tier === "later") later += 1;
    else noTier += 1;

    // The chase screen's unit: a finish option belongs to its parent's line.
    lines.add(question.parentId ?? question.recordId);
    const area = question.area?.trim();
    if (area) areas.add(area);
    else questionsWithNoArea += 1;

    const record = byRecord.get(question.recordId) ?? {
      recordId: question.recordId,
      recordLabel: question.recordLabel,
      itemDescription: question.itemDescription,
      toQuote: 0,
      later: 0,
      noTier: 0,
      total: 0,
    };
    record.total += 1;
    if (question.tier === "to_quote") record.toQuote += 1;
    else if (question.tier === "later") record.later += 1;
    else record.noTier += 1;
    byRecord.set(question.recordId, record);

    const tally = byQuestion.get(question.requirementId) ?? {
      requirementId: question.requirementId,
      prompt: question.prompt,
      fieldLabel: question.fieldLabel,
      toQuote: 0,
      records: 0,
      total: 0,
      recordIds: new Set<string>(),
    };
    tally.total += 1;
    if (question.tier === "to_quote") tally.toQuote += 1;
    tally.recordIds.add(question.recordId);
    byQuestion.set(question.requirementId, tally);
  }

  return {
    questions: questions.length,
    specField,
    readiness,
    missing,
    tbc,
    toQuote,
    later,
    noTier,
    toQuoteFromMatrix,
    toQuoteFromFallback,
    recordsOnMatrix: recordsOnMatrix.size,
    recordsOnFallback: recordsOnFallback.size,
    records: byRecord.size,
    lines: lines.size,
    areas: areas.size,
    questionsWithNoArea,
    // Worst first, then by label, so two runs over the same data print the
    // same order — a report whose rows move is a report nobody can diff.
    byRecord: [...byRecord.values()].sort(
      (a, b) => b.toQuote - a.toQuote || b.total - a.total || a.recordLabel.localeCompare(b.recordLabel),
    ),
    byQuestion: [...byQuestion.values()]
      .map(({ recordIds, ...rest }) => ({ ...rest, records: recordIds.size }))
      .sort((a, b) => b.toQuote - a.toQuote || b.total - a.total || a.prompt.localeCompare(b.prompt)),
  };
}
