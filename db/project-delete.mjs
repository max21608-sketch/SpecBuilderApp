// Deleting a project: what goes, what stays, and in what order. The one
// implementation behind `npm run db:delete-project` and `tools/qa-clean.mjs`.
//
// ============================================================================
// A PROJECT IS DELETABLE BY SCRIPT, NEVER FROM THE APP (Max, 2026-11-06).
//
// `house/data-safety.md` asks for a retention decision "on day one"; this app
// had none, because the schema refused every delete (audit B5, 0055 has the
// detail). Now one statement, `delete from projects`, takes every table that
// hangs off a project by foreign key (since 0058; see DELETE_ORDER for why
// this file does not lean on that alone, and deletes the project's tables in
// foreign-key order itself). What no foreign key can reach is done here,
// around it, in ONE transaction:
//
//   * the POLYMORPHIC rows (attachments, notes, status history, messages),
//     which point at an entity by type and id with no constraint behind them.
//     An attachment is the project's when its file is under the project's
//     prefix -- the scope blob-source.ts checks three times -- or when it
//     hangs off one of the project's rows;
//   * mail whose ONLY copy is under the project's prefix (an `.eml` somebody
//     uploaded to it). Mail that arrived through the mailbox keeps its arrival
//     record under `mailbox/` and SURVIVES its project, taken off it by 0055's
//     trigger exactly as Unassign would.
//
// Then it COUNTS AGAIN, before commit, and refuses to commit if any table it
// knows still holds a row of the project -- the `retireRun` rule: a cascade
// nobody can see is a cascade somebody asserts.
//
// `audit_log` is left alone. It is append-only by design (house §12), so the
// deleted project's audit rows stay, and the delete adds its own. Since 0054
// they no longer carry the staged documents or the mail bodies.
//
// THE FILES ARE NOT DELETED HERE. Blob I/O inside a transaction holds the
// project's locks across a network call (the `assignMessage` rule), and a file
// deleted for a transaction that then rolls back is a row pointing at nothing.
// So this returns the pathnames, and the caller deletes them AFTER the commit.
// A file left behind by a failed blob delete is an orphan, which is the lesser
// failure: it can be found by prefix and deleted again.
//
// Plain `.mjs` with a `pg` client, so a node script (qa-clean) and a tsx script
// can share it, as `script-env.mjs` is shared. `project-delete.d.mts` types it.
// ============================================================================

/**
 * Every table whose rows belong to ONE project, and how to find them. The
 * test holds this list equal to `tools/lib/copy-project-core.ts`'s owned
 * tables, which refuses a table it has not classified -- so a new table is a
 * failing test here before it is a row left behind.
 *
 * `from` is a FROM ... WHERE body taking the project id as $1 (the project's
 * prefix where `usesPrefix`); `id` is the expression for the row's id, null
 * where the table has none.
 */
const OWNED = [
  { table: "projects", id: "t.id", from: "projects t where t.id = $1" },
  { table: "spec_runs", id: "t.id", from: "spec_runs t where t.project_id = $1" },
  { table: "spec_records", id: "t.id", from: "spec_records t where t.project_id = $1" },
  { table: "spec_record_refs", id: "t.id", from: "spec_record_refs t where t.project_id = $1" },
  {
    table: "spec_answers",
    id: "t.id",
    from: "spec_answers t join spec_records r on r.id = t.record_id where r.project_id = $1",
  },
  {
    table: "record_attributes",
    id: "t.id",
    from: "record_attributes t join spec_records r on r.id = t.record_id where r.project_id = $1",
  },
  {
    table: "record_snapshots",
    id: "t.id",
    from: "record_snapshots t join spec_records r on r.id = t.record_id where r.project_id = $1",
  },
  {
    table: "baseline_members",
    id: null,
    from: "baseline_members t join change_sets c on c.id = t.change_set_id where c.project_id = $1",
  },
  { table: "attribute_disagreements", id: "t.id", from: "attribute_disagreements t where t.project_id = $1" },
  { table: "spec_record_twins", id: "t.id", from: "spec_record_twins t where t.project_id = $1" },
  { table: "intake_batches", id: "t.id", from: "intake_batches t where t.project_id = $1" },
  { table: "intake_runs", id: "t.id", from: "intake_runs t where t.project_id = $1" },
  { table: "project_notes", id: "t.id", from: "project_notes t where t.project_id = $1" },
  { table: "project_finishes", id: "t.id", from: "project_finishes t where t.project_id = $1" },
  { table: "project_contacts", id: "t.id", from: "project_contacts t where t.project_id = $1" },
  { table: "change_sets", id: "t.id", from: "change_sets t where t.project_id = $1" },
  { table: "email_drafts", id: "t.id", from: "email_drafts t where t.project_id = $1" },
  {
    table: "email_draft_items",
    id: "t.id",
    from: "email_draft_items t join email_drafts d on d.id = t.draft_id where d.project_id = $1",
  },
  {
    // Only the mail that goes: its only copy is under this project's prefix.
    // A stored path may be a full store URL, so the host is taken off first,
    // and the prefix is compared with left(), never LIKE: in LIKE an
    // underscore is a wildcard (the qa-clean trap).
    table: "email_messages",
    id: "t.id",
    from: `email_messages t
            where left(regexp_replace(coalesce(t.mailbox_storage_path, ''), '^https?://[^/]+/', ''), length($1)) = $1`,
    // $1 is the project's prefix here, not its id.
    usesPrefix: true,
  },
];

/**
 * Polymorphic: `entity_type` + `entity_id`, no foreign key possible. `from`
 * takes the project's prefix as $1 and the ids of every row of the project
 * (from OWNED) as $2.
 */
const POLYMORPHIC = [
  {
    table: "attachments",
    from: `attachments t
            where t.entity_id = any($2::uuid[])
               or left(regexp_replace(t.storage_path, '^https?://[^/]+/', ''), length($1)) = $1`,
  },
  { table: "notes", from: "notes t where t.entity_id = any($2::uuid[]) and $1::text is not null" },
  { table: "status_history", from: "status_history t where t.entity_id = any($2::uuid[]) and $1::text is not null" },
  { table: "messages", from: "messages t where t.entity_id = any($2::uuid[]) and $1::text is not null" },
];

/**
 * The order the project's own rows are deleted in, each table in a statement
 * of its own, referencing tables before the tables they reference (house §12).
 *
 * THE CASCADE WAS NOT ENOUGH (audit 4.6, 2026-11-06). `delete from projects`
 * alone empties every one of these, and 0055 said it would whatever order the
 * cascades fired in. It did not: a NO ACTION key is checked at the end of the
 * cascade query that deleted the referenced row, and the cascades run in the
 * order their trigger names sort, which is creation order read as TEXT. On a
 * fresh database the records went before the drafts, the coverage rows still
 * pointed at them, and the delete was refused; on the shared one it passed.
 * 0058 defers the six keys to commit, which makes the bare statement safe. This
 * list makes THIS path safe without it, and under `set constraints all
 * immediate`, so a database that has not had 0058 yet (or a restore that lost
 * it) does not depend on the dice.
 *
 * Every NO ACTION or RESTRICT key between two tables the delete empties must
 * have its referencing rows gone in an earlier statement than its referenced
 * rows. A table not listed goes by cascade with the earliest listed table it
 * hangs off: the answers, attributes, refs, versions and disagreements with
 * their records, the change sets and baselines with the project. The test
 * reads the catalog and fails on a key this order does not satisfy.
 *
 * `$1` is the project id.
 */
const ORDERED_DELETES = [
  {
    table: "email_draft_items",
    sql: "delete from email_draft_items t using email_drafts d where d.id = t.draft_id and d.project_id = $1",
  },
  { table: "email_drafts", sql: "delete from email_drafts where project_id = $1" },
  { table: "spec_records", sql: "delete from spec_records where project_id = $1" },
  { table: "spec_runs", sql: "delete from spec_runs where project_id = $1" },
  { table: "intake_runs", sql: "delete from intake_runs where project_id = $1" },
  { table: "intake_batches", sql: "delete from intake_batches where project_id = $1" },
  { table: "project_finishes", sql: "delete from project_finishes where project_id = $1" },
  { table: "project_contacts", sql: "delete from project_contacts where project_id = $1" },
  { table: "projects", sql: "delete from projects where id = $1" },
];

export const DELETE_ORDER = ORDERED_DELETES.map((entry) => entry.table);
export const OWNED_TABLES = OWNED.map((entry) => entry.table);
export const POLYMORPHIC_TABLES = POLYMORPHIC.map((entry) => entry.table);

/** The blob prefix every file of a project lives under (blob-source.ts). */
export function projectPrefix(projectId) {
  return `projects/${projectId}/`;
}

/** A stored path as the store's pathname: a full store URL loses its host. */
function pathnameOf(stored) {
  return String(stored).replace(/^https?:\/\/[^/]+\//i, "").replace(/^\/+/, "");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What deleting this project would remove: a row count per table, the
 * pathnames of its files the database records, and how many messages would
 * survive it. Reads only. Throws when there is no such project.
 */
export async function planProjectDeletion(client, projectId) {
  if (!UUID.test(String(projectId))) throw new Error(`"${projectId}" is not a project id.`);
  const prefix = projectPrefix(projectId);
  const { rows: found } = await client.query(
    "select id, bws_project_number, name from projects where id = $1",
    [projectId],
  );
  if (found.length === 0) throw new Error(`There is no project ${projectId}.`);

  const ids = [];
  const counts = [];
  for (const entry of OWNED) {
    const values = entry.usesPrefix ? [prefix] : [projectId];
    const countSql = `select count(*) as n from ${entry.from}`;
    const { rows } = await client.query(countSql, values);
    counts.push({ table: entry.table, rows: Number(rows[0].n), countSql, values });
    if (entry.id) {
      const { rows: idRows } = await client.query(`select ${entry.id}::text as id from ${entry.from}`, values);
      ids.push(...idRows.map((row) => row.id));
    }
  }
  for (const entry of POLYMORPHIC) {
    const values = [prefix, ids];
    const countSql = `select count(*) as n from ${entry.from}`;
    const { rows } = await client.query(countSql, values);
    counts.push({ table: entry.table, rows: Number(rows[0].n), countSql, values });
  }

  const { rows: files } = await client.query(
    `select storage_path from attachments t
      where t.entity_id = any($2::uuid[])
         or left(regexp_replace(t.storage_path, '^https?://[^/]+/', ''), length($1)) = $1`,
    [prefix, ids],
  );
  const { rows: mail } = await client.query(
    `select mailbox_storage_path from email_messages
      where left(regexp_replace(coalesce(mailbox_storage_path, ''), '^https?://[^/]+/', ''), length($1)) = $1`,
    [prefix],
  );
  const blobPaths = [
    ...new Set(
      [...files.map((row) => row.storage_path), ...mail.map((row) => row.mailbox_storage_path)]
        .map(pathnameOf)
        // Only what is under the prefix. An attachment row of this project's
        // pointing elsewhere is not the project's file to delete.
        .filter((pathname) => pathname.startsWith(prefix)),
    ),
  ].sort();

  const { rows: kept } = await client.query(
    `select count(*) as n from email_messages
      where project_id = $1
        and left(regexp_replace(coalesce(mailbox_storage_path, ''), '^https?://[^/]+/', ''), length($2)) <> $2`,
    [projectId, prefix],
  );

  return { project: found[0], counts, blobPaths, messagesKept: Number(kept[0].n), entityIds: ids };
}

/**
 * Delete the project's rows in one transaction, and return the plan it acted
 * on (so the caller can delete `blobPaths` afterwards). Rolls back and throws
 * if anything of the project is still there before commit.
 *
 * `client` must be a single connection (a `pg.Client` or a pool's checked-out
 * client) that is not already inside a transaction.
 */
export async function deleteProjectRows(client, projectId, { actor = "script:delete-project" } = {}) {
  await client.query("begin");
  try {
    // The actor the audit trigger records for every delete below, read by
    // write_audit() from this GUC (0001). Local to the transaction.
    await client.query("select set_config('app.user', $1, true)", [actor]);
    // The project row first, so nothing can add to it while it goes.
    const { rows: locked } = await client.query("select id from projects where id = $1 for update", [projectId]);
    if (locked.length === 0) throw new Error(`There is no project ${projectId}.`);

    const plan = await planProjectDeletion(client, projectId);
    const prefix = projectPrefix(projectId);

    for (const entry of POLYMORPHIC) {
      await client.query(`delete from ${entry.table} where id in (select t.id from ${entry.from})`, [
        prefix,
        plan.entityIds,
      ]);
    }
    await client.query(
      `delete from email_messages
        where left(regexp_replace(coalesce(mailbox_storage_path, ''), '^https?://[^/]+/', ''), length($1)) = $1`,
      [prefix],
    );
    for (const step of ORDERED_DELETES) {
      await client.query(step.sql, [projectId]);
    }

    // Count again. Every table this file knows must hold nothing of the
    // project, or the deletes and cascades did not do what this file and 0055
    // say they do.
    const left = [];
    for (const entry of OWNED) {
      const values = entry.usesPrefix ? [prefix] : [projectId];
      const { rows } = await client.query(`select count(*) as n from ${entry.from}`, values);
      if (Number(rows[0].n) > 0) left.push(`${entry.table} (${rows[0].n})`);
    }
    for (const entry of POLYMORPHIC) {
      const { rows } = await client.query(`select count(*) as n from ${entry.from}`, [prefix, plan.entityIds]);
      if (Number(rows[0].n) > 0) left.push(`${entry.table} (${rows[0].n})`);
    }
    if (left.length > 0) {
      throw new Error(`The delete left rows behind, so nothing was deleted: ${left.join(", ")}.`);
    }

    await client.query("commit");
    return plan;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}
