// Which of Matthew's gate fields a record has settled, and which are holding it.
//
// ============================================================================
// COMPUTED, NEVER STORED — and it reads STATE, never a string.
//
// A spec value is `confirmed`, `tbc`, `missing` or `na`, and those are four
// different things. `TBC` means a human actively said "not yet decided": it is
// an ANSWER and it BLOCKS. `missing` means nobody has looked. A rule testing
// for a non-empty string treats the last three as satisfied and reports a
// record ready for TG1 when it is not. That is the oldest trap in this repo
// and the reason `state` exists at all.
//
// Nothing here is written down. A stored gate status would bump the version
// every M2 extraction snapshot and every chase coverage row is taken against,
// which is the `chased_at` trap — the same reason Waiting and Overdue are
// computed too.
//
// ---- FIVE OUTCOMES, BECAUSE THREE WOULD LIE -------------------------------
//
// It is tempting to return satisfied / not satisfied. Three of the five below
// are not a person's fault and must not read as one:
//
//   satisfied      a confirmed answer, or a slot filled off a drawing
//   blocking       missing or TBC. Somebody has to do something.
//   not_applicable `na`, or a conditional whose controller says No
//   unknown        a conditional whose CONTROLLER is unanswered. We do not
//                  know whether the field applies, so we must not report it
//                  either way. Counts against the gate; reported apart.
//   unanswerable   the app has nowhere to record it — the field is on the
//                  matrix and this category's checklist has no question for
//                  it, or it is one of Matthew's ten id-less rows with no home
//                  yet. Counts against the gate, and the fix is a seed or a
//                  migration, NOT a person answering a question.
//
// Collapsing `unanswerable` into `blocking` would put sixty questions on a
// reviewer's desk that they cannot answer, and collapsing it into `satisfied`
// would pass a gate over fields nobody can even record.
// ============================================================================
import type { AnswerState } from "@/lib/spec-vocab";

// ---- THE ORDER OF THIS ARRAY IS THE MODEL, NOT A PRESENTATION CHOICE -------
//
// The gates BUILD ON EACH OTHER. TGQ is enough information to put a price on
// the item, TG0 is the design intent agreed on top of that price, TG1 is the
// production lock on top of that intent. It is not possible to be at TG1
// without having reached TG0, and not possible to reach TG0 without TGQ.
//
// Judged field-by-field they look independent, and they are not: Matthew's
// matrix deliberately puts the SAME field at two gates — Assembly guide is
// TGQ and TG1, Dimensions is TGQ (four slots) and TG1 (the whole cell
// re-checked) — so a later gate is largely a RE-CHECK of an earlier one. A
// TG1 re-check reported as met over a TGQ that was never met is the app
// agreeing with itself about a question nobody answered.
//
// Reordering this array changes which gate is a prerequisite for which.
export const GATES = ["TGQ", "TG0", "TG1"] as const;
export type Gate = (typeof GATES)[number];

/** Every gate that must be satisfied before this one can be. In order. */
export function gatesBefore(gate: Gate): Gate[] {
  return GATES.slice(0, GATES.indexOf(gate));
}

export const GATE_LABELS: Record<Gate, string> = {
  TGQ: "TGQ — enough to quote",
  TG0: "TG0 — design intent",
  TG1: "TG1 — production lock",
};

export const GATE_SHORT_LABELS: Record<Gate, string> = { TGQ: "TGQ", TG0: "TG0", TG1: "TG1" };

export function isGate(value: unknown): value is Gate {
  return typeof value === "string" && (GATES as readonly string[]).includes(value);
}

/** How the answer is expected to arrive. Advisory — nothing gates on it. */
export const GATE_CAPTURES = ["auto", "question", "input", "confirm"] as const;
export type GateCapture = (typeof GATE_CAPTURES)[number];

export const CAPTURE_LABELS: Record<GateCapture, string> = {
  auto: "Filled from the documents",
  question: "Answered here",
  input: "Answered here",
  confirm: "Confirmed against the approved drawings",
};

export const GATE_VALUE_TYPES = ["palette", "palette_free_text", "free_text", "number", "boolean"] as const;
export type GateValueType = (typeof GATE_VALUE_TYPES)[number];

/** One row of the seeded overlay, as the app reads it. */
export type GateField = {
  matrixRow: number;
  gate: Gate;
  capture: GateCapture;
  fieldName: string;
  specFieldJsonId: number | null;
  localKey: string | null;
  dimensionSlot: "W" | "D" | "H" | "SH" | null;
  valueType: GateValueType;
  paletteKey: string | null;
  paletteRaw: string | null;
  conditionalOnKey: string | null;
  conditionalOnValue: string | null;
  notes: string | null;
};

export type GateOutcome = "satisfied" | "blocking" | "not_applicable" | "unknown" | "unanswerable";

export type GateFieldStatus = {
  field: GateField;
  outcome: GateOutcome;
  /** One sentence a screen can print beside the row. Always set. */
  reason: string;
  /** What the record currently holds, where anything does. */
  value: string | null;
  state: AnswerState | null;
};

/**
 * One gate judged over its OWN fields, and NOTHING ELSE.
 *
 * ==========================================================================
 * THIS TYPE HAS NO `satisfied`, DELIBERATELY.
 *
 * `ownSatisfied` means "every field this gate asks for is settled". That is
 * not the same as the gate being MET, because a gate is also waiting on the
 * gates before it, and the difference is the whole point: TG1's own fields
 * were all settled on a record whose TGQ had two outstanding and whose TG0
 * had five, and the screen printed a green TG1 ✓ beside two red pills.
 *
 * If this type carried a field called `satisfied`, every caller that reached
 * for the obvious name would get that same wrong answer, and the one who
 * forgot to chain would never find out. So the honest reading only exists on
 * `GateStatus`, which you can only get from `chainGates`, and TypeScript
 * refuses the unchained one.
 * ==========================================================================
 */
export type GateFieldsStatus = {
  gate: Gate;
  /** Every field THIS gate asks for is settled. Says nothing about TGQ/TG0. */
  ownSatisfied: boolean;
  fields: GateFieldStatus[];
  counts: Record<GateOutcome, number>;
};

/** A gate in its chain: its own fields, plus whether it has been reached. */
export type GateStatus = GateFieldsStatus & {
  /** Own fields settled AND every earlier gate satisfied. The real answer. */
  satisfied: boolean;
  /**
   * The earlier gates still holding this one up, earliest first. Empty means
   * this gate is the one in play. A gate with entries here is NOT a person's
   * outstanding work today — the work is at the gate named first.
   */
  blockedBy: Gate[];
};

/** A checklist answer, keyed by the BWS field its requirement points at. */
export type GateAnswerInput = {
  specFieldJsonId: number;
  state: AnswerState;
  value: string | null;
};

/** An active dimension row, which is how the four TGQ slots are settled. */
export type GateSlotInput = {
  dimensionSlot: "W" | "D" | "H" | "SH" | "DIA";
  state: "confirmed" | "tbc";
  value: string | null;
};

/**
 * What the RECORD itself can answer for one of Matthew's id-less rows.
 *
 * Three of his ten already have a home on `spec_records` and it would be
 * dishonest to report them unanswerable: the item name is the BOQ's own
 * words, and the designer reference is the `designer` column. The other seven
 * have nowhere to go yet and say so.
 */
export type GateLocalInput = Partial<Record<string, { state: AnswerState; value: string | null }>>;

const EMPTY_COUNTS: Record<GateOutcome, number> = {
  satisfied: 0,
  blocking: 0,
  not_applicable: 0,
  unknown: 0,
  unanswerable: 0,
};

function outcomeForState(state: AnswerState, value: string | null): { outcome: GateOutcome; reason: string } {
  if (state === "confirmed") return { outcome: "satisfied", reason: "Confirmed." };
  if (state === "na") return { outcome: "not_applicable", reason: "Recorded as not applicable to this item." };
  if (state === "tbc") {
    return {
      outcome: "blocking",
      reason: value
        ? `TBC — somebody asked and it is not decided (${value}).`
        : "TBC — somebody asked and it is not decided.",
    };
  }
  return { outcome: "blocking", reason: "Nobody has answered this yet." };
}

/**
 * One gate's OWN fields, for one record. Call `chainGates` to learn whether
 * the gate has actually been reached.
 *
 * `fields` is every row of the overlay that applies to this record's category,
 * already filtered by the caller's query — this function does no category
 * matching, because the `applies_to && codes` overlap belongs in SQL where the
 * GIN index is.
 */
export function gateStatus(
  gate: Gate,
  fields: readonly GateField[],
  input: {
    answers: readonly GateAnswerInput[];
    slots: readonly GateSlotInput[];
    locals?: GateLocalInput;
    /** The BWS field ids this record's category actually asks a question for. */
    askedFieldIds: ReadonlySet<number>;
  },
): GateFieldsStatus {
  const byField = new Map(input.answers.map((a) => [a.specFieldJsonId, a]));
  const bySlot = new Map(input.slots.map((s) => [s.dimensionSlot, s]));
  const locals = input.locals ?? {};

  // A conditional's controller is one of Matthew's own rows, addressed by its
  // local_key. Its ANSWER decides whether the dependents apply at all, so it
  // is resolved before anything else and from the same place.
  const controllerValue = (key: string): { state: AnswerState; value: string | null } | null =>
    locals[key] ?? null;

  const statuses: GateFieldStatus[] = fields.map((field) => {
    // ---- 1. conditionals ---------------------------------------------------
    if (field.conditionalOnKey) {
      const controller = controllerValue(field.conditionalOnKey);
      if (!controller || controller.state === "missing") {
        return {
          field,
          outcome: "unknown",
          reason: `Depends on “${field.conditionalOnKey}”, which nobody has answered — so we cannot tell whether this applies.`,
          value: null,
          state: null,
        };
      }
      if (controller.state === "tbc") {
        return {
          field,
          outcome: "unknown",
          reason: `Depends on “${field.conditionalOnKey}”, which is TBC.`,
          value: null,
          state: null,
        };
      }
      const matches = (controller.value ?? "").trim().toLowerCase() === field.conditionalOnValue?.trim().toLowerCase();
      if (!matches) {
        return {
          field,
          outcome: "not_applicable",
          reason: `Only applies when ${field.conditionalOnKey} is ${field.conditionalOnValue}.`,
          value: null,
          state: null,
        };
      }
      // Falls through: the condition is met, so judge it like any other field.
    }

    // ---- 2. a dimension slot ----------------------------------------------
    if (field.dimensionSlot) {
      const slot = bySlot.get(field.dimensionSlot);
      if (!slot) {
        return {
          field,
          outcome: "blocking",
          reason: `No ${field.dimensionSlot} has been recorded off any document.`,
          value: null,
          state: null,
        };
      }
      if (slot.state === "tbc") {
        return {
          field,
          outcome: "blocking",
          reason: `${field.dimensionSlot} is on record as TBC.`,
          value: slot.value,
          state: "tbc",
        };
      }
      return { field, outcome: "satisfied", reason: "Confirmed.", value: slot.value, state: "confirmed" };
    }

    // ---- 3. a BWS field with a checklist question -------------------------
    if (field.specFieldJsonId !== null) {
      if (!input.askedFieldIds.has(field.specFieldJsonId)) {
        return {
          field,
          outcome: "unanswerable",
          reason:
            "The matrix asks for this field and this category's checklist has no question for it, so there is nowhere to record an answer.",
          value: null,
          state: null,
        };
      }
      const answer = byField.get(field.specFieldJsonId);
      if (!answer) {
        return { field, outcome: "blocking", reason: "Nobody has answered this yet.", value: null, state: "missing" };
      }
      const { outcome, reason } = outcomeForState(answer.state, answer.value);
      return { field, outcome, reason, value: answer.value, state: answer.state };
    }

    // ---- 4. one of the ten rows with no BWS id ----------------------------
    const local = field.localKey ? locals[field.localKey] : undefined;
    if (!local) {
      return {
        field,
        outcome: "unanswerable",
        reason: "On Matthew's matrix with no BWS field and no home in this app yet.",
        value: null,
        state: null,
      };
    }
    const { outcome, reason } = outcomeForState(local.state, local.value);
    return { field, outcome, reason, value: local.value, state: local.state };
  });

  const counts = { ...EMPTY_COUNTS };
  for (const s of statuses) counts[s.outcome] += 1;

  // Settled means nothing is outstanding for a reason anyone could act on.
  // `unknown` and `unanswerable` both count against it: the first because we
  // cannot tell, the second because the app cannot hold the answer. Reporting
  // a gate met over either would be the app agreeing with itself.
  //
  // An EMPTY field list is never settled, because nothing was checked. That
  // matters more once gates chain: an empty earlier gate that read as settled
  // would wave every later gate through.
  const ownSatisfied =
    statuses.length > 0 && counts.blocking === 0 && counts.unknown === 0 && counts.unanswerable === 0;

  return { gate, ownSatisfied, fields: statuses, counts };
}

/**
 * The three gates as a CHAIN, which is what a screen may report.
 *
 * ==========================================================================
 * A GATE IS MET ONLY IF EVERY GATE BEFORE IT IS MET.
 *
 * Asked for directly on 2026-09-18, on seeing a record whose panel read
 * `TGQ 2 outstanding` · `TG0 5 outstanding` · `TG1 ✓`: "it's impossible to be
 * at TG1 if you haven't reached TG0 or TGQ. They build on each other."
 *
 * Three things about this are traps rather than preferences:
 *
 *   - The FIELD LIST is untouched. TG1 still lists TG1's own rows and nothing
 *     else, which is what was asked for and what keeps the panel readable. It
 *     is the VERDICT that chains, not the contents.
 *   - `ownSatisfied` is kept and reported apart, because "TG1's own fields are
 *     all settled but TG0 is not reached" is a real state and a different one
 *     from "TG1 has three fields outstanding". Collapsing them would put work
 *     on somebody's desk that is already done.
 *   - A blocked gate's own outstanding rows are NOT today's work, and the
 *     screens colour them accordingly. Painting a gate red for work that
 *     cannot start yet teaches people to ignore red — the same argument that
 *     keeps `unanswerable` slate.
 *
 * Note that an earlier gate held up by an `unanswerable` field — the app has
 * nowhere to record it — blocks the later gates too, and cannot be cleared by
 * anybody answering a question. That is the honest reading: we cannot claim
 * TG1 over a TGQ we were never able to judge. The panel names which kind of
 * blocker it is, so it does not read as a reviewer's fault.
 * ==========================================================================
 */
export function chainGates(byGate: Record<Gate, GateFieldsStatus>): Record<Gate, GateStatus> {
  const out = {} as Record<Gate, GateStatus>;
  const unmet: Gate[] = [];
  // In order, so a gate only ever sees the gates decided before it.
  for (const gate of GATES) {
    const own = byGate[gate];
    const blockedBy = [...unmet];
    const satisfied = own.ownSatisfied && blockedBy.length === 0;
    out[gate] = { ...own, satisfied, blockedBy };
    if (!satisfied) unmet.push(gate);
  }
  return out;
}

/** What a screen says where a category has no mapping onto Matthew's nine. */
export const NO_MATRIX_CATEGORY_LABEL = "No gate view";
export const NO_MATRIX_CATEGORY_EXPLANATION =
  "Matthew's decision matrix covers nine upholstered seating categories. This item's category is not one of them — the cabinetry matrix is still to come — so there is nothing to check it against yet.";
