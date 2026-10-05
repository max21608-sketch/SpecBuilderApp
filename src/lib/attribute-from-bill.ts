// Which active attributes are WHAT THE BILL SAID — one predicate, three readers.
//
// ============================================================================
// The drawings card has asked this since brief G (`loadOccupiedSlots`): an
// occupant written by a bill of quantities' own run, with no BW standard a
// person set beside it, and not the new row of a person's correction (a
// correction keeps the bill's run and page, and points the row it retired at
// itself). Only those give way in one click to a drawing.
//
// A SPECIFICATION DOCUMENT NOW ASKS IT TOO (2026-10-05, the Aman tracker): a
// tracker that disagrees with the BILL is recorded beside it rather than
// asked to replace it, and one that disagrees with anything else keeps the
// replace tick. So the spec-document registers, the spec-document confirm and
// the drawings' occupied slots all need the same answer, and three copies of
// the predicate would be three readings of "the bill's" that drift — the
// `loadExportScope` rule. It lives here, ONCE, as one SQL statement taking
// either a project or a list of attribute ids, and every caller reads the set
// it returns. A LEAF: it imports only the query function's type.
//
// No backtick may appear inside the tagged template below, comments included.
// ============================================================================
import type { Row } from "@/lib/db";

/** `sql` or a transaction's `txn` — both are this shape. */
export type Query = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/**
 * The ids of the ACTIVE attributes that are the bill's own statement, among a
 * project's attributes or among the ids given. A retired attribute is never in
 * the set: it is nobody's live value.
 */
export async function loadBillHeldIds(
  q: Query,
  scope: { projectId: string } | { attributeIds: readonly string[] },
): Promise<Set<string>> {
  const projectId = "projectId" in scope ? scope.projectId : null;
  const ids = "attributeIds" in scope ? [...scope.attributeIds] : null;
  if (ids !== null && ids.length === 0) return new Set();
  const rows = await q`
    select a.id
    from record_attributes a
    join spec_records r on r.id = a.record_id
    join intake_runs ir on ir.id = a.source_run_id
    where a.status = 'active'
      and (${projectId}::uuid is null or r.project_id = ${projectId}::uuid)
      and (${ids}::uuid[] is null or a.id = any(${ids}::uuid[]))
      and ir.source_kind = 'boq_xlsx'
      and a.standard_set_by is null
      and not exists (select 1 from record_attributes p where p.superseded_by_id = a.id)
  `;
  return new Set(rows.map((row) => String(row.id)));
}
