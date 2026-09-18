// A configuration's letter, coloured the way the drawings review colours it.
//
// ============================================================================
// A IS ALWAYS SKY, ON EVERY SCREEN THAT NAMES ONE.
//
// `S-201 A` and `S-201 B` are two chairs to build, and a reviewer matches the
// letter on a card to the row in this table by its colour. If the spec table
// painted B a different colour from the card, the colour would stop being a way
// of finding anything — so the ORDER here is `ConfigurationCard`'s
// `CONFIGURATION_COLOURS`, letter for letter: sky, emerald, violet, amber,
// rose, teal.
//
// It is a copy rather than an import, deliberately and with a cost stated:
// `ConfigurationCard` is the drawings review, which pulls pdfjs and the page
// cropper in behind it, and importing it here would put a PDF rasteriser in the
// spec table's bundle for six class strings. `ChaseQuestionTable` already holds
// a third copy whose order disagrees from B onwards; consolidating all three is
// worth doing and is not this change.
//
// Written out as complete literal strings because Tailwind reads source text:
// an interpolated `text-${name}-700` is purged and renders as nothing at all.
// ============================================================================

const LETTER_TEXT = [
  "text-sky-700",
  "text-emerald-700",
  "text-violet-700",
  "text-amber-700",
  "text-rose-700",
  "text-teal-700",
];

/** The text colour for a configuration letter. Wraps past Z rather than fail. */
export function letterColour(label: string): string {
  const index = label.trim().toUpperCase().charCodeAt(0) - 65;
  if (Number.isNaN(index)) return "text-neutral-700";
  const wrapped = ((index % LETTER_TEXT.length) + LETTER_TEXT.length) % LETTER_TEXT.length;
  return LETTER_TEXT[wrapped]!;
}
