"use client";

// Which page of a document a control is showing, for a list that may be long.
//
// ============================================================================
// EIGHT BUTTONS, THEN A STEPPER.
//
// A card's pages were a row of buttons, one per page — right for S-201's two
// and wrong for a drawing set where one item spans thirty. Beyond eight the row
// becomes previous / next with "page n · i of N", so the control stays one line
// however large the document is, and every page is still reachable.
//
// Used by the card sidebar's preview and by the swatch picker's "Crop from",
// which asked the same question with the same problem.
// ============================================================================
import Button from "@/components/ui/Button";

export const MAX_PAGE_BUTTONS = 8;

export default function PagePicker({
  pages,
  current,
  onPick,
  disabled = false,
  label,
}: {
  pages: readonly number[];
  current: number | null;
  onPick: (page: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  if (pages.length <= 1) return null;
  const index = Math.max(0, pages.indexOf(current ?? -1));
  if (pages.length <= MAX_PAGE_BUTTONS) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {label && <span className="text-[11px] text-neutral-500">{label}</span>}
        {pages.map((page) => (
          <Button
            key={page}
            size="xs"
            variant={page === current ? "secondary" : "quiet"}
            disabled={disabled}
            onClick={() => onPick(page)}
          >
            page {page}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label && <span className="text-[11px] text-neutral-500">{label}</span>}
      <Button size="xs" variant="quiet" disabled={disabled || index === 0} onClick={() => onPick(pages[index - 1]!)}>
        ‹ Previous
      </Button>
      <span className="text-xs text-neutral-700" aria-live="polite">
        page {pages[index]} · {index + 1} of {pages.length}
      </span>
      <Button
        size="xs"
        variant="quiet"
        disabled={disabled || index === pages.length - 1}
        onClick={() => onPick(pages[index + 1]!)}
      >
        Next ›
      </Button>
    </div>
  );
}
