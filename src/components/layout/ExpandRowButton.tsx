"use client";

// The chevron that opens a table row, as a real button (review 3.9a,
// 2026-11-16).
//
// The chase table and the fill-in table opened a line with a bare
// `<tr onClick>`: no role, no tab stop, no key handler, no aria-expanded, so a
// keyboard user could not open one at all. "A link goes somewhere; a button
// does something" — opening a row does something, so the glyph that already
// said which way it goes is now a `<button aria-expanded>`. The row's own
// click stays as a convenience for the mouse; this one stops propagation so a
// press is one toggle, never two.
//
// Bare like `Disclosure`'s strip: it carries no colour or border of its own,
// so it cannot be mistaken for one of the four Button variants, which grade a
// consequence. Opening a row has none.
export default function ExpandRowButton({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  /** What opens, for a screen reader: "Questions on S-301". The state is aria-expanded. */
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="w-full rounded px-1 text-neutral-500 hover:text-neutral-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400"
    >
      <span aria-hidden="true">{open ? "▾" : "▸"}</span>
    </button>
  );
}
