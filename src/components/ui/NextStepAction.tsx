// The next step, as one control, rendered identically wherever it appears.
//
// ============================================================================
// ONE COMPONENT, SO FOUR SCREENS CANNOT SAY IT DIFFERENTLY.
//
// `nextStep()` decides WHAT comes next; this decides how it looks, and every
// screen a person is on during an intake uses both. A screen writing its own
// version is how "Open the project page" and "Review 14 items" came to sit in
// the same slot on two screens, saying different amounts.
//
// IT IS A LINK WEARING A BUTTON. `Button.tsx`'s rule cuts both ways: this goes
// somewhere, so it is an `<a>`, and `buttonClass` exists exactly so navigation
// that carries a screen's whole purpose can look like it without pretending to
// be a `<button>`.
//
// A PENDING STEP IS NEVER THE PRIMARY. "Reading 3 documents…" is the true
// answer to what happens next and nobody is wanted for it; rendering it as the
// one emphatic control on the screen teaches people that the emphatic control
// sometimes does nothing.
// ============================================================================
import Link from "next/link";
import { buttonClass, type ButtonSize } from "@/components/ui/Button";
import type { NextStep, NextStepKind } from "@/lib/next-step";

export default function NextStepAction({
  step,
  size = "sm",
  suppress,
}: {
  step: NextStep | null;
  size?: ButtonSize;
  /**
   * Kinds this screen already carries its own control for. The project
   * overview passes `export`, because the export cluster is in the same header
   * band and two primaries in one band is what the design language forbids.
   */
  suppress?: NextStepKind[];
}) {
  if (!step) return null;
  if (suppress?.includes(step.kind)) return null;
  return (
    <Link
      href={step.href}
      className={buttonClass(step.pending ? "secondary" : "primary", size, "no-underline")}
      aria-disabled={step.pending || undefined}
    >
      {step.label}
    </Link>
  );
}
