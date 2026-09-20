// The BWS job-spec export.
//
// ============================================================================
// THIS ROUTE REFUSES TO BE FILTERED.
//
// A BWS import REPLACES a job's fields; it does not merge. So an export that
// omits a record, or a column, silently wipes what it left out — which makes
// "just export the ones that changed" the single most dangerous feature anybody
// could add here. The scope is a whole RUN or a whole PROJECT, and any query
// parameter this route does not recognise is a 400 rather than something it
// quietly ignores. Enforcing it in the route is the point: a rule that lives
// only in a comment is one the next caller has already broken.
//
// It is a REVIEW FILE, not an import file. It carries no Id and no Job Number,
// because this app has never had BWS access and does not know them. BWS stays
// read/download only, forever.
// ============================================================================
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { composeWorkbook, exportFilename, toCsv } from "@/lib/bws-export";
import { loadExportScope, isScopeFailure } from "@/lib/export-scope";

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
          error: `This export is never filtered — "${key}" is not accepted. A BWS import replaces every field it is given, so a partial export erases what it leaves out. Export a whole phase, or the whole project.`,
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

  // The same loader the check sheet uses, so the file a reviewer signs off and
  // the file that goes to BWS cannot describe different sets of records.
  const loaded = await loadExportScope(id, runId);
  if (isScopeFailure(loaded)) return json({ ok: false, error: loaded.error }, loaded.status);
  const { scope } = loaded;
  const records = scope.records;

  const workbook = composeWorkbook(scope);

  const filename = exportFilename(loaded.projectNumber, scope.runName, format);
  const headers = {
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store",
    "x-export-records": String(records.length),
    "x-export-scope": runId ? "run" : "project",
  };

  if (format === "csv") {
    const csv = toCsv([workbook.jobs.headerNames, workbook.jobs.headerIds, ...workbook.jobs.rows]);
    return new Response(csv, { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
  }

  // Imported here, not at module scope: exceljs is a large server-only
  // dependency and no other route needs it loaded.
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  book.creator = "Project Spec Builder";
  book.created = new Date();

  const jobs = book.addWorksheet("Jobs");
  jobs.addRow(workbook.jobs.headerNames);
  jobs.addRow(workbook.jobs.headerIds);
  for (const row of workbook.jobs.rows) jobs.addRow(row);
  jobs.getRow(1).font = { bold: true };
  jobs.views = [{ state: "frozen", ySplit: 2 }];

  // The second sheet exists because flattening 56 columns loses what did not
  // fit: the client's own material code, the page a value came from, the second
  // and third dimensions that composed into one cell.
  const specs = book.addWorksheet("Specs");
  specs.addRow(workbook.specs.header);
  for (const row of workbook.specs.rows) specs.addRow(row);
  specs.getRow(1).font = { bold: true };

  const buffer = await book.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      ...headers,
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
