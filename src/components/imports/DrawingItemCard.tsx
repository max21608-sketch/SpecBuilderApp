"use client";

// One item card: the unit of commit on any drawings screen.
//
// Extracted so the single-document review and the pack-wide review render the
// SAME card. Two copies of this would be two sets of rules about when Confirm
// is enabled, and the whole point of computing blockers in one place is that the
// screen and the confirm route agree.
//
// ============================================================================
// THE CARD IS THE ITEM, AND THE ITEM IS THE UNIT OF COMMIT.
//
// One page of a drawing set is one item, and that item can legitimately belong
// to the same code in SEVERAL runs -- the mock-up, the main run and the
// value-engineered run all quote S-100, at different quantities, from one
// drawing. So the card shows every run it lands in as a tick, and confirming
// writes to all of them at once or to none.
//
// Unticking a run is how you say "the VE version is different". That is a
// decision, recorded as one: a run the reviewer never saw (because the bill was
// confirmed after this page loaded) is neither ticked nor unticked, and the
// confirm refuses rather than guessing.
//
// NOTHING HERE IS PRE-SELECTED WHERE THE ANSWER IS UNKNOWN. A run holding the
// code twice shows its candidates as buttons with nothing chosen. A dimension
// gets a unit only from the page, from figures that agree, or from the
// project's own setting -- and the card says which.
//
// A PAGE WITH NO CODE ON IT IS STILL AN ITEM. The model is told to record an
// absent reference as null rather than guess whose page it is, so a second page
// of views, a legend or a cover sheet stages as a card of its own. That card is
// correct and it is also unactionable, so it opens COLLAPSED and carries one
// button that ignores the whole page. It is never dropped: dismissing it is a
// reviewer's decision, taken once instead of once per row.
// ============================================================================
import { Fragment, useEffect, useState } from "react";
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_UNITS,
  DIMENSION_SLOTS,
  DIMENSION_SLOT_LABELS,
  type AttributeGroup,
  type AttributeState,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { composeDimensionCell } from "@/lib/dimensions";
import { measuredRows, unitSourceOf } from "@/lib/drawing-document";
import { guessSlotsFromViews } from "@/lib/dimension-guess";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import ItemImagePicker from "@/components/imports/ItemImagePicker";
import PagePreview from "@/components/imports/PagePreview";
import SwatchPicker from "@/components/imports/SwatchPicker";
import type { CroppedImage } from "@/lib/pdf-crop";
import Button from "@/components/ui/Button";

export type RunResolution =
  | { runId: string; runName: string; status: "matched"; record: { id: string; label: string; itemDescription: string } }
  | { runId: string; runName: string; status: "ambiguous"; candidates: { id: string; label: string; itemDescription: string }[] };

export type Occupant = {
  attributeId: string;
  attributeVersion: number;
  label: string;
  value: string | null;
  unit: string | null;
  sourceFilename: string | null;
  sourcePage: number | null;
};

export type ItemResolution = {
  id: string;
  resolution: { runs: RunResolution[]; suggested: string[] };
  targets: string[];
  /** Which configuration of its code this card is, or null for a code drawn once. */
  variantLabel?: string | null;
  /** Per ticked record, the variant that already exists to receive these specs. */
  writesTo?: Record<string, string>;
  blockers: { code: string; message: string; observationId?: string; runId?: string; recordId?: string }[];
  /** Per observation: the rows it would displace, one per target record. */
  occupants?: Record<string, { recordId: string; occupant: Occupant }[]>;
  // NOT blockers. These never disable Confirm and the confirm route never sees
  // them -- see drawingItemWarnings() for why they are a separate type.
  warnings?: { code: string; message: string; observationId: string }[];
};

export type SpecField = { id: string; json_id: number; name: string; field_category: string };

/** The project's records, for the card that matched none of them. */
export type RecordChoice = { id: string; label: string; itemDescription: string; runName: string };

/**
 * Setting the unit on many dimensions at once.
 *
 * The per-row select stays the override; this is for the case the project
 * default exists to solve, where a pack states no unit anywhere and a reviewer
 * would otherwise answer the same question once per figure. Deliberately only
 * mm and cm: those are the two a furniture drawing is ever in, and offering
 * metres beside them invites a misclick that is 100x wrong.
 */
export function BulkUnit({
  label,
  disabled,
  onSet,
}: {
  label: string;
  disabled: boolean;
  onSet: (unit: "mm" | "cm") => void;
}) {
  return (
    <span className="flex items-center gap-1 text-xs text-neutral-500">
      {label}
      {(["mm", "cm"] as const).map((unit) => (
        <button
          key={unit}
          type="button"
          disabled={disabled}
          onClick={() => onSet(unit)}
          className="px-1.5 py-0.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {unit}
        </button>
      ))}
    </span>
  );
}

/**
 * The heading to print above this card, or null.
 *
 * A code drawn more than once produces several cards in a row, and adjacency is
 * not a statement: a reviewer looking at four S-301 cards has to be TOLD they
 * are four configurations of one bill line rather than four items. So the
 * heading is printed once, above the first card of the run of them, and names
 * the letters that are actually on screen — a configuration already reviewed is
 * not in this list, and claiming a count that included it would be a number
 * nobody could check.
 */
export function configurationGroup(
  items: readonly { id: string; itemCodeRaw: string | null }[],
  byItem: Map<string, { variantLabel?: string | null } | undefined>,
  item: { id: string; itemCodeRaw: string | null },
  index: number,
): { code: string; letters: string[] } | null {
  const letter = byItem.get(item.id)?.variantLabel;
  if (!letter || !item.itemCodeRaw) return null;
  const same = (other: { itemCodeRaw: string | null }) => other.itemCodeRaw === item.itemCodeRaw;
  // Already printed above an earlier card of the same code.
  if (index > 0 && same(items[index - 1]!)) return null;
  const letters = items
    .filter(same)
    .map((entry) => byItem.get(entry.id)?.variantLabel)
    .filter((value): value is string => Boolean(value));
  return letters.length > 1 ? { code: item.itemCodeRaw, letters } : null;
}

export default function ItemCard({
  item,
  importId,
  resolution,
  specFields,
  records,
  drafts,
  setDrafts,
  busy,
  onSaveObservation,
  onSaveTargets,
  onSetBulkUnit,
  onReview,
  onImage,
  onSwatch,
}: {
  item: DrawingItem;
  importId: string;
  resolution: ItemResolution | undefined;
  specFields: SpecField[];
  records: RecordChoice[];
  drafts: Record<string, Partial<DrawingObservation>>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Partial<DrawingObservation>>>>;
  busy: boolean;
  onSaveObservation: (item: DrawingItem, observation: DrawingObservation, changes: Record<string, unknown>) => Promise<void>;
  onSaveTargets: (item: DrawingItem, ticked: string[], unticked: string[]) => Promise<void>;
  onSetBulkUnit: (scope: "item" | "run", unit: "mm" | "cm", itemId?: string) => Promise<void>;
  onReview: (item: DrawingItem, observations: DrawingObservation[], action: "confirm" | "ignore" | "restore") => Promise<void>;
  /** The crop this card currently holds, remembered by the screen until confirm. */
  onImage: (itemId: string, image: CroppedImage | null) => void;
  /** The swatch chip a reviewer cropped for a finish row, by observation id.
   *  Held by the screen and uploaded at confirm, like the item picture. */
  onSwatch: (observationId: string, image: CroppedImage | null) => void;
}) {
  const pending = item.observations.filter((o) => o.reviewStatus === "pending");

  // ==========================================================================
  // THE FIVE SLOTS FIRST; THE REST OF THE MEASUREMENTS FOLDED AWAY.
  //
  // A drawing dimensions everything it draws. S-201 carries thirty-six
  // measurements after de-duplication and FOUR of them compose BWS field 3;
  // the other thirty-two are arm heights, gaps, radii and stitch spacings that
  // are kept on the item and used by nothing today. Leaving them inline buries
  // the four that matter, which is the `mergeNoteBlocks` problem in the
  // dimension column.
  //
  // They are FOLDED, never dropped: "what the document said" is the whole
  // point of `record_attributes`, and a figure nobody can see is a figure
  // nobody can correct. The count is on the toggle so the card never implies
  // there is less on the page than there is.
  // ==========================================================================
  const [showOtherDimensions, setShowOtherDimensions] = useState(false);
  const keyRows = pending.filter((o) => o.dimensionSlot);
  const otherDimensionRows = pending.filter((o) => !o.dimensionSlot && o.unit !== null);
  const otherIds = new Set(otherDimensionRows.map((o) => o.id));
  const restRows = pending.filter((o) => !o.dimensionSlot && o.unit === null);
  const orderedRows = [...keyRows, ...restRows, ...otherDimensionRows];
  const firstOtherId = otherDimensionRows[0]?.id;

  // A page whose code could not be read opens CLOSED.
  //
  // It cannot commit — no code means no resolved runs means the no_targets
  // blocker — so a full card of rows, a rendered PDF crop and a record select
  // is a lot of screen for something most reviewers will dismiss. What it is
  // stays on the summary line, and the count above still reports it as
  // outstanding: this hides detail, never the item.
  const [open, setOpen] = useState(item.itemCodeRaw !== null);

  // Ignoring the page in one action, two-step rather than a window.confirm.
  // Restore is per row, so an accidental whole-page ignore costs one click per
  // row to undo — worth one deliberate second click here. Disarmed whenever
  // the set it would ignore changes underneath it.
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [pending.length]);

  const targets = resolution?.targets ?? [];
  const blockers = resolution?.blockers ?? [];
  const warnings = resolution?.warnings ?? [];
  const blockerFor = (observationId: string) => blockers.filter((b) => b.observationId === observationId);
  const warningFor = (observationId: string) => warnings.filter((w) => w.observationId === observationId);

  // What BWS will actually receive in field 3, from this card's pending rows,
  // through the same function the export calls.
  //
  // This is the only place a human can check the whole ruling at a glance, and
  // it is what makes the positional W x D x H assumption on a combined line
  // acceptable: a transposed order is obvious here in a second, where ticking a
  // per-row confirmation a hundred times would catch nothing.
  const dimensionCell = composeDimensionCell(
    pending
      .filter((o) => o.attrGroup === "dimension" && o.dimensionSlot)
      .map((o, index) => ({
        slot: o.dimensionSlot as DimensionSlot,
        value: drafts[o.id]?.value !== undefined ? (drafts[o.id]?.value ?? null) : o.value,
        unit: o.unit,
        state: o.state ?? "confirmed",
        sortOrder: index,
      })),
  );

  const toggleRun = (recordId: string, on: boolean) => {
    const ticked = new Set(item.targets?.ticked ?? resolution?.resolution.suggested ?? []);
    const unticked = new Set(item.targets?.unticked ?? []);
    if (on) {
      ticked.add(recordId);
      unticked.delete(recordId);
    } else {
      ticked.delete(recordId);
      unticked.add(recordId);
    }
    void onSaveTargets(item, [...ticked], [...unticked]);
  };

  const ignorePage = (
    <button
      type="button"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        // Disarmed as it is sent, not after it succeeds: a refused request
        // leaves the card on screen, and a button still primed there would
        // ignore the page on the next single click.
        setArmed(false);
        void onReview(item, pending, "ignore");
      }}
      disabled={busy || pending.length === 0}
      className={`text-xs px-2 py-1 rounded border disabled:opacity-50 ${
        armed
          ? "border-amber-400 bg-amber-50 text-amber-900"
          : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {armed ? `Ignore all ${pending.length} row${pending.length === 1 ? "" : "s"}?` : "Ignore this page"}
    </button>
  );

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3 border-b border-neutral-100">
      <div>
        <h3 className="text-base font-semibold text-neutral-900">
          {item.itemCodeRaw ?? "No item code on this page"}
          {item.itemNameRaw && <span className="ml-2 text-sm font-normal text-neutral-600">{item.itemNameRaw}</span>}
        </h3>
        <p className="text-xs text-neutral-500">
          {item.page ? (
            <a
              href={`/api/imports/${importId}/source#page=${item.page}`}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-neutral-900"
            >
              Page {item.page}
            </a>
          ) : (
            "Page unknown"
          )}
          {item.confidence === "low" && <span className="ml-2 text-amber-700">code was hard to read</span>}
        </p>
        {/* ====================================================================
            WHICH CONFIGURATION THIS IS.
            The same code drawn on several pages is several things to make, not
            several readings of one thing — identical geometry, different fabric
            and timber. So the card says which one it is in the words a person
            uses for it, and says whether the record exists yet: a letter with
            no record behind it is one this confirm will create.
            ==================================================================== */}
        {resolution?.variantLabel && (
          <p className="mt-0.5 text-xs">
            <span className="inline-flex items-center rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-medium text-neutral-700">
              {item.itemCodeRaw ? `${item.itemCodeRaw} ${resolution.variantLabel}` : `Configuration ${resolution.variantLabel}`}
            </span>
            <span className="ml-2 text-neutral-500">
              This code is drawn on more than one page. Its specs go on configuration {resolution.variantLabel} of the
              bill line
              {Object.keys(resolution.writesTo ?? {}).length === 0
                ? ", which confirming will create."
                : ", which already exists."}
            </span>
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {open && pending.some((observation) => observation.attrGroup === "dimension") && (
          <BulkUnit
            label="All dimensions:"
            disabled={busy}
            onSet={(unit) => void onSetBulkUnit("item", unit, item.id)}
          />
        )}
        <Button size="xs" variant="quiet" onClick={() => setOpen((value) => !value)}>
          {open ? "Collapse" : "Expand"}
        </Button>
      </div>
    </div>
  );

  if (!open) {
    // Enough to decide without opening it: how many specs, whether anything
    // matched, and the first few labels in the reviewer's own words.
    const labels = pending
      .map((observation) => observation.labelRaw)
      .filter((label): label is string => Boolean(label));
    return (
      <div className="border border-neutral-200 rounded-lg bg-white">
        {header}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-neutral-600">
            {pending.length} spec{pending.length === 1 ? "" : "s"}
            {targets.length === 0
              ? ", nothing matched a record"
              : `, on ${targets.length} record${targets.length === 1 ? "" : "s"}`}
            {labels.length > 0 && (
              <span className="text-neutral-500">
                {" — "}
                {labels.slice(0, 3).join(", ")}
                {labels.length > 3 ? "…" : ""}
              </span>
            )}
          </p>
          {ignorePage}
        </div>
      </div>
    );
  }

  // COMPUTED, NEVER STORED — the `proposalBlockers()` rule. `applyViewGuesses`
  // has already set the slots this returns, so recomputing gives the same
  // answer and yields the two things the staged rows cannot carry: the REASON
  // to print beside each amber select, and the dispute on a page whose views do
  // not settle it. Storing either would freeze a reading that changes the
  // moment somebody edits a figure.
  const guess = guessSlotsFromViews(
    measuredRows(item).map((observation) => ({
      id: observation.id,
      labelRaw: observation.labelRaw,
      value: observation.value ?? observation.valueRaw,
    })),
  );
  const guessWhy = new Map(guess.guesses.map((entry) => [entry.observationId, entry.why]));

  return (
    <div className="border border-neutral-200 rounded-lg bg-white">
      {header}

      {/* A KEY MEASUREMENT DISPUTE, WITH THE DRAWING. The views do not agree
          about which figure is the overall size, so the sizes below are the
          weak reading — and the page goes here, because a question that is
          unreadable as a list of figures is answerable in two seconds off the
          drawing. NOT a blocker: the slots are filled either way, every
          guessed line is yellow, and confirming is a decision the reviewer
          takes with the page in front of them. */}
      {guess.dispute && (
        <div className="px-4 py-3 border-b border-amber-300 bg-amber-50">
          <p className="text-xs uppercase tracking-wide text-amber-800">Key measurement dispute</p>
          <div className="mt-1 flex flex-wrap gap-4">
            <p className="flex-1 min-w-[16rem] text-sm text-amber-900">
              {guess.dispute}
              <span className="block mt-1 text-xs text-amber-800">
                The yellow lines below carry this guess. Correct any that are wrong, or set one back to a note — it
                stays on the item with its label and figure intact either way.
              </span>
            </p>
            <PagePreview importId={importId} page={item.page} className="w-72 max-w-full" />
          </div>
        </div>
      )}

      {dimensionCell.text && (
        <div className="px-4 py-2 border-b border-neutral-100 bg-neutral-50">
          <p className="text-xs uppercase tracking-wide text-neutral-500">BWS Dimensions</p>
          <p className="font-mono text-sm text-neutral-900">{dimensionCell.text}</p>
          {dimensionCell.problems.map((problem, index) => (
            <p key={index} className="text-xs text-amber-700">
              {problem.message}
            </p>
          ))}
        </div>
      )}

      {/* The picture, rendered from the real PDF so what is confirmed is what
          was looked at. Shown whether or not the model proposed one: a card
          with nothing proposed is one where a box can still be dragged. */}
      <ItemImagePicker
        importId={importId}
        itemPage={item.page}
        proposal={item.imageProposal ?? null}
        views={item.viewRegions ?? []}
        onCropped={(image) => onImage(item.id, image)}
      />

      {/* Which runs this drawing applies to. */}
      <div className="px-4 py-3 border-b border-neutral-100">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Applies to</p>
        {(resolution?.resolution.runs.length ?? 0) === 0 && (
          <div className="mt-1">
            <p className="text-sm text-amber-900">
              {item.itemCodeRaw
                ? `No record carries ${item.itemCodeRaw}. Confirm the bill of quantities for this pack, then reload.`
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
                      if (event.target.value) onSaveTargets(item, [event.target.value], []);
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
                  This picks one record only. A code that genuinely belongs to several runs is better fixed by
                  correcting the bill&rsquo;s code, so the fan-out happens on its own.
                </p>
              </div>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-4">
          {resolution?.resolution.runs.map((run) =>
            run.status === "matched" ? (
              <label key={run.runId} className="flex items-center gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  checked={targets.includes(run.record.id)}
                  onChange={(event) => toggleRun(run.record.id, event.target.checked)}
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
                  {run.candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => toggleRun(candidate.id, true)}
                      className={`text-xs px-2 py-1 rounded border ${
                        targets.includes(candidate.id)
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      {candidate.label} · {candidate.itemDescription}
                    </button>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      {/* The specs themselves. */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="px-4 py-2 font-medium">Group</th>
            <th className="px-2 py-2 font-medium">Label</th>
            <th className="px-2 py-2 font-medium">Value</th>
            <th className="px-2 py-2 font-medium">Unit</th>
            <th className="px-2 py-2 font-medium">Dimension / BWS field</th>
            <th className="px-2 py-2 font-medium">State</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        {/* NO `divide-y` HERE. A row carrying an occupant or a blocker is
            THREE table rows (see below), and a divider drawn between tbody
            children would put a line between a value and its own amber panel —
            reading as though the panel belonged to the row underneath. The
            separator goes on the data row instead. */}
        <tbody>
          {orderedRows.map((observation) => {
            const draft = drafts[observation.id] ?? {};
            const value = draft.value !== undefined ? draft.value : observation.value;
            const rowBlockers = blockerFor(observation.id);
            const rowOccupants = resolution?.occupants?.[observation.id] ?? [];
            const rowWarnings = warningFor(observation.id);
            // ==============================================================
            // A PANEL THAT SPANS THE ROW IS ITS OWN <tr>.
            //
            // The two panels below used to be extra `<td colSpan={7}>` cells
            // inside the SAME `<tr>` as the seven data cells, which makes that
            // row 21 column slots wide. The browser then has to find room for
            // the panels BESIDE the data, and squeezed the replace
            // acknowledgement — the one thing on the card that decides whether
            // a confirmed spec is destroyed — into a ribbon of wrapped
            // monospace about 100px across. A cell can only span the table's
            // columns from a row of its own.
            // ==============================================================
            const amber = rowBlockers.length > 0 || rowWarnings.length > 0;
            // A GUESSED SLOT TURNS THE WHOLE LINE YELLOW. An amber border on
            // the slot select alone is invisible in a table of twenty-four
            // rows, and a reviewer scanning for what still needs checking is
            // scanning lines, not dropdowns. Distinct from the amber a blocker
            // uses: yellow is "this is a guess, confirm it", amber is "this
            // cannot commit as it stands".
            const guessed = Boolean(observation.slotSuggested && observation.dimensionSlot);
            // What this row can be given, rather than what the vocabulary
            // holds. `dimension` is never offered here: it is unwritable
            // without a slot, and the slot column sends both together.
            const groupOptions = ATTRIBUTE_GROUPS.filter((group) => {
              if (group === observation.attrGroup) return true;
              if (group === "dimension") return false;
              return observation.unit === null || group === "note";
            });
            const isOther = otherIds.has(observation.id);
            return (
              <Fragment key={observation.id}>
              {observation.id === firstOtherId && (
                <tr className="border-t border-neutral-200 bg-neutral-50">
                  <td colSpan={7} className="px-4 py-2">
                    <Button
                      size="xs"
                      variant="quiet"
                      onClick={() => setShowOtherDimensions((value) => !value)}
                    >
                      {showOtherDimensions
                        ? `Hide the other ${otherDimensionRows.length} dimensions`
                        : `Other dimensions (${otherDimensionRows.length}) — show`}
                    </Button>
                    <span className="ml-2 text-xs text-neutral-500">
                      Everything else this page measures. Kept on the item with its label, figure and unit; not part of
                      the BWS dimension cell.
                    </span>
                  </td>
                </tr>
              )}
              {(!isOther || showOtherDimensions) && (
              <>
              <tr
                className={`border-t border-neutral-100${
                  amber ? " bg-amber-50/40" : guessed ? " bg-yellow-100/70" : ""
                }`}
              >
                <td className="px-4 py-2 align-top">
                  {/* ==========================================================
                      ONLY OFFER A GROUP THIS ROW CAN ACTUALLY BE GIVEN.
                      This listed all six, and on a measured row every one of
                      them was refused: `Dimensions` by `dimension_needs_slot`
                      (0011's biconditional — a dimension has a slot), and
                      every other by `unit_not_a_measurement` (only a dimension
                      or a note may carry a unit). The 400 then landed in the
                      banner at the TOP of the screen, nowhere near the row, so
                      the dropdown simply appeared to do nothing — on the
                      twenty-four-row S-200 card, twenty-four times.
                      The route's rules are right; offering choices it must
                      refuse was not. A row that measures something moves
                      between note and dimension in the SLOT column, which
                      sends both fields in one patch.
                      ========================================================== */}
                  <select
                    value={observation.attrGroup}
                    disabled={groupOptions.length < 2}
                    onChange={(event) =>
                      void onSaveObservation(item, observation, { attrGroup: event.target.value as AttributeGroup })
                    }
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
                </td>
                <td className="px-2 py-2 align-top text-neutral-700">{observation.labelRaw ?? "—"}</td>
                <td className="px-2 py-2 align-top">
                  {/* A sheet's note block is many lines in one row, so it gets
                      a box it fits in. Every line stays editable text: the
                      merge joined rows, it did not rewrite words. */}
                  {(value ?? "").includes("\n") ? (
                    <textarea
                      value={value ?? ""}
                      rows={Math.min(12, (value ?? "").split("\n").length + 1)}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [observation.id]: { ...draft, value: event.target.value } }))
                      }
                      onBlur={(event) => {
                        if (event.target.value === (observation.value ?? "")) return;
                        void onSaveObservation(item, observation, { value: event.target.value || null });
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
                        void onSaveObservation(item, observation, { value: event.target.value || null });
                      }}
                      className="w-full border border-neutral-300 rounded px-2 py-1 text-sm"
                    />
                  )}
                  {/* Not for a block: its raw form is the same lines with the
                      heading repeated down every one of them. */}
                  {observation.valueRaw !== null &&
                    observation.valueRaw !== observation.value &&
                    !(value ?? "").includes("\n") && (
                      <p className="mt-0.5 text-xs text-neutral-400">drawing said: {observation.valueRaw}</p>
                    )}
                  {observation.materialCodeRaw && (
                    <>
                      <p className="mt-0.5 text-xs text-neutral-500">code {observation.materialCodeRaw}</p>
                      {/* A SWATCH NEEDS A CODE, because that is what
                          `project_finishes` is keyed on. A row with no code has
                          no finish to attach a picture to, so the control is
                          not offered rather than offered and refused. */}
                      <SwatchPicker
                        importId={importId}
                        page={item.page}
                        code={observation.materialCodeRaw}
                        disabled={busy}
                        onCropped={(image) => onSwatch(observation.id, image)}
                      />
                    </>
                  )}
                </td>
                <td className="px-2 py-2 align-top">
                  {/* A NOTE IS NEVER ASKED FOR A UNIT. "REMARKS: SUBMIT SHOP
                      DRAWINGS FOR REVIEW" is not a measurement, and an empty
                      amber select beside fifteen of them reads as fifteen
                      unanswered questions where there are none — nothing blocks
                      a unitless note.
                      Where a note DOES carry one, it is shown and stays
                      editable: `ARM HEIGHT 520` is a real measurement that
                      simply has no BWS slot, and 0011 keeps its unit in its own
                      column rather than in its text — a wrong mm must still be
                      correctable without promoting the row to a slot. */}
                  {observation.attrGroup === "dimension" ||
                  (observation.attrGroup === "note" && observation.unit !== null) ? (
                    <select
                      value={observation.unit ?? ""}
                      onChange={(event) =>
                        void onSaveObservation(item, observation, { unit: event.target.value || null })
                      }
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
                  ) : (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                  {/* A printed unit is NOT a guess and must not be labelled as
                      one — that is the whole reason provenance is tracked. */}
                  {unitSourceOf(observation) === "printed" && (
                    <p className="mt-0.5 text-xs text-neutral-500">printed on the page</p>
                  )}
                  {unitSourceOf(observation) === "figures" && (
                    <p className="mt-0.5 text-xs text-amber-700">guessed from the figures</p>
                  )}
                  {unitSourceOf(observation) === "project_default" && (
                    <p className="mt-0.5 text-xs text-amber-700">the project default</p>
                  )}
                </td>
                <td className="px-2 py-2 align-top">
                  {observation.attrGroup === "dimension" || observation.attrGroup === "note" ? (
                    // The question the reviewer is actually being asked. A shop
                    // drawing labels nothing, so its figures stage as notes and
                    // this is where one becomes the width — and where a figure
                    // the page DID label, but as something outside the five
                    // (ARM HEIGHT), stays a note without losing anything.
                    //
                    // Both fields go in ONE patch: 0011 refuses a dimension
                    // with no slot and a note with one, so sending them apart
                    // would leave the staged row in a shape the confirm cannot
                    // write.
                    <div className="flex flex-col gap-0.5">
                      <select
                        value={observation.dimensionSlot ?? ""}
                        onChange={(event) => {
                          const slot = event.target.value;
                          void onSaveObservation(item, observation, {
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
                          {/* A view guess and a positional read are both
                              suggestions and must not claim the same reason:
                              one is "this figure is drawn on three views", the
                              other is "these three were printed in order". */}
                          {guessWhy.get(observation.id) ?? "order assumed W × D × H"}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <select
                      value={observation.specFieldId ?? ""}
                      onChange={(event) =>
                        void onSaveObservation(item, observation, { specFieldId: event.target.value || null })
                      }
                      className="border border-neutral-300 rounded px-1 py-0.5 text-xs max-w-[12rem]"
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
                <td className="px-2 py-2 align-top">
                  <select
                    value={observation.state ?? ""}
                    onChange={(event) =>
                      void onSaveObservation(item, observation, { state: (event.target.value || null) as AttributeState | null })
                    }
                    className={`border rounded px-1 py-0.5 text-xs ${
                      observation.state === null ? "border-amber-400 bg-amber-50" : "border-neutral-300"
                    }`}
                  >
                    <option value="">Choose…</option>
                    <option value="confirmed">Stated</option>
                    <option value="tbc">TBC</option>
                  </select>
                </td>
                <td className="px-4 py-2 align-top text-right">
                  <button
                    type="button"
                    onClick={() => void onReview(item, [observation], "ignore")}
                    className="text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    Ignore
                  </button>
                </td>
              </tr>
              {rowOccupants.length > 0 && (
                <tr className={amber ? "bg-amber-50/40" : undefined}>
                  <td colSpan={7} className="px-4 pb-2">
                    {/* A REVISED DRAWING. The clash is the point of the card,
                        not a fault in it — but only once the reviewer has seen
                        what they are dropping. One tick per RECORD, because a
                        card fans out one record per run and the mock-up run's
                        value is not the main run's. */}
                    <div className="border border-amber-300 bg-amber-50 rounded px-2 py-1.5 text-xs">
                      <p className="text-amber-900">
                        {rowOccupants.length === 1
                          ? "This item already holds a value here."
                          : `${rowOccupants.length} of these records already hold a value here.`}{" "}
                        Tick to replace it — the old one is kept, marked retired, and linked to this as its
                        replacement.
                      </p>
                      {rowOccupants.map(({ recordId, occupant }) => {
                        const acknowledged = (observation.replaces ?? []).some(
                          (entry) => entry.recordId === recordId && entry.attributeId === occupant.attributeId,
                        );
                        const runName =
                          resolution?.resolution.runs.find(
                            (run) => run.status === "matched" && run.record.id === recordId,
                          )?.runName ?? "this run";
                        return (
                          <label key={recordId} className="mt-1 flex items-start gap-2 text-amber-900">
                            <input
                              type="checkbox"
                              checked={acknowledged}
                              disabled={busy}
                              onChange={(event) => {
                                const others = (observation.replaces ?? []).filter((entry) => entry.recordId !== recordId);
                                const next = event.target.checked
                                  ? [
                                      ...others,
                                      {
                                        recordId,
                                        attributeId: occupant.attributeId,
                                        attributeVersion: occupant.attributeVersion,
                                      },
                                    ]
                                  : others;
                                void onSaveObservation(item, observation, { replaces: next });
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
              )}
              {amber && (
                <tr className="bg-amber-50/40">
                  <td colSpan={7} className="px-4 pb-2 text-xs text-amber-900">
                    {rowBlockers.map((blocker) => blocker.message).join(" ")}
                    {/* Said out loud, because an amber row that still commits
                        looks like a bug otherwise. */}
                    {rowWarnings.length > 0 && (
                      <span className={rowBlockers.length ? "ml-1" : undefined}>
                        {rowWarnings.map((warning) => warning.message).join(" ")} This does not stop you confirming.
                      </span>
                    )}
                  </td>
                </tr>
              )}
              </>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-neutral-100">
        <p className="text-xs text-neutral-500">
          {blockers.length > 0
            ? blockers.filter((b) => !b.observationId).map((b) => b.message).join(" ")
            : `Writes ${pending.length} spec${pending.length === 1 ? "" : "s"} to ${targets.length} record${targets.length === 1 ? "" : "s"}.`}
        </p>
        <div className="flex items-center gap-2">
          {ignorePage}
          <button
            type="button"
            onClick={() => void onReview(item, pending, "confirm")}
            disabled={busy || blockers.length > 0 || pending.length === 0 || targets.length === 0}
            className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {busy ? "Confirming…" : `Confirm ${pending.length} spec${pending.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
