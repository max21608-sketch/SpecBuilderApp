// Carrying a confirmed attribute through to the checklist question it answers.
//
// ============================================================================
// WHY THIS IS AUTOMATIC, AND WHY THAT IS NOT A BREACH OF THE APPROVAL GATE.
//
// The gate is that no extracted spec value reaches `spec_answers` without a
// human confirming it. That still holds: this runs INSIDE the drawings
// confirm, on observations a reviewer has just ticked on a card while looking
// at the page. The confirm now writes two rows instead of one -- the attribute
// (what the document said) and the answer (the checklist's copy of it). No
// model output reaches an answer unseen.
//
// The alternative was a per-answer click, and it was rejected for a reason
// worth writing down: a reviewer who has just confirmed W1900 x D790 x H720
// against the page is not making a second decision when they then type
// "W1900 x D790 x H720" into a box. That is transcription, and transcription is
// where a 790 becomes a 709.
//
// FOUR RULES, each of which is a trap rather than a preference:
//
//   1. A `tbc` attribute becomes a `tbc` ANSWER. Never confirmed. The Panther
//      sofa records four dimensions as TBC and a fabric code reading "TBC –
//      Yarn Collective..."; promoted as confirmed, a gate reads satisfied over
//      values nobody has decided. TBC is a real, distinct, gate-blocking state
//      and it survives the trip.
//   2. A PERSON'S ANSWER IS NEVER OVERWRITTEN. Only an answer still `missing`,
//      or one this code wrote itself, is touched. `source_kind` is what tells
//      them apart, which is why /api/answers/[id] clears it the moment a human
//      edits: from then on the answer is theirs.
//   3. A dimension does not map to a field by `spec_field_id` -- it carries a
//      SLOT, and all five slots compose into the single BWS Dimensions field
//      through `composeDimensionCell`. That is the same function the record
//      screen and the export call, because a second implementation is how a
//      screen starts promising what the file does not deliver.
//   4. A CELL THAT COULD NOT BE DERIVED IS NOT CONFIRMED. `composeDimensionCell`
//      reports a figure with no unit, a non-numeric value, and a diameter
//      beside a width as problems, and renders them verbatim rather than
//      guessing. An answer built over a problem goes in as `tbc` whatever the
//      attributes said: a guessed conversion looks exactly like a measurement.
// ============================================================================
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import type { TxnSql } from "@/lib/db-transaction";
import { isDimensionSlot, type AttributeState, type AttributeUnit, type DimensionSlot } from "@/lib/spec-vocab";

/** The BWS register key for the dimensions field. Resolved by `json_id`, never
 *  by column letter, which is positional and shifts when BWS inserts one. */
export const DIMENSIONS_JSON_ID = 3;

export type PromotableAttribute = {
  attrGroup: string;
  dimensionSlot: string | null;
  specFieldId: string | null;
  value: string | null;
  unit: string | null;
  state: AttributeState;
  sortOrder: number;
};

export type AnswerFill = {
  /** Which question, identified by the BWS field its category asks it for. */
  specFieldId: string | null;
  /** Set instead of `specFieldId` for the composed dimensions cell. */
  jsonId: number | null;
  value: string;
  state: "confirmed" | "tbc";
  /** What the document actually said, kept beside the tidied value. */
  valueRaw: string;
};

/**
 * What a record's attributes say its checklist answers should be.
 *
 * Pure, and deliberately so: the confirm route and any screen that wants to
 * preview the effect read the same answer out of the same function.
 */
export function planAnswerFills(attributes: PromotableAttribute[]): AnswerFill[] {
  const fills: AnswerFill[] = [];

  // ---- the composed dimensions cell ---------------------------------------
  // A slot with no value at all contributes nothing: composeDimensionCell
  // renders it as [W "" — not a number], which is the right thing to show a
  // reviewer beside the row and pure noise inside an answer.
  const dimensions = attributes.filter(
    (attribute) =>
      attribute.attrGroup === "dimension" &&
      isDimensionSlot(attribute.dimensionSlot ?? "") &&
      (attribute.value ?? "").trim() !== "",
  );
  if (dimensions.length > 0) {
    const rows: DimensionRow[] = dimensions.map((attribute) => ({
      slot: attribute.dimensionSlot as DimensionSlot,
      value: attribute.value,
      unit: (attribute.unit ?? null) as AttributeUnit | null,
      state: attribute.state,
      sortOrder: attribute.sortOrder,
    }));
    const cell = composeDimensionCell(rows);
    if (cell.text.trim() !== "") {
      // Confirmed only when every contributing slot is confirmed AND the cell
      // composed without a problem. Either doubt makes it TBC.
      const allConfirmed = dimensions.every((attribute) => attribute.state === "confirmed");
      // And never confirmed over a cell carrying no figure. "W TBC" composes
      // cleanly and says nothing measurable, so a mislabelled attribute state
      // must not be able to turn it into a satisfied answer.
      const hasFigure = /\d/.test(cell.text);
      fills.push({
        specFieldId: null,
        jsonId: DIMENSIONS_JSON_ID,
        value: cell.text,
        state: allConfirmed && hasFigure && cell.problems.length === 0 ? "confirmed" : "tbc",
        valueRaw: rows
          .map((row) => `${row.slot} ${row.value ?? "—"}${row.unit ? ` ${row.unit}` : ""}`)
          .join(" · "),
      });
    }
  }

  // ---- everything else, one attribute to one question ---------------------
  // `requirements_category_field_idx` asks for a BWS field at most once per
  // category, and `record_attributes_field_slot_key` refuses two attributes
  // claiming one field on a record, so this is one-to-one by construction.
  // A second claimant is still skipped rather than picked between: choosing
  // silently is how the wrong finish reaches an export.
  const seen = new Set<string>();
  const clashed = new Set<string>();
  for (const attribute of attributes) {
    if (attribute.attrGroup === "dimension" || !attribute.specFieldId) continue;
    if (seen.has(attribute.specFieldId)) clashed.add(attribute.specFieldId);
    seen.add(attribute.specFieldId);
  }

  for (const attribute of attributes) {
    if (attribute.attrGroup === "dimension") continue;
    if (!attribute.specFieldId || clashed.has(attribute.specFieldId)) continue;
    const value = (attribute.value ?? "").trim();
    if (value === "") continue;
    fills.push({
      specFieldId: attribute.specFieldId,
      jsonId: null,
      value,
      state: attribute.state === "confirmed" ? "confirmed" : "tbc",
      valueRaw: value,
    });
  }

  return fills;
}

/**
 * Write a record's fills into `spec_answers`, inside the caller's transaction.
 * Returns how many answers actually moved, which is what the confirm reports
 * back so a reviewer is told rather than left to notice.
 *
 * Every statement is predicated, so the rules hold in the database rather than
 * by the order this happens to run in:
 *
 *   - the question must belong to the record's OWN category (`requirements` is
 *     scoped by `category_id`, and the subquery below joins through it);
 *   - the answer must still be `missing`, or one this code wrote before
 *     (`source_kind = 'intake_run'`). A person's answer matches neither, which
 *     is the whole of rule 2.
 *
 * A fill naming no question writes nothing and is not an error: a category may
 * simply not ask for that BWS field, and the attribute remains the record of
 * what the document said.
 */
export async function applyAnswerFills(
  txn: TxnSql,
  recordId: string,
  runId: string,
  actor: string,
  fills: AnswerFill[],
): Promise<number> {
  let written = 0;
  for (const fill of fills) {
    const confirming = fill.state === "confirmed";
    const confirmedAt = confirming ? new Date().toISOString() : null;
    // Two shapes of fill, two statements. One predicate doing both needed a
    // `case` inside an `is not distinct from` and was unreadable, which is
    // its own kind of bug in a rule about not overwriting somebody's work.
    const rows =
      fill.jsonId !== null
        ? await txn`
            update spec_answers a
            set value = ${fill.value}, value_raw = ${fill.valueRaw}, state = ${fill.state},
                confirmed_by = ${confirming ? actor : null}, confirmed_at = ${confirmedAt},
                source_kind = 'document', source_id = ${runId}, updated_by = ${actor}
            where a.record_id = ${recordId}
              and a.revision_no = 0
              -- NEVER a person's answer, and never another DOCUMENT KIND's.
              -- document is also what confirm-spec-document.ts writes, so
              -- matching on it alone would let a shop drawing quietly beat an
              -- answer a reviewer confirmed off an FF&E schedule. Narrowed to
              -- answers a DRAWINGS run wrote, which is exactly the set this
              -- code may recompose as later slots arrive.
              and (
                a.state = 'missing'
                or (a.source_kind = 'document'
                    and exists (
                      select 1 from intake_runs ir
                      where ir.id = a.source_id and ir.document_kind = 'shop_drawings'
                    ))
              )
              and a.requirement_id in (
                select q.id from requirements q
                join spec_records r on r.id = ${recordId} and r.category_id = q.category_id
                join spec_fields f on f.id = q.spec_field_id
                where f.json_id = ${fill.jsonId}
              )
            returning a.id
          `
        : await txn`
            update spec_answers a
            set value = ${fill.value}, value_raw = ${fill.valueRaw}, state = ${fill.state},
                confirmed_by = ${confirming ? actor : null}, confirmed_at = ${confirmedAt},
                source_kind = 'document', source_id = ${runId}, updated_by = ${actor}
            where a.record_id = ${recordId}
              and a.revision_no = 0
              -- NEVER a person's answer, and never another DOCUMENT KIND's.
              -- document is also what confirm-spec-document.ts writes, so
              -- matching on it alone would let a shop drawing quietly beat an
              -- answer a reviewer confirmed off an FF&E schedule. Narrowed to
              -- answers a DRAWINGS run wrote, which is exactly the set this
              -- code may recompose as later slots arrive.
              and (
                a.state = 'missing'
                or (a.source_kind = 'document'
                    and exists (
                      select 1 from intake_runs ir
                      where ir.id = a.source_id and ir.document_kind = 'shop_drawings'
                    ))
              )
              and a.requirement_id in (
                select q.id from requirements q
                join spec_records r on r.id = ${recordId} and r.category_id = q.category_id
                where q.spec_field_id = ${fill.specFieldId}
              )
            returning a.id
          `;
    written += rows.length;
  }
  return written;
}
