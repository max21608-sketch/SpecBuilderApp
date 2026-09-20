// What one intake document's state is, on its own row.
//
// ============================================================================
// TWO STATES AND A COUNT, NEVER A TICK — found-in-use 4.
//
// Matthew, on the pack screen: "so it's ticked because you've opened it." He
// was reading it correctly. "Opened" is recorded nowhere in this app, so the
// screen cannot report it and must not invent a third state; what it CAN report
// is how much is still outstanding, and that is what makes *Ready to review*
// mean something. A document somebody opened, ruled on half of and left reads
// "6 to review", which is a different sentence from "12 to review" and from
// "Review complete".
//
// `documentReviewLabel` is the single reading, so the chip and anything else
// that describes a document's state cannot disagree — and it deliberately lets
// a pending count OVERRIDE a confirmed status, because a tick over outstanding
// proposals is the exact defect this exists to prevent.
//
// The failure's own words stay under the chip: "Failed" says a retry is wanted,
// and only the message says whether the retry has any chance of behaving
// differently.
// ============================================================================
import Chip from "@/components/ui/Chip";
import {
  documentReviewLabel,
  documentReviewTone,
  isIntakeRunWorking,
  type ReviewProgress,
} from "@/lib/intake-status";

export default function DocumentState({
  run,
  /** A queued run whose dispatch is uncertain is not "working"; it is stuck. */
  uncertain = false,
}: {
  run: ReviewProgress & { error?: string | null };
  uncertain?: boolean;
}) {
  return (
    <>
      <Chip tone={documentReviewTone(run)} dot={isIntakeRunWorking(run.status) && !uncertain}>
        {documentReviewLabel(run)}
      </Chip>
      {run.error && <span className="mt-1 block text-xs text-neutral-500">{run.error}</span>}
    </>
  );
}
