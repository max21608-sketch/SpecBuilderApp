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

/**
 * Why no file can be composed, in words, with the status the routes return.
 *
 * 409 rather than 404 for a RETIRED phase: the phase is there, and saying "no
 * such phase" about one somebody retired last week would send them looking for
 * a typo in a link that is perfectly correct.
 */
export type ScopeFailure = { error: string; status: 404 | 409 };

/**
 * Every active record in scope, with the attributes and confirmed answers that
 * compose its row.
 *
 * Returns a failure rather than throwing, so both routes report "no such
 * project" and "no such phase on this project" in the same words.
 */
export async function loadExportScope(projectId: string, runId: string | null): Promise<LoadedExportScope | ScopeFailure> {
  const projects = await sql`select id, bws_project_number, name, client from projects where id = ${projectId}`;
  const project = projects[0];
  if (!project) return { error: "No such project.", status: 404 };

  let runName: string | null = null;
  if (runId) {
    const runs = await sql`select id, name, status from spec_runs where id = ${runId} and project_id = ${projectId}`;
    if (!runs[0]) return { error: "No such phase on this project.", status: 404 };
    // A RETIRED PHASE PRODUCES NO FILE AT ALL — variance matrix row d5.
    //
    // The records query below requires an ACTIVE run, so a retired phase used
    // to compose cleanly: a workbook with a header row, no records, and the
    // phase's own name in the filename. That is the most dangerous empty file
    // in the product. A BWS import REPLACES what it is given rather than
    // merging, so a download that looks like the phase it names and carries
    // none of its items is one upload away from wiping the fields of every job
    // in the set — the filtered-export trap with the filter set to everything.
    //
    // Refused HERE rather than in the four routes, because all of them — the
    // BWS file, the check sheet, the quote and the costing sheet — read this
    // loader, and each would otherwise need its own copy of the rule. The
    // whole-project export is untouched: a retired phase simply has no active
    // records, and leaving it out of that file is correct.
    if (String(runs[0].status) !== "active") {
      return {
        error:
          "That phase has been retired, so there is nothing to export for it. A file naming a retired phase and carrying none of its items would erase every BWS field in the set if anybody imported it. Un-retire the phase, or export a live one, or take the whole project.",
        status: 409,
      };
    }
    runName = String(runs[0].name);
  }

  // EVERY active record in scope, including ones with nothing on them. A record
  // omitted because it had nothing to say is a record whose BWS fields would be
  // wiped on import.
  //
  // A RETIRED RUN is out of scope even when its records were somehow left
  // active: the run is the tab a person retired, and an export that still
  // carried it would re-import work the project has moved on from.
  //
  // ---- AND A BILL LINE THAT HAS BEEN SPLIT IS A HEADING ---------------------
  //
  // S-201 is one bill line, 45 off, drawn in two fabrics. 0024 makes those two
  // child records — S-201 A and S-201 B — and THEY are the jobs. The parent
  // stops being exported, because a BWS import replaces rather than merges and
  // three rows for one bill line reads as three items to make.
  //
  // `status = 'active'` on the variant is the whole subtlety, and it is why
  // this is a correlated EXISTS rather than a column on the parent. Retire both
  // variants and the parent is an item again: it is still a line on the bill,
  // and a file that omitted it would wipe every BWS field it holds. A stored
  // "has been split" flag would be wrong the moment somebody retired one.
  //
  // The variants themselves need no clause: they are active records on the
  // same run and arrive through the ordinary predicate.
  const idRows = await sql`
    select r.id
    from spec_records r
    join spec_runs run on run.id = r.run_id
    where r.project_id = ${projectId}
      and r.status = 'active'
      and run.status = 'active'
      and (${runId}::uuid is null or r.run_id = ${runId}::uuid)
      and not exists (
        select 1 from spec_records v
        where v.parent_id = r.id and v.status = 'active'
      )
    -- BILL ORDER, each configuration under its line (0039), so every file that
    -- reads this scope lists 12.1 to 12.5 after line 12 rather than at the
    -- end. Order changes nothing about what a BWS import replaces: every
    -- record is still in scope, and BWS keys a row by its job.
    order by coalesce((select p2.record_no from spec_records p2 where p2.id = r.parent_id), r.record_no),
             r.variant_ordinal nulls first,
             r.record_no
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
