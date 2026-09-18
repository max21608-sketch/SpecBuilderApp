// Resolving a staged drawing run against the project's live records.
//
// This is the ONE place that turns `intake_runs.parsed` into what a review
// screen needs, and it exists because there are now two screens that need it:
// one drawing run on its own, and every drawing run in a pack together.
//
// It is deliberately thin. Every decision is still made by the pure functions
// in drawing-document.ts, which the confirm route also calls; all this adds is
// the two live reads (the records register, and which BWS slots are already
// filled) that a pure function cannot do. Copying that pairing into a second
// route is how the screen and the confirm route start disagreeing about whether
// a card can commit.
//
// Nothing here is stored. Resolution is live for the reason the header of
// drawing-document.ts sets out: confirming a pack's BOQ after its drawings were
// extracted is a normal order of work, and a stored target would be stale from
// that moment on.
import { sql } from "@/lib/db";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import {
  assertStagedDrawings,
  specFieldEntries,
  drawingItemBlockers,
  drawingItemWarnings,
  occupancyThrough,
  resolveDrawingTargets,
  targetRecordIds,
  canonicalCode,
  variantLettersByItem,
  type DrawingBlocker,
  type DrawingResolution,
  type DrawingWarning,
  type OccupiedSlots,
  type OccupiedSlot,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { isDimensionSlot, type DimensionSlot } from "@/lib/spec-vocab";

export type ResolvedItem = {
  id: string;
  resolution: DrawingResolution;
  targets: string[];
  blockers: DrawingBlocker[];
  warnings: DrawingWarning[];
  /** Per pending observation: what it would displace, on which record. */
  occupants: Record<string, { recordId: string; occupant: OccupiedSlot }[]>;
  /**
   * Which configuration of its code this card is, when the code is drawn more
   * than once. Null for a code drawn once, which is most of any pack.
   */
  variantLabel: string | null;
  /**
   * Per ticked record: the variant the specs will land on, for the ones that
   * exist already. A letter with no entry here is a variant the confirm will
   * CREATE, which is why the card says "will be created" rather than showing a
   * record number it cannot yet name.
   */
  writesTo: Record<string, string>;
};

/**
 * Which BWS fields and which dimension slots are already spoken for, per record.
 *
 * Read live for the same reason the resolution is: a slot filled by another
 * card a second ago must show as a blocker here, not as a unique-violation 500
 * at confirm.
 *
 * Both halves come back together on purpose — 0007 makes a BWS field unique per
 * record and 0011 does the same for a dimension slot, so a caller that loaded
 * one and forgot the other would let exactly one of those two collisions
 * through to the database.
 */
export async function loadOccupiedSlots(projectId: string): Promise<OccupiedSlots> {
  const rows = await sql`
    select a.id, a.record_id, a.spec_field_id, a.dimension_slot, a.version, a.label, a.value, a.unit,
           a.source_page, at.filename as source_filename
    from record_attributes a
    join spec_records r on r.id = a.record_id
    left join intake_runs ir on ir.id = a.source_run_id
    left join attachments at on at.id = ir.attachment_id
    where r.project_id = ${projectId}
      and a.status = 'active'
      and (a.spec_field_id is not null or a.dimension_slot is not null)
  `;
  // The occupant itself, not just that there is one: a reviewer looking at a
  // revised drawing has to be told WHAT it would replace and off which page,
  // or "tick to replace" is a tick in the dark.
  const fields = new Map<string, Map<string, OccupiedSlot>>();
  const dimensions = new Map<string, Map<DimensionSlot, OccupiedSlot>>();
  for (const row of rows) {
    const recordId = String(row.record_id);
    const occupant: OccupiedSlot = {
      attributeId: String(row.id),
      attributeVersion: Number(row.version),
      label: String(row.label),
      value: row.value === null || row.value === undefined ? null : String(row.value),
      unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
      sourceFilename: row.source_filename === null || row.source_filename === undefined ? null : String(row.source_filename),
      sourcePage: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
    };
    if (row.spec_field_id) {
      const map = fields.get(recordId) ?? new Map<string, OccupiedSlot>();
      map.set(String(row.spec_field_id), occupant);
      fields.set(recordId, map);
    }
    if (isDimensionSlot(row.dimension_slot)) {
      const map = dimensions.get(recordId) ?? new Map<DimensionSlot, OccupiedSlot>();
      map.set(row.dimension_slot, occupant);
      dimensions.set(recordId, map);
    }
  }
  return { fields, dimensions };
}

/** The registers a drawings screen needs, read once for any number of runs. */
export async function loadDrawingContext(projectId: string) {
  const [registers, occupied, variants] = await Promise.all([
    loadExtractionRegisters(projectId),
    loadOccupiedSlots(projectId),
    loadVariants(projectId),
  ]);
  return { records: registers.records, occupied, variants };
}

/**
 * The live variants of this project's records, by parent and letter.
 *
 * Read so the screen can show the occupancy of the record a card will actually
 * write to. `resolveDrawingTargets` matches by ref and a variant deliberately
 * carries none, so variants never appear as targets of their own — they are
 * only ever reached through their parent.
 */
async function loadVariants(projectId: string): Promise<Map<string, string>> {
  const rows = await sql`
    select id, parent_id, variant_label from spec_records
     where project_id = ${projectId} and parent_id is not null and status = 'active'
  `;
  const out = new Map<string, string>();
  for (const row of rows) out.set(`${String(row.parent_id)}|${String(row.variant_label)}`, String(row.id));
  return out;
}

/**
 * What each pending observation would DISPLACE, per target record.
 *
 * Sent to the screen so "tick to replace" can say what it is replacing and off
 * which page. A tick with nothing named beside it is a tick in the dark, and
 * this is the one action in the drawings review that destroys a statement a
 * document made.
 */
export function occupantsFor(
  item: StagedDrawings["items"][number],
  targets: string[],
  occupied: Awaited<ReturnType<typeof loadDrawingContext>>["occupied"],
): Record<string, { recordId: string; occupant: OccupiedSlot }[]> {
  const out: Record<string, { recordId: string; occupant: OccupiedSlot }[]> = {};
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending") continue;
    const found: { recordId: string; occupant: OccupiedSlot }[] = [];
    for (const recordId of targets) {
      const occupant =
        observation.attrGroup === "dimension" && observation.dimensionSlot
          ? occupied.dimensions.get(recordId)?.get(observation.dimensionSlot)
          : observation.specFieldId
            ? occupied.fields.get(recordId)?.get(observation.specFieldId)
            : undefined;
      if (occupant) found.push({ recordId, occupant });
    }
    if (found.length > 0) out[observation.id] = found;
  }
  return out;
}

/** Every item of one staged run, resolved against the context. */
export function resolveStagedRun(
  staged: StagedDrawings,
  context: Awaited<ReturnType<typeof loadDrawingContext>>,
): ResolvedItem[] {
  const letters = variantLettersByItem(staged.items, staged);
  return staged.items.map((item) => {
    // THE CANONICAL CODE, not the page's own heading. A shop drawing titled
    // `MUR.2 ARMCHAIR` is the S-200 the bill lists, and matching on its title
    // block would leave it an item no record carries.
    const resolution = resolveDrawingTargets(canonicalCode(staged, item.itemCodeRaw), context.records);
    const targets = targetRecordIds(item, resolution);
    const variantLabel = letters.get(item.id) ?? null;

    // The records this card will WRITE to, where they exist. Only ever used to
    // read occupancy from the right place: `occupancyThrough` keys it back onto
    // the record the reviewer ticked, so blockers and "tick to replace" go on
    // naming what is on the card. See its header for why that matters.
    const writesTo = new Map<string, string>();
    if (variantLabel) {
      for (const parentId of targets) {
        const variantId = context.variants.get(`${parentId}|${variantLabel}`);
        if (variantId) writesTo.set(parentId, variantId);
      }
    }
    const occupied = occupancyThrough(context.occupied, writesTo);

    return {
      id: item.id,
      resolution,
      targets,
      blockers: drawingItemBlockers(item, resolution, occupied),
      warnings: drawingItemWarnings(item),
      occupants: occupantsFor(item, targets, occupied),
      variantLabel,
      writesTo: Object.fromEntries(writesTo),
    };
  });
}

/**
 * The records a reviewer can hand-pick from when a page's code matched none.
 * Trimmed, because the full register carries refs and category data no screen
 * needs and every one of them would cross the wire per request.
 */
export function recordChoices(context: Awaited<ReturnType<typeof loadDrawingContext>>) {
  return context.records.map((record) => ({
    id: record.id,
    label: record.label,
    itemDescription: record.itemDescription,
    runName: record.runName,
  }));
}

/** One run's staged JSON and its resolved items, for a screen that shows many. */
export type ResolvedRun = {
  importId: string;
  filename: string | null;
  status: string;
  error: string | null;
  version: number;
  staged: StagedDrawings | null;
  items: ResolvedItem[];
};

export async function loadBatchDrawings(
  projectId: string,
  batchId: string,
): Promise<{ runs: ResolvedRun[]; records: ReturnType<typeof recordChoices> }> {
  const rows = await sql`
    select r.id, r.status, r.error, r.version, r.parsed, a.filename
    from intake_runs r
    left join attachments a on a.id = r.attachment_id
    where r.batch_id = ${batchId}
      and r.project_id = ${projectId}
      and r.source_kind = 'spec_document'
      and r.document_kind = 'shop_drawings'
    order by a.filename nulls last, r.created_at
  `;
  if (rows.length === 0) return { runs: [], records: [] };

  // One register read for the whole pack. Thirty per-item drawing PDFs would
  // otherwise be thirty identical reads of the same project's records.
  const [context, fieldRows] = await Promise.all([
    loadDrawingContext(projectId),
    // Read once for the pack, for the same reason: `assertStagedDrawings`
    // re-reads a callout the old word lists gave up on, and needs the register
    // to give it a BWS field.
    sql`select id, json_id, name from spec_fields order by sort_order`,
  ]);
  const fields = specFieldEntries(fieldRows);

  const runs = rows.map((row) => {
    // A run that has not been read yet, or that failed, has no staged JSON.
    // That is a normal state on this screen -- the pack lists every drawing
    // file, including the ones still waiting -- not an error.
    const staged = row.parsed ? assertStagedDrawings(row.parsed, fields) : null;
    return {
      importId: String(row.id),
      filename: row.filename ? String(row.filename) : null,
      status: String(row.status),
      error: row.error ? String(row.error) : null,
      version: Number(row.version),
      staged,
      items: staged ? resolveStagedRun(staged, context) : [],
    };
  });

  return { runs, records: recordChoices(context) };
}
