// The export check sheet: the file a human marks up to accept the export.
//
// ============================================================================
// WHAT THIS IS FOR.
//
// M8 is done when the BWS-layout export is "judged flawless by a human, read
// line by line against the pack". That sentence had no artefact behind it. The
// export is 109 columns wide and composed from three places, so checking it off
// the screen means holding a record's row, its drawing page and its BOQ line in
// your head at once — which is how the easy cells get checked and the rest get
// skimmed.
//
// This turns the row back into one line per field, each naming the document and
// page it came from, and leaves three empty columns for the reviewer. An empty
// Verdict column is the point: a check that cannot fail is not a check, and a
// sheet that arrived pre-answered would be a record of the app agreeing with
// itself.
//
// IT IS NEVER FILTERED, for the same reason the export is not.
//
// A blank cell is the failure mode most worth catching — the pack states a
// finish and the file does not carry it — so a check sheet that listed only the
// populated cells could not find the thing it exists to find. Every field of
// every record in scope gets a line. The exceptions are the 27 job columns that
// are blank BY DESIGN because they hold BWS-owned vocabularies this app has
// never known; listing those would put 27 unanswerable questions in front of a
// reviewer for every record, which is how a sheet teaches people to tick
// without reading.
//
// IT IS NOT THE EXPORT, and must never be mistaken for it. Different filename,
// different columns, and it carries the reviewer's own words in three columns
// no importer would accept.
// ============================================================================
import {
  BWS_EXPORT_COLUMNS,
  composeRowCells,
  type CellSource,
  type ExportScope,
} from "@/lib/bws-export";

/**
 * Spreadsheet column letter from position — A, Z, AA, DE.
 *
 * Derived from the index in the static column list and nowhere else. The
 * letter is positional: it is what a reviewer reads across the top of the
 * export, and it shifts the moment BWS inserts a column, which is exactly why
 * `spec_fields.column_letter` is never joined on.
 */
export function columnLetter(index: number): string {
  let letters = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
  }
  return letters;
}

export const CHECK_SHEET_HEADER = [
  "Record",
  "Client code",
  "Item",
  "Phase",
  "Column",
  "BWS field",
  "Field id",
  "Exported value",
  // THE PLACEMENT HALF, SHOWN APART FROM THE VALUE (0029). The exported cell
  // joins them — "Yarn Tessarae YC04158 - Main body and self pipe" — and a
  // reviewer checking it against a page has to be able to tell which half the
  // document actually said. It is a COPY of what is already inside Exported
  // value, not an extra field to sign off.
  "Qualifier",
  "Came from",
  "Source document",
  "Page",
  // The reviewer's three. Left empty on purpose.
  "Pack says",
  "Verdict",
  "Note",
];

/** The words a reviewer may put in the Verdict column. Defined in docs/plans/export-verification.md. */
export const CHECK_SHEET_VERDICTS = ["ok", "wrong", "missing", "extra", "unit", "unsure"] as const;

/** Plain words, because the reader is a KAM and not this repo. */
function cameFrom(source: CellSource): string {
  switch (source.kind) {
    case "attribute":
    case "dimensions":
      return "Document";
    case "answer":
      return "Checklist";
    case "record":
      return "BOQ line";
    case "project":
      return "Project";
    default:
      return "";
  }
}

/**
 * Which pages to go and open.
 *
 * A dimensions cell is composed from up to five attributes and they need not
 * share a document: a sofa whose height arrived on S-100 and whose seat height
 * arrived on S-101 sends the reviewer to both. Listing one of them would send
 * them to check a figure that is not on the page they were given.
 */
function sourceDocuments(source: CellSource): { documents: string; pages: string } {
  const contributing =
    source.kind === "attribute" ? [source.attribute] : source.kind === "dimensions" ? source.attributes : [];
  const documents = [...new Set(contributing.map((a) => a.sourceFilename).filter((f): f is string => !!f))];
  const pages = [...new Set(contributing.map((a) => a.sourcePage).filter((p): p is number => p !== null))];
  return { documents: documents.join(", "), pages: pages.sort((a, b) => a - b).join(", ") };
}

export type CheckSheet = { header: string[]; rows: string[][] };

/**
 * One line per record × field, in the export's own column order.
 *
 * The order matters: a reviewer who finds a wrong cell here needs to point at
 * it in the export, and a check sheet sorted by anything else (populated first,
 * by document, by confidence) makes that a search rather than a glance.
 */
export function composeCheckSheet(scope: ExportScope): CheckSheet {
  const rows: string[][] = [];

  for (const record of [...scope.records].sort((a, b) => a.recordNo - b.recordNo)) {
    const cells = composeRowCells(scope, record, scope.attributes, scope.answers);
    for (const [index, column] of BWS_EXPORT_COLUMNS.entries()) {
      // `composeRowCells` maps over the same list, so the lengths match by
      // construction; the compiler cannot see that.
      const cell = cells[index];
      if (!cell) continue;
      // Blank by design, and not this app's to fill. See the header.
      if (cell.source.kind === "bws") continue;
      const { documents, pages } = sourceDocuments(cell.source);
      rows.push([
        record.label,
        record.boqCodes.join(", "),
        record.itemDescription,
        record.runName,
        columnLetter(index),
        column.name.trim(),
        column.jsonId === null ? "" : String(column.jsonId),
        cell.value,
        cell.qualifier ?? "",
        cameFrom(cell.source),
        documents,
        pages,
        "",
        "",
        "",
      ]);
    }
  }

  return { header: CHECK_SHEET_HEADER, rows };
}

/** Allowlisted the same way the export filename is, and deliberately unmistakable for it. */
export function checkSheetFilename(projectNumber: string, runName: string | null, extension: string): string {
  const safe = (raw: string) => raw.replace(/[^A-Za-z0-9 &-]/g, "").slice(0, 60).trim();
  const scope = runName ? ` - ${safe(runName)}` : "";
  return `${safe(projectNumber) || "export"}${scope} - export check sheet.${extension}`;
}
