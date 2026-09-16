// A drawing shouts. The screen need not.
//
// ============================================================================
// THIS IS A DISPLAY TRANSFORM AND NOTHING ELSE.
//
// A specification sheet prints its general conditions in capitals — fifteen
// lines of "ALL MATERIALS AND METHODS OF CONSTRUCTION MUST COMPLY WITH ALL
// APPLICABLE INTERNATIONAL, NATIONAL, STATE, LOCAL FIRE & SAFETY CODES" — and
// `mergeNoteBlocks` puts a page's worth of them in one row. Rendered verbatim
// that is a wall nobody reads, which is the same failure as burying the four
// facts on the page: a reviewer who cannot read a note cannot rule on it.
//
// So this softens SHOUTED PROSE for reading. It is never stored, never
// exported, never compared and never sent to BWS: `record_attributes.value`
// keeps exactly what the page said, the review screen's editable box shows
// exactly what the page said, and every screen that softens a note offers
// "as printed" beside it. The rule in CLAUDE.md is retain or flag — this
// retains, and says out loud that it has done something.
//
// TWO LIMITS KEEP IT HONEST.
//
// It only touches a SENTENCE, and a sentence is something with no lower-case
// letter in it that runs to at least six words and thirty letters AND ENDS IN
// A FULL STOP. Capitals are how a drawing writes a value, a name, a code or a
// list — "WOOD", "TO BID", "REFER TO JACQUES GRANGE DRAWINGS", "FINISH SAMPLE,
// FABRIC CUTTING, STRIKE OFF, MOCKUP REVIEW". That last one is long enough to
// pass a length test and is still a column of values, which is why the full
// stop carries the rule: the sheet's conditions all end in one and none of its
// values do. Softening a value would change what reads as a spec.
//
// And it cannot tell a proper noun from a common one, so a name inside a
// shouted sentence does come back lower-cased ("liaise with jacque grange").
// That is the known cost of the transform, it is why the toggle exists, and it
// is why nothing downstream ever sees this output.
// ============================================================================

/**
 * Words that mean something in capitals, kept as printed.
 *
 * Deliberately a SHORT EXPLICIT LIST rather than a rule about length or
 * vowels. "TBC" and "ALL" are both three capital letters, and no rule cleverer
 * than a list tells them apart — a rule that keeps both produces "ALL fabrics
 * are COM", which reads as though the app is shouting at random.
 *
 * Domain vocabulary and standards bodies only. A word goes in here because
 * lower-casing it would change what it means, never because it looks
 * important.
 */
const KEEP_AS_PRINTED = new Set([
  "TBC",
  "TBA",
  "TBD",
  "COM",
  "COL",
  "CFA",
  "FR",
  "NA",
  "BS",
  "EN",
  "ISO",
  "ASTM",
  "CAL",
  "MDF",
  "MFC",
  "PU",
  "PVC",
  "PVA",
  "UV",
  "LED",
  "IP",
  "VE",
  "BOQ",
  "FFE",
  "QTY",
  "MM",
  "CM",
  "KG",
  "RAL",
  "NCS",
  "CNC",
  "MOQ",
  "ETA",
  "FOB",
  "CIF",
  "VAT",
  "UK",
  "USA",
  "EU",
  "XXXXX",
]);

/** At least this many letters, and this many words, before a chunk is prose. */
const MIN_LETTERS = 30;
const MIN_WORDS = 6;

/** Ends like a sentence: terminal punctuation, and any closing quote after it. */
const ENDS_A_SENTENCE = /[.!?]["'\u2019\u201d)]*\s*$/u;

const LETTER = /\p{L}/u;
const LOWER = /\p{Ll}/u;
const TOKEN = /[\p{L}\p{N}'’]+/gu;

/**
 * Is this chunk shouted prose?
 *
 * Long enough to be a sentence, ending like one, and with no lower-case letter
 * in it at all. A single lower-case letter means somebody wrote it in mixed
 * case and the case they chose is theirs.
 */
export function looksShouted(chunk: string): boolean {
  if (LOWER.test(chunk)) return false;
  if (!ENDS_A_SENTENCE.test(chunk)) return false;
  const letters = chunk.match(/\p{L}/gu);
  if (!letters || letters.length < MIN_LETTERS) return false;
  const words = chunk.match(TOKEN);
  return (words?.length ?? 0) >= MIN_WORDS;
}

/** One shouted chunk, in sentence case. */
function softenChunk(chunk: string): string {
  const lowered = chunk.replace(TOKEN, (token) => {
    // A figure or a code carries its own case: 1800, YC04158, S-100's parts.
    if (/\p{N}/u.test(token)) return token;
    if (KEEP_AS_PRINTED.has(token)) return token;
    return token.toLowerCase();
  });
  // The first letter of the chunk, whatever punctuation precedes it.
  return lowered.replace(LETTER, (letter) => letter.toUpperCase());
}

/**
 * The same text, readable, for display only.
 *
 * Works SENTENCE BY SENTENCE and line by line, because a merged note block is
 * routinely half shouted and half not: the Panther bench prints "Area used:
 * Refer to Argenta room by room schedule" beside "MANUFACTURER MUST PROVIDE A
 * STRUCTURALLY SOUND PRODUCT WITH PROPER PROPORTIONS TO ENSURE STABILITY AND
 * PREVENT TIPPING." Judging the whole value at once would either leave the
 * paragraph shouting or rewrite the half somebody had already written properly.
 *
 * Line breaks are preserved exactly: `mergeNoteBlocks` uses them to keep a
 * sheet's lines in printed order, one per line.
 */
export function softenShout(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      // Split AFTER a sentence end, keeping the delimiter and its spacing on
      // the chunk it closes, so rejoining is exact.
      line
        .split(/(?<=[.!?])(\s+)/)
        .map((part) => (looksShouted(part) ? softenChunk(part) : part))
        .join(""),
    )
    .join("\n");
}

/** Whether softening would change anything, so a screen knows to offer the toggle. */
export function isShouted(text: string): boolean {
  return softenShout(text) !== text;
}

// ---- reading a long one ----------------------------------------------------

/**
 * The opening of a long value, for a collapsed row.
 *
 * NOT `-webkit-line-clamp`. The obvious version is a CSS clamp, and it failed
 * silently: `line-clamp-4` needs `display: -webkit-box`, `whitespace-pre-line`
 * needs a block box to honour its newlines, and the `block` utility that gets
 * written alongside it wins — so the clamp computed to `-webkit-line-clamp: 4`
 * on a `display: block` element, which does nothing at all. The row rendered
 * full height and looked exactly like the bug it was fixing.
 *
 * Cutting the STRING cannot fail that way, and it is the same decision in both
 * dimensions: at most `maxLines` of the page's own lines, and at most
 * `maxChars` of text, because one 1,800-character line is as tall as fifteen
 * short ones. The cut lands on a word boundary where there is one nearby.
 *
 * `clamped` is what the screen shows; `wasClamped` is whether to offer the
 * control. Nothing is lost — the full value is one click away, and this is a
 * display helper, never a write.
 */
export function clampText(
  text: string,
  maxLines: number,
  maxChars: number,
): { clamped: string; wasClamped: boolean } {
  const lines = text.split("\n");
  let out = lines.slice(0, maxLines).join("\n");
  let cut = lines.length > maxLines;
  if (out.length > maxChars) {
    const hard = out.slice(0, maxChars);
    // Only back up to a space if one is reasonably close, so a long unbroken
    // code is not thrown away to find one.
    const space = hard.lastIndexOf(" ");
    out = space > maxChars - 40 ? hard.slice(0, space) : hard;
    cut = true;
  }
  return { clamped: cut ? `${out.trimEnd()}…` : text, wasClamped: cut };
}
