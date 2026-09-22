"use client";

// The one control that answers "how big is it".
//
// ============================================================================
// A DIMENSION IS NOT AN ANSWER, AND A BOX THAT TAKES ONE IS THE HOLE THIS
// COMPONENT EXISTS TO CLOSE.
//
// The composed Dimensions cell (`W840 x D790 x H720mm`) is a PROJECTION of the
// record's dimension attributes. Typing it into the checklist answer writes a
// STRING with no W/D/H/SH behind it — so nothing downstream can tell that two
// of the four figures an item needs were never taken, and the answer is
// written `manual`, which puts the cell out of reach of every later
// recomposition (`planAnswerFills`). Seen on 2026-09-21: `W1900 x D1400mm`
// typed into the record's Checklist tab and marked Confirmed, with no height
// and no seat height, and the TGQ tile reading 0.
//
// So the person says which slot, which figure and which unit; the app infers
// nothing; `POST /api/attributes` writes an ATTRIBUTE; and the answer follows
// from `recomposeAnswers`. 0011's biconditional is that `attr_group =
// 'dimension'` MEANS one of the five slots, which is what makes
// `composeDimensionCell` total.
//
// ---- ONE CONTROL, TWO SCREENS ---------------------------------------------
//
// The infill screen (`InfillRow`) did this correctly and the record's
// Checklist tab never learned it. This is that control, lifted out rather than
// copied: two tables sharing one control is acceptable, two controls writing
// one cell is the `composeDimensionCell` trap in a new place.
//
// `composeDimensionCell` is called here to show what the cell now reads — the
// SAME function the export, the record screen and the drawings review call,
// never a second implementation — and 0034's note is passed to it rather than
// printed beside it, for the same reason.
//
// ---- WHICH SLOTS AN ITEM NEEDS IS MATTHEW'S MATRIX, PER CATEGORY -----------
//
// Rows 4-7 of his matrix are W, D, H and SH, each one BWS id 3 with a
// `dimension_slot`, and SH applies to six of his nine categories rather than
// to all of them. It is NULL for the eight cabinetry sheets his matrix does
// not reach: "all four, always" would report a missing seat height on a
// bedside table. So `required` carries three states and they are three
// different statements — the `gatesForRecord` rule, in a second place:
//
//   undefined — this caller does not show a breakdown (the infill screen,
//               which does not load the matrix).
//   null      — his matrix does not cover this category. Five slots offered,
//               NONE required, and the panel says so in words.
//   a list    — the slots this category needs, and how many are on record.
//
// Nothing here blocks anything. The breakdown is what stops "confirmed" being
// read as "measured", which is the finding; refusing the write would be a
// fourth state model on top of the three that already decide this.
// ============================================================================
import { useState } from "react";
import Button from "@/components/ui/Button";
import { TONE } from "@/components/ui/tone";
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import {
  DIMENSION_SLOTS,
  DIMENSION_SLOT_LABELS,
  isDimensionSlot,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";

/** One dimension already on the record — what a document said, or what somebody typed. */
export type HeldDimension = { slot: string; value: string | null; unit: string | null; state: string };

/** The two a person types off a drawing or a tape measure. */
const UNITS: AttributeUnit[] = ["mm", "cm"];

/**
 * Which of the five slots this category needs, from Matthew's matrix rows.
 *
 * Pure, and exported so a caller does not have to know that a matrix row
 * carrying a slot is always BWS field 3, or that the TG1 row re-checks the
 * WHOLE cell and therefore carries no slot at all.
 */
export function requiredSlots(
  fields: readonly { jsonId: number | null; dimensionSlot: string | null }[] | null,
): DimensionSlot[] | null {
  if (!fields) return null;
  const out: DimensionSlot[] = [];
  for (const field of fields) {
    const slot = field.dimensionSlot;
    if (!slot || !isDimensionSlot(slot)) continue;
    if (!out.includes(slot)) out.push(slot);
  }
  // ORDERED BY THE VOCABULARY, not by the matrix's own row order, so the list
  // reads in the order the composed cell prints: W x D x H x SH, Dia.
  return DIMENSION_SLOTS.filter((slot) => out.includes(slot));
}

export default function DimensionAnswer({
  subject,
  held,
  busy,
  note = null,
  required,
  onRecord,
}: {
  /** The item, for the aria-labels. Two of these on one screen otherwise read alike. */
  subject: string;
  held: readonly HeldDimension[];
  busy: boolean;
  /** 0034's one qualifier for the whole cell. Composed IN, never printed beside. */
  note?: string | null;
  /** undefined: no breakdown. null: no matrix for this category. A list: the slots it needs. */
  required?: readonly DimensionSlot[] | null;
  onRecord: (input: { slot: DimensionSlot; value: string; unit: AttributeUnit }) => Promise<boolean>;
}) {
  const [slot, setSlot] = useState<DimensionSlot | "">("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<AttributeUnit>("mm");

  const taken = new Map(held.filter((row) => isDimensionSlot(row.slot)).map((row) => [row.slot as DimensionSlot, row]));

  // What the cell reads now, through the app's ONE composer. Composing it here
  // rather than asking the server for it is not a second implementation: it is
  // the same function the export and the record screen call.
  const rows: DimensionRow[] = held
    .filter((row) => isDimensionSlot(row.slot))
    .map((row, index) => ({
      slot: row.slot as DimensionSlot,
      value: row.value,
      unit: (row.unit ?? null) as AttributeUnit | null,
      state: row.state as AttributeState,
      sortOrder: index,
    }));
  const cell = rows.length > 0 || note ? composeDimensionCell(rows, note).text : null;

  const onRecordCount = required ? required.filter((option) => taken.has(option)).length : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={slot}
          disabled={busy}
          aria-label={`Which dimension of ${subject}`}
          onChange={(event) => setSlot(event.target.value as DimensionSlot | "")}
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">— which —</option>
          {DIMENSION_SLOTS.map((option) => (
            <option key={option} value={option} disabled={taken.has(option)}>
              {DIMENSION_SLOT_LABELS[option]}
              {taken.has(option) ? " — already recorded" : ""}
            </option>
          ))}
        </select>
        <input
          value={value}
          disabled={busy}
          inputMode="decimal"
          placeholder="840"
          aria-label={`Figure for ${subject}`}
          onChange={(event) => setValue(event.target.value)}
          className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50"
        />
        <select
          value={unit}
          disabled={busy}
          aria-label="Unit"
          onChange={(event) => setUnit(event.target.value as AttributeUnit)}
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
        >
          {UNITS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <Button
          size="xs"
          variant="secondary"
          disabled={busy || !slot || !value.trim()}
          onClick={async () => {
            if (!slot || !value.trim()) return;
            const ok = await onRecord({ slot, value: value.trim(), unit });
            if (ok) {
              setSlot("");
              setValue("");
            }
          }}
        >
          {busy ? "Recording…" : "Record"}
        </Button>
      </div>

      {cell && (
        <p className="mt-1 text-[11px] text-neutral-600">
          Dimensions now read <span className="font-mono text-neutral-900">{cell}</span>
        </p>
      )}

      {/* ---- what this item needs, and what it has ---------------------------
          Omitted entirely where the caller does not load the matrix, because a
          breakdown that could not say what is required would be five rows
          saying nothing. */}
      {required !== undefined && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            {required === null || required.length === 0
              ? "The five dimensions"
              : `${onRecordCount} of the ${required.length} this item needs are on record`}
          </p>
          <ul aria-label={`Dimension slots for ${subject}`} className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {DIMENSION_SLOTS.map((option) => {
              const row = taken.get(option);
              const needed = required !== null && required.includes(option);
              return (
                <li key={option} className="text-[11.5px] leading-5">
                  <span className={needed && !row ? TONE.danger.text : "text-neutral-500"}>
                    {DIMENSION_SLOT_LABELS[option]}
                  </span>{" "}
                  {row ? (
                    <span className="font-mono text-neutral-900">
                      {row.value ?? "—"}
                      {row.unit ?? ""}
                      {row.state === "tbc" ? " (TBC)" : ""}
                    </span>
                  ) : needed ? (
                    <span className={`font-semibold ${TONE.danger.text}`}>not measured</span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </li>
              );
            })}
          </ul>
          {required === null ? (
            // NOT an empty set, and the difference is the whole point.
            // `gatesForRecord` returns null for the eight cabinetry sheets
            // rather than an empty list, because an empty list computes as
            // "nothing outstanding" — and here it would read as an item that
            // needs no dimensions at all.
            <p className="mt-1 text-[11px] text-neutral-500">
              Matthew&rsquo;s matrix does not cover this category — the cabinetry half is still to come — so nothing
              says which of these this item needs. All five can be recorded and none is required.
            </p>
          ) : required.length === 0 ? (
            // COVERED, AND ASKING FOR NONE. A real answer, and a different one
            // from "nobody has written the rules yet" above it.
            <p className="mt-1 text-[11px] text-neutral-500">
              Matthew&rsquo;s matrix covers this category and names none of these, so none is required.
            </p>
          ) : (
            onRecordCount < required.length && (
              <p className={`mt-1 text-[11px] ${TONE.danger.text}`}>
                Recording the cell is not the same as measuring it: each of these is a separate figure, and the gate
                reads the figures.
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
