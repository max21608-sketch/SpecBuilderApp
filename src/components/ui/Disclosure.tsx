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
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={
          tone === "loud"
            ? "text-sm font-medium text-neutral-800 hover:text-neutral-900"
            : "text-sm text-neutral-600 hover:text-neutral-900"
        }
      >
        {open ? "▾" : "▸"} {title}
        {count !== undefined && ` (${count})`}
      </button>
      {open && children}
    </div>
  );
}

/** The bordered list the originals all used inside the panel. */
export function DisclosureList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-2 divide-y divide-neutral-100 border border-neutral-200 rounded bg-white">{children}</ul>
  );
}
