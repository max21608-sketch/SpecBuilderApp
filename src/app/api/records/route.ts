// The completion view's data. One row per spec record with its counts.
//
// The counts are computed from `requirements LEFT JOIN spec_answers`, not from
// answers alone: a requirement with no answer row is MISSING, and driving off
// answers would make it invisible. Readiness and spec-field requirements are
// counted separately -- a record whose BWS fields are all confirmed but whose
// deposit is unresolved is not ready, and one number would hide that.
import { sql, json } from "@/lib/db";
import { loadOutstanding, loadSentCoverage, questionKey, waitingByQuestion } from "@/lib/chase-drafts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return json({ ok: false, error: "projectId is required." }, 400);
  // Which run (BOQ tab) to show. Absent means the whole project.
  const runId = url.searchParams.get("runId");

  // RETIRED RECORDS ARE OUT BY DEFAULT, and that is not cosmetic: the export
  // scope takes only active records, so a table that listed retired ones
  // beside the rest would describe a different set from the file — the exact
  // disagreement the check sheet exists to prevent. They are still reachable,
  // because a record retired by a BOQ revision is a thing somebody has to go
  // and look at (a BWS job may already exist for it).
  const includeRetired = url.searchParams.get("includeRetired") === "1";

  // The programme the completion view measures Overdue against. Overdue is
  // COMPUTED from this date, never stored: writing it onto spec_answers would
  // bump the version M2's extraction snapshots are taken against, exactly as
  // Waiting would. A null date means "no programme", which the client must not
  // render as "on time".
  const projectRows = await sql`
    select order_date::text, specs_agreed_by::text, delivery_date::text
    from projects where id = ${projectId}
  `;
  if (!projectRows[0]) return json({ ok: false, error: "No such project." }, 404);
  // ::text above, not a Date: `pg` parses a date column into LOCAL midnight and
  // toISOString() then renders the day before in British Summer Time. A day is a
  // day; do not give it a timezone to lose.
  const asDate = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value).slice(0, 10);
  const programme = {
    orderDate: asDate(projectRows[0].order_date),
    specsAgreedBy: asDate(projectRows[0].specs_agreed_by),
    deliveryDate: asDate(projectRows[0].delivery_date),
  };

  const rows = await sql`
    select
      r.id,
      r.record_no,
      r.item_description,
      r.product_reference,
      r.qty,
      r.designer,
      r.area,
      r.boq_category,
      r.status,
      r.level,
      r.retired_at,
      r.retired_by,
      r.run_id,
      r.parent_id,
      r.variant_label,
      -- A CONFIGURATION SHOWS ITS PARENT'S CLIENT REF. S-201 A carries no
      -- boq_code of its own, deliberately (copying it would make every drawing
      -- card for that code ambiguous), so the ref it is KNOWN by has to be
      -- fetched through the parent -- the same read-through the export does.
      (select string_agg(x.ref_value, ', ' order by x.ref_value)
         from spec_record_refs x where x.record_id = r.parent_id) as parent_refs,
      -- How many live configurations this record has. A bill line with one or
      -- more is a HEADING: its configurations are what the export ships, and a
      -- row that did not say so would look like an item nobody had specced.
      (select count(*) from spec_records v where v.parent_id = r.id and v.status = 'active') as variant_count,
      -- What is left of the bill's quantity once the configurations have taken
      -- theirs. Null when the bill said nothing.
      (select coalesce(sum(v.qty), 0) from spec_records v
        where v.parent_id = r.id and v.status = 'active') as variant_qty,
      run.name as run_name,
      -- How much a document has actually said about this item. The intake
      -- stage's own progress measure: the cheat-sheet counts beside it measure
      -- a checklist that may not have been assigned yet.
      (select count(*) from record_attributes ra where ra.record_id = r.id and ra.status = 'active') as attribute_count,
      c.name  as category_name,
      c.family as category_family,
      c.requirements_authored,
      (select string_agg(x.ref_value, ', ' order by x.ref_value)
         from spec_record_refs x where x.record_id = r.id) as refs,
      count(q.id) filter (where q.kind = 'spec_field') as spec_total,
      count(q.id) filter (where q.kind = 'spec_field' and a.state in ('confirmed','na')) as spec_settled,
      count(q.id) filter (where q.kind = 'spec_field' and a.state = 'tbc') as spec_tbc,
      count(q.id) filter (where q.kind = 'spec_field' and (a.state = 'missing' or a.id is null)) as spec_missing,
      count(q.id) filter (where q.kind = 'readiness') as ready_total,
      count(q.id) filter (where q.kind = 'readiness' and a.state in ('confirmed','na')) as ready_settled,
      count(q.id) filter (where q.kind = 'readiness' and a.state = 'tbc') as ready_tbc,
      count(q.id) filter (where q.kind = 'readiness' and (a.state = 'missing' or a.id is null)) as ready_missing
    from spec_records r
    join spec_runs run on run.id = r.run_id
    left join item_categories c on c.id = r.category_id
    left join requirements q on q.category_id = r.category_id
    left join spec_answers a on a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
    where r.project_id = ${projectId}
      and (${includeRetired}::boolean or r.status = 'active')
      and (${runId}::uuid is null or r.run_id = ${runId}::uuid)
    group by r.id, c.name, c.family, c.requirements_authored, run.name, run.sort_order
    -- CONFIGURATIONS SORT WITH THEIR PARENT, not by their own record number: a
    -- variant is allocated the next number in the project, so S-201 A could be
    -- #33 and land pages away from the bill line it belongs to. Ordering on the
    -- PARENT'S record_no keeps the table in bill order; ordering on the parent
    -- id would put the groups in uuid order, which is no order at all.
    order by run.sort_order,
             coalesce((select p2.record_no from spec_records p2 where p2.id = r.parent_id), r.record_no),
             r.parent_id nulls first,
             r.variant_label
  `;

  // How many the table is NOT showing, so "38 records" cannot quietly mean
  // "38 of 41". Counted even when they are included, so the toggle can say
  // what it would hide.
  const retiredRows = await sql`
    select count(*)::int as n from spec_records r
    where r.project_id = ${projectId}
      and (${runId}::uuid is null or r.run_id = ${runId}::uuid)
      and r.status = 'retired'
  `;

  // ---- what is awaiting a reply, and what is blocking a quote -------------
  //
  // Both DERIVED, never stored. Recording a chase must not write to
  // spec_answers: that bumps the version M2's extraction snapshots are taken
  // against, for a reason that has nothing to do with the answer. And a tier is
  // a reading of the gate model, which a re-seed revises wholesale.
  //
  // "Waiting" is a third thing, distinct from settled and from nobody-looked:
  // it is the difference between work that needs doing and work that needs
  // following up. "Needed to quote" is a fourth: work that is stopping a
  // quotation going out today.
  const [outstanding, coverage] = await Promise.all([
    loadOutstanding(projectId),
    loadSentCoverage(projectId),
  ]);
  const waiting = waitingByQuestion(outstanding, coverage);

  const perRecord = new Map<string, { waiting: number; toQuote: number; toQuoteWaiting: number }>();
  for (const question of outstanding) {
    const entry = perRecord.get(question.recordId) ?? { waiting: 0, toQuote: 0, toQuoteWaiting: 0 };
    const isWaiting = waiting.has(questionKey(question.recordId, question.requirementId, 0));
    if (isWaiting) entry.waiting += 1;
    if (question.tier === "to_quote") {
      entry.toQuote += 1;
      if (isWaiting) entry.toQuoteWaiting += 1;
    }
    perRecord.set(question.recordId, entry);
  }

  return json({
    ok: true,
    programme,
    records: rows.map((row) => {
      const counts = perRecord.get(String(row.id));
      return {
        ...row,
        waiting: counts?.waiting ?? 0,
        // null, not 0, where the record has no level: "nothing is blocking the
        // quote" and "nobody has said what kind of item this is" are different
        // answers and the table prints them differently.
        to_quote_outstanding: row.level === null || row.level === undefined ? null : (counts?.toQuote ?? 0),
        to_quote_waiting: counts?.toQuoteWaiting ?? 0,
      };
    }),
    retiredCount: Number(retiredRows[0]?.n ?? 0),
    includeRetired,
  });
}
