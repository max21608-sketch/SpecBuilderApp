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
import { loadFieldsWithPalettes } from "@/lib/palette-load";
import { sql } from "@/lib/db";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import {
  assertStagedDrawings,
  specFieldEntries,
  drawingItemBlockers,
  drawingItemWarnings,
  occupancyThrough,
  resolveDrawingItem,
  resolveStagedItem,
  targetRecordIds,
  variantLettersByItem,
  alreadyRecorded,
  crossPageClaims,
  type CrossPageClaim,
  type SpecFieldEntry,
  namedConfigurationPlans,
  parentVariantsOf,
  rowWriteRecords,
  configurationsToCreate,
  configurationTarget,
  namedTargetsFor,
  ownVariantsOf,
  letteredPlan,
  type NamedTargets,
  type DrawingBlocker,
  type DrawingResolution,
  type DrawingWarning,
  type OccupiedSlots,
  type OccupiedSlot,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { isDimensionSlot, type DimensionSlot } from "@/lib/spec-vocab";
import { billReplacements, type BillReplacement } from "@/lib/bill-over-drawing";
import {
  isFinishCodeOrigin,
  isFinishGroup,
  isFinishKind,
  readUncodedFinish,
  resolveFinishCode,
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
   * Per pending finish row whose PROPOSED swatch could not attach — the
   * row's words for its code disagree with a described library row, so the
   * confirm has no finish to put it on (brief F). The sentence says why; the
   * card shows the proposal unticked and the confirm leaves it out. Absent
   * for every row whose proposal can attach, and for every row with none —
   * and the key itself is absent where there is nothing in it, so a v1–v3
   * run (which proposes no swatch) resolves to exactly the bytes it did.
   */
  swatchRefusals?: Record<string, string>;
  /**
   * The values THE BILL wrote that this card's pending rows would replace
   * (brief G): what the card's one press acknowledges, and lists before the
   * press. From `billReplacements`, over the same occupancy the blockers read.
   * Absent where there are none, like `swatchRefusals`.
   */
  billReplacements?: BillReplacement[];
  /**
   * For a page of a code that NAMES its configurations (schemaVersion 3), where
   * it lands — the server's answer, computed by the same pure functions the
   * confirm calls. Null for every other page, which is most of them.
   */
  named: NamedResolution | null;
  /**
   * The records whose CLIENT code the page's code names, read across EVERY
   * phase and ignoring the mock-up rule -- filled only where the card resolved
   * to nothing, so the hand picker can offer them first. Never ticked: a
   * mock-up drawing still lands on a main line only by a person's pick.
   */
  codeMatches?: string[];
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
  /**
   * Per ticked bill line, per label: where it lands — an existing configuration
   * (and why), a new one, or a question. `configurationTarget`'s answer.
   * Optional: a payload from before step 5 carries none.
   */
  lands?: Record<
    string,
    Record<string, { kind: "existing"; as: string[]; via: "linked" | "exact" | "paired" } | { kind: "create" | "ask" }>
  >;
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
 * The proposed swatches on one card that have nowhere to go (brief F).
 *
 * AN AUTOMATICALLY PROPOSED SWATCH NEVER BLOCKS A CARD. The read proposes a
 * crop per finish; where that finish's own words CONFLICT with a library row
 * that already describes the code, `resolveFinishCode` links nothing — so the
 * swatch has no finish to attach to and the confirm would refuse the whole
 * card over a picture nobody asked for. Such a proposal is shown unticked with
 * this sentence, and the confirm leaves it out. A swatch a PERSON cropped or
 * ticked keeps the old rule: refused with the reason, never dropped.
 *
 * The same reading the confirm takes (`resolveFinishCode` against the live
 * library), so the card and the confirm cannot disagree about which rows
 * these are.
 */
export function swatchRefusalsFor(
  item: StagedDrawings["items"][number],
  library: readonly Finish[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending" || !observation.swatchProposal) continue;
    const reading = resolveFinishCode(observation.materialCodeRaw, observation.value, [...library]);
    if (reading.status !== "conflict") continue;
    out[observation.id] =
      `Not used: the finishes library describes ${reading.finish.code} as "${reading.finish.description ?? ""}", and this page says "${reading.saysInstead}", so the swatch has no finish to attach to. Settle the code on the finishes page, or tick it to keep it — the confirm will then refuse the card until the code is settled.`;
  }
  return out;
}

/** The key only where it says something: `{}` would change every frozen v1–v3 resolution. */
function withSwatchRefusals(refusals: Record<string, string>): { swatchRefusals?: Record<string, string> } {
  return Object.keys(refusals).length > 0 ? { swatchRefusals: refusals } : {};
}

/** The key only where it says something, for the reason `withSwatchRefusals` gives. */
function withBillReplacements(entries: BillReplacement[]): { billReplacements?: BillReplacement[] } {
  return entries.length > 0 ? { billReplacements: entries } : {};
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
           a.state, a.material_code, a.source_page, at.filename as source_filename,
           -- WHAT THE BILL SAID, and only that (brief G): the bill's own run,
           -- no standard a person set beside it, and not the new row of a
           -- person's correction (a correction keeps the bill's run and page,
           -- and points the row it retired at itself).
           coalesce(ir.source_kind = 'boq_xlsx', false)
             and a.standard_set_by is null
             and not exists (select 1 from record_attributes p where p.superseded_by_id = a.id) as from_bill
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
      fromBill: row.from_bill === true,
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
  const [registers, occupied, variants, finishes, variantSources] = await Promise.all([
    loadExtractionRegisters(projectId),
    loadOccupiedSlots(projectId),
    loadVariants(projectId),
    loadFinishLibrary(projectId),
    loadVariantSources(projectId),
  ]);
  return { records: registers.records, occupied, variants, finishes, variantSources };
}

/**
 * Which documents wrote to each configuration: variant id -> intake run ids.
 * So a document is never asked to pair a configuration with one it made
 * itself — the S-201 A its own page 5 created is not "another source" to page 6.
 */
async function loadVariantSources(projectId: string): Promise<Map<string, Set<string>>> {
  const rows = await sql`
    select distinct a.record_id, a.source_run_id
      from record_attributes a join spec_records r on r.id = a.record_id
     where r.project_id = ${projectId} and r.parent_id is not null and a.source_run_id is not null
  `;
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = out.get(String(row.record_id)) ?? new Set<string>();
    set.add(String(row.source_run_id));
    out.set(String(row.record_id), set);
  }
  return out;
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
  // The intake run this staged document IS, so its own configurations are
  // never "another source". Optional: without it only its links count.
  runId: string | null = null,
): ResolvedItem[] {
  const letters = variantLettersByItem(staged.items, staged);
  // Two pages of one code giving one configuration one BWS field — computed
  // over the WHOLE document, by the same function the confirm calls.
  const crossPage = crossPageClaims(staged.items, staged, fields);
  const plans = namedConfigurationPlans(staged.items, staged);
  const variantsByParent = parentVariantsOf(context.records);
  return staged.items.map((item) => {
    // THE CANONICAL CODE, not the page's own heading. A shop drawing titled
    // `MUR.2 ARMCHAIR` is the S-200 the bill lists, and matching on its title
    // block would leave it an item no record carries.
    const resolution = resolveDrawingItem(staged, item, context.records);
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
    // A page LETTER reads through the same pair-or-create path as a name.
    const plan = plans.get(item.id) ?? (variantLabel ? letteredPlan(item, variantLabel) : null);
    const named: NamedTargets | null = plan
      ? namedTargetsFor(item, plan, variantsByParent, staged, ownVariantsOf(staged, runId, context.variantSources))
      : null;
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
      ...withSwatchRefusals(swatchRefusalsFor(item, context.finishes)),
      ...withBillReplacements(billReplacements(item, targets, occupied, named)),
      named: named ? namedResolution(targets, resolution, named) : null,
      ...withCodeMatches(resolution.runs.length === 0 ? codeMatchesOf(staged, item, context.records) : []),
    };
  });
}

/**
 * THE CLIENT'S CODE, OFFERED FIRST WHEN NOTHING RESOLVED (Max, 2026-10-05:
 * "try and match by their code ... that would be the first port of call").
 *
 * On pilot, AM-ID-MUR-FUR-13 is a mock-up drawing and the project has no
 * mock-up phase, so the card resolved to nothing and the hand picker listed
 * all 67 records by OUR number -- and "13" read as record 13, a coffee table,
 * where FUR-13 is the bathroom side table on GR-FUR-13 and PL-FUR-13. The
 * same resolver, run without the mock-up filter, says which records carry the
 * code; the picker lists those first. It suggests nothing and ticks nothing.
 */
/** Present only when there is something to offer, so a resolved card's payload is unchanged. */
function withCodeMatches(ids: string[]): { codeMatches?: string[] } {
  return ids.length > 0 ? { codeMatches: ids } : {};
}

function codeMatchesOf(
  staged: StagedDrawings,
  item: StagedDrawings["items"][number],
  records: Awaited<ReturnType<typeof loadDrawingContext>>["records"],
): string[] {
  const { runs } = resolveStagedItem(staged, item, records);
  return runs.flatMap((run) => (run.status === "matched" ? [run.record.id] : run.candidates.map((c) => c.id)));
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
  const lands: NamedResolution["lands"] = {};
  for (const parentId of targets) {
    lands[parentId] = {};
    for (const label of named.plan.labels) {
      const target = configurationTarget(parentId, label, named);
      lands[parentId][label] =
        target.kind === "existing" ? { kind: "existing", as: target.as, via: target.via } : { kind: target.kind };
    }
  }
  return {
    labels: named.plan.labels,
    rows: named.plan.rows,
    create: Object.fromEntries(configurationsToCreate(targets, named)),
    existing,
    recordNames,
    lands,
  };
}

/**
 * The records a reviewer can hand-pick from when a page's code matched none.
 * Trimmed, because the full register carries refs and category data no screen
 * needs and every one of them would cross the wire per request.
 */
export function recordChoices(context: Awaited<ReturnType<typeof loadDrawingContext>>) {
  // The client's own code leads and orders the list: it is what the drawings
  // and the bill call the item, where the record number is ours.
  return context.records
    .map((record) => ({
      id: record.id,
      label: record.label,
      codes: record.boqCodes.map((code) => code.trim()).filter((code) => code !== ""),
      itemDescription: record.itemDescription,
      runName: record.runName,
    }))
    .sort(
      (a, b) =>
        Number(a.codes.length === 0) - Number(b.codes.length === 0) ||
        (a.codes[0] ?? "").localeCompare(b.codes[0] ?? "", undefined, { numeric: true }) ||
        a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
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
    // With its palettes (0041): a pick made before the standard existed is
    // read as a standard here exactly as the confirm will read it.
    loadFieldsWithPalettes(sql),
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
      items: staged ? resolveStagedRun(staged, context, fields, String(row.id)) : [],
    };
  });

  return { runs, records: recordChoices(context) };
}
