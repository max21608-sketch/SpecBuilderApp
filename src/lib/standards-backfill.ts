// Putting the client's words back where a palette pick overwrote them.
//
// ============================================================================
// WHAT HAPPENED BEFORE 0041. The drawings card's palette select wrote the
// chosen BWS option into the observation's `value`, and the confirm inserted
// that into `record_attributes.value` -- so a confirmed spec reads "BW Oak Grey
// - Open grain 10%" where the drawing said "feet dark tinted wood as per
// approved sample". The words were never lost: they are the observation's
// `valueRaw` in `intake_runs.parsed`, and the confirm recorded which
// attribute each observation wrote (`applied.attributeIds`). So this finds
// each such attribute through that link, restores `value` to the drawing's
// words, and moves the option to `standard_value` as `proposed`.
//
// ---- WHAT QUALIFIES, AND IT IS THE SAME QUESTION AS AT READ TIME ------------
//
// `legacyPaletteStandard` in drawing-document.ts decides it, called here on
// the applied row with the attribute's own value in it -- so the backfill and
// the screen cannot disagree about which picks were picks. The attribute's
// value must BE an option of its field's palette by the exact step, and the
// drawing's words must be something else. A drawing that quoted BWS's own
// wording is left alone: the client specified the BW standard itself.
//
// ---- WHAT IT NEVER DOES --------------------------------------------------------
//
//   * GUESS A LINK. An attribute whose observation cannot be found through
//     `applied.attributeIds` is looked for by record, field and value; where
//     that finds observations that disagree about the drawing's words it is
//     REPORTED as ambiguous and left untouched.
//   * TOUCH A ROW SOMEBODY HAS SINCE WORKED ON. The update is predicated on
//     the value still being the option and no standard being set, so a second
//     run -- or a correction made in between -- writes nothing.
//   * WRITE AN ANSWER. The checklist is recomposed through `recomposeAnswers`,
//     the one path every other writer uses.
//
// One change set per project (a change set belongs to one), one version per
// record touched.
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";
import type { SqlLike } from "@/lib/record-atoms";
import { loadPalettes, palettesByFieldJsonId } from "@/lib/palette-load";
import { legacyPaletteStandard, type DrawingObservation } from "@/lib/drawing-document";
import type { Palette } from "@/lib/palettes";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { snapshotRecords } from "@/lib/record-snapshot";
import { openChangeSet } from "@/lib/change-sets";

export type StandardBackfillRow = {
  attributeId: string;
  recordId: string;
  projectId: string;
  projectNumber: string;
  recordNo: number;
  label: string;
  fieldName: string;
  /** What `value` holds now -- a BWS option, as the pick wrote it. */
  currentValue: string;
  /** The option, as the palette holds it. */
  option: string;
  optionId: string;
  /** What the drawing said, and what `value` goes back to. */
  clientWords: string;
  sourceRunId: string;
};

export type StandardBackfillAmbiguous = {
  attributeId: string;
  projectNumber: string;
  recordNo: number;
  label: string;
  why: string;
};

export type StandardBackfillPlan = { rows: StandardBackfillRow[]; ambiguous: StandardBackfillAmbiguous[] };

type StagedItem = { observations?: DrawingObservation[] };

/**
 * What the backfill would do, read only. The dry run prints this; `--apply`
 * writes exactly this and nothing else.
 */
export async function planStandardBackfill(exec: SqlLike, projectId: string | null): Promise<StandardBackfillPlan> {
  const byJsonId = palettesByFieldJsonId(await loadPalettes(exec));
  const fieldRows = await exec`select id, json_id from spec_fields`;
  const paletteOf = new Map<string, Palette>();
  for (const row of fieldRows) {
    const palette = byJsonId.get(Number(row.json_id));
    if (palette) paletteOf.set(String(row.id), palette);
  }
  if (paletteOf.size === 0) return { rows: [], ambiguous: [] };

  const candidates = await exec`
    select a.id, a.record_id, a.label, a.value, a.spec_field_id, a.source_run_id,
           r.project_id, r.record_no, p.bws_project_number, f.name as field_name
      from record_attributes a
      join spec_records r on r.id = a.record_id
      join projects p on p.id = r.project_id
      join spec_fields f on f.id = a.spec_field_id
      join intake_runs ir on ir.id = a.source_run_id
     where a.status = 'active'
       and a.standard_state is null
       and a.value is not null
       and ir.document_kind = 'shop_drawings'
       and a.spec_field_id = any(${[...paletteOf.keys()]}::uuid[])
       and (${projectId}::uuid is null or r.project_id = ${projectId}::uuid)
     order by p.bws_project_number, r.record_no, a.sort_order
  `;
  if (candidates.length === 0) return { rows: [], ambiguous: [] };

  const runIds = [...new Set(candidates.map((row) => String(row.source_run_id)))];
  const runs = await exec`select id, parsed from intake_runs where id = any(${runIds}::uuid[])`;
  const observationsByRun = new Map<string, DrawingObservation[]>();
  for (const run of runs) {
    const parsed = run.parsed as { items?: StagedItem[] } | null;
    const list: DrawingObservation[] = [];
    for (const item of parsed?.items ?? []) for (const observation of item.observations ?? []) list.push(observation);
    observationsByRun.set(String(run.id), list);
  }

  const rows: StandardBackfillRow[] = [];
  const ambiguous: StandardBackfillAmbiguous[] = [];
  for (const candidate of candidates) {
    const attributeId = String(candidate.id);
    const value = String(candidate.value);
    const fieldId = String(candidate.spec_field_id);
    const observations = observationsByRun.get(String(candidate.source_run_id)) ?? [];

    // THE LINK THE CONFIRM RECORDED, first. Only where it recorded none is the
    // row looked for by field and value -- and then only an agreement counts.
    let observation = observations.find((row) => row.applied?.attributeIds?.includes(attributeId)) ?? null;
    if (!observation) {
      const matching = observations.filter(
        (row) => row.reviewStatus === "applied" && row.specFieldId === fieldId && row.value === value,
      );
      const words = new Set(matching.map((row) => row.valueRaw ?? ""));
      if (matching.length === 0) continue;
      if (words.size > 1) {
        ambiguous.push({
          attributeId,
          projectNumber: String(candidate.bws_project_number),
          recordNo: Number(candidate.record_no),
          label: String(candidate.label),
          why: `${matching.length} rows of that drawing wrote "${value}" to this field with different words beside it: ${[...words].map((word) => `"${word}"`).join(", ")}. Not guessed.`,
        });
        continue;
      }
      observation = matching[0] ?? null;
    }
    if (!observation) continue;

    const read = legacyPaletteStandard(
      { ...observation, value, specFieldId: fieldId, standard: undefined },
      paletteOf,
      { includeApplied: true },
    );
    if (read.standard?.state !== "proposed" || !read.standard.optionId || !read.value) continue;

    rows.push({
      attributeId,
      recordId: String(candidate.record_id),
      projectId: String(candidate.project_id),
      projectNumber: String(candidate.bws_project_number),
      recordNo: Number(candidate.record_no),
      label: String(candidate.label),
      fieldName: String(candidate.field_name ?? "").trim(),
      currentValue: value,
      option: read.standard.value,
      optionId: read.standard.optionId,
      clientWords: read.value,
      sourceRunId: String(candidate.source_run_id),
    });
  }
  return { rows, ambiguous };
}

/**
 * Writes one project's rows, inside the caller's transaction. Returns how many
 * attributes it actually moved -- zero on a second run.
 */
export async function applyStandardBackfill(
  txn: TxnSql,
  projectId: string,
  rows: StandardBackfillRow[],
  actor: string,
): Promise<{ changed: number; changeSetId: string | null }> {
  const planned = rows.filter((row) => row.projectId === projectId);
  // STILL AS THE PLAN SAW THEM, checked BEFORE a change set is opened, so a
  // second run opens nothing at all rather than an empty entry in the trail.
  const mine: StandardBackfillRow[] = [];
  for (const row of planned) {
    const live = await txn`
      select id from record_attributes
       where id = ${row.attributeId} and status = 'active' and value = ${row.currentValue} and standard_state is null
       for update
    `;
    if (live[0]) mine.push(row);
  }
  if (mine.length === 0) return { changed: 0, changeSetId: null };

  const changeSetId = await openChangeSet(txn, {
    projectId,
    kind: "standard_set",
    actor,
    reason:
      `Restored the client's words to ${mine.length} spec${mine.length === 1 ? "" : "s"} where a BWS palette pick on the drawings card had written over them, ` +
      "and kept each pick beside them as a proposed BW standard.",
  });

  const touched = new Set<string>();
  for (const row of mine) {
    // Predicated on the row still being what the plan saw, and locked above.
    await txn`
      update record_attributes
         set value = ${row.clientWords},
             standard_value = ${row.option},
             standard_option_id = ${row.optionId},
             standard_state = 'proposed',
             standard_set_by = ${actor},
             standard_set_at = now(),
             updated_by = ${actor}
       where id = ${row.attributeId}
         and status = 'active'
         and value = ${row.currentValue}
         and standard_state is null
    `;
    touched.add(row.recordId);
  }

  for (const recordId of touched) await recomposeAnswers(txn, recordId, null, actor);
  await snapshotRecords(txn, [...touched], changeSetId);
  return { changed: mine.length, changeSetId };
}
