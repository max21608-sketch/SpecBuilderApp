export const INTAKE_UPLOAD_ACCEPT = [
  ".pdf",
  ".xlsx",
  ".csv",
  ".tsv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
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

export type IntakeSourceKind = "pdf" | "xlsx" | "csv" | "tsv" | "unsupported";

export function intakeSourceKind(filename: string, contentType = ""): IntakeSourceKind {
  const lower = filename.toLowerCase();
  const type = contentType.toLowerCase().split(";", 1)[0]?.trim();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".tsv")) return "tsv";
  if (/\.[^/]+$/.test(lower)) return "unsupported";
  if (type === "application/pdf") return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (type === "text/csv") return "csv";
  if (type === "text/tab-separated-values") return "tsv";
  return "unsupported";
}

export function defaultIntakeContentType(kind: Exclude<IntakeSourceKind, "unsupported">): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (kind === "csv") return "text/csv";
  return "text/tab-separated-values";
}
