// Guessing an item's level, and saying so.
//
// ============================================================================
// A GUESS IS NOT A LEVEL, AND THIS MODULE NEVER FORGETS IT.
//
// 0019 made `spec_records.level` a person's decision because the quote gate
// reads it: "for a hero sofa, dimensions are needed to price it" is only worth
// anything if somebody decided this line IS a hero sofa. Nothing here writes
// that column. Everything here produces a SUGGESTION, which lands in
// `level_suggested` (0025) and blocks nothing until a person accepts it.
//
// ---- WHERE THE RULES COME FROM, WHICH IS ALMOST NOWHERE -------------------
//
// The 17 cheat sheets were searched on 2026-09-17 and not one of them contains
// the words simple, complex or hero. The only written basis in this repo is
// the BWS boilerplate NAMES -- `.BW-Sofa,Simple-BOILERPLATE`,
// `.BW-Sofa,with-Metalwork-BOILERPLATE`, `.BWCAB-Consoles,-Hero-BOILERPLATE`,
// `.BW-Sofa-with-non-critical--Metalwork-BOILERPLATE` -- and Max's own
// description: "often it'll be to do with metalwork, or it's the complexity of
// the thing". So:
//
//   complex -- metalwork is named. It is what the boilerplate set splits on,
//              across every upholstery category.
//   hero    -- the document says so, in the words a document uses for it.
//   simple  -- nothing said otherwise.
//
// That is the whole model, and it is THIS REPO'S JUDGEMENT rather than
// Matthew's: it belongs beside the question-to-BWS-field mapping on the list
// of things to confirm. Which is also why every guess carries a sentence
// saying what it read -- a reviewer who disagrees can see instantly what to
// disagree with.
//
// ---- WHAT IT DELIBERATELY DOES NOT READ -----------------------------------
//
// THE AREA. `TA_ISG_30_Signature Suites` is a floor in the real pack, and a
// rule reading "Signature" as a level would make every item in that wing a
// hero.
//
// THE PRICE, THE QUANTITY, THE SIZE. A one-off is not a hero and a big sofa is
// not a complex one; both are the kind of plausible-sounding inference that
// turns a guess into a confident mistake.
// ============================================================================
import { normaliseName } from "@/lib/matching";
import { guessNonFurniture } from "@/lib/non-furniture-guess";
import type { ItemLevel } from "@/lib/spec-vocab";

export type LevelGuess = { level: ItemLevel; reason: string } | null;

/** The words a bill or a drawing uses for metal, shared with the callout classifier. */
const METAL_WORDS = ["metal", "metalwork", "brass", "bronze", "steel", "chrome", "nickel", "ironmongery"];

/**
 * A hero is named as one. Narrow on purpose: these are the words a bill and a
 * drawing actually use for the piece a room is designed around.
 */
const HERO_WORDS = ["hero", "feature", "statement", "centrepiece"];

function words(text: string | null | undefined): Set<string> {
  return new Set(normaliseName(text ?? "").split(" ").filter(Boolean));
}

function firstMatch(found: Set<string>, list: string[]): string | null {
  return list.find((word) => found.has(word)) ?? null;
}

/**
 * What a BOQ line looks like, before any drawing has been read.
 *
 * The bill is usually silent about metalwork -- that arrives with the shop
 * drawings -- so `simple` here means "this bill said nothing that suggests
 * otherwise", and the reason says exactly that rather than claiming a finding.
 */
export function guessLevelFromBill(line: {
  itemDescription?: string | null;
  productReference?: string | null;
  boqCategory?: string | null;
  code?: string | null;
  categoryStatus?: string | null;
}): LevelGuess {
  // A LINE THAT MAY NOT BE FURNITURE GETS NO LEVEL.
  //
  // `simple` is this function's answer to "the bill said nothing that suggests
  // otherwise", and a packaging line says nothing about metalwork either — so
  // `PACK-01` came out reading "Simple · guessed", which is the app asserting a
  // complexity for a thing that is not an item. Two suggestions on one row, one
  // of them about whether the row belongs in the bill at all: the cheaper
  // question is answered first, and the level stays blank until it is.
  //
  // It is here rather than at the call site so every caller inherits it, and
  // returning null rather than a level means nothing is stored either.
  if (guessNonFurniture(line)) return null;

  // The line's own description and the client's reference for it. NOT the
  // area, and not the BOQ's category heading, which names furniture types
  // rather than complexity.
  const found = words(`${line.itemDescription ?? ""} ${line.productReference ?? ""}`);

  const hero = firstMatch(found, HERO_WORDS);
  if (hero) return { level: "hero", reason: `the bill calls it "${hero}"` };

  const metal = firstMatch(found, METAL_WORDS);
  if (metal) return { level: "complex", reason: `the bill names ${metal}` };

  return {
    level: "simple",
    reason: "the bill names no metalwork and nothing calls it a hero piece",
  };
}

/**
 * A second look, once a drawing has said what the item is made of.
 *
 * Returns null where the drawings add nothing — the caller then leaves the
 * existing suggestion alone rather than replacing it with one no better. It
 * NEVER returns `simple`: absence of a metal callout on one page is not
 * evidence of simplicity, and overwriting the bill's reading with "the
 * drawings said nothing" would lose the only thing anybody had looked at.
 */
export function guessLevelFromAttributes(
  attributes: { labelRaw?: string | null; valueRaw?: string | null; sourcePage?: number | null }[],
): LevelGuess {
  for (const attribute of attributes) {
    const found = words(`${attribute.labelRaw ?? ""} ${attribute.valueRaw ?? ""}`);
    const hero = firstMatch(found, HERO_WORDS);
    if (hero) return { level: "hero", reason: `a drawing calls it "${hero}"` };
  }
  for (const attribute of attributes) {
    const found = words(`${attribute.labelRaw ?? ""} ${attribute.valueRaw ?? ""}`);
    const metal = firstMatch(found, METAL_WORDS);
    if (metal) {
      const page = attribute.sourcePage ? ` on page ${attribute.sourcePage}` : "";
      return { level: "complex", reason: `a ${metal} callout${page}` };
    }
  }
  return null;
}
