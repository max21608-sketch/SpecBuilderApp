// Promoting reviewed preamble notes into project notes.
//
// The simplest of the three confirm paths, because there is nothing to resolve:
// a note is text about the project, not a value about an item. It still goes
// through one named boundary in one transaction, for the same reason the others
// do — a half-written set of notes looks like the whole preamble.
//
// They land in `project_notes`, not the chassis `notes` table, which is
// append-only by trigger. A model reading nineteen pages of prose will sometimes
// cut a requirement in the wrong place, and an uncorrectable mis-extraction
// sitting on the project overview is worse than no extraction at all.
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import {
  assertStagedPreamble,
  hasPendingNotes,
  preambleNoteBlockers,
  type PreambleNote,
  type StagedPreamble,
} from "@/lib/preamble-document";

export type NoteRef = { id: string; version: number };

export type PreambleConfirmResult = {
  applied: number;
  ignored: number;
  restored: number;
  remainingPending: number;
  status: string;
};

type LoadedRun = { runId: string; projectId: string; staged: StagedPreamble };

async function loadRun(txn: TxnSql, runId: string, expectedVersion: number | null): Promise<LoadedRun> {
  const rows = await txn`
    select id, project_id, status, parsed, version, document_kind
    from intake_runs where id = ${runId}
    for update
  `;
  const run = rows[0];
  if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  if (run.document_kind !== "preamble") {
    throw new DomainConflictError("wrong_kind", "That import is not a preamble.", { status: 400 });
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
  return { runId: String(run.id), projectId: String(run.project_id), staged: assertStagedPreamble(run.parsed) };
}

function takeNotes(staged: StagedPreamble, refs: NoteRef[], allow: PreambleNote["reviewStatus"][]): PreambleNote[] {
  const taken: PreambleNote[] = [];
  for (const ref of refs) {
    const note = staged.notes.find((row) => row.id === ref.id);
    if (!note) throw new DomainConflictError("note_missing", "One of these notes is no longer part of this import. Reload.");
    if (!allow.includes(note.reviewStatus)) {
      throw new DomainConflictError(
        "note_reviewed",
        `“${note.title ?? "That note"}” has already been ${note.reviewStatus}. Reload to see the current state.`,
      );
    }
    if (note.version !== ref.version) {
      throw new DomainConflictError(
        "note_version_stale",
        `“${note.title ?? "One of these notes"}” was edited in another tab. Reload before confirming.`,
      );
    }
    taken.push(note);
  }
  return taken;
}

async function writeStaged(txn: TxnSql, run: LoadedRun, actor: string, notes: PreambleNote[]): Promise<string> {
  const staged: StagedPreamble = { ...run.staged, notes };
  const status = hasPendingNotes(staged) ? "parsed" : "confirmed";
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

export async function confirmPreambleNotes(
  txn: TxnSql,
  {
    runId,
    expectedVersion,
    notes: refs,
    actor,
  }: { runId: string; expectedVersion: number | null; notes: NoteRef[]; actor: string },
): Promise<PreambleConfirmResult> {
  const run = await loadRun(txn, runId, expectedVersion);
  const taken = takeNotes(run.staged, refs, ["pending"]);
  if (taken.length === 0) {
    throw new DomainConflictError("nothing_to_apply", "There is nothing pending to add.", { status: 400 });
  }

  // Recomputed, never trusted from the screen: project_notes requires a
  // non-blank body, and a check-constraint 500 tells the reviewer nothing.
  const blockers = preambleNoteBlockers({ ...run.staged, notes: taken });
  if (blockers.length > 0) {
    throw new DomainConflictError("blocked", blockers[0]?.message ?? "A note cannot be added yet.", { diff: blockers });
  }

  // A preamble writes project_notes, not records, so this change set carries
  // no versions. It is opened anyway: the project's trail has to show that a
  // preamble was read, and an audited write with no change behind it is the
  // one thing the coverage check is looking for.
  await openChangeSet(txn, {
    projectId: run.projectId,
    kind: "preamble_confirm",
    actor,
    reason: `${taken.length} note${taken.length === 1 ? "" : "s"} from ${run.staged.filename ?? "the preamble"}`,
    sourceIntakeRunId: runId,
  });

  const sortRows = await txn`
    select coalesce(max(sort_order), 0) as max_sort from project_notes where project_id = ${run.projectId}
  `;
  let sortOrder = Number(sortRows[0]?.max_sort ?? 0);
  const appliedIds = new Map<string, string>();

  for (const note of taken) {
    sortOrder += 1;
    const inserted = await txn`
      insert into project_notes
        (project_id, topic, title, body, source_run_id, source_page, sort_order, created_by, updated_by)
      values
        (${run.projectId}, ${note.topic}, ${note.title}, ${note.body}, ${runId}, ${note.page}, ${sortOrder},
         ${actor}, ${actor})
      returning id
    `;
    const noteId = String(inserted[0]?.id ?? "");
    if (!noteId) throw new Error(`note ${note.id} was not inserted`);
    appliedIds.set(note.id, noteId);
  }

  const now = new Date().toISOString();
  const notes = run.staged.notes.map((note) =>
    appliedIds.has(note.id)
      ? {
          ...note,
          version: note.version + 1,
          reviewStatus: "applied" as const,
          reviewedAt: now,
          reviewedBy: actor,
          applied: { noteId: appliedIds.get(note.id) ?? "" },
        }
      : note,
  );

  const status = await writeStaged(txn, run, actor, notes);
  await txn`
    insert into status_history (entity_type, entity_id, from_status, to_status, changed_by, note)
    values ('intake_run', ${runId}, 'parsed', ${status}, ${actor},
            ${`${taken.length} preamble note${taken.length === 1 ? "" : "s"} added to the project`})
  `;

  return {
    applied: taken.length,
    ignored: 0,
    restored: 0,
    remainingPending: notes.filter((note) => note.reviewStatus === "pending").length,
    status,
  };
}

export async function reviewPreambleNotes(
  txn: TxnSql,
  {
    runId,
    expectedVersion,
    notes: refs,
    action,
    actor,
  }: {
    runId: string;
    expectedVersion: number | null;
    notes: NoteRef[];
    action: "ignore" | "restore";
    actor: string;
  },
): Promise<PreambleConfirmResult> {
  const run = await loadRun(txn, runId, expectedVersion);
  const taken = takeNotes(run.staged, refs, action === "ignore" ? ["pending"] : ["ignored"]);
  const takenIds = new Set(taken.map((note) => note.id));
  const now = new Date().toISOString();

  const notes = run.staged.notes.map((note) =>
    takenIds.has(note.id)
      ? {
          ...note,
          version: note.version + 1,
          reviewStatus: action === "ignore" ? ("ignored" as const) : ("pending" as const),
          reviewedAt: action === "ignore" ? now : null,
          reviewedBy: action === "ignore" ? actor : null,
        }
      : note,
  );

  const status = await writeStaged(txn, run, actor, notes);
  return {
    applied: 0,
    ignored: action === "ignore" ? taken.length : 0,
    restored: action === "restore" ? taken.length : 0,
    remainingPending: notes.filter((note) => note.reviewStatus === "pending").length,
    status,
  };
}
