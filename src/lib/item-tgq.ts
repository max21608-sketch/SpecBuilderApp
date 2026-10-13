// An item's TGQ: the number, and the rows behind it, from ONE function.
//
// ============================================================================
// MAX, 2026-10-13: "WITH THE TGQ QUESTION IT SHOULD SHOW THE 7."
//
// Stool v3-001's header read "7 to answer at TGQ · 2 to chase · 2 you record
// on this item's details · 2 counted as separate slots · 1 project-wide", and
// its TGQ tile read 2. The header counts Matthew's gate FIELDS; the tile
// counted checklist QUESTIONS. Where his matrix covers the category, the gate
// is the truer number: a dimension SLOT is settled by the attribute that
// carries it, never by the composed cell — the stool's `D460 x H450mm`
// answers its one Dimensions question while W and SH are still open — and
// three of his rows (Designer reference, Spec notes, Item name) are record
// columns no checklist asks at all.
//
// So, decided:
//
//   ON HIS MATRIX   the item's TGQ is its TGQ gate rows still to answer —
//                   `summariseGateRows`' chase + details + readiness + slot.
//                   The project-wide rows stay APART (yesterday's ruling), so
//                   the stool reads 6 + 1 project-wide, which is "the 7"
//                   split the way every screen already splits it. `nowhere`
//                   (Product code, unanswerable) is OUT, as the header leaves
//                   it out: that gap is a seed, not a person's work.
//   ELSEWHERE       unchanged: `inItemTgq` over the checklist questions.
//
// ---- ONE FUNCTION, AND THE LIST IS THE COUNT ------------------------------
//
// It returns the number AND the rows behind it, so no screen can print a
// count over a list made a different way. A row is a checklist question, a
// dimension slot ("Width — record it on the Specs tab") or a record column
// ("Designer reference — on this item's details"), each saying where it is
// answered. Every screen calls this; nothing computes a gate in SQL
// (CLAUDE.md, "A gate belongs to a FIELD").
//
// It is pure, and a leaf apart from other pure leaves, so the record screen
// and the API run the same code the tests do.
// ============================================================================
import { gateRowRole, questionForField, type GateFieldRef, type GateQuestion, type GateRowOutcome } from "@/lib/chase-counts";
import { inItemTgq, inProjectWideTgq, type TgqCountable } from "@/lib/chase-grouping";

/** Where a row is answered — what its link goes to. */
export type ItemTgqWhere = "checklist" | "specs" | "details";

export type ItemTgqRow = {
  /** A checklist question, a dimension slot, or a record column. */
  kind: "question" | "slot" | "details";
  /** Present on a question row: what the `#q-` anchor and a fill-in row key on. */
  requirementId: string | null;
  /** The question's or the field's own name. */
  label: string;
  /** The cheat sheet's section, for a question row; null otherwise. */
  section: string | null;
  /** `missing` / `tbc` for a question; the gate row's state otherwise. */
  state: string;
  where: ItemTgqWhere;
};

export type ItemTgq = {
  model: "matrix" | "placeholder";
  /** The item's own TGQ. Null where nothing is tiered (placeholder, no level). */
  count: number | null;
  /** Project-wide TGQ on this item: answered once on the project, never in `count`. */
  projectWide: number;
  /** The rows `count` counts, in order. THE LIST IS THE COUNT. */
  rows: ItemTgqRow[];
};

/** A checklist question, as both models need it. */
export type ItemTgqQuestion = GateQuestion & {
  requirement_id: string;
  prompt: string;
  /** The BWS field's name, where it fills one. */
  field_label?: string | null;
  section: string | null;
};

/** An OUTSTANDING question on this record, tiered (as `loadOutstanding` returns it). */
export type ItemTgqOutstanding = TgqCountable & {
  requirementId: string;
  requirementKind: "spec_field" | "readiness";
  prompt: string;
  fieldLabel: string | null;
  state: string;
};

/** The TGQ gate's rows, as `gatesForRecord(...).TGQ.fields` carries them. */
export type ItemTgqGateRow = {
  outcome: GateRowOutcome;
  field: GateFieldRef & { fieldName: string };
  state?: string | null;
};

export function itemTgq({
  tgqGateRows,
  questions,
  outstanding,
}: {
  /** Null where Matthew's matrix does not cover the category. */
  tgqGateRows: readonly ItemTgqGateRow[] | null;
  /** EVERY checklist question the category asks, whatever its state — what a gate row is matched to. */
  questions: readonly ItemTgqQuestion[];
  /** This record's outstanding questions, tiered. */
  outstanding: readonly ItemTgqOutstanding[];
}): ItemTgq {
  if (tgqGateRows) {
    const open = new Map(outstanding.map((question) => [question.requirementId, question]));
    const rows: ItemTgqRow[] = [];
    let projectWide = 0;
    for (const row of tgqGateRows) {
      const question = questionForField(row.field, questions);
      const role = gateRowRole(row, question);
      if (role === "settled" || role === "nowhere") continue;
      if (role === "project") {
        projectWide += 1;
        continue;
      }
      if (role === "slot") {
        rows.push({
          kind: "slot",
          requirementId: null,
          label: row.field.fieldName,
          section: null,
          state: row.state ?? "missing",
          where: "specs",
        });
      } else if (role === "details") {
        rows.push({
          kind: "details",
          requirementId: null,
          label: row.field.fieldName,
          section: null,
          state: row.state ?? "missing",
          where: "details",
        });
      } else if (question) {
        const live = open.get(question.requirement_id);
        rows.push({
          kind: "question",
          requirementId: question.requirement_id,
          label: question.field_label ?? question.prompt,
          section: question.section,
          state: live?.state ?? row.state ?? "missing",
          where: "checklist",
        });
      } else {
        // A chase row whose question the list did not carry: still the item's
        // work, named by the matrix, never dropped from the count.
        rows.push({
          kind: "question",
          requirementId: null,
          label: row.field.fieldName,
          section: null,
          state: row.state ?? "missing",
          where: "checklist",
        });
      }
    }
    return { model: "matrix", count: rows.length, projectWide, rows };
  }

  // THE PLACEHOLDER, unchanged: the checklist's own questions by `inItemTgq`.
  if (outstanding.some((question) => question.tier === null)) {
    return { model: "placeholder", count: null, projectWide: 0, rows: [] };
  }
  const rows: ItemTgqRow[] = outstanding.filter(inItemTgq).map((question) => ({
    kind: "question",
    requirementId: question.requirementId,
    label: question.fieldLabel ?? question.prompt,
    section: question.section,
    state: question.state,
    where: "checklist",
  }));
  return {
    model: "placeholder",
    count: rows.length,
    projectWide: outstanding.filter(inProjectWideTgq).length,
    rows,
  };
}

/** What a row says about where it is answered, in words. One wording on every screen. */
export const ITEM_TGQ_WHERE_LABEL: Record<ItemTgqWhere, string> = {
  checklist: "on the checklist",
  specs: "record it on the Specs tab",
  details: "on this item's details",
};
