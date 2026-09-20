// The export check sheet — the file a human marks up to accept the export.
//
// ============================================================================
// IT REFUSES TO BE FILTERED, exactly as the export does.
//
// The check sheet's whole value is that signing it off means the file was
// read. A sheet that quietly covered a subset — the populated cells, one
// category, the records somebody changed today — would be signed off in the
// same words and mean nothing. So the scope is a whole RUN or a whole PROJECT,
// it is loaded by the same `loadExportScope` the export uses, and an
// unrecognised query parameter is a 400 rather than something ignored.
//
// It is NOT the export and must never be mistaken for it: the filename says
// "export check sheet", the columns are the reviewer's, and three of them are
// empty for a person to fill in by hand.
// ============================================================================
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { toCsv } from "@/lib/bws-export";
import { loadExportScope, isScopeFailure } from "@/lib/export-scope";
import { composeCheckSheet, checkSheetFilename, CHECK_SHEET_VERDICTS } from "@/lib/export-check-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_PARAMS = new Set(["runId", "format"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) {
      return json(
        {
          ok: false,
          error: `The check sheet is never filtered — "${key}" is not accepted. Signing off a sheet that covered only part of the export would say the file was read when it was not. Take a whole phase, or the whole project.`,
        },
        400,
      );
    }
  }

  const runId = url.searchParams.get("runId");
  const format = url.searchParams.get("format") ?? "xlsx";
  if (format !== "xlsx" && format !== "csv") {
    return json({ ok: false, error: 'format must be "xlsx" or "csv".' }, 400);
  }

  const loaded = await loadExportScope(id, runId);
  if (isScopeFailure(loaded)) return json({ ok: false, error: loaded.error }, loaded.status);

  const sheet = composeCheckSheet(loaded.scope);
  const filename = checkSheetFilename(loaded.projectNumber, loaded.scope.runName, format);
  const headers = {
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store",
    "x-check-sheet-records": String(loaded.scope.records.length),
    "x-check-sheet-rows": String(sheet.rows.length),
    "x-export-scope": runId ? "run" : "project",
  };

  if (format === "csv") {
    return new Response(toCsv([sheet.header, ...sheet.rows]), {
      headers: { ...headers, "content-type": "text/csv; charset=utf-8" },
    });
  }

  // Imported here, not at module scope: exceljs is a large server-only
  // dependency and no other route needs it loaded.
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  book.creator = "Project Spec Builder";
  book.created = new Date();

  const worksheet = book.addWorksheet("Check sheet");
  worksheet.addRow(sheet.header);
  for (const row of sheet.rows) worksheet.addRow(row);
  worksheet.getRow(1).font = { bold: true };
  // A Panther run is around 4,800 lines. Without a frozen header and a filter
  // this is a sheet nobody finishes.
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.header.length } };

  // The Verdict vocabulary, offered as a dropdown rather than left to memory:
  // free-typed verdicts cannot be counted, and "looks fine" is not a result.
  const verdictColumn = sheet.header.indexOf("Verdict") + 1;
  for (let row = 2; row <= sheet.rows.length + 1; row += 1) {
    worksheet.getCell(row, verdictColumn).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${CHECK_SHEET_VERDICTS.join(",")}"`],
    };
  }

  const buffer = await book.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      ...headers,
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
