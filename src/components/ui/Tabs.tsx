// One tab strip, for the six that were written out by hand.
//
// ============================================================================
// CONTROLLED, AND IT NEVER READS THE URL.
//
// There were four hand-rolled tab bars and six verbatim copies of the count
// bubble, and they had drifted: three underline weights, two bubble shades, one
// strip using `aria-current="page"` (which means "this is the current PAGE",
// not the current tab) and none of them a `tablist`.
//
// The split that matters is that this component knows nothing about where the
// value comes from. A strip anything LINKS INTO — the projects list, the
// project's runs, the record's four jobs — keeps its value in the URL through
// `useUrlTab`, so reload, back and a pasted link all agree. A strip nested
// inside a review component keeps it in `useState`, because nothing links to
// it and a `?tab=` on the drawings review would be a second address for a
// screen that already has one. Putting the URL inside this component would
// force the second kind into the first.
//
// A COUNT OF 0 IS SHOWN; A COUNT OF null IS NOT. They are different answers and
// the record screen needs both — "this gate covers nothing that is outstanding"
// is 0, and "Matthew's matrix does not reach this category, so there are no
// gates to be at" is null. Rendering 0 for the second would say the record
// fails three gates it does not have. The caller decides, because only the
// caller can tell them apart.
// ============================================================================
import { TONE, type Tone } from "./tone";

export type TabItem<T extends string> = {
  id: T;
  label: React.ReactNode;
  /** A number, or a phrase like "2 of 3". Null or absent renders no bubble. */
  count?: number | string | null;
  /** Colours the bubble. Default `plain` — a count with no judgement on it. */
  tone?: Tone;
  /** Struck through: a BOQ sheet the reviewer has marked as not to be imported. */
  muted?: boolean;
  /** Dropped from the strip entirely, so callers can keep a static list. */
  hidden?: boolean;
};

export default function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  trailing,
  className = "",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** What this strip selects between, for a screen reader. */
  label: string;
  /** Pinned to the right of the strip — the project page keeps `AddRun` here. */
  trailing?: React.ReactNode;
  /** Layout only. */
  className?: string;
}) {
  const shown = items.filter((item) => !item.hidden);
  return (
    <div className={`flex flex-wrap items-center gap-0.5 border-b border-neutral-200 ${className}`.trim()}>
      <div role="tablist" aria-label={label} className="flex min-w-0 flex-wrap gap-0.5">
        {shown.map((item) => {
          const on = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(item.id)}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] ${
                on
                  ? "border-neutral-900 font-semibold text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              } ${item.muted ? "line-through opacity-60" : ""}`.trim()}
            >
              {item.label}
              {item.count !== null && item.count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${TONE[item.tone ?? "plain"].bubble}`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {trailing && <div className="ml-auto flex items-center gap-2 pb-1.5">{trailing}</div>}
    </div>
  );
}
