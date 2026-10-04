// Promoting a reviewed finishes schedule into the project's finishes library.
//
// ============================================================================
// ONE CONFIRM, ONE CHANGE SET, AND IT WRITES ONLY WHERE THE LIBRARY IS EMPTY.
//
// The library is the truth and the attribute is the evidence (0018): editing a
// finish re-renders every item linked to it. So a schedule may CREATE a code
// the library does not hold, and FILL a held code nobody has described yet —
// and nothing else. A held code whose description says something different is
// a CONFLICT: nothing is written, the entry stays for a person, and the result
// names it. That is the drawings' conflict rule, unchanged.
//
// `editFinish` REPLACES the row and writes an omitted field as null, so a fill
// sends EVERY field — the held value where there is one, the schedule's only
// where the held one is empty. A partial patch would delete the supplier a
// pasted list or a person had already recorded.
//
// The change set is `finish_edit` (a reason is required, and it names the
// document), with the schedule as its source run AND its evidence, so "where
// did AB-TIM-04's description come from" is answered by opening the file. It
// is opened only where something is written: a confirm that finds every code
// already held and agreeing writes nothing, and an empty change in the trail
// would claim a change nobody made.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { createFinish, editFinish } from "@/lib/finish-edit";
import { isFinishCodeOrigin, isFinishKind, type FinishKind } from "@/lib/finishes";
import {
  assertStagedFinishSchedule,
  hasPendingEntries,
  reviewFinishSchedule,
  verdictIsSkipped,
  VERDICT_LABELS,
  type FinishScheduleEntry,
  type LibraryFinish,
  type ScheduleVerdict,
  type StagedFinishSchedule,
} from "@/lib/finish-schedule";
import type { Row } from "@/lib/db";

type AnySql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/** The project's active library, with what a fill needs to send every field back. */
export async function loadScheduleLibrary(exec: AnySql, projectId: string): Promise<LibraryFinish[]> {
  const rows = await exec`
    select id, code, code_norm, code_origin, kind, description, supplier_raw, reference, colour, notes, state, version
    from project_finishes where project_id = ${projectId} and status = 'active'
    order by code_norm
  `;
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    codeNorm: String(row.code_norm),
    codeOrigin: isFinishCodeOrigin(row.code_origin) ? row.code_origin : "client",
    kind: isFinishKind(row.kind) ? row.kind : null,
    description: row.description === null ? null : String(row.description),
    supplierRaw: row.supplier_raw === null ? null : String(row.supplier_raw),
    reference: row.reference === null ? null : String(row.reference),
    colour: row.colour === null ? null : String(row.colour),
    notes: row.notes === null ? null : String(row.notes),
    state: row.state === "confirmed" ? "confirmed" : "tbc",
    version: Number(row.version),
  }));
}

export type EntryRef = { id: string; version: number };

export type FinishScheduleConfirmResult = {
  created: number;
  filled: number;
  unchanged: number;
  ignored: number;
  restored: number;
  /** Entries named in the request that wrote nothing and stay for a person, with why. */
  skipped: { entryId: string; code: string | null; why: string }[];
  remainingPending: number;
  status: string;
  changeSetId: string | null;
};

type LoadedRun = {
  runId: string;
  projectId: string;
  attachmentId: string | null;
  staged: StagedFinishSchedule;
};

async function loadRun(txn: TxnSql, runId: string, expectedVersion: number | null): Promise<LoadedRun> {
  const rows = await txn`
    select id, project_id, status, parsed, version, document_kind, attachment_id
    from intake_runs where id = ${runId}
    for update
  `;
  const run = rows[0];
  if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  if (run.document_kind !== "finishes_schedule") {
    throw new DomainConflictError("wrong_kind", "That import is not a finishes schedule.", { status: 400 });
  }
  if (run.status !== "parsed" && run.status !== "confirmed") {
    throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)}, not ready to review.`);
  }
  if (expectedVersion !== null && Number(run.version) !== expectedVersion) {
    throw new DomainConflictError(
      "import_version_stale",
      "This import changed while you were reviewing it. Reload and check before confirming.",
    );
  }
  let staged: StagedFinishSchedule;
  try {
    staged = assertStagedFinishSchedule(run.parsed);
  } catch (cause) {
    throw new DomainConflictError("wrong_shape", cause instanceof Error ? cause.message : String(cause), { status: 400 });
  }
  return {
    runId: String(run.id),
    projectId: String(run.project_id),
    attachmentId: run.attachment_id ? String(run.attachment_id) : null,
    staged,
  };
}

function entryName(entry: FinishScheduleEntry): string {
  return entry.codeRaw?.trim() || entry.nameRaw?.trim() || "That entry";
}

function takeEntries(
  staged: StagedFinishSchedule,
  refs: EntryRef[],
  allow: FinishScheduleEntry["reviewStatus"][],
): FinishScheduleEntry[] {
  const taken: FinishScheduleEntry[] = [];
  for (const ref of refs) {
    const entry = staged.entries.find((row) => row.id === ref.id);
    if (!entry) throw new DomainConflictError("entry_missing", "One of these finishes is no longer part of this import. Reload.");
    if (!allow.includes(entry.reviewStatus)) {
      throw new DomainConflictError(
        "entry_reviewed",
        `“${entryName(entry)}” has already been ${entry.reviewStatus}. Reload to see the current state.`,
      );
    }
    if (entry.version !== ref.version) {
      throw new DomainConflictError(
        "entry_version_stale",
        `“${entryName(entry)}” was changed in another tab. Reload before confirming.`,
      );
    }
    taken.push(entry);
  }
  return taken;
}

async function writeStaged(txn: TxnSql, run: LoadedRun, actor: string, entries: FinishScheduleEntry[]): Promise<string> {
  const staged: StagedFinishSchedule = { ...run.staged, entries };
  const status = hasPendingEntries(staged) ? "parsed" : "confirmed";
  const rows = await txn`
    update intake_runs
    set parsed = ${JSON.stringify(staged)}::jsonb,
        status = ${status},
        confirmed_at = ${status === "confirmed" ? new Date().toISOString() : null},
        updated_by = ${actor}
    where id = ${run.runId}
    returning id
  `;
  if (!rows[0]) throw new Error("the import was not updated");
  return status;
}

function skipReason(verdict: ScheduleVerdict): string {
  switch (verdict.status) {
    case "conflict":
      return `The library already describes ${verdict.finish.code} as “${verdict.finish.description ?? ""}”. Nothing was written; decide which is out of date.`;
    case "repeated":
      return "An earlier entry in this document carries the same code; only that one is filed.";
    case "no_code":
      return "No code to file it under.";
    default:
      return VERDICT_LABELS[verdict.status];
  }
}

export async function confirmFinishScheduleEntries(
  txn: TxnSql,
  {
    runId,
    expectedVersion,
    entries: refs,
    actor,
  }: { runId: string; expectedVersion: number | null; entries: EntryRef[]; actor: string },
): Promise<FinishScheduleConfirmResult> {
  const run = await loadRun(txn, runId, expectedVersion);
  const taken = takeEntries(run.staged, refs, ["pending"]);
  if (taken.length === 0) {
    throw new DomainConflictError("nothing_to_apply", "There is nothing pending to add.", { status: 400 });
  }

  // Serialise against another confirm on this project creating the same code:
  // `createFinish` would otherwise die on the partial unique index with a
  // message that names nothing. The `mintInternalFinishCode` rule.
  await txn`select id from projects where id = ${run.projectId} for update`;

  // The verdicts are recomputed here, against the LIVE library, by the same
  // function the screen called. Never trusted from the request.
  const library = await loadScheduleLibrary(txn, run.projectId);
  const review = new Map(reviewFinishSchedule(run.staged, library).map((row) => [row.entryId, row]));

  const toCreate: { entry: FinishScheduleEntry; code: string }[] = [];
  const toFill: { entry: FinishScheduleEntry; finish: LibraryFinish }[] = [];
  const unchanged: FinishScheduleEntry[] = [];
  const skipped: FinishScheduleConfirmResult["skipped"] = [];

  for (const entry of taken) {
    const row = review.get(entry.id);
    const verdict = row?.verdict;
    if (!row || !verdict) continue;
    if (verdictIsSkipped(verdict)) {
      skipped.push({ entryId: entry.id, code: row.code, why: skipReason(verdict) });
    } else if (verdict.status === "new") {
      toCreate.push({ entry, code: verdict.code });
    } else if (verdict.status === "fills") {
      toFill.push({ entry, finish: verdict.finish });
    } else if (verdict.status === "agrees") {
      unchanged.push(entry);
    }
  }

  const filename = run.staged.filename ?? "the finishes schedule";
  let changeSetId: string | null = null;
  const applied = new Map<string, NonNullable<FinishScheduleEntry["applied"]>>();

  if (toCreate.length + toFill.length > 0) {
    const parts = [
      toCreate.length > 0 ? `${toCreate.length} added` : null,
      toFill.length > 0 ? `${toFill.length} filled in` : null,
    ].filter(Boolean);
    const reason = `Finishes library from ${filename}: ${parts.join(", ")}.`;
    changeSetId = await openChangeSet(txn, {
      projectId: run.projectId,
      kind: "finish_edit",
      actor,
      reason,
      sourceIntakeRunId: run.runId,
      // The schedule itself is the evidence: the email-confirm pattern, where
      // the change carries the `.eml` it was read from.
      evidenceAttachmentId: run.attachmentId,
    });

    for (const { entry, code } of toCreate) {
      const composed = review.get(entry.id)!.composed;
      const finishId = await createFinish(txn, {
        projectId: run.projectId,
        fields: {
          code,
          codeOrigin: "client",
          // A PERSON'S click, or nothing. The suggestion is never written.
          kind: entry.kind,
          description: composed.description,
          supplierRaw: composed.supplierRaw,
          reference: composed.reference,
          notes: composed.notes,
          // `tbc`, as every automatic filing is: a schedule naming a finish is
          // not somebody confirming it on the library.
          state: "tbc",
        },
        actor,
      });
      applied.set(entry.id, { outcome: "created", finishId });
    }

    for (const { entry, finish } of toFill) {
      const composed = review.get(entry.id)!.composed;
      const keep = (held: string | null, ours: string | null) => (held?.trim() ? held : ours);
      await editFinish(txn, {
        projectId: run.projectId,
        finishId: finish.id,
        expectedVersion: finish.version,
        // EVERY field, because `editFinish` replaces the row.
        fields: {
          code: finish.code,
          kind: finish.kind ?? (entry.kind as FinishKind | null),
          description: keep(finish.description, composed.description),
          supplierRaw: keep(finish.supplierRaw, composed.supplierRaw),
          reference: keep(finish.reference, composed.reference),
          colour: finish.colour,
          notes: keep(finish.notes, composed.notes),
          state: finish.state,
        },
        reason,
        actor,
        changeSetId,
      });
      applied.set(entry.id, { outcome: "filled", finishId: finish.id });
    }
  }

  for (const entry of unchanged) {
    const verdict = review.get(entry.id)?.verdict;
    applied.set(entry.id, {
      outcome: "unchanged",
      finishId: verdict && verdict.status === "agrees" ? verdict.finish.id : null,
    });
  }

  if (applied.size === 0) {
    // Everything named was a conflict, a repeat or had no code: nothing is
    // written and the staged run is left as it was.
    return {
      created: 0,
      filled: 0,
      unchanged: 0,
      ignored: 0,
      restored: 0,
      skipped,
      remainingPending: run.staged.entries.filter((entry) => entry.reviewStatus === "pending").length,
      status: "parsed",
      changeSetId: null,
    };
  }

  const now = new Date().toISOString();
  const entries = run.staged.entries.map((entry) => {
    const outcome = applied.get(entry.id);
    return outcome
      ? {
          ...entry,
          version: entry.version + 1,
          reviewStatus: "applied" as const,
          reviewedAt: now,
          reviewedBy: actor,
          applied: outcome,
        }
      : entry;
  });

  const status = await writeStaged(txn, run, actor, entries);
  const created = toCreate.length;
  const filled = toFill.length;
  await txn`
    insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
    values ('intake_run', ${runId}, 'parsed', ${status}, ${actor},
            ${`Finishes schedule: ${created} added to the library, ${filled} filled in, ${unchanged.length} already held`})
  `;

  return {
    created,
    filled,
    unchanged: unchanged.length,
    ignored: 0,
    restored: 0,
    skipped,
    remainingPending: entries.filter((entry) => entry.reviewStatus === "pending").length,
    status,
    changeSetId,
  };
}

export async function reviewFinishScheduleEntries(
  txn: TxnSql,
  {
    runId,
    expectedVersion,
    entries: refs,
    action,
    actor,
  }: { runId: string; expectedVersion: number | null; entries: EntryRef[]; action: "ignore" | "restore"; actor: string },
): Promise<FinishScheduleConfirmResult> {
  const run = await loadRun(txn, runId, expectedVersion);
  const taken = takeEntries(run.staged, refs, action === "ignore" ? ["pending"] : ["ignored"]);
  const takenIds = new Set(taken.map((entry) => entry.id));
  const now = new Date().toISOString();

  const entries = run.staged.entries.map((entry) =>
    takenIds.has(entry.id)
      ? {
          ...entry,
          version: entry.version + 1,
          reviewStatus: action === "ignore" ? ("ignored" as const) : ("pending" as const),
          reviewedAt: action === "ignore" ? now : null,
          reviewedBy: action === "ignore" ? actor : null,
        }
      : entry,
  );

  const status = await writeStaged(txn, run, actor, entries);
  return {
    created: 0,
    filled: 0,
    unchanged: 0,
    ignored: action === "ignore" ? taken.length : 0,
    restored: action === "restore" ? taken.length : 0,
    skipped: [],
    remainingPending: entries.filter((entry) => entry.reviewStatus === "pending").length,
    status,
    changeSetId: null,
  };
}

/**
 * A person filing an entry's kind, before confirm — the autosave. The kind is
 * the ONE thing on an entry a person sets here: everything else is what the
 * document said, and the library page is where a finish is edited.
 */
export async function setFinishScheduleEntryKind(
  txn: TxnSql,
  {
    runId,
    entryId,
    expectedVersion,
    kind,
    actor,
  }: { runId: string; entryId: string; expectedVersion: number; kind: FinishKind | null; actor: string },
): Promise<{ version: number }> {
  const rows = await txn`
    select id, status, parsed, document_kind from intake_runs where id = ${runId} for update
  `;
  const run = rows[0];
  if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  if (run.status !== "parsed") {
    throw new DomainConflictError("not_reviewable", `This import is ${String(run.status)}, not open for editing.`);
  }
  const staged = assertStagedFinishSchedule(run.parsed);
  const entry = staged.entries.find((row) => row.id === entryId);
  if (!entry) throw new DomainConflictError("entry_missing", "That finish is no longer part of this import. Reload.");
  if (entry.reviewStatus !== "pending") {
    throw new DomainConflictError("entry_reviewed", `That finish has already been ${entry.reviewStatus}. Reload.`);
  }
  if (entry.version !== expectedVersion) {
    throw new DomainConflictError("entry_version_stale", "That finish was changed in another tab. Reload.");
  }
  const entries = staged.entries.map((row) => (row.id === entryId ? { ...row, kind, version: row.version + 1 } : row));
  const written = await txn`
    update intake_runs
    set parsed = ${JSON.stringify({ ...staged, entries })}::jsonb, updated_by = ${actor}
    where id = ${runId} and status = 'parsed'
    returning version
  `;
  if (!written[0]) throw new DomainConflictError("not_reviewable", "This import closed while you were editing it.");
  return { version: entry.version + 1 };
}
