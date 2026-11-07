// What one person's act on a record OFFERS its twins, row by row.
//
// ============================================================================
// ONE READING, TWO CALLERS.
//
// The record screen's Add a spec, Edit value and Retire forms show "Also on
// its twin PL-FUR-13 (Ambassador Suite)", ticked or not, with the twin's own
// value beside it. The write boundary (`twin-writes.ts`) re-reads the same
// rows under the records' locks and asks this same function whether what the
// screen sent is still what it offered. Two copies of the rule would let the
// screen tick a twin the server then writes differently, which is the
// `proposalBlockers` disagreement in a new place.
//
// ---- THE RULE: A TWIN NEVER MERGES, AND NOTHING IS OVERWRITTEN UNSEEN ------
//
// Rows are matched across the two records the way a bill line's
// configurations are (`commonGroupKey`): the dimension slot, then the BWS
// field, then the group and folded label. Then:
//
//   ADD      a slot or field the twin leaves FREE is offered ticked (T1,
//            "so a spec is added to both at once"). One the twin already
//            HOLDS is offered UNTICKED, with its value: ticking it IS the
//            replace acknowledgement, and the old row is superseded, never
//            edited. A note is always free: a record may carry many.
//   CORRECT  the twin's matching row is offered ticked only where it says
//   RETIRE   exactly what this record's row said before (value, unit, state,
//            qualifier). A twin whose row DIFFERS is listed with its value
//            and is not offered — "PL-FUR-13 reads W 560, not 540: left
//            alone" — because the edit is about THIS value, and a twin
//            somebody deliberately changed is the thing the link must not
//            flatten. A twin with no such row is not offered either.
//
// Only a BILL LINE offers its twins. A configuration's specs are its own
// (plan §5: "a twin's configurations are its own"); its bill line's twins
// are shown on its screen, never written to from it.
// ============================================================================
import { commonGroupKey } from "@/lib/configuration-common";
import type { TwinLink } from "@/lib/record-twins";
import type { AttributeGroup, AttributeState, AttributeUnit, DimensionSlot } from "@/lib/spec-vocab";
import type { TxnSql } from "@/lib/db-transaction";

/** One live attribute on a twin, in the shape the offer compares. */
export type TwinAttribute = {
  id: string;
  version: number;
  attrGroup: AttributeGroup;
  label: string;
  value: string | null;
  unit: AttributeUnit | null;
  qualifier: string | null;
  state: AttributeState;
  dimensionSlot: DimensionSlot | null;
  specFieldId: string | null;
};

export type TwinWithAttributes = TwinLink & { attributes: TwinAttribute[] };

/** What an act is about: a new spec's target, or the row being corrected or retired. */
export type TwinOfferSubject =
  | { act: "add"; attrGroup: AttributeGroup; label: string; dimensionSlot: DimensionSlot | null; specFieldId: string | null }
  | { act: "correct" | "retire"; row: TwinAttribute };

export type TwinOfferStatus =
  /** Add: nothing there. Offered, ticked. */
  | "free"
  /** Add: the twin holds this slot or field. Offered UNTICKED; a tick replaces `row`. */
  | "held"
  /** Correct / retire: the twin's row says the same. Offered, ticked. */
  | "same"
  /** Correct / retire: the twin's row says something else. Listed, not offered. */
  | "differs"
  /** Correct / retire: the twin has no such row. Listed, not offered. */
  | "missing";

export type TwinOfferEntry = {
  twin: TwinLink;
  status: TwinOfferStatus;
  /** The twin's row this act would touch (held, same) or is shown beside (differs). */
  row: TwinAttribute | null;
  /** May a person tick it at all. */
  offered: boolean;
  /** Is it ticked when the form opens (T1). */
  ticked: boolean;
};

function text(value: string | null): string {
  return (value ?? "").trim();
}

function sameStatement(a: TwinAttribute, b: TwinAttribute): boolean {
  return (
    text(a.value) === text(b.value) &&
    (a.unit ?? null) === (b.unit ?? null) &&
    a.state === b.state &&
    text(a.qualifier) === text(b.qualifier)
  );
}

/** The offer, twin by twin, in the order the twins are listed. */
export function twinOffer(subject: TwinOfferSubject, twins: readonly TwinWithAttributes[]): TwinOfferEntry[] {
  return twins.map((twin) => {
    if (subject.act === "add") {
      // A note, a hardware line, anything with neither slot nor field: a
      // record carries as many as the documents gave it, so nothing is held.
      if (!subject.dimensionSlot && !subject.specFieldId) {
        return { twin, status: "free", row: null, offered: true, ticked: true };
      }
      const key = commonGroupKey(subject);
      const held = twin.attributes.find((row) => commonGroupKey(row) === key) ?? null;
      return held
        ? { twin, status: "held", row: held, offered: true, ticked: false }
        : { twin, status: "free", row: null, offered: true, ticked: true };
    }
    const key = commonGroupKey(subject.row);
    const matching = twin.attributes.filter((row) => commonGroupKey(row) === key);
    if (matching.length === 0) return { twin, status: "missing", row: null, offered: false, ticked: false };
    // Two rows under one label on the twin: which one this edit means is a
    // choice, and a choice is not offered as a tick.
    if (matching.length > 1 || !sameStatement(matching[0]!, subject.row)) {
      return { twin, status: "differs", row: matching[0]!, offered: false, ticked: false };
    }
    return { twin, status: "same", row: matching[0]!, offered: true, ticked: true };
  });
}

/** What a twin's row reads as on the screen: "W 540mm", "Oak — main body". */
export function twinRowWords(row: TwinAttribute): string {
  const value = text(row.value) || (row.state === "tbc" ? "TBC" : "nothing");
  const unit = row.unit && /\d$/.test(value) ? row.unit : "";
  const slot = row.dimensionSlot ? `${row.dimensionSlot === "DIA" ? "Dia" : row.dimensionSlot} ` : "";
  const qualifier = text(row.qualifier) ? ` (${text(row.qualifier)})` : "";
  return `${slot}${value}${unit}${qualifier}`;
}

/** One sentence per twin, for the line under its tick. */
export function twinOfferSentence(entry: TwinOfferEntry): string {
  const name = entry.twin.boqCodes[0] ?? entry.twin.label;
  switch (entry.status) {
    case "free":
      return `Also on ${name}.`;
    case "held":
      return `${name} holds ${twinRowWords(entry.row!)}. Tick to replace it there too.`;
    case "same":
      return `Also on ${name}, which says the same.`;
    case "differs":
      return `${name} reads ${twinRowWords(entry.row!)}: left alone.`;
    case "missing":
      return `${name} has no such spec: left alone.`;
  }
}

/** The live attributes of these records, in the offer's shape. */
export async function loadTwinAttributes(db: TxnSql, recordIds: readonly string[]): Promise<Map<string, TwinAttribute[]>> {
  const out = new Map<string, TwinAttribute[]>(recordIds.map((id) => [id, []]));
  if (recordIds.length === 0) return out;
  const rows = await db`
    select id, record_id, version, attr_group, label, value, unit, qualifier, state, dimension_slot, spec_field_id
      from record_attributes
     where record_id = any(${[...recordIds]}::uuid[]) and status = 'active'
     order by sort_order, id
  `;
  for (const row of rows) {
    out.get(String(row.record_id))?.push({
      id: String(row.id),
      version: Number(row.version),
      attrGroup: String(row.attr_group) as AttributeGroup,
      label: String(row.label),
      value: row.value === null || row.value === undefined ? null : String(row.value),
      unit: row.unit === null || row.unit === undefined ? null : (String(row.unit) as AttributeUnit),
      qualifier: row.qualifier === null || row.qualifier === undefined ? null : String(row.qualifier),
      state: String(row.state) as AttributeState,
      dimensionSlot: row.dimension_slot === null || row.dimension_slot === undefined ? null : (String(row.dimension_slot) as DimensionSlot),
      specFieldId: row.spec_field_id === null || row.spec_field_id === undefined ? null : String(row.spec_field_id),
    });
  }
  return out;
}
