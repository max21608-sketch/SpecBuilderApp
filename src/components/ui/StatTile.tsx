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
// `tone` is the house reading and nothing else may use these colours:
//   danger  blocks money going out
//   warn    needs a person; not an error
//   good    settled
//   info    the app is telling you something it worked out
//   plain   a count with no judgement attached
//
// A tile with no `href` renders as a plain box rather than a dead link,
// because a link that goes nowhere is worse than text.
// ============================================================================
import Link from "next/link";

export type StatTone = "plain" | "danger" | "warn" | "good" | "info";

const EDGE: Record<StatTone, string> = {
  plain: "before:bg-neutral-300",
  danger: "before:bg-red-600",
  warn: "before:bg-amber-500",
  good: "before:bg-green-600",
  info: "before:bg-blue-600",
};

const VALUE: Record<StatTone, string> = {
  plain: "text-neutral-900",
  danger: "text-red-700",
  warn: "text-amber-700",
  good: "text-green-700",
  info: "text-blue-700",
};

export default function StatTile({
  label,
  value,
  meaning,
  action,
  href,
  onPress,
  tone = "plain",
  active = false,
}: {
  label: string;
  value: string | number;
  /** The one line under the number. What it counts, not what to do about it. */
  meaning?: string;
  /** What pressing it does, in the reader's words. Shown only when it is pressable. */
  action?: string;
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
      <span className={`mt-0.5 block text-2xl font-semibold leading-tight tracking-tight tabular-nums ${VALUE[tone]}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {meaning && <span className="mt-0.5 block text-xs text-neutral-500">{meaning}</span>}
      {action && (href || onPress) && <span className="mt-1.5 block text-xs text-blue-700">{action} →</span>}
    </>
  );

  const shell = `relative overflow-hidden rounded-lg border bg-white px-3.5 py-3 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${EDGE[tone]} ${
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
