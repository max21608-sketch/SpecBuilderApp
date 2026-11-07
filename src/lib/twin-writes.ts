// A person's spec act on a bill line, written on its twins too (0060).
//
// ============================================================================
// THE THREE WRITERS, UNCHANGED, CALLED ONCE PER RECORD.
//
// `createAttribute`, `correctAttribute` and `retireAttribute` already take an
// open change to attach to and a "do not version" flag, for the bill line's
// common-spec fan-out (`editCommonSpec`). A twin is the same caller shape: one
// act, several records, ONE change set, one version per record written, and
// `spec_records.version` untouched. So nothing here writes a row itself
// except the one supersession pointer the replace needs; every guard each
// writer holds (the occupant check, the finish link, the BW standard carried
// forward, the checklist recomposed) runs for every twin exactly as it runs
// for the record the person is looking at.
//
// ---- WHAT THE SCREEN SENT IS RE-READ, NEVER BELIEVED -----------------------
//
// Under the records' locks the twins and their rows are loaded again and put
// through `twinOffer`, the function that drew the ticks. A twin that is no
// longer a twin, a row that is no longer the one the screen showed, a "held"
// twin sent without the row it replaces, or a twin the offer did not offer,
// refuses the WHOLE act in words. Writing the record and skipping the twin
// would look finished and is the half-applied card in a new place.
//
// ---- THE LOCK ORDER IS record-lock.ts's ------------------------------------
//
// Every record the act may touch is locked in id order BEFORE the first read
// of a row, so a twin act and a common-spec edit or a drawing confirm on
// either line wait for each other instead of deadlocking. The writers then
// re-take their own record's lock, which is free: this transaction holds it.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import type { VerifiedEvidence } from "@/lib/change-sets";
import { createAttribute, type CreateAttributeInput, type CreateAttributeResult } from "@/lib/manual-capture";
import { correctAttribute, type CorrectAttributeInput, type CorrectAttributeResult } from "@/lib/attribute-correct";
import { retireAttribute, type RetireAttributeResult } from "@/lib/attribute-retire";
import { snapshotRecords } from "@/lib/record-snapshot";
import { lockRecords } from "@/lib/record-lock";
import { twinsOf } from "@/lib/record-twins";
import { loadTwinAttributes, twinOffer, type TwinAttribute, type TwinOfferEntry, type TwinOfferSubject } from "@/lib/twin-offer";

/** One twin a person ticked. `attributeId`/`version`: the twin's row the screen showed (held, same). */
export type AlsoRecord = { recordId: string; attributeId?: string | null; version?: number | null };

export type TwinWritten = { recordId: string; attributeId: string; replacedId: string | null };

/** The offer as it stands under the lock, for a bill line. A configuration offers nothing. */
async function liveOffer(txn: TxnSql, recordId: string, subject: TwinOfferSubject): Promise<TwinOfferEntry[]> {
  const me = await txn`select parent_id from spec_records where id = ${recordId}`;
  if (!me[0] || me[0].parent_id) return [];
  const twins = await twinsOf(txn, recordId);
  const attributes = await loadTwinAttributes(
    txn,
    twins.map((twin) => twin.recordId),
  );
  return twinOffer(
    subject,
    twins.map((twin) => ({ ...twin, attributes: attributes.get(twin.recordId) ?? [] })),
  );
}

/** Each ticked twin, checked against the live offer. Throws, naming the twin, on anything the screen could not have offered. */
function checkTicked(offer: TwinOfferEntry[], also: readonly AlsoRecord[]): TwinOfferEntry[] {
  const seen = new Set<string>();
  return also.map((tick) => {
    if (seen.has(tick.recordId)) {
      throw new DomainConflictError("twin_twice", "One twin was ticked twice. Reload.", { status: 400 });
    }
    seen.add(tick.recordId);
    const entry = offer.find((candidate) => candidate.twin.recordId === tick.recordId);
    const name = entry?.twin.boqCodes[0] ?? entry?.twin.label ?? "That line";
    if (!entry) {
      throw new DomainConflictError("twins_changed", "That line is no longer a twin of this one. Reload before saving.");
    }
    if (!entry.offered) {
      throw new DomainConflictError(
        "twin_not_offered",
        `${name} no longer says the same as this item, so it is left alone. Reload to see what it says.`,
      );
    }
    const shown = tick.attributeId ?? null;
    const live = entry.row?.id ?? null;
    if (shown !== live || (live !== null && tick.version !== entry.row!.version)) {
      throw new DomainConflictError(
        "twin_changed",
        live
          ? `${name} changed since this screen loaded. Reload before saving.`
          : `${name} no longer holds that value. Reload before saving.`,
      );
    }
    return entry;
  });
}

async function pointSuperseded(txn: TxnSql, oldId: string, newId: string, actor: string): Promise<void> {
  // 0016's check allows the pointer only on a retired row, which the retire
  // above has just made it. The order is the database's.
  await txn`update record_attributes set superseded_by_id = ${newId}, updated_by = ${actor} where id = ${oldId}`;
}

/** Add a spec by hand, on this record and on the ticked twins. */
export async function createAttributeWithTwins(
  txn: TxnSql,
  input: CreateAttributeInput & { alsoRecords: readonly AlsoRecord[] },
): Promise<CreateAttributeResult & { twins: TwinWritten[] }> {
  const { alsoRecords, ...base } = input;
  if (alsoRecords.length === 0) return { ...(await createAttribute(txn, base)), twins: [] };

  await lockRecords(txn, [base.recordId, ...alsoRecords.map((tick) => tick.recordId)]);
  const subject: TwinOfferSubject = {
    act: "add",
    attrGroup: base.attrGroup as TwinAttribute["attrGroup"],
    label: base.label,
    dimensionSlot: (base.dimensionSlot?.trim() || null) as TwinAttribute["dimensionSlot"],
    specFieldId: base.specFieldId ?? null,
  };
  const ticked = checkTicked(await liveOffer(txn, base.recordId, subject), alsoRecords);

  // The record the person is looking at decides the change set exactly as it
  // would alone (their open change, or one of its own); the twins join it.
  const primary = await createAttribute(txn, { ...base, snapshot: false });
  const twins: TwinWritten[] = [];
  for (const entry of ticked) {
    // A HELD slot was ticked, which is the acknowledgement: supersede the
    // twin's row, retire first because both slot indexes count active rows.
    const replaced = entry.status === "held" ? entry.row! : null;
    if (replaced) {
      await retireAttribute(txn, {
        attributeId: replaced.id,
        expectedVersion: replaced.version,
        reason: "Replaced from its twin",
        actor: base.actor,
        changeSetId: primary.changeSetId,
        snapshot: false,
      });
    }
    const written = await createAttribute(txn, {
      ...base,
      recordId: entry.twin.recordId,
      changeSetId: primary.changeSetId,
      snapshot: false,
    });
    if (replaced) await pointSuperseded(txn, replaced.id, written.attributeId, base.actor);
    twins.push({ recordId: entry.twin.recordId, attributeId: written.attributeId, replacedId: replaced?.id ?? null });
  }
  await snapshotRecords(txn, [base.recordId, ...twins.map((twin) => twin.recordId)], primary.changeSetId);
  return { ...primary, twins };
}

/** Edit value, on this record and on each ticked twin whose row said the same. */
export async function correctAttributeWithTwins(
  txn: TxnSql,
  input: CorrectAttributeInput & { alsoRecords: readonly AlsoRecord[] },
): Promise<CorrectAttributeResult & { twins: TwinWritten[] }> {
  const { alsoRecords, ...base } = input;
  if (alsoRecords.length === 0) return { ...(await correctAttribute(txn, base)), twins: [] };

  const recordId = await recordOfAttribute(txn, base.attributeId);
  await lockRecords(txn, [recordId, ...alsoRecords.map((tick) => tick.recordId)]);
  const ticked = checkTicked(await liveOffer(txn, recordId, { act: "correct", row: await rowOf(txn, base.attributeId) }), alsoRecords);

  const primary = await correctAttribute(txn, { ...base, snapshot: false });
  const twins: TwinWritten[] = [];
  for (const entry of ticked) {
    const written = await correctAttribute(txn, {
      ...base,
      attributeId: entry.row!.id,
      expectedVersion: entry.row!.version,
      changeSetId: primary.changeSetId,
      snapshot: false,
    });
    twins.push({ recordId: entry.twin.recordId, attributeId: written.attributeId, replacedId: entry.row!.id });
  }
  const snapshots = await snapshotRecords(txn, [recordId, ...twins.map((twin) => twin.recordId)], primary.changeSetId);
  return { ...primary, snapshotNo: snapshots.get(recordId) ?? null, twins };
}

/** Retire, on this record and on each ticked twin whose row said the same. */
export async function retireAttributeWithTwins(
  txn: TxnSql,
  input: {
    attributeId: string;
    expectedVersion: number;
    reason: string;
    evidence?: VerifiedEvidence | null;
    actor: string;
    alsoRecords: readonly AlsoRecord[];
  },
): Promise<RetireAttributeResult & { twins: TwinWritten[] }> {
  const { alsoRecords, ...base } = input;
  if (alsoRecords.length === 0) return { ...(await retireAttribute(txn, base)), twins: [] };

  const recordId = await recordOfAttribute(txn, base.attributeId);
  await lockRecords(txn, [recordId, ...alsoRecords.map((tick) => tick.recordId)]);
  const ticked = checkTicked(await liveOffer(txn, recordId, { act: "retire", row: await rowOf(txn, base.attributeId) }), alsoRecords);

  const primary = await retireAttribute(txn, { ...base, snapshot: false });
  const twins: TwinWritten[] = [];
  for (const entry of ticked) {
    await retireAttribute(txn, {
      ...base,
      attributeId: entry.row!.id,
      expectedVersion: entry.row!.version,
      changeSetId: primary.changeSetId,
      snapshot: false,
    });
    twins.push({ recordId: entry.twin.recordId, attributeId: entry.row!.id, replacedId: null });
  }
  const snapshots = await snapshotRecords(txn, [recordId, ...twins.map((twin) => twin.recordId)], primary.changeSetId);
  return { ...primary, snapshotNo: snapshots.get(recordId) ?? null, twins };
}

async function recordOfAttribute(txn: TxnSql, attributeId: string): Promise<string> {
  const rows = await txn`select record_id from record_attributes where id = ${attributeId}`;
  if (!rows[0]) throw new DomainConflictError("not_found", "No such spec.", { status: 404 });
  return String(rows[0].record_id);
}

/**
 * The row being corrected or retired, as it stands BEFORE the act: what each
 * twin's row is compared with. The writer itself still checks its version.
 */
async function rowOf(txn: TxnSql, attributeId: string): Promise<TwinAttribute> {
  const record = await recordOfAttribute(txn, attributeId);
  const row = (await loadTwinAttributes(txn, [record])).get(record)?.find((candidate) => candidate.id === attributeId);
  if (!row) {
    throw new DomainConflictError("already_retired", "That spec has already been taken off this item. Reload.");
  }
  return row;
}
