// Loading what an export is composed from.
//
// ============================================================================
// WHY THIS IS NOT INSIDE THE EXPORT ROUTE ANY MORE.
//
// The export and the CHECK SHEET must describe the same file. They read the
// same scope from the same queries here, so a record the check sheet never
// asked about cannot be a record the export silently shipped — which is the
// only failure mode that would make a signed-off check sheet worthless.
//
// The scope is a whole RUN or a whole PROJECT and is never filtered further.
// That rule is enforced in the routes, where a stray query parameter is a 400;
// this loader simply has nowhere to express a narrower scope.
// ============================================================================
import { sql } from "@/lib/db";
import { isDimensionSlot } from "@/lib/spec-vocab";
import type { AttributeGroup, AttributeState, AttributeUnit } from "@/lib/spec-vocab";
import type { ExportAnswer, ExportAttribute, ExportRecord, ExportScope } from "@/lib/bws-export";

export type LoadedExportScope = {
  projectNumber: string;
  scope: ExportScope;
};

export type ScopeFailure = { error: string; status: 404 };

/**
 * Every active record in scope, with the attributes and confirmed answers that
 * compose its row.
 *
 * Returns a failure rather than throwing, so both routes report "no such
 * project" and "no such run on this project" in the same words.
 */
export async function loadExportScope(projectId: string, runId: string | null): Promise<LoadedExportScope | ScopeFailure> {
  const projects = await sql`select id, bws_project_number, name, client from projects where id = ${projectId}`;
  const project = projects[0];
  if (!project) return { error: "No such project.", status: 404 };

  let runName: string | null = null;
  if (runId) {
    const runs = await sql`select id, name from spec_runs where id = ${runId} and project_id = ${projectId}`;
    if (!runs[0]) return { error: "No such run on this project.", status: 404 };
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
    where r.project_id = ${projectId}
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
        select a.record_id, a.attr_group, a.label, a.value, a.unit, a.dimension_slot, a.material_code, a.state, a.sort_order,
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
    dimensionSlot: isDimensionSlot(row.dimension_slot) ? row.dimension_slot : null,
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

  return {
    projectNumber: String(project.bws_project_number),
    scope: {
      projectName: String(project.name),
      client: project.client === null || project.client === undefined ? null : String(project.client),
      runName,
      records,
      attributes,
      answers,
    },
  };
}

export function isScopeFailure(result: LoadedExportScope | ScopeFailure): result is ScopeFailure {
  return "error" in result;
}
