// One number at the top of a screen, and the place it takes you.
//
// ============================================================================
// A SUMMARY TILE IS A FILTER.
//
// Asked for on 2026-09-18: "those boxes at the top, if we click on those then
// that could filter them… it helps keep it clean in terms of UI, but it also
// just really adds to the functionality." So every tile is a link, and it opens
// the list already narrowed to what the tile counts. A figure with nowhere to
// go makes somebody leave the screen and find the list themselves.
//
// `tone` is the house reading, held once in `tone.ts` and shared with Chip,
// Pill and Note so a tile and the row it filters cannot disagree about what
// red means:
//   danger  blocks money going out
//   warn    needs a person; not an error
//   good    settled
//   info    the app is telling you something it worked out
//   plain   a count with no judgement attached
//
// A tile with no `href` renders as a plain box rather than a dead link,
// because a link that goes nowhere is worse than text.
//
// ---- AND IT DOES NOT SAY WHAT PRESSING IT DOES ----------------------------
//
// It used to. A blue "filter to these →" / "show these →" / "open the library
// →" line made every tile four rows tall, and on the phase screen that strip
// of five pushed the search, the three filters and the table's own header
// below the fold on a full-width monitor. Max, 2026-09-21: "you could just
// display line items 503 and they can still have the same functionality, but
// you don't need to actually have 'filter to these' displayed", and then "the
// same goes for the height of the boxes here and in general -- can they be
// shorter." It was every strip in the app, not the two screens he happened to
// be looking at.
//
// The line cost nothing to remove BECAUSE THE WHOLE TILE IS THE CONTROL: it
// renders as a `<Link>` or a `<button>`, so the pointer, the focus ring and
// the hover shadow all say it is pressable without a sentence saying so.
//
// WHAT THE WORDS DID CARRY, on the screens where a tile is a FILTER on the
// same page, was the ACTIVE STATE -- "showing these" against "show these".
// That is now `active` alone, and checked in the browser at 1920x1080 and
// 1440x900 before the words went: the ring plus the removable filter chip the
// drafts screen and the phase table both put in the row under the strip. If a
// filtered strip ever stops reading as filtered, the fix is a stronger active
// state, NOT this line coming back -- a caption that changes by one word is
// the weakest way to say a list is narrowed.
// ============================================================================
import Link from "next/link";
import { TONE, type Tone } from "./tone";

/** Kept as a name so existing callers read unchanged; it IS the house tone. */
export type StatTone = Tone;

export default function StatTile({
  label,
  value,
  meaning,
  href,
  onPress,
  tone = "plain",
  active = false,
}: {
  label: string;
  value: string | number;
  /** The one line under the number. What it counts, not what to do about it. */
  meaning?: string;
  /** Null, not just absent, so a caller with nothing to link to says so. */
  href?: string | null;
  /**
   * Narrow the list on THIS page instead of going to another one.
   *
   * A tile is either a link somewhere or a filter here, never both — so this
   * renders a `<button>`, because `Button.tsx`'s rule cuts both ways and
   * something that changes what you are looking at is not navigation. Takes
   * precedence over `href` if both are somehow given.
   */
  onPress?: () => void;
  tone?: StatTone;
  /** True when the list below is already filtered to this tile. */
  active?: boolean;
}) {
  const body = (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      {/* Grouped, always. `1899` and `1,899` are the same number and only one
          of them is read at a glance. */}
      <span className={`mt-0.5 block text-2xl font-semibold leading-tight tracking-tight tabular-nums ${TONE[tone].text}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {meaning && <span className="mt-0.5 block text-xs leading-snug text-neutral-500">{meaning}</span>}
    </>
  );

  // py-2 rather than py-3. The row that went is most of the height, but "can
  // they be shorter ... in general" was about the BOX, so the padding goes too.
  // Measured on the phase strip: 120px before, 90px after.
  const shell = `relative overflow-hidden rounded-[10px] border bg-white px-3.5 py-2 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${TONE[tone].edge} ${
    active ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200"
  }`;

  if (onPress) {
    return (
      <button type="button" onClick={onPress} aria-pressed={active} className={`${shell} block w-full text-left transition-shadow hover:border-neutral-300 hover:shadow-sm`}>
        {body}
      </button>
    );
  }
  if (!href) return <div className={shell}>{body}</div>;
  return (
    <Link href={href} className={`${shell} block no-underline transition-shadow hover:border-neutral-300 hover:shadow-sm`}>
      {body}
    </Link>
  );
}
