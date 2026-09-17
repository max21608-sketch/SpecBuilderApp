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

export const GATES = ["TGQ", "TG0", "TG1"] as const;
export type Gate = (typeof GATES)[number];

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

export type GateStatus = {
  gate: Gate;
  satisfied: boolean;
  fields: GateFieldStatus[];
  counts: Record<GateOutcome, number>;
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
 * The state of one gate for one record.
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
): GateStatus {
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

  // Satisfied means nothing is outstanding for a reason anyone could act on.
  // `unknown` and `unanswerable` both count against it: the first because we
  // cannot tell, the second because the app cannot hold the answer. Reporting
  // a gate met over either would be the app agreeing with itself.
  const satisfied = statuses.length > 0 && counts.blocking === 0 && counts.unknown === 0 && counts.unanswerable === 0;

  return { gate, satisfied, fields: statuses, counts };
}

/** What a screen says where a category has no mapping onto Matthew's nine. */
export const NO_MATRIX_CATEGORY_LABEL = "No gate view";
export const NO_MATRIX_CATEGORY_EXPLANATION =
  "Matthew's decision matrix covers nine upholstered seating categories. This item's category is not one of them — the cabinetry matrix is still to come — so there is nothing to check it against yet.";
