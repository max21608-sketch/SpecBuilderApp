// The phase table's ORDER: the bill's, or the client reference's.
//
// ============================================================================
// Sebastian asked on 2026-10-12, Matthew agreed: "sort it by their BOQ or sort
// it by reference". Bill order stays the default — it is the order the query
// already returns (`/api/records`, on the PARENT'S record_no) — and this is
// the second reading.
//
// Three things are load-bearing:
//
//   * THE KEY IS THE CLIENT CODE FOLDED BY `normaliseRef`, the one fold every
//     matcher uses, so `GR-FUR-22` on four lines of the bill sits together
//     and `GR-FUR-13` and `PL-FUR-13` do not: a zone is part of the code. Ties
//     keep bill order. A record with no client code goes last, in bill order,
//     rather than first under an empty key.
//   * A CONFIGURATION STAYS DIRECTLY UNDER ITS BILL LINE. It sorts with its
//     parent: the group is `parent_id ?? id`, the group's key is its client
//     code (a configuration reads its parent's), and inside a group the bill
//     order — parent first — is kept.
//   * IT REORDERS WHAT IS LISTED AND NOTHING ELSE. Pure, over the list the
//     screen already filtered; no count, tile or tally reads it.
// ============================================================================
import { normaliseRef } from "@/lib/record-refs";

export const RECORD_ORDERS = ["bill", "ref"] as const;
export type RecordOrder = (typeof RECORD_ORDERS)[number];

export const RECORD_ORDER_LABELS: Record<RecordOrder, string> = {
  bill: "Bill order",
  ref: "Client reference",
};

export function isRecordOrder(value: unknown): value is RecordOrder {
  return typeof value === "string" && (RECORD_ORDERS as readonly string[]).includes(value);
}

type Orderable = { id: string; parent_id: string | null; client_code: string | null };

/** The records in the order asked for. `bill` returns them as given. */
export function orderRecords<T extends Orderable>(records: readonly T[], order: RecordOrder): T[] {
  if (order === "bill") return [...records];
  // Where each group first appears in bill order — its bill line, normally.
  const groupAt = new Map<string, number>();
  const groupKey = new Map<string, string>();
  records.forEach((record, index) => {
    const group = record.parent_id ?? record.id;
    if (!groupAt.has(group)) groupAt.set(group, index);
    // The bill line's own code decides its group; a configuration whose bill
    // line is not listed (a search hid it) decides by the code it reads.
    if (!groupKey.has(group) || record.parent_id === null) groupKey.set(group, normaliseRef(record.client_code ?? ""));
  });
  const decorated = records.map((record, index) => {
    const group = record.parent_id ?? record.id;
    return { record, index, at: groupAt.get(group) as number, key: groupKey.get(group) as string };
  });
  decorated.sort((a, b) => {
    if ((a.key === "") !== (b.key === "")) return a.key === "" ? 1 : -1;
    const byKey = a.key.localeCompare(b.key, "en", { numeric: true });
    if (byKey !== 0) return byKey;
    if (a.at !== b.at) return a.at - b.at;
    return a.index - b.index;
  });
  return decorated.map((entry) => entry.record);
}
