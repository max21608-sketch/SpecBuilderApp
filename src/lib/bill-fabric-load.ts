// What a bill's fabric lines are filed against, loaded once for the two
// callers that decide it: the BOQ review's GET (what the reviewer is told
// each fabric row will do) and the confirm (what it does). One loader, so the
// screen and the commit cannot be handed different libraries — the
// `loadExportScope` rule, and `bill-description-load.ts`'s beside it.
//
// Read only. Every query runs inside whatever the caller is: the neon client
// for the screen, the locked transaction for the confirm.
import type { SqlLike } from "@/lib/record-atoms";
import { isFinishCodeOrigin, isFinishKind, type Finish } from "@/lib/finishes";
import { heldBillFinishKind, type BillFinishKind } from "@/lib/bill-finish-kind";

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

/** The project's ACTIVE finishes, in the shape `resolveFinishCode` reads. */
export async function loadFinishLibrary(exec: SqlLike, projectId: string): Promise<Finish[]> {
  const rows = await exec`
    select id, code, code_norm, code_origin, kind, description, supplier_raw, reference, colour, state
    from project_finishes where project_id = ${projectId} and status = 'active'
  `;
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    codeNorm: String(row.code_norm),
    codeOrigin: isFinishCodeOrigin(row.code_origin) ? row.code_origin : "client",
    kind: isFinishKind(row.kind) ? row.kind : null,
    description: text(row.description),
    supplierRaw: text(row.supplier_raw),
    reference: text(row.reference),
    colour: text(row.colour),
    state: String(row.state) as Finish["state"],
  }));
}

/**
 * The finishes among `finishIds` that already have a CURRENT swatch — a
 * `finish_swatch` attachment nothing has superseded (0013). A bill never
 * replaces one.
 */
export async function loadCurrentSwatches(exec: SqlLike, finishIds: readonly string[]): Promise<Set<string>> {
  if (finishIds.length === 0) return new Set();
  const rows = await exec`
    select distinct entity_id from attachments
    where entity_type = 'project_finishes' and kind = 'finish_swatch' and superseded_at is null
      and entity_id = any(${[...finishIds]}::uuid[])
  `;
  return new Set(rows.map((row) => String(row.entity_id)));
}

/** The project's short code for in-house finish codes (0044), or null. */
export async function loadFinishCodePrefix(exec: SqlLike, projectId: string): Promise<string | null> {
  const rows = await exec`select finish_code_prefix from projects where id = ${projectId}`;
  return text(rows[0]?.finish_code_prefix);
}

/**
 * The finishes each carried record already holds FROM A BILL, with their kind
 * and words — a revision writes nothing where the record holds that exact
 * finish of the line's kind, and refuses where it holds a different one of
 * that kind (`writeFabricLine`). The kind is read back off the row's group and
 * label (`heldBillFinishKind`); a `material` row is a fabric whatever its
 * label, which is what this read before finish lines had kinds. A row no
 * finish line could have written (a description's "Timber: …" row, labelled
 * as printed) is not returned.
 */
export async function loadHeldBillFinishes(
  exec: SqlLike,
  recordIds: readonly string[],
): Promise<Map<string, { kind: BillFinishKind; value: string }[]>> {
  const held = new Map<string, { kind: BillFinishKind; value: string }[]>();
  if (recordIds.length === 0) return held;
  const rows = await exec`
    select a.record_id, a.value, a.attr_group, a.label
    from record_attributes a
    join intake_runs r on r.id = a.source_run_id
    where a.record_id = any(${[...recordIds]}::uuid[]) and a.status = 'active' and r.source_kind = 'boq_xlsx'
      and a.attr_group in ('material', 'finish', 'hardware', 'other')
  `;
  for (const row of rows) {
    const kind = heldBillFinishKind({ attrGroup: String(row.attr_group), label: String(row.label ?? "") });
    if (kind === undefined) continue;
    const id = String(row.record_id);
    held.set(id, [...(held.get(id) ?? []), { kind, value: String(row.value ?? "") }]);
  }
  return held;
}
