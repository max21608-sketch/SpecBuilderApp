// The one rule this app has about clicking things.
//
// ============================================================================
// A LINK GOES SOMEWHERE. A BUTTON DOES SOMETHING.
//
// Underlined text is navigation: a project, a record, the source PDF a value
// came from. Anything that CHANGES something — start a change, retire this
// run, ignore this line, show the retired records — looks like a button,
// whatever element it happens to be.
//
// It drifted the other way because a low-emphasis action is easy to write as
// underlined text, and the result was that "Start a change", which opens the
// audit trail every edit on the project attaches to, was fainter on the page
// than the link to a spreadsheet. Consequence is not the same as emphasis, but
// a person cannot see the difference between an action and a link if both are
// grey underlined 12px text.
//
// `buttonClass` exists for the cases that MUST stay an anchor — a download is
// an `<a href>` because the browser has to fetch it — so they can look like
// what they are without pretending to be a `<button>`.
//
// THE FOUR VARIANTS GRADE A CONSEQUENCE, WHICH IS WHY THERE IS NO FIFTH. A
// suggestion the app has worked out is not a fifth consequence — it is a
// different kind of thing, and its rule is that it never appears without the
// evidence it was read from. That is `SuggestButton.tsx`: a variant could be
// used with no evidence beside it, a component with a required prop cannot.
// ============================================================================
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export type ButtonSize = "sm" | "xs";

const VARIANTS: Record<ButtonVariant, string> = {
  /** The one thing this screen is for. At most one per group. */
  primary: "bg-neutral-900 text-white border border-neutral-900 hover:bg-neutral-700",
  /** A real action, offered alongside others. */
  secondary: "bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50",
  /** Destroys or overrides something a document said or a person decided. */
  danger: "bg-white text-red-800 border border-red-400 hover:bg-red-50",
  /** Per-row actions in a dense table: Ignore, Restore, Clear. Bordered on
   *  hover only, because forty outlined buttons in a column is its own kind of
   *  unreadable — but it is still a button, and it still has a hit area. */
  quiet:
    "bg-transparent text-neutral-600 border border-transparent hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-sm px-3 py-1.5",
  xs: "text-xs px-2 py-1",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "sm", extra = ""): string {
  return `inline-flex items-center justify-center gap-1 rounded whitespace-nowrap ${SIZES[size]} ${VARIANTS[variant]} disabled:opacity-50 disabled:cursor-not-allowed ${extra}`.trim();
}

export default function Button({
  variant = "secondary",
  size = "sm",
  className = "",
  type = "button",
  ...rest
}: Omit<ComponentProps<"button">, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Layout only — margins and widths. A colour here defeats the point. */
  className?: string;
  type?: "button" | "submit";
}) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
