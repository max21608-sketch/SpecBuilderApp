// Database tier — 0056: the two lookups that scanned a whole table, and the
// ledger's checksum column.
//
// A catalog assertion rather than a timing: on a local database these tables
// are small enough that the planner may scan them anyway, and a test that
// passes because a table is small proves nothing about pilot's. What is
// asserted is that the index a lookup needs exists, keyed the way the query
// reads it.
import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import { describeIfDb } from "./db-tier";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("0056 indexes and the ledger checksum", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  async function indexdefs(table: string): Promise<string[]> {
    const { rows } = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = current_schema() and tablename = $1`,
      [table],
    );
    return rows.map((row) => row.indexdef);
  }

  it("indexes a change set by the evidence it carries, in the order the screens read it", async () => {
    // records/[id] and finishes ask, per row, for the FIRST change that
    // carries an attachment as its evidence: equality, then created_at.
    const defs = await indexdefs("change_sets");
    expect(defs.some((def) => /\(evidence_attachment_id, created_at\) WHERE \(evidence_attachment_id IS NOT NULL\)/.test(def)))
      .toBe(true);
  });

  it("indexes an answer by its requirement", async () => {
    // The FK target with RESTRICT (a requirement delete checks every answer)
    // and the by-question key on the fill-in screen.
    const defs = await indexdefs("spec_answers");
    expect(defs.some((def) => /USING btree \(requirement_id\)/.test(def))).toBe(true);
  });

  it("gives the migration ledger a checksum column", async () => {
    const { rows } = await client.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = current_schema() and table_name = 'schema_migrations' and column_name = 'checksum'`,
    );
    expect(rows).toEqual([{ data_type: "text", is_nullable: "YES" }]);
  });
});
