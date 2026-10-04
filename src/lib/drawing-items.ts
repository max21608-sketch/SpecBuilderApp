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
// and the slot guess (the model said which figure is which). The unit vote IS
// applied, narrowed to the figures the read placed — see `unitVoteFor`.
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
  suggestUnit,
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
  type UnitSuggestion,
} from "@/lib/drawing-document";
import { parseCombinedDimensions, parseDimensionFigure, toMillimetres } from "@/lib/dimensions";
import { readCandidateLine } from "@/lib/slot-swap";
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
 * THE UNIT, IN CLAUDE.md'S ORDER, UNCHANGED FOR VERSION 4: printed on the page,
 * then the page's figures agreeing, then the item's OVERALL figures agreeing,
 * then the project's default, then nothing (`unit_missing` asks).
 *
 * The vote is `suggestUnit`, the same magnitude reading version 3 takes — the
 * "unit vote is deliberately kept" rule — and it is NARROWED THE WAY VERSION 3
 * NARROWS IT: on each page, to the overall figures the read placed in slots
 * where the page has any, else to every figure on the page; where a page's
 * figures disagree, to the item's overall figures across all its pages. A
 * shop drawing prints 5, 50 and 110 beside 840 and 790, and only the overall
 * figures carry the page's scale. A unit read this way is `figures` —
 * `unitSuggested`, amber on the card, one click corrects the card.
 *
 * (The first version 4 build left the vote out, as its brief said. That cost
 * the Panther shop-drawing set every one of its 21 overall figures — all read
 * right, none with a unit — and the brief was corrected the same day.)
 */
type UnitVote = (page: number | null) => UnitSuggestion;

function unitVoteFor(figures: { page: number | null; value: string | null; overall: boolean }[]): UnitVote {
  const overall = figures.filter((figure) => figure.overall);
  const itemOverall = suggestUnit(overall.map((figure) => figure.value));
  const anyFigures = suggestUnit(figures.map((figure) => figure.value));
  return (page) => {
    const onPage = figures.filter((figure) => figure.page === page);
    const overallOnPage = onPage.filter((figure) => figure.overall);
    const pageVote = suggestUnit((overallOnPage.length > 0 ? overallOnPage : onPage).map((figure) => figure.value));
    if (pageVote.status === "confident") return pageVote;
    if (itemOverall.status === "confident") return itemOverall;
    return overall.length === 0 ? anyFigures : pageVote;
  };
}

function unitFor(printed: AttributeUnit | null, projectDefault: AttributeUnit | null, pageGuess: UnitSuggestion) {
  const resolved = resolveDimensionUnit({ printed, pageGuess, projectDefault });
  return { ...resolved, suggested: resolved.source === "figures" || resolved.source === "project_default" };
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
  vote: UnitVote,
): DrawingObservation {
  const slot: DimensionSlot = OVERALL_SLOT[key];
  const staged = stagedFigure(figure.valueRaw, figure.unitRaw);
  const unit = unitFor(staged.printed, projectDefault, vote(figure.page ?? firstPage));
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
    unitSuggested: unit.suggested,
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
  const combined = raw.combinedLine?.trim() ? parseCombinedDimensions(raw.combinedLine) : null;
  const vote = unitVoteFor([
    ...[raw.overall, ...raw.configurations.map((configuration) => configuration.overall)].flatMap((overall) =>
      OVERALL_KEYS.flatMap((key) => {
        const figure = overall[key];
        return figure ? [{ page: figure.page ?? firstPage, value: stagedFigure(figure.valueRaw, figure.unitRaw).value, overall: true }] : [];
      }),
    ),
    ...(combined?.parts ?? []).map((part) => ({ page: firstPage, value: part.value, overall: true })),
    ...raw.otherDimensions.map((dimension) => ({
      page: dimension.page ?? firstPage,
      value: stagedFigure(dimension.valueRaw, dimension.unitRaw).value,
      overall: false,
    })),
  ]);
  const filled = new Map<DimensionSlot, number | null>();
  for (const key of OVERALL_KEYS) {
    const figure = raw.overall[key];
    if (!figure) continue;
    const overriddenBy = overrides.get(key) ?? [];
    const landsOn = overriddenBy.length > 0 ? allNames.filter((name) => !overriddenBy.includes(name)) : [];
    const row = overallRow(key, figure, firstPage, projectDefault, landsOn, vote);
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
      observations.push(overallRow(key, figure, configuration.pages[0] ?? firstPage, projectDefault, [configuration.name], vote));
    }
  }

  // ---- a size printed as one line ------------------------------------------
  // A PRINTED PREFIX (`W1520`) is the page saying which figure is the width,
  // and is taken exactly. A prefixed part fills a slot the overall size left
  // empty; one the overall size already holds at the same figure says nothing
  // new; one that DISAGREES is kept beside it as a note, so the disagreement is
  // on the card.
  //
  // THREE BARE FIGURES (`80 x 70 x 90 cm`) are W x D x H IN PRINTED ORDER —
  // the convention `parseCombinedDimensions` has always read, and the one
  // inference here the page does not state — so every slot it settles is
  // `slotSuggested`, amber, with the reason on the row, whether the read placed
  // the figures itself (it is asked to, saying so in `uncertain`) or left them
  // out. The read's own figure for a slot is never overwritten by the order.
  // The line itself is kept verbatim, folded, so it can be checked.
  if (raw.combinedLine?.trim() && combined) {
    const parsed = combined;
    const printedUnit = normaliseUnit(parsed.unitRaw);
    const line = raw.combinedLine.trim();
    const conventionReason = `Read as W x D x H in printed order from "${line}" — the page does not label them, so the order is the convention, not something printed. Check it against the drawing.`;
    const figureOf = (value: string | null | undefined) => parseDimensionFigure(value ?? null).figure;
    for (const part of parsed.parts) {
      if (!part.slot || !part.slotSuggested) continue;
      const existing = observations.find((row) => row.dimensionSlot === part.slot && !(row.configurations?.length));
      if (existing) {
        if (figureOf(existing.value ?? existing.valueRaw) === figureOf(part.value)) {
          existing.slotSuggested = true;
          existing.slotReason = conventionReason;
        }
        continue;
      }
      const unit = unitFor(printedUnit ?? printedImperialUnit(part.value), projectDefault, vote(firstPage));
      const hasFigure = figureOf(part.value) !== null;
      const row = baseRow({
        attrGroup: "dimension",
        dimensionSlot: part.slot,
        slotSuggested: true,
        slotReason: conventionReason,
        isOverall: true,
        labelRaw: DIMENSION_SLOT_LABELS[part.slot],
        valueRaw: part.value,
        value: part.value,
        unit: unit.unit,
        unitSuggested: unit.suggested,
        ...(unit.source ? { unitSource: unit.source } : {}),
        state: part.tbc || !hasFigure ? "tbc" : "confirmed",
        page: firstPage,
      });
      filled.set(part.slot, millimetres(row));
      observations.push(row);
    }
    for (const part of parsed.parts) {
      if (!part.slot || part.slotSuggested) continue;
      const unit = unitFor(printedUnit ?? printedImperialUnit(part.value), projectDefault, vote(firstPage));
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
        unitSuggested: unit.suggested,
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
  // is what `record_attributes` was made for. A labelled line is never merged
  // into a block — the label is the sheet's own field name and each line is its
  // own statement; an unlabelled one is a remark, and merges like one.
  for (const statement of raw.statements) {
    if (!statement.value?.trim() && !statement.label?.trim()) continue;
    const state = suggestAttributeState(statement.value);
    observations.push(
      baseRow({
        attrGroup: "note",
        // An UNLABELLED statement is a plain remark about the item, and reads
        // as one: labelled "Note", so a page's remarks merge into one block.
        labelRaw: statement.label?.trim() || "Note",
        valueRaw: statement.value,
        value: state.value,
        state: state.state,
        stateReason: state.reason,
        page: statement.page ?? firstPage,
        ...(statement.configurations.length > 0 ? { configurations: [...statement.configurations] } : {}),
        // A LABELLED line is the sheet's own field and value, and the card
        // folds these under "Everything else the sheet states" (brief F) so
        // they do not sit between the sizes and the finishes. An unlabelled
        // one is a remark: it merges and reads like any other note.
        ...(statement.label?.trim() ? { statement: true } : {}),
      }),
    );
  }

  // ---- every other dimension, folded -----------------------------------------
  let dimensionNo = 0;
  for (const dimension of raw.otherDimensions) {
    dimensionNo += 1;
    const staged = stagedFigure(dimension.valueRaw, dimension.unitRaw);
    const unit = unitFor(staged.printed, projectDefault, vote(dimension.page ?? firstPage));
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
        unitSuggested: unit.suggested,
        ...(unit.source ? { unitSource: unit.source } : {}),
        state: state.state,
        stateReason: state.reason,
        page: dimension.page ?? firstPage,
        view: dimension.view,
      }),
    );
  }

  // ---- every rival figure for a slot, as a row a person can point at --------
  // Brief F. The read keeps the figures it did NOT choose for a slot beside
  // the one it did (`candidates`), and the card offers "Use this instead" on
  // each — which swaps a MEASURED ROW into the slot, so the candidate must be
  // one. Where the read also listed it among the other dimensions (same page,
  // same view, same figure) that row is the candidate; otherwise it is added
  // here, folded with the rest, carrying the slot row's configurations. The
  // candidate records which row it is, so the button never has to search.
  const figureIn = (value: string | null | undefined) => parseDimensionFigure(value ?? null).figure;
  for (const holder of [...observations]) {
    if (holder.attrGroup !== "dimension" || !holder.dimensionSlot || !holder.candidates?.length) continue;
    const slotLabel = DIMENSION_SLOT_LABELS[holder.dimensionSlot].toLowerCase();
    holder.candidates = holder.candidates.map((candidate) => {
      // The flat schema writes a candidate as ONE line, "740 (SIDE, page 2)".
      const read = readCandidateLine(candidate);
      const staged = stagedFigure(read.figure, candidate.unitRaw);
      const page = read.page ?? holder.page ?? firstPage;
      const view = read.view;
      const existing = observations.find(
        (row) =>
          row.attrGroup === "note" &&
          row.isOverall === false &&
          row.page === page &&
          (row.view ?? null) === view &&
          figureIn(row.value ?? row.valueRaw) !== null &&
          figureIn(row.value ?? row.valueRaw) === figureIn(staged.value),
      );
      if (existing) return { ...candidate, observationId: existing.id };
      const unit = unitFor(staged.printed, projectDefault, vote(page));
      const state = suggestAttributeState(staged.value);
      const row = baseRow({
        attrGroup: "note",
        dimensionSlot: null,
        slotSuggested: false,
        isOverall: false,
        labelRaw: view ?? `Another reading of the ${slotLabel}`,
        valueRaw: staged.value,
        value: state.value,
        unit: unit.unit,
        unitSuggested: unit.suggested,
        ...(unit.source ? { unitSource: unit.source } : {}),
        state: state.state,
        stateReason: state.reason,
        page,
        view,
        ...(holder.configurations?.length ? { configurations: [...holder.configurations] } : {}),
      });
      observations.push(row);
      return { ...candidate, observationId: row.id };
    });
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
