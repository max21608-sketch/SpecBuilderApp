// A colour per configuration, shared by every card that shows one.
//
// Moved out of `ConfigurationCard` on 2026-09-23 when the card became a tab
// strip and a second card (`NamedConfigurationCard`) needed the same six.
// Written out as literal class strings because Tailwind reads the source, not
// the runtime: an interpolated `bg-${name}-100` is purged and renders as
// nothing at all (`tests/lib/tone.test.ts` holds the same rule for tone.ts).
//
// TWO WAYS TO PICK ONE, AND THE DIFFERENCE IS DELIBERATE.
//
//   A LETTER (`S-201 A`) is coloured by its place in the alphabet, so A is sky
//   on every card and every screen — the spec table's `letterColour` follows
//   the same order, letter for letter.
//   A NAME a document gave (`TYPE 2`) has no place of its own: its first
//   character is the same for all five room types. It is coloured by its
//   INDEX in the code's list, which is what keeps five tabs five colours.

export type ConfigurationColour = { chip: string; band: string; border: string; dot: string };

export const CONFIGURATION_COLOURS: readonly ConfigurationColour[] = [
  { chip: "bg-sky-100 text-sky-900 border-sky-300", band: "bg-sky-50", border: "border-l-sky-400", dot: "bg-sky-500" },
  { chip: "bg-emerald-100 text-emerald-900 border-emerald-300", band: "bg-emerald-50", border: "border-l-emerald-400", dot: "bg-emerald-500" },
  { chip: "bg-violet-100 text-violet-900 border-violet-300", band: "bg-violet-50", border: "border-l-violet-400", dot: "bg-violet-500" },
  { chip: "bg-amber-100 text-amber-900 border-amber-300", band: "bg-amber-50", border: "border-l-amber-400", dot: "bg-amber-500" },
  { chip: "bg-rose-100 text-rose-900 border-rose-300", band: "bg-rose-50", border: "border-l-rose-400", dot: "bg-rose-500" },
  { chip: "bg-teal-100 text-teal-900 border-teal-300", band: "bg-teal-50", border: "border-l-teal-400", dot: "bg-teal-500" },
];

/** By position in a list — a name's colour. Wraps past the sixth. */
export function colourAt(index: number): ConfigurationColour {
  const n = CONFIGURATION_COLOURS.length;
  return CONFIGURATION_COLOURS[((index % n) + n) % n]!;
}

/** By letter — A is always sky. */
export function colourForLetter(letter: string): ConfigurationColour {
  return colourAt(letter.charCodeAt(0) - 65);
}
