// The import route's DRAWINGS half: the review GET and the autosaves of a shop-drawings run (an observation, an item, a bulk unit, a slot swap).
// Moved out of src/app/api/imports/[id]/route.ts on 2026-11-07 (audit 5.3, cut D); the route is now the dispatcher.

import { z } from "zod";
import { sql, json, type Row } from "@/lib/db";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { loadDrawingContext, recordChoices, resolveStagedRun } from "@/lib/drawing-resolution";
import { reviewDrawingObservations } from "@/lib/confirm-drawings";
import { normaliseFinishCode } from "@/lib/finishes";
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_STATES,
  ATTRIBUTE_UNITS,
  DIMENSION_SLOTS,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import {
  assertStagedDrawings,
  specFieldEntries,
  isMeasuredRow,
  splitFigureAndUnit,
  namedConfigurationPlans,
  onRowRetargeted,
  type DrawingItem,
  type DrawingObservation,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { planSlotSwap, slotWords } from "@/lib/slot-swap";
import { loadFieldsWithPalettes } from "@/lib/palette-load";
import { paletteOptionFor } from "@/lib/palettes";
import type { StagedStandard } from "@/lib/bw-standard";
import { normaliseVariantLabel, variantLabelProblem } from "@/lib/record-variants";
import { versionsWritten } from "@/lib/acked-versions";
import { documentClosedSentence, reviewedWord } from "@/lib/intake-status";

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

export async function patchBulkUnit(id: string, raw: unknown, actor: string): Promise<Response> {
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
        throw new DomainConflictError("not_reviewable", documentClosedSentence(String(run.status), { consequence: "it cannot be edited here" }));
      }
      // WITH ITS PALETTES, as the review GET and the confirm read it: a pick
      // made before 0041 is read as a BW standard (`upgradeStandards`), and an
      // autosave that read it otherwise would persist the option as the
      // client's words.
      const fieldRows = await loadFieldsWithPalettes(txn);
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
      // Every row this bumped, so a screen confirming next sends these and not
      // the versions it rendered with (audit G1, `acked-versions.ts`).
      return { version: Number(written[0].version), changed, versions: versionsWritten(staged.items, items) };
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
        // THE ITEM'S: the reviewer's tick that confirming may CREATE a named
        // configuration beside a bill line's existing ones, per (bill record,
        // folded name). The blocker it answers is computed; this is only the
        // decision. The whole list is sent, like `replaces`.
        configurationAcks: z
          .array(z.object({ recordId: z.string().uuid(), label: z.string().min(1).max(64) }).strict())
          .max(200)
          .optional(),
        // THE ITEM'S, brief C1: the reviewer's own list of the code's
        // configurations (null puts the model's reading back), and their
        // answer to whether the pages are one item or several. Written to
        // every page of the code by the card; the model's reading is never
        // touched.
        // THE ITEM'S, plan step 5: which existing configuration of a bill
        // line each of this page's configurations IS, or null for "create a
        // new one". The whole list is sent, like `configurationAcks`.
        configurationPairs: z
          .array(
            z
              .object({
                recordId: z.string().uuid(),
                label: z.string().min(1).max(64),
                // One or more existing configurations this IS; null for "new".
                pairWith: z.union([z.string().min(1).max(64), z.array(z.string().min(1).max(64)).min(1).max(30)]).nullable(),
              })
              .strict(),
          )
          .max(200)
          .optional(),
        configurationsByReviewer: z
          .array(z.object({ label: z.string().min(1).max(64), readAs: z.string().max(64).nullable() }).strict())
          .max(30)
          .nullable()
          .optional(),
        relationshipByReviewer: z.enum(["one_item", "configurations"]).nullable().optional(),
        // THE ITEM'S, brief F: the `uncertain` notices a reviewer pressed
        // Checked on, by index. The whole list is sent, like
        // `configurationAcks`; an index the item has no notice for is dropped.
        uncertainChecked: z.array(z.number().int().nonnegative().max(500)).max(100).optional(),
        // THE OBSERVATION'S, brief F: "Use as W" — this figure takes the slot,
        // and the row that held it on the same item (and configuration scope)
        // goes back to a note, in ONE locked write. `displaces` is every row
        // the card saw holding that slot, at the version it saw; a row the
        // swap would displace that is not in it, or has moved, is a 409.
        // Sent ALONE, like `ignoreBecause`.
        swapSlot: z
          .object({
            slot: z.enum(DIMENSION_SLOTS),
            displaces: z
              .array(z.object({ id: z.string().min(1), version: z.number().int().nonnegative() }).strict())
              .max(50),
          })
          .strict()
          .optional(),
        // THE OBSERVATION'S: which of the code's configurations this row
        // applies to, by label. `[]` is every one; null puts the model's
        // reading back.
        configurations: z.array(z.string().min(1).max(64)).max(30).nullable().optional(),
        value: z.string().max(4000).nullable().optional(),
        unit: z.enum(ATTRIBUTE_UNITS).nullable().optional(),
        attrGroup: z.enum(ATTRIBUTE_GROUPS).optional(),
        dimensionSlot: z.enum(DIMENSION_SLOTS).nullable().optional(),
        specFieldId: z.string().uuid().nullable().optional(),
        state: z.enum(ATTRIBUTE_STATES).nullable().optional(),
        label: z.string().max(300).optional(),
        // THE CLIENT'S OWN CODE FOR A FINISH THE SHEET PRINTED NONE FOR, typed
        // on the card. The library is keyed on it, so with no code there is
        // nothing to file a fabric under — which is why the S-203 armchair's
        // fabric was on the record and the project's library was empty.
        materialCode: z.string().max(200).nullable().optional(),
        // AND THE OTHER ANSWER: there is no client code, file it under one of
        // ours. It records the DECISION; the code itself is minted at confirm,
        // under the project row lock, because a number shown before that is a
        // number another reviewer may take.
        finishFiling: z
          .union([
            z.object({ mode: z.literal("internal") }).strict(),
            z.object({ mode: z.literal("link"), codeNorm: z.string().min(1).max(200) }).strict(),
            z.object({ mode: z.literal("apart") }).strict(),
          ])
          .nullable()
          .optional(),
        // IGNORE THIS ROW, AND SAY WHY (plan any-bill, step 4). The clash
        // panel's "Same fabric — keep page 1's wording" ignores the other
        // page's row "same as page 1" through this autosave, under the row's
        // own version, rather than through a second route. Sent ALONE: it is
        // handed to the same `reviewDrawingObservations` the Ignore button
        // uses, so the run's status is derived exactly as it is there.
        ignoreBecause: z.string().trim().min(1).max(200).optional(),
        // THE BW STANDARD BESIDE THE PAGE'S WORDS (0041). The palette pick no
        // longer writes `value`: it sets this, and `value` goes on holding
        // what the reviewer agrees the drawing said. Named by the option's
        // VALUE; the server resolves which option against the row's own
        // field, so a client never names an id. `tbc` is "BW will propose
        // one"; null is "Other…", no standard. Only `proposed` at intake --
        // an agreement is the client's, recorded after confirm.
        standard: z
          .union([
            z.object({ state: z.literal("proposed"), value: z.string().min(1).max(4000) }).strict(),
            z.object({ state: z.literal("tbc") }).strict(),
          ])
          .nullable()
          .optional(),
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
                // On a DIAMETER row: the record's W or D this retires (brief
                // G). The confirm reads it only while the row is a diameter,
                // and pins the retire to that slot.
                retiresSlot: z.enum(["W", "D"]).optional(),
              })
              .strict(),
          )
          .max(50)
          .optional(),
      })
      .strict(),
  })
  .strict();

export async function patchDrawing(id: string, raw: unknown, actor: string): Promise<Response> {
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
        throw new DomainConflictError("not_reviewable", documentClosedSentence(String(run.status), { consequence: "it cannot be edited here" }));
      }
      // WITH ITS PALETTES, as the review GET and the confirm read it: a pick
      // made before 0041 is read as a BW standard (`upgradeStandards`), and an
      // autosave that read it otherwise would persist the option as the
      // client's words.
      const fieldRows = await loadFieldsWithPalettes(txn);
      const staged: StagedDrawings = assertStagedDrawings(run.parsed, specFieldEntries(fieldRows));
      const item = staged.items.find((row) => row.id === itemId);
      if (!item) throw new DomainConflictError("item_missing", "That item is no longer part of this import. Reload.");

      let items: DrawingItem[];

      if (observationId === undefined) {
        if (item.version !== expectedVersion) {
          throw new DomainConflictError("item_version_stale", "This item changed since this screen loaded. Reload.");
        }
        const ticked = changes.ticked ?? item.targets?.ticked ?? [];
        const unticked = changes.unticked ?? item.targets?.unticked ?? [];
        // Only when the request is ABOUT the targets. An item that has never
        // been touched has `targets: null`, meaning "whatever resolves" — and
        // writing `{ ticked: [], unticked: [] }` over that because somebody
        // ticked a configuration acknowledgement would untick every phase.
        const aboutTargets = changes.ticked !== undefined || changes.unticked !== undefined;
        // A NAME IS REFUSED IN WORDS HERE, when it is typed — the database
        // would refuse it at confirm, and a card that let it through would be
        // a 500 waiting. Folded the way the column stores it, and one name once.
        let configurationsByReviewer: { label: string; readAs: string | null }[] | null | undefined;
        if (changes.configurationsByReviewer !== undefined) {
          if (changes.configurationsByReviewer === null) {
            configurationsByReviewer = null;
          } else {
            const seen = new Set<string>();
            configurationsByReviewer = [];
            for (const entry of changes.configurationsByReviewer) {
              const label = normaliseVariantLabel(entry.label);
              const problem = variantLabelProblem(label);
              if (problem) throw new DomainConflictError("configuration_name", problem, { status: 400 });
              if (seen.has(label)) {
                throw new DomainConflictError("configuration_duplicate", `${label} is already a configuration of this item.`, {
                  status: 400,
                });
              }
              seen.add(label);
              configurationsByReviewer.push({ label, readAs: entry.readAs ? normaliseVariantLabel(entry.readAs) : null });
            }
          }
        }
        items = staged.items.map((row) =>
          row.id === itemId
            ? {
                ...row,
                version: row.version + 1,
                // Both lists are the reviewer's DECISION, which is what lets a
                // target that appears later be told apart from one they
                // deliberately unticked.
                ...(aboutTargets ? { targets: { ticked, unticked } } : {}),
                ...(changes.configurationAcks !== undefined
                  ? {
                      configurationAcks: changes.configurationAcks.map((ack) => ({
                        recordId: ack.recordId,
                        label: normaliseVariantLabel(ack.label),
                      })),
                    }
                  : {}),
                ...(configurationsByReviewer !== undefined ? { configurationsByReviewer } : {}),
                ...(changes.configurationPairs !== undefined
                  ? {
                      configurationPairs: changes.configurationPairs.map((pair) => ({
                        recordId: pair.recordId,
                        label: normaliseVariantLabel(pair.label),
                        pairWith:
                          pair.pairWith === null
                            ? null
                            : [...new Set((Array.isArray(pair.pairWith) ? pair.pairWith : [pair.pairWith]).map(normaliseVariantLabel))],
                      })),
                    }
                  : {}),
                ...(changes.relationshipByReviewer !== undefined
                  ? { relationshipByReviewer: changes.relationshipByReviewer }
                  : {}),
                ...(changes.uncertainChecked !== undefined
                  ? {
                      uncertainChecked: [...new Set(changes.uncertainChecked)]
                        .filter((index) => Array.isArray(row.uncertain) && index < row.uncertain.length)
                        .sort((a, b) => a - b),
                    }
                  : {}),
              }
            : row,
        );
      } else {
        const observation = item.observations.find((row) => row.id === observationId);
        if (!observation) {
          throw new DomainConflictError("observation_missing", "That spec is no longer part of this import. Reload.");
        }
        if (observation.reviewStatus !== "pending") {
          throw new DomainConflictError(
            "observation_reviewed",
            `That spec has already been ${reviewedWord(observation.reviewStatus)}. Reload to see where it stands.`,
          );
        }
        if (observation.version !== expectedVersion) {
          throw new DomainConflictError("observation_version_stale", "That spec changed since this screen loaded. Reload.");
        }
        if (changes.ignoreBecause !== undefined) {
          if (Object.keys(changes).length !== 1) {
            throw new DomainConflictError("ignore_alone", "An ignore is sent on its own, not with other changes.", {
              status: 400,
            });
          }
          const reviewed = await reviewDrawingObservations(txn, {
            runId: id,
            expectedVersion: null,
            itemId,
            observations: [{ id: observationId, version: expectedVersion }],
            action: "ignore",
            actor,
            reason: changes.ignoreBecause,
          });
          return { version: null, ignored: reviewed.ignored };
        }
        if (changes.swapSlot !== undefined) {
          if (Object.keys(changes).length !== 1) {
            throw new DomainConflictError("swap_alone", "A slot swap is sent on its own, not with other changes.", {
              status: 400,
            });
          }
          items = swapSlotIntoItem(staged, item, observation, changes.swapSlot);
          const swapped = await txn`
            update intake_runs
            set parsed = ${JSON.stringify({ ...staged, items })}::jsonb, updated_by = ${actor}
            where id = ${id} and status = 'parsed'
            returning version
          `;
          if (!swapped[0]) throw new DomainConflictError("not_reviewable", "This import closed while you were editing it.");
          // A swap moves the row it displaces too; the screen learns both.
          return { version: Number(swapped[0].version), versions: versionsWritten(staged.items, items) };
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

        // THE STANDARD IS RESOLVED HERE, against the field the row will hold
        // after this patch, and refused in words when it is not one of that
        // field's options -- the exact step, never the nearest option.
        const fieldAfter = changes.specFieldId !== undefined ? changes.specFieldId : observation.specFieldId;
        let standard: StagedStandard | null | undefined;
        if (changes.standard === null) {
          standard = null;
        } else if (changes.standard?.state === "tbc") {
          standard = { state: "tbc", value: null, optionId: null };
        } else if (changes.standard?.state === "proposed") {
          const palette = fieldRows.find((field) => field.id === fieldAfter)?.palette ?? null;
          const option = palette ? paletteOptionFor(palette, changes.standard.value) : null;
          if (!palette || !option) {
            throw new DomainConflictError(
              "standard_not_on_palette",
              palette
                ? `That is not one of the ${palette.name} options, so it cannot be the BW standard. Keep the drawing's words and leave the standard empty.`
                : "This spec's BWS field offers no BWS list, so it has no BW standard to choose.",
              { status: 400 },
            );
          }
          standard = { state: "proposed", value: option.value, optionId: option.id ?? null };
        }

        const next = {
          ...observation,
          version: observation.version + 1,
          ...(standard !== undefined ? { standard } : {}),
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
          // A CLIENT CODE SUPERSEDES THE INTERNAL DECISION, and clears it in
          // the same patch. Otherwise a reviewer who pressed "no code" and
          // then found one would leave a row that mints `BW-F-002` for a
          // fabric the client calls `CH-01.1`.
          ...(changes.materialCode !== undefined
            ? { materialCodeRaw: changes.materialCode?.trim() || null, finishFiling: null }
            : {}),
          ...(changes.finishFiling !== undefined
            ? {
                finishFiling:
                  changes.finishFiling === null
                    ? null
                    : changes.finishFiling.mode === "link"
                      ? { mode: "link" as const, codeNorm: normaliseFinishCode(changes.finishFiling.codeNorm) }
                      : changes.finishFiling.mode === "apart"
                        ? { mode: "apart" as const }
                        : { mode: "internal" as const },
              }
            : {}),
          ...(changes.replaces !== undefined ? { replaces: changes.replaces } : {}),
          // Beside the model's `configurations`, never over it.
          ...(changes.configurations !== undefined
            ? {
                configurationsByReviewer:
                  changes.configurations === null
                    ? null
                    : [...new Set(changes.configurations.map((label) => normaliseVariantLabel(label)))],
              }
            : {}),
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
        // ====================================================================
        // A DECISION KEYED ON THE ROW'S TARGET STAYS WITH THAT TARGET (audit
        // D2). `onRowRetargeted` is the one rule, read off the row as it will
        // be stored (after the slot normalisation above): a move of group,
        // slot or field drops the replace tick and, on a field move, the BW
        // standard. The screen does not send `replaces: []` with a move; this
        // is the server's rule, so no caller can forget it. A tick sent IN THE
        // SAME PATCH as a move is refused rather than guessed at: it was
        // chosen against the old target or the new one, and the request does
        // not say which.
        // ====================================================================
        const retargeted = onRowRetargeted(observation, next);
        if (retargeted.replaces && changes.replaces !== undefined) {
          throw new DomainConflictError(
            "replace_with_move",
            "A replace tick is sent on its own, after the row is where it belongs.",
            { status: 400 },
          );
        }
        if (retargeted.replaces) next.replaces = [];
        if (retargeted.standard === null && changes.standard === undefined) next.standard = null;
        // TOUCHING A SLOT IS LOOKING AT IT (brief F). A figure, unit, state or
        // slot changed on a row that holds an overall slot — before or after —
        // settles a doubt the read raised about that slot. Recorded on the
        // item as a side effect of the edit, never sent by a client.
        const touches =
          changes.value !== undefined ||
          changes.unit !== undefined ||
          changes.state !== undefined ||
          changes.dimensionSlot !== undefined ||
          changes.attrGroup !== undefined;
        const touched = touches
          ? [observation.dimensionSlot, next.dimensionSlot].filter((slot): slot is DimensionSlot => Boolean(slot))
          : [];
        items = staged.items.map((row) =>
          row.id !== itemId
            ? row
            : {
                ...row,
                observations: row.observations.map((o) => (o.id === observationId ? next : o)),
                ...(touched.length > 0 ? { slotsTouched: withSlotsTouched(row, touched) } : {}),
              },
        );
      }

      const written = await txn`
        update intake_runs
        set parsed = ${JSON.stringify({ ...staged, items })}::jsonb, updated_by = ${actor}
        where id = ${id} and status = 'parsed'
        returning version
      `;
      if (!written[0]) throw new DomainConflictError("not_reviewable", "This import closed while you were editing it.");
      // THE VERSIONS THIS WRITE PRODUCED (audit G1). The run's own version is
      // no use to a screen confirming next: the confirm checks each row's and
      // the item's, so those are what it has to learn.
      return { version: Number(written[0].version), versions: versionsWritten(staged.items, items) };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

/** The item's touched slots with these added, in slot order, once each. */
function withSlotsTouched(item: DrawingItem, slots: readonly DimensionSlot[]): DimensionSlot[] {
  const set = new Set<DimensionSlot>([...(Array.isArray(item.slotsTouched) ? item.slotsTouched : []), ...slots]);
  return DIMENSION_SLOTS.filter((slot) => set.has(slot));
}

/**
 * "Use as W" — the swap, applied to the locked staged document (brief F).
 *
 * `planSlotSwap` decides which rows are displaced; this checks that every one
 * of them is a row the card SAW, at the version it saw, and writes all of them
 * and the mover in the one statement the caller issues. A refusal writes
 * nothing.
 */
function swapSlotIntoItem(
  staged: StagedDrawings,
  item: DrawingItem,
  mover: DrawingObservation,
  swap: { slot: DimensionSlot; displaces: { id: string; version: number }[] },
): DrawingItem[] {
  const plan = namedConfigurationPlans(staged.items, staged).get(item.id) ?? null;
  const planned = planSlotSwap(item, mover.id, swap.slot, plan);
  if (!planned.ok) throw new DomainConflictError(planned.code, planned.message, { status: planned.status });
  const seen = new Map(swap.displaces.map((entry) => [entry.id, entry.version]));
  for (const displacement of planned.displaced) {
    const live = item.observations.find((row) => row.id === displacement.observationId)!;
    if (seen.get(live.id) !== live.version) {
      throw new DomainConflictError(
        "swap_stale",
        `Another row now holds ${slotWords(swap.slot)} on this item, or it changed since this screen loaded. Reload and point at the figure again.`,
      );
    }
  }
  const byId = new Map(planned.displaced.map((entry) => [entry.observationId, entry]));
  const observations = item.observations.map((row): DrawingObservation => {
    if (row.id === mover.id) {
      return {
        ...row,
        version: row.version + 1,
        attrGroup: "dimension",
        dimensionSlot: swap.slot,
        // A PERSON POINTED AT IT. Not a guess any more, and not a reading the
        // card should explain with the model's evidence for a different figure.
        slotSuggested: false,
        slotReason: null,
        groupSuggested: false,
        groupReason: null,
        // Only where the run carries the answer at all: a version 1 row has
        // no `isOverall`, and inventing one would switch its card's guessing
        // off for every other row.
        ...(row.isOverall !== undefined ? { isOverall: true } : {}),
        // A replace acknowledgement names the occupant of the slot it was
        // ticked for; moving to another slot leaves it describing nothing.
        // The autosave's own rule, so the two paths cannot drift.
        ...onRowRetargeted(row, { attrGroup: "dimension", dimensionSlot: swap.slot, specFieldId: row.specFieldId }),
      };
    }
    const displacement = byId.get(row.id);
    if (!displacement) return row;
    if (displacement.to === "narrowed") {
      return { ...row, version: row.version + 1, configurationsByReviewer: displacement.configurations };
    }
    return {
      ...row,
      version: row.version + 1,
      attrGroup: "note",
      dimensionSlot: null,
      slotSuggested: false,
      // Folded with the other figures, where the mover came from. Kept, never
      // dropped: it is still what the page printed.
      ...(row.isOverall !== undefined ? { isOverall: false } : {}),
      // A replace acknowledgement was about writing THIS row into the slot.
      replaces: [],
    };
  });
  const touched = [swap.slot, ...(mover.dimensionSlot ? [mover.dimensionSlot] : [])];
  return staged.items.map((row) =>
    row.id === item.id ? { ...row, observations, slotsTouched: withSlotsTouched(row, touched) } : row,
  );
}

// ---- the review GET for a drawings run --------------------------------------

/** The drawings review: the staged items, resolved LIVE against the project. */
export async function getDrawingsReview(run: Row): Promise<Response> {
  // Resolution is LIVE, never stored. Confirming the pack's BOQ after this
  // extraction ran is normal, and a stored target would be stale from that
  // moment on — the screen and the confirm route would then disagree about
  // whether a card can commit, which is what lets a half-reviewed card
  // through. Both sides call the same functions instead.
  if (!run.parsed) return json({ ok: true, import: { ...run, parsed: null } });
  // The register FIRST: a callout the old word lists gave up on is re-read on
  // the way past (`upgradeCalloutGuesses`), and it can only claim COM 1 if it
  // is holding the field ids while it does.
  // With its palettes, because one read-time upgrade asks whether a value is
  // a palette option (0041's `upgradeStandards`), and the autosave and the
  // confirm read it the same way.
  const fieldRows = await loadFieldsWithPalettes(sql);
  const staged = assertStagedDrawings(run.parsed, specFieldEntries(fieldRows));
  // ======================================================================
  // THE PALETTE IS RESOLVED HERE, NOT WRITTEN INTO `intake_runs.parsed`.
  //
  // The same rule as `upgradeCalloutGuesses`: the register is read at READ
  // time, so a pack already read gains the list on its next page load with
  // no second model call and nothing charged again. Nothing about the
  // document changes, and the staged JSON stays what the model said.
  //
  // Attached to the FIELD register the card already threads, because that
  // is where the link lives (`spec_field_gates.spec_field_id`) and because a
  // parallel list is one more thing a caller can forget to pass -- which
  // would be a card offering a list the confirm never saw.
  // ======================================================================
  const fields = fieldRows;
  // The same pairing the pack-wide screen uses, so the two can never disagree
  // about whether a card can commit. See src/lib/drawing-resolution.ts.
  const context = await loadDrawingContext(String(run.project_id));
  const items = resolveStagedRun(staged, context, specFieldEntries(fieldRows), String(run.id));
  return json({
    ok: true,
    import: { ...run, parsed: staged },
    resolution: items,
    specFields: fields,
    records: recordChoices(context),
  });
}
