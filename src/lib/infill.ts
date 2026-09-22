// Filling in what we already know, in a meeting.
//
// ============================================================================
// THE CHASE SCREEN'S LIST, WITH AN EDIT BOX WHERE THE TICK BOX IS
//
// The step between "intake reviewed" and "draft a chase" had no screen. A CAM
// remembers what the client said on the phone, the PM has the outstanding list
// in front of them, and the only way to record an answer was to open each
// record in turn. Max's shape (2026-09-18): "a page quite similar to [the
// chase screen], but instead of a tick box there's an edit box."
//
// So this is the chase screen's grouping — `groupIntoLines`, unchanged and
// shared, because two groupings is how two screens come to disagree about
// what is outstanding — and everything here is the part that is different: the
// summary a collapsed line carries, and which CONTROL each gap gets.
//
// ---- WHY A LINE ARRIVES WITHOUT ITS QUESTIONS ----------------------------
//
// Measured before any of it was designed (`npm run measure:outstanding`,
// sandbox, 2026-09-20): the 300-line project holds **19,582** outstanding
// questions, which `loadOutstanding` returns in about a second and which weigh
// **18,976 KB** as JSON. A screen that draws 407 collapsed rows does not need
// them; it needs each line's identity and its two counts. So the summary is
// computed on the server from one load, and a line's questions are re-read,
// scoped, when somebody opens it.
//
// The alternative — ship everything and group in the browser, which is what
// the chase screen does — is fine at 228 questions (DEMO-TEST-01, 214 KB) and
// is 19 MB here. That is the trap §0.2 asks to be named: not slowness, but a
// screen that never finishes loading on the only project that looks like a
// real one.
// ============================================================================
import type { OutstandingQuestion, WaitingInfo } from "@/lib/chase-drafts";
import { allQuestions, countOutstanding, groupIntoLines, type GroupableQuestion } from "@/lib/chase-grouping";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";
import { isOfferable, type Palette } from "@/lib/palettes";

export type InfillCounts = { toQuote: number; later: number; waiting: number };

/**
 * How many of a line's outstanding questions are in each state.
 *
 * Kept beside the two counts rather than inside them: the state filter has to
 * be able to narrow the LIST before a line is opened, and a line arrives
 * without its questions. `countOutstanding` is untouched, because the chase
 * screen's two numbers are its own.
 */
export type InfillStates = { missing: number; tbc: number };

export function countStates(questions: readonly { state: string }[]): InfillStates {
  let missing = 0;
  let tbc = 0;
  for (const question of questions) {
    if (question.state === "tbc") tbc += 1;
    else missing += 1;
  }
  return { missing, tbc };
}

export type InfillOptionSummary = {
  /** The finish option's own record — what an answer is written against. */
  recordId: string;
  label: string;
  /** `S-301 A`: the ref is the client's, the letter is ours. */
  name: string;
  /** The option's OWN quantity, read and never apportioned. Null is "not
   *  allocated" — a different statement from a bill line's "not given". */
  qty: number | null;
  counts: InfillCounts;
};

export type InfillLineSummary = {
  lineId: string;
  recordLabel: string;
  code: string;
  itemDescription: string;
  /** Never apportioned across finish options. The bill says 45 and stops there. */
  qty: number | null;
  runId: string;
  runName: string;
  level: string | null;
  /** The BOQ's fourth column, as the document wrote it. */
  area: string | null;
  counts: InfillCounts;
  states: InfillStates;
  /** Live finish options, INCLUDING any with nothing outstanding. */
  optionCount: number;
  options: InfillOptionSummary[];
};

/**
 * What the screen lists, from one load of the project.
 *
 * `groupIntoLines` and `countOutstanding` are the chase screen's own, called
 * here rather than reimplemented: the two screens are supposed to be the same
 * list with different controls on it, and the day they group differently is
 * the day one of them is lying about what is left.
 */
export function summariseLines<Q extends GroupableQuestion & { area?: string | null; state: string }>(
  questions: readonly Q[],
): InfillLineSummary[] {
  return groupIntoLines(questions).map((line) => {
    const everything = allQuestions(line);
    return {
      lineId: line.lineId,
      recordLabel: line.recordLabel,
      code: line.code,
      itemDescription: line.itemDescription,
      qty: line.qty,
      runId: line.runId,
      runName: line.runName,
      level: line.level,
      // The area is the RECORD'S, and every question on a line carries the
      // same one, so the first is the line's. A line with none is listed and
      // says so rather than being dropped by an area filter.
      area: everything.find((question) => question.area?.trim())?.area?.trim() ?? null,
      counts: countOutstanding(everything),
      states: countStates(everything),
      optionCount: line.optionCount,
      options: line.options.map((option) => ({
        recordId: option.recordId,
        label: option.label,
        name: option.name,
        qty: option.qty,
        counts: countOutstanding(option.questions),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// One gap, and how it is filled
// ---------------------------------------------------------------------------

/**
 * WHICH CONTROL A QUESTION GETS.
 *
 *   dimension — the composed Dimensions cell (BWS json_id 3). NOT an answer
 *     box: the cell is a PROJECTION of the record's dimension attributes, so a
 *     value typed straight into the answer is wiped by the next drawing
 *     confirm and by every later recomposition. It writes an ATTRIBUTE with a
 *     slot, through `POST /api/attributes`, and the answer follows.
 *   palette — this app holds the list, so it is offered with an Other… escape.
 *   text — everything else, including a palette BWS owns and we have never
 *     had: `AnswerValue` renders that as free text with the reason in words,
 *     which is why there is no fourth kind and no second palette control here.
 *
 * A question ALREADY TBC is not a fourth kind. TBC is a STATE a person set on
 * any of the three, and the row shows what was recorded beside the same
 * control — a `tbc` kind would mean a palette question that is TBC loses its
 * dropdown.
 */
export type InfillRowKind = "dimension" | "palette" | "text";

export function rowKind(
  question: { jsonId: number | null },
  palette: Palette | null,
): InfillRowKind {
  if (question.jsonId === DIMENSIONS_JSON_ID) return "dimension";
  if (palette && isOfferable(palette)) return "palette";
  return "text";
}

/** One dimension already on the record, for the row to show what is there. */
export type InfillDimension = { slot: string; value: string | null; unit: string | null; state: string };

export type InfillSister = { name: string; value: string };

/** One outstanding question, as the row renders and saves it. */
export type InfillQuestion = {
  recordId: string;
  requirementId: string;
  recordLabel: string;
  itemDescription: string;
  /** A, B, C … where this row belongs to a finish option. */
  variantLabel: string | null;
  area: string | null;
  prompt: string;
  fieldLabel: string | null;
  section: string | null;
  jsonId: number | null;
  localKey: string | null;
  requirementKind: "spec_field" | "readiness";
  tier: "to_quote" | "later" | null;
  state: string;
  currentValue: string | null;
  /**
   * Null where the checklist row does not exist. The record screen creates
   * them when a category is set, so this is rare — and the row REFUSES to
   * post rather than inventing one, because creating an answer needs the
   * requirement's own spec field and that is the record screen's job.
   */
  answerId: string | null;
  answerVersion: number | null;
  /** Chased and not yet answered. Shown, because a CAM may know it anyway. */
  waiting: WaitingInfo | null;
  /** Reference, never a pre-fill: the sister configurations' settled value. */
  sisters: InfillSister[];
  /** What the project's finishes library calls the code this value carries. */
  finishNote: string | null;
  /** Dimension rows only: what the record already measures, and the cell. */
  dimensions: InfillDimension[] | null;
  composed: string | null;
};

/** Totals for the header, over the same questions the lines were built from. */
export function infillTotals(questions: readonly OutstandingQuestion[], waiting: ReadonlySet<string>): {
  questions: number;
  toQuote: number;
  later: number;
  noLevel: number;
  waiting: number;
} {
  let toQuote = 0;
  let later = 0;
  let noLevel = 0;
  for (const question of questions) {
    if (question.tier === "to_quote") toQuote += 1;
    else if (question.tier === "later") later += 1;
    else noLevel += 1;
  }
  return { questions: questions.length, toQuote, later, noLevel, waiting: waiting.size };
}
