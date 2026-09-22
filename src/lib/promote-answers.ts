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
import { combineFinishState, composeFinishCell, type Finish } from "@/lib/finishes";

/** The BWS register key for the dimensions field. Resolved by `json_id`, never
 *  by column letter, which is positional and shifts when BWS inserts one. */
export const DIMENSIONS_JSON_ID = 3;

export type PromotableAttribute = {
  attrGroup: string;
  dimensionSlot: string | null;
  specFieldId: string | null;
  value: string | null;
  /** Where on the item it goes (0029). Carried to the answer with the value. */
  qualifier?: string | null;
  unit: string | null;
  state: AttributeState;
  sortOrder: number;
  /** The intake run that recorded it, so an answer says which document said so. */
  sourceRunId: string | null;
  /**
   * The library entry this attribute's code is linked to.
   *
   * RULE 5, and it is the same trap as rules 1 and 3. The export renders a
   * linked attribute as the LIBRARY says it is; if the answer kept the
   * attribute's own text, editing a finish would change the export cell while
   * the checklist a person can see went on saying the old thing. One composer,
   * `composeFinishCell`, called here and there.
   *
   * It also carries the state: a `tbc` finish can never produce a confirmed
   * answer, whatever the attribute said.
   */
  finish?: Finish | null;
};

export type AnswerFill = {
  /** Which question, identified by the BWS field its category asks it for. */
  specFieldId: string | null;
  /** Set instead of `specFieldId` for the composed dimensions cell. */
  jsonId: number | null;
  value: string;
  state: "confirmed" | "tbc";
  /**
   * The placement, kept APART from the value all the way to the answer.
   *
   * Null for the composed dimensions cell: four slots off three pages could
   * carry four placements and picking one would invent a fact. The export's
   * dimensions cell carries none for the same reason.
   */
  qualifier: string | null;
  /** What the document actually said, kept beside the tidied value. */
  valueRaw: string;
  /**
   * Which document the value came from. For a composed cell that is the LAST
   * contributing slot -- the most recently confirmed drawing -- because a cell
   * built from three documents has no single source and the newest is the one
   * a reader would go and check.
   */
  sourceRunId: string | null;
};

/**
 * What a record's attributes say its checklist answers should be.
 *
 * Pure, and deliberately so: the confirm route and any screen that wants to
 * preview the effect read the same answer out of the same function.
 *
 * `dimensionNote` is `spec_records.dimension_note` (0034), and it is here for
 * the reason rule 3 exists: the composed cell is a PROJECTION of the record's
 * dimension statements, and the checklist is a screen. Leaving it out left the
 * Specs tab and the BWS file reading `W1830mm (1250 L-shaped return)` while
 * the Checklist tab's own Dimensions answer said `W1830mm` — the exact
 * disagreement this file exists to prevent, arriving from a new direction.
 */
export function planAnswerFills(attributes: PromotableAttribute[], dimensionNote?: string | null): AnswerFill[] {
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
    const cell = composeDimensionCell(rows, dimensionNote);
    if (cell.text.trim() !== "") {
      // Confirmed only when every contributing slot is confirmed AND the cell
      // composed without a problem. Either doubt makes it TBC.
      const allConfirmed = dimensions.every((attribute) => attribute.state === "confirmed");
      // And never confirmed over a cell carrying no figure. "W TBC" composes
      // cleanly and says nothing measurable, so a mislabelled attribute state
      // must not be able to turn it into a satisfied answer.
      //
      // READ OFF THE FIGURES ALONE, never off the cell with the note in it.
      // A note is prose a person typed and it routinely contains a number —
      // "1250 L-shaped return" — so testing the composed cell would let
      // somebody's sentence stand in for the measurement and mark a record of
      // nothing but TBCs as a CONFIRMED dimension, which a gate then reads as
      // satisfied.
      const hasFigure = /\d/.test(composeDimensionCell(rows).text);
      fills.push({
        specFieldId: null,
        jsonId: DIMENSIONS_JSON_ID,
        value: cell.text,
        qualifier: null,
        state: allConfirmed && hasFigure && cell.problems.length === 0 ? "confirmed" : "tbc",
        // The DOCUMENTS' own figures, and only those: `value_raw` is what
        // makes an answer checkable against a page, and the note has no page.
        valueRaw: rows
          .map((row) => `${row.slot} ${row.value ?? "—"}${row.unit ? ` ${row.unit}` : ""}`)
          .join(" · "),
        sourceRunId:
          [...dimensions].sort((a, b) => a.sortOrder - b.sortOrder)[dimensions.length - 1]?.sourceRunId ?? null,
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
    const raw = (attribute.value ?? "").trim();
    const finish = attribute.finish ?? null;
    // A LINKED ATTRIBUTE ANSWERS AS THE LIBRARY SAYS IT IS. The export renders
    // it that way too, through the same function — the two must not be able to
    // disagree. `value_raw` keeps what this page said, which is what makes the
    // answer checkable against its drawing.
    // An internal finish with its description cleared composes to nothing;
    // this page's own words stand rather than an empty answer.
    const value = (finish ? composeFinishCell(finish) : "") || raw;
    if (value === "") continue;
    const state = combineFinishState(attribute.state, finish);
    fills.push({
      specFieldId: attribute.specFieldId,
      jsonId: null,
      value,
      qualifier: attribute.qualifier?.trim() || null,
      state: state === "confirmed" ? "confirmed" : "tbc",
      valueRaw: raw || value,
      sourceRunId: attribute.sourceRunId,
    });
  }

  return fills;
}

/**
 * The record's own dimension note, for composing its cell.
 *
 * A separate one-column read rather than a field on `PromotableAttribute`:
 * the note belongs to the RECORD, and a record with a note and no attributes
 * at all still has to be answerable — `loadPromotable` returns no rows there
 * and would have nowhere to carry it.
 */
export async function loadDimensionNote(txn: TxnSql, recordId: string): Promise<string | null> {
  const rows = await txn`select dimension_note from spec_records where id = ${recordId}`;
  const note = rows[0]?.dimension_note;
  return note === null || note === undefined ? null : String(note);
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
  runId: string | null,
  actor: string,
  fills: AnswerFill[],
): Promise<number> {
  let written = 0;
  for (const fill of fills) {
    const confirming = fill.state === "confirmed";
    const confirmedAt = confirming ? new Date().toISOString() : null;
    // The document the VALUE came from, which is not always the run being
    // confirmed: a card supplying only the height leaves a cell whose newest
    // slot may be another drawing's.
    const sourceRunId = fill.sourceRunId ?? runId;
    // Two shapes of fill, two statements. One predicate doing both needed a
    // `case` inside an `is not distinct from` and was unreadable, which is
    // its own kind of bug in a rule about not overwriting somebody's work.
    const rows =
      fill.jsonId !== null
        ? await txn`
            update spec_answers a
            set value = ${fill.value}, qualifier = ${fill.qualifier}, value_raw = ${fill.valueRaw}, state = ${fill.state},
                confirmed_by = ${confirming ? actor : null}, confirmed_at = ${confirmedAt},
                source_kind = 'document', source_id = ${sourceRunId}, updated_by = ${actor}
            where a.record_id = ${recordId}
              and a.revision_no = 0
              -- NEVER a person's answer, and never another DOCUMENT KIND's.
              -- manual is a person typing; email is a person confirming a
              -- value off a message, with that message attached as evidence --
              -- both are decisions and neither is in reach here.
              -- document is also what confirm-spec-document.ts writes, so
              -- matching on it alone would let a shop drawing quietly beat an
              -- answer a reviewer confirmed off an FF&E schedule. Narrowed to
              -- answers a DRAWINGS run wrote, which is exactly the set this
              -- code may recompose as later slots arrive.
              and (
                a.state = 'missing'
                -- ---- ANY document-composed cell, not only a drawing's ------
                --
                -- This branch is the COMPOSED DIMENSIONS CELL and nothing else
                -- (jsonId is set instead of specFieldId for it alone). A
                -- composed cell is a PROJECTION of the record's dimension
                -- attributes, never an answer anybody authored, so it must
                -- always equal their composition — letting it go stale is the
                -- exact disagreement this file exists to prevent.
                --
                -- Narrowed against the case the drawings-only clause below
                -- guards: that one is about a shop drawing beating a value a
                -- reviewer CONFIRMED off a schedule, which is a decision. This
                -- cell is not. An email giving W, D and H and a second email
                -- giving SH must recompose to W x D x H x SH; before this, the
                -- second email wrote its attribute and could not reach the
                -- cell, so the record held four slots and its answer showed
                -- three.
                --
                -- manual and email stay out of reach, so a person's own
                -- checklist answer is still never overwritten.
                or a.source_kind = 'document'
                -- ---- AND AN ANSWER A HAND-TYPED SPEC COMPOSED (0028) -------
                --
                -- document with a NULL source is a precise discriminator and
                -- not a loose one: every document path writes a run id, so the
                -- only way to be here is createAttribute, where the attribute
                -- names no document because a person typed it.
                --
                -- Without this clause the FIRST typed dimension wrote W1900mm
                -- and the next two could never reach the cell -- the record
                -- showed W, D and H while its Dimensions answer said W1900mm,
                -- which is the exact disagreement this file exists to prevent,
                -- arriving from the one direction it did not cover. Caught by
                -- tests/db/manual-capture.test.ts.
                --
                -- manual and email stay out of reach, so a person's own
                -- checklist answer is still never overwritten by anything.
                or (a.source_kind = 'document' and a.source_id is null)
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
            set value = ${fill.value}, qualifier = ${fill.qualifier}, value_raw = ${fill.valueRaw}, state = ${fill.state},
                confirmed_by = ${confirming ? actor : null}, confirmed_at = ${confirmedAt},
                source_kind = 'document', source_id = ${sourceRunId}, updated_by = ${actor}
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
                -- ---- AND AN ANSWER A HAND-TYPED SPEC COMPOSED (0028) -------
                --
                -- document with a NULL source is a precise discriminator and
                -- not a loose one: every document path writes a run id, so the
                -- only way to be here is createAttribute, where the attribute
                -- names no document because a person typed it.
                --
                -- Without this clause the FIRST typed dimension wrote W1900mm
                -- and the next two could never reach the cell -- the record
                -- showed W, D and H while its Dimensions answer said W1900mm,
                -- which is the exact disagreement this file exists to prevent,
                -- arriving from the one direction it did not cover. Caught by
                -- tests/db/manual-capture.test.ts.
                --
                -- manual and email stay out of reach, so a person's own
                -- checklist answer is still never overwritten by anything.
                or (a.source_kind = 'document' and a.source_id is null)
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

// ---- taking a value back out -----------------------------------------------

/**
 * Which BWS fields a record's answers still claim, but its attributes no
 * longer say anything about.
 *
 * ============================================================================
 * WHY A RETIRE NEEDS THIS, AND AN IGNORE DOES NOT.
 *
 * `applyAnswerFills` only ever writes a value in. Nothing took one back out,
 * and for the ignore path that is correct and deliberate: ignoring a staged
 * observation is a decision about a PROPOSAL, and it should not reach through
 * to an answer a confirm already wrote.
 *
 * Retiring an attribute is the opposite. It is a person on the record screen
 * saying "that spec is wrong, take it off this item" — and if the answer it
 * filled kept standing, the checklist would go on reporting a confirmed fabric
 * that the record no longer holds a statement for. Worse, the export would
 * still ship it, because a confirmed answer is exported whether or not an
 * attribute backs it.
 *
 * So retiring recomposes, and where nothing is left to recompose FROM, the
 * answer goes back to `missing` — which is the honest state: nobody has looked
 * at this since the value was withdrawn.
 *
 * The same two protections as a fill, for the same reasons:
 *   * a PERSON'S answer is never retracted. If somebody typed it, it is
 *     theirs, and the change set records that it now stands on nothing.
 *   * only an answer a SHOP-DRAWINGS run wrote is in scope, so a value
 *     confirmed off an FF&E schedule is not withdrawn by a drawing being
 *     retired.
 * ============================================================================
 */
export function planAnswerRetractions(attributes: PromotableAttribute[]): { specFieldId: string | null; jsonId: number | null }[] {
  const out: { specFieldId: string | null; jsonId: number | null }[] = [];

  // The composed cell stands as long as ANY slot still does. Retiring the
  // width off a record that still has a depth and a height recomposes rather
  // than retracts — which is planAnswerFills' job, not this one's.
  const hasDimension = attributes.some(
    (attribute) =>
      attribute.attrGroup === "dimension" &&
      isDimensionSlot(attribute.dimensionSlot ?? "") &&
      (attribute.value ?? "").trim() !== "",
  );
  if (!hasDimension) out.push({ specFieldId: null, jsonId: DIMENSIONS_JSON_ID });

  return out;
}

/**
 * Puts back to `missing` any answer a shop drawing wrote whose BWS field the
 * record's attributes no longer say anything about.
 *
 * Takes the fields that ARE still claimed, so one statement can clear
 * everything else this code owns. That is narrower than it looks: the
 * predicate still requires the answer to have been written by a shop-drawings
 * run, so a person's answer and an FF&E schedule's answer are both out of
 * reach.
 */
export async function applyAnswerRetractions(
  txn: TxnSql,
  recordId: string,
  actor: string,
  fills: AnswerFill[],
): Promise<number> {
  const claimedFieldIds = fills.map((fill) => fill.specFieldId).filter((id): id is string => id !== null);
  const claimedJsonIds = fills.map((fill) => fill.jsonId).filter((id): id is number => id !== null);

  const rows = await txn`
    update spec_answers a
    set value = null, value_raw = null, state = 'missing',
        confirmed_by = null, confirmed_at = null,
        source_kind = 'document', source_id = a.source_id, updated_by = ${actor}
    where a.record_id = ${recordId}
      and a.revision_no = 0
      and a.state <> 'missing'
      -- Written by a SHOP DRAWING, and by nothing else. A person's answer and
      -- an FF&E schedule's answer are both outside this.
      and a.source_kind = 'document'
      and exists (
        select 1 from intake_runs ir
        where ir.id = a.source_id and ir.document_kind = 'shop_drawings'
      )
      -- And whose field no attribute still speaks to.
      and a.spec_field_id is not null
      and not exists (
        select 1 from spec_fields f
        where f.id = a.spec_field_id
          and (f.id = any(${claimedFieldIds}::uuid[]) or f.json_id = any(${claimedJsonIds}::int[]))
      )
    returning a.id
  `;
  return rows.length;
}
