"use client";

// The one collapsible section in this app.
//
// The `▾ / ▸ Title (count)` button and the bordered list beneath it existed in
// three places -- PreambleReview's `Collapsed`, DrawingsReview's `CollapsedList`
// and ContactsPanel's header -- written out character for character each time.
// This is that grammar, once, before a fourth copy appeared.
//
// It is the SHELL only: a button, a count and a panel. What goes inside differs
// every time (reviewed notes want Restore, contacts want a form), and pushing
// those differences into props here would produce a component with one prop per
// caller, which is a copy with extra steps.
//
// EMPTY RENDERS NOTHING. A disclosure labelled "(0)" is a control that does
// nothing when clicked, and all three of the originals returned null instead.

export default function Disclosure({
  title,
  count,
  open,
  onToggle,
  children,
  className = "mt-6",
  tone = "quiet",
}: {
  title: string;
  /** Shown in brackets. Omit for a section that is not a list. */
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  /** `loud` is for a section heading; `quiet` for a control among body text. */
  tone?: "quiet" | "loud";
}) {
  if (count === 0) return null;

  return (
    <div className={className}>
      {/* The one bare <button> the button rule allows: the whole strip IS the
          control, the glyph says which way it goes, and it carries no colour or
          border of its own — so it cannot be mistaken for one of the four
          variants, which grade a consequence. Opening a list has none. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={
          tone === "loud"
            ? "text-cell font-medium text-neutral-800 hover:text-neutral-900"
            : "text-cell text-neutral-600 hover:text-neutral-900"
        }
      >
        {open ? "▾" : "▸"} {title}
        {count !== undefined && ` (${count})`}
      </button>
      {open && children}
    </div>
  );
}

/** The bordered list the originals all used inside the panel.
 *
 *  The rule is drawn on each ROW rather than by `divide-y` on the list, which
 *  is the same rule the drawings table learned: a row that later grows a panel
 *  of its own gets a divider between the value and its own panel, and nobody
 *  reading `divide-y` on the container can see that coming. The rows are the
 *  caller's `<li>`s, so the selector reaches them from here and the callers
 *  stay unchanged. */
export function DisclosureList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-2 rounded-[10px] border border-neutral-200 bg-white [&>li]:border-b [&>li]:border-neutral-100 [&>li:last-child]:border-b-0">
      {children}
    </ul>
  );
}
