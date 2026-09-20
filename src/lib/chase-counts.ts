// Why the numbers on a record screen differ, DERIVED FROM THE ROWS on the
// screen rather than from a remembered cause.
//
// ============================================================================
// TWO NUMBERS THAT DIFFER, SIDE BY SIDE, EXPLAINED BY NOTHING.
//
// 2026-09-18, in front of four people: the gate panel read "5 to answer" and
// the button top right read "Chase the 4". Sebastian asked outright whether
// they were different things. They were, and the screen said none of it.
//
// ---- AND THE REASON GIVEN IN THE ROOM WAS NOT THE ARITHMETIC ---------------
//
// "Spec notes is a manual entry and is not chased" was the explanation offered
// at the time, and it is the right INTUITION about the wrong mechanism. Driven
// on the sandbox, 2026-09-19, record AP364-003 · Sofa: TGQ reads `6 to answer`
// and the button reads `Chase the 4`, and the two rows in between are Spec
// notes AND Designer reference — both outstanding, neither a link, because
// neither has a checklist question at all. They are read off `spec_records`
// columns (`spec_description`, `designer`) by `loadGateContext`, which is what
// makes them `blocking` rather than `unanswerable`.
//
// So the sentence is COMPUTED, never asserted. A fixed cause is a sentence
// that is wrong on the next record, which is the same failure as the two bare
// numbers it replaces.
//
// ---- THE FOUR WAYS A TGQ ROW CAN FAIL TO BE A QUESTION SOMEBODY IS ASKED ---
//
//   chase      a checklist question of kind `spec_field` — the only rows a
//              chase email ever puts to a designer.
//   details    one of Matthew's id-less rows resolved from a RECORD COLUMN:
//              Item name, Designer reference, Spec notes. There is no
//              checklist question, and there is nowhere to chase — it is typed
//              on this item's own details.
//   readiness  a checklist question of kind `readiness` (`requirements
//              .local_key`, db/seed/0009). Ours to record, never chased —
//              decision 19, and what the chase screen's default selection
//              already does.
//   slot       a dimension SLOT row. Rows 4-7 of his matrix are four TGQ rows
//              carrying one BWS id, each judged by the `record_attributes` row
//              that holds it, where the checklist asks ONE Dimensions
//              question.
//
// `unanswerable` is a fifth state and is NOT in the sentence: the panel gives
// it its own dashed chip, and folding it in is the defect the chip fixed.
//
// ---- WHY `details` IS DERIVED AND NOT A LIST OF THREE KEYS -----------------
//
// It could be `["item_name", "designer_reference", "spec_notes"]`, and that
// list would then live in four places — the seed, `loadGateContext`, here, and
// the panel. It is derivable exactly instead: `gateStatus` returns
// `unanswerable` for a local-key row it found no local for, and a local exists
// only from those three record columns or from a readiness ANSWER, which by
// construction has a question. So a local-key row that is neither unanswerable
// nor question-backed is a record-column row, always.
//
// Nothing here reads a database, so the record screen and the gate panel run
// the same functions the tests do.
// ============================================================================

/** The outcomes `gateStatus` produces, repeated structurally so this stays a leaf. */
export type GateRowOutcome = "satisfied" | "blocking" | "unknown" | "not_applicable" | "unanswerable";

/** A checklist question, as little of one as the matching needs. */
export type GateQuestion = {
  requirement_id: string;
  json_id: number | null;
  local_key: string | null;
  /** `requirements.kind`. Absent on a caller that does not carry it. */
  kind?: string | null;
};

/** One of Matthew's matrix rows, in either of the two shapes the app holds it. */
export type GateFieldRef = {
  specFieldJsonId?: number | null;
  jsonId?: number | null;
  localKey: string | null;
  dimensionSlot?: string | null;
};

/**
 * The checklist question a matrix row is answered through, or null.
 *
 * ONE MATCHER. The panel links the field name through this and the sentence
 * buckets the row by it; two copies is how the label on a row and the number
 * in the sentence start disagreeing about the same row.
 */
export function questionForField<Q extends GateQuestion>(field: GateFieldRef, answers: readonly Q[]): Q | null {
  const jsonId = field.jsonId !== undefined ? field.jsonId : (field.specFieldJsonId ?? null);
  return (
    answers.find(
      (answer) =>
        (field.localKey !== null && answer.local_key === field.localKey) ||
        (jsonId !== null && jsonId !== undefined && answer.json_id === jsonId),
    ) ?? null
  );
}

export type GateRowRole = "chase" | "details" | "readiness" | "slot" | "nowhere" | "settled";

/**
 * What KIND of outstanding work one gate row is — or that it is not work.
 *
 * The order of the tests is the model: a readiness question is one whatever
 * else it carries, a local-key row with no question is a record column, and a
 * dimension slot is checked before the plain case because its row DOES have a
 * question (the one Dimensions question, shared with three siblings).
 */
export function gateRowRole(
  row: { outcome: GateRowOutcome; field: GateFieldRef },
  question: GateQuestion | null,
): GateRowRole {
  if (row.outcome === "unanswerable") return "nowhere";
  if (row.outcome === "satisfied" || row.outcome === "not_applicable") return "settled";
  if (question && question.kind === "readiness") return "readiness";
  if (row.field.localKey !== null && !question) return "details";
  if (row.field.dimensionSlot) return "slot";
  return "chase";
}

export type ChaseBuckets = {
  /** `blocking + unknown` — the panel's own "n to answer" chip. */
  toAnswer: number;
  chase: number;
  details: number;
  readiness: number;
  slots: number;
  /** Chipped separately by the panel; never part of the sentence. */
  nowhere: number;
};

export const EMPTY_BUCKETS: ChaseBuckets = {
  toAnswer: 0,
  chase: 0,
  details: 0,
  readiness: 0,
  slots: 0,
  nowhere: 0,
};

/** One gate's rows, bucketed. Pure, so the sentence is provable from a fixture. */
export function summariseGateRows<Q extends GateQuestion>(
  rows: readonly { outcome: GateRowOutcome; field: GateFieldRef }[],
  answers: readonly Q[],
): ChaseBuckets {
  const buckets: ChaseBuckets = { ...EMPTY_BUCKETS };
  for (const row of rows) {
    const role = gateRowRole(row, questionForField(row.field, answers));
    if (role === "nowhere") buckets.nowhere += 1;
    else if (role === "settled") continue;
    else {
      buckets.toAnswer += 1;
      if (role === "chase") buckets.chase += 1;
      else if (role === "details") buckets.details += 1;
      else if (role === "readiness") buckets.readiness += 1;
      else buckets.slots += 1;
    }
  }
  return buckets;
}

/**
 * One muted line under the actions, or null where there is nothing to explain.
 *
 * Null is the common case and is correct: a screen whose numbers agree must
 * not carry a sentence saying so, or the sentence becomes furniture and the
 * one record where it means something reads like every other.
 *
 * `toChase` is the ROUTE's figure and the one on the button. The gate's own
 * `chase` bucket should equal it; where it does not, both are printed rather
 * than one being hidden, because a disagreement between them is a finding and
 * not a rounding.
 */
export function describeChaseCounts({
  buckets,
  toChase,
}: {
  /** The TGQ gate's rows, bucketed. Null where Matthew's matrix does not reach the category. */
  buckets: ChaseBuckets | null;
  /** Outstanding to-quote `spec_field` QUESTIONS. Null where nothing is tiered. */
  toChase: number | null;
}): string | null {
  // NO MATRIX VIEW, or no level and so nothing tiered: there is no second
  // measure to set the first against, and a lone figure explains nothing.
  if (!buckets || toChase === null) return null;

  const { toAnswer, chase, details, readiness, slots } = buckets;
  const differs = chase !== toChase;
  if (details === 0 && readiness === 0 && slots === 0 && !differs) return null;

  const parts = [`${toAnswer} to answer at TGQ`];
  if (chase > 0 || differs) parts.push(`${chase} to chase`);
  if (differs) parts.push(`the button says ${toChase} (differs — see the rows)`);
  if (details > 0) parts.push(`${details} you record on this item's details`);
  if (readiness > 0) parts.push(`${readiness} you record here`);
  if (slots > 0) parts.push(`${slots} counted as separate slots`);
  return parts.join(" · ");
}
