// The colour language, written once.
//
// ============================================================================
// COLOUR MEANS ONE THING EACH, AND THIS FILE IS WHERE IT MEANS IT.
//
// Before this existed there were eleven class maps and thirty-odd inline pill
// sites saying the same six things in slightly different shades, and two of
// them disagreed outright: the project list painted ACTIVE sky and COMPLETED
// green while the project page painted the same two states the other way
// round, under a comment claiming they matched. Nobody had put the meanings
// anywhere a second screen could read them.
//
// The meanings, settled in the approved mock-ups (18 Sept) and in StatTile:
//
//   danger   RED     blocks money going out — TGQ, a refused confirm, an
//                    export that would wipe fields.
//   warn     AMBER   needs a person. TBC, no category, no level, a held email.
//                    Not an error.
//   info     BLUE    the app is suggesting something, always with its reason,
//                    always one click to accept.
//   good     GREEN   settled. Confirmed, N/A, review complete, a named baseline.
//   guess    YELLOW  a value the app filled in and a person has not confirmed.
//                    A row, never a chip: an amber edge beside it means the row
//                    cannot commit as it stands, and a row can be both.
//   blocked  SLATE   nowhere to record it. Dashed, deliberately not red: the
//                    fix is a seed or a migration, and putting it in the red
//                    list teaches somebody to ignore red.
//   live     SKY     the ordinary working state — an ACTIVE project, and the
//                    letter A of a split bill line.
//   plain    GREY    a count with no judgement attached.
//
// Every slot is a COMPLETE literal class string. Tailwind's JIT reads source
// text for class names and silently purges anything it cannot see, so
// `bg-${tone}-700` compiles to nothing and the screen renders unstyled with
// no error anywhere. `tests/lib/tone.test.ts` asserts no slot interpolates.
//
// The palette is stock Tailwind on purpose. Every colour in the mock-ups is a
// stock shade (#b91c1c is red-700, #15803d green-700, #0369a1 sky-700), so a
// token layer would map names onto names, and this repo has already declined
// a token file once. A map of literals is purge-safe and greppable.
// ============================================================================

export type Tone = "danger" | "warn" | "info" | "good" | "guess" | "blocked" | "live" | "plain";

export const TONES: readonly Tone[] = ["danger", "warn", "info", "good", "guess", "blocked", "live", "plain"];

export type ToneClasses = {
  /** The 3px rule down the left of a StatTile or a card row. */
  edge: string;
  /** A number or word coloured by its meaning, on the page background. */
  text: string;
  /** A small bordered label: `Chip`. */
  chip: string;
  /** An uppercase state pill: `Pill`. */
  pill: string;
  /** A banner: `Note`. */
  note: string;
  /** The count bubble on a tab or a nav item. */
  bubble: string;
  /** A whole table row tinted by what it wants from the reader. */
  row: string;
  /** A solid dot, for a tier marker or a "working" indicator. */
  dot: string;
};

export const TONE: Record<Tone, ToneClasses> = {
  danger: {
    edge: "before:bg-red-600",
    text: "text-red-700",
    chip: "border-red-200 bg-red-50 text-red-700",
    pill: "border-red-200 bg-red-50 text-red-700",
    note: "border-red-200 bg-red-50 text-red-900",
    bubble: "bg-red-700 text-white",
    row: "bg-red-50/60",
    dot: "bg-red-700",
  },
  warn: {
    edge: "before:bg-amber-500",
    text: "text-amber-700",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    pill: "border-amber-200 bg-amber-50 text-amber-800",
    note: "border-amber-200 bg-amber-50 text-amber-900",
    bubble: "bg-amber-100 text-amber-800",
    row: "bg-amber-50/60",
    dot: "bg-amber-500",
  },
  info: {
    edge: "before:bg-blue-600",
    text: "text-blue-700",
    chip: "border-blue-200 bg-blue-50 text-blue-700",
    pill: "border-blue-200 bg-blue-50 text-blue-700",
    note: "border-blue-200 bg-blue-50 text-blue-900",
    bubble: "bg-blue-100 text-blue-700",
    row: "bg-blue-50/60",
    dot: "bg-blue-600",
  },
  good: {
    edge: "before:bg-green-600",
    text: "text-green-700",
    chip: "border-green-200 bg-green-50 text-green-700",
    pill: "border-green-200 bg-green-50 text-green-700",
    note: "border-green-200 bg-green-50 text-green-900",
    bubble: "bg-green-100 text-green-800",
    row: "bg-green-50/60",
    dot: "bg-green-600",
  },
  guess: {
    edge: "before:bg-yellow-400",
    text: "text-yellow-800",
    chip: "border-yellow-300 bg-yellow-100/70 text-yellow-900",
    pill: "border-yellow-300 bg-yellow-100/70 text-yellow-900",
    note: "border-yellow-300 bg-yellow-50 text-yellow-900",
    bubble: "bg-yellow-100 text-yellow-900",
    // `drawing-item-card.test.tsx` pins this exact background: a guessed slot
    // turns the WHOLE line yellow, because an amber border on one select is
    // invisible in a table of twenty-four rows.
    row: "bg-yellow-100/70",
    dot: "bg-yellow-400",
  },
  blocked: {
    edge: "before:bg-slate-300",
    text: "text-slate-600",
    chip: "border-dashed border-slate-300 bg-slate-50 text-slate-600",
    pill: "border-dashed border-slate-300 bg-slate-50 text-slate-600",
    note: "border-dashed border-slate-300 bg-slate-50 text-slate-700",
    bubble: "bg-slate-100 text-slate-600",
    row: "bg-slate-50/60",
    dot: "bg-slate-400",
  },
  live: {
    edge: "before:bg-sky-600",
    text: "text-sky-700",
    chip: "border-sky-200 bg-sky-50 text-sky-700",
    pill: "border-sky-200 bg-sky-50 text-sky-700",
    note: "border-sky-200 bg-sky-50 text-sky-900",
    bubble: "bg-sky-100 text-sky-700",
    row: "bg-sky-50/60",
    dot: "bg-sky-600",
  },
  plain: {
    edge: "before:bg-neutral-300",
    text: "text-neutral-900",
    chip: "border-neutral-200 bg-neutral-50 text-neutral-700",
    pill: "border-neutral-300 bg-neutral-100 text-neutral-600",
    note: "border-neutral-200 bg-white text-neutral-800",
    bubble: "bg-neutral-100 text-neutral-500",
    row: "",
    dot: "bg-neutral-400",
  },
};
