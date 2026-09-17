// Creating the variant a drawing page belongs to.
//
// ============================================================================
// FIND OR CREATE, ONCE PER (PARENT, LETTER).
//
// Confirming page 6 of S-201 writes its fabric to S-201 B, not to the bill's
// record. The variant does not exist until that moment, so this is where it is
// made — and `spec_records_parent_variant_key` (0024) is what makes confirming
// the same card twice idempotent rather than a second variant.
//
// The letter is NOT a parameter the client chose. It is derived from the staged
// document by `variantLettersByItem`, server-side, so the review screen and the
// confirm reach the same answer without either telling the other.
//
// THREE THINGS IT DELIBERATELY DOES NOT DO.
//
// It does not copy the client ref. `spec_record_refs` holds `S-201` on the
// PARENT only. `resolveDrawingTargets` matches records by ref within a run, so
// copying the ref onto two variants would put three records carrying `S-201` on
// one run and every drawing card for it would resolve as AMBIGUOUS — the
// `SX11A` case, self-inflicted. The ref is the client's key for the bill line;
// the letter is ours for the thing we make from it.
//
// It does not apportion the quantity. The bill says 45 and never says how many
// are fabric A, so a variant is created with `qty = null` and the screens say
// the 45 is unallocated. Splitting it has a price attached.
//
// It does not un-retire. A variant somebody retired, with a reason, is not
// brought back by re-confirming the page that made it — that would undo a
// decision silently. The confirm is refused and names the record to restore.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";

export type VariantTarget = {
  /** The bill's own record — the parent. */
  parentId: string;
  /** The record the attributes should actually be written to. */
  recordId: string;
  variantLabel: string;
  created: boolean;
};

/**
 * The variant of `parentId` called `variantLabel`, making it if it is not there.
 *
 * Takes the PROJECT row lock before allocating a `record_no`, which is the
 * defect `tests/db/boq-concurrency.test.ts` exists for: two confirms reading
 * the same `max(record_no)` allocate the same number and one dies on
 * `spec_records_project_no_key` after the reviewer was told it was working.
 * The lock order is intake_run then project, matching `confirm-boq.ts`, so the
 * two cannot deadlock against each other.
 */
export async function ensureVariant(
  txn: TxnSql,
  { parentId, variantLabel, actor }: { parentId: string; variantLabel: string; actor: string },
): Promise<VariantTarget> {
  const parents = await txn`
    select id, project_id, run_id, category_id, item_description, product_reference,
           designer, area, boq_category, qty, status, level, level_suggested, level_suggested_reason
      from spec_records where id = ${parentId}
  `;
  const parent = parents[0];
  if (!parent) throw new DomainConflictError("not_found", "That record no longer exists.", { status: 404 });
  if (String(parent.status) !== "active") {
    throw new DomainConflictError(
      "parent_not_active",
      "That bill line is retired, so nothing can be added under it. Restore it first.",
    );
  }

  const existing = await txn`
    select id, status from spec_records
     where parent_id = ${parentId} and variant_label = ${variantLabel}
  `;
  const found = existing[0];
  if (found) {
    if (String(found.status) !== "active") {
      throw new DomainConflictError(
        "variant_retired",
        `Configuration ${variantLabel} of this item was retired. Restore it on the record screen before confirming this page again.`,
      );
    }
    return { parentId, recordId: String(found.id), variantLabel, created: false };
  }

  // ---- THE GUARD -----------------------------------------------------------
  //
  // Splitting a record that already carries confirmed specs would leave them on
  // a parent that the export stops shipping — a fabric somebody confirmed off a
  // drawing would silently vanish from the file. That is the single worst thing
  // this feature could do, so it is refused rather than guessed at.
  //
  // Only on the FIRST variant: once the item is split, the parent is a heading
  // and later variants change nothing about it.
  const siblings = await txn`
    select count(*)::int as n from spec_records where parent_id = ${parentId} and status = 'active'
  `;
  if (Number(siblings[0]?.n ?? 0) === 0) {
    const held = await txn`
      select count(*)::int as n from record_attributes
       where record_id = ${parentId} and status = 'active'
    `;
    const n = Number(held[0]?.n ?? 0);
    if (n > 0) {
      throw new DomainConflictError(
        "parent_holds_specs",
        `This item already carries ${n} confirmed spec${n === 1 ? "" : "s"} of its own, and splitting it would take them out of the export. Retire them, or move them onto a configuration first, then confirm this page.`,
      );
    }
  }

  // Serialises record_no allocation across concurrent confirms.
  await txn`select id from projects where id = ${parent.project_id} for update`;
  const maxNo = await txn`
    select coalesce(max(record_no), 0) as max_no from spec_records where project_id = ${parent.project_id}
  `;
  const recordNo = Number(maxNo[0]?.max_no ?? 0) + 1;

  // ---- THE LEVEL COMES DOWN WITH EVERYTHING ELSE --------------------------
  //
  // Asked for directly on 2026-09-17: "if you write it as simple for the
  // furniture line then it should automatically go simple, simple, simple for
  // each of the A, B and C options". A configuration is the same piece of
  // furniture in a different cloth, so it is the same level — and a variant
  // born level-less blocks a chase for a decision somebody has already taken
  // one row up. A suggestion comes down as a suggestion, which keeps the one
  // thing that matters: only a person's decision reaches the gate.
  //
  // The qty deliberately does NOT come down. The bill says 45 and never says
  // how many are fabric A.
  const inserted = await txn`
    insert into spec_records
      (project_id, run_id, record_no, status, category_id, item_description, product_reference,
       qty, designer, area, boq_category, level, level_suggested, level_suggested_reason,
       parent_id, depth, split_reason, variant_label,
       created_by, updated_by)
    values
      (${parent.project_id}, ${parent.run_id}, ${recordNo}, 'active', ${parent.category_id ?? null},
       ${parent.item_description}, ${parent.product_reference ?? null},
       null, ${parent.designer ?? null}, ${parent.area ?? null}, ${parent.boq_category ?? null},
       ${parent.level ?? null}, ${parent.level_suggested ?? null}, ${parent.level_suggested_reason ?? null},
       ${parentId}, 1, 'fabric', ${variantLabel}, ${actor}, ${actor})
    returning id
  `;
  const recordId = String(inserted[0]?.id ?? "");
  if (!recordId) throw new Error(`variant ${variantLabel} of ${parentId} was not inserted`);

  // The checklist, so the questions exist to be filled. Writes nothing for an
  // uncategorised parent, exactly as the BOQ confirm does — and
  // `PATCH /api/records/[id]` writes them if a category is set later.
  await txn`
    insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
    select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', ${actor}, ${actor}
    from requirements q
    join spec_records r on r.category_id = q.category_id
    where r.id = ${recordId}
  `;

  return { parentId, recordId, variantLabel, created: true };
}
