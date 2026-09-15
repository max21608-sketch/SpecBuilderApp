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
// ============================================================================
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_UNITS,
  type AttributeGroup,
  type AttributeState,
} from "@/lib/spec-vocab";
import { unitSourceOf } from "@/lib/drawing-document";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";

export type RunResolution =
  | { runId: string; runName: string; status: "matched"; record: { id: string; label: string; itemDescription: string } }
  | { runId: string; runName: string; status: "ambiguous"; candidates: { id: string; label: string; itemDescription: string }[] };

export type ItemResolution = {
  id: string;
  resolution: { runs: RunResolution[]; suggested: string[] };
  targets: string[];
  blockers: { code: string; message: string; observationId?: string; runId?: string }[];
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
}) {
  const pending = item.observations.filter((o) => o.reviewStatus === "pending");
  const targets = resolution?.targets ?? [];
  const blockers = resolution?.blockers ?? [];
  const warnings = resolution?.warnings ?? [];
  const blockerFor = (observationId: string) => blockers.filter((b) => b.observationId === observationId);
  const warningFor = (observationId: string) => warnings.filter((w) => w.observationId === observationId);

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

  return (
    <div className="border border-neutral-200 rounded-lg bg-white">
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
        </div>
        {pending.some((observation) => observation.attrGroup === "dimension") && (
          <BulkUnit
            label="All dimensions:"
            disabled={busy}
            onSet={(unit) => void onSetBulkUnit("item", unit, item.id)}
          />
        )}
      </div>

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
            <th className="px-2 py-2 font-medium">BWS field</th>
            <th className="px-2 py-2 font-medium">State</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {pending.map((observation) => {
            const draft = drafts[observation.id] ?? {};
            const value = draft.value !== undefined ? draft.value : observation.value;
            const rowBlockers = blockerFor(observation.id);
            const rowWarnings = warningFor(observation.id);
            return (
              <tr
                key={observation.id}
                className={rowBlockers.length || rowWarnings.length ? "bg-amber-50/40" : undefined}
              >
                <td className="px-4 py-2 align-top">
                  <select
                    value={observation.attrGroup}
                    onChange={(event) =>
                      void onSaveObservation(item, observation, { attrGroup: event.target.value as AttributeGroup })
                    }
                    className="border border-neutral-300 rounded px-1 py-0.5 text-xs"
                  >
                    {ATTRIBUTE_GROUPS.map((group) => (
                      <option key={group} value={group}>
                        {ATTRIBUTE_GROUP_LABELS[group]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 align-top text-neutral-700">{observation.labelRaw ?? "—"}</td>
                <td className="px-2 py-2 align-top">
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
                  {observation.valueRaw !== null && observation.valueRaw !== observation.value && (
                    <p className="mt-0.5 text-xs text-neutral-400">drawing said: {observation.valueRaw}</p>
                  )}
                  {observation.materialCodeRaw && (
                    <p className="mt-0.5 text-xs text-neutral-500">code {observation.materialCodeRaw}</p>
                  )}
                </td>
                <td className="px-2 py-2 align-top">
                  {observation.attrGroup === "dimension" ? (
                    <select
                      value={observation.unit ?? ""}
                      onChange={(event) =>
                        void onSaveObservation(item, observation, { unit: event.target.value || null })
                      }
                      className={`border rounded px-1 py-0.5 text-xs ${
                        observation.unit === null ? "border-amber-400 bg-amber-50" : "border-neutral-300"
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
                  {observation.attrGroup === "dimension" ? (
                    <span className="text-xs text-neutral-500">Dimensions</span>
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
                {(rowBlockers.length > 0 || rowWarnings.length > 0) && (
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
                )}
              </tr>
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
  );
}
