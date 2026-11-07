"use client";

// "Also on its twin": one tick per twin under Add a spec, Edit value and
// Retire (0060).
//
// The offer is `twinOffer`'s, the function the write boundary re-runs under
// the lock, so a tick here is exactly a twin the server will write (or refuse
// in words if it changed since). Ticked by default where nothing would be
// replaced or flattened (T1, "so a spec is added to both at once"); a twin
// that HOLDS the slot is offered unticked with its value, and ticking it is
// the replace acknowledgement; a twin whose row differs is listed with its
// value and has no tick at all, because it is left alone.
//
// The person's choice is kept per (twin, what the offer says about it), so
// changing the slot on the Add form re-offers the twin from its default
// rather than carrying a tick that was given for a different slot.
import { useState } from "react";
import { twinOfferSentence, type TwinAttribute, type TwinOfferEntry } from "@/lib/twin-offer";
import type { AlsoRecord } from "@/lib/twin-writes";
import type { Attribute } from "@/components/records/record-payload";

function keyOf(entry: TwinOfferEntry): string {
  return `${entry.twin.recordId}|${entry.status}|${entry.row?.id ?? ""}`;
}

export function useTwinTicks(offer: readonly TwinOfferEntry[]) {
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const isTicked = (entry: TwinOfferEntry) => entry.offered && (chosen[keyOf(entry)] ?? entry.ticked);
  const toggle = (entry: TwinOfferEntry, on: boolean) => setChosen((current) => ({ ...current, [keyOf(entry)]: on }));
  const also: AlsoRecord[] = offer
    .filter(isTicked)
    .map((entry) => ({
      recordId: entry.twin.recordId,
      attributeId: entry.row && (entry.status === "held" || entry.status === "same") ? entry.row.id : null,
      version: entry.row && (entry.status === "held" || entry.status === "same") ? entry.row.version : null,
    }));
  return { isTicked, toggle, also, reset: () => setChosen({}) };
}

/** A record-screen attribute in the offer's shape. The payload names the BWS field by json_id. */
export function asTwinAttribute(attribute: Attribute, specFields: readonly { id: string; json_id: number }[]): TwinAttribute {
  return {
    id: attribute.id,
    version: attribute.version,
    attrGroup: attribute.attr_group,
    label: attribute.label,
    value: attribute.value,
    unit: (attribute.unit as TwinAttribute["unit"]) ?? null,
    qualifier: attribute.qualifier,
    state: attribute.state,
    dimensionSlot: attribute.dimension_slot,
    specFieldId:
      attribute.json_id === null || attribute.json_id === undefined
        ? null
        : (specFields.find((field) => field.json_id === attribute.json_id)?.id ?? null),
  };
}

export default function TwinTicks({
  offer,
  ticks,
  disabled = false,
}: {
  offer: readonly TwinOfferEntry[];
  ticks: ReturnType<typeof useTwinTicks>;
  disabled?: boolean;
}) {
  if (offer.length === 0) return null;
  return (
    <fieldset className="mt-2 rounded border border-sky-200 bg-sky-50/60 px-3 py-2">
      <legend className="px-1 text-xs font-medium text-neutral-700">
        Its twin{offer.length === 1 ? "" : "s"}: one item on {offer.length + 1} lines
      </legend>
      <ul className="space-y-1">
        {offer.map((entry) => {
          const where = [entry.twin.area, entry.twin.runName].filter(Boolean).join(" · ");
          const sentence = twinOfferSentence(entry);
          return (
            <li key={entry.twin.recordId} className="text-xs text-neutral-700">
              {entry.offered ? (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={ticks.isTicked(entry)}
                    disabled={disabled}
                    onChange={(event) => ticks.toggle(entry, event.target.checked)}
                  />
                  <span>
                    {sentence}
                    {where && <span className="text-neutral-500"> ({where})</span>}
                  </span>
                </label>
              ) : (
                // Not offered: said, with no tick, because it is left alone.
                <span className="block pl-5 text-neutral-500">
                  {sentence}
                  {where && <span> ({where})</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
