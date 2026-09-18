// The costing sheet's item block — the third of Matthew's three outputs.
//
// ============================================================================
// TEN COLUMNS OF EIGHTY-THREE, AND THE RESPONSE SAYS WHY.
//
// A-J of `Estimating Sheet Template - with stone.xlsx` identify the item;
// K rightwards is the estimator's own work and this app holds no rate, no
// labour model and no exchange rate to fill any of it. See
// `src/lib/costing-sheet.ts` for the argument against emitting all 83.
//
// It shares `loadExportScope` with the BWS file, the check sheet and the quote
// — so a costing sheet cannot cover a different set of records from the file
// that will be imported — and nothing else.
//
// The xlsx is the default because two of the ten columns cannot survive a csv:
// a hyperlink and a picture. The csv is offered for anyone who wants the text.
// ============================================================================
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { loadExportScope, isScopeFailure } from "@/lib/export-scope";
import { composeCostingSheet, costingRowCells, type CostingSource } from "@/lib/costing-sheet";
import { toCsv, exportFilename } from "@/lib/bws-export";
import { blobPathname, readTrustedBlob } from "@/lib/blob-source";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_PARAMS = new Set(["runId", "format"]);

/** A crop off a drawing page. Anything larger is not an item picture. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** The whole workbook's picture budget, so one project cannot exhaust the function's memory. */
const IMAGE_BUDGET_BYTES = 24 * 1024 * 1024;
/** Blob reads in flight. Six matches the browser's own connection limit and keeps the store happy. */
const IMAGE_CONCURRENCY = 6;

const IMAGE_EXTENSIONS: Record<string, "png" | "jpeg" | "gif"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) {
      return json({ ok: false, error: `"${key}" is not accepted. Cost a whole run, or the whole project.` }, 400);
    }
  }
  const runId = url.searchParams.get("runId");
  const format = url.searchParams.get("format") ?? "xlsx";
  if (format !== "xlsx" && format !== "csv" && format !== "json") {
    return json({ ok: false, error: 'format must be "xlsx", "csv" or "json".' }, 400);
  }

  const loaded = await loadExportScope(id, runId);
  if (isScopeFailure(loaded)) return json({ ok: false, error: loaded.error }, loaded.status);
  const { scope } = loaded;
  const ids = scope.records.map((record) => record.id);

  // The internal note, which the 109-column grid has no home for and the
  // costing sheet's Comments column does.
  const extras = ids.length
    ? await sql`select id, internal_notes from spec_records where id = any(${ids}::uuid[])`
    : [];
  const notesById = new Map(extras.map((row) => [String(row.id), row.internal_notes as string | null]));

  // ---- WHICH DOCUMENT AND PAGE TO LINK -------------------------------------
  //
  // Counted rather than picked: the (document, page) that accounts for most of
  // what the record knows is the one an estimator would open first. The run id
  // is read here rather than added to `ExportAttribute`, because that shape is
  // what `record_snapshots` stores — widening it would change what every
  // future version holds for a link this file needs and nothing else does.
  const sourceRows = ids.length
    ? await sql`
        select a.record_id, a.source_run_id, a.source_page, at.filename, count(*)::int as weight
        from record_attributes a
        join intake_runs ir on ir.id = a.source_run_id
        join attachments at on at.id = ir.attachment_id
        where a.record_id = any(${ids}::uuid[])
          and a.status = 'active'
          and a.source_run_id is not null
        group by a.record_id, a.source_run_id, a.source_page, at.filename
      `
    : [];
  const sourcesByRecord = new Map<string, CostingSource[]>();
  for (const row of sourceRows) {
    const key = String(row.record_id);
    const list = sourcesByRecord.get(key) ?? [];
    list.push({
      runId: String(row.source_run_id),
      filename: String(row.filename ?? "document"),
      page: row.source_page === null ? null : Number(row.source_page),
      weight: Number(row.weight),
    });
    sourcesByRecord.set(key, list);
  }

  // The item pictures, resolved from each record's OWN attachment row — the
  // client names a project and nothing else, the `blob-source.ts` discipline.
  const imageRows = ids.length
    ? await sql`
        select distinct on (r.id) r.id, r.project_id, a.storage_path, a.content_type
        from spec_records r
        join attachments a
          on a.entity_type = 'spec_records' and a.entity_id = r.id and a.kind = 'item_image'
        where r.id = any(${ids}::uuid[])
        order by r.id, a.created_at desc
      `
    : [];
  const imageRecordIds = new Set(imageRows.map((row) => String(row.id)));

  const sheet = composeCostingSheet(
    {
      ...scope,
      records: scope.records.map((record) => ({
        ...record,
        internalNotes: notesById.get(record.id) ?? null,
      })),
    },
    { origin: url.origin, sourcesByRecord, imageRecordIds },
  );

  if (format === "json") {
    return json({ ok: true, ...sheet, records: sheet.rows.length });
  }

  const filename = exportFilename(
    `${loaded.projectNumber} costing`,
    scope.runName,
    format === "csv" ? "csv" : "xlsx",
  );
  const headers = {
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store",
    "x-costing-records": String(sheet.rows.length),
    "x-costing-notes": String(sheet.notes.length),
  };

  if (format === "csv") {
    const csv = toCsv([sheet.header, ...sheet.rows.map(costingRowCells)]);
    return new Response(csv, { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
  }

  // Loaded here and not at module scope: exceljs is a large server-only
  // dependency, exactly as the BWS export route has it.
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  book.creator = "Project Spec Builder";
  book.created = new Date();

  const ws = book.addWorksheet("Estimating sheet");
  ws.addRow(sheet.header);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.columns = [
    { width: 26 },
    { width: 3 },
    { width: 26 },
    { width: 24 },
    { width: 16 },
    { width: 28 },
    { width: 7 },
    { width: 16 },
    { width: 34 },
    { width: 34 },
  ];

  for (const row of sheet.rows) {
    const cells = costingRowCells(row);
    const added = ws.addRow(cells);
    // A link is a link: the text says which document and page, the href opens
    // it there. The csv had to settle for the bare URL.
    if (row.specs) added.getCell(1).value = { text: row.specs.text, hyperlink: row.specs.href };
    if (row.specs2) added.getCell(3).value = { text: row.specs2.text, hyperlink: row.specs2.href };
    added.getCell(9).alignment = { wrapText: true, vertical: "top" };
    added.getCell(10).alignment = { wrapText: true, vertical: "top" };
  }

  // ---- THE PICTURES --------------------------------------------------------
  //
  // Fetched with a budget and bounded concurrency, and a failure to read one
  // is a missing picture rather than a failed export: an estimator who cannot
  // see the chair can still price the row, and a 500 here would lose the nine
  // columns that did compose.
  let embedded = 0;
  let failed = 0;
  let spent = 0;
  const withImages = sheet.rows.map((row, index) => ({ row, excelRow: index + 2 })).filter((entry) => entry.row.hasImage);
  const byRecord = new Map(imageRows.map((row) => [String(row.id), row]));

  for (let start = 0; start < withImages.length; start += IMAGE_CONCURRENCY) {
    const batch = withImages.slice(start, start + IMAGE_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (entry) => {
        if (spent >= IMAGE_BUDGET_BYTES) return null;
        const source = byRecord.get(entry.row.recordId);
        if (!source) return null;
        const extension = IMAGE_EXTENSIONS[String(source.content_type ?? "").toLowerCase()];
        if (!extension) return null;
        try {
          const blob = await readTrustedBlob(blobPathname(String(source.storage_path)), String(source.project_id), {
            maxBytes: MAX_IMAGE_BYTES,
          });
          spent += blob.bytes.byteLength;
          return { entry, buffer: blob.bytes, extension };
        } catch {
          failed += 1;
          return null;
        }
      }),
    );

    for (const got of fetched) {
      if (!got) continue;
      // base64 rather than the buffer: exceljs's own `Image.buffer` is typed
      // against an older Buffer than the one Node hands back, and the string
      // form is the branch of that union with no version skew in it.
      const imageId = book.addImage({ base64: got.buffer.toString("base64"), extension: got.extension });
      ws.addImage(imageId, {
        tl: { col: 7, row: got.entry.excelRow - 1 },
        ext: { width: 104, height: 78 },
        editAs: "oneCell",
      });
      ws.getRow(got.entry.excelRow).height = 62;
      embedded += 1;
    }
  }

  const notes = [...sheet.notes];
  if (embedded > 0) notes.push(`${embedded} item picture${embedded === 1 ? "" : "s"} embedded in column H.`);
  if (failed > 0) {
    notes.push(`${failed} picture${failed === 1 ? "" : "s"} could not be read from the store and ${failed === 1 ? "its row is" : "their rows are"} blank in column H.`);
  }

  // The notes go IN the file, on their own sheet. A caveat that lives only on
  // the screen that produced the download is a caveat nobody reads at the
  // moment it matters — which is when somebody opens the workbook next week
  // and wonders why column K is empty.
  const about = book.addWorksheet("About this file");
  about.getColumn(1).width = 120;
  about.addRow(["This is the ITEM BLOCK (columns A-J) of the estimating sheet, not the whole sheet."]);
  about.getRow(1).font = { bold: true };
  about.addRow([]);
  for (const note of notes) about.addRow([note]);
  about.eachRow((row) => {
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
  });

  const buffer = await book.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      ...headers,
      "x-costing-images": String(embedded),
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
