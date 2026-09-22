export const INTAKE_UPLOAD_ACCEPT = [
  ".pdf",
  ".xlsx",
  ".csv",
  ".tsv",
  ".eml",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
  "message/rfc822",
].join(",");

// What the upload token will sign for. Note that `INTAKE_UPLOAD_ACCEPT` above
// is the file picker's filter and this is the SERVER's rule -- they are not the
// same list and must not be merged.
//
// `image/png` is here for a reason worth stating, because it is a change of
// kind rather than one more document format. Every other entry is a file a
// CLIENT sent us, uploaded whole and preserved so a value can be traced back to
// it. A PNG is DERIVED: a crop of one of those documents, rendered and encoded
// by the reviewer's own browser, uploaded as a new object. The source PDF is
// still kept, so the crop can always be re-made, and the pathname scoping in
// blob-source.ts applies to it unchanged -- but "the store holds only what a
// client sent us" stopped being true when this line was added.
//
// It is deliberately NOT in INTAKE_UPLOAD_ACCEPT: nobody picks a PNG off their
// disk as an intake document. It is only ever written by the review screen.
export const UPLOAD_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
  "image/png",
  // EVIDENCE: the email that asked for a change, attached to a change set.
  //
  // `message/rfc822` is a saved .eml. `application/vnd.ms-outlook` is a .msg,
  // which is binary OLE and which nothing in this app parses — the link on a
  // change DOWNLOADS it and it opens in Outlook. An Outlook drag-out often
  // arrives with an empty or generic type, which is why the last two are here;
  // the file is never executed, never rendered and never sniffed (the read
  // route sets nosniff and content-disposition: attachment).
  "message/rfc822",
  "application/vnd.ms-outlook",
  "application/octet-stream",
  "image/jpeg",
];

/** What a browser may attach as evidence. Checked by extension, server-side. */
export const EVIDENCE_EXTENSIONS = [".eml", ".msg", ".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".csv", ".txt"];

export function isEvidenceFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return EVIDENCE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Where an item image lives, under the project's own prefix. */
export function itemImagePath(projectId: string, recordScopedName: string): string {
  return `projects/${projectId}/item-images/${recordScopedName}.png`;
}

export type IntakeSourceKind = "pdf" | "xlsx" | "csv" | "tsv" | "eml" | "unsupported";

export function intakeSourceKind(filename: string, contentType = ""): IntakeSourceKind {
  const lower = filename.toLowerCase();
  const type = contentType.toLowerCase().split(";", 1)[0]?.trim();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".tsv")) return "tsv";
  // A saved email. `.msg` is deliberately NOT here: it is binary OLE, nothing
  // in this app parses it, and a .msg reaching the model would be read as
  // gibberish at full price. It stays accepted as EVIDENCE, which only ever
  // downloads.
  if (lower.endsWith(".eml")) return "eml";
  if (/\.[^/]+$/.test(lower)) return "unsupported";
  if (type === "application/pdf") return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (type === "text/csv") return "csv";
  if (type === "text/tab-separated-values") return "tsv";
  if (type === "message/rfc822") return "eml";
  return "unsupported";
}

// ============================================================================
// A BILL IS READ FROM A SPREADSHEET, AND `.xls` IS NOT ONE OF THEM.
//
// MEASURED, 2026-09-21 (variance matrix §6.10.a row 5). `.csv` and `.tsv`
// PROCEED — `readSpreadsheetSheets` parses both and `parseBoqSheets` reads the
// result, quantities and all — and `.xls`, `.xlsb`, `.xlsm`, `.ods` and
// `.numbers` all come back `unsupported`, so the bill is refused. That refusal
// was true and useless: "is not a supported file" does not say that saving the
// same bill as .xlsx would work, which is a ten-second fix on the client's own
// machine.
//
// The wording lives HERE, beside `intakeSourceKind`, because three places need
// the same sentence: the two BOQ registration branches, the classify route, and
// the upload screen — which checks it in the browser so a file nobody can read
// is never stored at all.
// ============================================================================

/** What a bill of quantities can be read from. The file picker's own list. */
export const SPREADSHEET_EXTENSIONS = [".xlsx", ".csv", ".tsv"];

/**
 * Spreadsheet formats this app does not read, and the way out of each.
 *
 * Deliberately an explicit list rather than "anything not in
 * SPREADSHEET_EXTENSIONS": a `.pdf` bill is a different answer (§6.10.a row 8
 * — export it to Excel, and nothing here will read a PDF as a grid whatever it
 * is renamed to), and a `.docx` is not a bill at all. Advice that fits every
 * wrong file fits none of them.
 */
const LEGACY_SPREADSHEETS: Record<string, string> = {
  ".xls": "an older Excel format",
  ".xlsb": "Excel's binary format",
  ".xlsm": "a macro-enabled Excel file",
  ".ods": "an OpenDocument spreadsheet",
  ".numbers": "an Apple Numbers file",
};

/**
 * Null unless this is an Outlook `.msg`, which is not an intake document.
 *
 * ============================================================================
 * THE FILE PICKER'S FILTER IS NOT A CHECK, AND DRAG-DROP PROVES IT.
 *
 * `INTAKE_UPLOAD_ACCEPT` lists `.eml` and not `.msg`, which is the picker's
 * suggestion and nothing more: a file DROPPED on the zone never went through
 * it, and `UPLOAD_CONTENT_TYPES` admits `application/vnd.ms-outlook` because a
 * `.msg` is a legitimate piece of EVIDENCE on a change set. So a dropped `.msg`
 * was uploaded to the project's own blob prefix and only then refused by the
 * route — no charge and no run, but a stray blob nobody asked for.
 *
 * The sentence lives here, beside `spreadsheetRefusal`, for the reason stated
 * above it: the route and the upload screen must say the SAME thing, and two
 * copies of a refusal is how they start disagreeing about what is allowed.
 * The route is still the guarantee; the screen is what stops the byte.
 * ============================================================================
 */
export function outlookMsgAdvice(filename: string): string | null {
  if (!filename.toLowerCase().endsWith(".msg")) return null;
  return (
    `“${filename}” is not an email this app can read. In Outlook, save it as .eml (File → Save As) — ` +
    "Outlook's .msg is a binary the app does not read."
  );
}

/**
 * Why the BROWSER should not store this file at all, or null.
 *
 * One function so the drop zone and the file picker refuse the same set. It is
 * deliberately narrow — a format this app has MEASURED that it cannot read, with
 * the way out in the sentence — and it is never the guarantee: every one of
 * these is refused again by the route, which is where the rule actually lives.
 */
export function unreadableUploadAdvice(filename: string): string | null {
  return legacySpreadsheetAdvice(filename) ?? outlookMsgAdvice(filename);
}

/** Null unless this filename is a spreadsheet format nothing here reads. */
export function legacySpreadsheetAdvice(filename: string): string | null {
  const lower = filename.toLowerCase();
  const found = Object.entries(LEGACY_SPREADSHEETS).find(([extension]) => lower.endsWith(extension));
  if (!found) return null;
  const [extension, description] = found;
  return (
    `“${filename}” is ${description} (${extension}), which this app does not read. ` +
    "Open it and Save As .xlsx — or export the bill as .csv, which is read just as well."
  );
}

/** Why this file cannot be a bill of quantities, in the words a person needs. */
export function spreadsheetRefusal(filename: string, kind: IntakeSourceKind): string {
  const advice = legacySpreadsheetAdvice(filename);
  if (advice) return advice;
  const what = kind === "unsupported" ? "not a supported file" : `a .${kind} file`;
  return (
    `A bill of quantities is read from a spreadsheet (${SPREADSHEET_EXTENSIONS.join(", ")}). ` +
    `“${filename}” is ${what}.`
  );
}

export function defaultIntakeContentType(kind: Exclude<IntakeSourceKind, "unsupported">): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (kind === "csv") return "text/csv";
  if (kind === "eml") return "message/rfc822";
  return "text/tab-separated-values";
}
