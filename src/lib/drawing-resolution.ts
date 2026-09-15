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
  drawingItemBlockers,
  drawingItemWarnings,
  resolveDrawingTargets,
  targetRecordIds,
  type DrawingBlocker,
  type DrawingResolution,
  type DrawingWarning,
  type OccupiedSlots,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { isDimensionSlot, type DimensionSlot } from "@/lib/spec-vocab";

export type ResolvedItem = {
  id: string;
  resolution: DrawingResolution;
  targets: string[];
  blockers: DrawingBlocker[];
  warnings: DrawingWarning[];
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
    select a.record_id, a.spec_field_id, a.dimension_slot
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where r.project_id = ${projectId}
      and a.status = 'active'
      and (a.spec_field_id is not null or a.dimension_slot is not null)
  `;
  const fields = new Map<string, Set<string>>();
  const dimensions = new Map<string, Set<DimensionSlot>>();
  for (const row of rows) {
    const recordId = String(row.record_id);
    if (row.spec_field_id) {
      const set = fields.get(recordId) ?? new Set<string>();
      set.add(String(row.spec_field_id));
      fields.set(recordId, set);
    }
    if (isDimensionSlot(row.dimension_slot)) {
      const set = dimensions.get(recordId) ?? new Set<DimensionSlot>();
      set.add(row.dimension_slot);
      dimensions.set(recordId, set);
    }
  }
  return { fields, dimensions };
}

/** The registers a drawings screen needs, read once for any number of runs. */
export async function loadDrawingContext(projectId: string) {
  const [registers, occupied] = await Promise.all([
    loadExtractionRegisters(projectId),
    loadOccupiedSlots(projectId),
  ]);
  return { records: registers.records, occupied };
}

/** Every item of one staged run, resolved against the context. */
export function resolveStagedRun(
  staged: StagedDrawings,
  context: Awaited<ReturnType<typeof loadDrawingContext>>,
): ResolvedItem[] {
  return staged.items.map((item) => {
    const resolution = resolveDrawingTargets(item.itemCodeRaw, context.records);
    return {
      id: item.id,
      resolution,
      targets: targetRecordIds(item, resolution),
      blockers: drawingItemBlockers(item, resolution, context.occupied),
      warnings: drawingItemWarnings(item),
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
  const context = await loadDrawingContext(projectId);

  const runs = rows.map((row) => {
    // A run that has not been read yet, or that failed, has no staged JSON.
    // That is a normal state on this screen -- the pack lists every drawing
    // file, including the ones still waiting -- not an error.
    const staged = row.parsed ? assertStagedDrawings(row.parsed) : null;
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
