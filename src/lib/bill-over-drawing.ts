// A drawing's values over the bill's, card by card (brief G, 2026-10-04).
//
// ============================================================================
// WHAT WAS SEEN, AND WHY ASKING STAYS.
//
// The Aman bill is confirmed first, and its description cells write sizes and
// finish codes onto each record (`D460 x H450mm`, `MTL-01` into Main metal
// finish). Every drawing card for those items then finds each slot taken and
// asks, one tick per row, whether to replace it — and the stool also refuses
// outright, because the bill's D460 is really its diameter and a record cannot
// carry Dia. beside W x D. Ten of fifteen cards on one phase were held that
// way.
//
// Asking is right: nothing a document wrote is replaced unseen. A tick per row
// on every card is the friction. So the card offers ONE press that sets the
// acknowledgements the per-row ticks would have set — the same entries, keyed
// the same way (observation, record), each carrying the version shown — and
// lists every replacement before the press. The per-row ticks stay, for a
// reviewer who wants only some.
//
// ---- ONLY THE BILL'S -----------------------------------------------------
//
// `OccupiedSlot.fromBill`, read by `loadOccupiedSlots`: written by a bill's own
// run, never corrected by a person, and carrying no standard a person set. A
// value a PERSON typed or corrected, or one ANOTHER DRAWING gave, is never in
// this list — those are decisions, and replacing one stays a decision taken
// row by row, with the sentences the card has always printed.
//
// ---- A DRAWN DIAMETER RETIRES THE BILL'S W AND D --------------------------
//
// Dia. replaces W x D in the composed cell, so the diameter cannot land while
// the bill's depth stays. The press acknowledges retiring them too, as
// `retiresSlot` entries on the diameter row; the confirm retires them in the
// same statement, under the same version check, as any replacement.
//
// PURE. The server computes the list (`resolveStagedRun`), the card renders it
// and sends `withBillAcknowledgements` per row through the autosave that
// already exists. Nothing here writes.
// ============================================================================
import {
  acknowledgedReplacements,
  acknowledgedSquareRetirements,
  alreadyRecorded,
  rowWriteRecords,
  type DrawingItem,
  type DrawingObservation,
  type NamedTargets,
  type OccupiedSlot,
  type OccupiedSlots,
} from "@/lib/drawing-document";
import type { DimensionSlot } from "@/lib/spec-vocab";

/** One value of the bill's this card would replace, on one record. */
export type BillReplacement = {
  observationId: string;
  recordId: string;
  /** `replace`: the row's own slot. `retire_square`: a W or D a diameter row retires. */
  kind: "replace" | "retire_square";
  /** The occupant's dimension slot, for a dimension; null for a BWS field. */
  slot: DimensionSlot | null;
  /** The occupant's BWS field, for a field; null for a dimension. */
  fieldId: string | null;
  occupant: Pick<OccupiedSlot, "attributeId" | "attributeVersion" | "label" | "value" | "unit" | "materialCode">;
  /** Already acknowledged, at the version shown. A stale acknowledgement reads as not yet. */
  acknowledged: boolean;
};

/**
 * Every value the bill wrote that this card's pending rows would replace.
 *
 * Read through the functions the blockers read — `rowWriteRecords` for where a
 * row lands, `alreadyRecorded` for "the same figure is not a replacement" —
 * so the press can never acknowledge something the card would not have asked
 * about, nor leave out something it would.
 */
export function billReplacements(
  item: Pick<DrawingItem, "observations">,
  targets: readonly string[],
  occupied: OccupiedSlots,
  named: NamedTargets | null = null,
): BillReplacement[] {
  const out: BillReplacement[] = [];
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending") continue;
    const isDimension = observation.attrGroup === "dimension" && Boolean(observation.dimensionSlot);
    if (!isDimension && !observation.specFieldId) continue;
    const own = acknowledgedReplacements(observation);
    const square = acknowledgedSquareRetirements(observation);
    for (const recordId of rowWriteRecords(observation.id, targets, named)) {
      const occupant = isDimension
        ? occupied.dimensions.get(recordId)?.get(observation.dimensionSlot!)
        : occupied.fields.get(recordId)?.get(observation.specFieldId!);
      if (occupant?.fromBill && !alreadyRecorded(observation, occupant)) {
        const ack = own.get(recordId);
        out.push({
          observationId: observation.id,
          recordId,
          kind: "replace",
          slot: isDimension ? (observation.dimensionSlot ?? null) : null,
          fieldId: isDimension ? null : observation.specFieldId,
          occupant: pick(occupant),
          acknowledged: ack?.attributeId === occupant.attributeId && ack.attributeVersion === occupant.attributeVersion,
        });
      }
      if (!isDimension || observation.dimensionSlot !== "DIA") continue;
      for (const slot of ["W", "D"] as const) {
        const held = occupied.dimensions.get(recordId)?.get(slot);
        if (!held?.fromBill) continue;
        const ack = square.get(recordId)?.get(slot);
        out.push({
          observationId: observation.id,
          recordId,
          kind: "retire_square",
          slot,
          fieldId: null,
          occupant: pick(held),
          acknowledged: ack?.attributeId === held.attributeId && ack.attributeVersion === held.attributeVersion,
        });
      }
    }
  }
  return out;
}

function pick(occupant: OccupiedSlot): BillReplacement["occupant"] {
  return {
    attributeId: occupant.attributeId,
    attributeVersion: occupant.attributeVersion,
    label: occupant.label,
    value: occupant.value,
    unit: occupant.unit,
    materialCode: occupant.materialCode ?? null,
  };
}

type ReplaceEntry = NonNullable<DrawingObservation["replaces"]>[number];

/**
 * The row's whole `replaces` list with these entries set (`on`) or cleared.
 *
 * Whole, because the autosave stores the list it is sent. Every OTHER entry on
 * the row — a per-row tick for a person's value on another record — is kept.
 * An entry is matched on (record, which slot): its own slot, or the W or D it
 * retires.
 */
export function withBillAcknowledgements(
  observation: Pick<DrawingObservation, "replaces">,
  entries: readonly BillReplacement[],
  on: boolean,
): ReplaceEntry[] {
  let list: ReplaceEntry[] = [...(observation.replaces ?? [])];
  for (const entry of entries) {
    const retiresSlot = entry.kind === "retire_square" ? (entry.slot as "W" | "D") : undefined;
    list = list.filter(
      (held) => !(held.recordId === entry.recordId && (held.retiresSlot ?? null) === (retiresSlot ?? null)),
    );
    if (on) {
      list.push({
        recordId: entry.recordId,
        attributeId: entry.occupant.attributeId,
        attributeVersion: entry.occupant.attributeVersion,
        ...(retiresSlot ? { retiresSlot } : {}),
      });
    }
  }
  return list;
}

const SLOT_PREFIX: Record<DimensionSlot, string> = { W: "W", D: "D", H: "H", SH: "SH", DIA: "Dia" };

/** A figure as it reads: the unit beside it only where the figure ends in a digit (`1'-6"` carries its own). */
function figure(value: string | null, unit: string | null): string {
  const text = (value ?? "").trim();
  if (!text) return "(blank)";
  return unit && /\d$/.test(text) ? `${text}${unit}` : text;
}

function finishWords(code: string | null | undefined, value: string | null): string {
  return code?.trim() || (value ?? "").trim() || "(blank)";
}

/**
 * One line per ROW, in card order: what the bill holds and what replaces it.
 *
 *   `D 460mm → Dia 1'-6"` · `H 450mm → 1'-4 3/4"` · `Main metal finish MTL-01 → GR MTL 01`
 *
 * One line, not one per record: a drawing quoted by three phases replaces the
 * bill's figure on each, and where the phases' bill values differ they are
 * all named.
 */
export function describeBillReplacements(
  item: Pick<DrawingItem, "observations">,
  entries: readonly BillReplacement[],
  fieldName: (fieldId: string) => string | null = () => null,
): { observationId: string; text: string }[] {
  const lines: { observationId: string; text: string }[] = [];
  for (const observation of item.observations) {
    const mine = entries.filter((entry) => entry.observationId === observation.id);
    if (mine.length === 0) continue;
    const olds: string[] = [];
    for (const entry of mine) {
      const text =
        entry.slot !== null
          ? `${SLOT_PREFIX[entry.slot]} ${figure(entry.occupant.value, entry.occupant.unit)}`
          : `${(entry.fieldId && fieldName(entry.fieldId)) || entry.occupant.label} ${finishWords(entry.occupant.materialCode, entry.occupant.value)}`;
      if (!olds.includes(text)) olds.push(text);
    }
    const isDimension = observation.attrGroup === "dimension" && observation.dimensionSlot;
    const replacesOwnSlotOnly = mine.every((entry) => entry.kind === "replace");
    const next = isDimension
      ? // The slot is named on the right only where it differs from the left:
        // `H 450mm → 1'-4 3/4"`, but `D 460mm → Dia 1'-6"`.
        `${replacesOwnSlotOnly ? "" : `${SLOT_PREFIX[observation.dimensionSlot!]} `}${figure(observation.value ?? observation.valueRaw, observation.unit)}`
      : finishWords(observation.materialCodeRaw, observation.value ?? observation.valueRaw);
    lines.push({ observationId: observation.id, text: `${olds.join(", ")} → ${next}` });
  }
  return lines;
}
