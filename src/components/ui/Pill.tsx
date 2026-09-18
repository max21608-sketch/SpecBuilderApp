// An uppercase state pill: ACTIVE, COMPLETED, ARCHIVED, BASELINE, KEY DATE.
//
// A pill is a STATE — one of a closed set the whole row is in — where a Chip is
// a fact about one cell. Keeping them visually distinct is what lets a reader
// find the state on a row of chips without reading them all.
//
// Which tone a project state gets is decided beside the labels in
// `src/lib/project-completion.ts` (`PROJECT_STATE_TONE`), never here: green
// means SETTLED everywhere in this app, so it belongs to COMPLETED and not to
// ACTIVE, and the two screens that painted it the other way round are why
// this component exists.
import type { ComponentProps } from "react";
import { TONE, type Tone } from "./tone";

export default function Pill({
  tone = "plain",
  className = "",
  children,
  ...rest
}: Omit<ComponentProps<"span">, "children"> & { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase leading-4 tracking-wider ${TONE[tone].pill} ${className}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}
