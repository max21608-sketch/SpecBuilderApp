// What a BILL row offers when it is stuck, on the project's Documents tab and
// on the pack screen.
//
// ============================================================================
// A BILL NEVER CALLS /extract.
//
// Both screens gave every failed row the same "Try again", and for a bill it
// posted to /extract — which refuses a bill with `wrong_kind`, because a bill is
// parsed by code and never read by a model. So the one button on a refused
// bill was a second refusal, and the pack's "Retry all failed" stopped at the
// first bill it met. A bill that failed, or that is waiting for somebody to say
// which column is which, gets THIS instead: a link to its own review, where the
// Columns panel and "Read it again" (free, from the stored spreadsheet) live.
//
// A bill uploaded without its original kept cannot be read again at all, and
// says so and asks for the file, rather than offering a re-read that cannot
// happen. A link goes somewhere (`Button.tsx`), so this is a link styled as the
// action it leads to.
// ============================================================================
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";

export type StuckBill = {
  id: string;
  sourceKind: string;
  status: string;
  /** A live sheet nobody has mapped. Absent on a payload that predates it. */
  needsColumns?: boolean | null;
  /** False where the original was not kept. Absent is not false. */
  sourcePreserved?: boolean | null;
};

/** True for a bill row that wants a person rather than a retry. */
export function isStuckBill(run: StuckBill): boolean {
  return run.sourceKind === "boq_xlsx" && (run.status === "failed" || (run.status === "parsed" && run.needsColumns === true));
}

export default function BillColumnsAction({ run }: { run: StuckBill }) {
  if (!isStuckBill(run)) return null;
  if (run.status === "failed" && run.sourcePreserved === false) {
    return (
      <span className="text-right text-[11.5px] text-neutral-600">
        The original was not kept — upload the file again
      </span>
    );
  }
  return (
    <Link href={`/dashboard/imports/${run.id}`} className={buttonClass("secondary", "xs", "no-underline")}>
      Set the columns
    </Link>
  );
}
