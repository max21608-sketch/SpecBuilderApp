// Staging the ITEM-CENTRIC drawings read (schemaVersion 4, 2026-10-04).
//
// Pure, like drawing-document.ts, and for the same reason: every function here
// is a reading the review screen and the confirm route must agree about.
//
// ============================================================================
// WHAT CHANGED, AND WHAT DID NOT.
//
// The version 3 read asked for one entry per item PER PAGE and every figure on
// it, and a dozen helpers glued the pages back together and second-guessed
// the model. Version 4 asks the model the real question once — what are the
// things to be made, and what does the document say about each — so an item
// arrives WHOLE: every page that describes it, every code it is titled by, its
// overall size as five slots of one figure each (with the view and page each
// was read from, and every rival figure kept beside it as a candidate), its
// configurations as the document names them, its finishes, every other
// statement a specification sheet makes, and what the read could not settle.
//
// It is staged onto the EXISTING `DrawingItem` / `DrawingObservation` shape,
// so the review screen, the autosave route and the confirm need the least
// change: one `DrawingItem` per thing to make, with `pages` beside `page` and
// a `page` on every row. Nothing in drawing-document.ts that reads a staged
// item has to learn a second shape.
//
// APPLIED HERE EXACTLY AS VERSION 3 APPLIES THEM — the parts that read what
// the page PRINTED:
//   * a figure and its unit split apart, and a feet-and-inches figure rejoined
//     (`splitFigureAndUnit`, `rejoinInchMark`): `5'-7"` is `in`, printed;
//   * a combined line's PRINTED prefixes (`W1520`, `Dia.460`) through
//     `parseCombinedDimensions` — and nothing positional;
//   * the TBC marker (`suggestAttributeState`), and the read-time upgrades
//     `assertStagedDrawings` runs on every version;
//   * `classifyCallout` and BWS-field claiming per configuration
//     (`ScopedClaims`), so a finish lands on the same field it would have;
//   * `mergeNoteBlocks`, on the item's plain notes, per page.
//
// NOT APPLIED, and gated on the version where they run rather than deleted:
// code groups and the canonical-code regrouping (the item carries its codes),
// page lettering (a page count is not a split), cross-page claims (one item is
// one card), the cross-view de-duplication (each slot is one figure already),
// the magnitude unit vote and the slot guess (the page states a unit or a
// person is asked; the model said which figure is which).
// ============================================================================
import {
  classifyCallout,
  fieldClaimScopes,
  mergeNoteBlocks,
  nextId,
  pickItemView,
  printedImperialUnit,
  rejoinInchMark,
  resolveDimensionUnit,
  ScopedClaims,
  splitFigureAndUnit,
  suggestAttributeState,
  suggestSpecField,
  usableBox,
  usableViews,
  type DrawingItem,
  type DrawingObservation,
  type SpecFieldEntry,
  type StagedConfiguration,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { parseCombinedDimensions, toMillimetres } from "@/lib/dimensions";
import { DIMENSION_SLOT_LABELS, normaliseDimensionSlot, normaliseUnit, type AttributeState, type AttributeUnit, type DimensionSlot } from "@/lib/spec-vocab";
import { normaliseRef } from "@/lib/record-refs";
import {
  OVERALL_KEYS,
  OVERALL_SLOT,
  type DrawingsItemsOutput,
  type OverallKey,
  type RawDrawingItemV4,
  type RawOverallFigure,
} from "@/lib/extraction-schema";

/** The shape a version 4 staging produces. */
export const ITEMS_SCHEMA_VERSION = 4 as const;

/** A figure as staged: the value and the unit the page printed, split and rejoined as version 3 does it. */
function stagedFigure(valueRaw: string | null, unitRaw: string | null): { value: string | null; printed: AttributeUnit | null } {
  const split = splitFigureAndUnit(rejoinInchMark(valueRaw, unitRaw));
  return { value: split.value, printed: normaliseUnit(unitRaw) ?? split.unit ?? printedImperialUnit(split.value) };
}

/**
 * Printed, else the project's own default, else nothing — and NEVER the
 * magnitude vote. A version 4 read states the unit where the page prints one;
 * where it does not, `suggestUnit` reading 840 as millimetres is exactly the
 * inference the read was asked not to make, and a missing unit is asked for on
 * the card (`unit_missing`), as it always has been.
 */
function unitFor(printed: AttributeUnit | null, projectDefault: AttributeUnit | null) {
  return resolveDimensionUnit({ printed, pageGuess: { status: "none" }, projectDefault });
}

/** The pending row every staging path starts from. */
function baseRow(fields: Partial<DrawingObservation> & Pick<DrawingObservation, "attrGroup" | "labelRaw" | "valueRaw">): DrawingObservation {
  return {
    id: nextId(),
    version: 1,
    materialCodeRaw: null,
    value: null,
    unit: null,
    unitSuggested: false,
    specFieldId: null,
    state: null,
    stateReason: null,
    reviewStatus: "pending",
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
    ...fields,
  };
}

/** "page 3", "pages 3–4", "pages 2, 5 and 7". */
export function pagesInWords(pages: readonly number[]): string | null {
  const sorted = [...new Set(pages.filter((page) => Number.isInteger(page) && page > 0))].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return `page ${sorted[0]}`;
  const contiguous = sorted.every((page, index) => index === 0 || page === sorted[index - 1]! + 1);
  if (contiguous) return `pages ${sorted[0]}–${sorted[sorted.length - 1]}`;
  return `pages ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/**
 * One overall slot as a dimension row.
 *
 * The model's slot is the answer: it was asked for AT MOST ONE figure per slot
 * by the shape of the question, and said which view it read it off. What is
 * still checked is the view's own WORD — `normaliseDimensionSlot` over the
 * view, by its whole-label rule — and a view that names a different slot
 * ("DEPTH" printed beside a figure read as the width) is FLAGGED on the row
 * with both readings, never settled silently. The model's slot is kept: a view
 * name is not a label on the figure, and version 3's "the printed word wins"
 * was about a label printed beside the figure itself.
 */
function overallRow(
  key: OverallKey,
  figure: NonNullable<RawOverallFigure>,
  firstPage: number | null,
  projectDefault: AttributeUnit | null,
  configurations: string[],
): DrawingObservation {
  const slot: DimensionSlot = OVERALL_SLOT[key];
  const staged = stagedFigure(figure.valueRaw, figure.unitRaw);
  const unit = unitFor(staged.printed, projectDefault);
  const state = suggestAttributeState(staged.value);
  const fromView = normaliseDimensionSlot(figure.view);
  const disagrees = fromView !== null && fromView !== slot;
  const evidence = [figure.evidence, figure.view && !figure.evidence?.includes(figure.view) ? `(${figure.view})` : null]
    .filter(Boolean)
    .join(" ");
  return baseRow({
    attrGroup: "dimension",
    dimensionSlot: slot,
    slotSuggested: disagrees,
    slotReason: disagrees
      ? `The view is labelled "${figure.view}". The read gives this as the ${DIMENSION_SLOT_LABELS[slot].toLowerCase()} — ${figure.evidence ?? "no reason given"}. Check it against the drawing.`
      : evidence || null,
    isOverall: true,
    labelRaw: DIMENSION_SLOT_LABELS[slot],
    valueRaw: staged.value,
    value: state.value,
    unit: unit.unit,
    unitSuggested: unit.source === "project_default",
    ...(unit.source ? { unitSource: unit.source } : {}),
    state: state.state,
    stateReason: state.reason,
    page: figure.page ?? firstPage,
    view: figure.view,
    ...(configurations.length > 0 ? { configurations } : {}),
    ...(figure.candidates.length > 0
      ? {
          candidates: figure.candidates.map((candidate) => ({
            valueRaw: candidate.valueRaw,
            unitRaw: candidate.unitRaw,
            view: candidate.view,
            page: candidate.page,
          })),
        }
      : {}),
  });
}

/** The same measurement, in whole millimetres, or null where it cannot be said. */
function millimetres(row: Pick<DrawingObservation, "value" | "valueRaw" | "unit">): number | null {
  if (!row.unit) return null;
  const converted = toMillimetres(row.value ?? row.valueRaw, row.unit);
  return converted.ok ? Math.round(converted.mm) : null;
}

/**
 * A finish's state and value.
 *
 * A CODE PRINTED ALONE IS A STATEMENT. The read is told never to describe a
 * code in its own words, so on the Aman sheets most finishes arrive as a code
 * and nothing else — and the library, filled from the finishes schedule
 * before the drawings, is what supplies the words. The row's value is then
 * the code as printed, confirmed: `record_attributes` refuses a confirmed row
 * with no value, and `TBC` would claim the client had not decided a finish the
 * page names exactly. `finishWordsOf` (finishes.ts) reads such a value as
 * saying nothing about the description, so it never raises a conflict against
 * the library and never becomes the library's description.
 */
function finishValue(spec: string | null, code: string | null): { value: string | null; state: AttributeState | null; reason: string | null } {
  if (!spec?.trim() && code?.trim()) return { value: code.trim(), state: "confirmed", reason: null };
  const suggested = suggestAttributeState(spec);
  return { value: suggested.value, state: suggested.state, reason: suggested.reason };
}

/**
 * One version 4 item, staged.
 *
 * Exported for the tests; `stageDrawingsV4` is the caller.
 */
export function stageItemV4(
  raw: RawDrawingItemV4,
  fields: SpecFieldEntry[],
  projectDefault: AttributeUnit | null,
): DrawingItem {
  // ---- identity -----------------------------------------------------------
  const codes: string[] = [];
  for (const code of raw.codes) {
    if (!codes.some((kept) => normaliseRef(kept) === normaliseRef(code))) codes.push(code);
  }
  const rowPages = [
    ...OVERALL_KEYS.map((key) => raw.overall[key]?.page ?? null),
    ...raw.finishes.map((finish) => finish.page),
    ...raw.statements.map((statement) => statement.page),
    ...raw.otherDimensions.map((dimension) => dimension.page),
    ...raw.notes.map((note) => note.page),
    ...raw.pictures.map((picture) => picture.page),
  ].filter((page): page is number => typeof page === "number");
  // The pages the read listed, and any page a row says it is on: a row citing
  // page 4 on an item listed as page 3 is still on the item's card, and the
  // strip has to be able to show it.
  const pages = [...new Set([...raw.pages, ...rowPages])].sort((a, b) => a - b);
  const firstPage = pages[0] ?? null;

  const configurations: StagedConfiguration[] = raw.configurations.map((entry) => ({
    name: entry.name,
    nameRaw: entry.nameRaw,
    evidence: entry.differsIn,
    ...(entry.pages.length > 0 ? { pages: [...entry.pages] } : {}),
  }));
  const itemShell: Pick<DrawingItem, "configurations" | "depictsConfigurations"> = { configurations };
  const scopesOf = fieldClaimScopes(itemShell);
  const taken = new ScopedClaims();
  const observations: DrawingObservation[] = [];

  // ---- the overall size ---------------------------------------------------
  // A configuration's own figure REPLACES the item's for that configuration,
  // so the item's row lands on every configuration that does NOT state its
  // own: otherwise Type 2's own width and the shared width both land on Type 2
  // and the card reads "two of these are the width" — the blocker this shape
  // exists to make impossible. Where EVERY configuration states its own, the
  // item's figure lands on none of them and is kept as a note, nothing lost.
  const overrides = new Map<OverallKey, string[]>();
  for (const configuration of raw.configurations) {
    for (const key of OVERALL_KEYS) {
      if (configuration.overall[key]) overrides.set(key, [...(overrides.get(key) ?? []), configuration.name]);
    }
  }
  const allNames = raw.configurations.map((configuration) => configuration.name);
  const filled = new Map<DimensionSlot, number | null>();
  for (const key of OVERALL_KEYS) {
    const figure = raw.overall[key];
    if (!figure) continue;
    const overriddenBy = overrides.get(key) ?? [];
    const landsOn = overriddenBy.length > 0 ? allNames.filter((name) => !overriddenBy.includes(name)) : [];
    const row = overallRow(key, figure, firstPage, projectDefault, landsOn);
    if (overriddenBy.length > 0 && landsOn.length === 0) {
      observations.push({
        ...row,
        attrGroup: "note",
        dimensionSlot: null,
        slotSuggested: false,
        labelRaw: `${DIMENSION_SLOT_LABELS[OVERALL_SLOT[key]]} (every configuration states its own)`,
      });
      continue;
    }
    filled.set(OVERALL_SLOT[key], millimetres(row));
    observations.push(row);
  }
  for (const configuration of raw.configurations) {
    for (const key of OVERALL_KEYS) {
      const figure = configuration.overall[key];
      if (!figure) continue;
      observations.push(overallRow(key, figure, configuration.pages[0] ?? firstPage, projectDefault, [configuration.name]));
    }
  }

  // ---- a size printed as one line ------------------------------------------
  // Its PRINTED prefixes only: `W1520` is the page saying which figure is the
  // width. A prefixed part fills a slot the overall size left empty; one the
  // overall size already holds at the same figure says nothing new; one that
  // DISAGREES is kept beside it as a note, so the disagreement is on the card.
  // The line itself is kept verbatim, folded, so it can be checked.
  if (raw.combinedLine?.trim()) {
    const parsed = parseCombinedDimensions(raw.combinedLine);
    const printedUnit = normaliseUnit(parsed.unitRaw);
    for (const part of parsed.parts) {
      if (!part.slot || part.slotSuggested) continue;
      const unit = unitFor(printedUnit ?? printedImperialUnit(part.value), projectDefault);
      const hasFigure = part.value !== null && /\d/.test(part.value);
      const state: AttributeState = part.tbc || !hasFigure ? "tbc" : "confirmed";
      const row = baseRow({
        attrGroup: "dimension",
        dimensionSlot: part.slot,
        slotSuggested: false,
        slotReason: `Prefixed in the printed line "${raw.combinedLine.trim()}".`,
        isOverall: true,
        labelRaw: DIMENSION_SLOT_LABELS[part.slot],
        valueRaw: part.value,
        value: part.value,
        unit: unit.unit,
        unitSuggested: unit.source === "project_default",
        ...(unit.source ? { unitSource: unit.source } : {}),
        state,
        page: firstPage,
      });
      if (!filled.has(part.slot)) {
        filled.set(part.slot, millimetres(row));
        observations.push(row);
      } else if (filled.get(part.slot) !== millimetres(row)) {
        observations.push({
          ...row,
          attrGroup: "note",
          dimensionSlot: null,
          labelRaw: `${DIMENSION_SLOT_LABELS[part.slot]} (printed line)`,
        });
      }
    }
    const state = suggestAttributeState(raw.combinedLine);
    observations.push(
      baseRow({
        attrGroup: "note",
        labelRaw: "Overall size as printed",
        valueRaw: raw.combinedLine,
        value: state.value,
        state: state.state,
        stateReason: state.reason,
        isOverall: false,
        page: firstPage,
      }),
    );
  }

  // ---- finishes -----------------------------------------------------------
  let materialNo = 0;
  for (const finish of raw.finishes) {
    materialNo += 1;
    const callout = classifyCallout({
      labelRaw: finish.part,
      valueRaw: finish.spec,
      materialCodeRaw: finish.code,
      itemNameRaw: raw.name,
    });
    const scopes = scopesOf(finish);
    const specFieldId = suggestSpecField(
      { attrGroup: callout.group, labelRaw: finish.part, valueRaw: finish.spec, materialCodeRaw: finish.code, itemNameRaw: raw.name },
      fields,
      taken.across(scopes),
    );
    if (specFieldId) taken.claim(scopes, specFieldId);
    const stated = finishValue(finish.spec, finish.code);
    const swatchBox = finish.swatch ? usableBox(finish.swatch.box) : null;
    const swatchPage = finish.swatch?.page ?? finish.page ?? firstPage;
    observations.push(
      baseRow({
        attrGroup: callout.group,
        labelRaw: finish.part ?? `Material ${materialNo}`,
        valueRaw: finish.spec,
        materialCodeRaw: finish.code,
        value: stated.value,
        state: stated.state,
        stateReason: stated.reason,
        ...(callout.guessed ? { groupSuggested: true, groupReason: callout.reason } : {}),
        specFieldId,
        page: finish.page ?? firstPage,
        ...(finish.configurations.length > 0 ? { configurations: [...finish.configurations] } : {}),
        ...(swatchBox && swatchPage !== null ? { swatchProposal: { page: swatchPage, bbox: swatchBox } } : {}),
      }),
    );
  }

  // ---- everything else a specification sheet states -------------------------
  // Kept as notes, requirement-free, with the label and value as printed: that
  // is what `record_attributes` was made for. Never merged into a block — the
  // label is the sheet's own field name and each line is its own statement.
  for (const statement of raw.statements) {
    if (!statement.value?.trim() && !statement.label?.trim()) continue;
    const state = suggestAttributeState(statement.value);
    observations.push(
      baseRow({
        attrGroup: "note",
        labelRaw: statement.label?.trim() || "Statement",
        valueRaw: statement.value,
        value: state.value,
        state: state.state,
        stateReason: state.reason,
        page: statement.page ?? firstPage,
        ...(statement.configurations.length > 0 ? { configurations: [...statement.configurations] } : {}),
      }),
    );
  }

  // ---- every other dimension, folded -----------------------------------------
  let dimensionNo = 0;
  for (const dimension of raw.otherDimensions) {
    dimensionNo += 1;
    const staged = stagedFigure(dimension.valueRaw, dimension.unitRaw);
    const unit = unitFor(staged.printed, projectDefault);
    const state = suggestAttributeState(staged.value);
    observations.push(
      baseRow({
        attrGroup: "note",
        dimensionSlot: null,
        slotSuggested: false,
        isOverall: false,
        labelRaw: dimension.label?.trim() || dimension.view?.trim() || `Dimension ${dimensionNo}`,
        valueRaw: staged.value,
        value: state.value,
        unit: unit.unit,
        unitSuggested: unit.source === "project_default",
        ...(unit.source ? { unitSource: unit.source } : {}),
        state: state.state,
        stateReason: state.reason,
        page: dimension.page ?? firstPage,
        view: dimension.view,
      }),
    );
  }

  // ---- notes ----------------------------------------------------------------
  for (const note of raw.notes) {
    const state = suggestAttributeState(note.text);
    observations.push(
      baseRow({
        attrGroup: "note",
        labelRaw: "Note",
        valueRaw: note.text,
        value: state.value,
        state: state.state,
        stateReason: state.reason,
        page: note.page ?? firstPage,
      }),
    );
  }

  // ---- pictures -------------------------------------------------------------
  const views = usableViews(
    raw.pictures.map((picture) => ({
      // `section` is new in version 4 and the card's view list has no word for
      // it; a section is a detail of the item for picture purposes.
      viewType: picture.kind === "section" ? "detail" : picture.kind,
      page: picture.page,
      bbox: picture.box,
    })),
    firstPage,
  );

  return {
    id: nextId(),
    version: 1,
    page: firstPage,
    pages,
    itemCodeRaw: codes[0] ?? null,
    itemCodes: codes,
    itemNameRaw: raw.name,
    confidence: raw.confidence,
    targets: null,
    observations: mergeNoteBlocks(observations),
    ...(views.length > 0 ? { viewRegions: views, imageProposal: pickItemView(views) } : {}),
    ...(configurations.length > 0 ? { configurations } : {}),
    ...(raw.whyOneItem ? { whyOneItem: raw.whyOneItem } : {}),
    uncertain: raw.uncertain.map((entry) => ({ about: entry.about, why: entry.why })),
    mockup: { is: raw.mockup.is, evidence: raw.mockup.evidence },
  };
}

/**
 * The model's version 4 answer as a staged document.
 *
 * A page the read listed in `nonItemPages` gets NO card: it is a statement the
 * read makes about the page, and it is kept on the document so the screen can
 * say which pages carried nothing. An item with no code is still an item — the
 * read said it is a thing to make — and its card asks which record it is.
 */
export function stageDrawingsV4(
  raw: DrawingsItemsOutput,
  fields: SpecFieldEntry[],
  filename: string | null = null,
  projectDefaultUnit: AttributeUnit | null = null,
): StagedDrawings {
  return {
    schemaVersion: ITEMS_SCHEMA_VERSION,
    kind: "shop_drawings",
    filename,
    documentNotes: raw.documentNotes,
    items: raw.items.map((item) => stageItemV4(item, fields, projectDefaultUnit)),
    nonItemPages: raw.nonItemPages.map((entry) => ({ page: entry.page, why: entry.why })),
  };
}
