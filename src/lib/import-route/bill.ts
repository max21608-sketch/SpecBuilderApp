// The import route's BILL half: the review GET and every autosave on a staged bill line or sheet.
// Moved out of src/app/api/imports/[id]/route.ts on 2026-11-07 (audit 5.3, cut D); the route is now the dispatcher.

import { billSheetNotices } from "@/lib/bill-sheet-notices";
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { z } from "zod";
import { sql, json, type Row } from "@/lib/db";
import { withTransaction, transactionErrorResponse, DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { isItemLevel } from "@/lib/spec-vocab";
import { assertBoqDocument } from "@/lib/boq-import";
import { billPicturePrefix, rowImageFor, type BillPictureCrop, type BillPictureOverride } from "@/lib/bill-row-image";
import { assertProjectScopedPathname, headTrustedBlob } from "@/lib/blob-source";
import { isPictureContentType } from "@/lib/picture-types";
import { fabricParentOptions, isBoqRowKind, kindChoicePatch } from "@/lib/boq-row-kinds";
import { billSpecsRequestId } from "@/lib/bill-specifications";
import {
  billItemName,
  billReadsDescriptions,
  isSlotOverride,
  placedSizeOf,
  planSheetDescriptions,
  lineStatements,
  lineSizeNeedsUnit,
  isBillUnitOverride,
  type BillUnitOverride,
  sheetColumnHeadings,
  resolveSlotOverrides,
  slotChangeFor,
  revisionDescriptionRefusal,
  type SlotOverride,
  type BillDescriptionPlan,
} from "@/lib/bill-description";
import { loadDescriptionFields, loadHeldAttributes } from "@/lib/bill-description-load";
import { billFinishPlanInputs, planBillFabrics, type FabricLinePlan } from "@/lib/bill-fabric-filing";
import {
  loadCurrentSwatches,
  loadFinishCodePrefix,
  loadFinishLibrary,
  loadHeldBillFinishes,
} from "@/lib/bill-fabric-load";
// Pure: which rows on the OTHER tabs a decision reaches, and what lands on
// them. The screen reads the same module for its duplicate panel, so the rows
// it calls ambiguous and the rows the carry refuses are one set.
import { planCarry, listTabs, type CarryDecision, type CarrySheet } from "@/lib/boq-carry";
import { reconcileSheet, type ExistingRecord, type RevisedLine } from "@/lib/boq-reconcile";

// ---- the review GET for a bill ---------------------------------------------

/** The bill review: the staged sheets and everything planned on read beside them. */
export async function getBillReview(run: Row): Promise<Response> {
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
      // THE PHASE'S BILL LINES, live and retired (audit 2026-11-06, 1.2). A
      // configuration is never a candidate: it carries no bill code, so no
      // revised line can pair with it, and listed here every one read as "no
      // longer listed" and the confirm retired it. It follows its line, and is
      // named beside it instead. A line an earlier revision RETIRED is loaded
      // so a line carrying its code again can be offered it back (C14).
      const recordRows = await sql`
        select r.id, r.version, r.record_no, r.status, r.item_description, r.product_reference, r.qty,
               r.designer, r.area, r.boq_category, p.bws_project_number, r.variant_ordinal,
               null::int as parent_record_no,
               coalesce((select array_agg(x.ref_value order by x.ref_value)
                           from spec_record_refs x
                          where x.record_id = r.id and x.ref_system = 'boq_code'), '{}') as codes,
               (select count(*)::int from record_attributes a where a.record_id = r.id and a.status = 'active') as attribute_count,
               exists (select 1 from attachments at
                        where at.entity_type = 'spec_records' and at.entity_id = r.id and at.kind = 'item_image'
                          and at.superseded_at is null) as has_image,
               (select count(*)::int from spec_answers a
                 where a.record_id = r.id and a.revision_no = 0 and a.state <> 'missing') as settled_answers,
               -- Live configurations, by their number under the line; for a
               -- retired line, the ones retired with it at the same moment,
               -- which are what a restore brings back.
               coalesce((select array_agg(c.variant_ordinal order by c.variant_ordinal)
                           from spec_records c
                          where c.parent_id = r.id
                            and (case when r.status = 'active' then c.status = 'active'
                                      else c.status = 'retired' and c.retired_at = r.retired_at end)), '{}') as configuration_ordinals
        from spec_records r
        join projects p on p.id = r.project_id
        where r.run_id = ${replacesRunId} and r.status in ('active', 'retired') and r.parent_id is null
        order by r.record_no
      `;
      const toExisting = (row: Record<string, unknown>): ExistingRecord => ({
        id: String(row.id),
        version: Number(row.version),
        recordNo: Number(row.record_no),
        label: recordLabel(String(row.bws_project_number), numberingFromRow(row)),
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
        configurations: ((row.configuration_ordinals as unknown[] | null) ?? []).map(
          (ordinal) => `${Number(row.record_no)}.${Number(ordinal)}`,
        ),
      });
      const existing = recordRows.filter((row) => row.status === "active").map(toExisting);
      const retired = recordRows.filter((row) => row.status === "retired").map(toExisting);
      // A FABRIC LINE IS NOT A RECORD, so it is never paired with one: it is
      // written onto its item at confirm, and listing it here would offer it a
      // record to continue and count it as a new line.
      const lines: RevisedLine[] = sheet.lines.filter((line) => line.rowKind !== "finish_for").map((line) => ({
        index: line.index,
        lineNo: line.lineNo,
        code: line.code,
        // The NAME the record will carry, so a revision compares like with
        // like: a record's description is its cell's first line.
        itemDescription: billItemName(line),
        productReference: line.productReference,
        qty: line.qty,
        designer: line.designer,
        area: line.area,
        subArea: line.subArea,
        boqCategory: line.boqCategory,
        ignored: line.ignored,
        replaces: line.replaces ?? null,
      }));
      reconciliation[sheetIndex] = { ...reconcileSheet(lines, existing, retired), records: existing, retired };
    }
  }

  // THE DESCRIPTION CELLS, planned by the function the confirm writes them
  // with (`planSheetDescriptions`), against the same register — so what this
  // screen shows under each line is exactly what the confirm writes. Computed
  // on read and never stored: a line re-kinded as a fabric line changes which
  // item "has a fabric line", and a frozen plan would then disagree with the
  // confirm. A line a REVISION carries says, in the confirm's own words, when
  // its description will not be written.
  const descriptions: Record<number, Record<number, unknown>> = {};
  /**
   * Per sheet, each item line's description plan and whether a revision holds
   * it back — what the finish plan below reads, through `billFinishPlanInputs`,
   * exactly as the confirm does.
   */
  const descriptionPlans: Map<number, { attributes: BillDescriptionPlan["attributes"]; held: boolean }>[] = [];
  /** The register the descriptions were planned against: field id → json id. */
  const jsonIdOfField = new Map<string, number>();
  if (parsed) {
    const fields = await loadDescriptionFields(sql);
    for (const field of fields) jsonIdOfField.set(field.id, field.jsonId);
    for (const [sheetIndex, sheet] of parsed.sheets.entries()) {
      const plans = planSheetDescriptions(sheet.lines, fields, sheetColumnHeadings(sheet));
      if (plans.size === 0) continue;
      const carried = sheet.lines.flatMap((line) =>
        line.replaces && plans.has(line.index) ? [line.replaces.recordId] : [],
      );
      const held = await loadHeldAttributes(sql, carried);
      const bySheet: Record<number, unknown> = {};
      for (const [index, plan] of plans) {
        const line = sheet.lines.find((entry) => entry.index === index);
        const holding = line?.replaces ? held.get(line.replaces.recordId) : undefined;
        const revisionRefusal = holding ? revisionDescriptionRefusal(plan, holding) : null;
        bySheet[index] = { ...plan, revisionRefusal };
        const forSheet = descriptionPlans[sheetIndex] ?? new Map();
        forSheet.set(index, { attributes: plan.attributes, held: revisionRefusal !== null });
        descriptionPlans[sheetIndex] = forSheet;
      }
      descriptions[sheetIndex] = bySheet;
    }
  }

  // WHAT EACH FABRIC LINE DOES TO THE FINISHES LIBRARY, in one line per row:
  // the code it is filed under (or minted, or not filed), and the swatch its
  // picture becomes. Walked in the confirm's own order by the function the
  // confirm decides with (`planBillFabrics` over `decideFabricFiling` and
  // `planFinishSwatches`), against the same library — so this screen cannot
  // promise a swatch or a code the confirm will not write. Computed on read:
  // a line re-kinded, unticked or placed under another item changes it.
  const fabricFilings: Record<number, Record<number, FabricLinePlan>> = {};
  let finishCodePrefix: string | null = null;
  if (parsed && parsed.sheets.some((sheet) => sheet.lines.some((line) => line.rowKind === "finish_for"))) {
    const projectId = String(run.project_id);
    const library = await loadFinishLibrary(sql, projectId);
    finishCodePrefix = await loadFinishCodePrefix(sql, projectId);
    const heldSwatches = await loadCurrentSwatches(
      sql,
      library.map((finish) => finish.id),
    );
    const carriedParents = parsed.sheets.flatMap((sheet) =>
      sheet.lines.flatMap((line) => (line.replaces && line.rowKind !== "finish_for" ? [line.replaces.recordId] : [])),
    );
    const heldFinishes = await loadHeldBillFinishes(sql, carriedParents);
    // WHAT EACH CARRIED RECORD ALREADY HOLDS, from any document — the slots
    // the confirm's own read will find taken before its finish lines.
    const heldOnCarried = await loadHeldAttributes(sql, carriedParents);
    // THE ONE PLAN the confirm executes (`planBillFinishWrites`), described.
    const plans = planBillFabrics({
      sheets: parsed.sheets,
      rowImages: parsed.rowImages,
      library,
      heldSwatches,
      prefix: finishCodePrefix,
      heldFabric: (recordId, kind) =>
        (heldFinishes.get(recordId) ?? []).filter((entry) => entry.kind === kind).map((entry) => entry.value),
      ...billFinishPlanInputs({
        sheets: parsed.sheets,
        descriptions: parsed.sheets.map((_, sheetIndex) => descriptionPlans[sheetIndex] ?? new Map()),
        carriedFieldIds: (recordId) => heldOnCarried.get(recordId)?.fieldIds ?? [],
        jsonIdOfField,
      }),
    });
    for (const [key, plan] of plans) {
      const [sheetIndex, lineIndex] = key.split(":").map(Number) as [number, number];
      fabricFilings[sheetIndex] = { ...(fabricFilings[sheetIndex] ?? {}), [lineIndex]: plan };
    }
  }

  // THE SPECIFICATIONS IN THIS BILL, where somebody has asked for them to be
  // read: the spec-document run registered from this bill's own stored file,
  // found by the request id its registration always carries.
  const specsRows = await sql`
    select id, status from intake_runs where registration_request_id = ${billSpecsRequestId(String(run.id))}
  `;
  const billSpecs = specsRows[0] ? { id: String(specsRows[0].id), status: String(specsRows[0].status) } : null;

  return json({
    ok: true,
    import: { ...run, parsed },
    categories,
    runs,
    reconciliation,
    billSpecs,
    descriptions,
    descriptionsRead: parsed ? billReadsDescriptions(parsed.sheets) : false,
    fabricFilings,
    finishCodePrefix,
    // Per sheet: how many items its Prototype Quantity will also put on the
    // mock-up phase, and whether no item line carries a code — the function
    // the confirm reads its mock-up lines through (`bill-sheet-notices.ts`).
    sheetNotices: parsed ? billSheetNotices(parsed.sheets) : {},
  });
}

// ---- the BOQ's positional autosave -----------------------------------------
// Merges the reviewer's change into the line that is still present at that
// index, rather than writing back an array the client sent -- a snapshot
// rewrite races another tab's autosave and silently reverts it.
export async function patchBoqLine(
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
    rowKind?: unknown;
    finishForRow?: unknown;
    slotOverride?: unknown;
    slotOverridesVersion?: unknown;
    unitOverride?: unknown;
    unitOverrideVersion?: unknown;
    unitOverrideAll?: unknown;
    lines?: unknown;
    picture?: unknown;
    pictureVersion?: unknown;
  },
  actor: string,
): Promise<Response> {
  const sheetIndex = typeof body.sheetIndex === "number" ? body.sheetIndex : null;
  if (sheetIndex === null) return json({ ok: false, error: "sheetIndex is required." }, 400);
  const index = typeof body.index === "number" ? body.index : null;

  // A PART OF THE SIZE LINE, said by a person to be another slot. Its own
  // shape, for the row kind's reason: it is checked against the LIVE line's
  // plan under the lock, and against the version of the map the screen showed.
  if (body.slotOverride !== undefined) {
    if (index === null) return json({ ok: false, error: "A slot is changed on one line." }, 400);
    return patchSlotOverride(id, sheetIndex, index, body.slotOverride, body.slotOverridesVersion, actor);
  }

  // THE UNIT OF A SIZE THAT PRINTS NONE, said by a person: one line, or every
  // line the sheet's panel counted, in one request. Checked against the LIVE
  // line's plan under the lock, so a printed unit can never be overridden.
  if (body.unitOverride !== undefined) {
    if (index === null) return json({ ok: false, error: "A unit is set on one line." }, 400);
    return patchUnitOverride(id, sheetIndex, index, body.unitOverride, body.unitOverrideVersion, actor);
  }
  if (body.unitOverrideAll !== undefined) {
    return patchUnitOverrideAll(id, sheetIndex, body.unitOverrideAll, body.lines, actor);
  }

  // THE ROW'S PICTURE, chosen by a person: a crop of the bill's picture, none,
  // or the bill's own again. Its own shape and its own version, for the slot
  // override's reason — and because the pathname is checked against the run.
  if (body.picture !== undefined) {
    if (index === null) return json({ ok: false, error: "A picture is chosen for one line." }, 400);
    return patchLinePicture(id, sheetIndex, index, body.picture, body.pictureVersion, actor);
  }

  // A LINE'S KIND, set by a person: its own shape, because a fabric line's
  // item is checked against the LIVE sheet, under its lock, before anything is
  // written — an item offered by a screen that has since gone stale must not
  // become the one a fabric is written onto.
  if (body.rowKind !== undefined) {
    if (index === null) return json({ ok: false, error: "A row kind is set on one line." }, 400);
    return patchRowKind(id, sheetIndex, index, body.rowKind, body.finishForRow, actor);
  }

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
        return json({ ok: false, error: "The phase this sheet revises was not recognised. Reload and choose it again." }, 400);
      }
      patch.replacesRunId = body.replacesRunId;
      clearPairings = true;
    }
    // ONE TAB REVISES A PHASE (audit 2026-11-06, C2): a second sheet set to
    // revise it would retire the first one's lines at confirm. Refused here,
    // naming the tab that already does, and re-checked by the confirm. The
    // update below also carries the same condition, so two presses racing on
    // two tabs cannot both land.
    const revising = typeof body.replacesRunId === "string" ? body.replacesRunId : null;
    if (revising) {
      const others = await sql`
        select s.sheet->>'sheetName' as name
        from intake_runs i,
             jsonb_array_elements(i.parsed->'sheets') with ordinality as s(sheet, n)
        where i.id = ${id} and s.n - 1 <> ${sheetIndex}
          and s.sheet->>'replacesRunId' = ${revising}
          and coalesce((s.sheet->>'ignored')::boolean, false) = false
      `;
      if (others[0]) {
        return json(
          {
            ok: false,
            error: `“${String(others[0].name)}” already revises that phase. A phase is revised by one tab: make this one a new phase, or drop one of them.`,
          },
          409,
        );
      }
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
        and (
          ${revising}::text is null
          or not exists (
            select 1 from jsonb_array_elements(parsed->'sheets') with ordinality as s(sheet, n)
            where s.n - 1 <> ${sheetIndex}
              and s.sheet->>'replacesRunId' = ${revising}
              and coalesce((s.sheet->>'ignored')::boolean, false) = false
          )
        )
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
      const replaces = body.replaces as { recordId?: unknown; recordVersion?: unknown; restore?: unknown };
      if (typeof replaces?.recordId !== "string" || typeof replaces?.recordVersion !== "number") {
        return json({ ok: false, error: "A pairing names a record and the version you were shown." }, 400);
      }
      if (replaces.restore !== undefined && typeof replaces.restore !== "boolean") {
        return json({ ok: false, error: "restore is true or absent." }, 400);
      }
      // `restore`: bringing back a record an earlier revision retired (C14).
      // The confirm re-checks it is still retired, at this version.
      patch.replaces = {
        recordId: replaces.recordId,
        recordVersion: replaces.recordVersion,
        ...(replaces.restore === true ? { restore: true } : {}),
      };
    }
  }
  if (Object.keys(patch).length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  // WHAT THIS PRESS CARRIES TO THE OTHER TABS.
  // ==========================================================================
  // A bill's tabs are PHASES quoting the same codes, so `S-100` is a line on
  // every one of them and a decision about it is a decision about the item.
  // Only a DECISION carries, and only a positive one: clearing a level or a
  // category is "I do not know yet", and pushing that across tabs nobody opened
  // would destroy values with no decision behind it. See `src/lib/boq-carry.ts`
  // for the rules and for Max's caveat about a value-engineered phase.
  const decision: CarryDecision | null =
    typeof patch.level === "string"
      ? { field: "level", level: patch.level }
      : typeof patch.categoryId === "string"
        ? { field: "category", categoryId: patch.categoryId }
        : null;
  // Setting a value HERE makes it this row's own decision, whatever carried
  // into it before. Without this a row that received a carry would go on
  // claiming it after somebody overrode it on its own tab — and, worse, would
  // stay overwritable by the next carry, because the marker is what protects a
  // person's own choice.
  if (decision?.field === "level") patch.levelCarriedFrom = null;
  if (decision?.field === "category") patch.categoryCarriedFrom = null;

  const setLine = (targetSheet: number, targetIndex: number, targetPatch: Record<string, unknown>) => ({
    sheetPath: String(targetSheet),
    linePath: String(targetIndex),
    body: JSON.stringify(targetPatch),
  });

  // The ordinary edit: ONE statement, merged into whatever is live at that
  // address rather than writing back an array the client sent.
  if (!decision) {
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
      return json(
        { ok: false, error: "That line is no longer in this import, or the import is already confirmed." },
        409,
      );
    }
    return json({ ok: true, version: rows[0].version });
  }

  // A DECISION: the row and everything it reaches, in ONE transaction.
  //
  // There is no change set on this path — the staged bill is `intake_runs.parsed`
  // and nothing canonical is written until the confirm — so the guarantee that
  // stands in for "one press is one change set" is that one press is one commit.
  // A source row set and its receivers missed would leave the bill saying two
  // different things about one item, which is precisely the state this item
  // exists to end.
  //
  // The row is locked before `parsed` is read because the targets are computed
  // from it: another tab's autosave landing in between would make the plan
  // describe a bill that no longer exists. Every write is still a MERGE into
  // the live value at one line's address — never a snapshot rewrite.
  try {
    const result = await withTransaction(async (txn) => {
      const staged = await txn`
        select parsed, status from intake_runs where id = ${id} for update
      `;
      if (!staged[0]) throw new DomainConflictError("gone", "No such import.", { status: 404 });
      if (staged[0].status !== "parsed") {
        throw new DomainConflictError("confirmed", "This import is already confirmed.");
      }
      const sheets = ((staged[0].parsed as { sheets?: CarrySheet[] } | null)?.sheets ?? []) as CarrySheet[];
      const targets = planCarry(sheets, { sheetIndex, index }, decision);

      const primary = setLine(sheetIndex, index, patch);
      const updated = await txn`
        update intake_runs
        set parsed = jsonb_set(
              parsed,
              array['sheets', ${primary.sheetPath}, 'lines', ${primary.linePath}],
              coalesce(parsed->'sheets'->(${sheetIndex}::int)->'lines'->(${index}::int), '{}'::jsonb)
                || ${primary.body}::jsonb
            ),
            updated_by = ${actor}
        where id = ${id}
          and status = 'parsed'
          and parsed->'sheets'->(${sheetIndex}::int)->'lines'->(${index}::int) is not null
        returning version
      `;
      if (!updated[0]) {
        throw new DomainConflictError("gone", "That line is no longer in this import.");
      }

      let version = updated[0].version as number;
      for (const target of targets) {
        const write = setLine(target.sheetIndex, target.index, target.patch);
        const rows = await txn`
          update intake_runs
          set parsed = jsonb_set(
                parsed,
                array['sheets', ${write.sheetPath}, 'lines', ${write.linePath}],
                coalesce(
                  parsed->'sheets'->(${target.sheetIndex}::int)->'lines'->(${target.index}::int),
                  '{}'::jsonb
                ) || ${write.body}::jsonb
              ),
              updated_by = ${actor}
          where id = ${id} and status = 'parsed'
          returning version
        `;
        if (!rows[0]) throw new DomainConflictError("gone", "That line is no longer in this import.");
        version = rows[0].version as number;
      }
      return { version, carried: targets.length, tabs: listTabs(targets) };
    });
    return json({ ok: true, version: result.version, carried: result.carried, carriedTo: result.tabs });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- a bill line's KIND -------------------------------------------------------
// Item, fabric for an item above it, section, subtotal, blank. A section,
// subtotal or blank line is ignored by the same write (and one click on its
// Include box brings it back); an item or a fabric line is included. The fabric
// line's item must be a live ITEM line ABOVE it on the same sheet — the screen
// offers exactly those (`fabricParentOptions`), and this refuses anything else.
async function patchRowKind(
  id: string,
  sheetIndex: number,
  index: number,
  rowKind: unknown,
  finishForRow: unknown,
  actor: string,
): Promise<Response> {
  if (!isBoqRowKind(rowKind)) return json({ ok: false, error: "That is not a kind of row." }, 400);
  if (rowKind === "finish_for" && typeof finishForRow !== "number") {
    return json({ ok: false, error: "Say which item this fabric belongs to." }, 400);
  }
  try {
    const version = await withTransaction(async (txn) => {
      const rows = await txn`select parsed, status from intake_runs where id = ${id} for update`;
      if (!rows[0]) throw new DomainConflictError("gone", "No such import.", { status: 404 });
      if (rows[0].status !== "parsed") throw new DomainConflictError("confirmed", "This import is already confirmed.");
      const sheet = assertBoqDocument(rows[0].parsed).sheets[sheetIndex];
      const line = sheet?.lines[index];
      if (!sheet || !line) throw new DomainConflictError("gone", "That line is no longer in this import.");

      let parent: { row: number; code: string | null } | null = null;
      if (rowKind === "finish_for") {
        const option = fabricParentOptions(sheet.lines, line).find((candidate) => candidate.lineNo === finishForRow);
        if (!option) {
          throw new DomainConflictError(
            "not_an_item",
            `Row ${String(finishForRow)} is not an item line above row ${line.lineNo} on this sheet. Reload and choose again.`,
            { status: 400 },
          );
        }
        parent = { row: option.lineNo, code: option.code };
      }
      const patch = kindChoicePatch(rowKind, parent);
      const written = await txn`
        update intake_runs
        set parsed = jsonb_set(
              parsed,
              array['sheets', ${String(sheetIndex)}, 'lines', ${String(index)}],
              coalesce(parsed->'sheets'->(${sheetIndex}::int)->'lines'->(${index}::int), '{}'::jsonb)
                || ${JSON.stringify(patch)}::jsonb
            ),
            updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("gone", "That line is no longer in this import.");
      return Number(written[0].version);
    });
    return json({ ok: true, version });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// A SIZE PART'S SLOT, set by a person before the confirm (Matthew, 2026-10-01:
// a round stool's "D" is its diameter). `{ key, slot }`, where `key` is the
// figure as the plan addressed it (`resolveSlotOverrides(...).figures`, any
// figure the line prints since workstream E) and `slot` one of the five, or
// `note`, or null to put it back as printed. A slot another figure holds moves
// that figure to a note in the same write (`slotChangeFor`). Refused, writing
// nothing, when the figure is no longer on the line (409), when the map moved
// since the screen was drawn (409), and when the result would still put two
// figures in one slot (400, in `resolveSlotOverrides`' own sentence) — which a
// single pick can no longer cause.
async function patchSlotOverride(
  id: string,
  sheetIndex: number,
  index: number,
  change: unknown,
  expectedVersion: unknown,
  actor: string,
): Promise<Response> {
  const value = change as { key?: unknown; slot?: unknown } | null;
  if (!value || typeof value.key !== "string" || value.key.trim() === "") {
    return json({ ok: false, error: "Say which part of the size line this is." }, 400);
  }
  if (value.slot !== null && !isSlotOverride(value.slot)) {
    return json({ ok: false, error: "A part is a width, depth, height, seat height, diameter or a note." }, 400);
  }
  if (typeof expectedVersion !== "number") {
    return json({ ok: false, error: "Send the version of this line's slot changes you were shown." }, 400);
  }
  const key = value.key;
  const slot = value.slot as SlotOverride | null;
  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`select parsed, status from intake_runs where id = ${id} for update`;
      if (!rows[0]) throw new DomainConflictError("gone", "No such import.", { status: 404 });
      if (rows[0].status !== "parsed") throw new DomainConflictError("confirmed", "This import is already confirmed.");
      const sheet = assertBoqDocument(rows[0].parsed).sheets[sheetIndex];
      const line = sheet?.lines[index];
      if (!line) throw new DomainConflictError("gone", "That line is no longer in this import.");
      const current = line.slotOverridesVersion ?? 0;
      if (current !== expectedVersion) {
        throw new DomainConflictError(
          "slot_overrides_stale",
          `The size on row ${line.lineNo} changed since this screen loaded. Reload and check it before changing it again.`,
        );
      }
      // The description's statements AND the line's own Dims cell — the list
      // the plan places from, so a part offered on the screen is a part here.
      const statements = line.rowKind === "finish_for" ? null : lineStatements(line, sheetColumnHeadings(sheet!));
      const placed = statements ? placedSizeOf(statements) : null;
      // ANY FIGURE THE LINE PRINTS (workstream E): a placed part, an
      // unlettered figure (`710` of `700 DIA X 710MM`) or a later line's
      // (`SH: 420MM`) — the figures the plan offers, from the one function
      // that lists them.
      const figures = statements ? resolveSlotOverrides(placed, line.slotOverrides ?? null, statements).figures : [];
      if (!statements || !figures.some((figure) => figure.key === key)) {
        throw new DomainConflictError(
          "slot_part_gone",
          `Row ${line.lineNo}'s size no longer prints “${key}”. Reload and look at it again.`,
        );
      }
      // PICKING A HELD SLOT MOVES ITS HOLDER TO A NOTE, in this same write —
      // the drawings card's swap rule (`slotChangeFor`). A slot still never
      // holds two figures; the reviewer is just never asked to clear it first.
      const { next } = slotChangeFor(placed, statements, line.slotOverrides ?? null, key, slot);
      const resolved = resolveSlotOverrides(placed, next, statements);
      if (resolved.problem) throw new DomainConflictError("slot_taken", resolved.problem, { status: 400 });
      const version = current + 1;
      const written = await txn`
        update intake_runs
        set parsed = jsonb_set(
              parsed,
              array['sheets', ${String(sheetIndex)}, 'lines', ${String(index)}],
              coalesce(parsed->'sheets'->(${sheetIndex}::int)->'lines'->(${index}::int), '{}'::jsonb)
                || ${JSON.stringify({ slotOverrides: next, slotOverridesVersion: version })}::jsonb
            ),
            updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("gone", "That line is no longer in this import.");
      return { version: Number(written[0].version), slotOverridesVersion: version };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- the unit of a size that prints none ------------------------------------
//
// A person says what an unprinted unit is, before the confirm, on the screen
// that is the gate. Stored on the staged line (`unitOverride`) under its own
// version, and APPLIED inside `planBillDescription`, which the review GET and
// the confirm both call. Refused, writing nothing, when the line's placed size
// now prints a unit or has none (409) — a printed unit is never overridden —
// and when the line moved since the screen was drawn (409).

/** Writes one line's unit; the caller holds the run's row lock. */
async function writeLineUnit(
  txn: TxnSql,
  input: { id: string; sheetIndex: number; index: number; unit: BillUnitOverride | null; version: number; actor: string },
) {
  const { id, sheetIndex, index, unit, version, actor } = input;
  // `null` removes the key rather than storing a null, so a line put back
  // reads exactly as one nobody touched.
  const written = await txn`
    update intake_runs
    set parsed = jsonb_set(
          parsed,
          array['sheets', ${String(sheetIndex)}, 'lines', ${String(index)}],
          (coalesce(parsed->'sheets'->(${sheetIndex}::int)->'lines'->(${index}::int), '{}'::jsonb) - 'unitOverride')
            || ${JSON.stringify(unit ? { unitOverride: unit, unitOverrideVersion: version } : { unitOverrideVersion: version })}::jsonb
        ),
        updated_by = ${actor}
    where id = ${id} and status = 'parsed'
    returning version
  `;
  if (!written[0]) throw new DomainConflictError("gone", "That line is no longer in this import.");
  return Number(written[0].version);
}

/** The live line, locked, and whether its placed size prints no unit. */
async function lockedLineForUnit(txn: TxnSql, id: string, sheetIndex: number, index: number) {
  const rows = await txn`select parsed, status from intake_runs where id = ${id} for update`;
  if (!rows[0]) throw new DomainConflictError("gone", "No such import.", { status: 404 });
  if (rows[0].status !== "parsed") throw new DomainConflictError("confirmed", "This import is already confirmed.");
  const sheet = assertBoqDocument(rows[0].parsed).sheets[sheetIndex];
  const line = sheet?.lines[index];
  if (!sheet || !line) throw new DomainConflictError("gone", "That line is no longer in this import.");
  const needsUnit = line.rowKind !== "finish_for" && lineSizeNeedsUnit(lineStatements(line, sheetColumnHeadings(sheet)));
  return { line, needsUnit };
}

async function patchUnitOverride(
  id: string,
  sheetIndex: number,
  index: number,
  change: unknown,
  expectedVersion: unknown,
  actor: string,
): Promise<Response> {
  if (change !== null && !isBillUnitOverride(change)) {
    return json({ ok: false, error: "A unit is mm, cm or in." }, 400);
  }
  if (typeof expectedVersion !== "number") {
    return json({ ok: false, error: "Send the version of this line's unit you were shown." }, 400);
  }
  try {
    const result = await withTransaction(async (txn) => {
      const { line, needsUnit } = await lockedLineForUnit(txn, id, sheetIndex, index);
      const current = line.unitOverrideVersion ?? 0;
      if (current !== expectedVersion) {
        throw new DomainConflictError(
          "unit_override_stale",
          `The unit on row ${line.lineNo} changed since this screen loaded. Reload and check it before changing it again.`,
        );
      }
      if (!needsUnit && change !== null) {
        throw new DomainConflictError(
          "unit_printed",
          `Row ${line.lineNo}'s size prints its unit, or has no size to give one. Reload and look at it again.`,
        );
      }
      const version = current + 1;
      const runVersion = await writeLineUnit(txn, { id, sheetIndex, index, unit: change as BillUnitOverride | null, version, actor });
      return { version: runVersion, unitOverrideVersion: version };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

/**
 * EVERY LINE THE PANEL COUNTED, ONE REQUEST. The screen sends the lines it
 * offered with the versions it drew them at, and only those are written: a
 * line that has since been given a unit, or whose size now prints one, refuses
 * the whole request rather than being skipped — the count on the button was a
 * promise about exactly these rows.
 */
async function patchUnitOverrideAll(
  id: string,
  sheetIndex: number,
  change: unknown,
  rawLines: unknown,
  actor: string,
): Promise<Response> {
  if (!isBillUnitOverride(change)) return json({ ok: false, error: "A unit is mm, cm or in." }, 400);
  const lines = Array.isArray(rawLines) ? rawLines : null;
  if (
    !lines ||
    lines.length === 0 ||
    !lines.every(
      (entry) =>
        entry && typeof entry === "object" && Number.isInteger((entry as { index?: unknown }).index) &&
        typeof (entry as { unitOverrideVersion?: unknown }).unitOverrideVersion === "number",
    )
  ) {
    return json({ ok: false, error: "Send the lines you were shown, each with the version of its unit." }, 400);
  }
  const wanted = lines as { index: number; unitOverrideVersion: number }[];
  if (new Set(wanted.map((entry) => entry.index)).size !== wanted.length) {
    return json({ ok: false, error: "A line is named twice." }, 400);
  }
  try {
    const result = await withTransaction(async (txn) => {
      let runVersion = 0;
      for (const entry of wanted) {
        const { line, needsUnit } = await lockedLineForUnit(txn, id, sheetIndex, entry.index);
        const current = line.unitOverrideVersion ?? 0;
        if (current !== entry.unitOverrideVersion || line.unitOverride) {
          throw new DomainConflictError(
            "unit_override_stale",
            `The unit on row ${line.lineNo} was set since this screen was drawn. Reload and set them again.`,
          );
        }
        if (!needsUnit) {
          throw new DomainConflictError(
            "unit_printed",
            `Row ${line.lineNo}'s size prints its unit, or has no size to give one. Reload and set them again.`,
          );
        }
        runVersion = await writeLineUnit(txn, { id, sheetIndex, index: entry.index, unit: change, version: current + 1, actor });
      }
      return { version: runVersion, written: wanted.length };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- a row's picture, chosen on the review ------------------------------------
//
// `null` puts the bill's own picture back; `{ none: true }` is no picture; a
// crop names the PNG the browser cut out of the bill's picture and uploaded
// through the token route. Staged only — the confirm gives what
// `effectiveRowImage` answers, and nothing canonical is written here, so no
// change set (the same as every other edit to a staged line).
//
// A CROP'S PATHNAME IS CHECKED, NOT TRUSTED. The token route scoped the upload
// to the project; this re-checks it against the project AND against this
// run's own picture prefix (`billPicturePrefix`), and asks the store whether
// the file is there, taking its size and type from the store rather than from
// the request. A pathname a client names is never fetched with the store's
// credential before it has passed all three (`blob-source.ts`).
//
// A crop needs a picture to have been cut FROM: a row the bill printed no
// single picture on (none, or two different ones — which registration does
// not store) can only be given none.
const PictureCrop = z
  .object({
    pathname: z.string().min(1).max(1024),
    width: z.number().int().positive().max(20_000).nullable().optional(),
    height: z.number().int().positive().max(20_000).nullable().optional(),
  })
  .strict();

async function patchLinePicture(
  id: string,
  sheetIndex: number,
  index: number,
  change: unknown,
  expectedVersion: unknown,
  actor: string,
): Promise<Response> {
  if (typeof expectedVersion !== "number") {
    return json({ ok: false, error: "Send the version of this row's picture you were shown." }, 400);
  }
  let choice: "own" | "none" | z.infer<typeof PictureCrop>;
  if (change === null) choice = "own";
  else if (change && typeof change === "object" && "none" in change) {
    if ((change as { none?: unknown }).none !== true || Object.keys(change).length !== 1) {
      return json({ ok: false, error: "No picture is { none: true }." }, 400);
    }
    choice = "none";
  } else {
    const named = PictureCrop.safeParse(change);
    if (!named.success) return json({ ok: false, error: "A crop names the file it was stored as." }, 400);
    choice = named.data;
  }

  // THE STORE IS ASKED BEFORE THE ROW IS LOCKED: blob I/O inside a
  // transaction holds a row lock across a network call (`assignMessage`'s
  // rule). The project comes from the run, never from the request.
  let crop: BillPictureCrop | null = null;
  if (typeof choice === "object") {
    const owner = await sql`select project_id from intake_runs where id = ${id}`;
    if (!owner[0]) return json({ ok: false, error: "No such import." }, 404);
    const projectId = String(owner[0].project_id);
    let pathname: string;
    try {
      pathname = assertProjectScopedPathname(choice.pathname, projectId);
    } catch {
      return json({ ok: false, error: "That picture is not one of this project's files." }, 400);
    }
    if (!pathname.startsWith(billPicturePrefix(projectId, id))) {
      return json({ ok: false, error: "That picture was not stored for this bill." }, 400);
    }
    const stored = await headTrustedBlob(pathname, projectId).catch(() => null);
    if (!stored) return json({ ok: false, error: "That crop never reached the store. Crop it again." }, 400);
    if (!isPictureContentType(stored.contentType)) return json({ ok: false, error: "That file is not a picture." }, 400);
    crop = {
      pathname,
      contentType: stored.contentType,
      size: stored.size,
      width: choice.width ?? null,
      height: choice.height ?? null,
    };
  }

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`select parsed, status from intake_runs where id = ${id} for update`;
      if (!rows[0]) throw new DomainConflictError("gone", "No such import.", { status: 404 });
      if (rows[0].status !== "parsed") throw new DomainConflictError("confirmed", "This import is already confirmed.");
      const doc = assertBoqDocument(rows[0].parsed);
      const sheet = doc.sheets[sheetIndex];
      const line = sheet?.lines[index];
      if (!sheet || !line) throw new DomainConflictError("gone", "That line is no longer in this import.");
      const current = line.pictureVersion ?? 0;
      if (current !== expectedVersion) {
        throw new DomainConflictError(
          "picture_stale",
          `The picture on row ${line.lineNo} changed since this screen loaded. Reload and look at it before changing it again.`,
        );
      }
      if (crop && !rowImageFor(doc.rowImages, sheet.sheetName, line.lineNo)?.pathname) {
        throw new DomainConflictError(
          "nothing_to_crop",
          `The bill printed no single picture on row ${line.lineNo}, so there is nothing to crop. Choose no picture instead.`,
          { status: 400 },
        );
      }
      const picture: BillPictureOverride | null = choice === "own" ? null : choice === "none" ? { none: true } : crop;
      const version = current + 1;
      const written = await txn`
        update intake_runs
        set parsed = jsonb_set(
              parsed,
              array['sheets', ${String(sheetIndex)}, 'lines', ${String(index)}],
              coalesce(parsed->'sheets'->(${sheetIndex}::int)->'lines'->(${index}::int), '{}'::jsonb)
                || ${JSON.stringify({ picture, pictureVersion: version })}::jsonb
            ),
            updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("gone", "That line is no longer in this import.");
      return { version: Number(written[0].version), pictureVersion: version };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
