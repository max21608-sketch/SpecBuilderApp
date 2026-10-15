// Where a value already on a record came from, in the words a reviewer uses.
//
// ============================================================================
// "ANOTHER PAGE" NEVER MEANS THE BILL (2026-10-15, part 2 of the Ronnie
// Scott's call). TB-08's height was "already recorded from another page", and
// the record's dimensions said "and 1 other page", when the other source was
// the BILL — a spreadsheet row, which has no page. Matthew then read the card's
// replace box backwards for eight minutes, because it never said that the
// value it would replace was the bill's. So a source is named for what it is:
//
//   the bill              written by a bill of quantities' own run
//   TB-08.pdf p1          a document, at the page it was read off
//   TB-08.pdf             a document with no page (an email, a schedule)
//   typed by hand         no source run at all (0028)
//
// Pure, a leaf, so the drawings card, the server's warnings and the record
// screen all say the same words for one fact.
// ============================================================================

export type SourceLike = {
  sourceFilename: string | null;
  sourcePage: number | null;
  /** The value was written by a bill of quantities' run. Absent: not known to be the bill's. */
  sourceIsBill?: boolean;
};

/** "the bill", "TB-08.pdf p1", "TB-08.pdf", or "typed by hand". Lower case, to sit inside a sentence. */
export function sourceWords(source: SourceLike): string {
  if (source.sourceIsBill) return "the bill";
  if (source.sourceFilename) return `${source.sourceFilename}${source.sourcePage ? ` p${source.sourcePage}` : ""}`;
  return "typed by hand";
}

/** "The bill says", "TB-08.pdf p1 says", "Typed by hand:" — the head of a sentence quoting the value. */
export function sourceSays(source: SourceLike): string {
  if (source.sourceIsBill) return "The bill says";
  if (source.sourceFilename) return `${sourceWords(source)} says`;
  return "Typed by hand:";
}

/** "from the bill", "from TB-08.pdf p1", or "by hand" — after "Already recorded". */
export function recordedFrom(source: SourceLike): string {
  if (!source.sourceIsBill && !source.sourceFilename) return "by hand";
  return `from ${sourceWords(source)}`;
}
