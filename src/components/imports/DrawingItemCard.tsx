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
import type { DimensionSlot, ItemLevel } from "@/lib/spec-vocab";
import { composeDimensionCell } from "@/lib/dimensions";
import { isMeasuredRow, measuredRows, wasReadByModel } from "@/lib/drawing-document";
import { EMPTY_GUESS, guessSlotsFromViews } from "@/lib/dimension-guess";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import LevelControl, { levelTargets, suggestLevelFromCard } from "@/components/imports/LevelControl";
import ItemImagePicker from "@/components/imports/ItemImagePicker";
import PagePreview from "@/components/imports/PagePreview";
import {
  ObservationRow,
  ObservationTableHead,
  OtherDimensionsToggle,
  ReplacePanel,
  RowNotes,
  RunTargets,
  orderRows,
  type Occupant,
  type RecordChoice,
  type RowBlocker,
  type RowWarning,
  type RunResolution,
  type SpecField,
} from "@/components/imports/ObservationRows";
import type { CroppedImage } from "@/lib/pdf-crop";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Tip from "@/components/ui/Tip";

// Re-exported from where they now live, so the screens keep one import.
export type { Occupant, RecordChoice, RunResolution, SpecField } from "@/components/imports/ObservationRows";

export type ItemResolution = {
  id: string;
  resolution: { runs: RunResolution[]; suggested: string[] };
  targets: string[];
  /**
   * Which configuration of its code this card is, or null for a code drawn
   * once.
   *
   * NEVER RENDERED BY THIS CARD, which only ever draws a code that appears on
   * ONE page. A lettered item is grouped into a `ConfigurationCard` before it
   * reaches here (`src/lib/configuration-cards.ts`), and that card is where the
   * chips, the shared geometry and the per-configuration sections live. Kept on
   * the type because the same resolution payload feeds both.
   */
  variantLabel?: string | null;
  /** Per ticked record, the variant that already exists to receive these specs. */
  writesTo?: Record<string, string>;
  blockers: RowBlocker[];
  /** Per observation: the rows it would displace, one per target record. */
  occupants?: Record<string, { recordId: string; occupant: Occupant }[]>;
  // NOT blockers. These never disable Confirm and the confirm route never sees
  // them -- see drawingItemWarnings() for why they are a separate type.
  warnings?: RowWarning[];
};

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
        <Button key={unit} size="xs" disabled={disabled} onClick={() => onSet(unit)}>
          {unit}
        </Button>
      ))}
    </span>
  );
}

export default function ItemCard({
  item,
  pages,
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
  onSetLevel,
}: {
  item: DrawingItem;
  /**
   * Every page of this item, for the swatch picker. A code drawn once is one
   * page; the model's own code group can still name a second one that staged
   * no observations — the finishes sheet whose chips are printed and whose
   * figures are not. Optional, so a caller with only the item still renders.
   */
  pages?: readonly number[];
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
   *  Held by the screen and uploaded at confirm, like the item picture. The
   *  page is the one the crop was taken FROM, which on a two-page item need
   *  not be the page the row was read from. */
  onSwatch: (observationId: string, image: CroppedImage | null, page: number | null) => void;
  /**
   * Set ONE level on the records this card writes to, through the levels route.
   *
   * REQUIRED, not optional: a card that cannot set a level is a card missing a
   * control, and a screen that forgot to pass it would lose it silently. It is
   * separate from `onReview` on purpose — the card's confirm carries no level,
   * so the two writes cannot be confused.
   */
  onSetLevel: (recordIds: string[], level: ItemLevel) => Promise<void>;
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
  //
  // FOLDED BY WHETHER IT IS A MEASUREMENT, NEVER BY WHETHER IT HAS A UNIT.
  // The two are different questions -- see `isMeasuredRow` -- and asking the
  // second one here is what left forty-four figures rendered inline on a page
  // whose units could not be inferred.
  const { ordered, otherIds, otherDimensionRows, firstOtherId } = orderRows(pending);

  // Every control on a row of THIS card writes to THIS page's observation. The
  // configuration card passes callbacks that reach further; nothing in
  // `ObservationRow` knows the difference.
  const rowCallbacks = {
    onChange: (observation: DrawingObservation, changes: Record<string, unknown>) =>
      void onSaveObservation(item, observation, changes),
    onIgnore: (observation: DrawingObservation) => void onReview(item, [observation], "ignore"),
    onSwatch,
  };

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
  // The records one level click would reach, computed once: the control prints
  // the count and the click sends the same list, so they cannot disagree.
  const levelForTargets = levelTargets(resolution?.resolution.runs ?? [], targets);
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
    <Button
      size="xs"
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
      className={armed ? "border-amber-400 bg-amber-50 text-amber-900" : undefined}
    >
      {armed ? `Ignore all ${pending.length} row${pending.length === 1 ? "" : "s"}?` : "Ignore this page"}
    </Button>
  );

  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
      {/* THE CODE IS THE NAME. Mono, normal case, at the size a heading is read
          at — not the card heading's uppercase tracking, which turns `S-201`
          into something to decipher. */}
      <span className="font-mono text-[13px] font-semibold text-neutral-900">
        {item.itemCodeRaw ?? "No item code on this page"}
      </span>
      {item.itemNameRaw && <span className="text-neutral-700">{item.itemNameRaw}</span>}
      {item.page ? (
        <a
          href={`/api/imports/${importId}/source#page=${item.page}`}
          target="_blank"
          rel="noreferrer"
          className="text-blue-700 no-underline hover:underline"
        >
          <Chip>page {item.page}</Chip>
        </a>
      ) : (
        <Chip tone="warn">page unknown</Chip>
      )}
      {item.confidence === "low" && <Chip tone="warn">code was hard to read</Chip>}
      <span className="flex-1" />
      {/* Offered whenever the card holds a MEASUREMENT, not only once one has
          been promoted to a dimension. A page whose units could not be inferred
          is exactly the page that needs this control, and gating it on
          `attrGroup === "dimension"` hid it from every one of them. */}
      {open && pending.some(isMeasuredRow) && (
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
  );

  if (!open) {
    // Enough to decide without opening it: how many specs, whether anything
    // matched, and the first few labels in the reviewer's own words.
    const labels = pending
      .map((observation) => observation.labelRaw)
      .filter((label): label is string => Boolean(label));
    return (
      <div className="mt-4 rounded-[10px] border border-neutral-200 bg-white">
        {header}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-neutral-600">
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
  // NOT ON A VERSION 2 ITEM. The model said which figure is which and why, and
  // those reasons are on the rows; re-guessing here only produces a dispute
  // banner describing a sort this app no longer does, printed above rows that
  // say something else. `EMPTY_GUESS` keeps the two render paths identical
  // rather than making every use below conditional.
  const guess = wasReadByModel(item)
    ? EMPTY_GUESS
    : guessSlotsFromViews(
    measuredRows(item).map((observation) => ({
      id: observation.id,
      labelRaw: observation.labelRaw,
      value: observation.value ?? observation.valueRaw,
    })),
    // The page's own name for the item, exactly as the server passes it. Left
    // out, the seat-height half of the dispute was computed one way on the
    // server and another here, so an armchair with no seat height said so in
    // the dump and not on the screen.
    item.itemNameRaw,
  );
  const guessWhy = new Map(guess.guesses.map((entry) => [entry.observationId, entry.why]));

  // Which rows the reviewer is being asked to confirm rather than merely read.
  const guessedRows = ordered.filter(
    (o) => (o.slotSuggested && o.dimensionSlot) || o.groupSuggested,
  );

  return (
    <div className="mt-4 rounded-[10px] border border-neutral-200 bg-white">
      {header}

      {/* TWO COLUMNS, AND THE RIGHT ONE STAYS PUT. The rows are read against the
          drawing, so the drawing, the picture and the runs this page applies to
          are a sticky sidebar rather than three bands stacked above the table —
          which is what put the page off screen by the time anybody reached the
          figures. */}
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {/* The specs themselves. */}
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full border-collapse text-cell">
              <ObservationTableHead />
              {/* NO `divide-y` HERE. A row carrying an occupant or a blocker is
                  THREE table rows, and a divider drawn between tbody children
                  would put a line between a value and its own amber panel —
                  reading as though the panel belonged to the row underneath.
                  The separator goes on the data row instead. */}
              <tbody>
                {ordered.map((observation) => {
                  const rowBlockers = blockerFor(observation.id);
                  const rowWarnings = warningFor(observation.id);
                  const rowOccupants = resolution?.occupants?.[observation.id] ?? [];
                  const blocked = rowBlockers.length > 0 || rowWarnings.length > 0;
                  const isOther = otherIds.has(observation.id);
                  return (
                    <Fragment key={observation.id}>
                      {observation.id === firstOtherId && (
                        <OtherDimensionsToggle
                          count={otherDimensionRows.length}
                          shown={showOtherDimensions}
                          onToggle={() => setShowOtherDimensions((value) => !value)}
                        />
                      )}
                      {(!isOther || showOtherDimensions) && (
                        <>
                          <ObservationRow
                            observation={observation}
                            page={item.page}
                            itemPages={pages}
                            importId={importId}
                            specFields={specFields}
                            drafts={drafts}
                            setDrafts={setDrafts}
                            busy={busy}
                            blocked={blocked}
                            guessWhy={guessWhy.get(observation.id)}
                            callbacks={rowCallbacks}
                          />
                          <ReplacePanel
                            observation={observation}
                            occupants={rowOccupants}
                            runs={resolution?.resolution.runs ?? []}
                            busy={busy}
                            blocked={blocked}
                            onChange={(target, changes) => void onSaveObservation(item, target, changes)}
                          />
                          <RowNotes blockers={rowBlockers} warnings={rowWarnings} />
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ONE SENTENCE UNDER THE TABLE, not a reason repeated on every row.
              It says what the yellow means and what this card's particular
              guess was read from — a dispute where the views could not settle
              it, the model's own evidence where they did. NOT a blocker: the
              slots are filled either way and confirming is a decision the
              reviewer takes with the page beside them. */}
          {guessedRows.length > 0 && (
            <p className="mt-2 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
              <b>
                {guessedRows.length === 1 ? "The yellow row is a guess." : "Yellow rows are guesses."}
              </b>{" "}
              {guess.dispute ??
                "Each says what it was read from beside the control it fills."}{" "}
              Confirm or correct them — a row set back to a note keeps its label and figure either way.
            </p>
          )}

          {/* WHAT BWS WILL ACTUALLY RECEIVE in field 3, from this card's pending
              rows, through the same function the export calls. This is the only
              place a human can check the whole ruling at a glance, and it is
              what makes the positional W x D x H assumption acceptable: a
              transposed order is obvious here in a second. ALWAYS SHOWN, even
              when empty — a card with no line at all reads as one with nothing
              to say about its size, which is the opposite of the truth. */}
          <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
            <p className="text-th font-semibold uppercase tracking-wider text-neutral-500">
              BWS Dimensions
              <Tip>Exactly what BWS field 3 will receive, composed the way the export composes it.</Tip>
            </p>
            {dimensionCell.text ? (
              <p className="font-mono text-[13px] text-neutral-900">{dimensionCell.text}</p>
            ) : (
              <p className="text-neutral-500">
                No width, depth or height placed yet. Give a figure below its slot, or leave them as notes — they stay
                on the item either way.
              </p>
            )}
            {dimensionCell.problems.map((problem, index) => (
              <p key={index} className="text-xs text-amber-700">
                {problem.message}
              </p>
            ))}
          </div>
        </div>

        {/* THE SIDEBAR. Sticky, because the page is what the rows are checked
            against and it used to scroll away above them. */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          {/* The page itself. A question that is unreadable as a list of figures
              is answerable in two seconds off the drawing, and this is also
              where the key-measurement dispute used to render its own copy —
              one preview per card rather than two. */}
          <PagePreview importId={importId} page={item.page} className="w-full" />

          {/* The picture, rendered from the real PDF so what is confirmed is
              what was looked at. Shown whether or not the model proposed one: a
              card with nothing proposed is one where a box can still be
              dragged. */}
          <div className="rounded-lg border border-neutral-200">
            <ItemImagePicker
              importId={importId}
              itemPage={item.page}
              proposal={item.imageProposal ?? null}
              views={item.viewRegions ?? []}
              onCropped={(image) => onImage(item.id, image)}
            />
          </div>

          {/* Which runs this drawing applies to. */}
          <RunTargets
            runs={resolution?.resolution.runs ?? []}
            ticked={new Set(targets)}
            itemCodeRaw={item.itemCodeRaw}
            records={records}
            busy={busy}
            onToggle={toggleRun}
            onPick={(recordId) => void onSaveTargets(item, [recordId], [])}
            className="rounded-lg border border-neutral-200 px-3 py-2.5"
          />

          {/* THE LEVEL, BESIDE THE RECORDS IT LANDS ON. §0.3: a control lives
              beside the thing it acts on, and what a level is set ON is the
              records this card applies to. It is not part of the confirm. */}
          <LevelControl
            targets={levelForTargets}
            suggestion={suggestLevelFromCard(pending.map((o) => ({ ...o, page: item.page })))}
            busy={busy}
            onSet={(level) => void onSetLevel(levelForTargets.map((entry) => entry.id), level)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-[#fcfcfc] px-4 py-3">
        {/* WHAT CONFIRM WILL WRITE, or what is stopping it — and a blocker on a
            ROW still has to be counted here. The card printed only the blockers
            that belong to the card itself, so an item whose every blocker was on
            a row showed an EMPTY sentence beside a disabled button: the one
            thing a screen must never do is refuse without saying why. */}
        <p className="text-neutral-600">
          {(() => {
            if (blockers.length === 0) {
              return `Writes ${pending.length} spec${pending.length === 1 ? "" : "s"} to ${targets.length} record${targets.length === 1 ? "" : "s"}.`;
            }
            const cardLevel = blockers.filter((b) => !b.observationId).map((b) => b.message);
            if (cardLevel.length > 0) return cardLevel.join(" ");
            const rows = new Set(blockers.map((b) => b.observationId)).size;
            return `${rows} row${rows === 1 ? "" : "s"} above need${rows === 1 ? "s" : ""} attention before this can be confirmed.`;
          })()}
        </p>
        <span className="flex-1" />
        {ignorePage}
        <Button
          variant="primary"
          onClick={() => void onReview(item, pending, "confirm")}
          disabled={busy || blockers.length > 0 || pending.length === 0 || targets.length === 0}
        >
          {busy ? "Confirming…" : `Confirm ${pending.length} spec${pending.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
