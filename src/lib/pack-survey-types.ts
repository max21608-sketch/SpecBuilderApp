// What the pack SURVEY says a file holds, and what an answer key says it should.
//
// ============================================================================
// THE CONTRACT BETWEEN THE SURVEY AND ITS EVAL (open-intake plan, Stage 0).
//
// A file is no longer one kind. The survey answers per PART: a page range of a
// PDF, a sheet (or a row range of one) of a workbook, an email's body. Each
// part carries a trade genre from the SAME vocabulary the file check uses
// (`DOCUMENT_GENRES`), so `KIND_FROM_GENRE` stays the one map from what a
// document is to what reads it, and a part is judged right when it lands on
// the right READER, not when it matches a word.
//
// A LEAF: types and pure helpers only. The survey's request lives in
// `pack-survey.ts`, the scorer in `tools/survey-golden.ts`; both import this,
// and neither may make it import a server module (`project-summary-shape.ts`
// is why).
// ============================================================================
import type { DocumentGenre } from "@/lib/document-kinds";

/**
 * Where a part sits in its file. Exactly one shape per part:
 *   { kind: "pages", from, to }   a PDF's pages, 1-based, inclusive
 *   { kind: "sheet", sheet, fromRow?, toRow? }   a workbook sheet by its name,
 *                                  optionally a row range of it, 1-based
 *   { kind: "body" }               an email's own text
 *   { kind: "whole" }              the whole file, where nothing finer applies
 */
export type PartPlace =
  | { kind: "pages"; from: number; to: number }
  | { kind: "sheet"; sheet: string; fromRow?: number | null; toRow?: number | null }
  | { kind: "body" }
  | { kind: "whole" };

/** One part of one file, as the survey read it. */
export type SurveyPart = {
  place: PartPlace;
  genre: DocumentGenre;
  /** False sends the part to a person. Doubt between two genres read the same way is settled by code (`fileDocument`). */
  certain: boolean;
  /** The other genre it was weighed against, when not certain. */
  weighedAgainst: DocumentGenre | null;
  /** What on the part told it, quoted. */
  evidence: string;
  /** Item codes the part names, AS PRINTED ("S-200", "GR / MUR / PL FUR04"). */
  itemCodes: string[];
  /** Finish codes the part names, as printed ("GR TIM 04", "FAB-01"). */
  finishCodes: string[];
  /**
   * True for a part no reader would take anything from: a cover, a title page,
   * an index, a blank page, a workbook's cover sheet. Such a part is NEVER held
   * for a person whatever its genre or certainty says (`partIsHeld`), is never
   * merged into a neighbour, and names no item for the pack pass. Optional so
   * an answer saved before it existed still reads: absent is false.
   */
  nothingToRead?: boolean;
};

/** The survey's answer for one file. */
export type SurveyFile = {
  file: string;
  /** Pages counted off the bytes, null where they could not be (never guessed). */
  pageCount: number | null;
  parts: SurveyPart[];
  /** Anything the survey wanted a person to know about the file as a whole. */
  note: string;
};

/** One part as an answer key states it: where, and what. Codes are the ones a person would expect found. */
export type GoldenPart = {
  place: PartPlace;
  genre: Exclude<DocumentGenre, "unclear">;
  itemCodes?: string[];
  finishCodes?: string[];
};

/** An answer key for one pack. Real packs' keys live OUTSIDE the repo; invented ones may be committed. */
export type SurveyGolden = {
  pack: string;
  /** False until a person has checked it against the files. Only verified keys are a score; drafts are totalled beside. */
  verified: boolean;
  files: { file: string; pageCount: number | null; parts: GoldenPart[] }[];
  /** Which files describe each item, keyed by the item's bill code where there is one. */
  items: { code: string; files: string[] }[];
};
