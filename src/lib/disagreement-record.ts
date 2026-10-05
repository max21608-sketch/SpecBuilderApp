// Recording that a document DISAGREES with the bill — the write, and only it.
//
// ============================================================================
// 0046's side table. A specification document's confirm calls this where a
// dimension, finish or note differs from the value the BILL holds and the
// reviewer left the row in its default, "keep the bill's, record this beside
// it". The bill's row stays live and nothing that reads `record_attributes`
// changes; the statement is copied here in the attribute's own shape, with the
// document and page it came from, so that using it later is an ordinary
// supersession (`disagreement-resolve.ts`, which is not this file's).
//
// ONE OPEN ROW PER (held value, document). Re-confirming a card or re-matching
// a run must not stack copies of one statement, so the row already open is
// handed back — read first, so a statement already recorded opens no change at
// all — and the insert does nothing against 0046's partial unique index if
// another transaction recorded it in between.
//
// NOT SPEC CONTENT: recording a disagreement changes no value, so it takes no
// record version (0046's header). The row carries the confirm's change set so
// the trail can say which change recorded it.
//
// A LEAF: it imports only the transaction's type. No backtick may appear
// inside the tagged templates below, comments included.
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";
import type { AttributeGroup, AttributeState, AttributeUnit, DimensionSlot } from "@/lib/spec-vocab";

/** The disagreeing statement, in `record_attributes`' own shape. */
export type DisagreementStatement = {
  attrGroup: AttributeGroup;
  label: string;
  value: string | null;
  unit: AttributeUnit | null;
  dimensionSlot: DimensionSlot | null;
  specFieldId: string | null;
  materialCode: string | null;
  state: AttributeState;
};

export async function recordDisagreement(
  txn: TxnSql,
  input: {
    projectId: string;
    recordId: string;
    heldAttributeId: string;
    sourceRunId: string;
    sourcePage: number | null;
    statement: DisagreementStatement;
    /** Asked for only when a row is inserted: the caller opens its change at the first real write. */
    changeSetId: () => Promise<string>;
    actor: string;
  },
): Promise<{ id: string; created: boolean }> {
  const { statement } = input;
  const openNow = async () =>
    (
      await txn`
        select id from attribute_disagreements
        where held_attribute_id = ${input.heldAttributeId} and source_run_id = ${input.sourceRunId} and status = 'open'
      `
    )[0];
  const already = await openNow();
  if (already) return { id: String(already.id), created: false };

  const changeSetId = await input.changeSetId();
  const inserted = await txn`
    insert into attribute_disagreements
      (project_id, record_id, held_attribute_id, source_run_id, source_page,
       attr_group, label, value, unit, dimension_slot, spec_field_id, material_code, state,
       change_set_id, created_by, updated_by)
    values
      (${input.projectId}, ${input.recordId}, ${input.heldAttributeId}, ${input.sourceRunId}, ${input.sourcePage},
       ${statement.attrGroup}, ${statement.label}, ${statement.value}, ${statement.unit},
       ${statement.dimensionSlot}, ${statement.specFieldId}, ${statement.materialCode}, ${statement.state},
       ${changeSetId}, ${input.actor}, ${input.actor})
    on conflict (held_attribute_id, source_run_id) where status = 'open' do nothing
    returning id
  `;
  if (inserted[0]) return { id: String(inserted[0].id), created: true };

  const raced = await openNow();
  if (!raced) throw new Error("the disagreement was neither recorded nor already open");
  return { id: String(raced.id), created: false };
}
