// A small bordered label: a state, a code, a count, a signal.
//
// It is the one shape for "a word in a box" so that TBC, `UPH-07`, "Review
// complete" and "auto · sender is a contact" are recognisably the same kind of
// thing on every screen, and so that the colour is the house reading from
// `tone.ts` rather than whichever shade the last screen happened to pick.
//
// `mono` is for a code or a value the reader may have to copy or check against
// a page; prose labels stay in the body font.
import type { ComponentProps } from "react";
import { TONE, type Tone } from "./tone";

export default function Chip({
  tone = "plain",
  mono = false,
  dot = false,
  className = "",
  children,
  ...rest
}: Omit<ComponentProps<"span">, "children"> & {
  tone?: Tone;
  mono?: boolean;
  /** A solid dot before the text, for "working" or a tier. */
  dot?: boolean;
  /** Layout only. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-[11.5px] leading-5 ${TONE[tone].chip} ${
        mono ? "font-mono" : ""
      } ${className}`.trim()}
      {...rest}
    >
      {dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[tone].dot}`} />}
      {children}
    </span>
  );
}
