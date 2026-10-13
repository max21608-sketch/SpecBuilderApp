// The matrix half of an item's TGQ, for screens that total a whole project.
//
// ============================================================================
// WHY THE SUMMARY HAS A TYPESCRIPT HALF NOW.
//
// Since 2026-10-13 an item on Matthew's matrix counts its TGQ GATE rows
// (`itemTgq`): questions, dimension slots, record columns. A gate is judged
// by `gateStatus` and nowhere else — CLAUDE.md, "A gate belongs to a FIELD":
// computing the numbers in SQL would be a second gate model. So
// `project-summary.ts` keeps the PLACEHOLDER half in SQL (questions, by
// `tgq_levels`), and this loads the matrix half over one bulk gate context —
// the same `loadGateContext` the phase table's TG0/TG1 columns read — and runs
// the one function per record. The overview, the projects list and every line
// screen then add the two, so their totals equal the sum of the lines.
// ============================================================================
import { sql } from "@/lib/db";
import { itemTgqForRecord, loadGateContext } from "@/lib/gate-load";
import type { ItemTgq } from "@/lib/item-tgq";

export type MatrixItemTgq = ItemTgq & { recordId: string; projectId: string };

/**
 * Every record in the export's scope whose category is on Matthew's matrix,
 * with its item TGQ by `itemTgq`. Keyed by record id.
 */
export async function loadMatrixItemTgq(projectIds: string[]): Promise<Map<string, MatrixItemTgq>> {
  const out = new Map<string, MatrixItemTgq>();
  if (projectIds.length === 0) return out;
  const records = await sql`
    select r.id, r.project_id, r.category_id
      from spec_records r
      join spec_runs run on run.id = r.run_id
     where r.project_id = any(${projectIds}::uuid[])
       and r.status = 'active'
       and run.status = 'active'
       -- loadExportScope's split-line clause, word for word. (No backticks in
       -- here: one closes the tagged template.)
       and not exists (select 1 from spec_records v where v.parent_id = r.id and v.status = 'active')
       and r.category_id in (select item_category_id from spec_matrix_category_map)
  `;
  if (records.length === 0) return out;
  const context = await loadGateContext(
    sql,
    records.map((row) => String(row.id)),
  );
  for (const row of records) {
    const recordId = String(row.id);
    // No outstanding list is needed for the COUNT on the matrix: the gate rows
    // are the count. A screen that lists the rows passes its own.
    const tgq = itemTgqForRecord(context, { id: recordId, categoryId: String(row.category_id) }, []);
    out.set(recordId, { ...tgq, recordId, projectId: String(row.project_id) });
  }
  return out;
}
