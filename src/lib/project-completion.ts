// Whether a project's specifications are all in.
//
// ============================================================================
// COMPLETED IS COMPUTED, NEVER STORED — and there is no button.
//
// Asked for directly on 2026-09-17: "when all the specs are in, every single
// spec that we could need, it just becomes completed". So there is no
// `mark as complete` beside Archive, because a state somebody has to remember
// to set is a state that is wrong most of the time.
//
// It is derived for the same reason Overdue and Waiting are: a stored flag
// would have to be written when an answer changed, and writing it bumps the
// version M2's extraction snapshots and the chase coverage rows are taken
// against — for a reason that has nothing to do with the answer. See the
// `chased_at` trap in CLAUDE.md.
//
// ---- WHAT COUNTS, AND WHY EACH CLAUSE IS THERE ---------------------------
//
// THE EXPORT'S SCOPE, not every row. Active records on active runs, with a
// bill line that has been split excluded because its configurations are what
// ships (0024). The predicate is duplicated from `src/lib/export-scope.ts`
// because the driver has no way to share a SQL fragment — so
// `tests/db/project-completion.test.ts` asserts the two agree on a real
// project. A pill saying COMPLETED over a different set of records from the
// file would be the check sheet's own failure mode, worn as a badge.
//
// EVERY QUESTION, spec_field and readiness alike. Max's rule is "every single
// spec that we could need", and a record whose BWS fields are all confirmed
// but whose deposit is unresolved is not a finished job.
//
// A MISSING ANSWER ROW IS MISSING, which is why this drives off `requirements`
// with a LEFT JOIN rather than off the answers.
//
// TBC BLOCKS IT. "Not yet decided" is an answer, and a distinct state from
// settled — the invariant the whole gate model rests on.
//
// AN UNCATEGORISED RECORD BLOCKS IT, and this is the clause most easily left
// out. A record with no category has NO questions, so it scores 0 outstanding
// and would drag a project to COMPLETED by having been ignored. Nobody has
// even decided what to ask about it.
//
// ZERO RECORDS IS NOT COMPLETE. An empty project is one nobody has started,
// and a 0/0 score rendering green is the same error as an empty programme
// reading as a healthy one.
// ============================================================================
import { sql } from "@/lib/db";

export type ProjectCompletion = {
  /** Records in the export's scope. */
  records: number;
  /** Of those, how many nobody has categorised. Each one blocks completion. */
  uncategorised: number;
  /** Questions still missing or TBC across those records. */
  outstanding: number;
  complete: boolean;
};

export const EMPTY_COMPLETION: ProjectCompletion = {
  records: 0,
  uncategorised: 0,
  outstanding: 0,
  complete: false,
};

/** Archived is a separate axis from finished, but one pill has to say both. */
export type ProjectState = "archived" | "completed" | "active";

export const PROJECT_STATE_LABELS: Record<ProjectState, string> = {
  archived: "ARCHIVED",
  completed: "COMPLETED",
  active: "ACTIVE",
};

/**
 * Which colour each state wears, decided ONCE beside the labels.
 *
 * Green is SETTLED in this app's colour language, everywhere — a confirmed
 * answer, a satisfied gate, a finished review — so it belongs to COMPLETED.
 * ACTIVE is merely where most projects live, and gets the working-state sky.
 * The list and the project page each held their own copy of this map and had
 * them the other way round from each other, under a comment claiming parity.
 * A `Tone` name rather than a class string, so the pill component owns the
 * shades and this file owns only the meaning.
 */
export const PROJECT_STATE_TONE: Record<ProjectState, "live" | "good" | "plain"> = {
  active: "live",
  completed: "good",
  archived: "plain",
};

export function projectState(status: string | null | undefined, completion: ProjectCompletion | null): ProjectState {
  // Archived wins: a project put away is put away whether or not its
  // specifications were ever finished, and saying COMPLETED over it would
  // claim something nobody checked.
  if (status === "archived") return "archived";
  return completion?.complete ? "completed" : "active";
}

/**
 * Why a project is not complete, in words a person can act on.
 *
 * Null when it IS complete. A pill with no explanation is a pill nobody
 * trusts, and "active" is the state that needs the explaining.
 */
export function completionSentence(completion: ProjectCompletion | null): string | null {
  if (!completion) return null;
  if (completion.complete) return null;
  if (completion.records === 0) return "No records yet — nothing has been imported.";
  const parts: string[] = [];
  if (completion.outstanding > 0) {
    parts.push(
      `${completion.outstanding} question${completion.outstanding === 1 ? "" : "s"} still missing or TBC`,
    );
  }
  if (completion.uncategorised > 0) {
    parts.push(
      `${completion.uncategorised} record${completion.uncategorised === 1 ? "" : "s"} with no category, so nobody has decided what to ask`,
    );
  }
  if (parts.length === 0) return null;
  return `${parts.join(", and ")}.`;
}

/**
 * The completion of several projects at once, in ONE query.
 *
 * Taking the list a project at a time would be a query per row of the projects
 * screen. Projects with no records in scope are absent from the result, and
 * `EMPTY_COMPLETION` is the honest reading of that.
 */
export async function loadProjectCompletion(projectIds: string[]): Promise<Map<string, ProjectCompletion>> {
  const out = new Map<string, ProjectCompletion>();
  if (projectIds.length === 0) return out;

  const rows = await sql`
    with scoped as (
      select r.id, r.project_id, r.category_id
      from spec_records r
      join spec_runs run on run.id = r.run_id
      where r.project_id = any(${projectIds}::uuid[])
        and r.status = 'active'
        and run.status = 'active'
        -- A bill line with a live configuration is a heading; the
        -- configurations are the jobs. Same correlated not-exists as
        -- loadExportScope, for the same reason: retire them and it is an item
        -- again.
        and not exists (
          select 1 from spec_records v
          where v.parent_id = r.id and v.status = 'active'
        )
    ),
    counts as (
      select s.project_id,
             count(*)::int as records,
             count(*) filter (where s.category_id is null)::int as uncategorised
      from scoped s
      group by s.project_id
    ),
    outstanding as (
      select s.project_id, count(*)::int as outstanding
      from scoped s
      join requirements q on q.category_id = s.category_id
      left join spec_answers a
        on a.record_id = s.id and a.requirement_id = q.id and a.revision_no = 0
      -- No answer row at all is MISSING, not satisfied. 'na' and 'confirmed'
      -- are the two settled states; everything else is outstanding.
      where a.id is null or a.state in ('missing', 'tbc')
      group by s.project_id
    )
    select c.project_id, c.records, c.uncategorised, coalesce(o.outstanding, 0)::int as outstanding
    from counts c
    left join outstanding o on o.project_id = c.project_id
  `;

  for (const row of rows) {
    const records = Number(row.records);
    const uncategorised = Number(row.uncategorised);
    const outstanding = Number(row.outstanding);
    out.set(String(row.project_id), {
      records,
      uncategorised,
      outstanding,
      complete: records > 0 && uncategorised === 0 && outstanding === 0,
    });
  }
  return out;
}
