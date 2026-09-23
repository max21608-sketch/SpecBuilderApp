// A bill's intake run, its stored spreadsheet, and the fenced write of its
// staged document — shared by the routes that re-read a bill from its source:
// `/api/imports/[id]/columns` (a person's columns, or the whole bill again) and
// `/api/imports/[id]/suggest-columns` (a model's reading of the layout).
//
// One copy, because the fence is the guarantee: a second copy of `writeStagedBoq`
// that forgot the version predicate would let a model's reading land over a
// person's columns set a moment earlier, with nobody seeing it go. The blob is
// addressed by the RUN's attachment, never by anything a request names.
import { sql } from "@/lib/db";
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { blobPathname, readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import type { BoqDocument } from "@/lib/boq-import";

/** The registration route's ceiling for a bill, for the same reason. */
const MAX_BOQ_BYTES = 30 * 1024 * 1024;

export type BoqRunRow = {
  id: string;
  projectId: string;
  status: string;
  version: number;
  sourceKind: string;
  parsed: unknown;
  storagePath: string | null;
  filename: string | null;
  contentType: string | null;
};

export async function loadBoqRun(id: string): Promise<BoqRunRow | null> {
  const rows = await sql`
    select r.id, r.project_id, r.status, r.version, r.source_kind, r.parsed,
           a.storage_path, a.filename, a.content_type
    from intake_runs r
    left join attachments a on a.id = r.attachment_id
    where r.id = ${id}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    status: String(row.status),
    version: Number(row.version),
    sourceKind: String(row.source_kind),
    parsed: row.parsed ?? null,
    storagePath: row.storage_path === null || row.storage_path === undefined ? null : String(row.storage_path),
    filename: row.filename === null || row.filename === undefined ? null : String(row.filename),
    contentType: row.content_type === null || row.content_type === undefined ? null : String(row.content_type),
  };
}

/**
 * The stored spreadsheet, read and split into sheets. A bill posted straight to
 * the registration route kept no original, and the sentence says so and asks
 * for the file — a re-read that cannot happen must not be offered as one.
 */
export async function readBoqSource(run: BoqRunRow) {
  if (!run.storagePath) {
    throw new DomainConflictError(
      "source_not_kept",
      "The original of this bill was not kept when it was uploaded, so it cannot be read again. Upload the file again.",
      { status: 409 },
    );
  }
  let blob;
  try {
    blob = await readTrustedBlob(blobPathname(run.storagePath), run.projectId, { maxBytes: MAX_BOQ_BYTES });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) {
      throw new DomainConflictError("source_unreadable", cause.message, { status: 409 });
    }
    throw cause;
  }
  const filename = run.filename ?? "bill.xlsx";
  return readSpreadsheetSheets(blob.bytes, filename, blob.contentType || run.contentType || "");
}

/** Write the new staged bill, predicated on the version the screen was shown. */
export async function writeStagedBoq(
  txn: TxnSql,
  run: BoqRunRow,
  expectedVersion: number,
  doc: BoqDocument,
  actor: string,
  options: { fromFailed?: boolean } = {},
): Promise<number> {
  const rows = await txn`
    update intake_runs
    set parsed = ${JSON.stringify(doc)}::jsonb,
        status = 'parsed',
        -- A run read again from FAILED loses the refusal it carried; one that
        -- was already parsed has no error to keep.
        error = case when ${Boolean(options.fromFailed)}::boolean then null else error end,
        updated_by = ${actor}
    where id = ${run.id} and version = ${expectedVersion}
      and status = any(${options.fromFailed ? ["failed", "parsed"] : ["parsed"]}::text[])
    returning version
  `;
  if (!rows[0]) {
    throw new DomainConflictError(
      "import_version_stale",
      "Someone else changed this bill while you were looking at it. Reload and check before setting its columns.",
    );
  }
  return Number(rows[0].version);
}

