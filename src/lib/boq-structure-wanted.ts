// Which sheets of a bill the model is asked to read AUTOMATICALLY.
//
// A leaf: the review page (a client component) and the suggest-columns route
// both call it, so the sheet the screen asks about and the sheet the route reads
// cannot differ.
//
// Two cases, each read once per sheet and never again:
//
//   * NOBODY COULD MAP IT (`needsColumns`) — the original rule.
//   * THE KNOWN HEADINGS MAPPED IT BUT FOUND NO QUANTITY. Found 2026-10-15 on
//     the Ronnie Scott's procurement schedule (LBPCo): "FF&E CODE",
//     "DESCRIPTION" and "UOM" are known headings, "ORDER QTY" is not, so the
//     sheet read as mapped, every line said "quantity not given", and each COM
//     line under its item was staged as an item of its own. Nothing asked for
//     a look, and the model's read — which mapped all eighteen columns and put
//     all thirteen COM lines under their items — sat behind a button inside a
//     closed panel. Only a sheet the SYNONYMS read qualifies: a person's or a
//     layout's mapping without a quantity is a decision, and a model's has
//     already been asked.
import type { StagedBoqSheet } from "./boq-import";

export function sheetWantsStructureRead(
  sheet: Pick<StagedBoqSheet, "needsColumns" | "ignored" | "mappingSource" | "columns" | "sheetName">,
  alreadyRead: boolean,
): boolean {
  if (sheet.ignored || alreadyRead) return false;
  if (sheet.needsColumns) return true;
  return sheet.mappingSource === "synonym" && !sheet.columns?.qty;
}
