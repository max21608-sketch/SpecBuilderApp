// Which rows one fanned-out answer touches — the project card and the area
// card (`project-wide.ts`), the route and the screen, ONE decision.
//
// Pure and free of the database, so the card imports the very function the
// write runs (`planProjectWide`) instead of a copy of it: the card used to
// re-implement the rule in its own loop, which is how the two would drift.
//
// ---- A SPEC ON THE ITEM IS A SETTLED ANSWER (chase review C1, 2026-11-21) --
//
// The BWS file ships a record's SPEC before its checklist answer
// (`composeRowCells`). An item whose field a spec holds — its answer is a
// projection of the specs (`source_kind = 'attribute'`, 0050), or a spec
// ships for the field whatever the answer says — was written like any
// unsettled row: a bill's "Outdoor TBC" made the answer TBC, "Indoor" on the
// card replaced it, and the checklist read Indoor while the file went on
// shipping Outdoor TBC. Such a row is now treated like a settled different
// answer: listed with what the file ships, unticked, left alone; ticking it
// takes the reason the override rule already asks for, and the record's own
// checklist then carries its "the file ships the spec, not this" warning.
import type { AnswerState } from "@/lib/spec-vocab";
import type { QuestionTier } from "@/lib/tgq";

/** One item asking one fanned-out question. */
export type ProjectWideRow = {
  recordId: string;
  recordLabel: string;
  itemDescription: string;
  requirementId: string;
  /** Null where the checklist row was never created. The write creates it. */
  answerId: string | null;
  answerVersion: number | null;
  state: AnswerState;
  value: string | null;
  /** Null where the record has no level under the fallback model. */
  tier: QuestionTier | null;
  /**
   * What the BWS file ships for this field where a SPEC fills it — the
   * export's own composed cell (`cellsByField`, the test the record
   * checklist's `specShipsInstead` reads) — or null where no spec does.
   */
  specShips: string | null;
  /** The answer is a projection of the record's specs (`source_kind = 'attribute'`). */
  projection: boolean;
};

export type ProjectWidePlan = {
  /** Missing or TBC, and no spec holds the field: written. */
  write: ProjectWideRow[];
  /** Settled with a DIFFERENT answer, or held by a spec, and ticked: written, with a reason. */
  override: ProjectWideRow[];
  /** Settled with a different answer, or held by a spec, and NOT ticked: left alone, and named. */
  leftAlone: ProjectWideRow[];
  /** Already says exactly this, and the file ships it: nothing to do. */
  same: ProjectWideRow[];
};

const isSettledState = (state: string) => state === "confirmed" || state === "na";
const trimmed = (value: string | null) => (value ?? "").trim();

/** A spec holds this item's field: the answer follows the specs, or the file ships a spec for it. */
export function heldBySpec(row: Pick<ProjectWideRow, "specShips" | "projection">): boolean {
  // Absent (a payload from before C1) reads as "no spec", never as held.
  return (row.specShips ?? null) !== null || row.projection === true;
}

export function planProjectWide(
  question: { rows: readonly ProjectWideRow[] },
  { value, state, overrides }: { value: string | null; state: AnswerState; overrides: ReadonlySet<string> },
): ProjectWidePlan {
  const plan: ProjectWidePlan = { write: [], override: [], leftAlone: [], same: [] };
  for (const row of question.rows) {
    const sameAnswer = row.state === state && trimmed(row.value) === trimmed(value);
    const fileAgrees = (row.specShips ?? null) === null || trimmed(row.specShips) === trimmed(value);
    if (sameAnswer && fileAgrees) plan.same.push(row);
    else if (!isSettledState(row.state) && !heldBySpec(row)) plan.write.push(row);
    else if (row.answerId && overrides.has(row.answerId)) plan.override.push(row);
    else plan.leftAlone.push(row);
  }
  return plan;
}
