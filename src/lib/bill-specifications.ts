// "Read the specifications in this bill" — one read, charged (plan any-bill, Step 2.5).
//
// ============================================================================
// A BILL'S DESCRIPTIONS CARRY SPECS, AND NOTHING NEW IS BUILT TO READ THEM.
//
// The Aman pricing document writes each item's size, model and finishes into
// its description cell ("Sizes (mm): W 660 x D 700 x SH 450 … Finish: …"). The
// confirm reads the bill by code and turns every line into a record; it never
// reads what the words SAY. After the confirm, one press registers the SAME
// stored attachment as a specification document of kind `ffe_schedule` in the
// same pack, through the registration protocol every uploaded document uses
// (`insertSpecDocumentRun`), which dispatches the charged read. From there it is
// the existing pipeline: proposals, the review screen, dimensions by slot,
// finishes by code, and a person's confirm.
//
// IDEMPOTENT BY CONSTRUCTION. Its registration request id is derived from the
// bill's run, so a second press — another tab, a double click, a retried
// request — returns the run the first one made and publishes nothing, which is
// the unique index on `registration_request_id` saying so, not a check that
// could race.
//
// ONLY A CONFIRMED BILL. Before the confirm there are no records for a
// proposal to land on, so every one would stage as "item not found" and the
// read would be paid for twice.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { insertSpecDocumentRun, type SpecRunRegistration } from "@/lib/spec-registration";
import { billSpecsRequestId } from "@/lib/bill-rows";
// The id lives in the leaf `bill-rows.ts`, so the registers loader can read one
// without importing the registration protocol. Re-exported for every caller.
export { billSpecsRequestId };

export async function registerBillSpecifications(
  txn: TxnSql,
  { billRunId, actor }: { billRunId: string; actor: string },
): Promise<SpecRunRegistration> {
  const rows = await txn`
    select id, project_id, batch_id, status, source_kind, attachment_id
    from intake_runs where id = ${billRunId}
    for update
  `;
  const bill = rows[0];
  if (!bill) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  if (bill.source_kind !== "boq_xlsx") {
    throw new DomainConflictError("wrong_kind", "Only a bill of quantities has specifications to read this way.", {
      status: 400,
    });
  }
  if (bill.status !== "confirmed") {
    throw new DomainConflictError(
      "not_confirmed",
      "Confirm the bill first: its specifications are read onto the records the confirm creates.",
    );
  }
  if (!bill.attachment_id) {
    throw new DomainConflictError(
      "source_not_kept",
      "The original of this bill was not kept when it was uploaded, so its specifications cannot be read. Upload the file again.",
    );
  }
  return insertSpecDocumentRun(txn, {
    projectId: String(bill.project_id),
    batchId: bill.batch_id === null || bill.batch_id === undefined ? null : String(bill.batch_id),
    documentKind: "ffe_schedule",
    registrationRequestId: billSpecsRequestId(billRunId),
    actor,
    // THE SAME STORED FILE, not a copy: the reviewer checks a proposal against
    // the spreadsheet the records were read from.
    attach: async () => String(bill.attachment_id),
  });
}
