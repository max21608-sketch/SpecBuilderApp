// A bill line's configurations, loaded together, and an edit to what they
// have in common fanned out to every one of them.
//
// ============================================================================
// ONE ACT, EVERY CONFIGURATION, OR NOTHING.
//
// `configuration-common.ts` decides what is common; this is where an edit to
// a common row is made. Correcting S-301's seat height on line 12 writes the
// SAME correction to 12.1 … 12.5 — five records, ONE change set, one version
// each — through the single-record verbs that already hold every rule about a
// spec: `correctAttribute` (supersession, retire-before-insert, the finish
// re-link), `createAttribute` (the slot and field guards), `retireAttribute`
// (recompose the answers it filled) and `editAnswer` (the optimistic lock on
// an answer). None of those rules is copied here; each verb is called with the
// change handed in and `snapshot: false`, and the records are versioned once
// at the end, as `POST /api/projects/[id]/answers/apply` does.
//
// ---- WHAT MAKES IT REFUSE -----------------------------------------------
//
// The screen showed a set of configurations and a set of rows, each at a
// version. The edit is REFUSED WHOLE, in words, with nothing written, if any
// of that moved:
//
//   * the set of live configurations is not the one the screen showed — a
//     configuration added or retired since would otherwise be edited unseen,
//     or left out of an edit that claims to be "all of them";
//   * any row's version is not the one the screen showed — somebody changed
//     it on the configuration's own screen, deliberately, and a common edit
//     must not quietly overwrite that;
//   * the group is not COMMON any more, read again here off the live rows
//     under the lock — the trap this whole feature is built around: a
//     "common" edit landing on a configuration that has since been made
//     different.
//
// A partial write is not possible: every verb runs in the one transaction
// `withTransaction` holds, and any refusal rolls all of them back.
//
// THE LOCKS, IN ORDER: the project row (the one `insertVariant` takes before
// it adds a configuration, so none can be added while this reads the set),
// then the configurations in id order (the order `snapshotRecords` takes
// them), then each verb's own row lock.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import type { SqlLike } from "@/lib/record-atoms";
import { changeSetForEdit, findOpenChangeSet, openChangeSet, publishChangeSet } from "@/lib/change-sets";
import { correctAttribute } from "@/lib/attribute-correct";
import { retireAttribute } from "@/lib/attribute-retire";
import { createAttribute } from "@/lib/manual-capture";
import { editAnswer } from "@/lib/answer-edit";
import { snapshotRecords } from "@/lib/record-snapshot";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";
import { recordShortLabel } from "@/lib/record-label";
import {
  commonGroupKey,
  readCommonAnswers,
  readCommonSpecs,
  type CommonSourceAnswer,
  type CommonSourceAttribute,
  type CommonSourceConfiguration,
} from "@/lib/configuration-common";
import {
  isAttributeGroup,
  isDimensionSlot,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";

/** An attribute with what the screen prints beside it: its page, its finish. */
export type FamilyAttribute = CommonSourceAttribute & {
  jsonId: number | null;
  materialCode: string | null;
  finishId: string | null;
  finishCode: string | null;
  finishState: string | null;
  sourceRunId: string | null;
  sourcePage: number | null;
  sourceFilename: string | null;
};

export type FamilyConfiguration = CommonSourceConfiguration<FamilyAttribute> & {
  recordNo: number;
  variantOrdinal: number;
  answers: CommonSourceAnswer[];
};

export type ConfigurationFamily = {
  lineId: string;
  lineRecordNo: number;
  projectId: string;
  configurations: FamilyConfiguration[];
};

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/**
 * Every ACTIVE configuration of one bill line, in their natural order (by
 * 0039's number under the line), with their live attributes and checklist
 * answers.
 *
 * Bounded by what a line has — S-301 has five — so it is one request with the
 * record screen rather than a round trip per configuration. With `lock`, the
 * project row and the configurations are locked first (see the header): the
 * edit path reads the set it is about to write through this same loader, so
 * the screen and the check cannot disagree about what "the configurations"
 * are.
 *
 * Null where the record is not a bill line (it is itself a configuration) or
 * does not exist.
 */
export async function loadConfigurationFamily(
  exec: SqlLike,
  lineId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<ConfigurationFamily | null> {
  const lines = await exec`
    select id, record_no, project_id, parent_id from spec_records where id = ${lineId}
  `;
  const line = lines[0];
  if (!line || line.parent_id) return null;
  const projectId = String(line.project_id);

  if (lock) {
    await exec`select id from projects where id = ${projectId} for update`;
    await exec`
      select id from spec_records
       where parent_id = ${lineId} and status = 'active'
       order by id
         for update
    `;
  }

  const records = await exec`
    select id, record_no, variant_ordinal, variant_label, version
      from spec_records
     where parent_id = ${lineId} and status = 'active'
     order by variant_ordinal, record_no
  `;
  const ids = records.map((row) => String(row.id));
  if (ids.length === 0) return { lineId, lineRecordNo: Number(line.record_no), projectId, configurations: [] };

  const attributes = await exec`
    select a.id, a.record_id, a.version, a.attr_group, a.label, a.value, a.unit, a.qualifier, a.state,
           a.dimension_slot, a.spec_field_id, a.sort_order, a.material_code, a.finish_id,
           a.source_run_id, a.source_page,
           f.name as field_name, f.json_id,
           fin.code as finish_code, fin.state as finish_state,
           src.filename as source_filename
      from record_attributes a
      left join spec_fields f on f.id = a.spec_field_id
      left join project_finishes fin on fin.id = a.finish_id
      left join (
        select r.id, at.filename from intake_runs r left join attachments at on at.id = r.attachment_id
      ) src on src.id = a.source_run_id
     where a.record_id = any(${ids}::uuid[]) and a.status = 'active'
     order by a.sort_order, a.created_at
  `;

  // The checklist, driven off each configuration's own category the way the
  // record route drives it: a question with no answer row is still asked, as
  // missing, and carries a null answer id.
  const answers = await exec`
    select r.id as record_id, q.id as requirement_id, q.prompt, q.sort_order, f.json_id, q.local_key,
           a.id as answer_id, a.value, a.qualifier, coalesce(a.state, 'missing') as state, a.version
      from spec_records r
      join requirements q on q.category_id = r.category_id
      left join spec_fields f on f.id = q.spec_field_id
      left join spec_answers a on a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
     where r.id = any(${ids}::uuid[])
     order by q.sort_order
  `;

  const configurations: FamilyConfiguration[] = records.map((row) => {
    const recordId = String(row.id);
    const variantOrdinal = Number(row.variant_ordinal);
    return {
      recordId,
      recordNo: Number(row.record_no),
      variantOrdinal,
      number: recordShortLabel({
        recordNo: Number(row.record_no),
        parentRecordNo: Number(line.record_no),
        variantOrdinal,
      }),
      variantLabel: String(row.variant_label ?? ""),
      version: Number(row.version),
      attributes: attributes
        .filter((attribute) => String(attribute.record_id) === recordId)
        .map((attribute) => ({
          id: String(attribute.id),
          version: Number(attribute.version),
          attrGroup: (isAttributeGroup(attribute.attr_group) ? attribute.attr_group : "other") as AttributeGroup,
          label: String(attribute.label),
          value: text(attribute.value),
          unit: text(attribute.unit) as AttributeUnit | null,
          qualifier: text(attribute.qualifier),
          state: String(attribute.state) as AttributeState,
          dimensionSlot: isDimensionSlot(attribute.dimension_slot) ? attribute.dimension_slot : null,
          specFieldId: text(attribute.spec_field_id),
          fieldName: text(attribute.field_name),
          sortOrder: Number(attribute.sort_order ?? 0),
          jsonId: num(attribute.json_id),
          materialCode: text(attribute.material_code),
          finishId: text(attribute.finish_id),
          finishCode: text(attribute.finish_code),
          finishState: text(attribute.finish_state),
          sourceRunId: text(attribute.source_run_id),
          sourcePage: num(attribute.source_page),
          sourceFilename: text(attribute.source_filename),
        })),
      answers: answers
        .filter((answer) => String(answer.record_id) === recordId)
        .map((answer) => ({
          answerId: text(answer.answer_id),
          requirementId: String(answer.requirement_id),
          prompt: String(answer.prompt ?? ""),
          jsonId: num(answer.json_id),
          localKey: text(answer.local_key),
          value: text(answer.value),
          qualifier: text(answer.qualifier),
          state: String(answer.state),
          version: num(answer.version),
        })),
    };
  });

  return { lineId, lineRecordNo: Number(line.record_no), projectId, configurations };
}

// ---------------------------------------------------------------------------
// The edit
// ---------------------------------------------------------------------------

export type SeenAttribute = { attributeId: string; version: number };
export type SeenRecord = { recordId: string; version: number };
export type SeenAnswer = { answerId: string; version: number };

export type CommonEdit =
  | {
      op: "correct";
      groupKey: string;
      value: string | null;
      unit: AttributeUnit | null;
      state: AttributeState;
      reason?: string | null;
      configurations: string[];
      seen: SeenAttribute[];
    }
  | {
      op: "retire";
      groupKey: string;
      reason: string;
      configurations: string[];
      seen: SeenAttribute[];
    }
  | {
      op: "add";
      attrGroup: AttributeGroup;
      label: string;
      value: string | null;
      unit?: AttributeUnit | null;
      qualifier?: string | null;
      dimensionSlot?: DimensionSlot | null;
      specFieldId?: string | null;
      state: AttributeState;
      reason?: string | null;
      seen: SeenRecord[];
    }
  | {
      op: "answer";
      requirementId: string;
      value: string | null;
      qualifier?: string | null;
      state: "confirmed" | "tbc" | "na";
      reason?: string | null;
      configurations: string[];
      seen: SeenAnswer[];
    };

export type CommonEditResult = {
  changeSetId: string;
  attachedToOpenChange: boolean;
  /** One entry per configuration written, in natural order, with its new version. */
  written: { recordId: string; number: string; snapshotNo: number | null }[];
  /** Corrections whose new wording no longer matched the linked finish, so the new row is unlinked. */
  finishesUnlinked: number;
};

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/** The configuration set the screen showed, against the live one, in words. */
function assertConfigurationSet(family: ConfigurationFamily, shown: readonly string[]): void {
  const live = family.configurations.map((configuration) => configuration.recordId);
  if (sameSet(live, shown)) return;
  const added = family.configurations.filter((configuration) => !shown.includes(configuration.recordId));
  const gone = shown.filter((id) => !live.includes(id)).length;
  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.map((configuration) => configuration.number).join(", ")} ${added.length === 1 ? "was" : "were"} added`);
  if (gone > 0) parts.push(`${gone} ${gone === 1 ? "was" : "were"} retired`);
  throw new DomainConflictError(
    "configurations_changed",
    `The configurations of this line changed since the screen loaded (${parts.join("; ") || "the set is different"}). Nothing was written — reload, check the common specs again, and make the edit once more.`,
  );
}

/**
 * Makes one edit to a common row, on every configuration, as one change.
 *
 * `lineId` is the bill line; the configurations are read off it here, under
 * the lock, never taken from the request — the request only says which ones
 * the screen SHOWED, so a difference can be refused.
 */
export async function editCommonSpec(
  txn: TxnSql,
  { lineId, edit, actor }: { lineId: string; edit: CommonEdit; actor: string },
): Promise<CommonEditResult> {
  const family = await loadConfigurationFamily(txn, lineId, { lock: true });
  if (!family) {
    throw new DomainConflictError("not_a_bill_line", "That record is not a bill line with configurations.", { status: 404 });
  }
  if (family.configurations.length < 2) {
    throw new DomainConflictError(
      "not_split",
      "This line has fewer than two live configurations, so there is nothing common to edit. Edit the configuration on its own screen.",
    );
  }
  const numberOf = new Map(family.configurations.map((configuration) => [configuration.recordId, configuration.number]));

  if (edit.op === "add") {
    // The configuration set IS the seen list here: an add has no rows to have
    // seen, only the records it will write to.
    assertConfigurationSet(
      family,
      edit.seen.map((row) => row.recordId),
    );
    for (const row of edit.seen) {
      const live = family.configurations.find((configuration) => configuration.recordId === row.recordId)!;
      if (live.version !== row.version) {
        throw new DomainConflictError(
          "record_version_stale",
          `${live.number} changed since the screen loaded. Nothing was written — reload before adding it to every configuration.`,
        );
      }
    }
    const key = commonGroupKey({
      dimensionSlot: edit.dimensionSlot ?? null,
      specFieldId: edit.dimensionSlot ? null : (edit.specFieldId ?? null),
      attrGroup: edit.attrGroup,
      label: edit.label,
    });
    const holders = family.configurations.filter((configuration) =>
      configuration.attributes.some((attribute) => commonGroupKey(attribute) === key),
    );
    if (holders.length > 0) {
      throw new DomainConflictError(
        "already_there",
        `${holders.map((configuration) => configuration.number).join(", ")} already ${holders.length === 1 ? "holds" : "hold"} that spec. Nothing was written — correct it where it is common, or on the configuration's own screen where it differs.`,
      );
    }

    const description = `${edit.label.trim()}${edit.value?.trim() ? `: ${edit.value.trim()}` : ""} — on all ${family.configurations.length} configurations`;
    const change = await resolveChange(txn, {
      projectId: family.projectId,
      actor,
      kind: "attribute_create",
      reason: edit.reason ?? null,
      fallbackReason: description.slice(0, 200),
    });

    const written: CommonEditResult["written"] = [];
    for (const configuration of [...family.configurations].sort((a, b) => a.recordId.localeCompare(b.recordId))) {
      await createAttribute(txn, {
        recordId: configuration.recordId,
        attrGroup: edit.attrGroup,
        label: edit.label,
        value: edit.value,
        qualifier: edit.qualifier ?? null,
        unit: edit.unit ?? null,
        dimensionSlot: edit.dimensionSlot ?? null,
        specFieldId: edit.specFieldId ?? null,
        state: edit.state,
        actor,
        changeSetId: change.changeSetId,
        snapshot: false,
      });
      written.push({ recordId: configuration.recordId, number: configuration.number, snapshotNo: null });
    }
    return finish(txn, family, change, written, 0);
  }

  assertConfigurationSet(family, edit.configurations);

  if (edit.op === "answer") {
    const group = readCommonAnswers(family.configurations).find((entry) => entry.requirementId === edit.requirementId);
    if (!group) {
      throw new DomainConflictError("not_found", "None of these configurations asks that question.", { status: 404 });
    }
    if (group.jsonId === DIMENSIONS_JSON_ID) {
      throw new DomainConflictError(
        "dimension_not_an_answer",
        "Dimensions are recorded as specs, slot by slot — correct the common W, D, H or SH on the Specs tab instead.",
        { status: 400 },
      );
    }
    if (group.status !== "common") {
      throw new DomainConflictError(
        "not_common",
        `“${group.prompt}” is no longer answered the same on every configuration. Nothing was written — reload, and change it on each configuration where it differs.`,
      );
    }
    assertSeen(
      group.members.map((member) => ({
        id: member.answer?.answerId ?? `none:${member.recordId}`,
        version: member.answer?.version ?? -1,
        where: member.number,
      })),
      edit.seen.map((row) => ({ id: row.answerId, version: row.version })),
      `“${group.prompt}”`,
    );
    if (edit.state === "confirmed" && !edit.value?.trim()) {
      throw new DomainConflictError("value_required", "Confirmed needs a value. Use TBC if it is not decided yet.", {
        status: 400,
      });
    }
    const missingRow = group.members.find((member) => !member.answer?.answerId);
    if (missingRow) {
      throw new DomainConflictError(
        "no_answer_row",
        `${missingRow.number} has no answer row for “${group.prompt}” yet. Open it once to create its checklist, then answer this again.`,
      );
    }

    // A SETTLED ANSWER IS OVERRIDDEN ONLY WITH A REASON, or inside a change the
    // person already opened — `editAnswer`'s rule, stated here because a
    // handed-in change satisfies it there, and the change is this function's.
    const overriding =
      group.shared?.state === "confirmed" &&
      ((group.shared.value ?? "").trim() !== (edit.value ?? "").trim() ||
        (group.shared.qualifier ?? "").trim() !== (edit.qualifier ?? "").trim() ||
        edit.state !== "confirmed");
    if (overriding && !edit.reason?.trim() && !(await findOpenChangeSet(txn, family.projectId, actor))) {
      throw new DomainConflictError(
        "reason_required",
        `“${group.prompt}” is already confirmed on every configuration. Say why it is changing, or open a change first.`,
        { status: 400 },
      );
    }
    const change = await resolveChange(txn, {
      projectId: family.projectId,
      actor,
      kind: "manual_edit",
      reason: edit.reason ?? null,
      fallbackReason: `Answered “${group.prompt}” once for all ${family.configurations.length} configurations.`,
    });
    const written: CommonEditResult["written"] = [];
    const ordered = [...group.members].sort((a, b) => a.answer!.answerId!.localeCompare(b.answer!.answerId!));
    for (const member of ordered) {
      await editAnswer(txn, {
        answerId: member.answer!.answerId!,
        value: edit.value,
        qualifier: edit.qualifier,
        state: edit.state,
        expectedVersion: member.answer!.version!,
        actor,
        changeSetId: change.changeSetId,
        snapshot: false,
      });
      written.push({ recordId: member.recordId, number: numberOf.get(member.recordId) ?? "", snapshotNo: null });
    }
    return finish(txn, family, change, written, 0);
  }

  // ---- correct | retire: a common ATTRIBUTE row --------------------------
  const group = readCommonSpecs(family.configurations).groups.find((entry) => entry.key === edit.groupKey);
  if (!group) {
    throw new DomainConflictError(
      "group_gone",
      "That spec is no longer on these configurations. Nothing was written — reload.",
    );
  }
  if (group.status !== "common") {
    throw new DomainConflictError(
      "not_common",
      `${group.title} is no longer the same on every configuration. Nothing was written — reload, and change it on each configuration where it differs.`,
    );
  }
  assertSeen(
    group.members.map((member) => ({ id: member.rows[0]!.id, version: member.rows[0]!.version, where: member.number })),
    edit.seen.map((row) => ({ id: row.attributeId, version: row.version })),
    group.title,
  );

  const members = [...group.members].sort((a, b) => a.recordId.localeCompare(b.recordId));
  const written: CommonEditResult["written"] = [];
  let finishesUnlinked = 0;

  if (edit.op === "correct") {
    if (edit.state === "confirmed" && !edit.value?.trim()) {
      throw new DomainConflictError(
        "value_required",
        "A confirmed spec has to carry a value. Record it as TBC if it is not decided.",
        { status: 400 },
      );
    }
    const change = await resolveChange(txn, {
      projectId: family.projectId,
      actor,
      kind: "attribute_correct",
      reason: edit.reason ?? null,
      fallbackReason: null,
    });
    for (const member of members) {
      const row = member.rows[0]!;
      const result = await correctAttribute(txn, {
        attributeId: row.id,
        expectedVersion: row.version,
        value: edit.value?.trim() || null,
        unit: group.attrGroup === "dimension" ? edit.unit : null,
        state: edit.state,
        reason: edit.reason?.trim() || "",
        actor,
        changeSetId: change.changeSetId,
        snapshot: false,
      });
      if (result.finishUnlinked) finishesUnlinked += 1;
      written.push({ recordId: member.recordId, number: member.number, snapshotNo: null });
    }
    return finish(txn, family, change, written, finishesUnlinked);
  }

  const change = await resolveChange(txn, {
    projectId: family.projectId,
    actor,
    kind: "attribute_retire",
    reason: edit.reason,
    fallbackReason: null,
  });
  for (const member of members) {
    const row = member.rows[0]!;
    await retireAttribute(txn, {
      attributeId: row.id,
      expectedVersion: row.version,
      reason: edit.reason,
      actor,
      changeSetId: change.changeSetId,
      snapshot: false,
    });
    written.push({ recordId: member.recordId, number: member.number, snapshotNo: null });
  }
  return finish(txn, family, change, written, 0);
}

/**
 * The rows the screen showed, against the rows that are there, by id AND
 * version — refused naming the configuration whose row moved.
 */
function assertSeen(
  live: { id: string; version: number; where: string }[],
  seen: { id: string; version: number }[],
  what: string,
): void {
  const byId = new Map(seen.map((row) => [row.id, row.version]));
  for (const row of live) {
    const version = byId.get(row.id);
    if (version === undefined || version !== row.version) {
      throw new DomainConflictError(
        "seen_version_stale",
        `${what} on ${row.where} changed since the screen loaded. Nothing was written — reload; if it now differs, change it on that configuration's own screen.`,
      );
    }
  }
  if (seen.length !== live.length) {
    throw new DomainConflictError(
      "seen_version_stale",
      `${what} is not on the same rows it was when the screen loaded. Nothing was written — reload.`,
    );
  }
}

/**
 * The ONE change set the whole fan-out belongs to.
 *
 * A reason given with this edit opens a change of its own, for the reason
 * `changeSetForEdit` gives. With none, the person's open change wins; failing
 * that, a kind that needs a reason is refused in words by `openChangeSet`,
 * and one that does not is opened with the app's own description of the act.
 */
async function resolveChange(
  txn: TxnSql,
  {
    projectId,
    actor,
    kind,
    reason,
    fallbackReason,
  }: {
    projectId: string;
    actor: string;
    kind: "attribute_correct" | "attribute_retire" | "attribute_create" | "manual_edit";
    reason: string | null;
    fallbackReason: string | null;
  },
): Promise<{ changeSetId: string; attached: boolean }> {
  if (reason?.trim() || !fallbackReason) return changeSetForEdit(txn, { projectId, actor, kind, reason });
  const open = await findOpenChangeSet(txn, projectId, actor);
  if (open) {
    await publishChangeSet(txn, open);
    return { changeSetId: open, attached: true };
  }
  const changeSetId = await openChangeSet(txn, { projectId, kind, actor, reason: fallbackReason });
  return { changeSetId, attached: false };
}

/** One version per configuration written, once, under the one change. */
async function finish(
  txn: TxnSql,
  family: ConfigurationFamily,
  change: { changeSetId: string; attached: boolean },
  written: CommonEditResult["written"],
  finishesUnlinked: number,
): Promise<CommonEditResult> {
  const snapshots = await snapshotRecords(
    txn,
    written.map((row) => row.recordId),
    change.changeSetId,
  );
  const order = new Map(family.configurations.map((configuration, index) => [configuration.recordId, index]));
  return {
    changeSetId: change.changeSetId,
    attachedToOpenChange: change.attached,
    written: written
      .map((row) => ({ ...row, snapshotNo: snapshots.get(row.recordId) ?? null }))
      .sort((a, b) => (order.get(a.recordId) ?? 0) - (order.get(b.recordId) ?? 0)),
    finishesUnlinked,
  };
}
