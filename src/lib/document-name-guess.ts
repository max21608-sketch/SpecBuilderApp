// What a file's NAME says it is, read before a byte is stored.
//
// ============================================================================
// A GUESS THAT COSTS NOTHING, AND ABSTAINS WHEREVER TWO KINDS ARE POSSIBLE.
//
// Eleven files landed as eleven rows with an unset "What is this?" box and a
// Start intake button below them (FIU 2026-09-22). The press already worked all
// eleven out — it stores each file, asks the model, fills the box in and reads
// it — but what a person MET was eleven questions that looked mandatory. Max:
// "I want it to read first and try and guess what the document is and then give
// you the option to change it … if we have 300 items, someone having to go
// through and do all of that manually is a real pain."
//
// His decision, the same day: a FILENAME rule on drop. The charged model call
// stays behind the press, where the cost statement lives. A name is free to
// read and can fill the boxes in the moment the files land; a model call
// cannot, without moving the sentence that says what the press spends.
//
// SO A NAME SUGGESTS AND NEVER SETTLES. This returns the same vocabulary the
// model's answer is filed in — `KIND_FROM_GENRE`, one table, two readers — and
// the screen flags every answer with what it was read from. Only a person's
// click files it, and only a person's choice lets the press skip the model.
// That is the `level_suggested` rule: the app guesses, shows what it read, and
// a person's action is what writes.
//
// WHERE IT ABSTAINS, IT ABSTAINS OUTRIGHT. `null` is a real answer here and it
// is the cheap one — the file is simply held, which is exactly what the screen
// does today for a document the model cannot settle. Three cases:
//
//   TWO KINDS NAMED. "Finishes and fabric schedule" names two and picks
//   neither. A name has no tie-break in it.
//
//   A BARE "SCHEDULE". It could be FF&E, finishes or fabric, and the classify
//   prompt already guards the asymmetric half of this: a bill read as a
//   schedule is a project's worth of wrong records. A name gets no more licence
//   than the model does.
//
//   A BILL THAT IS NOT A SPREADSHEET. A bill inside a PDF is refused
//   downstream (`BOQ_AS_PDF`), so filling the box with a kind that cannot be
//   registered would put a person one press from a refusal. The model path
//   answers that case with its own sentence; a name says nothing about it.
// ============================================================================
import { KIND_FROM_GENRE, type DocumentGenre, type KindDecision } from "@/lib/document-kinds";

export type NameGuess = {
  /** What the name calls it, in trade terms. */
  genre: Exclude<DocumentGenre, "unclear">;
  /** The same two fields the classify route returns, filed through one table. */
  decision: KindDecision;
  /** What in the name was read, quoted, for the reviewer to check it against. */
  evidence: string;
};

/**
 * A phrase that names a kind. Each regex runs against the filename with its
 * extension removed and underscores turned into spaces — NOT against a fully
 * folded string, so the matched text can be quoted back in the file's own
 * casing, which is the half a person checks against what they are looking at.
 */
const SIGNALS: { genre: Exclude<DocumentGenre, "unclear">; pattern: RegExp }[] = [
  // "BOQ" as a word, or the thing spelled out. Never a bare "bill", which is
  // a word an invoice and a supplier quotation both carry.
  { genre: "bill_of_quantities", pattern: /\bboq\b|\bbills? of quantit\w+\b/i },
  { genre: "shop_drawings", pattern: /\bshop[ -]?drawings?\b/i },
  // The Panther pack's own convention: SPEC-346 is one sheet per item. A bare
  // "spec" is not enough — it is in "spec bible" and in half the folder names
  // in a tender pack — so a number has to follow it.
  { genre: "specification_sheets", pattern: /\bspec(?:ification)?[ -]?\d{2,}\b|\bspec(?:ification)? sheets?\b/i },
  { genre: "preamble", pattern: /\bpreambles?\b/i },
  { genre: "finishes_schedule", pattern: /\bfinish(?:es)?[ -]schedules?\b/i },
  { genre: "fabric_schedule", pattern: /\bfabrics?[ -]schedules?\b/i },
  // "FF&E" on its own names the PACKAGE, the way "Seating" does, and the
  // Panther preamble is called "Argenta FF&E Preamble" — so it only names a
  // document where the word schedule follows it.
  { genre: "ffe_schedule", pattern: /\b(?:ff ?& ?e|ff ?and ?e|ffe)[ -]schedules?\b/i },
  { genre: "specification_bible", pattern: /\b(?:spec(?:ification)?[ -])?bible\b/i },
];

/** A schedule of something this has not been told. On its own, ambiguous. */
const BARE_SCHEDULE = /\bschedules?\b/i;

/** A bill is read out of CELLS, so a name saying bill on anything else abstains. */
const SPREADSHEET = /\.(?:xlsx|csv|tsv)$/i;

/** A saved email, which its extension settles on its own. */
const SAVED_EMAIL = /\.eml$/i;

/** What the name says this document is, or null — which asks a person. */
export function guessKindFromName(filename: string): NameGuess | null {
  const name = filename.trim();
  if (!name) return null;

  // THE EXTENSION DECIDES AN EMAIL, whatever its subject line says. A reply
  // headed "RE: BOQ rev C" is still an email, and the classify route already
  // answers a `.eml` without a model call at all — this is that answer, one
  // screen earlier.
  if (SAVED_EMAIL.test(name)) {
    return { genre: "email", decision: KIND_FROM_GENRE.email, evidence: "The file is a saved email (.eml)." };
  }

  const stem = name.replace(/\.[^.]+$/, "").replace(/_+/g, " ");

  const hits: { genre: Exclude<DocumentGenre, "unclear">; quote: string }[] = [];
  for (const signal of SIGNALS) {
    const found = signal.pattern.exec(stem);
    if (found) hits.push({ genre: signal.genre, quote: found[0] });
  }

  // TWO KINDS IS NO KIND. Deliberately counted over the GENRE rather than over
  // the hits: "SPEC-346" and "specification sheet" in one name are one answer
  // twice, not a disagreement.
  const genres = new Set(hits.map((hit) => hit.genre));
  const genre = hits[0]?.genre;
  if (genres.size !== 1 || !genre) return null;

  // A SCHEDULE NOBODY QUALIFIED. If the word is there and the kind we settled
  // on is not one of the three schedules, the name is describing something this
  // has not read — so it has named two things and only one of them was
  // understood.
  const qualified = genre === "ffe_schedule" || genre === "finishes_schedule" || genre === "fabric_schedule";
  if (!qualified && BARE_SCHEDULE.test(stem)) return null;

  if (genre === "bill_of_quantities" && !SPREADSHEET.test(name)) return null;

  const quotes = Array.from(new Set(hits.map((hit) => hit.quote)));
  return {
    genre,
    decision: KIND_FROM_GENRE[genre],
    evidence: `The name says ${quotes.map((quote) => `“${quote}”`).join(" and ")}.`,
  };
}
