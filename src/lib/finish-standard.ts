// BW's own finish for a client CODE, set once in the finishes library (0045).
//
// ============================================================================
// THE WORKFLOW IS 0041'S; THE ROW IS THE CODE'S.
//
// Max, 2026-10-05: "BW own finishes should be set once per code in the
// finishes library", applying to every item carrying the code. Per code only,
// no per-item override. The acts are exactly `attribute-standard.ts`'s --
// propose an option, say one is TBC, take it away, record that the client
// agreed, change an agreed one with a reason -- written on `project_finishes`
// instead of on one `record_attributes` row. That file's header carries why an
// update in place is right for a standard when a correction is a supersession;
// it holds here unchanged.
//
// ---- WHAT EACH ACT OPENS, AND WHAT IT REACHES ------------------------------
//
//   * `standard_set` -- a proposal, a TBC, or taking away one never agreed.
//   * `standard_change` -- changing or withdrawing one the client AGREED to.
//     A reason is required, by the database as well as here.
//   * `standard_agreed` -- the client said yes; the email, where there is one,
//     goes on the change set and the finish points at it.
//
// Each is ONE change set. It then reaches EVERY item carrying the code through
// `carryFinishToItems` -- the same loop a library edit uses, not a copy of it:
// each linked record's checklist is recomposed (the answer is a projection of
// the attributes and the library, never written here) and each takes ONE
// version, so "why does this chair say BW Oak Grey now" is answerable on the
// chair. `spec_records.version` is never touched.
//
// ---- THE OPTION IS THE SERVER'S TO RESOLVE --------------------------------
//
// The client names an option by its VALUE. Which list it must come from is
// `paletteForFinish`, read here off the LIVE uses and the live register --
// the same pure function the library screen offered the list from -- and the
// option is resolved by `paletteOptionFor`'s exact step. A value on no list,
// or a code with no list at all, is refused in words; the nearest option is
// never taken.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit, type ChangeSetKind, type UploadedEvidence } from "@/lib/change-sets";
import { carryFinishToItems } from "@/lib/finish-edit";
import { loadPalettes, palettesByFieldJsonId } from "@/lib/palette-load";
import { paletteOptionFor } from "@/lib/palettes";
import { isStandardState, type StandardState } from "@/lib/bw-standard";
import { isFinishKind, type FinishKind } from "@/lib/finishes";
import { paletteForFinish, type FinishPaletteReading } from "@/lib/finish-standard-palette";
import type { StandardChoice } from "@/lib/attribute-standard";
import type { SqlLike } from "@/lib/record-atoms";

export type FinishStandardResult = {
  finishId: string;
  code: string;
  kind: ChangeSetKind;
  standard: { value: string | null; state: StandardState } | null;
  /** Every active item carrying the code: what this reached. */
  recordsTouched: number;
  answersFilled: number;
  /** Linked items whose answer a person typed, so it did not follow. */
  recordsWithManualAnswers: { recordId: string; label: string }[];
  changeSetId: string;
};

type LockedFinish = {
  id: string;
  projectId: string;
  code: string;
  kind: FinishKind | null;
  state: StandardState | null;
  value: string | null;
  optionId: string | null;
};

async function lockFinish(
  txn: TxnSql,
  projectId: string,
  finishId: string,
  expectedVersion: number,
): Promise<LockedFinish> {
  const rows = await txn`
    select id, project_id, code, kind, status, version, standard_value, standard_option_id, standard_state
    from project_finishes
    where id = ${finishId}
    for update
  `;
  const row = rows[0];
  if (!row) throw new DomainConflictError("not_found", "No such finish.", { status: 404 });
  if (String(row.project_id) !== projectId) {
    throw new DomainConflictError("wrong_project", "That finish belongs to another project.", { status: 400 });
  }
  if (String(row.status) !== "active") {
    throw new DomainConflictError("retired", "That finish has been retired. Put it back before setting its BW finish.");
  }
  if (Number(row.version) !== expectedVersion) {
    throw new DomainConflictError(
      "finish_version_stale",
      `“${String(row.code)}” was changed by someone else while you had it open. Reload before setting its BW finish.`,
    );
  }
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    code: String(row.code),
    kind: isFinishKind(row.kind) ? row.kind : null,
    state: isStandardState(row.standard_state) ? row.standard_state : null,
    value: row.standard_value === null || row.standard_value === undefined ? null : String(row.standard_value),
    optionId:
      row.standard_option_id === null || row.standard_option_id === undefined ? null : String(row.standard_option_id),
  };
}

/**
 * Which list this code's BW finish comes from, read off its LIVE uses.
 *
 * Exported because the library's GET answers the same question for the
 * screen, and two readings of "which fields does this code sit in" is how the
 * list offered and the list accepted come apart.
 */
export async function readFinishPalette(
  exec: SqlLike,
  finish: { id: string; kind: FinishKind | null },
): Promise<FinishPaletteReading> {
  const uses = await exec`
    select f.json_id, f.name as field_name
    from record_attributes a
    join spec_records r on r.id = a.record_id
    left join spec_fields f on f.id = a.spec_field_id
    where a.finish_id = ${finish.id} and a.status = 'active' and r.status = 'active'
  `;
  const register = await loadPalettes(exec);
  return paletteForFinish(
    finish,
    uses.map((use) => ({
      jsonId: use.json_id === null || use.json_id === undefined ? null : Number(use.json_id),
      fieldName: use.field_name === null || use.field_name === undefined ? null : String(use.field_name),
    })),
    palettesByFieldJsonId(register),
  );
}

/** The version-checked write of the six columns. Zero rows means somebody moved it. */
async function writeStandard(
  txn: TxnSql,
  finish: LockedFinish,
  expectedVersion: number,
  next: { value: string | null; optionId: string | null; state: StandardState | null; evidenceId: string | null },
  actor: string,
): Promise<void> {
  const written = await txn`
    update project_finishes
    set standard_value = ${next.value},
        standard_option_id = ${next.optionId},
        standard_state = ${next.state},
        standard_set_by = ${next.state === null ? null : actor},
        standard_set_at = ${next.state === null ? null : new Date().toISOString()},
        standard_agreed_evidence_id = ${next.evidenceId},
        updated_by = ${actor}
    where id = ${finish.id} and version = ${expectedVersion} and status = 'active'
    returning id
  `;
  if (!written[0]) {
    throw new DomainConflictError("finish_version_stale", "That finish changed as you saved. Nothing was written — reload.");
  }
}

/**
 * Propose BW's own finish for a code, say it is TBC, or take it away.
 *
 * The option is named by its VALUE and resolved here against the list this
 * code's uses offer (`paletteForFinish`) by the exact step.
 */
export async function setFinishStandard(
  txn: TxnSql,
  {
    projectId,
    finishId,
    expectedVersion,
    choice,
    reason,
    evidence,
    actor,
  }: {
    projectId: string;
    finishId: string;
    expectedVersion: number;
    choice: StandardChoice;
    reason?: string | null;
    evidence?: UploadedEvidence | null;
    actor: string;
  },
): Promise<FinishStandardResult> {
  const finish = await lockFinish(txn, projectId, finishId, expectedVersion);

  let next: { value: string | null; optionId: string | null; state: StandardState | null };
  if (choice === null) {
    if (finish.state === null) {
      throw new DomainConflictError("standard_unchanged", `${finish.code} has no BW finish to take away.`, { status: 400 });
    }
    next = { value: null, optionId: null, state: null };
  } else {
    // A TBC is refused on a code with no list too: "BW will propose one" is a
    // promise to choose from a list, and there is none to choose from.
    const reading = await readFinishPalette(txn, finish);
    if (!reading.palette) {
      throw new DomainConflictError("no_palette", `${finish.code} has no BW finish to choose: ${reading.why}`, {
        status: 400,
      });
    }
    if (choice.state === "tbc") {
      next = { value: null, optionId: null, state: "tbc" };
    } else {
      const option = paletteOptionFor(reading.palette, choice.value);
      if (!option?.id) {
        throw new DomainConflictError(
          "standard_not_on_palette",
          `That is not one of the ${reading.palette.name} options, so it cannot be BW's finish for ${finish.code}.`,
          { status: 400 },
        );
      }
      next = { value: option.value, optionId: option.id, state: "proposed" };
    }
  }

  if (next.state === finish.state && next.value === finish.value) {
    throw new DomainConflictError("standard_unchanged", `That is already BW's finish for ${finish.code}.`, { status: 400 });
  }

  // Changing or withdrawing what the CLIENT agreed to asks why; nothing else
  // does. An open change satisfies the reason, as for every kind that needs one.
  const kind: ChangeSetKind = finish.state === "agreed" ? "standard_change" : "standard_set";
  const { changeSetId } = await changeSetForEdit(txn, { projectId, actor, kind, reason, evidence });

  await writeStandard(txn, finish, expectedVersion, { ...next, evidenceId: null }, actor);
  const carried = await carryFinishToItems(txn, { finishId: finish.id, changeSetId, actor });

  return {
    finishId: finish.id,
    code: finish.code,
    kind,
    standard: next.state === null ? null : { value: next.value, state: next.state },
    ...carried,
    changeSetId,
  };
}

/**
 * The client agreed to BW's finish proposed for this code.
 *
 * Only a PROPOSED one can be agreed. The evidence -- their "yes, fine" -- goes
 * on the change set through the existing evidence path, and the finish points
 * at the same attachment. The option is not re-resolved: the client agreed to
 * THAT one, read back from the row verbatim.
 */
export async function agreeFinishStandard(
  txn: TxnSql,
  {
    projectId,
    finishId,
    expectedVersion,
    evidence,
    reason,
    actor,
  }: {
    projectId: string;
    finishId: string;
    expectedVersion: number;
    evidence?: UploadedEvidence | null;
    reason?: string | null;
    actor: string;
  },
): Promise<FinishStandardResult> {
  const finish = await lockFinish(txn, projectId, finishId, expectedVersion);
  if (finish.state === "agreed") {
    throw new DomainConflictError("already_agreed", `The client has already agreed to BW's finish for ${finish.code}.`, {
      status: 400,
    });
  }
  if (finish.state !== "proposed" || !finish.value) {
    throw new DomainConflictError(
      "nothing_to_agree",
      `${finish.code} has no BW finish proposed, so there is nothing for the client to agree to yet.`,
      { status: 400 },
    );
  }

  const { changeSetId } = await changeSetForEdit(txn, { projectId, actor, kind: "standard_agreed", reason, evidence });
  const evidenceRows = await txn`select evidence_attachment_id from change_sets where id = ${changeSetId}`;
  const evidenceId = evidenceRows[0]?.evidence_attachment_id ? String(evidenceRows[0].evidence_attachment_id) : null;

  await writeStandard(
    txn,
    finish,
    expectedVersion,
    { value: finish.value, optionId: finish.optionId, state: "agreed", evidenceId },
    actor,
  );
  const carried = await carryFinishToItems(txn, { finishId: finish.id, changeSetId, actor });

  return {
    finishId: finish.id,
    code: finish.code,
    kind: "standard_agreed",
    standard: { value: finish.value, state: "agreed" },
    ...carried,
    changeSetId,
  };
}
