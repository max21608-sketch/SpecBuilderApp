"use client";

// The item's level, set where the evidence for it is.
//
// ============================================================================
// WHY IT IS ON THE DRAWINGS CARD
//
// Item 1.15. Every BOQ row read *Simple · guessed*, including packaging, and
// the only places a level could be corrected were the record screen and the
// drafts blocker — one record at a time. The drawing is where the evidence
// first appears: `guessLevelFromBill` calls an item simple because the BILL
// named no metalwork, and the brass leg is on page 2.
//
// FOUR RULES, EACH A TRAP RATHER THAN A PREFERENCE.
//
// 1. IT WRITES ONLY ON A PERSON'S CLICK, into `spec_records.level` — the
//    column the quote gate reads. The app's own reading lives in
//    `level_suggested` (0025) and is offered here as a `SuggestButton` with
//    what it was read from beside it, never as a value already filled in.
//
// 2. EVERY CHOICE IS ITS OWN BUTTON, never a pre-filled select. A select
//    already reading "Simple" fires no change event when somebody chooses
//    Simple, so the one action recording their agreement would silently do
//    nothing. That is 0025's own finding, and it is why there is no dropdown
//    anywhere on this control.
//
// 3. THE CARD'S CONFIRM DOES NOT CARRY IT. A level goes through the levels
//    route and the specs through the confirm route, so the two writes cannot
//    be confused and one acknowledgement never covers two decisions. It also
//    means the level never blocks the card: an item can be confirmed with no
//    level, exactly as before.
//
// 4. ONE CLICK IS ONE CHANGE SET, however many phases the card fans out to.
//    A drawing of S-200 is quoted by the mock-up, main and VE phases, and the
//    brass leg is one fact on one page — three entries in the trail reading
//    "level set" would bury it. `setLevelOnRecords` does that half; this half
//    says out loud how many records the click reaches.
//
// A CONFIGURATION INHERITS AND NEEDS NOTHING HERE: `ensureVariant` already
// copies both `level` and `level_suggested` from the bill line it splits, so a
// level set on the card before a split is on every letter that split creates.
// ============================================================================
import { useState } from "react";
import { ITEM_LEVELS, ITEM_LEVEL_LABELS, type ItemLevel } from "@/lib/spec-vocab";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SuggestButton from "@/components/ui/SuggestButton";
import { guessLevelFromAttributes } from "@/lib/level-guess";
import type { RunResolution } from "@/components/imports/ObservationRows";

/** What this control needs to know about one record the card writes to. */
export type LevelTarget = {
  id: string;
  label: string;
  runName: string;
  /** Undefined where the payload did not carry it — see `RecordEntry`. */
  level?: ItemLevel | null;
  levelSuggested?: ItemLevel | null;
  levelSuggestedReason?: string | null;
};

export default function LevelControl({
  targets,
  suggestion,
  busy,
  onSet,
}: {
  /** The records this card will write to, as ticked. */
  targets: readonly LevelTarget[];
  /**
   * What the DRAWING suggests, read from this card's own rows by
   * `guessLevelFromAttributes` — null where the pages say nothing about
   * metalwork and nothing calls the item a hero. It never says `simple`,
   * because "this page named no metal" is not evidence that the item has none.
   */
  suggestion: { level: ItemLevel; reason: string } | null;
  busy: boolean;
  onSet: (level: ItemLevel) => void;
}) {
  const [picking, setPicking] = useState(false);

  // Nothing to set a level ON. Said in words rather than shown as a dead
  // control: a page that matched no bill line has a reason, and it is the same
  // reason the card cannot commit.
  if (targets.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 px-3 py-2.5">
        <Heading />
        <p className="mt-1 text-xs text-neutral-500">
          Nothing to set one on yet — a level belongs to a bill line, and this page matches none.
        </p>
      </div>
    );
  }

  const decided = targets.filter((target) => target.level);
  const levels = new Set(decided.map((target) => target.level));
  // The record's OWN suggestion, from the bill, used only where the drawing
  // offers nothing better. It carries its own reason, so accepting it is still
  // accepting something with evidence beside it.
  const fromBill = targets.find((target) => target.levelSuggested && target.levelSuggestedReason);
  const offer =
    suggestion ??
    (fromBill?.levelSuggested && fromBill.levelSuggestedReason
      ? { level: fromBill.levelSuggested, reason: fromBill.levelSuggestedReason }
      : null);

  const choices = (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {ITEM_LEVELS.map((level) => (
        <Button key={level} size="xs" disabled={busy} onClick={() => onSet(level)}>
          {ITEM_LEVEL_LABELS[level]}
        </Button>
      ))}
      <Button size="xs" variant="quiet" disabled={busy} onClick={() => setPicking(false)}>
        Cancel
      </Button>
    </div>
  );

  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2.5">
      <Heading />

      {/* WHAT IS ALREADY DECIDED, whether or not they all agree. A card fanning
          out to three phases can find two of them settled and one not, and
          rounding that to a single answer would hide the record that still
          needs one. */}
      {decided.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
          {levels.size === 1 ? (
            <Chip tone="good">{ITEM_LEVEL_LABELS[[...levels][0] as ItemLevel]}</Chip>
          ) : (
            [...levels].map((level) => (
              <Chip key={level} tone="good">
                {ITEM_LEVEL_LABELS[level as ItemLevel]}
              </Chip>
            ))
          )}
          <span>
            decided on {decided.length} of {targets.length} record{targets.length === 1 ? "" : "s"}
          </span>
        </p>
      )}

      {/* AN OFFER, NEVER A FILLED-IN VALUE, and only where nothing is decided:
          a level somebody chose is not something to re-suggest. */}
      {decided.length === 0 && offer && !picking && (
        <div className="mt-1.5">
          <SuggestButton
            value={ITEM_LEVEL_LABELS[offer.level]}
            evidence={offer.reason}
            busy={busy}
            onAccept={() => onSet(offer.level)}
          />
        </div>
      )}

      {picking ? (
        choices
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Button size="xs" variant="quiet" disabled={busy} onClick={() => setPicking(true)}>
            {decided.length > 0 ? "Change…" : offer ? "Set another level…" : "Set a level…"}
          </Button>
          {/* HOW FAR ONE CLICK REACHES. The same drawing is quoted by several
              phases, so a level set here lands on a record per phase — said
              before the click, not reported after it. */}
          {targets.length > 1 && (
            <span className="text-[11px] text-neutral-500">sets the level on {targets.length} records</span>
          )}
        </div>
      )}

      {decided.length === 0 && !offer && !picking && (
        <p className="mt-1 text-[11px] text-neutral-500">
          Nothing on these pages names metalwork or calls it a hero piece, so the app has nothing to suggest.
        </p>
      )}
    </div>
  );
}

function Heading() {
  return (
    <p className="text-th font-semibold uppercase tracking-wider text-neutral-500">
      Level
      <span className="ml-1 font-medium normal-case tracking-normal text-neutral-500">
        — picks the BWS boilerplate, and which questions hold up a quote
      </span>
    </p>
  );
}

/**
 * The records a card's level click would reach, from its resolution.
 *
 * ONE HELPER because both cards ask it and the answer has to be the same: the
 * ticked records, whether they were matched outright or picked from an
 * ambiguous phase's candidates. A card that computed this differently from the
 * one beside it would report a different blast radius for the same click.
 */
export function levelTargets(
  runs: readonly RunResolution[],
  targets: readonly string[],
): LevelTarget[] {
  const ticked = new Set(targets);
  const out: LevelTarget[] = [];
  for (const run of runs) {
    const candidates = run.status === "matched" ? [run.record] : run.candidates;
    for (const record of candidates) {
      if (!ticked.has(record.id) || out.some((entry) => entry.id === record.id)) continue;
      out.push({
        id: record.id,
        label: record.label,
        runName: run.runName,
        level: record.level,
        levelSuggested: record.levelSuggested,
        levelSuggestedReason: record.levelSuggestedReason,
      });
    }
  }
  return out;
}

/**
 * What the pages on this card suggest the level is.
 *
 * COMPUTED ON THE SCREEN, from the staged rows it is already holding, and
 * deliberately so: `guessLevelFromAttributes` is pure, the card has every row
 * and every page it needs, and doing it here leaves the confirm route and its
 * request shape completely untouched — a level is not part of what a card
 * confirms.
 *
 * It reads the REVIEWER'S value where they have edited one, because a callout
 * corrected to "brass leg" on screen is the evidence in front of them.
 */
export function suggestLevelFromCard(
  rows: readonly { labelRaw: string | null; value: string | null; valueRaw: string | null; page: number | null }[],
): { level: ItemLevel; reason: string } | null {
  return guessLevelFromAttributes(
    rows.map((row) => ({
      labelRaw: row.labelRaw,
      valueRaw: row.value ?? row.valueRaw,
      sourcePage: row.page,
    })),
  );
}
