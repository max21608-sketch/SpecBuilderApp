// The app has worked something out, and one click files it.
//
// ============================================================================
// IT SAYS SO, AND IT SAYS WHY — AND `evidence` IS REQUIRED.
//
// This is NOT a fifth `Button` variant, and the reason is the whole design.
// The four variants grade an action's CONSEQUENCE: primary is the thing this
// screen is for, danger destroys something a document said, quiet is a per-row
// action in a dense table. A suggestion is not a fifth consequence — it is a
// different KIND of thing, whose rule is that the app never asserts what it
// worked out without showing what it worked it out from.
//
// A variant could be used with no evidence beside it. A component with a
// required prop cannot. That is the entire argument for the extra file, and it
// is the same argument as `level_suggested` being its own column rather than a
// flag on `level`: make the wrong shape unrepresentable rather than discouraged.
//
// `StatTile` is the precedent for a `<button>` built outside `Button.tsx` for a
// stated reason. Dashed blue is the house reading — blue is "the app is
// suggesting something, always with its reason, always one click to accept" —
// and the dash is what keeps it from reading as a settled value.
// ============================================================================

const SIZES = {
  sm: "text-sm px-3 py-1.5",
  xs: "text-xs px-2 py-1",
} as const;

export default function SuggestButton({
  value,
  evidence,
  onAccept,
  busy = false,
  disabled = false,
  size = "xs",
  className = "",
}: {
  /** What the app thinks it is. A `?` is appended, because it is asking. */
  value: React.ReactNode;
  /** What it read to think so. REQUIRED — see the header. */
  evidence: React.ReactNode;
  onAccept: () => void;
  busy?: boolean;
  disabled?: boolean;
  size?: "sm" | "xs";
  /** Layout only. */
  className?: string;
}) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`.trim()}>
      <button
        type="button"
        onClick={onAccept}
        disabled={busy || disabled}
        className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border border-dashed border-blue-300 bg-blue-50 font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]}`}
      >
        {value}
        {/* The question mark is the point: it is an offer, and the button does
            not pretend the app has decided. */}
        <span aria-hidden>?</span>
      </button>
      <span className="text-[11px] text-neutral-500">{evidence}</span>
    </span>
  );
}
