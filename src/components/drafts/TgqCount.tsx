// A line's TGQ, as the fill-in and chase tables print it.
//
// The item's OWN TGQ is the number (`inItemTgq`: any question blocking a
// quote, minus the project-wide section). The project-wide ones it still
// carries are said underneath, small, because they block the quote too but
// are answered once on the project — a line reading "0" with nothing beside
// it would look quotable while the project still owes them (Max, 2026-10-12).
//
// One component, two tables, so the two screens cannot word it differently.

export default function TgqCount({ toQuote, projectWide = 0 }: { toQuote: number; projectWide?: number }) {
  return (
    <>
      <span className={toQuote > 0 ? "font-semibold text-red-700" : "text-neutral-400"}>{toQuote}</span>
      {projectWide > 0 && (
        <span className="block whitespace-nowrap text-[11px] font-normal text-neutral-500">
          +{projectWide} project-wide
        </span>
      )}
    </>
  );
}
