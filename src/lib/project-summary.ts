// What a project is short of, in the numbers a KAM actually acts on.
//
// ============================================================================
// WHY THIS IS NOT `loadProjectCompletion` WITH MORE COLUMNS
//
// `project-completion.ts` answers ONE question — is this project finished —
// and the pill on two screens is derived from it. It is deliberately small and
// its clauses are asserted against `loadExportScope` by a db-tier test. This
// answers a different question: what is stopping a quotation going out today,
// and what would somebody click to fix it.
//
// They share the SCOPE and nothing else, which is the part that must not drift:
// active records on active runs, a split bill line counted through its
// configurations. A summary describing a different set of records from the file
// is the check sheet's own failure mode worn as a badge, so the predicate is
// duplicated the way `project-completion.ts` duplicates it — the driver has no
// way to share a SQL fragment — and `tests/db/project-summary.test.ts` asserts
// the two agree on a real project.
//
// ---- TO QUOTE IS `tgq_levels`, NOT THE TGQ GATE, AND THEY DISAGREE ---------
//
// There are two models in this database answering "does this block a quote":
//
//   `requirements.tgq_levels` (0019), per question and per LEVEL. Seeded with
//   all three levels on all 728 rows — today's position, everything required of
//   everything — pending Matthew's workbook. It drives the chase tiers, the
//   email's red banner and the spec table's column, so it is what this counts.
//
//   `spec_field_gates` where gate = 'TGQ' (0026), Matthew's written matrix: 35
//   fields across three gates for nine seating categories. It drives the record
//   screen's gate panel.
//
// They are the same question with two answers, and until his workbook comes
// back they will not agree. Max's decision on 2026-09-18 was to keep both,
// call the thing TGQ on screen, and SHOW THE GAP where it appears rather than
// quietly picking one — see `docs/plans/matrix-assumptions.md`. Merging them is
// a re-seed plus a migration, not a screen change, and it would move every
// number on every screen before anybody has confirmed the assumptions behind
// it.
//
// ---- A LEVEL IS REQUIRED BEFORE ANYTHING IS TIERED -------------------------
//
// `questionTier` refuses a null level and `questionTierOrNull` returns null
// rather than picking a reading, because "needed at any level" makes a
// level-less record look urgent and "needed at none" makes it look quotable.
// The SQL follows it: a record with no level contributes NOTHING to `toQuote`
// and is counted in `noLevel` instead. That is why the screen has to print
// `noLevel` beside `toQuote` — the first is the reason the second is an
// undercount, and a to-quote figure with nine silent absentees behind it is
// worse than no figure.
// ============================================================================
import { sql } from "@/lib/db";

export type ProjectSummary = {
  /** Records in the export's scope. */
  records: number;
  /** Of those, how many nobody has categorised. Each has NO questions at all. */
  uncategorised: number;
  /** Of those, how many have no level — so none of their questions is tiered. */
  noLevel: number;
  /** How many of THOSE carry a suggestion waiting to be accepted. */
  levelSuggested: number;
  /** Outstanding questions that block a quote at their record's level. */
  toQuote: number;
  /** Outstanding, not blocking a quote. Split, because they are different jobs. */
  missing: number;
  tbc: number;
  /** Confirmed or not-applicable. */
  settled: number;
  /**
   * THE SAME THREE THINGS IN LINE ITEMS, WHICH IS THE UNIT A PERSON THINKS IN.
   *
   * Asked for on 2026-09-21 on a 503-line project, where the tiles read TGQ
   * 8,769 and Also outstanding 10,841: "these numbers are so high, they're
   * just meaningless." The question counts stay, because a sub-line saying how
   * many questions are behind an item count is worth having; what changed is
   * which number is the big one.
   *
   * TWO THINGS ABOUT THEM A SCREEN MUST SAY OUT LOUD.
   *
   * They do NOT sum. Every answer is exactly one of to-quote /
   * also-outstanding / settled, so `toQuote + missing + tbc + settled` is the
   * whole of the work; an ITEM can be clear at TGQ and still carry other
   * questions, so it is counted by two tiles at once. `settledItems` is
   * therefore "nothing outstanding at all" and is much smaller than `settled`
   * suggests.
   *
   * They are over a DIFFERENT POPULATION from `records`. An uncategorised
   * record has no questions at all, so it appears in none of them:
   * `itemsWithQuestions` is that population, and `records - uncategorised` is
   * what it is short of. Printing an item count beside `records` without
   * naming which is how somebody subtracts one from the other.
   */
  itemsWithQuestions: number;
  toQuoteItems: number;
  alsoOutstandingItems: number;
  settledItems: number;
  /** Finish codes in the project's library. */
  finishes: number;
  /** Of those, how many nobody has filed under a kind. */
  finishesNoKind: number;
  /** Documents still being read, and documents whose read failed. */
  documentsReading: number;
  documentsFailed: number;
  /**
   * How many records in scope get their TGQ from MATTHEW'S MATRIX, and how many
   * fall back to the 0019 placeholder.
   *
   * The two models are both called TGQ and only one of them is a measurement.
   * Where his matrix covers the category, `toQuote` counts the fields he
   * actually named. Where it does not — the eight cabinetry sheets, until he
   * writes that half — it falls back to `tgq_levels`, which is still seeded
   * with all three levels on all 728 questions, so every outstanding question
   * on those records counts as blocking.
   *
   * The screen has to be able to say which. A project whose items are all in
   * his matrix has a real number; one with cabinetry in it has a real number
   * for part of itself and a placeholder for the rest, and printing the total
   * in red without saying so is the confidently-wrong figure this app exists to
   * avoid. Both of these go to zero effort when the cabinetry matrix arrives:
   * it is a seed, and nothing here changes.
   */
  tgqFromMatrix: number;
  tgqFromFallback: number;
};

export const EMPTY_SUMMARY: ProjectSummary = {
  records: 0,
  uncategorised: 0,
  noLevel: 0,
  levelSuggested: 0,
  toQuote: 0,
  missing: 0,
  tbc: 0,
  settled: 0,
  itemsWithQuestions: 0,
  toQuoteItems: 0,
  alsoOutstandingItems: 0,
  settledItems: 0,
  finishes: 0,
  finishesNoKind: 0,
  documentsReading: 0,
  documentsFailed: 0,
  tgqFromMatrix: 0,
  tgqFromFallback: 0,
};

/**
 * The summary for SEVERAL projects in one query.
 *
 * The projects list needs the same TGQ figure the overview shows, and a query
 * per row would be one per project. More to the point, a second SQL expression
 * of the TGQ rule is a third place for it to drift — `loadOutstanding` already
 * computes it in TypeScript and this file already re-expresses it once because
 * the driver cannot share a fragment. Once is the budget.
 *
 * Projects with no records in scope are ABSENT from the result, and
 * `EMPTY_SUMMARY` is the honest reading of that — the same contract
 * `loadProjectCompletion` has.
 */
export async function loadProjectSummaries(projectIds: string[]): Promise<Map<string, ProjectSummary>> {
  const out = new Map<string, ProjectSummary>();
  if (projectIds.length === 0) return out;
  for (const row of await summaryRows(projectIds)) {
    out.set(String(row.project_id), toSummary(row));
  }
  return out;
}

export async function loadProjectSummary(projectId: string): Promise<ProjectSummary> {
  const rows = await summaryRows([projectId]);
  const row = rows[0];
  return row ? toSummary(row) : EMPTY_SUMMARY;
}

type SummaryRow = Record<string, unknown>;

async function summaryRows(projectIds: string[]): Promise<SummaryRow[]> {
  return await sql`
    with scoped as (
      -- THE EXPORT'S SCOPE. Duplicated from loadExportScope, asserted equal by
      -- a db-tier test: a summary over a different set of records from the file
      -- is worse than no summary.
      select r.id, r.project_id, r.category_id, r.level, r.level_suggested
      from spec_records r
      join spec_runs run on run.id = r.run_id
      where r.project_id = any(${projectIds}::uuid[])
        and r.status = 'active'
        and run.status = 'active'
        and not exists (
          select 1 from spec_records v
          where v.parent_id = r.id and v.status = 'active'
        )
    ),
    -- MATTHEW'S TGQ SET, per cheat-sheet category. The join is the union rule
    -- loadGateContext uses: our sheet receives a field if ANY of his categories
    -- mapped to it carries that field.
    tgq_map as (
      select m.item_category_id, f.json_id, g.local_key
        from spec_matrix_category_map m
        join spec_field_gates g on g.applies_to && array[m.matrix_code] and g.gate = 'TGQ'
        left join spec_fields f on f.id = g.spec_field_id
    ),
    -- Which categories he has WRITTEN. Presence here is the discriminator, and
    -- it is deliberately not "has a TGQ row": a category he covered where
    -- nothing happens to be at TGQ is a real answer, and a different one from a
    -- category he has never written.
    mapped_cats as (select distinct item_category_id from spec_matrix_category_map),
    answers as (
      select s.project_id,
             -- The RECORD this answer belongs to. Carried so the same pass can
             -- count both units: a question count partitions, an item count
             -- does not. See the item columns further down this query.
             s.id as record_id,
             -- No answer row at all is MISSING, not satisfied, which is why
             -- this drives off the requirements table with a left join.
             -- (No backticks in here: one closes the tagged template.)
             coalesce(a.state, 'missing') as state,
             -- THE SAME RULE AS questionTier, IN SQL. His matrix where he wrote
             -- one for the category, the 0019 placeholder where he did not --
             -- never "nothing blocks a quote", which is what an unmapped
             -- category would compute as if this defaulted to false.
             case
               when s.category_id in (select item_category_id from mapped_cats) then
                 exists (
                   select 1 from tgq_map t
                    where t.item_category_id = s.category_id
                      and (t.json_id = f.json_id or t.local_key = q.local_key)
                 )
               else
                 s.level is not null and q.tgq_levels @> array[s.level]::text[]
             end as to_quote
      from scoped s
      join requirements q on q.category_id = s.category_id
      left join spec_fields f on f.id = q.spec_field_id
      left join spec_answers a
        on a.record_id = s.id and a.requirement_id = q.id and a.revision_no = 0
    ),
    rec as (
      select project_id,
             count(*)::int as records,
             count(*) filter (where category_id is null)::int as uncategorised,
             count(*) filter (where level is null)::int as no_level,
             count(*) filter (where level is null and level_suggested is not null)::int as level_suggested,
             -- Which model is deciding TGQ, counted over the records it decides
             -- for. Uncategorised records are in NEITHER: they have no questions
             -- at all and are reported on their own row, so counting them as
             -- fallback would blame the gate model for something else entirely.
             count(*) filter (
               where category_id is not null
                 and category_id in (select item_category_id from mapped_cats)
             )::int as tgq_from_matrix,
             count(*) filter (
               where category_id is not null
                 and category_id not in (select item_category_id from mapped_cats)
             )::int as tgq_from_fallback
        from scoped group by project_id
    ),
    ans as (
      select project_id,
             -- Under the FALLBACK a record with no level is absent from this on
             -- purpose: nothing on it is tiered and picking a reading is the app
             -- answering a question only a person can. Under his matrix the tier
             -- needs no level, because his matrix has no level column.
             count(*) filter (where state in ('missing', 'tbc') and to_quote)::int as to_quote,
             count(*) filter (where state = 'missing' and not to_quote)::int as missing,
             count(*) filter (where state = 'tbc' and not to_quote)::int as tbc,
             count(*) filter (where state in ('confirmed', 'na'))::int as settled,
             -- ---- THE SAME THREE THINGS COUNTED IN LINE ITEMS ---------------
             -- These do NOT sum, and the four above do. Every answer is exactly
             -- one of to-quote / also-outstanding / settled, so the question
             -- counts partition the work. An ITEM can be clear at TGQ and still
             -- carry other questions, so it belongs to two of these at once --
             -- which is why each is reported against the population below
             -- rather than beside its siblings as though they added up.
             count(distinct record_id)::int as items_with_questions,
             count(distinct record_id) filter (where state in ('missing', 'tbc') and to_quote)::int as to_quote_items,
             count(distinct record_id) filter (where state in ('missing', 'tbc') and not to_quote)::int as also_outstanding_items,
             -- SETTLED AS AN ITEM COUNT IS "NOTHING OUTSTANDING AT ALL", not
             -- "has a settled answer" -- which would be true of almost every
             -- item and would say nothing. It is therefore the population minus
             -- everything carrying anything, never a filter of its own.
             (count(distinct record_id)
              - count(distinct record_id) filter (where state in ('missing', 'tbc')))::int as settled_items
        from answers group by project_id
    ),
    fin as (
      select project_id,
             count(*)::int as finishes,
             count(*) filter (where kind is null)::int as finishes_no_kind
        from project_finishes
       where project_id = any(${projectIds}::uuid[]) and status = 'active'
       group by project_id
    ),
    docs as (
      select project_id,
             -- pending covers a document whose read is dispatched and running.
             -- It needs nothing from anybody, which is why the screen says so
             -- rather than offering a button.
             count(*) filter (where status in ('pending', 'parsing'))::int as documents_reading,
             count(*) filter (where status = 'failed')::int as documents_failed
        from intake_runs
       where project_id = any(${projectIds}::uuid[])
       group by project_id
    )
    select rec.project_id,
           rec.records, rec.uncategorised, rec.no_level, rec.level_suggested,
           rec.tgq_from_matrix, rec.tgq_from_fallback,
           coalesce(ans.to_quote, 0) as to_quote,
           coalesce(ans.missing, 0) as missing,
           coalesce(ans.tbc, 0) as tbc,
           coalesce(ans.settled, 0) as settled,
           coalesce(ans.items_with_questions, 0) as items_with_questions,
           coalesce(ans.to_quote_items, 0) as to_quote_items,
           coalesce(ans.also_outstanding_items, 0) as also_outstanding_items,
           coalesce(ans.settled_items, 0) as settled_items,
           coalesce(fin.finishes, 0) as finishes,
           coalesce(fin.finishes_no_kind, 0) as finishes_no_kind,
           coalesce(docs.documents_reading, 0) as documents_reading,
           coalesce(docs.documents_failed, 0) as documents_failed
      from rec
      left join ans on ans.project_id = rec.project_id
      left join fin on fin.project_id = rec.project_id
      left join docs on docs.project_id = rec.project_id
  `;
}

function toSummary(row: SummaryRow): ProjectSummary {
  return {
    records: Number(row.records ?? 0),
    uncategorised: Number(row.uncategorised ?? 0),
    noLevel: Number(row.no_level ?? 0),
    levelSuggested: Number(row.level_suggested ?? 0),
    toQuote: Number(row.to_quote ?? 0),
    missing: Number(row.missing ?? 0),
    tbc: Number(row.tbc ?? 0),
    settled: Number(row.settled ?? 0),
    itemsWithQuestions: Number(row.items_with_questions ?? 0),
    toQuoteItems: Number(row.to_quote_items ?? 0),
    alsoOutstandingItems: Number(row.also_outstanding_items ?? 0),
    settledItems: Number(row.settled_items ?? 0),
    finishes: Number(row.finishes ?? 0),
    finishesNoKind: Number(row.finishes_no_kind ?? 0),
    documentsReading: Number(row.documents_reading ?? 0),
    documentsFailed: Number(row.documents_failed ?? 0),
    tgqFromMatrix: Number(row.tgq_from_matrix ?? 0),
    tgqFromFallback: Number(row.tgq_from_fallback ?? 0),
  };
}
