// Setting a bill's columns, and reading a bill again from its stored source.
//
// ============================================================================
// FREE, AND IT WRITES NOTHING BUT THE STAGED BILL.
//
// Every action here re-reads the spreadsheet the run already stored (its
// `attachments` row, through the trusted blob reader — a pathname resolved from
// the RUN, never from the request) and parses it by code. No model is called
// and nothing is charged: a bill has never been read by a model, and a person
// saying which column is which is the opposite of one. What changes is
// `intake_runs.parsed`, the draft the review screen shows; nothing reaches a
// record until the confirm.
//
// Three shapes, told apart by the body:
//
//   { sheetIndex, headerRow, headerRows, columns, version }
//       ONE SHEET, READ WITH THE COLUMNS A PERSON SET. The sheet is re-parsed
//       with exactly that mapping, its lines re-suggested by the same function
//       registration uses (`src/lib/boq-stage.ts`), and it REPLACES the staged
//       sheet — the phase name and the revision choice survive, the per-line
//       choices do not, because the lines are new lines. `mappingSource` is
//       `person`.
//
//   { action: "reread", version }
//       THE WHOLE BILL, READ AGAIN through the registration path's own parser,
//       with today's aliases and layouts. For a run that FAILED — including
//       every bill refused before 0040 — so it recovers without a new upload,
//       and for a v3 run staged before its columns were recorded.
//
//   { action: "checked", sheetIndex, version }
//       The reviewer has looked at the columns and closed the panel. A sheet a
//       saved layout read keeps its panel open until this is set, because a
//       remembered layout must never apply unseen.
//
// Each is FENCED ON THE RUN'S VERSION: a 409 if anything changed the staged bill
// since the screen loaded, because replacing a sheet another tab was editing
// would throw away that edit without anybody seeing it go.
//
// THE BLOB IS READ OUTSIDE THE TRANSACTION. Blob I/O inside one holds the run's
// row lock across a network call to a store in another region; the version
// fence is what makes reading first and locking second safe.
// ============================================================================
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { blobPathname, readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import {
  assertBoqDocument,
  parseBoqSheets,
  readSheetWithColumns,
  sheetWidth,
  BOQ_SCHEMA_VERSION,
  type BoqDocument,
  type StagedBoqSheet,
} from "@/lib/boq-import";
import { columnMappingProblem, isBoqReadRole, type BoqReadRole } from "@/lib/boq-roles";
import { loadBoqReadingRegisters, loadLineSuggester, stageSheet } from "@/lib/boq-stage";

export const maxDuration = 60;

/** The registration route's ceiling for a bill, for the same reason. */
const MAX_BOQ_BYTES = 30 * 1024 * 1024;

const Version = z.number().int().nonnegative();

const SetColumns = z
  .object({
    sheetIndex: z.number().int().nonnegative(),
    headerRow: z.number().int().positive(),
    headerRows: z.union([z.literal(1), z.literal(2)]),
    columns: z.record(z.string(), z.number().int().nonnegative()),
    version: Version,
  })
  .strict();

const Reread = z.object({ action: z.literal("reread"), version: Version }).strict();

const Checked = z
  .object({ action: z.literal("checked"), sheetIndex: z.number().int().nonnegative(), version: Version })
  .strict();

type RunRow = {
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

async function loadRun(id: string): Promise<RunRow | null> {
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
async function readSource(run: RunRow) {
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
async function writeStaged(
  txn: Parameters<Parameters<typeof withTransaction>[0]>[0],
  run: RunRow,
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const run = await loadRun(id);
  if (!run) return json({ ok: false, error: "No such import." }, 404);
  if (run.sourceKind !== "boq_xlsx") {
    return json({ ok: false, code: "wrong_kind", error: "Only a bill of quantities has columns to set." }, 400);
  }

  try {
    const checked = Checked.safeParse(raw);
    if (checked.success) return await markChecked(run, checked.data, user.email);

    const reread = Reread.safeParse(raw);
    if (reread.success) return await readAgain(run, reread.data.version, user.email);

    const set = SetColumns.safeParse(raw);
    if (!set.success) {
      return json({ ok: false, error: set.error.issues[0]?.message ?? "That request is not valid." }, 400);
    }
    return await setColumns(run, set.data, user.email);
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- one sheet, with a person's columns ------------------------------------
async function setColumns(run: RunRow, body: z.infer<typeof SetColumns>, actor: string): Promise<Response> {
  if (run.status !== "parsed") {
    return json({ ok: false, error: `This bill is ${run.status}; its columns can no longer be changed.` }, 409);
  }
  if (run.version !== body.version) {
    throw new DomainConflictError(
      "import_version_stale",
      "Someone else changed this bill while you were looking at it. Reload and check before setting its columns.",
    );
  }
  const staged = assertBoqDocument(run.parsed);
  const current = staged.sheets[body.sheetIndex];
  if (!current) return json({ ok: false, error: "That sheet is not in this bill." }, 400);

  // Roles the panel does not offer are refused, not dropped: a request that
  // named one would otherwise believe it had been read.
  const columns: Partial<Record<BoqReadRole, number>> = {};
  for (const [role, index] of Object.entries(body.columns)) {
    if (!isBoqReadRole(role)) return json({ ok: false, error: `“${role}” is not a column role.` }, 400);
    columns[role] = index;
  }

  const sources = await readSource(run);
  // BY NAME, then by position: the staged sheets are the workbook's sheets in
  // order, but a name is what a person would check, and a CSV's one "sheet"
  // is named after the file.
  const source =
    sources.find((candidate) => candidate.sheet === current.sheetName) ?? sources[body.sheetIndex] ?? null;
  if (!source) {
    return json({ ok: false, error: `The stored file no longer has a sheet called “${current.sheetName}”.` }, 409);
  }

  const problem = columnMappingProblem({
    columns,
    headerRow: body.headerRow,
    headerRows: body.headerRows,
    rowCount: source.data.length,
    width: sheetWidth(source.data),
  });
  if (problem) return json({ ok: false, code: "columns_invalid", error: problem }, 400);

  const parsed = readSheetWithColumns(source.sheet, source.data, {
    headerRow: body.headerRow,
    headerRows: body.headerRows,
    columns,
  });

  const version = await withTransaction(async (txn) => {
    const suggest = await loadLineSuggester(txn);
    const fresh = stageSheet(parsed, suggest);
    // What the reviewer decided about the SHEET survives; what they decided
    // about its lines cannot, because the lines are new. A sheet somebody set
    // columns on is one they mean to import — unless nothing is under the
    // header, which `readRows` still reports as ignored with its reason.
    const replaced: StagedBoqSheet = {
      ...fresh,
      proposedRunName: current.proposedRunName,
      replacesRunId: current.replacesRunId ?? null,
      // A person's columns are seen by definition.
      columnsChecked: true,
    };
    const sheets = staged.sheets.map((sheet, index) => (index === body.sheetIndex ? replaced : sheet));
    return writeStaged(txn, run, body.version, { ...staged, schemaVersion: BOQ_SCHEMA_VERSION, sheets }, actor);
  });

  return json({
    ok: true,
    version,
    lines: parsed.lines.length,
    skippedRows: parsed.skippedRows,
    ignored: parsed.ignored,
  });
}

// ---- the whole bill, again --------------------------------------------------
async function readAgain(run: RunRow, expectedVersion: number, actor: string): Promise<Response> {
  if (run.status !== "failed" && run.status !== "parsed") {
    return json({ ok: false, error: `This bill is ${run.status}; it can no longer be read again.` }, 409);
  }
  if (run.version !== expectedVersion) {
    throw new DomainConflictError(
      "import_version_stale",
      "Someone else changed this bill while you were looking at it. Reload before reading it again.",
    );
  }

  const sources = await readSource(run);
  const version = await withTransaction(async (txn) => {
    const parsed = parseBoqSheets(sources, await loadBoqReadingRegisters(txn));
    if (!parsed.sheets || parsed.sheets.length === 0) {
      throw new DomainConflictError("no_sheets", parsed.ok ? "The file has no sheets." : parsed.error, {
        status: 422,
      });
    }
    const suggest = await loadLineSuggester(txn);
    const sheets = parsed.sheets.map((sheet) => stageSheet(sheet, suggest));
    const doc: BoqDocument = {
      schemaVersion: BOQ_SCHEMA_VERSION,
      filename: run.filename,
      sourcePreserved: true,
      sheets,
    };
    return writeStaged(txn, run, expectedVersion, doc, actor, { fromFailed: true });
  });
  return json({ ok: true, version });
}

// ---- the panel closed -------------------------------------------------------
async function markChecked(run: RunRow, body: z.infer<typeof Checked>, actor: string): Promise<Response> {
  if (run.status !== "parsed") {
    return json({ ok: false, error: `This bill is ${run.status}; nothing on it can change.` }, 409);
  }
  const rows = await sql`
    update intake_runs
    set parsed = jsonb_set(parsed, array['sheets', ${String(body.sheetIndex)}, 'columnsChecked'], 'true'::jsonb),
        updated_by = ${actor}
    where id = ${run.id} and version = ${body.version} and status = 'parsed'
      and parsed->'sheets'->(${body.sheetIndex}::int) is not null
    returning version
  `;
  if (!rows[0]) {
    return json(
      {
        ok: false,
        conflict: true,
        code: "import_version_stale",
        error: "Someone else changed this bill while you were looking at it. Reload and check its columns again.",
      },
      409,
    );
  }
  return json({ ok: true, version: Number(rows[0].version) });
}
