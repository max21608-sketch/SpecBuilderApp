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
// The rules are `src/lib/configuration-carry.ts`, shared with the route.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
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
  billLine: { id: string; name: string; qty: number | null; version: number };
  offered: CarryItem[];
  taken: TakenName[];
  alreadySplit: boolean;
};

export type AddedConfiguration = { recordId: string; label: string; carriedSpecs: number; carriedAnswers: number };

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
  const [offer, setOffer] = useState<CarryOfferPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    const result = await apiFetch<CarryOfferPayload>(`/api/records/${billLineId}/configurations`);
    if (!result.ok) {
      setLoadError(result.error);
      return false;
    }
    setLoadError(null);
    setOffer(result.data);
    setTicked(defaultSelection(result.data.offered ?? []));
    return true;
  }, [billLineId]);

  useEffect(() => {
    void load();
  }, [load]);

  const offered = useMemo(() => offer?.offered ?? [], [offer]);
  const differing = offered.filter((item) => item.differing);
  const shared = offered.filter((item) => !item.differing);
  const billLine = offer?.billLine.name ?? "the bill line";
  const nameCheck = name.trim() ? checkConfigurationName(name, offer?.taken ?? [], billLine) : null;
  const stops = stopsBeingExported(offered, ticked, offer?.alreadySplit ?? false);
  const effect = describeExportEffect(stops, offer?.alreadySplit ?? false, billLine, foldConfigurationName(name));

  function toggle(item: CarryItem) {
    setTicked((current) => {
      const next = new Set(current);
      const key = carryKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    if (!offer || !nameCheck?.ok) return;
    setSaving(true);
    setError(null);
    try {
      const refs = (items: CarryItem[]) => items.map((item) => ({ kind: item.kind, id: item.id, version: item.version }));
      const result = await apiFetch<AddedConfiguration>(`/api/records/${billLineId}/configurations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          shown: refs(offered),
          carry: refs(offered.filter((item) => ticked.has(carryKey(item)))),
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

  const row = (item: CarryItem) => (
    <li key={carryKey(item)} className="flex items-start gap-2 py-1.5 text-[12.5px]">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={ticked.has(carryKey(item))}
        onChange={() => toggle(item)}
        aria-label={`Carry ${item.label}`}
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
          {nameCheck && !nameCheck.ok && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              {nameCheck.message}
            </p>
          )}
          {nameCheck?.ok && (
            <p className="mt-1 text-xs text-neutral-500">
              It will be called {billLine} {nameCheck.label}.
            </p>
          )}

          {differing.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-neutral-700">
                Usually different between configurations — left blank unless you tick them
              </p>
              <ul className="divide-y divide-neutral-100">{differing.map(row)}</ul>
            </div>
          )}
          <div className="mt-3">
            <p className="text-xs font-medium text-neutral-700">Carry from {billLine}</p>
            {shared.length === 0 ? (
              <p className="py-1.5 text-[12.5px] text-neutral-500">{billLine} holds nothing else to carry.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">{shared.map(row)}</ul>
            )}
          </div>

          <p className="mt-2 text-xs text-neutral-500">
            The new configuration starts with no quantity
            {offer.billLine.qty !== null && <>: the bill&rsquo;s {offer.billLine.qty} is not divided between configurations</>}
            . It says <em>quantity not allocated</em> until somebody sets one.
          </p>

          <Note tone={stops.length > 0 ? "warn" : "info"}>{effect}</Note>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" disabled={saving || !nameCheck?.ok} onClick={() => void submit()}>
              {saving ? "Adding…" : "Add the configuration"}
            </Button>
            <Button variant="quiet" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
