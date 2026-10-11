#!/usr/bin/env tsx
// Copy ONE project, whole, from one environment's database and Blob store to
// another's.
//
//   npx tsx tools/copy-project.ts --from=.env.pilot.local --to=.env.local \
//     --project="P18181 v3"                       # dry run: says what it would do
//   SOURCE_BLOB_READ_WRITE_TOKEN=... npx tsx tools/copy-project.ts \
//     --from=.env.pilot.local --to=.env.local --project="P18181 v3" --apply
//
//   npm run copy:project -- --from=... --to=... --project=... [--apply]
//
// Flags:
//   --project=<bws number or projects.id>   exactly one project on the source
//   --apply          write. Without it nothing is written anywhere.
//   --yes-pilot      required when the TARGET is pilot (the db scripts' rule)
//   --skip-files     copy the rows only, no stored files
//   --strict         a stored file missing on the source stops the copy
//
// ============================================================================
// WHY THIS EXISTS
//
// Max wanted pilot's Miami Beach project (`P18181 v3`) on staging as it is on
// pilot -- phases, records, answers, attributes, finishes, the change trail,
// every version, the staged document reads INCLUDING ones still waiting for
// review, and the files behind them. The alternative is uploading the pack
// again, paying for every read again, and re-confirming every card by hand,
// which would not even produce the same project: the change trail, the
// versions and the decisions inside them would be new ones.
//
// ============================================================================
// THE GUARDS, IN THE ORDER THEY RUN
//
// - Both env files are READ BY THIS TOOL, and both resolved hosts and
//   `DATABASE_ENVIRONMENT`s are printed before anything connects (house §3:
//   the printed host is what catches a mismatch). `--env-file` is not used:
//   there are two files, and Node would merge them into one environment.
// - The SOURCE is always opened read only: `default_transaction_read_only` at
//   connect AND set again on the session, and every read inside one
//   REPEATABLE READ READ ONLY transaction, so the project is read as one
//   consistent instant rather than as tables read seconds apart.
// - The TARGET: production is refused outright; pilot only with
//   `--yes-pilot`, which `--yes-production` does not stand in for; and the
//   source's own database is refused.
// - The two SCHEMAS must be identical, table by table, column by column.
// - Every table in the schema must be classified (`TABLE_HANDLING`), and a
//   project table the tool does not know how to carry is a refusal NAMING it.
// - The target must not hold the project's id, its BWS number, or any of the
//   ids about to be inserted. This tool never merges into a project and never
//   overwrites one: run twice, the second run refuses.
// - Every seed reference must map by natural key. One that does not is a
//   refusal naming the row.
//
// ============================================================================
// WHAT IS NOT COPIED
//
// `audit_log`. It is forensic and per environment -- it records what happened
// to THIS database -- and the target's own audit triggers record the inserts,
// under `system:copy-project`. The copy's history lives where the app reads
// history: `change_sets` and `record_snapshots`, which do travel, with their
// ids, actors and timestamps as they are on the source.
//
// ============================================================================
// HOW IT WRITES
//
// Files first, OUTSIDE the transaction: a network copy inside one would hold
// row locks across it. They land at the same pathname, so no row changes; a
// file already there at the same size is skipped, so a rerun after a failure
// is safe. Then ONE transaction inserts every table as a single statement, in
// FK order, rows exactly as on the source -- ids, versions, timestamps,
// `created_by` -- except seed ids, which are translated. Before COMMIT every
// row is read back and compared column by column with what was meant to
// land; any difference rolls the whole copy back and names the column. After
// COMMIT the counts are read again and compared with the source's, table by
// table.
//
// No trigger is disabled. A trigger that forced a value would show up in the
// read-back as a named difference, and the copy would refuse rather than land
// as something the source never held.
// ============================================================================
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import {
  TABLE_HANDLING,
  buildSeedMap,
  collectFiles,
  compareSchemas,
  describeEnv,
  diffRows,
  isCopied,
  isUuid,
  planSchema,
  remapRows,
  rowIdentity,
  targetRefusal,
  type EnvSide,
  type Fk,
  type Row,
  type Schema,
  type SeedKeyRow,
  type SeedMapping,
  type TableRows,
  type TableShape,
} from "./lib/copy-project-core";
import { copyFiles, vercelBlobStore } from "./lib/copy-project-blobs";

const ACTOR = "system:copy-project";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

function refuseAll(heading: string, problems: string[]): void {
  if (problems.length === 0) return;
  console.error(`\nRefusing: ${heading}`);
  for (const problem of problems.slice(0, 60)) console.error(`  - ${problem}`);
  if (problems.length > 60) console.error(`  ... and ${problems.length - 60} more.`);
  process.exit(1);
}

function readEnvFile(path: string): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Cannot read the env file ${path}: ${(error as Error).message}`);
  }
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ============================================================================
// Schema

async function loadSchema(client: pg.Client): Promise<Schema> {
  const columns = await client.query<{ table: string; name: string; type: string; generated: boolean }>(`
    select c.relname::text as "table", a.attname::text as name, t.typname::text as type,
           (a.attgenerated <> '' or a.attidentity <> '') as generated
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      join pg_type t on t.oid = a.atttypid
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     order by c.relname, a.attnum`);
  const constraints = await client.query<{
    name: string;
    contype: string;
    table: string;
    columns: string[];
    ref_table: string | null;
    ref_columns: string[] | null;
  }>(`
    select con.conname::text as name, con.contype::text as contype, c.relname::text as "table",
           array(select a.attname::text from unnest(con.conkey) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o) as columns,
           rc.relname::text as ref_table,
           case when con.contype = 'f' then
             array(select a.attname::text from unnest(con.confkey) with ordinality k(n, o)
                     join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)
           end as ref_columns
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      left join pg_class rc on rc.oid = con.confrelid
     where con.connamespace = 'public'::regnamespace and con.contype in ('p', 'f')
     order by c.relname, con.conname`);
  const uniques = await client.query<{ table: string; name: string; columns: string[]; predicate: string | null; expression: boolean }>(`
    select c.relname::text as "table", ic.relname::text as name,
           array(select a.attname::text from unnest(i.indkey::int2[]) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n order by k.o) as columns,
           pg_get_expr(i.indpred, i.indrelid) as predicate,
           (0 = any(i.indkey::int2[])) as expression
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_class ic on ic.oid = i.indexrelid
     where c.relnamespace = 'public'::regnamespace and i.indisunique and not i.indisprimary`);

  const tables = new Map<string, TableShape>();
  for (const row of columns.rows) {
    if (!tables.has(row.table)) tables.set(row.table, { columns: [], pk: [] });
    tables.get(row.table)!.columns.push({ name: row.name, type: row.type, generated: row.generated });
  }
  const fks: Fk[] = [];
  for (const row of constraints.rows) {
    if (row.contype === "p") {
      const shape = tables.get(row.table);
      if (shape) shape.pk = row.columns;
    } else {
      fks.push({ name: row.name, table: row.table, columns: row.columns, refTable: row.ref_table ?? "", refColumns: row.ref_columns ?? [] });
    }
  }
  return {
    tables,
    fks,
    uniques: uniques.rows.filter((u) => !u.expression).map((u) => ({ table: u.table, name: u.name, columns: u.columns, predicate: u.predicate })),
  };
}

async function migrations(client: pg.Client): Promise<string[]> {
  const result = await client.query<{ filename: string }>("select filename from schema_migrations order by filename");
  return result.rows.map((r) => r.filename);
}

// ============================================================================
// Rows

async function fetchRows(client: pg.Client, table: string, where: string, params: unknown[]): Promise<Row[]> {
  const result = await client.query<{ r: Row }>(`select to_jsonb(t) as r from ${quote(table)} t where ${where}`, params);
  return result.rows.map((row) => row.r);
}

/**
 * Everything belonging to the project, found from the schema. A fixpoint:
 * owned tables by FK from rows already held; polymorphic tables by
 * `entity_id`; attachments also by id wherever a held row names one (an FK
 * like `standard_agreed_evidence_id`, or an implicit column like
 * `intake_runs.attachment_id`). Each id is queried once, so it terminates.
 */
async function collectRows(client: pg.Client, schema: Schema, project: Row): Promise<TableRows> {
  const held = new Map<string, Map<string, Row>>();
  const shapeOf = (table: string) => schema.tables.get(table)!;
  const add = (table: string, rows: Row[]): boolean => {
    if (!held.has(table)) held.set(table, new Map());
    const map = held.get(table)!;
    let grew = false;
    for (const row of rows) {
      const identity = rowIdentity(shapeOf(table), row);
      if (!map.has(identity)) {
        map.set(identity, row);
        grew = true;
      }
    }
    return grew;
  };
  add("projects", [project]);

  const idsOf = (table: string): string[] => [...(held.get(table)?.values() ?? [])].map((r) => r.id).filter(isUuid);
  const queried = new Map<string, Set<string>>();
  const fresh = (key: string, ids: string[]): string[] => {
    if (!queried.has(key)) queried.set(key, new Set());
    const seen = queried.get(key)!;
    const out = ids.filter((id) => !seen.has(id));
    out.forEach((id) => seen.add(id));
    return out;
  };

  const tables = [...schema.tables.keys()].sort();
  for (let grew = true; grew; ) {
    grew = false;
    for (const table of tables) {
      const h = TABLE_HANDLING[table];
      if (h?.kind === "owned") {
        for (const fk of schema.fks.filter((f) => f.table === table && isCopied(TABLE_HANDLING[f.refTable]))) {
          const ids = fresh(`${table}:${fk.name}`, idsOf(fk.refTable));
          if (ids.length === 0) continue;
          const left = fk.columns.map((c) => `t.${quote(c)}`).join(", ");
          const right = fk.refColumns.map((c) => `r.${quote(c)}`).join(", ");
          const rows = await fetchRows(
            client,
            table,
            `(${left}) in (select ${right} from ${quote(fk.refTable)} r where r.id = any($1::uuid[]))`,
            [ids],
          );
          if (add(table, rows)) grew = true;
        }
      }
      if (h?.kind === "polymorphic") {
        const every = [...held.keys()].flatMap((t) => idsOf(t));
        const ids = fresh(`${table}:entity`, every);
        if (ids.length > 0 && add(table, await fetchRows(client, table, "t.entity_id = any($1::uuid[])", [ids]))) grew = true;
      }
    }

    // Attachments a held row names, wherever the attachment itself points.
    const named: string[] = [];
    for (const [table, rows] of held) {
      const h = TABLE_HANDLING[table];
      const implicit = h && (h.kind === "owned" || h.kind === "polymorphic") ? (h.implicit ?? {}) : {};
      const fkColumns = schema.fks
        .filter((f) => f.table === table && f.refTable === "attachments")
        .flatMap((f) => f.columns.filter((_, i) => f.refColumns[i] === "id"));
      const columns = [...fkColumns, ...Object.keys(implicit).filter((c) => implicit[c] === "attachment")];
      for (const row of rows.values()) for (const column of columns) if (isUuid(row[column])) named.push(row[column] as string);
    }
    const ids = fresh("attachments:named", named.filter((id) => !held.get("attachments")?.has(id)));
    if (ids.length > 0 && add("attachments", await fetchRows(client, "attachments", "t.id = any($1::uuid[])", [ids]))) grew = true;
  }

  const out: TableRows = new Map();
  for (const table of tables) if (isCopied(TABLE_HANDLING[table])) out.set(table, [...(held.get(table)?.values() ?? [])]);
  return out;
}

async function seedKeys(client: pg.Client, keySql: string): Promise<SeedKeyRow[]> {
  const result = await client.query<SeedKeyRow>(keySql);
  return result.rows;
}

/** Rows on `client` whose key matches one of `rows`, as `to_jsonb`. */
async function readBack(client: pg.Client, table: string, shape: TableShape, rows: Row[]): Promise<Row[]> {
  if (rows.length === 0) return [];
  const keys = rows.map((row) => Object.fromEntries(shape.pk.map((c) => [c, row[c]])));
  const on = shape.pk.map((c) => `t.${quote(c)} = k.${quote(c)}`).join(" and ");
  const result = await client.query<{ r: Row }>(
    `select to_jsonb(t) as r from ${quote(table)} t join jsonb_populate_recordset(null::${quote(table)}, $1::jsonb) k on ${on}`,
    [JSON.stringify(keys)],
  );
  return result.rows.map((row) => row.r);
}

// ============================================================================
// Output

function table(rows: string[][], header: string[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

const bytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

// ============================================================================
// Main

async function main() {
  const fromPath = arg("from");
  const toPath = arg("to");
  const projectArg = arg("project");
  const apply = flag("apply");
  const yesPilot = flag("yes-pilot");
  const skipFiles = flag("skip-files");
  const strict = flag("strict");
  if (!fromPath || !toPath || !projectArg) {
    fail('usage: npx tsx tools/copy-project.ts --from=<env file> --to=<env file> --project="<bws number or id>" [--apply] [--yes-pilot] [--skip-files] [--strict]');
  }

  const fromEnv = readEnvFile(fromPath);
  const toEnv = readEnvFile(toPath);
  const source = describeEnv(fromEnv, `--from=${fromPath}`);
  const target = describeEnv(toEnv, `--to=${toPath}`);
  if (typeof source === "string") fail(source);
  if (typeof target === "string") fail(target);

  console.log(`Source: DATABASE_ENVIRONMENT=${source.environment} (${source.host}/${source.database}) from ${fromPath} -- opened READ ONLY`);
  console.log(`Target: DATABASE_ENVIRONMENT=${target.environment} (${target.host}/${target.database}) from ${toPath}`);
  console.log(apply ? "Mode:   APPLY -- the target will be written." : "Mode:   dry run -- nothing will be written anywhere.");

  const refusal = targetRefusal(source, target, { yesPilot });
  if (refusal) fail(refusal);

  const sourceClient = new pg.Client({ connectionString: source.databaseUrl, options: "-c default_transaction_read_only=on" });
  const targetClient = new pg.Client({ connectionString: target.databaseUrl });
  await sourceClient.connect();
  await targetClient.connect();
  try {
    await run({ source, target, sourceClient, targetClient, toEnv, fromEnv, projectArg, apply, yesPilot, skipFiles, strict, fromPath, toPath });
  } finally {
    await sourceClient.end().catch(() => {});
    await targetClient.end().catch(() => {});
  }
}

type RunArgs = {
  source: EnvSide;
  target: EnvSide;
  sourceClient: pg.Client;
  targetClient: pg.Client;
  fromEnv: Record<string, string | undefined>;
  toEnv: Record<string, string | undefined>;
  projectArg: string;
  apply: boolean;
  yesPilot: boolean;
  skipFiles: boolean;
  strict: boolean;
  fromPath: string;
  toPath: string;
};

async function run(a: RunArgs) {
  const { sourceClient: src, targetClient: dst } = a;

  // ---- source: read only, one instant ----
  await src.query("set default_transaction_read_only = on");
  await src.query("set time zone 'UTC'");
  await src.query("begin isolation level repeatable read read only");
  const ro = await src.query<{ transaction_read_only: string }>("show transaction_read_only");
  if (ro.rows[0]?.transaction_read_only !== "on") fail("Refusing: the source session did not come up read only.");
  await dst.query("set time zone 'UTC'");

  // ---- schemas ----
  const [sourceSchema, targetSchema] = [await loadSchema(src), await loadSchema(dst)];
  const [sourceMigrations, targetMigrations] = [await migrations(src), await migrations(dst)];
  const migrationGap = [
    ...sourceMigrations.filter((m) => !targetMigrations.includes(m)).map((m) => `The source has migration ${m}; the target does not.`),
    ...targetMigrations.filter((m) => !sourceMigrations.includes(m)).map((m) => `The target has migration ${m}; the source does not.`),
  ];
  refuseAll("the two databases are not on the same migrations.", migrationGap);
  refuseAll("the two schemas differ.", compareSchemas(sourceSchema, targetSchema));
  const plan = planSchema(sourceSchema);
  refuseAll("the schema has tables this tool cannot carry.", plan.problems);

  // ---- the project ----
  const found = await fetchRows(
    src,
    "projects",
    isUuid(a.projectArg) ? "t.id = $1::uuid or t.bws_project_number = $1" : "t.bws_project_number = $1",
    [a.projectArg],
  );
  if (found.length !== 1) fail(`Refusing: ${found.length} projects on the source match "${a.projectArg}"; exactly one must.`);
  const project = found[0]!;
  const projectId = String(project.id);
  console.log(`\nProject: "${String(project.name)}", BWS ${String(project.bws_project_number)}, id ${projectId}`);

  const rows = await collectRows(src, sourceSchema, project);

  // ---- seed maps ----
  const seedMaps = new Map<string, SeedMapping>();
  for (const [name, handling] of Object.entries(TABLE_HANDLING)) {
    if (handling.kind !== "seed") continue;
    seedMaps.set(name, buildSeedMap(name, await seedKeys(src, handling.keySql), await seedKeys(dst, handling.keySql)));
  }
  await src.query("commit");

  const remapped = remapRows(sourceSchema, rows, seedMaps);
  refuseAll("rows that cannot be carried.", remapped.problems);
  const files = collectFiles(sourceSchema, rows, projectId);
  if (!a.skipFiles) refuseAll("files that cannot be carried.", files.problems);

  // ---- target pre-flight: never merge, never overwrite ----
  const clashes: string[] = [];
  const byId = await dst.query("select id from projects where id = $1", [projectId]);
  if (byId.rowCount) clashes.push(`The target already holds project id ${projectId}.`);
  const byNumber = await dst.query<{ id: string; name: string }>("select id, name from projects where bws_project_number = $1", [
    project.bws_project_number,
  ]);
  for (const row of byNumber.rows) clashes.push(`The target already holds BWS number ${String(project.bws_project_number)} ("${row.name}", ${row.id}).`);
  for (const tableName of plan.insertOrder) {
    const shape = sourceSchema.tables.get(tableName)!;
    const present = await readBack(dst, tableName, shape, rows.get(tableName) ?? []);
    if (present.length > 0) clashes.push(`The target already holds ${present.length} ${tableName} row(s) with the ids being copied.`);
  }
  // A unique index that names no copied id is global (a BWS number, a
  // registration request id, a mailbox message id); a value already on the
  // target there would fail the insert half way through the transaction.
  const copiedFkColumns = (t: string) =>
    new Set(sourceSchema.fks.filter((f) => f.table === t && isCopied(TABLE_HANDLING[f.refTable])).flatMap((f) => f.columns));
  for (const index of sourceSchema.uniques) {
    const tableRows = remapped.rows.get(index.table);
    if (!tableRows || tableRows.length === 0) continue;
    const local = copiedFkColumns(index.table);
    if (index.columns.some((c) => local.has(c) || c === "id")) continue;
    const values = tableRows
      .map((row) => index.columns.map((c) => row[c]))
      .filter((tuple) => tuple.every((v) => v !== null && v !== undefined));
    if (values.length === 0) continue;
    const keys = values.map((tuple) => Object.fromEntries(index.columns.map((c, i) => [c, tuple[i]])));
    const on = index.columns.map((c) => `t.${quote(c)} = k.${quote(c)}`).join(" and ");
    const hit = await dst.query<{ n: string }>(
      `select count(*)::text as n from ${quote(index.table)} t join jsonb_populate_recordset(null::${quote(index.table)}, $1::jsonb) k on ${on}`,
      [JSON.stringify(keys)],
    );
    if (Number(hit.rows[0]?.n ?? 0) > 0) {
      clashes.push(`${index.table}: ${hit.rows[0]!.n} value(s) of the unique ${index.name} (${index.columns.join(", ")}) already exist on the target.`);
    }
  }
  refuseAll("the target already holds this project, or part of it. This tool never merges into or overwrites a project.", clashes);

  // ---- the plan, printed ----
  const reportRows = plan.insertOrder.map((t) => {
    const r = remapped.report.get(t) ?? { rows: 0, seedRemapped: 0, jsonReplaced: 0 };
    return [t, String(r.rows), String(r.seedRemapped), String(r.jsonReplaced)];
  });
  const totals = plan.insertOrder.reduce(
    (acc, t) => {
      const r = remapped.report.get(t);
      return r ? [acc[0]! + r.rows, acc[1]! + r.seedRemapped, acc[2]! + r.jsonReplaced] : acc;
    },
    [0, 0, 0],
  );
  reportRows.push(["TOTAL", String(totals[0]), String(totals[1]), String(totals[2])]);
  console.log(`\nRows, in insert order:\n${table(reportRows, ["table", "rows", "seed ids remapped", "json replacements"])}`);
  const seedUse = [...seedMaps.values()].map((m) => `${m.table} ${m.mapped.size}/${m.mapped.size + m.unmapped.size}`).join(", ");
  console.log(`\nSeed maps (source ids with a target counterpart): ${seedUse}`);
  for (const [name, handling] of Object.entries(TABLE_HANDLING)) {
    if (handling.kind === "skip") console.log(`Not copied: ${name} -- ${handling.why}.`);
  }
  for (const warning of [...remapped.warnings, ...files.warnings]) console.log(`Note: ${warning}`);
  if (a.skipFiles && files.problems.length > 0) for (const p of files.problems) console.log(`Note (files skipped): ${p}`);

  // ---- files ----
  const sourceToken = process.env.SOURCE_BLOB_READ_WRITE_TOKEN ?? "";
  const targetToken = a.toEnv.BLOB_READ_WRITE_TOKEN ?? "";
  const sourceStore = sourceToken
    ? vercelBlobStore({ label: `the ${a.source.environment} store`, token: sourceToken, apiUrl: a.fromEnv.VERCEL_BLOB_API_URL ?? null })
    : null;
  const targetStore = targetToken
    ? vercelBlobStore({ label: `the ${a.target.environment} store`, token: targetToken, apiUrl: a.toEnv.VERCEL_BLOB_API_URL ?? null })
    : null;
  if (a.skipFiles) {
    console.log(`\nFiles: --skip-files, so none of the ${files.files.length} stored files is copied.`);
  } else {
    if (sourceStore) {
      for (const file of files.files) if (file.size === null) file.size = (await sourceStore.head(file.pathname))?.size ?? null;
    }
    const known = files.files.reduce((n, f) => n + (f.size ?? 0), 0);
    const unknown = files.files.filter((f) => f.size === null).length;
    console.log(`\nFiles: ${files.files.length}, ${bytes(known)}${unknown ? ` plus ${unknown} of unknown size (named only in staged JSON; SOURCE_BLOB_READ_WRITE_TOKEN is not set, so they were not asked about)` : ""}`);
    for (const file of files.files) console.log(`  ${file.size === null ? "?".padStart(10) : String(file.size).padStart(10)}  ${file.pathname}`);
  }

  const command = [
    "npx tsx tools/copy-project.ts",
    `--from=${a.fromPath}`,
    `--to=${a.toPath}`,
    `--project="${a.projectArg}"`,
    "--apply",
    ...(a.yesPilot ? ["--yes-pilot"] : []),
    ...(a.skipFiles ? ["--skip-files"] : []),
    ...(a.strict ? ["--strict"] : []),
  ].join(" ");
  if (!a.apply) {
    console.log("\nDry run: nothing was written.");
    console.log(`To copy it, run${a.skipFiles ? "" : " (with SOURCE_BLOB_READ_WRITE_TOKEN exported in your own terminal)"}:\n  ${command}`);
    return;
  }

  // ---- APPLY: files first, outside any transaction ----
  if (!a.skipFiles) {
    if (!sourceStore) fail("Refusing: SOURCE_BLOB_READ_WRITE_TOKEN is not set. Export it in your own terminal, or pass --skip-files to copy the rows only.");
    if (!targetStore) fail(`Refusing: ${a.toPath} has no BLOB_READ_WRITE_TOKEN for the target store.`);
    if (sourceToken === targetToken) console.log("Note: the source and target tokens are the same store; every file will already be there.");
    console.log(`\nCopying ${files.files.length} files...`);
    const outcome = await copyFiles(sourceStore, targetStore, files.files.map((f) => f.pathname), (line) => console.log(line));
    console.log(
      `Files: ${outcome.copied.length} copied (${bytes(outcome.bytesCopied)}), ${outcome.skipped.length} already there, ${outcome.missing.length} missing on the source, ${outcome.refused.length} refused.`,
    );
    if (outcome.refused.length > 0) fail("Refusing to write any rows: a file could not be copied safely (above). Nothing was written to the database.");
    if (outcome.missing.length > 0 && a.strict) fail("Refusing to write any rows: --strict, and files are missing on the source (above).");
  }

  // ---- APPLY: one transaction ----
  console.log("\nWriting the rows in one transaction...");
  const differences: string[] = [];
  try {
    await dst.query("begin");
    await dst.query(`select set_config('app.user', $1, true)`, [ACTOR]);
    await dst.query("set local time zone 'UTC'");
    // Re-checked inside the transaction: the dry-run's check is minutes old.
    const again = await dst.query("select 1 from projects where id = $1 or bws_project_number = $2", [projectId, project.bws_project_number]);
    if (again.rowCount) throw new Error("the project appeared on the target since the pre-flight check");
    for (const tableName of plan.insertOrder) {
      const tableRows = remapped.rows.get(tableName) ?? [];
      if (tableRows.length === 0) continue;
      const shape = sourceSchema.tables.get(tableName)!;
      const columns = shape.columns.filter((c) => !c.generated).map((c) => quote(c.name)).join(", ");
      await dst.query(
        `insert into ${quote(tableName)} (${columns}) select ${columns} from jsonb_populate_recordset(null::${quote(tableName)}, $1::jsonb)`,
        [JSON.stringify(tableRows)],
      );
    }
    for (const tableName of plan.insertOrder) {
      const shape = sourceSchema.tables.get(tableName)!;
      const expected = remapped.rows.get(tableName) ?? [];
      const landed = await readBack(dst, tableName, shape, expected);
      for (const d of diffRows(shape, expected, landed)) differences.push(`${tableName} ${d}`);
    }
    if (differences.length > 0) throw new Error("the rows read back differ from the rows sent");
    await dst.query("commit");
  } catch (error) {
    await dst.query("rollback").catch(() => {});
    for (const d of differences.slice(0, 60)) console.error(`  - ${d}`);
    fail(`FAILED, rolled back, nothing written to the database: ${(error as Error).message}`);
  }

  // ---- read back, after commit, against the source's counts ----
  const verify = new pg.Client({ connectionString: a.target.databaseUrl });
  await verify.connect();
  const compare: string[][] = [];
  let mismatch = false;
  try {
    for (const tableName of plan.insertOrder) {
      const shape = sourceSchema.tables.get(tableName)!;
      const expected = rows.get(tableName) ?? [];
      const onTarget = (await readBack(verify, tableName, shape, expected)).length;
      if (onTarget !== expected.length) mismatch = true;
      compare.push([tableName, String(expected.length), String(onTarget), onTarget === expected.length ? "ok" : "MISMATCH"]);
    }
  } finally {
    await verify.end().catch(() => {});
  }
  console.log(`\nRead back on the target after commit:\n${table(compare, ["table", "source", "target", ""])}`);
  if (mismatch) fail("FAILED: the target's counts do not match the source's (above).");
  console.log(`\nCopied. Every row was read back and compared column by column before commit; ${ACTOR} is the actor on the target's audit rows.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
