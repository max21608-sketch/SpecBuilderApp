"use client";

// A bill line's twin, on the review: a suggestion to accept, or the twin a
// person accepted with the way to take it back (0060).
//
// The suggestion is a `SuggestButton` carrying what it was read from ("one
// code, FUR-13, under two zones"), because a twin accepted blind would put
// every later spec on a line nobody looked at. Accepting stages the twin on
// the line; nothing is linked until the bill is confirmed, and the confirm
// links only what was accepted here.
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SuggestButton from "@/components/ui/SuggestButton";
import type { TwinSuggestion } from "@/lib/twin-suggest";

export default function BillTwinCell({
  accepted,
  partnerMissing = false,
  suggestion,
  editable,
  busy,
  onAccept,
  onClear,
}: {
  /** The twin a person accepted on this line, if any. */
  accepted: { row: number; evidence: string } | null | undefined;
  /** The accepted twin's row is not being imported as an item (`twinPartnerMissing`). */
  partnerMissing?: boolean;
  /** What `suggestTwins` reads off the sheet for this line, if anything. */
  suggestion: TwinSuggestion | undefined;
  editable: boolean;
  busy: boolean;
  onAccept: () => void;
  onClear: () => void;
}) {
  if (accepted) {
    return (
      <span className="mt-1 flex flex-wrap items-center gap-1.5" title={accepted.evidence}>
        <Chip tone={partnerMissing ? "warn" : "live"}>twin of row {accepted.row}</Chip>
        <span className={`text-[11px] ${partnerMissing ? "text-amber-800" : "text-neutral-500"}`}>
          {partnerMissing
            ? `row ${accepted.row} is not being imported: nothing is linked`
            : "linked when the bill is confirmed"}
        </span>
        {editable && (
          <Button variant="quiet" size="xs" className="-my-0.5 px-1 py-0 text-[11px]" disabled={busy} onClick={onClear}>
            Take back
          </Button>
        )}
      </span>
    );
  }
  if (!suggestion) return null;
  return (
    <SuggestButton
      className="mt-1"
      value={`Twin of row ${suggestion.twinOf}`}
      evidence={suggestion.evidence}
      busy={busy}
      disabled={!editable}
      onAccept={onAccept}
    />
  );
}
