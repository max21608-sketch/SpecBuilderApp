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

export const UPLOAD_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
];

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
