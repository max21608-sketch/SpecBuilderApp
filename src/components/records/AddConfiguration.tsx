"use client";
// Adding a configuration to a bill line by hand.
//
// ============================================================================
// A PANEL, NOT A PAGE, AND IT SAYS WHAT IT COSTS BEFORE IT DOES IT.
//
// Everything the bill line holds is listed with a tick, its value and where it
// came from, so a person can see what the new configuration starts with. The
// fields that usually differ between configurations (the fabrics, COM 1 to
// COM 3) are listed FIRST and UNTICKED, which is what makes the new one
// begin blank exactly where it is different.
//
// The sentence above Add is the reason this path is allowed to split a bill
// line that holds specs, where intake's `ensureVariant` refuses to: the bill
// line becomes a heading, and whatever is left unticked stops reaching the
// export. The route re-derives that list from the live rows and refuses when
// it is not what this panel showed, so the sentence cannot be about a
// different set from the one that is committed.
//
// THE SAME BILL LINE ON THE OTHER PHASES is offered too, ticked, each with
// its OWN carry list read from its own bill line — never this phase's specs
// copied across, because phases can differ. A ref on two lines of one phase
// (the SX11A case) offers nothing there, and says why.
//
// The rules are `src/lib/configuration-carry.ts`, shared with the route.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import { TONE } from "@/components/ui/tone";
import { ATTRIBUTE_GROUPS, ATTRIBUTE_GROUP_LABELS, type AttributeGroup } from "@/lib/spec-vocab";
import {
  carryKey,
  checkConfigurationName,
  defaultSelection,
  describeExportEffect,
  foldConfigurationName,
  stopsBeingExported,
  type CarryItem,
  type TakenName,
} from "@/lib/configuration-carry";

export type CarryOfferPayload = {
  billLine: { id: string; name: string; runName: string; qty: number | null; version: number };
  offered: CarryItem[];
  taken: TakenName[];
  alreadySplit: boolean;
};

export type OtherPhasePayload = {
  runId: string;
  runName: string;
  billLineId: string | null;
  lineCount: number;
  offer: CarryOfferPayload | null;
};

type Payload = CarryOfferPayload & { otherPhases?: OtherPhasePayload[] };

export type AddedConfiguration = {
  recordId: string;
  label: string;
  carriedSpecs: number;
  carriedAnswers: number;
  alsoAdded?: { recordId: string; runName: string }[];
};

function sourceOf(item: CarryItem): string {
  if (item.kind === "answer") return "checklist answer";
  if (item.kind === "dimension_note") return "typed on the bill line";
  if (!item.source) return "typed";
  const file = item.source.filename ?? "a document";
  return item.source.page === null ? file : `${file}, page ${item.source.page}`;
}

function stateLabel(item: CarryItem): string | null {
  if (item.state === "tbc") return "TBC";
  if (item.state === "na") return "N/A";
  return null;
}

const refs = (items: CarryItem[]) => items.map((item) => ({ kind: item.kind, id: item.id, version: item.version }));

/** Which fold a carried row sits in. Answers are their own; the note goes with the dimensions. */
function groupOf(item: CarryItem): string {
  if (item.kind === "answer") return "answer";
  if (item.kind === "dimension_note") return "dimension";
  return item.group && (ATTRIBUTE_GROUPS as readonly string[]).includes(item.group) ? item.group : "other";
}
const GROUP_ORDER = [...ATTRIBUTE_GROUPS, "answer"] as const;
const groupLabel = (group: string) =>
  group === "answer" ? "Checklist answers" : (ATTRIBUTE_GROUP_LABELS[group as AttributeGroup] ?? "Other");

function CarryRow({ item, runName, checked, onToggle }: { item: CarryItem; runName: string; checked: boolean; onToggle: () => void }) {
  return (
    <li className="flex items-start gap-2 py-1.5 text-[12.5px]">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={onToggle}
        aria-label={`Carry ${item.label} on ${runName}`}
      />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-neutral-900">{item.label}</span>
        {item.value && <span className="text-neutral-700"> — {item.value}</span>}
        {stateLabel(item) && (
          <Chip tone={item.state === "tbc" ? "warn" : "plain"} className="ml-1.5">
            {stateLabel(item)}
          </Chip>
        )}
        {item.qualifier && <span className="block text-[11px] text-neutral-500">{item.qualifier}</span>}
        <span className="block text-[11px] text-neutral-400">{sourceOf(item)}</span>
      </span>
    </li>
  );
}

/**
 * One bill line's carry list, FOLDED: the differing fields open, because they
 * are the decision; everything else one summary line per group with its
 * count, its ticks inside a show toggle and still ticked by default.
 */
function CarryList({
  offer,
  ticked,
  onToggle,
}: {
  offer: CarryOfferPayload;
  ticked: ReadonlySet<string>;
  onToggle: (item: CarryItem) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const runName = offer.billLine.runName;
  const differing = offer.offered.filter((item) => item.differing);
  const shared = offer.offered.filter((item) => !item.differing);
  const groups = GROUP_ORDER.map((group) => ({ group, items: shared.filter((item) => groupOf(item) === group) })).filter(
    (entry) => entry.items.length > 0,
  );
  const row = (item: CarryItem) => (
    <CarryRow
      key={carryKey(item)}
      item={item}
      runName={runName}
      checked={ticked.has(carryKey(item))}
      onToggle={() => onToggle(item)}
    />
  );
  return (
    <>
      {differing.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-neutral-700">
            Usually different between configurations — left blank unless you tick them
          </p>
          <ul className="divide-y divide-neutral-100">{differing.map(row)}</ul>
        </div>
      )}
      <div className="mt-2">
        <p className="text-xs font-medium text-neutral-700">Carry from {offer.billLine.name}</p>
        {groups.length === 0 ? (
          <p className="py-1.5 text-[12.5px] text-neutral-500">{offer.billLine.name} holds nothing else to carry.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {groups.map(({ group, items }) => {
              const carried = items.filter((item) => ticked.has(carryKey(item))).length;
              const shown = open.has(group);
              return (
                <li key={group} className="py-1 text-[12.5px]">
                  <span className="text-neutral-800">
                    {groupLabel(group)} — {carried === items.length ? `${carried} carried` : `${carried} of ${items.length} carried`}
                  </span>{" "}
                  <Button
                    variant="quiet"
                    size="xs"
                    aria-expanded={shown}
                    aria-label={`${shown ? "Hide" : "Show"} ${groupLabel(group)} on ${runName}`}
                    onClick={() =>
                      setOpen((current) => {
                        const next = new Set(current);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      })
                    }
                  >
                    {shown ? "hide" : "show"}
                  </Button>
                  {shown && <ul className="ml-4 divide-y divide-neutral-100">{items.map(row)}</ul>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

export default function AddConfiguration({
  billLineId,
  onAdded,
  onCancel,
}: {
  /** The bill line — the parent. From a configuration's screen, its parent. */
  billLineId: string;
  onAdded: (added: AddedConfiguration) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [offer, setOffer] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  /** Ticks per bill line: this one and each other phase's. */
  const [ticked, setTicked] = useState<Map<string, Set<string>>>(new Map());
  /** The other phases' bill lines the configuration will also be added to. */
  const [phasesOn, setPhasesOn] = useState<Set<string>>(new Set());
  /** The other phases whose own carry list is open. */
  const [phasesShown, setPhasesShown] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    const result = await apiFetch<Payload>(`/api/records/${billLineId}/configurations`);
    if (!result.ok) {
      setLoadError(result.error);
      return false;
    }
    setLoadError(null);
    setOffer(result.data);
    const next = new Map<string, Set<string>>([[billLineId, defaultSelection(result.data.offered ?? [])]]);
    const on = new Set<string>();
    for (const phase of result.data.otherPhases ?? []) {
      if (!phase.billLineId || !phase.offer) continue;
      next.set(phase.billLineId, defaultSelection(phase.offer.offered));
      on.add(phase.billLineId);
    }
    setTicked(next);
    setPhasesOn(on);
    return true;
  }, [billLineId]);

  useEffect(() => {
    void load();
  }, [load]);

  const others = useMemo(() => offer?.otherPhases ?? [], [offer]);
  const billLine = offer?.billLine.name ?? "the bill line";
  const folded = foldConfigurationName(name);
  const chosen = others.filter(
    (phase): phase is OtherPhasePayload & { billLineId: string; offer: CarryOfferPayload } =>
      Boolean(phase.billLineId && phase.offer && phasesOn.has(phase.billLineId)),
  );
  // ONE NAME, checked against every bill line it will be added under. Any
  // clash refuses the whole act, naming the phase.
  const checks = name.trim()
    ? [
        { where: "", check: checkConfigurationName(name, offer?.taken ?? [], billLine) },
        ...chosen.map((phase) => ({
          where: `On ${phase.runName}: `,
          check: checkConfigurationName(name, phase.offer.taken, phase.offer.billLine.name),
        })),
      ]
    : [];
  const refusals = checks.filter((entry) => !entry.check.ok);
  const nameOk = checks.length > 0 && refusals.length === 0;

  function toggle(lineId: string, item: CarryItem) {
    setTicked((current) => {
      const next = new Map(current);
      const set = new Set(next.get(lineId) ?? []);
      const key = carryKey(item);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next.set(lineId, set);
      return next;
    });
  }

  function togglePhase(lineId: string) {
    setPhasesOn((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  function toggleShown(lineId: string) {
    setPhasesShown((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  const stopsFor = (lineId: string, lineOffer: CarryOfferPayload) =>
    stopsBeingExported(lineOffer.offered, ticked.get(lineId) ?? new Set(), lineOffer.alreadySplit);
  const primaryStops = offer ? stopsFor(billLineId, offer) : [];

  const request = (lineId: string, items: CarryItem[]) => {
    const set = ticked.get(lineId) ?? new Set<string>();
    return { shown: refs(items), carry: refs(items.filter((item) => set.has(carryKey(item)))) };
  };

  async function submit() {
    if (!offer || !nameOk) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<AddedConfiguration>(`/api/records/${billLineId}/configurations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          ...request(billLineId, offer.offered),
          phases: chosen.map((phase) => ({
            billLineId: phase.billLineId,
            ...request(phase.billLineId, phase.offer.offered),
          })),
        }),
      });
      if (!result.ok) {
        // A changed bill line means this panel is out of date: reload FIRST,
        // then say why, or the reload would clear the message it caused.
        if (result.data?.code === "targets_changed") await load();
        setError(result.error);
        return;
      }
      await onAdded(result.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-3" aria-label="Add a configuration">
      <p className="text-[13px] font-semibold text-neutral-900">Add a configuration to {billLine}</p>

      {loadError && (
        <Note tone="danger" actions={<Button size="xs" onClick={() => void load()}>Try again</Button>}>
          {loadError}
        </Note>
      )}
      {!offer && !loadError && <p className="mt-2 text-[12.5px] text-neutral-500">Reading what {billLine} holds…</p>}

      {offer && (
        <>
          <label className="mt-2 block text-xs text-neutral-600">
            Name — what the drawing or the client calls it
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Type 2"
              className="mt-1 block w-48 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          {refusals.map((entry) =>
            entry.check.ok ? null : (
              <p key={entry.where || "here"} role="alert" className="mt-1 text-xs text-red-700">
                {entry.where}
                {entry.check.message}
              </p>
            ),
          )}
          {nameOk && (
            <p className="mt-1 text-xs text-neutral-500">
              It will be called {billLine} {folded}.
            </p>
          )}

          <section className="mt-3">
            <p className="text-xs font-semibold text-neutral-800">On {offer.billLine.runName}</p>
            <CarryList
              offer={offer}
              ticked={ticked.get(billLineId) ?? new Set()}
              onToggle={(item) => toggle(billLineId, item)}
            />
          </section>

          {/* EACH OTHER PHASE IS ONE LINE, with its tick; its own list opens
              only on show. */}
          {others.length > 0 && (
            <ul className="mt-3 divide-y divide-neutral-100 border-t border-neutral-100">
              {others.map((phase) => {
                if (!phase.billLineId || !phase.offer) {
                  return (
                    <li key={phase.runId} className="py-1.5 text-[12.5px] text-neutral-600">
                      {billLine} is on {phase.lineCount} lines of {phase.runName}, so nothing is added there —
                      which of them is this item is a person&rsquo;s call. Add it from the line you mean.
                    </li>
                  );
                }
                const lineId = phase.billLineId;
                const set = ticked.get(lineId) ?? new Set<string>();
                const carried = phase.offer.offered.filter((item) => set.has(carryKey(item))).length;
                const left = phase.offer.offered.length - carried;
                const on = phasesOn.has(lineId);
                const shown = phasesShown.has(lineId);
                return (
                  <li key={phase.runId} className="py-1.5 text-[12.5px]">
                    <label className="inline-flex items-center gap-2 font-medium text-neutral-800">
                      <input type="checkbox" checked={on} onChange={() => togglePhase(lineId)} />
                      Also add {folded || "it"} to {phase.runName}
                    </label>
                    {on && (
                      <>
                        <span className="text-neutral-500">
                          {" "}
                          — {carried} spec{carried === 1 ? "" : "s"} carried, {left} left on the bill line
                        </span>{" "}
                        <Button
                          variant="quiet"
                          size="xs"
                          aria-expanded={shown}
                          aria-label={`${shown ? "Hide" : "Show"} what is carried on ${phase.runName}`}
                          onClick={() => toggleShown(lineId)}
                        >
                          {shown ? "hide" : "show"}
                        </Button>
                      </>
                    )}
                    {on && shown && (
                      <div className="ml-6">
                        <CarryList offer={phase.offer} ticked={set} onToggle={(item) => toggle(lineId, item)} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-3 text-xs text-neutral-500">
            Starts with no quantity
            {offer.billLine.qty !== null && <>: the bill&rsquo;s {offer.billLine.qty} is not divided</>} — it says{" "}
            <em>quantity not allocated</em> until somebody sets one.
          </p>

          {/* THE FOOTER: the consequence beside the act, and sticky, so Add is
              on screen however much was opened above it. */}
          <div className="sticky bottom-0 -mx-3 -mb-3 mt-3 flex flex-wrap items-center gap-3 rounded-b-lg border-t border-neutral-200 bg-white px-3 py-2">
            <div className="min-w-0 flex-1 text-[12.5px] text-neutral-700" data-testid="export-effect">
              <p className={primaryStops.length > 0 ? TONE.warn.text : undefined}>
                {describeExportEffect(primaryStops, offer.alreadySplit, billLine, folded)}
              </p>
              {chosen.map((phase) => {
                const stops = stopsFor(phase.billLineId, phase.offer);
                return stops.length > 0 ? (
                  <p key={phase.runId} className={TONE.warn.text}>
                    On {phase.runName}: {stops.length} left unticked stop{stops.length === 1 ? "s" : ""} being exported:{" "}
                    {stops.map((item) => item.label).join(", ")}.
                  </p>
                ) : null;
              })}
              {error && (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="primary" size="sm" disabled={saving || !nameOk} onClick={() => void submit()}>
                {saving ? "Adding…" : chosen.length > 0 ? `Add on ${chosen.length + 1} phases` : "Add the configuration"}
              </Button>
              <Button variant="quiet" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
