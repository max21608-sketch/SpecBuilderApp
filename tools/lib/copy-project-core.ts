// The pure half of `tools/copy-project.ts`: what a project IS in this schema,
// how its rows are carried to another database, and every refusal that
// decides. No connection, no store, no clock -- so each rule below is a test in
// `tests/lib/copy-project.test.ts` rather than a sentence.
//
// ============================================================================
// THE TRAP THIS FILE EXISTS FOR: SEED ROWS DO NOT SHARE IDS
//
// A project's OWN rows are inserted under their own uuids. The target is a
// different database, so there is nothing to collide with, and the tool proves
// it before it writes (no copied id may already exist on the target).
//
// The rows a project POINTS AT are another matter. `requirements`,
// `spec_fields`, `item_categories` and `spec_palette_options` were each seeded
// separately into each environment, and their ids differ (measured: pilot and
// sandbox share none). A `spec_answers.requirement_id` copied verbatim would
// point at nothing on the target -- or, worse, the FK would hold because by
// some accident it pointed at a different question. So every reference to a
// seed table is REMAPPED BY NATURAL KEY: the field's BWS `json_id`, the
// category's slug, the requirement's (category, kind, field, local key,
// prompt), the palette option's (palette, value). A seed id with no
// counterpart on the target is a REFUSAL naming the row -- never a null and
// never the nearest thing, because a wrong question id is an answer filed
// under the wrong question, and nothing downstream would ever ask.
//
// THE SAME IDS HIDE INSIDE JSON. A staged drawing's proposals carry field ids,
// a bill's staged lines carry category ids, a version's atoms carry
// requirement ids. `remapJson` walks every jsonb value and replaces any string
// -- value OR object key -- that is EXACTLY a mapped source seed id. Nothing
// else is touched: no substring, no prefix, no "looks like a uuid". A string
// that is exactly an UNMAPPED seed id is a refusal for the same reason as the
// column.
//
// ============================================================================
// WHAT A PROJECT IS, AND WHY THE SET IS DISCOVERED RATHER THAN LISTED
//
// The rows to copy are found from the live schema's foreign keys: everything
// reachable from `projects` by following FKs backwards, plus the four
// POLYMORPHIC tables (attachments, notes, status_history, messages) whose
// `entity_id` names a copied row. A list of tables written here would go stale
// the day a migration adds one, and the copy would leave that table behind
// without a word.
//
// But discovery alone cannot know what a new table MEANS -- whether a uuid
// column without an FK is a reference, whether a new FK into a project table
// comes from somewhere that should travel with it. So every table in the live
// schema must ALSO be classified in `TABLE_HANDLING` below, and anything
// unclassified, or classified one way while the schema says another, is a
// refusal naming it. The classification is a guard on the discovery, never a
// substitute for it: a table added next month stops the tool until somebody
// reads it and says what it is.
// ============================================================================

export type Column = { name: string; type: string; generated: boolean };
export type TableShape = { columns: Column[]; pk: string[] };
export type Fk = { name: string; table: string; columns: string[]; refTable: string; refColumns: string[] };
export type UniqueIndex = { table: string; name: string; columns: string[]; predicate: string | null };
export type Schema = { tables: Map<string, TableShape>; fks: Fk[]; uniques: UniqueIndex[] };

/** A uuid column with no FK behind it, and what it holds. */
export type ImplicitRef =
  /** an `attachments.id` with no constraint (0001's polymorphic table cannot be FK'd to and from) */
  | "attachment"
  /** the id of SOME row of this project (`spec_answers.source_id`: a run today, anything tomorrow) */
  | "owned-any"
  /** not a reference: a token or an attempt id that means nothing outside its own row */
  | "opaque";

export type Handling =
  | { kind: "root" }
  | { kind: "owned"; implicit?: Record<string, ImplicitRef>; blobColumns?: string[] }
  | { kind: "polymorphic"; implicit?: Record<string, ImplicitRef>; blobColumns?: string[] }
  | { kind: "seed"; keySql: string }
  | { kind: "skip"; why: string };

// Requirement identity. `requirements_category_sort_key` is unique, but a sort
// order is a position, and a re-seed that renumbers a sheet would move every
// answer onto its neighbour. This is what the question IS: its sheet, its
// kind, the BWS field or local key it answers, and its words. Measured
// 2026-10-11: all 797 rows match one-to-one between pilot and the local stack
// on this key, and it is unique on both. Uniqueness is CHECKED at run time
// anyway (`buildSeedMap`): a duplicated key maps nothing.
const REQUIREMENT_KEY = `c.slug || ' | ' || r.kind || ' | ' || coalesce(f.json_id::text, '-') || ' | ' || coalesce(r.local_key, '-') || ' | ' || r.prompt`;

/**
 * Every table in the schema, and what the copy does with it. A table missing
 * from here is a refusal: see the head of this file.
 */
export const TABLE_HANDLING: Record<string, Handling> = {
  projects: { kind: "root" },

  // ---- owned: found by FK from `projects`, copied under their own ids ----
  spec_runs: { kind: "owned" },
  spec_records: { kind: "owned" },
  spec_record_refs: { kind: "owned" },
  spec_answers: { kind: "owned", implicit: { source_id: "owned-any" } },
  intake_batches: { kind: "owned" },
  intake_runs: {
    kind: "owned",
    implicit: { attachment_id: "attachment", attempt_id: "opaque", claim_token: "opaque" },
  },
  record_attributes: { kind: "owned" },
  project_notes: { kind: "owned" },
  change_sets: { kind: "owned", implicit: { evidence_attachment_id: "attachment" } },
  record_snapshots: { kind: "owned" },
  baseline_members: { kind: "owned" },
  project_finishes: { kind: "owned" },
  project_contacts: { kind: "owned" },
  email_drafts: { kind: "owned" },
  email_draft_items: { kind: "owned" },
  email_messages: {
    kind: "owned",
    implicit: { mime_attachment_id: "attachment" },
    // The arrival copy, under `mailbox/`. `assignMessage` COPIES it under the
    // project and keeps this one as the arrival record, so both travel.
    blobColumns: ["mailbox_storage_path"],
  },
  attribute_disagreements: { kind: "owned" },

  // ---- polymorphic: entity_type + entity_id, no FK possible ----
  attachments: { kind: "polymorphic", blobColumns: ["storage_path"] },
  notes: { kind: "polymorphic" },
  status_history: { kind: "polymorphic" },
  messages: { kind: "polymorphic" },

  // ---- seed: remapped by natural key, never copied ----
  spec_fields: { kind: "seed", keySql: `select id::text as id, json_id::text as key from spec_fields` },
  item_categories: { kind: "seed", keySql: `select id::text as id, slug as key from item_categories` },
  requirements: {
    kind: "seed",
    keySql: `select r.id::text as id, ${REQUIREMENT_KEY} as key
               from requirements r
               join item_categories c on c.id = r.category_id
               left join spec_fields f on f.id = r.spec_field_id`,
  },
  requirement_aliases: {
    kind: "seed",
    keySql: `select a.id::text as id, ${REQUIREMENT_KEY} || ' | ' || a.term_norm as key
               from requirement_aliases a
               join requirements r on r.id = a.requirement_id
               join item_categories c on c.id = r.category_id
               left join spec_fields f on f.id = r.spec_field_id`,
  },
  item_category_aliases: {
    kind: "seed",
    keySql: `select a.id::text as id, c.slug || ' | ' || a.term_norm as key
               from item_category_aliases a join item_categories c on c.id = a.category_id`,
  },
  spec_palettes: { kind: "seed", keySql: `select id::text as id, key as key from spec_palettes` },
  spec_palette_options: {
    kind: "seed",
    keySql: `select id::text as id, palette_key || ' | ' || value as key from spec_palette_options`,
  },
  spec_matrix_categories: { kind: "seed", keySql: `select id::text as id, code as key from spec_matrix_categories` },
  spec_matrix_category_map: {
    kind: "seed",
    keySql: `select m.id::text as id, m.matrix_code || ' | ' || c.slug as key
               from spec_matrix_category_map m join item_categories c on c.id = m.item_category_id`,
  },
  spec_field_gates: {
    kind: "seed",
    keySql: `select id::text as id, matrix_row::text || ' | ' || gate || ' | ' || coalesce(dimension_slot, '-') as key from spec_field_gates`,
  },
  bws_boilerplates: { kind: "seed", keySql: `select id::text as id, code as key from bws_boilerplates` },
  // A saved bill layout is named, and the bill's staged JSON names the one it
  // was read with. Seeded on every environment under the same name.
  boq_layouts: { kind: "seed", keySql: `select id::text as id, name as key from boq_layouts` },
  boq_column_aliases: { kind: "seed", keySql: `select id::text as id, term_norm as key from boq_column_aliases` },
  // No project column references a user today (`created_by` is an email in a
  // text column, kept as it is). If one ever does, it maps by email.
  users: { kind: "seed", keySql: `select id::text as id, lower(email) as key from users` },

  // ---- skip ----
  audit_log: {
    kind: "skip",
    why: "forensic and per environment; the target's own audit triggers record the inserts (as system:copy-project)",
  },
  schema_migrations: { kind: "skip", why: "the ledger of the target's own schema" },
  graph_subscriptions: { kind: "skip", why: "a mailbox subscription belongs to a deployment, not a project" },
  pick_lists: { kind: "skip", why: "dead since 0001 and linked to nothing" },
};

export type SchemaPlan = {
  /** Every table whose rows travel, in an order the FKs accept. */
  insertOrder: string[];
  problems: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isCopied(handling: Handling | undefined): boolean {
  return handling?.kind === "root" || handling?.kind === "owned" || handling?.kind === "polymorphic";
}

/**
 * The schema, read against the classification. Every problem is a sentence
 * naming a table or a column; any problem stops the tool before it reads a
 * row.
 */
export function planSchema(schema: Schema, handling: Record<string, Handling> = TABLE_HANDLING): SchemaPlan {
  const problems: string[] = [];
  const tables = [...schema.tables.keys()].sort();

  for (const table of tables) {
    if (!handling[table]) {
      problems.push(
        `Table ${table} is in the schema and this tool does not know what it is. Read it, decide whether it travels with a project, and add it to TABLE_HANDLING in tools/lib/copy-project-core.ts.`,
      );
    }
  }
  for (const table of Object.keys(handling)) {
    if (!schema.tables.has(table)) {
      problems.push(`TABLE_HANDLING names ${table}, which the schema does not have. Remove it, or the schemas are not what this tool was written against.`);
    }
  }
  if (!schema.tables.has("projects")) {
    problems.push("The schema has no projects table.");
    return { insertOrder: [], problems };
  }

  // Reachable from projects by FK, child direction.
  const reachable = new Set<string>(["projects"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const fk of schema.fks) {
      if (reachable.has(fk.refTable) && !reachable.has(fk.table)) {
        // Added whatever it is classified as, so a seed or skipped table that
        // has grown an FK into a project is reported just below.
        reachable.add(fk.table);
        grew = true;
      }
    }
  }
  for (const table of reachable) {
    const h = handling[table];
    if (h && h.kind !== "owned" && h.kind !== "root") {
      problems.push(`Table ${table} reaches projects by a foreign key but is classified ${h.kind}. Re-read it.`);
    }
  }
  for (const table of tables) {
    if (handling[table]?.kind === "owned" && !reachable.has(table)) {
      problems.push(`Table ${table} is classified owned but no foreign key connects it to projects any more. Re-read it.`);
    }
  }

  for (const fk of schema.fks) {
    const from = handling[fk.table];
    const to = handling[fk.refTable];
    if (!from || !to) continue; // already reported as unclassified
    // Anything pointing INTO a copied table has to travel with it, or the
    // copy leaves a row behind that the project's own rows are pointed at by.
    if (isCopied(to) && !isCopied(from)) {
      problems.push(
        `${fk.table}.${fk.columns.join(",")} references ${fk.refTable}, which is copied, but ${fk.table} is classified ${from.kind}. This tool does not know how to carry it.`,
      );
    }
    if (isCopied(from) && to.kind === "skip") {
      problems.push(`${fk.table}.${fk.columns.join(",")} references ${fk.refTable}, which this tool skips.`);
    }
    if (isCopied(from) && isCopied(to)) {
      const shape = schema.tables.get(fk.refTable);
      if (!shape || shape.pk.length !== 1 || shape.pk[0] !== "id") {
        problems.push(`${fk.refTable} is referenced by ${fk.table} but its key is not a single id column.`);
      }
    }
  }

  // A seed reference is carried by remapping the column through an FK onto
  // the seed's own `id`. A column whose only FK lands on some OTHER column of
  // a seed table (the second half of `spec_answers_requirement_field_fk`) must
  // be remapped by a second FK that does land on an id -- otherwise the tool
  // would copy a seed value it cannot translate.
  for (const table of tables) {
    if (!isCopied(handling[table])) continue;
    const seedCols = new Set<string>();
    const remappable = new Set<string>();
    for (const fk of schema.fks.filter((f) => f.table === table && handling[f.refTable]?.kind === "seed")) {
      fk.columns.forEach((column, i) => {
        seedCols.add(column);
        if (fk.refColumns[i] === "id") remappable.add(column);
      });
    }
    for (const column of seedCols) {
      if (!remappable.has(column)) {
        problems.push(`${table}.${column} references a seed table on a column other than its id; this tool cannot remap it.`);
      }
    }
  }

  // Every uuid column on a copied table must be accounted for: its key, an
  // FK, the polymorphic entity id, or a declared implicit reference. A uuid
  // column with none of those is a reference nobody has told the tool about,
  // and copying it verbatim might carry a seed id across untranslated.
  for (const table of tables) {
    const h = handling[table];
    if (!h || !isCopied(h)) continue;
    const shape = schema.tables.get(table)!;
    const fkCols = new Set(schema.fks.filter((f) => f.table === table).flatMap((f) => f.columns));
    const implicit = h.kind === "owned" || h.kind === "polymorphic" ? (h.implicit ?? {}) : {};
    for (const column of shape.columns) {
      if (column.type !== "uuid" && column.type !== "_uuid") continue;
      if (shape.pk.includes(column.name) && column.name === "id") continue;
      if (fkCols.has(column.name)) continue;
      if (h.kind === "polymorphic" && column.name === "entity_id") continue;
      if (implicit[column.name]) continue;
      problems.push(
        `${table}.${column.name} is a uuid column with no foreign key, and this tool does not know what it holds. Declare it in TABLE_HANDLING.${table}.implicit.`,
      );
    }
    for (const declared of Object.keys(implicit)) {
      if (!shape.columns.some((c) => c.name === declared)) {
        problems.push(`TABLE_HANDLING declares ${table}.${declared}, which the schema does not have.`);
      }
    }
    if (shape.pk.length === 0) problems.push(`Copied table ${table} has no primary key; its rows could not be told apart or read back.`);
    if (h.kind === "polymorphic") {
      for (const needed of ["id", "entity_type", "entity_id"]) {
        if (!shape.columns.some((c) => c.name === needed)) problems.push(`Polymorphic table ${table} has no ${needed} column.`);
      }
    }
    for (const blob of (h.kind === "owned" || h.kind === "polymorphic" ? h.blobColumns : undefined) ?? []) {
      if (!shape.columns.some((c) => c.name === blob)) problems.push(`TABLE_HANDLING names ${table}.${blob} as a file column; the schema has no such column.`);
    }
  }

  // Insert order: a topological sort over the FKs between copied tables. A
  // self-reference (`parent_id`, `superseded_by_id`, `replaced_by_run_id`,
  // `mockup_of`) needs no ordering at all: each table goes in as ONE
  // statement, and a non-deferrable FK is checked at the END of the statement,
  // so a row may point at another row of the same insert. That is why there is
  // no insert-then-update here: an update would fire `bump_version` and
  // `set_updated_at`, and the copy would land with versions and timestamps the
  // source never had.
  const copied = tables.filter((t) => isCopied(handling[t]));
  const deps = new Map<string, Set<string>>(copied.map((t) => [t, new Set<string>()]));
  for (const fk of schema.fks) {
    if (fk.table === fk.refTable) continue;
    if (deps.has(fk.table) && deps.has(fk.refTable)) deps.get(fk.table)!.add(fk.refTable);
  }
  const insertOrder: string[] = [];
  const placed = new Set<string>();
  while (insertOrder.length < copied.length) {
    const ready = copied.filter((t) => !placed.has(t) && [...deps.get(t)!].every((d) => placed.has(d)));
    if (ready.length === 0) {
      const stuck = copied.filter((t) => !placed.has(t));
      problems.push(`The foreign keys between ${stuck.join(", ")} form a cycle; this tool inserts each table once and cannot order them.`);
      break;
    }
    // Root first, then alphabetical among the ready, so the order is stable.
    ready.sort((a, b) => (a === "projects" ? -1 : b === "projects" ? 1 : a.localeCompare(b)));
    insertOrder.push(ready[0]!);
    placed.add(ready[0]!);
  }

  return { insertOrder, problems };
}

/**
 * The two schemas a copy runs between must be the same schema. A column the
 * target lacks would be dropped by the insert; a column only the target has
 * would be filled by its default -- either way the copy is not the project.
 */
export function compareSchemas(source: Schema, target: Schema): string[] {
  const problems: string[] = [];
  const describe = (schema: Schema) => {
    const lines = new Set<string>();
    for (const [table, shape] of schema.tables) {
      for (const column of shape.columns) lines.add(`column ${table}.${column.name} ${column.type}${column.generated ? " generated" : ""}`);
      lines.add(`key ${table} (${shape.pk.join(",")})`);
    }
    for (const fk of schema.fks) lines.add(`fk ${fk.table}(${fk.columns.join(",")}) -> ${fk.refTable}(${fk.refColumns.join(",")})`);
    return lines;
  };
  const a = describe(source);
  const b = describe(target);
  for (const line of a) if (!b.has(line)) problems.push(`The source has ${line}; the target does not.`);
  for (const line of b) if (!a.has(line)) problems.push(`The target has ${line}; the source does not.`);
  return problems;
}

// ============================================================================
// Seed maps

export type SeedKeyRow = { id: string; key: string };
export type SeedMapping = {
  table: string;
  /** source id -> target id */
  mapped: Map<string, string>;
  /** source id -> why it cannot be mapped (its key, and what is wrong) */
  unmapped: Map<string, string>;
};

/**
 * One seed table's map, by natural key. A key that is duplicated on EITHER
 * side maps nothing -- `findRecordsByRef`'s rule: two candidates is a
 * question, not an answer -- and a key missing on the target maps nothing.
 * Neither is an error until something actually references that id.
 */
export function buildSeedMap(table: string, source: SeedKeyRow[], target: SeedKeyRow[]): SeedMapping {
  const count = (rows: SeedKeyRow[]) => {
    const byKey = new Map<string, string[]>();
    for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row.id]);
    return byKey;
  };
  const sourceByKey = count(source);
  const targetByKey = count(target);
  const mapped = new Map<string, string>();
  const unmapped = new Map<string, string>();
  for (const row of source) {
    const onTarget = targetByKey.get(row.key) ?? [];
    if ((sourceByKey.get(row.key) ?? []).length > 1) {
      unmapped.set(row.id, `${table} "${row.key}" is not unique on the source`);
    } else if (onTarget.length === 0) {
      unmapped.set(row.id, `${table} "${row.key}" does not exist on the target`);
    } else if (onTarget.length > 1) {
      unmapped.set(row.id, `${table} "${row.key}" is not unique on the target`);
    } else {
      mapped.set(row.id, onTarget[0]!);
    }
  }
  return { table, mapped, unmapped };
}

/** Every seed table's maps merged, for the JSON walk, which cannot know a string's table. */
export function mergeSeedMaps(maps: SeedMapping[]): { mapped: Map<string, string>; unmapped: Map<string, string> } {
  const mapped = new Map<string, string>();
  const unmapped = new Map<string, string>();
  for (const map of maps) {
    for (const [from, to] of map.mapped) mapped.set(from, to);
    for (const [from, why] of map.unmapped) unmapped.set(from, why);
  }
  return { mapped, unmapped };
}

// ============================================================================
// The JSON walk

export type JsonWalk = { value: unknown; replaced: number; unmapped: string[] };

/**
 * Replace every string -- value or object key -- that is EXACTLY a mapped
 * source seed id. Returns a new value; the input is not modified. A string
 * that is exactly an UNMAPPED seed id is returned in `unmapped` and left as
 * it is, and the caller refuses.
 */
export function remapJson(value: unknown, mapped: Map<string, string>, unmapped: Map<string, string>): JsonWalk {
  let replaced = 0;
  const misses: string[] = [];
  const swap = (text: string): string => {
    const to = mapped.get(text);
    if (to !== undefined) {
      replaced += 1;
      return to;
    }
    const why = unmapped.get(text);
    if (why !== undefined) misses.push(`${text} (${why})`);
    return text;
  };
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return swap(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) out[swap(key)] = walk(child);
      return out;
    }
    return node;
  };
  const result = walk(value);
  return { value: result, replaced, unmapped: misses };
}

// ============================================================================
// Rows

export type Row = Record<string, unknown>;
export type TableRows = Map<string, Row[]>;

/** The identity of a row: its id, or its whole key for a table with none (`baseline_members`). */
export function rowIdentity(shape: TableShape, row: Row): string {
  return shape.pk.map((column) => String(row[column])).join("|");
}

export type TableReport = { rows: number; seedRemapped: number; jsonReplaced: number };
export type RemapResult = {
  rows: TableRows;
  report: Map<string, TableReport>;
  problems: string[];
  warnings: string[];
};

/**
 * Translate every copied row for the target: seed FK columns through their
 * maps, jsonb columns through the walk. Checks, on the way, that every
 * reference to a copied table stays inside the copy -- a row pointing at a
 * record of ANOTHER project would arrive pointing at nothing.
 */
export function remapRows(
  schema: Schema,
  rows: TableRows,
  seedMaps: Map<string, SeedMapping>,
  handling: Record<string, Handling> = TABLE_HANDLING,
): RemapResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const report = new Map<string, TableReport>();
  const out: TableRows = new Map();
  const merged = mergeSeedMaps([...seedMaps.values()]);

  const idsByTable = new Map<string, Set<string>>();
  const everyId = new Set<string>();
  for (const [table, tableRows] of rows) {
    const ids = new Set<string>();
    for (const row of tableRows) {
      if (isUuid(row.id)) {
        ids.add(row.id);
        everyId.add(row.id);
      }
    }
    idsByTable.set(table, ids);
  }

  for (const [table, tableRows] of rows) {
    const h = handling[table];
    const shape = schema.tables.get(table);
    if (!shape || !h || !isCopied(h)) {
      problems.push(`Rows were collected for ${table}, which is not a copied table.`);
      continue;
    }
    const fks = schema.fks.filter((f) => f.table === table);
    const seedFks = fks.filter((f) => handling[f.refTable]?.kind === "seed");
    const copiedFks = fks.filter((f) => isCopied(handling[f.refTable]));
    const implicit = h.kind === "owned" || h.kind === "polymorphic" ? (h.implicit ?? {}) : {};
    const jsonColumns = shape.columns.filter((c) => c.type === "jsonb" || c.type === "json").map((c) => c.name);
    const textColumns = shape.columns.filter((c) => c.type === "text").map((c) => c.name);
    const tally: TableReport = { rows: tableRows.length, seedRemapped: 0, jsonReplaced: 0 };
    let ownedAnyOutside = 0;
    const translated: Row[] = [];

    for (const source of tableRows) {
      const row: Row = { ...source };
      const where = `${table} ${rowIdentity(shape, source)}`;

      for (const [column, value] of Object.entries(row)) {
        if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
          problems.push(`${where}.${column} holds ${value}, beyond what this tool can carry without rounding.`);
        }
      }

      // Seed columns, through the map of the table the FK lands on.
      const remappedHere = new Set<string>();
      for (const fk of seedFks) {
        fk.columns.forEach((column, i) => {
          // A column in two FKs (`spec_answers.requirement_id` is in the
          // single one AND the composite) is translated, or refused, once.
          if (fk.refColumns[i] !== "id" || remappedHere.has(column)) return;
          remappedHere.add(column);
          const value = source[column];
          if (value === null || value === undefined) return;
          const map = seedMaps.get(fk.refTable);
          const to = map?.mapped.get(String(value));
          if (to === undefined) {
            const why = map?.unmapped.get(String(value)) ?? `${fk.refTable} ${String(value)} does not exist on the source`;
            problems.push(`${where}.${column} cannot be carried: ${why}.`);
            return;
          }
          row[column] = to;
          tally.seedRemapped += 1;
        });
      }

      // References into the copy must land inside it.
      for (const fk of copiedFks) {
        fk.columns.forEach((column, i) => {
          if (fk.refColumns[i] !== "id") return; // the composite halves (`project_id`) are checked by their own single FKs
          const value = source[column];
          if (value === null || value === undefined) return;
          if (!idsByTable.get(fk.refTable)?.has(String(value))) {
            problems.push(`${where}.${column} points at ${fk.refTable} ${String(value)}, which is not part of this project's copy.`);
          }
        });
      }
      for (const [column, kind] of Object.entries(implicit)) {
        const value = source[column];
        if (value === null || value === undefined || kind === "opaque") continue;
        if (kind === "attachment" && !idsByTable.get("attachments")?.has(String(value))) {
          problems.push(`${where}.${column} names attachment ${String(value)}, which the source does not hold.`);
        }
        if (kind === "owned-any" && !everyId.has(String(value))) ownedAnyOutside += 1;
      }

      // jsonb, walked.
      for (const column of jsonColumns) {
        if (source[column] === null || source[column] === undefined) continue;
        const walked = remapJson(source[column], merged.mapped, merged.unmapped);
        row[column] = walked.value;
        tally.jsonReplaced += walked.replaced;
        for (const miss of walked.unmapped) problems.push(`${where}.${column} carries the seed id ${miss}.`);
      }

      // A seed id sitting in a TEXT column would cross untranslated and
      // silently. None does today; one appearing is a refusal, not a guess.
      for (const column of textColumns) {
        const value = source[column];
        if (typeof value !== "string") continue;
        if (merged.mapped.has(value) || merged.unmapped.has(value)) {
          problems.push(`${where}.${column} is a text column holding the seed id ${value}; this tool does not translate text columns.`);
        }
      }

      translated.push(row);
    }
    if (ownedAnyOutside > 0) {
      warnings.push(`${ownedAnyOutside} ${table} row(s) carry an id (${Object.keys(implicit).filter((c) => implicit[c] === "owned-any").join(", ")}) naming no row of the copy; kept as they are.`);
    }
    out.set(table, translated);
    report.set(table, tally);
  }
  return { rows: out, report, problems, warnings };
}

// ============================================================================
// Files

/** `blob-source.ts`'s `blobPathname`, restated so the tool needs no app import: a stored URL only for a Vercel Blob host. */
export function blobPathname(stored: string): string | null {
  if (!/^https?:\/\//i.test(stored)) return stored.replace(/^\/+/, "");
  let parsed: URL;
  try {
    parsed = new URL(stored);
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) return null;
  return decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
}

export type FileRef = { pathname: string; size: number | null; from: string };
export type FilePlan = { files: FileRef[]; problems: string[]; warnings: string[] };

/**
 * Every stored file the copied rows name: the declared file columns, and every
 * jsonb string that is a pathname under this project's own prefix (a bill's
 * row pictures live only in its staged JSON, and a version's atoms name its
 * picture). Only `projects/<id>/` and `mailbox/` are ever copied -- the scope
 * `blob-source.ts` reads under -- so a pathname outside them is reported, not
 * fetched.
 */
export function collectFiles(
  schema: Schema,
  rows: TableRows,
  projectId: string,
  handling: Record<string, Handling> = TABLE_HANDLING,
): FilePlan {
  const prefix = `projects/${projectId}/`;
  const byPath = new Map<string, FileRef>();
  const problems: string[] = [];
  const warnings: string[] = [];
  const inScope = (p: string) => !p.includes("..") && !p.includes("\\") && (p.startsWith(prefix) || p.startsWith("mailbox/"));
  const add = (pathname: string, size: number | null, from: string) => {
    const known = byPath.get(pathname);
    if (!known) byPath.set(pathname, { pathname, size, from });
    else if (known.size === null && size !== null) known.size = size;
  };

  for (const [table, tableRows] of rows) {
    const h = handling[table];
    const shape = schema.tables.get(table);
    if (!h || !shape) continue;
    const blobColumns = h.kind === "owned" || h.kind === "polymorphic" ? (h.blobColumns ?? []) : [];
    const jsonColumns = shape.columns.filter((c) => c.type === "jsonb" || c.type === "json").map((c) => c.name);
    for (const row of tableRows) {
      for (const column of blobColumns) {
        const stored = row[column];
        if (typeof stored !== "string" || stored === "") continue;
        const pathname = blobPathname(stored);
        if (!pathname || !inScope(pathname)) {
          problems.push(`${table} ${String(row.id)}.${column} names a file outside this project's store prefix (${stored}); it would not be copied.`);
          continue;
        }
        const size = table === "attachments" && typeof row.size === "number" ? row.size : table === "email_messages" && typeof row.mime_size === "number" ? row.mime_size : null;
        add(pathname, size, `${table}.${column}`);
      }
      for (const column of jsonColumns) {
        const visit = (node: unknown) => {
          if (typeof node === "string") {
            if (node.startsWith(prefix) && inScope(node)) add(node, null, `${table}.${column}`);
            else if (/^projects\/[0-9a-f-]{36}\//i.test(node) && !node.startsWith(prefix)) {
              warnings.push(`${table} ${String(row.id)}.${column} names another project's file (${node}); not copied.`);
            }
          } else if (Array.isArray(node)) node.forEach(visit);
          else if (node && typeof node === "object") Object.values(node as Record<string, unknown>).forEach(visit);
        };
        visit(row[column]);
      }
    }
  }
  const files = [...byPath.values()].sort((a, b) => a.pathname.localeCompare(b.pathname));
  return { files, problems, warnings: [...new Set(warnings)] };
}

// ============================================================================
// Read-back

/** Canonical JSON: sorted keys, so jsonb's own key order never reads as a difference. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * What landed against what was meant to land, column by column. A trigger
 * that forced a value (`assign_variant_ordinal` filling an ordinal the source
 * left null) shows up here as a named difference, and the transaction is
 * rolled back rather than the trigger disabled.
 */
export function diffRows(shape: TableShape, expected: Row[], actual: Row[]): string[] {
  const differences: string[] = [];
  const landed = new Map(actual.map((row) => [rowIdentity(shape, row), row]));
  for (const row of expected) {
    const id = rowIdentity(shape, row);
    const got = landed.get(id);
    if (!got) {
      differences.push(`${id}: not on the target`);
      continue;
    }
    for (const column of shape.columns) {
      if (column.generated) continue;
      if (canonical(row[column.name]) !== canonical(got[column.name])) {
        differences.push(`${id}.${column.name}: expected ${canonical(row[column.name]).slice(0, 80)}, landed ${canonical(got[column.name]).slice(0, 80)}`);
      }
    }
  }
  if (actual.length > expected.length) differences.push(`${actual.length - expected.length} unexpected extra row(s)`);
  return differences;
}

// ============================================================================
// Guards

export type EnvSide = { databaseUrl: string; environment: string; host: string; database: string };

const DATABASE_ENVIRONMENTS = ["sandbox", "pilot", "production"];

/** Where an env file says it points, for printing and for the guards. */
export function describeEnv(env: Record<string, string | undefined>, label: string): EnvSide | string {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) return `${label}: DATABASE_URL is not set in that env file.`;
  const environment = env.DATABASE_ENVIRONMENT ?? "";
  if (!DATABASE_ENVIRONMENTS.includes(environment)) {
    return `${label}: DATABASE_ENVIRONMENT must be one of ${DATABASE_ENVIRONMENTS.join(", ")} (it is ${environment || "unset"}).`;
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return `${label}: DATABASE_URL is not a URL.`;
  }
  return { databaseUrl, environment, host: parsed.host, database: parsed.pathname.replace(/^\//, "") };
}

/** Neon's pooled and direct hosts for one endpoint are one database. */
function sameDatabaseHost(host: string): string {
  return host.toLowerCase().replace("-pooler.", ".").replace(/:5432$/, "");
}

/** The target guards: production never, pilot only with its own flag, and never the source itself. */
export function targetRefusal(source: EnvSide, target: EnvSide, flags: { yesPilot: boolean }): string | null {
  if (target.environment === "production") {
    return "Refusing: the target is production. This tool never writes to production.";
  }
  if (target.environment === "pilot" && !flags.yesPilot) {
    return "Refusing: the target is pilot. Pass --yes-pilot to write to it (--yes-production does not cover pilot, and nothing covers production).";
  }
  if (sameDatabaseHost(source.host) === sameDatabaseHost(target.host) && source.database === target.database) {
    return `Refusing: the source and the target are the same database (${target.host}/${target.database}).`;
  }
  return null;
}
