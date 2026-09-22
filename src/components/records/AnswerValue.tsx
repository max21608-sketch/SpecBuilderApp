"use client";
// The control a checklist question is answered with.
//
// ============================================================================
// A PALETTE IS OFFERED ONLY WHERE THIS APP ACTUALLY HOLDS ONE.
//
// Matthew's matrix gives eleven of its 35 fields a palette. Six are his own
// words and are seeded; five say "From the BWS <x> palette" and THIS APP HOLDS
// NONE OF THEM. For those the box stays free text and the screen says so in a
// sentence — an empty dropdown reads as broken, and a reviewer who thinks a
// control is broken types into the next box instead of asking for the list.
//
// Every offered list carries an "Other…" escape, even where Matthew's is
// closed. house/conventions.md §5: anything unresolvable becomes a visible
// flag, never a plausible-looking wrong answer. A list with no way out makes
// somebody pick the nearest wrong option, which is the same failure wearing a
// dropdown.
//
// A DEFAULT PRESELECTS NOTHING HERE. His sheet says Assembly guide is "No
// (default)", and `missing` means nobody has looked: a select already showing
// "No" fires no change event when somebody chooses No, so the one action that
// records their agreement would do nothing at all — the same trap the level
// picker documents. The default is shown as a hint beside the control instead.
// ============================================================================
import {
  isOffPalette,
  isOfferable,
  unheldPaletteNote,
  defaultOption,
  offPaletteNote,
  type Palette,
} from "@/lib/palettes";

const OTHER = "__other__";

export default function AnswerValue({
  palette,
  value,
  disabled,
  inputKey,
  onCommit,
}: {
  palette: Palette | null;
  value: string | null;
  disabled: boolean;
  inputKey: string;
  onCommit: (next: string) => void;
}) {
  const offerable = palette && isOfferable(palette);
  const offPalette = palette ? isOffPalette(palette, value) : false;

  // Free text: no palette at all, one BWS owns and we do not hold, or a value
  // already outside the list — which must stay editable as itself rather than
  // being silently snapped onto an option.
  if (!offerable || offPalette) {
    return (
      <div className="flex-1">
        <input
          key={inputKey}
          defaultValue={value ?? ""}
          placeholder="Value"
          disabled={disabled}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next === (value ?? "")) return;
            onCommit(next);
          }}
          className="w-full border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
        />
        {palette && !isOfferable(palette) && (
          <p className="mt-0.5 text-xs text-slate-500">{unheldPaletteNote(palette)}</p>
        )}
        {offPalette && palette && (
          <p className="mt-0.5 text-xs text-amber-800">
            {/*
              THE SENTENCE MOVED TO `offPaletteNote` on 2026-09-22, because the
              drawings review now says the same thing about a callout and two
              wordings for one fact is a reviewer working out whether they mean
              the same. The TONE stays here: amber on a settled answer sitting
              outside its list, neutral at intake where it is the normal case.

              It lower-cases the palette's name so it reads inside the
              sentence, EXCEPT where the name opens with an acronym -- "the bws
              timber finish palette" is a typo on screen. This branch was
              unreachable for the five BWS palettes until they were seeded on
              2026-09-22 (isOffPalette returns false where there is nothing to
              be off), so "BWS" is the first name it has had to print.
            */}
            {offPaletteNote(palette)}
          </p>
        )}
      </div>
    );
  }

  const fallback = defaultOption(palette);

  return (
    <div className="flex-1">
      <select
        key={inputKey}
        defaultValue={value ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const chosen = event.target.value;
          // "Other…" clears the box so the next blur records what they type,
          // rather than committing the literal sentinel.
          if (chosen === OTHER) {
            onCommit("");
            return;
          }
          if (chosen === (value ?? "")) return;
          onCommit(chosen);
        }}
        className="w-full border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
      >
        <option value="">— not answered —</option>
        {palette.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {palette.allowsFreeText && <option value={OTHER}>Other…</option>}
      </select>
      {fallback && !value && (
        <p className="mt-0.5 text-xs text-neutral-500">
          Usually {fallback.label}. Nothing is recorded until you choose.
        </p>
      )}
    </div>
  );
}
