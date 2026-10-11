// The pure half of tools/copy-project.ts: the schema guard, the seed remap,
// the JSON walk, the file scope and the target guards. The real run against a
// real project is the tool's own dry run and its read-back; these hold the
// rules that decide, each one a refusal somebody would otherwise relax.
import { describe, expect, it } from "vitest";
import {
  TABLE_HANDLING,
  buildSeedMap,
  collectFiles,
  compareSchemas,
  diffRows,
  planSchema,
  remapJson,
  remapRows,
  targetRefusal,
  type Fk,
  type Handling,
  type Row,
  type Schema,
  type SeedMapping,
  type TableRows,
  type TableShape,
} from "../../tools/lib/copy-project-core";

// ---------------------------------------------------------------- fixtures

const SRC_FIELD = "11111111-1111-4111-8111-111111111111";
const DST_FIELD = "22222222-2222-4222-8222-222222222222";
const SRC_REQ = "33333333-3333-4333-8333-333333333333";
const DST_REQ = "44444444-4444-4444-8444-444444444444";
const SRC_GONE = "55555555-5555-4555-8555-555555555555"; // a seed row the target lacks
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECORD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANSWER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ELSEWHERE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const col = (name: string, type = "text") => ({ name, type, generated: false });
const shape = (pk: string[], ...columns: ReturnType<typeof col>[]): TableShape => ({ pk, columns });
const fk = (table: string, columns: string[], refTable: string, refColumns = ["id"]): Fk => ({
  name: `${table}_${columns.join("_")}_fkey`,
  table,
  columns,
  refTable,
  refColumns,
});

/** A five-table miniature: a project, its records, their answers, two seed tables. */
function miniSchema(): Schema {
  return {
    tables: new Map<string, TableShape>([
      ["projects", shape(["id"], col("id", "uuid"), col("name"))],
      ["records", shape(["id"], col("id", "uuid"), col("project_id", "uuid"), col("parent_id", "uuid"), col("parsed", "jsonb"))],
      ["answers", shape(["id"], col("id", "uuid"), col("record_id", "uuid"), col("requirement_id", "uuid"), col("field_id", "uuid"), col("value"))],
      ["fields", shape(["id"], col("id", "uuid"), col("json_id", "int4"))],
      ["reqs", shape(["id"], col("id", "uuid"), col("field_id", "uuid"))],
    ]),
    fks: [
      fk("records", ["project_id"], "projects"),
      fk("records", ["parent_id"], "records"),
      fk("answers", ["record_id"], "records"),
      fk("answers", ["requirement_id"], "reqs"),
      fk("answers", ["field_id"], "fields"),
      // the composite half, landing on a non-id column of the seed
      fk("answers", ["requirement_id", "field_id"], "reqs", ["id", "field_id"]),
      fk("reqs", ["field_id"], "fields"),
    ],
    uniques: [],
  };
}

const miniHandling: Record<string, Handling> = {
  projects: { kind: "root" },
  records: { kind: "owned" },
  answers: { kind: "owned" },
  fields: { kind: "seed", keySql: "-" },
  reqs: { kind: "seed", keySql: "-" },
};

function miniMaps(): Map<string, SeedMapping> {
  return new Map([
    ["fields", buildSeedMap("fields", [{ id: SRC_FIELD, key: "3" }], [{ id: DST_FIELD, key: "3" }])],
    [
      "reqs",
      buildSeedMap(
        "reqs",
        [
          { id: SRC_REQ, key: "sofas | spec_field | 3 | - | Dimensions" },
          { id: SRC_GONE, key: "sofas | readiness | - | - | A question the target never had" },
        ],
        [{ id: DST_REQ, key: "sofas | spec_field | 3 | - | Dimensions" }],
      ),
    ],
  ]);
}

// ---------------------------------------------------------------- the JSON walk

describe("remapJson", () => {
  const mapped = new Map([[SRC_FIELD, DST_FIELD]]);
  const unmapped = new Map([[SRC_GONE, `reqs "x" does not exist on the target`]]);

  it("replaces a string value and an object key that are EXACTLY a mapped seed id, and counts them", () => {
    const walked = remapJson(
      { specFieldId: SRC_FIELD, byField: { [SRC_FIELD]: { label: "W" } }, list: [SRC_FIELD, "other"] },
      mapped,
      unmapped,
    );
    expect(walked.value).toEqual({ specFieldId: DST_FIELD, byField: { [DST_FIELD]: { label: "W" } }, list: [DST_FIELD, "other"] });
    expect(walked.replaced).toBe(3);
    expect(walked.unmapped).toEqual([]);
  });

  it("touches no other string: not a substring, not a prefix, not an upper-cased copy, not a project id", () => {
    const lettered = "abcdef12-3456-4789-8abc-def123456789";
    mapped.set(lettered, DST_FIELD);
    const input = {
      upperLettered: lettered.toUpperCase(),
      note: `field ${SRC_FIELD} was read`,
      path: `projects/${PROJECT}/${SRC_FIELD}.png`,
      record: RECORD,
      n: 3,
      flag: true,
      nothing: null,
    };
    const walked = remapJson(input, mapped, unmapped);
    expect(walked.value).toEqual(input);
    expect(walked.replaced).toBe(0);
  });

  it("reports a string that is exactly an UNMAPPED seed id, and leaves it as it is", () => {
    const walked = remapJson({ requirementId: SRC_GONE }, mapped, unmapped);
    expect(walked.value).toEqual({ requirementId: SRC_GONE });
    expect(walked.unmapped).toHaveLength(1);
    expect(walked.unmapped[0]).toContain("does not exist on the target");
  });

  it("does not modify its input", () => {
    const input = { a: [SRC_FIELD] };
    remapJson(input, mapped, unmapped);
    expect(input.a[0]).toBe(SRC_FIELD);
  });
});

// ---------------------------------------------------------------- natural keys

describe("buildSeedMap", () => {
  it("maps by natural key, whatever the ids are", () => {
    const map = buildSeedMap("spec_fields", [{ id: SRC_FIELD, key: "3" }], [{ id: DST_FIELD, key: "3" }]);
    expect(map.mapped.get(SRC_FIELD)).toBe(DST_FIELD);
    expect(map.unmapped.size).toBe(0);
  });

  it("maps nothing for a key the target lacks, or a key duplicated on either side -- and says which", () => {
    const map = buildSeedMap(
      "requirements",
      [
        { id: "s1", key: "missing" },
        { id: "s2", key: "twice-on-source" },
        { id: "s3", key: "twice-on-source" },
        { id: "s4", key: "twice-on-target" },
      ],
      [
        { id: "t1", key: "twice-on-source" },
        { id: "t2", key: "twice-on-target" },
        { id: "t3", key: "twice-on-target" },
      ],
    );
    expect(map.mapped.size).toBe(0);
    expect(map.unmapped.get("s1")).toContain("does not exist on the target");
    expect(map.unmapped.get("s2")).toContain("not unique on the source");
    expect(map.unmapped.get("s4")).toContain("not unique on the target");
  });

  it("the requirement key in TABLE_HANDLING names the question, not its position", () => {
    const h = TABLE_HANDLING.requirements;
    expect(h?.kind).toBe("seed");
    const sql = h?.kind === "seed" ? h.keySql : "";
    for (const part of ["c.slug", "r.kind", "f.json_id", "r.local_key", "r.prompt"]) expect(sql).toContain(part);
    expect(sql).not.toContain("sort_order");
  });
});

// ---------------------------------------------------------------- rows

describe("remapRows", () => {
  const rows = (): TableRows =>
    new Map<string, Row[]>([
      ["projects", [{ id: PROJECT, name: "Miami Beach" }]],
      ["records", [{ id: RECORD, project_id: PROJECT, parent_id: null, parsed: { fieldId: SRC_FIELD } }]],
      ["answers", [{ id: ANSWER, record_id: RECORD, requirement_id: SRC_REQ, field_id: SRC_FIELD, value: "W1900" }]],
    ]);

  it("remaps seed FK columns by natural key and walks the jsonb, leaving project ids alone", () => {
    const result = remapRows(miniSchema(), rows(), miniMaps(), miniHandling);
    expect(result.problems).toEqual([]);
    expect(result.rows.get("answers")![0]).toMatchObject({ id: ANSWER, record_id: RECORD, requirement_id: DST_REQ, field_id: DST_FIELD });
    expect(result.rows.get("records")![0]).toMatchObject({ id: RECORD, project_id: PROJECT, parsed: { fieldId: DST_FIELD } });
    expect(result.report.get("answers")).toEqual({ rows: 1, seedRemapped: 2, jsonReplaced: 0 });
    expect(result.report.get("records")).toEqual({ rows: 1, seedRemapped: 0, jsonReplaced: 1 });
  });

  it("REFUSES a seed id with no counterpart on the target, naming the row -- never a null, never a guess", () => {
    const input = rows();
    input.get("answers")![0]!.requirement_id = SRC_GONE;
    const result = remapRows(miniSchema(), input, miniMaps(), miniHandling);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain(`answers ${ANSWER}.requirement_id`);
    expect(result.problems[0]).toContain("A question the target never had");
  });

  it("refuses the same unmapped seed id hiding inside jsonb", () => {
    const input = rows();
    input.get("records")![0]!.parsed = { proposals: [{ requirementId: SRC_GONE }] };
    const result = remapRows(miniSchema(), input, miniMaps(), miniHandling);
    expect(result.problems.join("\n")).toContain(`records ${RECORD}.parsed carries the seed id ${SRC_GONE}`);
  });

  it("refuses a reference that leaves the copy (a parent on another project)", () => {
    const input = rows();
    input.get("records")![0]!.parent_id = ELSEWHERE;
    const result = remapRows(miniSchema(), input, miniMaps(), miniHandling);
    expect(result.problems.join("\n")).toContain(`points at records ${ELSEWHERE}, which is not part of this project's copy`);
  });

  it("refuses a seed id sitting in a text column, which it would otherwise carry untranslated", () => {
    const input = rows();
    input.get("answers")![0]!.value = SRC_FIELD;
    const result = remapRows(miniSchema(), input, miniMaps(), miniHandling);
    expect(result.problems.join("\n")).toContain("is a text column holding the seed id");
  });

  it("refuses an integer it could not carry without rounding", () => {
    const input = rows();
    input.get("projects")![0]!.name = 2 ** 60;
    const result = remapRows(miniSchema(), input, miniMaps(), miniHandling);
    expect(result.problems.join("\n")).toContain("beyond what this tool can carry");
  });
});

// ---------------------------------------------------------------- the schema guard

describe("planSchema", () => {
  it("accepts the miniature, and orders the inserts so every FK lands on a row already there", () => {
    const plan = planSchema(miniSchema(), miniHandling);
    expect(plan.problems).toEqual([]);
    expect(plan.insertOrder).toEqual(["projects", "records", "answers"]);
  });

  it("REFUSES a table it has never heard of that references a copied table, by name", () => {
    const schema = miniSchema();
    schema.tables.set("record_comments", shape(["id"], col("id", "uuid"), col("record_id", "uuid")));
    schema.fks.push(fk("record_comments", ["record_id"], "records"));
    const plan = planSchema(schema, miniHandling);
    expect(plan.problems.some((p) => p.startsWith("Table record_comments is in the schema and this tool does not know what it is"))).toBe(true);
  });

  it("refuses a table classified as skipped that has grown an FK into the project", () => {
    const schema = miniSchema();
    schema.tables.set("audit", shape(["id"], col("id", "uuid"), col("record_id", "uuid")));
    schema.fks.push(fk("audit", ["record_id"], "records"));
    const plan = planSchema(schema, { ...miniHandling, audit: { kind: "skip", why: "test" } });
    expect(plan.problems.join("\n")).toContain("audit.record_id references records, which is copied, but audit is classified skip");
  });

  it("refuses a uuid column with no FK that nobody has declared", () => {
    const schema = miniSchema();
    schema.tables.get("records")!.columns.push(col("mystery_id", "uuid"));
    const plan = planSchema(schema, miniHandling);
    expect(plan.problems.join("\n")).toContain("records.mystery_id is a uuid column with no foreign key");
  });

  it("refuses a seed reference it could only copy verbatim (an FK onto a seed's non-id column, alone)", () => {
    const schema = miniSchema();
    schema.fks = schema.fks.filter((f) => !(f.table === "answers" && f.columns.length === 1 && f.columns[0] === "field_id"));
    const plan = planSchema(schema, miniHandling);
    expect(plan.problems.join("\n")).toContain("answers.field_id references a seed table on a column other than its id");
  });

  it("the real classification covers the four polymorphic tables and skips audit_log, saying why", () => {
    for (const t of ["attachments", "notes", "status_history", "messages"]) expect(TABLE_HANDLING[t]?.kind).toBe("polymorphic");
    const audit = TABLE_HANDLING.audit_log;
    expect(audit?.kind).toBe("skip");
    expect(audit?.kind === "skip" ? audit.why : "").toContain("forensic");
  });
});

describe("compareSchemas", () => {
  it("names a column one side has and the other lacks", () => {
    const a = miniSchema();
    const b = miniSchema();
    b.tables.get("records")!.columns.push(col("added_later"));
    expect(compareSchemas(a, b)).toEqual(["The target has column records.added_later text; the source does not."]);
  });
});

// ---------------------------------------------------------------- read-back

describe("diffRows", () => {
  const s = shape(["id"], col("id", "uuid"), col("variant_ordinal", "int4"), col("atoms", "jsonb"));
  it("is silent when the rows match, whatever order jsonb kept the keys in", () => {
    expect(diffRows(s, [{ id: "x", variant_ordinal: null, atoms: { a: 1, b: 2 } }], [{ id: "x", variant_ordinal: null, atoms: { b: 2, a: 1 } }])).toEqual([]);
  });
  it("names a value a trigger forced, and a row that never landed", () => {
    const d = diffRows(s, [{ id: "x", variant_ordinal: null, atoms: {} }, { id: "y", variant_ordinal: 1, atoms: {} }], [{ id: "x", variant_ordinal: 3, atoms: {} }]);
    expect(d).toEqual(["x.variant_ordinal: expected null, landed 3", "y: not on the target"]);
  });
});

// ---------------------------------------------------------------- files

describe("collectFiles", () => {
  const schema: Schema = {
    tables: new Map([
      ["attachments", shape(["id"], col("id", "uuid"), col("storage_path"), col("size", "int8"))],
      ["intake_runs", shape(["id"], col("id", "uuid"), col("parsed", "jsonb"))],
    ]),
    fks: [],
    uniques: [],
  };
  const prefix = `projects/${PROJECT}/`;

  it("takes the file columns and every jsonb string under the project's own prefix, once each", () => {
    const plan = collectFiles(
      schema,
      new Map([
        ["attachments", [{ id: "a1", storage_path: `${prefix}bill.xlsx`, size: 10 }, { id: "a2", storage_path: `${prefix}pic.png`, size: 5 }]],
        ["intake_runs", [{ id: "r1", parsed: { rowImages: { 9: `${prefix}pic.png`, 10: `${prefix}only-in-json.png` }, label: "projects are fun" } }]],
      ]),
      PROJECT,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.files.map((f) => [f.pathname, f.size])).toEqual([
      [`${prefix}bill.xlsx`, 10],
      [`${prefix}only-in-json.png`, null],
      [`${prefix}pic.png`, 5],
    ]);
  });

  it("refuses a stored file outside the project's prefix, and only notes another project's path in JSON", () => {
    const plan = collectFiles(
      schema,
      new Map([
        ["attachments", [{ id: "a1", storage_path: `projects/${ELSEWHERE}/x.pdf`, size: 1 }]],
        ["intake_runs", [{ id: "r1", parsed: { image: `projects/${ELSEWHERE}/y.png` } }]],
      ]),
      PROJECT,
    );
    expect(plan.files).toEqual([]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.warnings[0]).toContain("names another project's file");
  });

  it("reads a legacy stored URL only for a Vercel Blob host", () => {
    const plan = collectFiles(
      schema,
      new Map([
        [
          "attachments",
          [
            { id: "a1", storage_path: `https://store.private.blob.vercel-storage.com/${prefix}old.pdf`, size: 1 },
            { id: "a2", storage_path: `https://evil.example.com/${prefix}x.pdf`, size: 1 },
          ],
        ],
      ]),
      PROJECT,
    );
    expect(plan.files.map((f) => f.pathname)).toEqual([`${prefix}old.pdf`]);
    expect(plan.problems).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- target guards

describe("targetRefusal", () => {
  const side = (environment: string, host: string, database = "neondb") => ({ databaseUrl: "-", environment, host, database });
  const pilot = side("pilot", "ep-pilot.eu-west-2.aws.neon.tech");
  const sandbox = side("sandbox", "ep-sandbox.eu-west-2.aws.neon.tech");

  it("never writes to production", () => {
    expect(targetRefusal(sandbox, side("production", "ep-prod.neon.tech"), { yesPilot: true })).toContain("never writes to production");
  });
  it("writes to pilot only with --yes-pilot", () => {
    expect(targetRefusal(sandbox, pilot, { yesPilot: false })).toContain("--yes-pilot");
    expect(targetRefusal(sandbox, pilot, { yesPilot: true })).toBeNull();
  });
  it("refuses the source's own database, pooled host or not", () => {
    expect(targetRefusal(pilot, side("sandbox", "ep-pilot-pooler.eu-west-2.aws.neon.tech"), { yesPilot: false })).toContain("same database");
  });
  it("lets pilot to sandbox through", () => {
    expect(targetRefusal(pilot, sandbox, { yesPilot: false })).toBeNull();
  });
});
