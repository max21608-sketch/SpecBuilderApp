// Every version of one record, with what changed at each.
//
// Read-only. The diffs are computed here rather than stored; see
// change-history.ts for why that is not an optimisation waiting to happen.
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { loadRecordHistory, compareRecordVersions } from "@/lib/change-history";
import { loadRecordBaselines } from "@/lib/baselines";
import { parseAtoms } from "@/lib/snapshot-diff";
import type { StoredCell } from "@/lib/record-snapshot";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const records = await sql`
    select r.id, r.record_no, r.item_description, p.bws_project_number,
           r.variant_ordinal, (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no
    from spec_records r join projects p on p.id = r.project_id
    where r.id = ${id}
  `;
  const record = records[0];
  if (!record) return json({ ok: false, error: "No such record." }, 404);
  const label = recordLabel(String(record.bws_project_number), numberingFromRow(record));

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Comparing any two versions, rather than each against the one before it.
  if (from !== null || to !== null) {
    const a = Number(from);
    const b = Number(to);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) {
      return json({ ok: false, error: "Give two version numbers to compare." }, 400);
    }
    const result = await compareRecordVersions(sql, id, a, b);
    if ("error" in result) return json({ ok: false, error: result.error }, 404);

    // ---- what the FILE said that day, and what this change did not touch ---
    //
    // Two different questions, and the screen asks both. The DIFF recomposes
    // both ends with today's rules, so a change to the composer never shows as
    // an edit on a record nobody touched; the STORED cells answer the other
    // one — what BWS would have received on that date — and they are read, not
    // recomposed, which is the whole reason 0012 keeps them.
    //
    // `unchanged` is the proof the diff cannot give on its own: a list that
    // hides what did not move cannot show that nothing else did. Counted off
    // the newer version's own atoms, against the keys the diff names.
    const stored = await sql`
      select atoms, cells from record_snapshots where record_id = ${id} and snapshot_no = ${b}
    `;
    const cells = ((stored[0]?.cells ?? []) as StoredCell[]).filter(
      (cell) => String(cell.value ?? "").trim() !== "",
    );
    let unchanged: { key: string; label: string; value: string | null }[] = [];
    if (stored[0]) {
      try {
        const atoms = parseAtoms(stored[0].atoms);
        const touched = new Set(
          [...result.diff.refs, ...result.diff.attributes, ...result.diff.answers].map((change) => change.key),
        );
        unchanged = [
          ...atoms.refs
            .filter((ref) => !touched.has(`${ref.system}:${ref.value}`))
            .map((ref) => ({ key: `${ref.system}:${ref.value}`, label: ref.system, value: ref.value })),
          ...atoms.attributes
            .filter((attribute) => !touched.has(attribute.id))
            .map((attribute) => ({ key: attribute.id, label: attribute.label, value: attribute.value })),
          ...atoms.answers
            .filter((answer) => !touched.has(answer.requirementId))
            .map((answer) => ({ key: answer.requirementId, label: answer.prompt, value: answer.value })),
        ];
      } catch {
        // A version a newer build wrote. The diff above already reported that;
        // an empty unchanged list is better than failing the whole comparison.
      }
    }

    return json({
      ok: true,
      record: { id, label, itemDescription: String(record.item_description) },
      ...result,
      cells,
      unchanged,
    });
  }

  // The named points this record sits inside, so the versions list can draw a
  // bar between two rows. Its own key rather than a field on each version: a
  // baseline sits BETWEEN versions, and hanging it off the one below would
  // make a point that covers no version of this record invisible.
  //
  // Each baseline names the version it froze. Placing the bar by comparing
  // dates instead is the error `baseline_members` exists to prevent — see
  // `loadRecordBaselines`.
  const [versions, baselines] = await Promise.all([
    loadRecordHistory(sql, id),
    loadRecordBaselines(sql, id),
  ]);
  return json({
    ok: true,
    record: { id, label, itemDescription: String(record.item_description) },
    versions,
    baselines,
  });
}
