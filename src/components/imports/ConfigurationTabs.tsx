"use client";

// The tab strip a configuration card is read through.
//
// ============================================================================
// ONE CONFIGURATION ON SCREEN AT A TIME, IN THE SAME LAYOUT EVERY TIME.
//
// Max, 2026-09-23: "instead of having to just keep scrolling down for each
// configuration, you just see configuration one, and it's got the dimensions
// and the fabric. And then you go to configuration two ... it's the same every
// time." A card listing five configurations one after another down the page is
// the card nobody reads to the end.
//
// So each tab is a configuration, named as the document names it (`TYPE 2`) or
// by our page letter (`S-201 A`), and carries its own state — how many rows are
// still to review, applied once confirmed, and a blocker if it has one — so the
// strip is also the card's summary.
//
// THE `Tabs` PRIMITIVE, so it wraps rather than scrolling sideways: ten room
// types is a normal specification sheet, and a strip hiding the eighth behind
// a scroll is a configuration nobody knows is there. `trailing` is where an
// "Add configuration" control goes.
//
// Local state in the card, not the URL: a strip nested in a review component
// keeps `useState` (docs/design-language.md).
// ============================================================================
import type { ReactNode } from "react";
import Tabs from "@/components/ui/Tabs";
import type { ConfigurationColour } from "@/components/imports/configuration-colours";

export type ConfigurationTab = {
  key: string;
  label: string;
  colour: ConfigurationColour;
  pending: number;
  state: "pending" | "applied" | "ignored";
  /** Why this tab cannot confirm, in words, or null. */
  blocked: string | null;
};

export default function ConfigurationTabs({
  tabs,
  active,
  onSelect,
  trailing,
  label = "Configurations",
}: {
  tabs: readonly ConfigurationTab[];
  active: string;
  onSelect: (key: string) => void;
  trailing?: ReactNode;
  label?: string;
}) {
  return (
    <Tabs
      label={label}
      value={active}
      onChange={onSelect}
      trailing={trailing}
      items={tabs.map((tab) => ({
        id: tab.key,
        label: (
          <span className="inline-flex items-center gap-1.5" title={tab.blocked ?? undefined}>
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${tab.colour.dot}`} />
            <span className="font-mono">{tab.label}</span>
            {tab.blocked && <span className="text-[11px] font-normal text-amber-700">blocked</span>}
          </span>
        ),
        count: tab.state === "applied" ? "applied" : tab.state === "ignored" ? null : tab.pending,
        tone: tab.state === "applied" ? "good" : tab.blocked ? "warn" : "plain",
      }))}
    />
  );
}
