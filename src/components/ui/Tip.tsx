// One sentence of help, on hover, instead of a paragraph under every field.
//
// ============================================================================
// THIS IS A TOOL FOR PEOPLE WHO USE IT EVERY DAY.
//
// Asked for on 2026-09-18: "you don't need to over explain things… we could
// have a question mark in a circle and if you hover your mouse over it it just
// shows a little text for exactly what it does." The screens had a caption
// under most fields, which is read once and then becomes furniture that pushes
// the content down the page.
//
// WHAT STAYS ON THE PAGE IN WORDS, and must never be moved in here: anything
// whose ABSENCE looks identical to everything being fine. "No programme
// recorded — nothing can be flagged overdue" is the standing example; a project
// with no dates and a project on time render the same otherwise, so that
// sentence is load-bearing and a tooltip would hide it. The test is whether a
// reader who never hovers would be misled. If yes, it is not a tip.
//
// Title-attribute only, deliberately: it needs no portal, no positioning, no
// z-index fight inside a scrolling table, and it is what a keyboard and a
// screen reader already understand.
// ============================================================================

export default function Tip({ children }: { children: string }) {
  return (
    <span
      title={children}
      aria-label={children}
      role="note"
      tabIndex={0}
      className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-neutral-300 align-middle text-[9px] font-bold leading-none text-neutral-400 hover:border-neutral-500 hover:text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-400"
    >
      ?
    </span>
  );
}
