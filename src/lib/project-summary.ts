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
  /** Finish codes in the project's library. */
  finishes: number;
  /** Of those, how many nobody has filed under a kind. */
  finishesNoKind: number;
  /** Documents still being read, and documents whose read failed. */
  documentsReading: number;
  documentsFailed: number;
  /**
   * Has ANYBODY narrowed the to-quote set yet?
   *
   * False means `tgq_levels` is still at 0019's seeded default — all three
   * levels on every one of the 728 questions, "everything required of
   * everything" — so `toQuote` is arithmetically identical to the total
   * outstanding and says nothing at all. On the sandbox Panther project on
   * 2026-09-18 that is exactly the case: 1,899 outstanding, 1,899 to quote,
   * nothing in the other two buckets.
   *
   * The screen MUST be able to tell those apart. A red "1,899 needed to quote"
   * over a placeholder is the confidently-wrong number this whole app exists to
   * avoid: it looks like a measurement and it is a default nobody has revised.
   * So when this is false the card says so in words and links to the workbook
   * that would fix it, rather than printing the figure as though it meant
   * something. It becomes true the moment the TGQ workbook is re-seeded, with
   * no code change — which is the point of it being seed data.
   */
  tgqNarrowed: boolean;
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
  finishes: 0,
  finishesNoKind: 0,
  documentsReading: 0,
  documentsFailed: 0,
  tgqNarrowed: false,
};

export async function loadProjectSummary(projectId: string): Promise<ProjectSummary> {
  const rows = await sql`
    with scoped as (
      -- THE EXPORT'S SCOPE. Duplicated from loadExportScope, asserted equal by
      -- a db-tier test: a summary over a different set of records from the file
      -- is worse than no summary.
      select r.id, r.category_id, r.level, r.level_suggested
      from spec_records r
      join spec_runs run on run.id = r.run_id
      where r.project_id = ${projectId}
        and r.status = 'active'
        and run.status = 'active'
        and not exists (
          select 1 from spec_records v
          where v.parent_id = r.id and v.status = 'active'
        )
    ),
    answers as (
      select s.id as record_id,
             s.level,
             q.tgq_levels,
             -- No answer row at all is MISSING, not satisfied, which is why
             -- this drives off the requirements table with a left join.
             -- (No backticks in here: one closes the tagged template.)
             coalesce(a.state, 'missing') as state
      from scoped s
      join requirements q on q.category_id = s.category_id
      left join spec_answers a
        on a.record_id = s.id and a.requirement_id = q.id and a.revision_no = 0
    )
    select
      (select count(*)::int from scoped) as records,
      (select count(*)::int from scoped where category_id is null) as uncategorised,
      (select count(*)::int from scoped where level is null) as no_level,
      (select count(*)::int from scoped where level is null and level_suggested is not null) as level_suggested,
      -- A record with NO level is absent from this count on purpose. Nothing on
      -- it is tiered, and picking a reading is the app answering a question
      -- only a person can.
      (select count(*)::int from answers
        where state in ('missing', 'tbc')
          and level is not null
          and tgq_levels @> array[level]::text[]) as to_quote,
      (select count(*)::int from answers
        where state = 'missing'
          and not (level is not null and tgq_levels @> array[level]::text[])) as missing,
      (select count(*)::int from answers
        where state = 'tbc'
          and not (level is not null and tgq_levels @> array[level]::text[])) as tbc,
      (select count(*)::int from answers where state in ('confirmed', 'na')) as settled,
      (select count(*)::int from project_finishes
        where project_id = ${projectId} and status = 'active') as finishes,
      (select count(*)::int from project_finishes
        where project_id = ${projectId} and status = 'active' and kind is null) as finishes_no_kind,
      -- pending covers a document whose read is dispatched and running. It
      -- needs nothing from anybody, which is why the screen says so rather than
      -- offering a button.
      (select count(*)::int from intake_runs
        where project_id = ${projectId} and status in ('pending', 'parsing')) as documents_reading,
      (select count(*)::int from intake_runs
        where project_id = ${projectId} and status = 'failed') as documents_failed,
      -- Has the TGQ workbook ever been applied? Asked of the whole requirement
      -- matrix, not of this project: it is seed data and one answer serves
      -- every project. Applying it only ever REMOVES entries, so any row with
      -- fewer than three levels means somebody has been through it.
      exists (
        select 1 from requirements where coalesce(array_length(tgq_levels, 1), 0) < 3
      ) as tgq_narrowed
  `;
  const row = rows[0];
  if (!row) return EMPTY_SUMMARY;
  return {
    records: Number(row.records ?? 0),
    uncategorised: Number(row.uncategorised ?? 0),
    noLevel: Number(row.no_level ?? 0),
    levelSuggested: Number(row.level_suggested ?? 0),
    toQuote: Number(row.to_quote ?? 0),
    missing: Number(row.missing ?? 0),
    tbc: Number(row.tbc ?? 0),
    settled: Number(row.settled ?? 0),
    finishes: Number(row.finishes ?? 0),
    finishesNoKind: Number(row.finishes_no_kind ?? 0),
    documentsReading: Number(row.documents_reading ?? 0),
    documentsFailed: Number(row.documents_failed ?? 0),
    tgqNarrowed: row.tgq_narrowed === true,
  };
}
