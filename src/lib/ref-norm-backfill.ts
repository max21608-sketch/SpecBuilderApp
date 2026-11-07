// The plan for re-folding spec_record_refs.ref_value_norm (audit 5.4 A3,
// 2026-11-06). Pure; db/backfill-ref-norm.ts is the guard and the writes.
//
// The column was written by a second `normaliseRef` in boq-import that kept
// dots and dashes, while every matcher folds with record-refs'. The writers
// now use the one fold, and rows written before are re-folded here.
//
// THE TRAP: the column carries `unique (record_id, ref_system,
// ref_value_norm)`, and the stricter fold can make two refs on ONE record
// equal (`CH-01.1` and `CH-01-1`). Those are reported and NEITHER is written:
// whether they were one ref typed twice or two refs the client kept apart is a
// person's question, and merging them cannot be undone.
import { normaliseRef } from "@/lib/record-refs";

export type RefRow = { id: string; recordId: string; refSystem: string; refValue: string; refValueNorm: string };

export type RefNormPlan = {
  updates: { id: string; from: string; to: string }[];
  unchanged: number;
  collisions: { recordId: string; refSystem: string; norm: string; values: string[] }[];
};

export function planRefNormBackfill(rows: RefRow[]): RefNormPlan {
  const groups = new Map<string, RefRow[]>();
  for (const row of rows) {
    const key = `${row.recordId}\u0000${row.refSystem}\u0000${normaliseRef(row.refValue)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const plan: RefNormPlan = { updates: [], unchanged: 0, collisions: [] };
  for (const group of groups.values()) {
    const norm = normaliseRef(group[0]!.refValue);
    if (group.length > 1) {
      plan.collisions.push({
        recordId: group[0]!.recordId,
        refSystem: group[0]!.refSystem,
        norm,
        values: group.map((row) => row.refValue),
      });
      continue;
    }
    const row = group[0]!;
    if (row.refValueNorm === norm) plan.unchanged += 1;
    else plan.updates.push({ id: row.id, from: row.refValueNorm, to: norm });
  }
  return plan;
}
