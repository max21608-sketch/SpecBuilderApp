// A banner across the content: something the reader has to know before they
// use the screen under it.
//
// Its tone is the house reading — red for a blocker on money going out, amber
// for something a person has to decide, blue for a suggestion or a rule worth
// knowing, green for a finished state. It is NOT a place for standing
// explanation: a note that is on the page every visit is read once and then
// becomes furniture, which is the job `Tip` took over. A Note earns its place
// by being conditional — it appears because of the data, and goes when the
// data changes.
//
// `role="alert"` only for danger: an alert is announced immediately by a
// screen reader, and announcing an advisory that way trains people to dismiss
// the one that matters.
import { TONE, type Tone } from "./tone";

export default function Note({
  tone = "info",
  title,
  actions,
  className = "",
  children,
}: {
  tone?: Tone;
  /** Bold lead-in, in the same line as the body. */
  title?: React.ReactNode;
  /** Buttons at the right. The rule that goes with the note, one click away. */
  actions?: React.ReactNode;
  /** Layout only. */
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-5 ${TONE[tone].note} ${className}`.trim()}
    >
      <div className="min-w-0 flex-1">
        {title && <b className="font-semibold">{title}</b>}
        {title && children ? " " : null}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
