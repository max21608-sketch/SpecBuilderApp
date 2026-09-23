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
  alreadyRecorded,
  crossPageClaims,
  type CrossPageClaim,
  type SpecFieldEntry,
  namedConfigurationPlans,
  parentVariantsOf,
  rowWriteRecords,
  configurationsToCreate,
  type NamedTargets,
  type DrawingBlocker,
  type DrawingResolution,
  type DrawingWarning,
  type OccupiedSlots,
  type OccupiedSlot,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { isDimensionSlot, type DimensionSlot } from "@/lib/spec-vocab";
import {
  isFinishCodeOrigin,
  isFinishGroup,
  isFinishKind,
  readUncodedFinish,
  type Finish,
} from "@/lib/finishes";

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
  /**
   * Per pending observation that is a FINISH the client gave no code for: what
   * filing it would do, and what is offered.
   *
   * Computed by `readUncodedFinish`, which the confirm route also calls — one
   * implementation, two callers, so the chip on the card and what the confirm
   * writes cannot disagree. A row carrying a client code is absent from this
   * map entirely: the code is the key there and stays the key.
   */
  finishFilings: Record<string, FinishFilingView>;
  /**
   * For a page of a code that NAMES its configurations (schemaVersion 3), where
   * it lands — the server's answer, computed by the same pure functions the
   * confirm calls. Null for every other page, which is most of them.
   */
  named: NamedResolution | null;
};

/** What the card is told about a page of named configurations. Compact: it crosses the wire. */
export type NamedResolution = {
  /** The folded labels this page writes, in the code's order. */
  labels: string[];
  /** Per observation, the folded labels it lands on. */
  rows: Record<string, string[]>;
  /** Per ticked bill line, the labels confirming would CREATE. */
  create: Record<string, string[]>;
  /** Per ticked bill line, its live configurations (label -> record id). */
  existing: Record<string, Record<string, string>>;
  /** Variant id -> what to call it on the card: `MAIN RUN · TYPE 2`. */
  recordNames: Record<string, string>;
};

/** What the card shows about one uncoded finish. Compact: it crosses the wire. */
export type FinishFilingView = {
  outcome: "none" | "link" | "mint";
  finishId: string | null;
  /** The code it links to. An internal one, always, and never exported. */
  code: string | null;
  why: string | null;
  /** Offered and NOT taken. Pressing it is what files anything. */
  suggestion: { code: string; codeNorm: string; why: string } | null;
};

/** The project's finishes library, as the pure resolver wants it. */
export async function loadFinishLibrary(projectId: string): Promise<Finish[]> {
  const rows = await sql`
    select id, code, code_norm, code_origin, kind, description, supplier_raw, reference, colour, state
    from project_finishes where project_id = ${projectId} and status = 'active'
  `;
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    codeNorm: String(row.code_norm),
    codeOrigin: isFinishCodeOrigin(row.code_origin) ? row.code_origin : "client",
    kind: isFinishKind(row.kind) ? row.kind : null,
    description: row.description === null || row.description === undefined ? null : String(row.description),
    supplierRaw: row.supplier_raw === null || row.supplier_raw === undefined ? null : String(row.supplier_raw),
    reference: row.reference === null || row.reference === undefined ? null : String(row.reference),
    colour: row.colour === null || row.colour === undefined ? null : String(row.colour),
    state: String(row.state) as Finish["state"],
  }));
}

/**
 * The uncoded finishes on one card, read against the library.
 *
 * The library is read ONCE for the whole run and is NOT grown as this walks:
 * two identical uncoded fabrics on one card both read "nothing filed yet" on
 * screen, and the confirm — which does grow it — mints one code and links the
 * second to it. Showing two mints would be wrong about the second; showing the
 * first's code beside the second would name a code that does not exist yet.
 */
export function finishFilingsFor(
  item: StagedDrawings["items"][number],
  library: readonly Finish[],
): Record<string, FinishFilingView> {
  const out: Record<string, FinishFilingView> = {};
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending") continue;
    if (!isFinishGroup(observation.attrGroup)) continue;
    if (observation.materialCodeRaw?.trim()) continue;
    if (!observation.value?.trim()) continue;
    const reading = readUncodedFinish(observation.value, library, observation.finishFiling ?? null);
    out[observation.id] = {
      outcome: reading.outcome,
      finishId: reading.finish?.id ?? null,
      code: reading.finish?.code ?? null,
      why: reading.why,
      suggestion: reading.suggestion
        ? {
            code: reading.suggestion.finish.code,
            codeNorm: reading.suggestion.finish.codeNorm,
            why: reading.suggestion.why,
          }
        : null,
    };
  }
  return out;
}

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
           a.state, a.material_code, a.source_page, at.filename as source_filename
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
      state: row.state === null || row.state === undefined ? null : String(row.state),
      materialCode: row.material_code === null || row.material_code === undefined ? null : String(row.material_code),
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
  const [registers, occupied, variants, finishes] = await Promise.all([
    loadExtractionRegisters(projectId),
    loadOccupiedSlots(projectId),
    loadVariants(projectId),
    loadFinishLibrary(projectId),
  ]);
  return { records: registers.records, occupied, variants, finishes };
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
  // A named page: each row's own configurations' live variants, by the same
  // function the blockers and the confirm use.
  named: NamedTargets | null = null,
): Record<string, { recordId: string; occupant: OccupiedSlot }[]> {
  const out: Record<string, { recordId: string; occupant: OccupiedSlot }[]> = {};
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending") continue;
    const found: { recordId: string; occupant: OccupiedSlot }[] = [];
    for (const recordId of rowWriteRecords(observation.id, targets, named)) {
      const occupant =
        observation.attrGroup === "dimension" && observation.dimensionSlot
          ? occupied.dimensions.get(recordId)?.get(observation.dimensionSlot)
          : observation.specFieldId
            ? occupied.fields.get(recordId)?.get(observation.specFieldId)
            : undefined;
      // The same measurement already recorded is not something to replace, and
      // offering a tick for it is a question with no decision in it.
      if (occupant && !alreadyRecorded(observation, occupant)) found.push({ recordId, occupant });
    }
    if (found.length > 0) out[observation.id] = found;
  }
  return out;
}

/** Every item of one staged run, resolved against the context. */
export function resolveStagedRun(
  staged: StagedDrawings,
  context: Awaited<ReturnType<typeof loadDrawingContext>>,
  // The field register, for the NAME in a cross-page clash sentence ("both give
  // COM 1"). Optional: without it the sentence says "the same BWS field".
  fields: readonly SpecFieldEntry[] = [],
): ResolvedItem[] {
  const letters = variantLettersByItem(staged.items, staged);
  // Two pages of one code giving one configuration one BWS field — computed
  // over the WHOLE document, by the same function the confirm calls.
  const crossPage = crossPageClaims(staged.items, staged, fields);
  const plans = namedConfigurationPlans(staged.items, staged);
  const variantsByParent = plans.size > 0 ? parentVariantsOf(context.records) : new Map<string, Map<string, string>>();
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
    const plan = plans.get(item.id) ?? null;
    const named: NamedTargets | null = plan ? { plan, variants: variantsByParent } : null;
    // A named page reads occupancy off the REAL variants: one bill line has
    // several, and a re-key onto the parent could only hold one of them.
    const occupied = named ? context.occupied : occupancyThrough(context.occupied, writesTo);

    return {
      id: item.id,
      resolution,
      targets,
      blockers: drawingItemBlockers(item, resolution, occupied, named, crossPage),
      warnings: [
        ...drawingItemWarnings(item),
        ...alreadyRecordedWarnings(item, targets, occupied, named),
        ...sameFinishWarnings(item, crossPage),
      ],
      occupants: occupantsFor(item, targets, occupied, named),
      variantLabel,
      writesTo: Object.fromEntries(writesTo),
      finishFilings: finishFilingsFor(item, context.finishes),
      named: named ? namedResolution(targets, resolution, named) : null,
    };
  });
}

/**
 * "Already recorded from page 1" beside a dimension the confirm will write
 * NOTHING for, because the record holds the same one. A warning, not a
 * blocker: it never stops the card, and the confirm cannot even name it.
 */
function alreadyRecordedWarnings(
  item: StagedDrawings["items"][number],
  targets: string[],
  occupied: OccupiedSlots,
  named: NamedTargets | null,
): DrawingWarning[] {
  const out: DrawingWarning[] = [];
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending") continue;
    const isDimension = observation.attrGroup === "dimension" && Boolean(observation.dimensionSlot);
    if (!isDimension && !observation.specFieldId) continue;
    const pages = new Set<string>();
    let count = 0;
    for (const recordId of rowWriteRecords(observation.id, targets, named)) {
      const occupant = isDimension
        ? occupied.dimensions.get(recordId)?.get(observation.dimensionSlot!)
        : occupied.fields.get(recordId)?.get(observation.specFieldId!);
      if (!alreadyRecorded(observation, occupant)) continue;
      count += 1;
      pages.add(occupant?.sourcePage ? `page ${occupant.sourcePage}` : "another page");
    }
    if (count === 0) continue;
    out.push({
      code: "already_recorded",
      observationId: observation.id,
      message: `Already recorded from ${[...pages].join(" and ")}${count > 1 ? ` on ${count} records` : ""} — ${
        isDimension ? "the same figure" : `the same finish, ${(observation.materialCodeRaw ?? "").trim()}`
      }, so nothing new is written there.`,
    });
  }
  return out;
}

/** "Page 2 names the same finish, WD-01" beside a row the card folds. Never a blocker. */
function sameFinishWarnings(
  item: StagedDrawings["items"][number],
  crossPage: ReadonlyMap<string, CrossPageClaim>,
): DrawingWarning[] {
  const out: DrawingWarning[] = [];
  for (const observation of item.observations) {
    const claim = crossPage.get(observation.id);
    if (observation.reviewStatus === "pending" && claim?.kind === "same_finish") {
      out.push({ code: "already_recorded", observationId: observation.id, message: claim.message });
    }
  }
  return out;
}

function namedResolution(targets: string[], resolution: DrawingResolution, named: NamedTargets): NamedResolution {
  const runNameOf = new Map<string, string>();
  for (const run of resolution.runs) if (run.status === "matched") runNameOf.set(run.record.id, run.runName);
  const existing: NamedResolution["existing"] = {};
  const recordNames: NamedResolution["recordNames"] = {};
  for (const parentId of targets) {
    const variants = named.variants.get(parentId);
    existing[parentId] = Object.fromEntries(variants ?? []);
    for (const [label, variantId] of variants ?? []) {
      recordNames[variantId] = `${runNameOf.get(parentId) ?? "this phase"} · ${label}`;
    }
  }
  return {
    labels: named.plan.labels,
    rows: named.plan.rows,
    create: Object.fromEntries(configurationsToCreate(targets, named)),
    existing,
    recordNames,
  };
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
  /**
   * `pending` because the pack is already reading as many documents as it may,
   * rather than because nobody has asked for it. Two different sentences on
   * the screen, and only one of them is a button somebody has to press.
   */
  waitingForSlot: boolean;
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
    select r.id, r.status, r.error, r.version, r.parsed, a.filename,
           -- Deferred by the in-flight cap, not by a person: the pair (no
           -- attempt, a live deadline) is written by nothing else, because
           -- openAttempt always writes both.
           --
           -- THE SAME EXPRESSION IS IN src/app/api/projects/[id]/batches/route.ts,
           -- which is where the pack screen reads it, and in
           -- src/app/api/projects/[id]/route.ts, where the overview polls on
           -- it. The HTTP driver cannot share a SQL fragment, so the three
           -- copies are the price, and tests/lib/intake-in-flight.test.ts
           -- fails the moment they differ.
           (r.status = 'pending' and r.attempt_id is null and r.attempt_deadline_at > now())
             as waiting_for_slot
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
      waitingForSlot: Boolean(row.waiting_for_slot),
      error: row.error ? String(row.error) : null,
      version: Number(row.version),
      staged,
      items: staged ? resolveStagedRun(staged, context, fields) : [],
    };
  });

  return { runs, records: recordChoices(context) };
}
