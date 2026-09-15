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
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import {
  buildTargetSnapshot,
  suggestState,
  type Proposal,
  type StagedSpecDocument,
} from "@/lib/spec-document";
import { ANSWER_STATES, ATTRIBUTE_GROUPS, ATTRIBUTE_STATES, ATTRIBUTE_UNITS } from "@/lib/spec-vocab";
import { assertBoqV2 } from "@/lib/boq-import";
import {
  assertStagedDrawings,
  drawingItemBlockers,
  drawingItemWarnings,
  resolveDrawingTargets,
  splitFigureAndUnit,
  targetRecordIds,
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
      const staged: StagedDrawings = assertStagedDrawings(run.parsed);
      if (scope === "item" && !staged.items.some((item) => item.id === itemId)) {
        throw new DomainConflictError("item_missing", "That item is no longer part of this import. Reload.");
      }

      let changed = 0;
      const items = staged.items.map((item) => {
        if (scope === "item" && item.id !== itemId) return item;
        let touched = false;
        const observations = item.observations.map((observation) => {
          if (observation.reviewStatus !== "pending") return observation;
          if (observation.attrGroup !== "dimension") return observation;
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
        specFieldId: z.string().uuid().nullable().optional(),
        state: z.enum(ATTRIBUTE_STATES).nullable().optional(),
        label: z.string().max(300).optional(),
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
      const staged: StagedDrawings = assertStagedDrawings(run.parsed);
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
          ...(changes.value !== undefined ? { value: typed?.value ?? changes.value } : {}),
          // An explicit `unit` in the same request still wins — the select is
          // the reviewer being deliberate about the unit, the text box is not.
          ...(typed?.unit && changes.unit === undefined
            ? { unit: typed.unit, unitSuggested: false, unitSource: undefined }
            : {}),
          ...(changes.unit !== undefined
            ? { unit: changes.unit, unitSuggested: false, unitSource: undefined }
            : {}),
          ...(changes.attrGroup !== undefined ? { attrGroup: changes.attrGroup } : {}),
          ...(changes.specFieldId !== undefined ? { specFieldId: changes.specFieldId } : {}),
          ...(changes.state !== undefined ? { state: changes.state, stateReason: null } : {}),
          ...(changes.label !== undefined ? { labelRaw: changes.label } : {}),
        };
        // A unit on anything but a dimension is refused by the database; catch
        // it here so the reviewer gets a sentence instead of a 500.
        if (next.unit !== null && next.attrGroup !== "dimension") {
          throw new DomainConflictError("unit_not_a_dimension", "Only a dimension can carry a unit.", { status: 400 });
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
  const run = rows[0];
  if (!run) return json({ ok: false, error: "No such import." }, 404);

  if (run.source_kind === "spec_document" && run.document_kind === "shop_drawings") {
    // Resolution is LIVE, never stored. Confirming the pack's BOQ after this
    // extraction ran is normal, and a stored target would be stale from that
    // moment on — the screen and the confirm route would then disagree about
    // whether a card can commit, which is what lets a half-reviewed card
    // through. Both sides call the same functions instead.
    if (!run.parsed) return json({ ok: true, import: { ...run, parsed: null } });
    const staged = assertStagedDrawings(run.parsed);
    const registers = await loadExtractionRegisters(String(run.project_id));
    const occupied = await loadOccupiedFields(String(run.project_id));
    const items = staged.items.map((item) => {
      const resolution = resolveDrawingTargets(item.itemCodeRaw, registers.records);
      return {
        id: item.id,
        resolution,
        targets: targetRecordIds(item, resolution),
        blockers: drawingItemBlockers(item, resolution, occupied),
        // Separate from blockers on purpose — these do not stop a commit, and
        // the confirm route never sees them. See drawingItemWarnings().
        warnings: drawingItemWarnings(item),
      };
    });
    const fields = await sql`select id, json_id, name, field_category from spec_fields order by sort_order`;
    return json({ ok: true, import: { ...run, parsed: staged }, resolution: items, specFields: fields });
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
    return json({
      ok: true,
      import: { ...run, parsed },
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
  const parsed = run.parsed ? assertBoqV2(run.parsed) : null;
  return json({ ok: true, import: { ...run, parsed }, categories });
}

// ---- the BOQ's positional autosave -----------------------------------------
// Merges the reviewer's change into the line that is still present at that
// index, rather than writing back an array the client sent -- a snapshot
// rewrite races another tab's autosave and silently reverts it.
async function patchBoqLine(
  id: string,
  body: { sheetIndex?: unknown; index?: unknown; categoryId?: unknown; ignored?: unknown; runName?: unknown },
  actor: string,
): Promise<Response> {
  const sheetIndex = typeof body.sheetIndex === "number" ? body.sheetIndex : null;
  if (sheetIndex === null) return json({ ok: false, error: "sheetIndex is required." }, 400);
  const index = typeof body.index === "number" ? body.index : null;

  // A SHEET-level change: its run name, or dropping the tab entirely. Addressed
  // the same way and merged into the live row, never written back wholesale.
  if (index === null) {
    const patch: Record<string, unknown> = {};
    if (typeof body.runName === "string") {
      const name = body.runName.trim();
      if (name === "") return json({ ok: false, error: "A run needs a name." }, 400);
      if (name.length > 200) return json({ ok: false, error: "That run name is too long." }, 400);
      patch.proposedRunName = name;
    }
    if (typeof body.ignored === "boolean") {
      patch.ignored = body.ignored;
      patch.ignoredReason = body.ignored ? "Ignored by the reviewer." : null;
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
  if (typeof body.ignored === "boolean") patch.ignored = body.ignored;
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

/**
 * Which BWS fields are already spoken for, per record.
 *
 * Read live for the same reason the resolution is: a slot filled by another
 * card a second ago must show as a blocker here, not as a unique-violation 500
 * at confirm.
 */
async function loadOccupiedFields(projectId: string): Promise<Map<string, Set<string>>> {
  const rows = await sql`
    select a.record_id, a.spec_field_id
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where r.project_id = ${projectId} and a.status = 'active' and a.spec_field_id is not null
  `;
  const occupied = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = occupied.get(String(row.record_id)) ?? new Set<string>();
    set.add(String(row.spec_field_id));
    occupied.set(String(row.record_id), set);
  }
  return occupied;
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
