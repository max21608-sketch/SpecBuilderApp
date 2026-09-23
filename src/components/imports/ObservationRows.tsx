"use client";

// The pieces a drawings card is built from.
//
// ============================================================================
// WHY THESE ARE NOT INSIDE THE CARD ANY MORE
//
// There are now two cards: one page on its own (a code drawn once, a codeless
// sheet) and one per CODE, holding every configuration of an item that is drawn
// on several pages. They ask for the same row, the same replace
// acknowledgement, the same blocker panel and the same run checkboxes -- and a
// second copy of any of them would be two sets of rules about what a control
// means. That is the reason `drawingItemBlockers` is computed in one place and
// called by both the screen and the confirm route; this is the same rule one
// level up, in the markup.
//
// EVERY WRITE GOES THROUGH A CALLBACK, and the callback is the caller's. A
// single-page card saves the row it is looking at. A configuration card's
// shared geometry row saves the MATCHING row on every page of the item, which
// is what makes "the dimensions, once" true rather than merely displayed --
// each configuration still carries its own attribute, from its own page, with
// its own source page. Nothing here knows which of those it is doing.
// ============================================================================
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_UNITS,
  DIMENSION_SLOTS,
  DIMENSION_SLOT_LABELS,
  type AttributeGroup,
  type AttributeState,
  type DimensionSlot,
  type ItemLevel,
} from "@/lib/spec-vocab";
import { asksForState, foldableRow, isMeasuredRow, unitSourceOf, type DrawingObservation } from "@/lib/drawing-document";
import {
  isOfferable,
  normalisePaletteValue,
  offPaletteNote,
  paletteForField,
  unheldPaletteNote,
  type Palette,
} from "@/lib/palettes";
import SwatchPicker from "@/components/imports/SwatchPicker";
import SuggestButton from "@/components/ui/SuggestButton";
import Chip from "@/components/ui/Chip";
import { isFinishGroup } from "@/lib/finishes";
import type { FinishFilingView } from "@/lib/drawing-resolution";
import Button from "@/components/ui/Button";
import { Th } from "@/components/ui/Table";
import type { CroppedImage } from "@/lib/pdf-crop";

/**
 * One record a card resolves to, as the screen needs it.
 *
 * The level fields are OPTIONAL because they are optional on `RecordEntry`:
 * only `loadExtractionRegisters` reads them, and a payload built without them
 * means "this loader did not look", which is not the same statement as "no
 * level". The level CONTROL reads them; nothing else does.
 */
export type ResolvedRecord = {
  id: string;
  label: string;
  itemDescription: string;
  level?: ItemLevel | null;
  levelSuggested?: ItemLevel | null;
  levelSuggestedReason?: string | null;
};

export type RunResolution =
  | { runId: string; runName: string; status: "matched"; record: ResolvedRecord }
  | { runId: string; runName: string; status: "ambiguous"; candidates: ResolvedRecord[] };

export type Occupant = {
  attributeId: string;
  attributeVersion: number;
  label: string;
  value: string | null;
  unit: string | null;
  sourceFilename: string | null;
  sourcePage: number | null;
};

/**
 * One BWS field, as the drawings screens thread the register.
 *
 * `palette` is the closed list Matthew's gate overlay points this field at,
 * attached by `withPalettes` at read time. OPTIONAL, and absent means "this
 * caller had no register to hand" rather than "this field has no list" -- the
 * row then renders exactly as it did before palettes reached this screen,
 * which is `upgradeCalloutGuesses`' rule about an empty `fields` list in a
 * second place. A caller that degrades honestly cannot disagree with the
 * confirm; one that invented an empty list would.
 */
export type SpecField = {
  id: string;
  json_id: number;
  name: string;
  field_category: string;
  palette?: Palette | null;
};

/** The project's records, for the card that matched none of them. */
export type RecordChoice = { id: string; label: string; itemDescription: string; runName: string };

export type RowBlocker = {
  code: string;
  message: string;
  observationId?: string;
  runId?: string;
  recordId?: string;
  /** A configuration name, on `configuration_name` and `configuration_new`. */
  label?: string;
};
export type RowWarning = { code: string; message: string; observationId: string };

/** What a control on a row does. The caller decides how far it reaches. */
export type RowCallbacks = {
  onChange: (observation: DrawingObservation, changes: Record<string, unknown>) => void;
  onIgnore: (observation: DrawingObservation) => void;
  /** The PAGE is the one the crop was taken from, which may not be the row's own. */
  onSwatch: (observationId: string, image: CroppedImage | null, page: number | null) => void;
};

/** Split a card's pending rows into the ones that matter, the rest, and the fold. */
export function orderRows(pending: DrawingObservation[]): {
  ordered: DrawingObservation[];
  otherIds: Set<string>;
  otherDimensionRows: DrawingObservation[];
  firstOtherId: string | undefined;
} {
  // IN SLOT ORDER, not in the order the model happened to report them. The
  // composed cell above the table is written W x D x H x SH by
  // `composeDimensionCell`, and a table under it in a different order makes a
  // transposition harder to see rather than easier -- which is the one thing
  // that panel is for.
  const keyRows = [...pending.filter((o) => o.dimensionSlot)].sort(
    (a, b) =>
      DIMENSION_SLOTS.indexOf(a.dimensionSlot as DimensionSlot) -
      DIMENSION_SLOTS.indexOf(b.dimensionSlot as DimensionSlot),
  );
  const foldable = pending.filter(foldableRow);
  // NOTHING TO FOLD BEHIND. The fold puts the ones that matter first and the
  // rest out of the way; with none that matter there is no "rest", and folding
  // every figure leaves a card showing a toggle and nothing else.
  const otherDimensionRows = keyRows.length > 0 ? foldable : [];
  const otherIds = new Set(otherDimensionRows.map((o) => o.id));
  // GROUPED, not in staged order. A card used to interleave fabrics, hardware
  // and paragraphs of remarks in whatever order the model reported them, which
  // is the other half of "nothing's grouped, it's all over the place". Within a
  // group the staged order is kept, because that is the order of the page.
  const rank = (o: DrawingObservation) => GROUP_ORDER.indexOf(o.attrGroup);
  const restRows = pending
    .filter((o) => !o.dimensionSlot && !otherIds.has(o.id))
    .map((o, index) => ({ o, index }))
    .sort((a, b) => rank(a.o) - rank(b.o) || a.index - b.index)
    .map((entry) => entry.o);
  return {
    ordered: [...keyRows, ...restRows, ...otherDimensionRows],
    otherIds,
    otherDimensionRows,
    firstOtherId: otherDimensionRows[0]?.id,
  };
}

/**
 * The order the groups read in: what the item is made of, then what was said
 * about it. Notes last because they are the longest and the least decisive --
 * a merged block of general conditions runs to eighteen hundred characters.
 */
const GROUP_ORDER: AttributeGroup[] = ["dimension", "material", "finish", "hardware", "other", "note"];

/**
 * How many columns a spanning panel covers.
 *
 * ONE CONSTANT, because the number was written out four times — the two toggle
 * rows, the replace acknowledgement and the blocker panel — and a column added
 * or removed has to reach every one of them. A `colSpan` one short leaves the
 * panel ending before the last column; one over widens the row past the table.
 * Both are silent.
 */
export const OBSERVATION_COLUMNS = 6;

/**
 * The table head every observation table shares.
 *
 * `Th` rather than a hand-rolled `<th>`, so this table's header reads the same
 * as every other table in the app. The CELLS below stay as they are: they hold
 * a select in almost every column and `Td`'s padding is built for text.
 *
 * ============================================================================
 * THE UNIT IS NOT A COLUMN. IT IS THE SECOND HALF OF THE VALUE.
 *
 * It was one, and the card was CLIPPED: `PageBody` is capped at 1400px and the
 * picture sidebar takes a fixed 300 of it, so the table gets 1010px at 1920
 * AND at 1440 — the viewport makes no difference — while the seven columns
 * wanted up to 1091. What went past the edge was the unheaded ACTION column,
 * so nothing in the header row went missing to say so, and *Ignore* was
 * reachable only by scrolling the table sideways. Max, 2026-09-21: "I don't
 * want to have to scroll to view all of the fields on the table."
 *
 * A column had to go, and Unit is the one that costs least. It was 99px wide
 * and held an em-dash on every row that is not a measurement — on a sheet of
 * fifteen REMARKS that is 99px of nothing. A figure and its unit are ONE
 * statement, which is how `composeDimensionCell` writes them (`840` + `mm`),
 * and the unit's provenance line — printed on the page, guessed from the
 * figures, the project default — is about the figure, so it belongs beside it.
 * Every control survives with the same behaviour; only the cell it sits in
 * changed.
 *
 * Do not solve this by making the wrapper `overflow-hidden` (it becomes the
 * sticky scroll container and the header then covers a row) or by giving a
 * spanning panel an extra `<td>` beside the data cells (the row becomes
 * columns × 3 slots wide and the browser squeezes the acknowledgement into a
 * ribbon). Both are recorded traps this card has already paid for.
 * ============================================================================
 */
export function ObservationTableHead() {
  return (
    <thead>
      <tr>
        <Th className="px-4">Group</Th>
        <Th className="px-2">Label</Th>
        <Th className="px-2">Value</Th>
        <Th className="px-2">Dimension / BWS field</Th>
        <Th className="px-2">State</Th>
        <Th className="px-4" />
      </tr>
    </thead>
  );
}

export function OtherDimensionsToggle({
  count,
  shown,
  onToggle,
  label,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <tr className="border-t border-neutral-200 bg-neutral-50">
      <td colSpan={OBSERVATION_COLUMNS} className="px-4 py-2">
        <Button size="xs" variant="quiet" onClick={onToggle}>
          {shown ? `Hide the other ${count} dimensions` : `${label ?? "Other dimensions"} (${count}) — show`}
        </Button>
        <span className="ml-2 text-xs text-neutral-500">
          Everything else this page measures. Kept on the item with its label, figure and unit; not part of the BWS
          dimension cell.
        </span>
      </td>
    </tr>
  );
}

/**
 * The sentinel for "not taken from the list". Same literal as
 * `AnswerValue`'s, so the two controls cannot mean different things by it.
 */
const FREE_TEXT = "__other__";

/**
 * THE LIST A BWS FIELD OFFERS, BESIDE THE WORDS THE PAGE PRINTED.
 *
 * ============================================================================
 * Matthew, 2026-09-18 (1:26:43): "it'd be really good if it would have stud
 * and then it would have a go at matching with what was specified on the
 * drawing. But if it was wrong or couldn't find it, that you'd be able to
 * select one from the drop-down" -- and free text stays: "of course, just do
 * it as a free text."
 *
 * ---- THE MATCH IS EXACT AND IT WILL ALMOST NEVER FIRE, WHICH IS CORRECT ----
 *
 * MEASURED on the sandbox before this was built: `npm run palette:gap` reads
 * 98 callouts on a palette-backed BWS field over 47 staged drawings runs -- 81
 * of them stating something, 17 stating nothing -- and ZERO match an option.
 * That is not a defect to tune away. The BWS palettes are BW's own
 * manufacturing range (`BW Oak Natural - Open grain 10%`); the drawings state
 * the designer's intent (`Ceruse finish oak`, `Antique brass, machined`). They
 * are two vocabularies at two stages of the job, and mapping one onto the
 * other is a specification decision a person takes.
 *
 * So there is NO substring step, no token step, no distance step and no model
 * call here. `normalisePaletteValue` is the whole matcher and it returns null
 * rather than the nearest option, for the reason house/conventions.md §5
 * gives: a fuzzy step that put `Antique brass, machined` onto `BW Antiqued
 * Brass` would write a BW finish code the designer never specified into a
 * field that ships to BWS, and nothing downstream would question it. A visible
 * gap beats a plausible-looking wrong answer. `palette:gap` prints what a
 * looser rule WOULD have written, so widening it stays a decision taken on
 * evidence rather than a default. On this corpus it would buy nothing at all:
 * not one unmatched callout is a substring of an option or contains one.
 *
 * ---- FREE TEXT IS THE DEFAULT AND IS ALWAYS REACHABLE ----------------------
 *
 * The value box above this is untouched: the page's own words are what the row
 * starts with and what it keeps unless a person changes it. This control only
 * ever writes `value`, through the autosave that already exists -- `valueRaw`
 * still holds what the drawing said and the row already prints it underneath,
 * which is what keeps the provenance honest and why this needs no column and
 * no migration.
 *
 * `Other...` is the state the row is in whenever the value is not an option,
 * so it cannot destroy typed text: a select already showing it fires no change
 * event. Choosing it is only reachable FROM an option, where it means "undo
 * that pick" and puts the drawing's own words back.
 *
 * A palette with no options offers no dropdown at all -- `unheldPaletteNote`
 * says so in a sentence, because an empty select reads as broken and a
 * reviewer who thinks a control is broken types around it. Nothing is unheld
 * since the 2026-09-22 capture; the branch is for the next gate row pointing
 * at a list nobody has read yet.
 * ============================================================================
 */
export function PaletteChoice({
  palette,
  value,
  valueRaw,
  disabled,
  onPick,
}: {
  palette: Palette;
  /** What the row currently holds -- the reviewer's draft where there is one. */
  value: string | null;
  /** What the page printed, restored by "Other...". */
  valueRaw: string | null;
  disabled: boolean;
  onPick: (next: string | null) => void;
}) {
  if (!isOfferable(palette)) {
    return <p className="mt-1 text-xs text-slate-500">{unheldPaletteNote(palette)}</p>;
  }

  const onPalette = normalisePaletteValue(palette, value);
  return (
    <div className="mt-1">
      <p className="text-[11px] text-neutral-500">{palette.name}</p>
      <select
        value={onPalette ?? FREE_TEXT}
        disabled={disabled}
        onChange={(event) => {
          const chosen = event.target.value;
          onPick(chosen === FREE_TEXT ? valueRaw : chosen);
        }}
        className="mt-0.5 w-full border border-neutral-300 rounded px-1 py-0.5 text-xs disabled:opacity-50"
      >
        <option value={FREE_TEXT}>Other&hellip; — keep the drawing&rsquo;s own words</option>
        {palette.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {/* NEUTRAL, NOT AMBER, AND NEVER A BLOCKER. On the record screen the same
          sentence is amber, because a settled answer sitting outside its list
          is a question. At intake it is the normal case -- every real callout
          measured -- and amber on all of them teaches a reviewer to ignore
          amber, which is the argument that keeps `unanswerable` slate.
          Nothing to be off is not a mismatch, so a row with no value says
          nothing at all. */}
      {onPalette === null && (value ?? "").trim() !== "" && (
        <p className="mt-0.5 text-xs text-neutral-500">{offPaletteNote(palette)}</p>
      )}
    </div>
  );
}

/**
 * FILING A FINISH THE CLIENT GAVE NO CODE FOR — item 4a.1, Max 2026-09-22.
 *
 * ============================================================================
 * The S-203 sheet states `Fabric reference: Aissa Dione, ref. Losange raphia
 * beige et écru` and prints no code. `project_finishes` is keyed on the
 * client's code, so the fabric landed on the record and the project's finishes
 * library stayed empty — nothing to correct once, nothing to hang a swatch on.
 * Max: *"reviewer supplies a code at confirm; if [one does not] exist create an
 * internal one and then use this again if it matches in another line item."*
 *
 * ---- NOTHING HERE FILES ANYTHING ON ITS OWN, WITH ONE EXCEPTION ----------
 *
 * Creating a library row is a REGISTER WRITE, so it waits for a press: the
 * client's own code typed in the box, or *No code — file it internally*. The
 * exception is Max's approval 3 — wording that folds EXACTLY onto a finish
 * this app already minted links by itself and says which one, with a way out
 * beside it. Linking to a row that exists is not a register write, and asking
 * the same question about the same fabric on every item is the ceremony the
 * whole entry is about.
 *
 * A NEAR MISS IS OFFERED AND FILES NOTHING. `readUncodedFinish` is the one
 * reading, called here and by the confirm route, so what this chip promises is
 * what the confirm does.
 *
 * WHAT THE CODE IS is not shown before the confirm, deliberately. It is minted
 * under the project row lock at that moment, and a number printed here is one
 * another reviewer's confirm may take first.
 * ============================================================================
 */
function FinishFilingControl({
  observation,
  filing,
  busy,
  onChange,
  onSwatch,
}: {
  observation: DrawingObservation;
  filing: FinishFilingView;
  busy: boolean;
  onChange: RowCallbacks["onChange"];
  /**
   * WITHDRAWING THE FILING WITHDRAWS THE CROP WITH IT (4a.2).
   *
   * The crops live in a ref on the review screen, keyed by observation, and are
   * uploaded for every row being confirmed. Un-filing a row takes its finish
   * away, so a crop left behind would leave the screen with no swatch control,
   * no preview and no way back — and the confirm would then refuse the whole
   * card with `swatch_has_no_finish` over a picture nobody could see. That is
   * the refusal working, and it is a bad way to find out.
   *
   * So the crop goes at the same press, which is a person's own act on the same
   * row and the only place it is not silent. Nothing is discarded behind
   * anybody's back: the crop was never uploaded, because nothing is uploaded
   * until the card is confirmed.
   */
  onSwatch: RowCallbacks["onSwatch"];
}) {
  const [code, setCode] = useState("");

  if (filing.outcome === "link") {
    return (
      <div className="mt-1 text-xs">
        <Chip mono tone="info">
          {filing.code} · ours
        </Chip>
        <span className="ml-1.5 text-neutral-500">{filing.why}.</span>{" "}
        <Button
          size="xs"
          variant="quiet"
          disabled={busy}
          onClick={() => {
            onSwatch(observation.id, null, null);
            onChange(observation, { finishFiling: { mode: "apart" } });
          }}
        >
          Not the same finish?
        </Button>
      </div>
    );
  }

  if (filing.outcome === "mint") {
    return (
      <div className="mt-1 text-xs">
        <Chip tone="info">ours — a code on confirm</Chip>
        <span className="ml-1.5 text-neutral-500">
          The client gave no code. Confirming files this in the finishes library under one of ours.
        </span>{" "}
        <Button
          size="xs"
          variant="quiet"
          disabled={busy}
          onClick={() => {
            onSwatch(observation.id, null, null);
            onChange(observation, { finishFiling: null });
          }}
        >
          Undo
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-1 text-xs">
      <p className="text-neutral-500">
        Not in the finishes library — the page prints no code.
        {filing.why ? ` ${filing.why}.` : ""}
      </p>
      {filing.suggestion && (
        <div className="mt-1">
          <SuggestButton
            value={filing.suggestion.code}
            evidence={`${filing.suggestion.why}. Nothing filed.`}
            busy={busy}
            onAccept={() =>
              onChange(observation, {
                finishFiling: { mode: "link", codeNorm: filing.suggestion!.codeNorm },
              })
            }
          />
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <input
          value={code}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
          placeholder="client's code"
          aria-label="The client's own code for this finish"
          className="w-36 border border-neutral-300 rounded px-2 py-1 text-xs"
        />
        <Button
          size="xs"
          disabled={busy || !code.trim()}
          onClick={() => onChange(observation, { materialCode: code.trim() })}
        >
          File
        </Button>
        {/* SECOND, and quiet: a client code is the better answer wherever one
            exists, and this is what to press when there is not one. */}
        <Button
          size="xs"
          variant="quiet"
          disabled={busy}
          onClick={() => onChange(observation, { finishFiling: { mode: "internal" } })}
        >
          No code — file it internally
        </Button>
      </div>
    </div>
  );
}

/**
 * WHERE A SWATCH CROPPED ON THIS ROW WOULD LAND (4a.2).
 *
 * ============================================================================
 * One reading, because the confirm has its own and the two must agree. The
 * confirm builds `finishIdByObservation` from `resolveFinishCode` where the row
 * carries a client code, and from `readUncodedFinish` where it does not; a
 * swatch whose row lands `null` there is REFUSED by name rather than dropped.
 * That refusal is right — silently discarding a picture somebody cropped is how
 * they come to believe it is stored — and it is not a substitute for the screen
 * knowing. This says the same thing one step earlier, so the control is offered
 * exactly where a crop has somewhere to go.
 *
 * THREE ANSWERS, NOT TWO. A client code names the finish now. A row filed under
 * one of ours may already have its code (an exact wording match onto a finish
 * this app minted) or may not (the mint happens at confirm, under the project
 * row lock — a number printed before that is one another reviewer may take).
 * Both of the last two resolve to exactly one library row, and the difference
 * between them is only what the panel can print, which is why the code is
 * nullable rather than the control being withheld.
 *
 * A row the reviewer has KEPT APART, or has not answered at all, reads `none`:
 * `readUncodedFinish` files nothing for either, so there is nothing to attach.
 * ============================================================================
 */
export function swatchTargetOf(
  observation: DrawingObservation,
  filing: FinishFilingView | undefined,
): { kind: "none" } | { kind: "finish"; code: string | null } {
  // The client's own code is the key wherever there is one, and stays it.
  if (observation.materialCodeRaw?.trim()) return { kind: "finish", code: observation.materialCodeRaw };
  if (!filing) return { kind: "none" };
  // `link` names a row that exists; `mint` names one the confirm creates in the
  // same transaction, before the swatch loop reads the map. Both are a finish.
  if (filing.outcome === "link") return { kind: "finish", code: filing.code };
  if (filing.outcome === "mint") return { kind: "finish", code: null };
  return { kind: "none" };
}

/**
 * One observation: the seven controls a reviewer rules on it with.
 *
 * `blocked` and `guessed` are passed in rather than derived, because a shared
 * geometry row is blocked when ANY of its configurations is, and guessed
 * whenever the row it leads is.
 */
export function ObservationRow({
  observation,
  page,
  itemPages,
  importId,
  specFields,
  drafts,
  setDrafts,
  busy,
  blocked,
  guessWhy,
  finishFiling,
  callbacks,
}: {
  observation: DrawingObservation;
  page: number | null;
  /**
   * Every page of the ITEM this row belongs to, so a swatch printed on the
   * other page of a two-page item can be cropped without leaving the card.
   * Optional: a caller that knows only this row's page still works, and the
   * picker then offers no selector.
   */
  itemPages?: readonly number[];
  importId: string;
  specFields: SpecField[];
  drafts: Record<string, Partial<DrawingObservation>>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Partial<DrawingObservation>>>>;
  busy: boolean;
  blocked: boolean;
  guessWhy: string | undefined;
  /**
   * How this row would file, when it is a FINISH the client gave no code for.
   * Absent for every other row, and for a row that already carries a code —
   * where the code is the key and stays the key.
   */
  finishFiling?: FinishFilingView;
  callbacks: RowCallbacks;
}) {
  const draft = drafts[observation.id] ?? {};
  const value = draft.value !== undefined ? draft.value : observation.value;
  // A GUESSED SLOT TURNS THE WHOLE LINE YELLOW. An amber border on the slot
  // select alone is invisible in a table of twenty-four rows, and a reviewer
  // scanning for what still needs checking is scanning lines, not dropdowns.
  // Two kinds of guess turn a line yellow: which of the five slots a figure
  // fills, and what a material callout IS. The second is the last-resort
  // reading of a caption naming the item itself (`SOFA / Tessarae YC04158`) —
  // right often enough to be worth filling in, never certain enough to slip
  // past unread.
  const guessed = Boolean((observation.slotSuggested && observation.dimensionSlot) || observation.groupSuggested);
  // What this row can be given, rather than what the vocabulary holds.
  // `dimension` is never offered here: it is unwritable without a slot, and the
  // slot column sends both together.
  // The list this row's BWS field offers, or null -- which is most rows: a
  // dimension and a note carry no field at all, and COM 1/2/3 carry no
  // palette, correctly, because COM is free text in BWS.
  const palette = paletteForField(specFields, observation.specFieldId);
  const groupOptions = ATTRIBUTE_GROUPS.filter((group) => {
    if (group === observation.attrGroup) return true;
    if (group === "dimension") return false;
    return observation.unit === null || group === "note";
  });

  return (
    // YELLOW AND AMBER MEAN DIFFERENT THINGS AND A ROW CAN BE BOTH. Yellow is
    // "this is a guess, confirm it"; amber is "this cannot commit as it
    // stands". Amber used to REPLACE the yellow, so a guessed row lost the only
    // marker saying it was guessed at exactly the moment it most needed
    // checking. The background keeps saying "guessed", the left edge says
    // "blocked".
    <tr
      className={`border-t border-neutral-100${guessed ? " bg-yellow-100/70" : blocked ? " bg-amber-50/40" : ""}${
        blocked ? " border-l-4 border-l-amber-400" : ""
      }`}
    >
      <td className="px-4 py-2 align-top">
        {/* ONLY OFFER A GROUP THIS ROW CAN ACTUALLY BE GIVEN. This listed all
            six, and on a measured row every one of them was refused:
            `Dimensions` by `dimension_needs_slot` (0011's biconditional) and
            every other by `unit_not_a_measurement`. The 400 landed in the
            banner at the top of the screen, nowhere near the row, so the
            dropdown appeared to do nothing — twenty-four times on one card. */}
        <select
          value={observation.attrGroup}
          disabled={groupOptions.length < 2}
          onChange={(event) => callbacks.onChange(observation, { attrGroup: event.target.value as AttributeGroup })}
          className="border border-neutral-300 rounded px-1 py-0.5 text-xs disabled:bg-neutral-50 disabled:text-neutral-500"
          title={
            observation.unit !== null
              ? "This row carries a unit, so it is a dimension or a note. Choose the dimension in the next column but one, or clear the unit to file it as a finish."
              : undefined
          }
        >
          {groupOptions.map((group) => (
            <option key={group} value={group}>
              {ATTRIBUTE_GROUP_LABELS[group]}
            </option>
          ))}
        </select>
        {observation.groupSuggested ? (
          <span className="block mt-0.5 text-[11px] text-amber-700">
            {observation.groupReason ?? "guessed from the caption"}
          </span>
        ) : null}
      </td>
      <td className="px-2 py-2 align-top text-neutral-700">{observation.labelRaw ?? "—"}</td>
      <td className="px-2 py-2 align-top">
        {/* A sheet's note block is many lines in one row, so it gets a box it
            fits in. Every line stays editable text: the merge joined rows, it
            did not rewrite words. */}
        {(value ?? "").includes("\n") ? (
          <textarea
            value={value ?? ""}
            rows={Math.min(12, (value ?? "").split("\n").length + 1)}
            onChange={(event) =>
              setDrafts((current) => ({ ...current, [observation.id]: { ...draft, value: event.target.value } }))
            }
            onBlur={(event) => {
              if (event.target.value === (observation.value ?? "")) return;
              callbacks.onChange(observation, { value: event.target.value || null });
            }}
            className="w-full min-w-[18rem] border border-neutral-300 rounded px-2 py-1 text-sm"
          />
        ) : (
          <input
            value={value ?? ""}
            onChange={(event) =>
              setDrafts((current) => ({ ...current, [observation.id]: { ...draft, value: event.target.value } }))
            }
            onBlur={(event) => {
              if (event.target.value === (observation.value ?? "")) return;
              callbacks.onChange(observation, { value: event.target.value || null });
            }}
            className="w-full border border-neutral-300 rounded px-2 py-1 text-sm"
          />
        )}
        {/* THE UNIT, BESIDE THE FIGURE IT BELONGS TO. See the head above for
            why it is no longer a column of its own.

            A TEXT NOTE IS NEVER ASKED FOR ONE. "REMARKS: SUBMIT SHOP DRAWINGS
            FOR REVIEW" is not a measurement, and an empty select beside
            fifteen of them reads as fifteen unanswered questions where there
            are none — nothing blocks a unitless note.
            A MEASURED note is offered one whether or not it already carries
            one: a wrong mm on `ARM HEIGHT 520` must be correctable without
            promoting the row to a slot, and a figure staged with no unit at
            all must be answerable at all. Not amber — only a dimension is
            being asked. */}
        {(observation.attrGroup === "dimension" || isMeasuredRow(observation)) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <select
              value={observation.unit ?? ""}
              onChange={(event) => callbacks.onChange(observation, { unit: event.target.value || null })}
              aria-label="Unit"
              className={`border rounded px-1 py-0.5 text-xs ${
                observation.unit === null && observation.attrGroup === "dimension"
                  ? "border-amber-400 bg-amber-50"
                  : "border-neutral-300"
              }`}
            >
              <option value="">Choose…</option>
              {ATTRIBUTE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            {/* A printed unit is NOT a guess and must not be labelled as one —
                that is the whole reason provenance is tracked. */}
            {unitSourceOf(observation) === "printed" && <span className="text-xs text-neutral-500">printed on the page</span>}
            {unitSourceOf(observation) === "figures" && <span className="text-xs text-amber-700">guessed from the figures</span>}
            {unitSourceOf(observation) === "project_default" && (
              <span className="text-xs text-amber-700">the project default</span>
            )}
          </div>
        )}
        {/* Not for a block: its raw form is the same lines with the heading
            repeated down every one of them. */}
        {observation.valueRaw !== null && observation.valueRaw !== observation.value && !(value ?? "").includes("\n") && (
          <p className="mt-0.5 text-xs text-neutral-400">drawing said: {observation.valueRaw}</p>
        )}
        {palette && (
          <PaletteChoice
            palette={palette}
            value={value}
            valueRaw={observation.valueRaw}
            disabled={busy}
            onPick={(next) => {
              // THE DRAFT GOES FIRST. The value box is controlled by
              // `drafts[id] ?? observation.value`, so a half-typed draft left
              // behind would go on showing the old text over the value that
              // was just picked -- the reload would land and the box would
              // still disagree with it.
              setDrafts((current) => {
                const rest = { ...current };
                delete rest[observation.id];
                return rest;
              });
              callbacks.onChange(observation, { value: next });
            }}
          />
        )}
        {observation.materialCodeRaw && (
          <p className="mt-0.5 text-xs text-neutral-500">code {observation.materialCodeRaw}</p>
        )}
        {/* A FINISH WITH NO CODE HAS NOWHERE TO BE FILED, and that is what the
            library is addressed by. The control sits where the code prints,
            because it is the same question answered the other way round. */}
        {!observation.materialCodeRaw && isFinishGroup(observation.attrGroup) && finishFiling && (
          <FinishFilingControl
            observation={observation}
            filing={finishFiling}
            busy={busy}
            onChange={callbacks.onChange}
            onSwatch={callbacks.onSwatch}
          />
        )}
        {/* ---- THE SWATCH CHIP, CROPPED OFF THE PAGE (4a.2) ----------------
            THE GATE IS "THIS ROW RESOLVES TO A FINISH", NOT "IT CARRIES A
            CLIENT CODE". It was the second until 4a.1 gave an uncoded finish
            somewhere to live, and the S-203 sheet prints its woven chip
            directly under a fabric reference that states a supplier and a
            product name and no code at all — so the one page in the pilot pack
            that most obviously prints a swatch was the one page with no control
            to take it. Max, 2026-09-22: "in the intake, I still don't think
            we're taking in a crop of the fabric or metal spec as an image."

            `swatchTargetOf` is the reading, and it is deliberately the SAME
            question the confirm asks — `finishIdByObservation` in
            confirm-drawings.ts, built from `resolveFinishCode` for a coded row
            and `readUncodedFinish` for one with no code. A control offered
            where that map lands `null` is a crop the confirm REFUSES, which is
            correct (refused, never dropped) and still a promise the screen had
            no business making.

            Fabric, timber and metal alike: `classifyCallout` has already
            decided which a row is and `isFinishGroup` covers both groups it
            files them under, so nothing new here decides a kind.

            NOT IN SCOPE, and true of every branch: nobody asks the model where
            the chip is. That is a tool-schema change, which re-reads and re-pays
            for every document already read, and it rides with the
            finishes-schedule re-read. A swatch is a reviewer's crop. */}
        {(() => {
          const target = swatchTargetOf(observation, finishFiling);
          if (target.kind === "none") {
            // Said on the row rather than left blank: "there is no control
            // here" and "there is nothing to attach a picture to yet" look
            // identical, and only one of them tells somebody what to do next.
            //
            // ONLY WHERE THE FILING CONTROL IS ACTUALLY ABOVE IT — the same
            // condition, not a looser one. A finish row stating no value at all
            // (`PIPING / TBC`) is absent from `finishFilings`, so there is
            // nothing to file and nothing to press, and "file this finish
            // above" would point at a control that is not there.
            return finishFiling ? (
              <p className="mt-1 text-[11px] text-neutral-500">
                No swatch yet — file this finish above and the crop control appears.
              </p>
            ) : null;
          }
          return (
            <SwatchPicker
              importId={importId}
              page={page}
              pages={itemPages}
              code={target.code}
              disabled={busy}
              onCropped={(image, croppedPage) => callbacks.onSwatch(observation.id, image, croppedPage)}
            />
          );
        })()}
      </td>
      <td className="px-2 py-2 align-top">
        {observation.attrGroup === "dimension" || observation.attrGroup === "note" ? (
          // The question the reviewer is actually being asked. A shop drawing
          // labels nothing, so its figures stage as notes and this is where one
          // becomes the width — and where a figure the page DID label, but as
          // something outside the five (ARM HEIGHT), stays a note without
          // losing anything.
          //
          // Both fields go in ONE patch: 0011 refuses a dimension with no slot
          // and a note with one, so sending them apart would leave the staged
          // row in a shape the confirm cannot write.
          <div className="flex flex-col gap-0.5">
            <select
              value={observation.dimensionSlot ?? ""}
              onChange={(event) => {
                const slot = event.target.value;
                callbacks.onChange(observation, {
                  attrGroup: slot ? "dimension" : "note",
                  dimensionSlot: slot ? (slot as DimensionSlot) : null,
                });
              }}
              className={`border rounded px-1 py-0.5 text-xs ${
                observation.slotSuggested ? "border-amber-400 bg-amber-50" : "border-neutral-300"
              }`}
            >
              <option value="">Keep as a note</option>
              {DIMENSION_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {DIMENSION_SLOT_LABELS[slot]}
                </option>
              ))}
            </select>
            {observation.slotSuggested && observation.dimensionSlot ? (
              <span className="text-[11px] text-amber-700">
                {/* WHAT THE PAGE SHOWS, in preference to what this app worked
                    out. `slotReason` is the model's own evidence -- "labelled
                    WIDTH on the specification table", "spans the whole chair on
                    the front elevation" -- and it is the only one of these a
                    reviewer can actually check against the drawing.

                    `guessWhy` is the version 1 fallback and says what the CODE
                    did: "the second largest -- no view says so". Kept so a run
                    staged before 2026-09-18 still explains itself, and it goes
                    with the guessing pipeline. */}
                {observation.slotReason ?? guessWhy ?? "order assumed W × D × H"}
              </span>
            ) : null}
          </div>
        ) : (
          <select
            value={observation.specFieldId ?? ""}
            onChange={(event) => callbacks.onChange(observation, { specFieldId: event.target.value || null })}
            className={`border rounded px-1 py-0.5 text-xs max-w-[12rem] ${
              observation.groupSuggested ? "border-amber-400 bg-amber-50" : "border-neutral-300"
            }`}
          >
            <option value="">No BWS field</option>
            {specFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
        )}
      </td>
      {/* STATED OR TBC IS ASKED ONLY WHERE SOMETHING READS THE ANSWER.

          `asksForState` is the blocker's own predicate, so the control and
          `no_state` cannot disagree — narrowing one alone would either leave a
          select that sets a state nothing ever checks, or a card blocked by a
          question with no control to answer it. The unit select two cells back
          is the precedent and the argument is the same: an empty amber select
          beside fifteen merged REMARKS reads as fifteen unanswered questions
          where there are none.

          The cell stays, so the columns line up and the head still reads
          across; it holds an em-dash, as the Unit column did before it moved. */}
      <td className="px-2 py-2 align-top">
        {asksForState(observation) ? (
          <select
            value={observation.state ?? ""}
            onChange={(event) =>
              callbacks.onChange(observation, { state: (event.target.value || null) as AttributeState | null })
            }
            aria-label="State"
            className={`border rounded px-1 py-0.5 text-xs ${
              observation.state === null ? "border-amber-400 bg-amber-50" : "border-neutral-300"
            }`}
          >
            <option value="">Choose…</option>
            <option value="confirmed">Stated</option>
            <option value="tbc">TBC</option>
          </select>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        )}
      </td>
      <td className="px-4 py-2 align-top text-right">
        <Button size="xs" variant="quiet" onClick={() => callbacks.onIgnore(observation)}>
          Ignore
        </Button>
      </td>
    </tr>
  );
}

/**
 * What this row would displace, and the tick that says go ahead.
 *
 * ============================================================================
 * A PANEL THAT SPANS THE ROW IS ITS OWN <tr>.
 *
 * This used to be an extra `<td colSpan={7}>` inside the SAME `<tr>` as the
 * seven data cells, which makes that row 21 column slots wide: the browser
 * found room for the panel BESIDE the data and squeezed the acknowledgement —
 * the one control that decides whether a confirmed spec is destroyed — into a
 * 100px ribbon of wrapped monospace.
 *
 * PER (observation, RECORD). A card fans out one record per run, and the
 * mock-up run's COM 1 may hold a different old value from the main run's.
 * `heading` names the configuration when several are stacked under one shared
 * row, because then the same measurement is replacing different things on
 * different records.
 * ============================================================================
 */
export function ReplacePanel({
  observation,
  occupants,
  runs,
  busy,
  blocked,
  heading,
  recordNames,
  onChange,
}: {
  observation: DrawingObservation;
  occupants: { recordId: string; occupant: Occupant }[];
  runs: RunResolution[];
  busy: boolean;
  blocked: boolean;
  heading?: ReactNode;
  /**
   * What to call a record the runs do not name — a configuration's own record,
   * `MAIN RUN · TYPE 2`. Checked before the runs.
   */
  recordNames?: Record<string, string>;
  onChange: (observation: DrawingObservation, changes: Record<string, unknown>) => void;
}) {
  if (occupants.length === 0) return null;
  return (
    <tr className={blocked ? "bg-amber-50/40" : undefined}>
      <td colSpan={OBSERVATION_COLUMNS} className="px-4 pb-2">
        <div className="border border-amber-300 bg-amber-50 rounded px-2 py-1.5 text-xs">
          {heading && <p className="mb-1 font-medium text-amber-900">{heading}</p>}
          <p className="text-amber-900">
            {occupants.length === 1
              ? "This item already holds a value here."
              : `${occupants.length} of these records already hold a value here.`}{" "}
            Tick to replace it — the old one is kept, marked retired, and linked to this as its replacement.
          </p>
          {occupants.map(({ recordId, occupant }) => {
            const acknowledged = (observation.replaces ?? []).some(
              (entry) => entry.recordId === recordId && entry.attributeId === occupant.attributeId,
            );
            const runName =
              recordNames?.[recordId] ??
              runs.find((run) => run.status === "matched" && run.record.id === recordId)?.runName ??
              "this phase";
            return (
              <label key={recordId} className="mt-1 flex items-start gap-2 text-amber-900">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={(event) => {
                    const others = (observation.replaces ?? []).filter((entry) => entry.recordId !== recordId);
                    const next = event.target.checked
                      ? [...others, { recordId, attributeId: occupant.attributeId, attributeVersion: occupant.attributeVersion }]
                      : others;
                    onChange(observation, { replaces: next });
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{runName}</span>: replace{" "}
                  <span className="font-mono">
                    {occupant.label}
                    {occupant.value ? `: ${occupant.value}` : ""}
                    {occupant.unit ?? ""}
                  </span>
                  {occupant.sourceFilename && (
                    <span className="text-amber-800">
                      {" "}
                      (from {occupant.sourceFilename}
                      {occupant.sourcePage ? ` p${occupant.sourcePage}` : ""})
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </td>
    </tr>
  );
}

/** Why a row cannot commit, and what is merely worth knowing. */
export function RowNotes({ blockers, warnings }: { blockers: RowBlocker[]; warnings: RowWarning[] }) {
  if (blockers.length === 0 && warnings.length === 0) return null;
  return (
    <tr className="bg-amber-50/40">
      <td colSpan={OBSERVATION_COLUMNS} className="px-4 pb-2 text-xs text-amber-900">
        {blockers.map((blocker) => blocker.message).join(" ")}
        {/* Said out loud, because an amber row that still commits looks like a
            bug otherwise. */}
        {warnings.length > 0 && (
          <span className={blockers.length ? "ml-1" : undefined}>
            {warnings.map((warning) => warning.message).join(" ")} This does not stop you confirming.
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Which runs a drawing applies to.
 *
 * `mixed` is for the configuration card: a record ticked on some of an item's
 * configurations and not others. It renders indeterminate, because neither
 * ticked nor unticked is true — and a tick box that silently rounded it to one
 * of them would make a reviewer's next click mean something they did not
 * intend.
 */
export function RunTargets({
  runs,
  ticked,
  mixed,
  itemCodeRaw,
  records,
  busy,
  onToggle,
  onPick,
  note,
  className,
}: {
  runs: RunResolution[];
  ticked: ReadonlySet<string>;
  mixed?: ReadonlySet<string>;
  itemCodeRaw: string | null;
  records: RecordChoice[];
  busy: boolean;
  onToggle: (recordId: string, on: boolean) => void;
  onPick: (recordId: string) => void;
  note?: ReactNode;
  /** Layout only. The card decides whether this is a band or a sidebar box. */
  className?: string;
}) {
  return (
    <div className={className ?? "px-4 py-3 border-b border-neutral-100"}>
      <p className="text-th font-semibold uppercase tracking-wider text-neutral-500">Applies to</p>
      {runs.length === 0 && (
        <div className="mt-1">
          <p className="text-sm text-amber-900">
            {itemCodeRaw
              ? `No record carries ${itemCodeRaw}. Confirm the bill of quantities for this pack, then reload.`
              : "No item code could be read on this page, so nothing matched."}
          </p>
          {/* WHY THIS ESCAPE HATCH EXISTS. On a 40-page set a couple of
              unreadable codes are tolerable — the rest of the set still
              commits. At one PDF per line item an unreadable code is a dead
              FILE: the run checkboxes are built from resolved candidates, so
              with none there is nothing to click and no way to say what the
              page is. Picking the record by hand is the way out, and it is
              recorded as the reviewer's own decision like any other tick. */}
          {records.length > 0 && (
            <div className="mt-2">
              <label className="text-xs text-neutral-600">
                Say which record this is
                <select
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.value) onPick(event.target.value);
                  }}
                  className="ml-2 border border-neutral-300 rounded px-2 py-1 text-xs disabled:opacity-50"
                >
                  <option value="">— choose a record —</option>
                  {records.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.label} · {record.itemDescription} ({record.runName})
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-1 text-xs text-neutral-500">
                This picks one record only. A code that genuinely belongs to several phases is better fixed by
                correcting the bill&rsquo;s code, so the fan-out happens on its own.
              </p>
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {runs.map((run) =>
          run.status === "matched" ? (
            <label key={run.runId} className="flex items-center gap-2 text-sm text-neutral-800">
              <PartialCheckbox
                checked={ticked.has(run.record.id)}
                indeterminate={mixed?.has(run.record.id) ?? false}
                onChange={(on) => onToggle(run.record.id, on)}
              />
              <span>
                {run.runName}
                <span className="ml-1 text-xs text-neutral-500">
                  {run.record.label} · {run.record.itemDescription}
                </span>
              </span>
            </label>
          ) : (
            <div key={run.runId} className="text-sm">
              <p className="text-amber-900">
                {run.runName} has {run.candidates.length} lines with this code — choose which one:
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {/* Candidates, never a pre-selected guess. */}
                {/* `primary` is the CHOSEN one, not the recommended one:
                    nothing is pre-selected here, so at most one of them is
                    filled in at a time and it is the reviewer's own pick. */}
                {run.candidates.map((candidate) => (
                  <Button
                    key={candidate.id}
                    size="xs"
                    variant={ticked.has(candidate.id) ? "primary" : "secondary"}
                    onClick={() => onToggle(candidate.id, true)}
                  >
                    {candidate.label} · {candidate.itemDescription}
                  </Button>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
      {note}
    </div>
  );
}

/** A tick box that can say "some of them", which HTML only exposes in script. */
function PartialCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
