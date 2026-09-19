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
import { useEffect, useRef, type ReactNode } from "react";
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
import { foldableRow, isMeasuredRow, unitSourceOf, type DrawingObservation } from "@/lib/drawing-document";
import SwatchPicker from "@/components/imports/SwatchPicker";
import Button from "@/components/ui/Button";
import { Th } from "@/components/ui/Table";
import type { CroppedImage } from "@/lib/pdf-crop";

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

export type SpecField = { id: string; json_id: number; name: string; field_category: string };

/** The project's records, for the card that matched none of them. */
export type RecordChoice = { id: string; label: string; itemDescription: string; runName: string };

export type RowBlocker = { code: string; message: string; observationId?: string; runId?: string; recordId?: string };
export type RowWarning = { code: string; message: string; observationId: string };

/** What a control on a row does. The caller decides how far it reaches. */
export type RowCallbacks = {
  onChange: (observation: DrawingObservation, changes: Record<string, unknown>) => void;
  onIgnore: (observation: DrawingObservation) => void;
  onSwatch: (observationId: string, image: CroppedImage | null) => void;
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
 * The table head every observation table shares.
 *
 * `Th` rather than a hand-rolled `<th>`, so this table's header reads the same
 * as every other table in the app. The CELLS below stay as they are: they hold
 * a select in almost every column and `Td`'s padding is built for text.
 */
export function ObservationTableHead() {
  return (
    <thead>
      <tr>
        <Th className="px-4">Group</Th>
        <Th className="px-2">Label</Th>
        <Th className="px-2">Value</Th>
        <Th className="px-2">Unit</Th>
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
      <td colSpan={7} className="px-4 py-2">
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
 * One observation: the seven controls a reviewer rules on it with.
 *
 * `blocked` and `guessed` are passed in rather than derived, because a shared
 * geometry row is blocked when ANY of its configurations is, and guessed
 * whenever the row it leads is.
 */
export function ObservationRow({
  observation,
  page,
  importId,
  specFields,
  drafts,
  setDrafts,
  busy,
  blocked,
  guessWhy,
  callbacks,
}: {
  observation: DrawingObservation;
  page: number | null;
  importId: string;
  specFields: SpecField[];
  drafts: Record<string, Partial<DrawingObservation>>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Partial<DrawingObservation>>>>;
  busy: boolean;
  blocked: boolean;
  guessWhy: string | undefined;
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
        {/* Not for a block: its raw form is the same lines with the heading
            repeated down every one of them. */}
        {observation.valueRaw !== null && observation.valueRaw !== observation.value && !(value ?? "").includes("\n") && (
          <p className="mt-0.5 text-xs text-neutral-400">drawing said: {observation.valueRaw}</p>
        )}
        {observation.materialCodeRaw && (
          <>
            <p className="mt-0.5 text-xs text-neutral-500">code {observation.materialCodeRaw}</p>
            {/* A SWATCH NEEDS A CODE, because that is what `project_finishes`
                is keyed on. A row with no code has no finish to attach a
                picture to, so the control is not offered rather than offered
                and refused. */}
            <SwatchPicker
              importId={importId}
              page={page}
              code={observation.materialCodeRaw}
              disabled={busy}
              onCropped={(image) => callbacks.onSwatch(observation.id, image)}
            />
          </>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        {/* A TEXT NOTE IS NEVER ASKED FOR A UNIT. "REMARKS: SUBMIT SHOP
            DRAWINGS FOR REVIEW" is not a measurement, and an empty select
            beside fifteen of them reads as fifteen unanswered questions where
            there are none — nothing blocks a unitless note.
            A MEASURED note is offered one whether or not it already carries
            one: a wrong mm on `ARM HEIGHT 520` must be correctable without
            promoting the row to a slot, and a figure staged with no unit at all
            must be answerable at all. Not amber — only a dimension is being
            asked. */}
        {observation.attrGroup === "dimension" || isMeasuredRow(observation) ? (
          <select
            value={observation.unit ?? ""}
            onChange={(event) => callbacks.onChange(observation, { unit: event.target.value || null })}
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
        {/* A printed unit is NOT a guess and must not be labelled as one — that
            is the whole reason provenance is tracked. */}
        {unitSourceOf(observation) === "printed" && <p className="mt-0.5 text-xs text-neutral-500">printed on the page</p>}
        {unitSourceOf(observation) === "figures" && <p className="mt-0.5 text-xs text-amber-700">guessed from the figures</p>}
        {unitSourceOf(observation) === "project_default" && (
          <p className="mt-0.5 text-xs text-amber-700">the project default</p>
        )}
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
      <td className="px-2 py-2 align-top">
        <select
          value={observation.state ?? ""}
          onChange={(event) =>
            callbacks.onChange(observation, { state: (event.target.value || null) as AttributeState | null })
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
  onChange,
}: {
  observation: DrawingObservation;
  occupants: { recordId: string; occupant: Occupant }[];
  runs: RunResolution[];
  busy: boolean;
  blocked: boolean;
  heading?: ReactNode;
  onChange: (observation: DrawingObservation, changes: Record<string, unknown>) => void;
}) {
  if (occupants.length === 0) return null;
  return (
    <tr className={blocked ? "bg-amber-50/40" : undefined}>
      <td colSpan={7} className="px-4 pb-2">
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
              runs.find((run) => run.status === "matched" && run.record.id === recordId)?.runName ?? "this phase";
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
      <td colSpan={7} className="px-4 pb-2 text-xs text-amber-900">
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
