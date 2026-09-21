// Reading and editing a staged import. Edits here change nothing operational:
// the staged jsonb is a draft until /confirm promotes it.
//
// TWO SHAPES behind one endpoint, dispatched on source_kind — the BOQ's
// positional lines, and a specification document's identified proposals. They
// are edited differently for a reason that is not cosmetic:
//
//   BOQ lines are a FIXED LIST parsed from a spreadsheet. Nothing is ever added
//   or removed, so an index is a stable address.
//
//   PROPOSALS ARE ADDRESSED BY UUID, NEVER BY POSITION. Reviewing one changes
//   the set the screen is filtering, so "the proposal at index 4" means a
//   different row before and after an Ignore. Every operation here locates by
//   `elem.id` in the live, locked JSON.
import { z } from "zod";
import { sql, json, type Row } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import { loadDrawingContext, recordChoices, resolveStagedRun } from "@/lib/drawing-resolution";
import {
  buildTargetSnapshot,
  suggestState,
  type Proposal,
  type StagedSpecDocument,
} from "@/lib/spec-document";
import {
  ANSWER_STATES,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_STATES,
  ATTRIBUTE_UNITS,
  DIMENSION_SLOTS,
  isItemLevel,
} from "@/lib/spec-vocab";
import { assertBoqDocument } from "@/lib/boq-import";
import { reconcileSheet, type ExistingRecord, type RevisedLine } from "@/lib/boq-reconcile";
import {
  assertStagedDrawings,
  specFieldEntries,
  isMeasuredRow,
  splitFigureAndUnit,
  type DrawingItem,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { assertStagedPreamble, preambleNoteBlockers, type StagedPreamble } from "@/lib/preamble-document";

export const dynamic = "force-dynamic";

// ---- setting the unit on many dimensions at once ---------------------------
// The per-observation select stays; this is the escape from answering the same
// question a few hundred times on a pack whose pages state no unit.
//
// NO per-observation `expectedVersion`. The run row is held with `for update`
// for the whole statement, so nothing can interleave, and every observation's
// version still bumps — a tab that was editing one of them gets its own stale
// conflict on its next write, which is the behaviour a per-row check would
// have produced anyway.
//
// PENDING DIMENSIONS ONLY. An applied observation is history, an ignored one
// was a decision, and a material cannot carry a unit at all
// (`record_attributes_unit_is_dimension`).
const BulkUnitPatch = z
  .object({
    bulkUnit: z
      .object({
        scope: z.enum(["item", "run"]),
        itemId: z.string().min(1).optional(),
        unit: z.enum(ATTRIBUTE_UNITS),
      })
      .strict()
      .refine((value) => value.scope === "run" || Boolean(value.itemId), {
        message: "Setting the unit on one item needs to say which item.",
      }),
  })
  .strict();

async function patchBulkUnit(id: string, raw: unknown, actor: string): Promise<Response> {
  const parsed = BulkUnitPatch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That change is not valid." }, 400);
  }
  const { scope, itemId, unit } = parsed.data.bulkUnit;

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`
        select id, status, parsed, version from intake_runs where id = ${id} for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.status !== "parsed") {
        throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)}, not open for editing.`);
      }
      const fieldRows = await txn`select id, json_id, name from spec_fields order by sort_order`;
      const staged: StagedDrawings = assertStagedDrawings(run.parsed, specFieldEntries(fieldRows));
      if (scope === "item" && !staged.items.some((item) => item.id === itemId)) {
        throw new DomainConflictError("item_missing", "That item is no longer part of this import. Reload.");
      }

      let changed = 0;
      const items = staged.items.map((item) => {
        if (scope === "item" && item.id !== itemId) return item;
        let touched = false;
        const observations = item.observations.map((observation) => {
          if (observation.reviewStatus !== "pending") return observation;
          // EVERY MEASURED ROW, not only the ones already promoted to a
          // dimension. "All dimensions: mm" is the answer to "this page does
          // not print its units", and on such a page most figures are still
          // notes -- gating on `attrGroup` made the control skip exactly the
          // rows it was offered for. A row carrying no figure is untouched: a
          // unit on a paragraph of REMARKS is meaningless.
          if (!isMeasuredRow(observation)) return observation;
          if (observation.unit === unit) return observation;
          touched = true;
          changed += 1;
          return {
            ...observation,
            version: observation.version + 1,
            unit,
            // A human set this. It is no longer a suggestion from anywhere, so
            // the screen must stop calling it one.
            unitSuggested: false,
            unitSource: undefined,
          };
        });
        return touched ? { ...item, observations } : item;
      });

      const written = await txn`
        update intake_runs
        set parsed = ${JSON.stringify({ ...staged, items })}::jsonb, updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("not_reviewable", "This import closed while you were editing it.");
      return { version: Number(written[0].version), changed };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- a drawing observation's autosave --------------------------------------
// Per id, per version, merged into the locked row — the same discipline as a
// proposal, for the same reason: two people editing two different rows must not
// conflict, and a snapshot rewrite silently reverts the other tab.
const DrawingPatch = z
  .object({
    itemId: z.string().min(1),
    // Targets belong to the ITEM (which runs this drawing applies to); values
    // belong to an OBSERVATION. Two different versions, two different edits.
    observationId: z.string().min(1).optional(),
    expectedVersion: z.number().int().nonnegative(),
    changes: z
      .object({
        ticked: z.array(z.string().uuid()).max(200).optional(),
        unticked: z.array(z.string().uuid()).max(200).optional(),
        value: z.string().max(4000).nullable().optional(),
        unit: z.enum(ATTRIBUTE_UNITS).nullable().optional(),
        attrGroup: z.enum(ATTRIBUTE_GROUPS).optional(),
        dimensionSlot: z.enum(DIMENSION_SLOTS).nullable().optional(),
        specFieldId: z.string().uuid().nullable().optional(),
        state: z.enum(ATTRIBUTE_STATES).nullable().optional(),
        label: z.string().max(300).optional(),
        // Which occupied slot, on which record, this observation replaces.
        // Per (observation, RECORD): a card fans out one record per run, and
        // the mock-up run's COM 1 may hold a different old value from the main
        // run's — so an acknowledgement keyed on the observation alone would
        // let a confirm retire a value the reviewer never saw.
        replaces: z
          .array(
            z
              .object({
                recordId: z.string().uuid(),
                attributeId: z.string().uuid(),
                attributeVersion: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .max(50)
          .optional(),
      })
      .strict(),
  })
  .strict();

async function patchDrawing(id: string, raw: unknown, actor: string): Promise<Response> {
  const parsed = DrawingPatch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That change is not valid." }, 400);
  }
  const { itemId, observationId, expectedVersion, changes } = parsed.data;
  if (Object.keys(changes).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`
        select id, project_id, status, parsed, version from intake_runs where id = ${id} for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.status !== "parsed") {
        throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)}, not open for editing.`);
      }
      const fieldRows = await txn`select id, json_id, name from spec_fields order by sort_order`;
      const staged: StagedDrawings = assertStagedDrawings(run.parsed, specFieldEntries(fieldRows));
      const item = staged.items.find((row) => row.id === itemId);
      if (!item) throw new DomainConflictError("item_missing", "That item is no longer part of this import. Reload.");

      let items: DrawingItem[];

      if (observationId === undefined) {
        if (item.version !== expectedVersion) {
          throw new DomainConflictError("item_version_stale", "This item was edited in another tab. Reload.");
        }
        const ticked = changes.ticked ?? item.targets?.ticked ?? [];
        const unticked = changes.unticked ?? item.targets?.unticked ?? [];
        // Both lists are the reviewer's DECISION, which is what lets a target
        // that appears later be told apart from one they deliberately unticked.
        items = staged.items.map((row) =>
          row.id === itemId ? { ...row, version: row.version + 1, targets: { ticked, unticked } } : row,
        );
      } else {
        const observation = item.observations.find((row) => row.id === observationId);
        if (!observation) {
          throw new DomainConflictError("observation_missing", "That spec is no longer part of this import. Reload.");
        }
        if (observation.reviewStatus !== "pending") {
          throw new DomainConflictError(
            "observation_reviewed",
            `That spec has already been ${observation.reviewStatus}. Reload to see the current state.`,
          );
        }
        if (observation.version !== expectedVersion) {
          throw new DomainConflictError("observation_version_stale", "That spec was edited in another tab. Reload.");
        }
        if (changes.specFieldId) {
          const field = await txn`select id from spec_fields where id = ${changes.specFieldId}`;
          if (!field[0]) throw new DomainConflictError("unknown_field", "No such BWS field.", { status: 400 });
        }
        // A reviewer typing "1800mm" into a dimension's value means the same
        // thing the page did, and the export appends the unit column with no
        // separator — so leaving it there renders "1800mmmm" in BWS. Split it
        // through the SAME function staging uses, rather than a second rule
        // that would eventually disagree with it.
        const typed =
          changes.value !== undefined && observation.attrGroup === "dimension"
            ? splitFigureAndUnit(changes.value)
            : null;

        const next = {
          ...observation,
          version: observation.version + 1,
          // ====================================================================
          // CORRECTING A GUESSED FIGURE IS A DECISION ABOUT THAT ROW.
          //
          // `applyViewGuesses` re-guesses an item on every read as long as
          // every placed row is still `slotSuggested` -- which is what makes a
          // guess improvable rather than sticky. But the guess reads the
          // FIGURES, so correcting one changes its own input: a reviewer who
          // fixed a width from 640 to 660 was handed 640 straight back on the
          // next read, because 640 was still printed on the back elevation and
          // the rule picked it again. Their correction survived in the row and
          // vanished from the slot.
          //
          // The card presents that row as "Width (guessed)". Typing a figure
          // into it accepts the slot and fixes the number, which is exactly
          // what `slotSuggested: false` means everywhere else -- and it stops
          // the re-guess touching the rest of the item, so the three slots
          // around the corrected one are not re-derived around a figure that
          // is now somebody's decision.
          //
          // Only where the row already HAS a slot. Editing a note's figure
          // says nothing about which of the five it might be.
          // ====================================================================
          ...(changes.value !== undefined && observation.dimensionSlot ? { slotSuggested: false } : {}),
          ...(changes.value !== undefined ? { value: typed?.value ?? changes.value } : {}),
          // An explicit `unit` in the same request still wins — the select is
          // the reviewer being deliberate about the unit, the text box is not.
          ...(typed?.unit && changes.unit === undefined
            ? { unit: typed.unit, unitSuggested: false, unitSource: undefined }
            : {}),
          ...(changes.unit !== undefined
            ? { unit: changes.unit, unitSuggested: false, unitSource: undefined }
            : {}),
          // Choosing a group or a field is a DECISION about what this callout
          // is, so the row stops being a guess and stops being re-read. Same
          // rule as `slotSuggested` above, for the same reason.
          ...(changes.attrGroup !== undefined || changes.specFieldId !== undefined
            ? { groupSuggested: false, groupReason: null }
            : {}),
          ...(changes.attrGroup !== undefined ? { attrGroup: changes.attrGroup } : {}),
          ...(changes.dimensionSlot !== undefined ? { dimensionSlot: changes.dimensionSlot, slotSuggested: false } : {}),
          ...(changes.specFieldId !== undefined ? { specFieldId: changes.specFieldId } : {}),
          ...(changes.state !== undefined ? { state: changes.state, stateReason: null } : {}),
          ...(changes.label !== undefined ? { labelRaw: changes.label } : {}),
          ...(changes.replaces !== undefined ? { replaces: changes.replaces } : {}),
        };
        // Refused by the database; caught here so the reviewer gets a
        // sentence instead of a 500. A NOTE may carry a unit — 0011 widened
        // that so "ARM HEIGHT 520mm" keeps its unit in its own column.
        if (next.unit !== null && next.attrGroup !== "dimension" && next.attrGroup !== "note") {
          throw new DomainConflictError("unit_not_a_measurement", "Only a dimension or a note can carry a unit.", {
            status: 400,
          });
        }
        // 0011's biconditional: a dimension has a slot, nothing else does. The
        // screen sends both in ONE patch, so the staged row is never left in a
        // shape the database would refuse at confirm.
        if (next.attrGroup === "dimension" && !next.dimensionSlot) {
          throw new DomainConflictError(
            "dimension_needs_slot",
            "Say which dimension this is — width, depth, height, seat height or diameter.",
            { status: 400 },
          );
        }
        if (next.attrGroup !== "dimension" && next.dimensionSlot) {
          next.dimensionSlot = null;
        }
        items = staged.items.map((row) =>
          row.id !== itemId
            ? row
            : { ...row, observations: row.observations.map((o) => (o.id === observationId ? next : o)) },
        );
      }

      const written = await txn`
        update intake_runs
        set parsed = ${JSON.stringify({ ...staged, items })}::jsonb, updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("not_reviewable", "This import closed while you were editing it.");
      return { version: Number(written[0].version) };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- a preamble note's autosave --------------------------------------------

const PreamblePatch = z
  .object({
    noteId: z.string().min(1),
    expectedVersion: z.number().int().nonnegative(),
    changes: z
      .object({
        topic: z.string().max(300).nullable().optional(),
        title: z.string().max(300).nullable().optional(),
        body: z.string().max(8000).nullable().optional(),
      })
      .strict(),
  })
  .strict();

async function patchPreamble(id: string, raw: unknown, actor: string): Promise<Response> {
  const parsed = PreamblePatch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That change is not valid." }, 400);
  }
  const { noteId, expectedVersion, changes } = parsed.data;
  if (Object.keys(changes).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`
        select id, status, parsed, version from intake_runs where id = ${id} for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.status !== "parsed") {
        throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)}, not open for editing.`);
      }
      const staged: StagedPreamble = assertStagedPreamble(run.parsed);
      const note = staged.notes.find((row) => row.id === noteId);
      if (!note) throw new DomainConflictError("note_missing", "That note is no longer part of this import. Reload.");
      if (note.reviewStatus !== "pending") {
        throw new DomainConflictError(
          "note_reviewed",
          `That note has already been ${note.reviewStatus}. Reload to see the current state.`,
        );
      }
      if (note.version !== expectedVersion) {
        throw new DomainConflictError("note_version_stale", "That note was edited in another tab. Reload.");
      }

      // The reviewer's text changes; `*Raw` keeps what the document said, so a
      // value can always be traced back to its page.
      const notes = staged.notes.map((row) =>
        row.id === noteId ? { ...row, version: row.version + 1, ...changes } : row,
      );
      const written = await txn`
        update intake_runs
        set parsed = ${JSON.stringify({ ...staged, notes })}::jsonb, updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("not_reviewable", "This import closed while you were editing it.");
      return { version: Number(written[0].version) };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}



export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const rows = await sql`
    select r.id, r.project_id, r.status, r.parsed, r.error, r.version, r.confirmed_at,
           r.source_kind, r.document_kind, r.model, r.model_metadata,
           r.attempt_id, r.claim_count, r.queued_at,
           (r.attempt_deadline_at > now()) as within_deadline,
           (r.status = 'parsing' and r.processing_started_at > now() - interval '360 seconds') as claim_live,
           p.bws_project_number, p.name as project_name,
           a.filename
    from intake_runs r
    join projects p on p.id = r.project_id
    left join attachments a on a.id = r.attachment_id
    where r.id = ${id}
  `;
  const row = rows[0];
  if (!row) return json({ ok: false, error: "No such import." }, 404);

  // ==========================================================================
  // `pending` COVERS TWO STATES, AND THE SCREENS SAID THE WRONG ONE.
  //
  // A document the per-pack cap DEFERRED sits at `pending` with no attempt and
  // a live deadline — the pair `openAttempt` never writes, because it always
  // writes both (`src/lib/extraction-slots.ts`). The three single-document
  // review screens read the status alone and said "has not been read", which is
  // the sentence for a document waiting for a PERSON, over one the app is going
  // to read on its own as soon as a slot frees.
  //
  // THE SAME PREDICATE IS IN SQL IN TWO PLACES — the pack screen's
  // src/app/api/projects/[id]/batches/route.ts and the drawings step's
  // src/lib/drawing-resolution.ts, where it has to be SQL because those
  // aggregate over a whole pack. Here the row is already in hand and both its
  // columns are already selected, so this reads them rather than adding a third
  // copy of the SQL. Change one and change the others, or the pack screen and a
  // document's own screen start disagreeing about which documents are waiting.
  // ==========================================================================
  const waitingForSlot = row.status === "pending" && !row.attempt_id && Boolean(row.within_deadline);
  const run: Row = { ...row, waitingForSlot };

  if (run.source_kind === "spec_document" && run.document_kind === "shop_drawings") {
    // Resolution is LIVE, never stored. Confirming the pack's BOQ after this
    // extraction ran is normal, and a stored target would be stale from that
    // moment on — the screen and the confirm route would then disagree about
    // whether a card can commit, which is what lets a half-reviewed card
    // through. Both sides call the same functions instead.
    if (!run.parsed) return json({ ok: true, import: { ...run, parsed: null } });
    // The register FIRST: a callout the old word lists gave up on is re-read on
    // the way past (`upgradeCalloutGuesses`), and it can only claim COM 1 if it
    // is holding the field ids while it does.
    const fields = await sql`select id, json_id, name, field_category from spec_fields order by sort_order`;
    const staged = assertStagedDrawings(run.parsed, specFieldEntries(fields));
    // The same pairing the pack-wide screen uses, so the two can never disagree
    // about whether a card can commit. See src/lib/drawing-resolution.ts.
    const context = await loadDrawingContext(String(run.project_id));
    const items = resolveStagedRun(staged, context);
    return json({
      ok: true,
      import: { ...run, parsed: staged },
      resolution: items,
      specFields: fields,
      records: recordChoices(context),
    });
  }

  if (run.source_kind === "spec_document" && run.document_kind === "preamble") {
    if (!run.parsed) return json({ ok: true, import: { ...run, parsed: null } });
    const staged = assertStagedPreamble(run.parsed);
    return json({ ok: true, import: { ...run, parsed: staged }, blockers: preambleNoteBlockers(staged) });
  }

  if (run.source_kind === "spec_document") {
    // The registers the review screen's selects are built from. Loaded here so
    // the screen never has to guess which questions a category has.
    const registers = await loadExtractionRegisters(String(run.project_id));
    const parsed = (run.parsed ?? null) as StagedSpecDocument | null;

    // An email carries its own header panel: who sent it, when, and a link
    // that opens it in Outlook. A proposal off an email has no page to turn
    // to, so the message itself is what a reviewer checks it against.
    const messageRows =
      run.document_kind === "email"
        ? await sql`
            select em.id, em.from_addr, em.from_name, em.subject, em.received_at,
                   em.to_addrs, em.cc_addrs, em.attachments_meta, em.has_attachments,
                   em.routing_reason, em.chase_match, em.triage, em.version,
                   -- The PLAIN TEXT body, for the screen's own message tab. The
                   -- html body is deliberately not selected: it is markup a
                   -- stranger wrote, and the two routes that serve the raw .eml
                   -- both force a download for that reason.
                   em.body_text,
                   d.subject as chase_subject, d.sent_at as chase_sent_at,
                   d.recipient_name as chase_recipient_name,
                   (select count(*) from email_draft_items i where i.draft_id = d.id) as chase_question_count
            from email_messages em
            left join email_drafts d on d.id = em.chase_draft_id
            where em.intake_run_id = ${run.id}
          `
        : [];

    return json({
      ok: true,
      import: { ...run, parsed },
      message: messageRows[0] ?? null,
      registers: {
        records: registers.records,
        requirements: registers.requirements,
      },
    });
  }

  const categories = await sql`
    select id, slug, family, name, requirements_authored from item_categories order by family, sort_order
  `;

  // No matching here. Suggestions were computed and stored when the file was
  // parsed, so the reviewer sees exactly what confirm will write. Recomputing
  // on read would let the two drift apart between the screen and the commit.
  const parsed = run.parsed ? assertBoqDocument(run.parsed) : null;

  // The runs this bill could be a revision OF, and — for a sheet that names
  // one — how its lines line up against that run's records.
  //
  // Computed on READ rather than stored, which is the opposite of the line
  // suggestions above, and deliberately: a suggestion is a proposal the
  // reviewer edits and the confirm writes, so it has to be frozen. A
  // reconciliation is a VIEW of live records, and those move — a record
  // retired or re-categorised since the page loaded must show as it is now.
  // What the confirm writes is the reviewer's stored `replaces`, never this.
  const runs = await sql`
    select r.id, r.name, r.status, r.boq_revision, r.boq_date,
           (select count(*)::int from spec_records x where x.run_id = r.id and x.status = 'active') as record_count
    from spec_runs r
    where r.project_id = ${run.project_id} and r.status = 'active'
    order by r.sort_order, r.created_at
  `;

  const reconciliation: Record<number, unknown> = {};
  if (parsed) {
    for (const [sheetIndex, sheet] of parsed.sheets.entries()) {
      const replacesRunId = sheet.replacesRunId ?? null;
      if (!replacesRunId) continue;
      const recordRows = await sql`
        select r.id, r.version, r.record_no, r.item_description, r.product_reference, r.qty,
               r.designer, r.area, r.boq_category, p.bws_project_number,
               coalesce((select array_agg(x.ref_value order by x.ref_value)
                           from spec_record_refs x
                          where x.record_id = r.id and x.ref_system = 'boq_code'), '{}') as codes,
               (select count(*)::int from record_attributes a where a.record_id = r.id and a.status = 'active') as attribute_count,
               exists (select 1 from attachments at
                        where at.entity_type = 'spec_records' and at.entity_id = r.id and at.kind = 'item_image') as has_image,
               (select count(*)::int from spec_answers a
                 where a.record_id = r.id and a.revision_no = 0 and a.state <> 'missing') as settled_answers
        from spec_records r
        join projects p on p.id = r.project_id
        where r.run_id = ${replacesRunId} and r.status = 'active'
        order by r.record_no
      `;
      const existing: ExistingRecord[] = recordRows.map((row) => ({
        id: String(row.id),
        version: Number(row.version),
        recordNo: Number(row.record_no),
        label: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
        itemDescription: String(row.item_description),
        productReference: row.product_reference === null || row.product_reference === undefined ? null : String(row.product_reference),
        qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
        designer: row.designer === null || row.designer === undefined ? null : String(row.designer),
        area: row.area === null || row.area === undefined ? null : String(row.area),
        boqCategory: row.boq_category === null || row.boq_category === undefined ? null : String(row.boq_category),
        codes: (row.codes as string[] | null)?.map(String) ?? [],
        attributeCount: Number(row.attribute_count),
        hasImage: Boolean(row.has_image),
        settledAnswers: Number(row.settled_answers),
      }));
      const lines: RevisedLine[] = sheet.lines.map((line) => ({
        index: line.index,
        lineNo: line.lineNo,
        code: line.code,
        itemDescription: line.itemDescription,
        productReference: line.productReference,
        qty: line.qty,
        designer: line.designer,
        area: line.area,
        boqCategory: line.boqCategory,
        ignored: line.ignored,
        replaces: line.replaces ?? null,
      }));
      reconciliation[sheetIndex] = { ...reconcileSheet(lines, existing), records: existing };
    }
  }

  return json({ ok: true, import: { ...run, parsed }, categories, runs, reconciliation });
}

// ---- the BOQ's positional autosave -----------------------------------------
// Merges the reviewer's change into the line that is still present at that
// index, rather than writing back an array the client sent -- a snapshot
// rewrite races another tab's autosave and silently reverts it.
async function patchBoqLine(
  id: string,
  body: {
    sheetIndex?: unknown;
    index?: unknown;
    categoryId?: unknown;
    level?: unknown;
    ignored?: unknown;
    runName?: unknown;
    replacesRunId?: unknown;
    replaces?: unknown;
  },
  actor: string,
): Promise<Response> {
  const sheetIndex = typeof body.sheetIndex === "number" ? body.sheetIndex : null;
  if (sheetIndex === null) return json({ ok: false, error: "sheetIndex is required." }, 400);
  const index = typeof body.index === "number" ? body.index : null;

  // A SHEET-level change: its run name, or dropping the tab entirely. Addressed
  // the same way and merged into the live row, never written back wholesale.
  if (index === null) {
    const patch: Record<string, unknown> = {};
    // Changing what a sheet revises invalidates every pairing under it: a line
    // paired to a record on the OLD run would otherwise be written into the
    // new one. The confirm refuses that too, but a pairing left on screen that
    // the confirm will reject is a trap rather than a safeguard.
    let clearPairings = false;
    if (typeof body.runName === "string") {
      const name = body.runName.trim();
      if (name === "") return json({ ok: false, error: "A phase needs a name." }, 400);
      if (name.length > 200) return json({ ok: false, error: "That phase name is too long." }, 400);
      patch.proposedRunName = name;
    }
    if (typeof body.ignored === "boolean") {
      patch.ignored = body.ignored;
      patch.ignoredReason = body.ignored ? "Ignored by the reviewer." : null;
    }
    // Which run this sheet REVISES, or null for a new run. Stored rather than
    // inferred at confirm: pairing a revised bill to an existing run is
    // matching, and the confirm writes what the reviewer approved.
    if (body.replacesRunId !== undefined) {
      if (body.replacesRunId !== null && typeof body.replacesRunId !== "string") {
        return json({ ok: false, error: "replacesRunId must be a run id or null." }, 400);
      }
      patch.replacesRunId = body.replacesRunId;
      clearPairings = true;
    }
    if (Object.keys(patch).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

    const rows = await sql`
      update intake_runs
      set parsed = jsonb_set(
            parsed,
            array['sheets', ${String(sheetIndex)}],
            coalesce(parsed->'sheets'->(${sheetIndex}::int), '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
          ),
          updated_by = ${actor}
      where id = ${id}
        and status = 'parsed'
        and parsed->'sheets'->(${sheetIndex}::int) is not null
      returning version
    `;
    if (rows[0] && clearPairings) {
      await sql`
        update intake_runs
        set parsed = jsonb_set(
              parsed,
              array['sheets', ${String(sheetIndex)}, 'lines'],
              (
                select coalesce(jsonb_agg(line || '{"replaces": null}'::jsonb), '[]'::jsonb)
                from jsonb_array_elements(coalesce(parsed->'sheets'->(${sheetIndex}::int)->'lines', '[]'::jsonb)) as line
              )
            ),
            updated_by = ${actor}
        where id = ${id} and status = 'parsed'
      `;
    }
    if (!rows[0]) {
      return json({ ok: false, error: "That sheet is no longer in this import, or the import is already confirmed." }, 409);
    }
    return json({ ok: true, version: rows[0].version });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.categoryId === "string" || body.categoryId === null) {
    patch.categoryId = body.categoryId;
    patch.categoryStatus = body.categoryId ? "chosen" : "none";
  }
  // The level, chosen rather than guessed. `chosen` is what tells the confirm
  // to write `spec_records.level` — the column the quote gate reads — instead
  // of the advisory `level_suggested`, so this flag is the human decision the
  // whole model rests on. Clearing it (null) is a real answer too: "I do not
  // know yet", which leaves the record with no level and says so.
  if (body.level !== undefined) {
    if (body.level !== null && !isItemLevel(body.level)) {
      return json({ ok: false, error: "A level is simple, complex or hero." }, 400);
    }
    patch.level = body.level;
    patch.levelStatus = "chosen";
    patch.levelReason = null;
  }
  if (typeof body.ignored === "boolean") patch.ignored = body.ignored;
  // The record this line continues. `null` breaks the pairing, which makes the
  // line new and the record missing — both visible, neither silent.
  if (body.replaces !== undefined) {
    if (body.replaces === null) {
      patch.replaces = null;
    } else {
      const replaces = body.replaces as { recordId?: unknown; recordVersion?: unknown };
      if (typeof replaces?.recordId !== "string" || typeof replaces?.recordVersion !== "number") {
        return json({ ok: false, error: "A pairing names a record and the version you were shown." }, 400);
      }
      patch.replaces = { recordId: replaces.recordId, recordVersion: replaces.recordVersion };
    }
  }
  if (Object.keys(patch).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  const rows = await sql`
    update intake_runs
    set parsed = jsonb_set(
          parsed,
          array['sheets', ${String(sheetIndex)}, 'lines', ${String(index)}],
          coalesce(parsed->'sheets'->(${sheetIndex}::int)->'lines'->(${index}::int), '{}'::jsonb)
            || ${JSON.stringify(patch)}::jsonb
        ),
        updated_by = ${actor}
    where id = ${id}
      and status = 'parsed'
      and parsed->'sheets'->(${sheetIndex}::int)->'lines'->(${index}::int) is not null
    returning version
  `;
  if (!rows[0]) {
    return json({ ok: false, error: "That line is no longer in this import, or the import is already confirmed." }, 409);
  }
  return json({ ok: true, version: rows[0].version });
}

// ---- a proposal's autosave --------------------------------------------------

const ProposalPatch = z
  .object({
    proposalId: z.string().uuid(),
    expectedProposalVersion: z.number().int().nonnegative(),
    changes: z
      .object({
        proposedValue: z.string().max(4000).nullable().optional(),
        proposedState: z.enum(ANSWER_STATES).nullable().optional(),
        overwriteAcknowledged: z.boolean().optional(),
        // Retargeting. A dedicated operation: it revalidates membership,
        // rebuilds the snapshot, and clears what the old target justified.
        recordId: z.string().uuid().nullable().optional(),
        requirementId: z.string().uuid().nullable().optional(),
        // A DIMENSION's unit, which the email often does not state. There is
        // deliberately no magnitude fallback anywhere in the dimension model,
        // so where the wording carries no unit a person supplies one or the
        // cell renders the figure verbatim saying why.
        dimensionUnit: z.enum(ATTRIBUTE_UNITS).nullable().optional(),
      })
      .strict(),
  })
  .strict();

async function patchProposal(id: string, raw: unknown, actor: string): Promise<Response> {
  const parsed = ProposalPatch.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That change is not valid." }, 400);
  }
  const { proposalId, expectedProposalVersion, changes } = parsed.data;
  if (Object.keys(changes).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  const retargeting = "recordId" in changes || "requirementId" in changes;

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`
        select id, project_id, status, parsed, version, source_kind
        from intake_runs where id = ${id}
        for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.status !== "parsed") {
        throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)} and cannot be edited.`);
      }

      const staged = (run.parsed ?? null) as StagedSpecDocument | null;
      if (!staged?.lines) throw new DomainConflictError("not_staged", "This import has nothing staged.");

      // By id, in the LOCKED json. Never by position.
      const proposal = staged.lines.find((line) => line.id === proposalId);
      if (!proposal) throw new DomainConflictError("proposal_missing", "That row is no longer part of this import.");
      if (proposal.reviewStatus !== "pending") {
        throw new DomainConflictError(
          "proposal_reviewed",
          `That row has already been ${proposal.reviewStatus} and cannot be edited.`,
        );
      }
      // PER-PROPOSAL optimistic lock. The run's coarse version is bumped by
      // every autosave on every row, so using it here would make two people
      // editing two different rows conflict with each other for no reason.
      if (proposal.version !== expectedProposalVersion) {
        throw new DomainConflictError(
          "proposal_version_stale",
          "This row was edited in another tab. Its current value is shown; yours was not saved.",
          { diff: { proposal } },
        );
      }

      let next: Proposal = { ...proposal };

      if (retargeting) {
        const registers = await loadExtractionRegisters(String(run.project_id));
        const recordId = "recordId" in changes ? changes.recordId ?? null : proposal.recordId;
        const record = recordId ? registers.records.find((row) => row.id === recordId) ?? null : null;
        if (recordId && !record) {
          throw new DomainConflictError("record_missing", "That record is not part of this project.", { status: 400 });
        }

        // A requirement is only valid inside the chosen record's category.
        //
        // EXPLICIT and CARRIED-OVER are handled differently, and conflating them
        // was a bug: moving a proposal to a record in another category carried
        // the old question along, found it invalid there, and REFUSED the whole
        // edit — for a question the reviewer had not chosen and could not see.
        // An explicitly sent question that does not fit is a refusal; one merely
        // inherited from the old record is silently cleared.
        const explicitRequirement = "requirementId" in changes;
        const requirementId = explicitRequirement ? changes.requirementId ?? null : proposal.requirementId;
        const requirement =
          requirementId && record
            ? registers.requirements.find((row) => row.id === requirementId && row.categoryId === record.categoryId) ?? null
            : null;
        if (explicitRequirement && requirementId && !requirement) {
          throw new DomainConflictError(
            "requirement_mismatch",
            "That question does not belong to the chosen item's category.",
            { status: 400 },
          );
        }

        next = {
          ...next,
          recordId: record ? record.id : null,
          // INCOMPATIBLE selections are cleared, not every selection. Moving a
          // proposal to another record in the SAME category keeps the question
          // -- it is still one of that item's questions -- but the snapshot
          // below is rebuilt against the new record's answer, which is what the
          // reviewer has to see before confirming. Moving it to a record in a
          // different category leaves `requirement` null and clears it.
          requirementId: requirement ? requirement.id : null,
          target: record && requirement ? buildTargetSnapshot(record, requirement, registers.answers) : null,
          // The old acknowledgement was about a different answer entirely.
          overwriteAcknowledged: false,
        };

        // A fresh suggestion for a newly reachable target, but only where the
        // reviewer has not already typed something of their own.
        if (next.target && next.proposedState === null && next.proposedValue === proposal.raw.valueRaw) {
          const suggestion = suggestState(proposal.raw.valueRaw);
          next.proposedState = suggestion.state;
          next.proposedValue = suggestion.value;
          next.stateReason = suggestion.reason;
        }
      }

      if ("proposedValue" in changes) next.proposedValue = changes.proposedValue ?? null;
      if ("proposedState" in changes) {
        next.proposedState = changes.proposedState ?? null;
        // A state the reviewer chose needs no explanation of why none was
        // suggested.
        if (changes.proposedState) next.stateReason = null;
      }
      // Setting the unit is a PERSON deciding, so it is recorded as such:
      // `unitSource` stops being "stated" and the screen stops calling it the
      // email's own. Refused on a row that is not a dimension rather than
      // silently ignored, or a client could believe it had set one.
      if ("dimensionUnit" in changes) {
        if (!proposal.dimension) {
          throw new DomainConflictError("not_a_dimension", "That row is not a dimension.", { status: 400 });
        }
        next.dimension = {
          ...proposal.dimension,
          unit: changes.dimensionUnit ?? null,
          unitSource: changes.dimensionUnit ? "reviewer" : null,
        };
      }

      if ("overwriteAcknowledged" in changes && !retargeting) {
        next.overwriteAcknowledged = Boolean(changes.overwriteAcknowledged);
      }

      next.version = proposal.version + 1;

      // The full replacement value is assembled HERE, from the locked current
      // row -- never from an array the client sent.
      const lines = staged.lines.map((line) => (line.id === proposalId ? next : line));
      const written = await txn`
        update intake_runs
        set parsed = ${JSON.stringify({ ...staged, lines })}::jsonb, updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("not_reviewable", "This import changed while you were editing.");

      return { proposal: next, version: Number(written[0].version) };
    });

    return json({ ok: true, proposal: result.proposal, version: result.version });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  // Which shape, read from the run, not from the request.
  const rows = await sql`select source_kind, document_kind from intake_runs where id = ${id}`;
  if (!rows[0]) return json({ ok: false, error: "No such import." }, 404);

  if (rows[0].document_kind === "shop_drawings") {
    // Two shapes on one route, told apart by the key the body carries rather
    // than by a mode flag: a bulk set names no observation and carries no
    // version, so it cannot be validated by `DrawingPatch` at all.
    if (raw && typeof raw === "object" && "bulkUnit" in raw) return patchBulkUnit(id, raw, user.email);
    return patchDrawing(id, raw, user.email);
  }
  if (rows[0].document_kind === "preamble") return patchPreamble(id, raw, user.email);
  if (rows[0].source_kind === "spec_document") return patchProposal(id, raw, user.email);
  return patchBoqLine(id, (raw ?? {}) as Record<string, unknown>, user.email);
}
