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
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import {
  composeWorkbook,
  exportFilename,
  toCsv,
  type ExportAnswer,
  type ExportAttribute,
  type ExportRecord,
} from "@/lib/bws-export";
import type { AttributeGroup, AttributeState, AttributeUnit } from "@/lib/spec-vocab";

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
          error: `This export is never filtered — "${key}" is not accepted. A BWS import replaces every field it is given, so a partial export erases what it leaves out. Export a whole run, or the whole project.`,
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

  const projects = await sql`select id, bws_project_number, name, client from projects where id = ${id}`;
  const project = projects[0];
  if (!project) return json({ ok: false, error: "No such project." }, 404);

  let runName: string | null = null;
  if (runId) {
    const runs = await sql`select id, name from spec_runs where id = ${runId} and project_id = ${id}`;
    if (!runs[0]) return json({ ok: false, error: "No such run on this project." }, 404);
    runName = String(runs[0].name);
  }

  // EVERY active record in scope, including ones with nothing on them. A record
  // omitted because it had nothing to say is a record whose BWS fields would be
  // wiped on import.
  const recordRows = await sql`
    select r.id, r.record_no, r.item_description, r.qty, r.area,
           p.bws_project_number, run.name as run_name,
           coalesce((select array_agg(x.ref_value order by x.ref_value)
                       from spec_record_refs x
                      where x.record_id = r.id and x.ref_system = 'boq_code'), '{}') as boq_codes
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    where r.project_id = ${id}
      and r.status = 'active'
      and (${runId}::uuid is null or r.run_id = ${runId}::uuid)
    order by r.record_no
  `;

  const records: ExportRecord[] = recordRows.map((row) => ({
    id: String(row.id),
    recordNo: Number(row.record_no),
    label: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
    itemDescription: String(row.item_description),
    qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
    area: row.area === null || row.area === undefined ? null : String(row.area),
    runName: String(row.run_name),
    boqCodes: (row.boq_codes as string[] | null)?.map(String) ?? [],
  }));

  const recordIds = records.map((record) => record.id);

  const attributeRows = recordIds.length
    ? await sql`
        select a.record_id, a.attr_group, a.label, a.value, a.unit, a.material_code, a.state, a.sort_order,
               a.source_page, f.json_id, at.filename as source_filename
        from record_attributes a
        left join spec_fields f on f.id = a.spec_field_id
        left join intake_runs ir on ir.id = a.source_run_id
        left join attachments at on at.id = ir.attachment_id
        where a.record_id = any(${recordIds}::uuid[]) and a.status = 'active'
        order by a.sort_order, a.created_at
      `
    : [];

  const attributes: ExportAttribute[] = attributeRows.map((row) => ({
    recordId: String(row.record_id),
    attrGroup: String(row.attr_group) as AttributeGroup,
    label: String(row.label),
    value: row.value === null || row.value === undefined ? null : String(row.value),
    unit: row.unit === null || row.unit === undefined ? null : (String(row.unit) as AttributeUnit),
    materialCode: row.material_code === null || row.material_code === undefined ? null : String(row.material_code),
    specFieldJsonId: row.json_id === null || row.json_id === undefined ? null : Number(row.json_id),
    state: String(row.state) as AttributeState,
    sortOrder: Number(row.sort_order),
    sourceFilename: row.source_filename === null || row.source_filename === undefined ? null : String(row.source_filename),
    sourcePage: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
  }));

  // Confirmed cheat-sheet answers that map to a BWS field. `na` is settled but
  // carries no value, and `tbc`/`missing` are not answers to export.
  const answerRows = recordIds.length
    ? await sql`
        select a.record_id, a.value, f.json_id
        from spec_answers a
        join spec_fields f on f.id = a.spec_field_id
        where a.record_id = any(${recordIds}::uuid[]) and a.revision_no = 0 and a.state = 'confirmed'
      `
    : [];

  const answers: ExportAnswer[] = answerRows.map((row) => ({
    recordId: String(row.record_id),
    specFieldJsonId: Number(row.json_id),
    value: row.value === null || row.value === undefined ? null : String(row.value),
  }));

  const workbook = composeWorkbook({
    projectName: String(project.name),
    client: project.client === null || project.client === undefined ? null : String(project.client),
    runName,
    records,
    attributes,
    answers,
  });

  const filename = exportFilename(String(project.bws_project_number), runName, format);
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
