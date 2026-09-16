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
//
// ---- AND WHY THE ATOMS COME FROM record-atoms.ts -------------------------
//
// A version snapshot has to hold what a record was, and the only honest
// definition of that is the one the export uses. Both now call
// `loadRecordAtoms`, so a snapshot cannot describe a record differently from
// the file — which is what makes "what changed between these two exports" a
// question with an answer. This function keeps only the part that is genuinely
// about scope: which records are in it.
// ============================================================================
import { sql } from "@/lib/db";
import { exportAnswers, loadRecordAtoms, type RecordAtoms } from "@/lib/record-atoms";
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
  //
  // A RETIRED RUN is out of scope even when its records were somehow left
  // active: the run is the tab a person retired, and an export that still
  // carried it would re-import work the project has moved on from.
  const idRows = await sql`
    select r.id
    from spec_records r
    join spec_runs run on run.id = r.run_id
    where r.project_id = ${projectId}
      and r.status = 'active'
      and run.status = 'active'
      and (${runId}::uuid is null or r.run_id = ${runId}::uuid)
    order by r.record_no
  `;
  const recordIds = idRows.map((row) => String(row.id));
  const atoms = await loadRecordAtoms(sql, recordIds);

  const records: ExportRecord[] = [];
  const attributes: ExportAttribute[] = [];
  const answers: ExportAnswer[] = [];
  for (const id of recordIds) {
    const record = atoms.get(id);
    if (!record) continue;
    records.push(record.record);
    attributes.push(...record.attributes);
    answers.push(...exportAnswers(record));
  }

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

export type { RecordAtoms };
