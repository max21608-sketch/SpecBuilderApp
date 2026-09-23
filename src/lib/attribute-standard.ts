// Proposing a BW standard beside what the client specified, and recording
// that the client agreed to it.
//
// ============================================================================
// THE WORKFLOW (Max, 2026-09-23): the client specifies "30% oak"; BW proposes
// its standard "25% oak"; the client agrees. Both stay visible for ever, per
// item, and the export ships the standard where there is one. 0041's header
// carries the schema's reasoning; this is the write path after confirm.
//
// ---- WHY THIS IS AN UPDATE IN PLACE, WHEN A CORRECTION IS NOT --------------
//
// `correctAttribute` supersedes, because it changes what the row says a
// DOCUMENT said, and a row saying something its page does not while citing
// that page is a false provenance. The standard is not what the page said and
// cites no page: it is a decision taken beside it. So the six `standard_*`
// columns are written on the row, and the history is the change set, the
// audit row and the record's version -- exactly as it is for a level or a
// category.
//
// ---- WHAT EACH ACT OPENS ---------------------------------------------------
//
//   * `standard_set` -- a proposal, a TBC ("BW will propose one"), or taking a
//     standard that was never agreed away. No reason: nothing settled is
//     overridden.
//   * `standard_change` -- changing or withdrawing one the client AGREED to.
//     A reason is required, by the database as well as here, because it
//     overrides what somebody else decided.
//   * `standard_agreed` -- the client said yes. Evidence optional (a yes is
//     often said on a call); where there is one, the attribute points at it
//     so the Specs tab can open the email without walking the trail.
//
// Each is ONE change set and ONE version of the record (`snapshotRecords`),
// the checklist recomposed through `recomposeAnswers` -- never written here,
// because the composed answer is a projection of the attributes and the next
// drawing confirm would wipe a directly written one. `spec_records.version`
// is never touched: an attribute is its own row.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit, type ChangeSetKind, type UploadedEvidence } from "@/lib/change-sets";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { snapshotRecords } from "@/lib/record-snapshot";
import { loadPalettes, palettesByFieldJsonId } from "@/lib/palette-load";
import { paletteOptionFor } from "@/lib/palettes";
import { isStandardState, type StandardState } from "@/lib/bw-standard";

/** What a person asked the standard to become. */
export type StandardChoice = { state: "proposed"; value: string } | { state: "tbc" } | null;

export type StandardWriteResult = {
  attributeId: string;
  recordId: string;
  kind: ChangeSetKind;
  standard: { value: string | null; state: StandardState } | null;
  answersFilled: number;
  answersRetracted: number;
  snapshotNo: number | null;
  changeSetId: string;
};

type LockedAttribute = {
  id: string;
  recordId: string;
  projectId: string;
  label: string;
  jsonId: number | null;
  state: StandardState | null;
  value: string | null;
};

async function lockAttribute(txn: TxnSql, attributeId: string, expectedVersion: number): Promise<LockedAttribute> {
  const rows = await txn`
    select a.id, a.record_id, a.label, a.status, a.version, a.standard_state, a.standard_value,
           f.json_id, r.project_id
    from record_attributes a
    join spec_records r on r.id = a.record_id
    left join spec_fields f on f.id = a.spec_field_id
    where a.id = ${attributeId}
    for update of a
  `;
  const row = rows[0];
  if (!row) throw new DomainConflictError("not_found", "No such spec.", { status: 404 });
  if (String(row.status) !== "active") {
    throw new DomainConflictError(
      "already_retired",
      "That spec has been taken off this item, so it has no BW standard to set. Reload.",
    );
  }
  if (Number(row.version) !== expectedVersion) {
    throw new DomainConflictError(
      "attribute_version_stale",
      `“${String(row.label)}” changed while you had it open. Reload before setting its BW standard.`,
    );
  }
  return {
    id: String(row.id),
    recordId: String(row.record_id),
    projectId: String(row.project_id),
    label: String(row.label),
    jsonId: row.json_id === null || row.json_id === undefined ? null : Number(row.json_id),
    state: isStandardState(row.standard_state) ? row.standard_state : null,
    value: row.standard_value === null || row.standard_value === undefined ? null : String(row.standard_value),
  };
}

/** The version-checked write of the six columns. Zero rows means somebody moved it. */
async function writeStandard(
  txn: TxnSql,
  attribute: LockedAttribute,
  expectedVersion: number,
  next: { value: string | null; optionId: string | null; state: StandardState | null; evidenceId: string | null },
  actor: string,
): Promise<void> {
  const written = await txn`
    update record_attributes
    set standard_value = ${next.value},
        standard_option_id = ${next.optionId},
        standard_state = ${next.state},
        standard_set_by = ${next.state === null ? null : actor},
        standard_set_at = ${next.state === null ? null : new Date().toISOString()},
        standard_agreed_evidence_id = ${next.evidenceId},
        updated_by = ${actor}
    where id = ${attribute.id} and version = ${expectedVersion} and status = 'active'
    returning id
  `;
  if (!written[0]) {
    throw new DomainConflictError("attribute_version_stale", "That spec changed as you saved. Nothing was written — reload.");
  }
}

async function recomposeAndVersion(
  txn: TxnSql,
  attribute: LockedAttribute,
  changeSetId: string,
  actor: string,
): Promise<{ filled: number; retracted: number; snapshotNo: number | null }> {
  // `runId` null: a standard is not a document, and every fill that survives
  // already carries the run that supplied its value.
  const { filled, retracted } = await recomposeAnswers(txn, attribute.recordId, null, actor);
  const snapshots = await snapshotRecords(txn, [attribute.recordId], changeSetId);
  return { filled, retracted, snapshotNo: snapshots.get(attribute.recordId) ?? null };
}

/**
 * Propose a BW standard, say one is TBC, or take one away.
 *
 * The option is named by its VALUE and resolved here against the attribute's
 * own field's palette by the exact step -- a client never names an option id,
 * and the nearest option is never taken.
 */
export async function setAttributeStandard(
  txn: TxnSql,
  {
    attributeId,
    expectedVersion,
    choice,
    reason,
    evidence,
    actor,
  }: {
    attributeId: string;
    expectedVersion: number;
    choice: StandardChoice;
    reason?: string | null;
    evidence?: UploadedEvidence | null;
    actor: string;
  },
): Promise<StandardWriteResult> {
  const attribute = await lockAttribute(txn, attributeId, expectedVersion);

  let next: { value: string | null; optionId: string | null; state: StandardState | null };
  if (choice === null) {
    if (attribute.state === null) {
      throw new DomainConflictError("standard_unchanged", `“${attribute.label}” has no BW standard to take away.`, {
        status: 400,
      });
    }
    next = { value: null, optionId: null, state: null };
  } else if (choice.state === "tbc") {
    next = { value: null, optionId: null, state: "tbc" };
  } else {
    const palette = attribute.jsonId === null ? null : (palettesByFieldJsonId(await loadPalettes(txn)).get(attribute.jsonId) ?? null);
    const option = palette ? paletteOptionFor(palette, choice.value) : null;
    if (!palette) {
      throw new DomainConflictError(
        "no_palette",
        `“${attribute.label}” is not on a BWS field with a BWS list, so it has no BW standard to choose.`,
        { status: 400 },
      );
    }
    if (!option?.id) {
      throw new DomainConflictError(
        "standard_not_on_palette",
        `That is not one of the ${palette.name} options, so it cannot be the BW standard.`,
        { status: 400 },
      );
    }
    next = { value: option.value, optionId: option.id, state: "proposed" };
  }

  if (next.state === attribute.state && next.value === attribute.value) {
    throw new DomainConflictError("standard_unchanged", "That is already the BW standard on this spec.", { status: 400 });
  }

  // Changing or withdrawing what the CLIENT agreed to asks why; nothing else
  // does. `changeSetForEdit` still attaches to an open change, and an open
  // change satisfies the reason -- as for every other kind that needs one.
  const kind: ChangeSetKind = attribute.state === "agreed" ? "standard_change" : "standard_set";
  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: attribute.projectId,
    actor,
    kind,
    reason,
    evidence,
  });

  await writeStandard(txn, attribute, expectedVersion, { ...next, evidenceId: null }, actor);
  const { filled, retracted, snapshotNo } = await recomposeAndVersion(txn, attribute, changeSetId, actor);

  return {
    attributeId: attribute.id,
    recordId: attribute.recordId,
    kind,
    standard: next.state === null ? null : { value: next.value, state: next.state },
    answersFilled: filled,
    answersRetracted: retracted,
    snapshotNo,
    changeSetId,
  };
}

/**
 * The client agreed to the BW standard proposed beside their words.
 *
 * Only a PROPOSED standard can be agreed: there is nothing to agree to on a
 * TBC one, and agreeing twice would be a second change set saying nothing.
 * The evidence -- the client's "yes, fine" -- goes on the change set through
 * the existing evidence path, and the attribute points at the same
 * attachment. Where the reviewer's OPEN change already carries an email, that
 * email is the evidence.
 */
export async function agreeAttributeStandard(
  txn: TxnSql,
  {
    attributeId,
    expectedVersion,
    evidence,
    reason,
    actor,
  }: {
    attributeId: string;
    expectedVersion: number;
    evidence?: UploadedEvidence | null;
    reason?: string | null;
    actor: string;
  },
): Promise<StandardWriteResult> {
  const attribute = await lockAttribute(txn, attributeId, expectedVersion);
  if (attribute.state === "agreed") {
    throw new DomainConflictError("already_agreed", "The client has already agreed to this BW standard.", { status: 400 });
  }
  if (attribute.state !== "proposed" || !attribute.value) {
    throw new DomainConflictError(
      "nothing_to_agree",
      `“${attribute.label}” has no BW standard proposed, so there is nothing for the client to agree to yet.`,
      { status: 400 },
    );
  }

  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: attribute.projectId,
    actor,
    kind: "standard_agreed",
    reason,
    evidence,
  });
  const evidenceRows = await txn`select evidence_attachment_id from change_sets where id = ${changeSetId}`;
  const evidenceId = evidenceRows[0]?.evidence_attachment_id ? String(evidenceRows[0].evidence_attachment_id) : null;

  // The option is not re-resolved: it was resolved when it was proposed and
  // the client agreed to THAT one. Read back from the row, verbatim.
  const optionRows = await txn`select standard_option_id from record_attributes where id = ${attribute.id}`;
  const optionId = optionRows[0]?.standard_option_id ? String(optionRows[0].standard_option_id) : null;

  await writeStandard(
    txn,
    attribute,
    expectedVersion,
    { value: attribute.value, optionId, state: "agreed", evidenceId },
    actor,
  );
  const { filled, retracted, snapshotNo } = await recomposeAndVersion(txn, attribute, changeSetId, actor);

  return {
    attributeId: attribute.id,
    recordId: attribute.recordId,
    kind: "standard_agreed",
    standard: { value: attribute.value, state: "agreed" },
    answersFilled: filled,
    answersRetracted: retracted,
    snapshotNo,
    changeSetId,
  };
}
