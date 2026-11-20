// ============================================================================
// "SET DESIGNER…" ON THE TICKED ITEMS OF A PHASE (2026-11-20, U2).
//
// A bill with no designer column leaves every record with no designer, and a
// question on a record with no designer can be routed to nobody
// (`groupByContact`, "no designer on the record"). The only fix was the
// record's Edit panel, one record at a time: 29 on the test project, 300 on a
// big bill.
//
// THE SAME PATH AS THE EDIT PANEL, NEVER A NEW ONE. Each record is written by
// `editRecordDetails` — the function `PATCH /api/records/[id]` calls for the
// panel's designer field — with the version the screen showed: the same lock,
// the same stale refusal, the same change set, the same audit rows, the same
// version. It opens ONE CHANGE SET PER RECORD, because that function opens its
// own and takes none from a caller; the history reads "Edited designer" once
// per item, exactly as N presses of the panel would.
//
// ONE TRANSACTION, A SAVEPOINT PER LINE. `withTransaction` opens a connection
// per call, and 300 connections is a minute; a savepoint is a statement. A
// line that is refused (changed since the screen loaded, retired, not on this
// project) is rolled back to its savepoint and named, and the rest are set:
// the person is told how many were set and which were refused, and a refusal
// in one row never costs the others.
//
// THE LOCKS COME FIRST, IN THE DOCUMENTED ORDER (2026-11-20, E1): the project
// row, then every ticked record and its live configurations by id, before
// the first line (`db-transaction.ts`; tests/db/lock-order.test.ts). Taken a
// line at a time in tick order, a press ticked against the id order
// deadlocked with a records-by-id writer, and a line's change set waited on
// the project row while its record was held — against a phase retire, a
// deadlock. A wait for a lock is the whole press's, never one line's: it is
// "Something else was changing this… Nothing was written — try again", which
// is true, because nothing has been written when the locks are taken.
//
// A LINE'S CONFIGURATIONS FOLLOW IT where they have no designer of their own:
// a configuration copies its line's designer when it is made
// (`variant-create.ts`), so on a bill with no designer column every one of
// them is empty too, and a split line's questions are on its configurations.
// One whose designer is EMPTY, or the same as the line's was, is set with it
// (through the same function, at the version read under its lock — the person
// decided about the line, and this is the line's own value arriving where it
// was always copied). One carrying a DIFFERENT designer was decided by
// somebody and is kept, and named.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { editRecordDetails } from "@/lib/manual-capture";
import { designerKey } from "@/lib/chase-drafts";
import { numberingFromRow, recordLabel } from "@/lib/record-label";

export type DesignerBatchInput = {
  projectId: string;
  designer: string;
  records: { id: string; version: number }[];
  actor: string;
};

export type DesignerRefusal = {
  recordId: string;
  /** Null when the record is not this project's: another project's label is not this screen's to print. */
  label: string | null;
  code: string;
  error: string;
};

export type DesignerBatchResult = {
  designer: string;
  /** Ticked items whose designer this changed. */
  set: number;
  /** Ticked items that already carried it. */
  unchanged: number;
  /** Configurations that followed their line. */
  configurations: number;
  /** Configurations kept, because somebody gave them a designer of their own. */
  keptOwn: { recordId: string; label: string; designer: string }[];
  refused: DesignerRefusal[];
  /** One sentence for the screen. */
  message: string;
};

const MAX_DESIGNER_LENGTH = 200;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

export async function setDesignerOnRecords(txn: TxnSql, input: DesignerBatchInput): Promise<DesignerBatchResult> {
  const designer = input.designer.trim();
  if (!designer) {
    throw new DomainConflictError("designer_required", "Type the designer code to set.", { status: 400 });
  }
  if (designer.length > MAX_DESIGNER_LENGTH) {
    throw new DomainConflictError("designer_too_long", `A designer code is at most ${MAX_DESIGNER_LENGTH} characters.`, {
      status: 400,
    });
  }

  // THE PROJECT LOCK, first, as every multi-record writer takes it
  // (`applyProjectWide`, the bill confirm, a phase retire): a phase retired
  // or a project-wide answer confirmed during the press queues behind it, or
  // it behind them, rather than interleaving.
  const project = await txn`select bws_project_number from projects where id = ${input.projectId} for update`;
  if (!project[0]) throw new DomainConflictError("project_missing", "No such project.", { status: 404 });
  const projectNumber = String(project[0].bws_project_number);

  const ids = input.records.map((record) => record.id);

  // THEN EVERY RECORD THE PRESS CAN WRITE, BY ID, before the first line: the
  // ticked items and their live configurations, in one statement. Taken line
  // by line in TICK order, two lines ticked against the id order deadlocked
  // against any records-by-id writer, and each line's change set waited on the
  // project while it held its record. Only this project's: another project's
  // item is refused below, and is not this press's to hold.
  await txn`
    select id from spec_records
     where project_id = ${input.projectId}
       and (id = any(${ids}::uuid[]) or (parent_id = any(${ids}::uuid[]) and status = 'active'))
     order by id
       for update
  `;

  const rows = await txn`
    select r.id, r.project_id, r.status, r.record_no, r.variant_ordinal, p.record_no as parent_record_no
      from spec_records r
      left join spec_records p on p.id = r.parent_id
     where r.id = any(${ids}::uuid[])
  `;
  const byId = new Map(rows.map((row) => [String(row.id), row]));

  const result: DesignerBatchResult = {
    designer,
    set: 0,
    unchanged: 0,
    configurations: 0,
    keptOwn: [],
    refused: [],
    message: "",
  };

  // A record written once in this press is not written again: a ticked
  // configuration whose line was ticked too has already followed it.
  const done = new Set<string>();

  for (const wanted of input.records) {
    if (done.has(wanted.id)) continue;
    const row = byId.get(wanted.id);
    if (!row || String(row.project_id) !== input.projectId) {
      result.refused.push({
        recordId: wanted.id,
        label: null,
        code: "record_not_on_project",
        error: "One ticked item is not on this project any more. Reload the phase.",
      });
      continue;
    }
    const label = recordLabel(projectNumber, numberingFromRow(row));
    if (String(row.status) !== "active") {
      result.refused.push({
        recordId: wanted.id,
        label,
        code: "record_not_live",
        error: `${label} has been retired, so its designer was not changed. Reload the phase.`,
      });
      continue;
    }

    await txn`savepoint set_designer_line`;
    try {
      const before = await txn`select designer from spec_records where id = ${wanted.id} for update`;
      const previousKey = designerKey((before[0]?.designer as string | null) ?? null);

      const edited = await editRecordDetails(txn, {
        recordId: wanted.id,
        patch: { designer },
        expectedVersion: wanted.version,
        actor: input.actor,
      });

      let followed = 0;
      const kept: DesignerBatchResult["keptOwn"] = [];
      const configurations = await txn`
        select c.id, c.version, c.designer, c.record_no, c.variant_ordinal, ${row.record_no}::int as parent_record_no
          from spec_records c
         where c.parent_id = ${wanted.id} and c.status = 'active'
         order by c.variant_ordinal nulls last, c.record_no
           for update
      `;
      for (const configuration of configurations) {
        const own = designerKey((configuration.designer as string | null) ?? null);
        if (own !== null && own !== previousKey) {
          if (own !== designerKey(designer)) {
            kept.push({
              recordId: String(configuration.id),
              label: recordLabel(projectNumber, numberingFromRow(configuration)),
              designer: String(configuration.designer),
            });
          }
          continue;
        }
        const followedEdit = await editRecordDetails(txn, {
          recordId: String(configuration.id),
          patch: { designer },
          expectedVersion: Number(configuration.version),
          actor: input.actor,
        });
        if (followedEdit.changed.length > 0) followed += 1;
      }

      await txn`release savepoint set_designer_line`;
      done.add(wanted.id);
      for (const configuration of configurations) done.add(String(configuration.id));
      if (edited.changed.length > 0) result.set += 1;
      else result.unchanged += 1;
      result.configurations += followed;
      result.keptOwn.push(...kept);
    } catch (cause) {
      if (!(cause instanceof DomainConflictError)) throw cause;
      await txn`rollback to savepoint set_designer_line`;
      result.refused.push({ recordId: wanted.id, label, code: cause.code, error: `${label}: ${cause.message}` });
    }
  }

  result.message = describe(result);
  return result;
}

/** What the press did, in one sentence: how many were set, and how many were not. */
function describe(result: DesignerBatchResult): string {
  const parts: string[] = [];
  if (result.set > 0) {
    parts.push(
      `${result.designer} set on ${plural(result.set, "item")}` +
        (result.configurations > 0 ? ` and ${plural(result.configurations, "configuration")} of theirs` : "") +
        ".",
    );
  } else if (result.configurations > 0) {
    parts.push(`${result.designer} set on ${plural(result.configurations, "configuration")}.`);
  }
  if (result.unchanged > 0) parts.push(`${plural(result.unchanged, "item")} already had it.`);
  if (result.keptOwn.length > 0) {
    parts.push(
      result.keptOwn.length === 1
        ? "1 configuration kept a designer of its own."
        : `${plural(result.keptOwn.length, "configuration")} kept designers of their own.`,
    );
  }
  if (result.refused.length > 0) parts.push(`${plural(result.refused.length, "item")} not changed — listed below.`);
  return parts.join(" ") || "Nothing was changed.";
}
