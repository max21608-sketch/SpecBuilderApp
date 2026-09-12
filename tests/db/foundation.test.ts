// Integration test for db/migrations/0001_foundation.sql: the audit trigger,
// its actor fallback, audit-log immutability, append-only notes, and the
// optimistic-lock version bump.
//
// These are the invariants the whole chassis rests on, and every one of them
// is enforced in the DATABASE rather than in application code -- which is the
// point, and also why they need a real database to test.
//
// Skipped when DATABASE_URL is unset. That is correct for CI, but it means a
// green run here proves nothing unless you set it. Run it against a sandbox
// branch before trusting a schema change.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const FOUNDATION_TABLES = [
  "users", "attachments", "messages", "status_history", "notes",
  "pick_lists", "audit_log", "schema_migrations",
];

describeIfDb("0001 foundation", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    // A scratch table with the standard shape, so the shared trigger
    // FUNCTIONS can be tested without depending on any domain table.
    await client.query("drop table if exists chassis_probe");
    await client.query(`
      create table chassis_probe (
        id uuid primary key default gen_random_uuid(),
        label text not null,
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        created_by text, updated_by text
      )`);
    await client.query(`create trigger probe_audit after insert or update or delete on chassis_probe
                        for each row execute function write_audit()`);
    await client.query(`create trigger probe_bump before update on chassis_probe
                        for each row execute function bump_version()`);
    await client.query(`create trigger probe_touch before update on chassis_probe
                        for each row execute function set_updated_at()`);
  });

  afterAll(async () => {
    await client.query("drop table if exists chassis_probe");
    await client.end();
  });

  it("has every foundation table", async () => {
    const { rows } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const present = new Set(rows.map((r) => r.table_name));
    for (const t of FOUNDATION_TABLES) expect(present, `missing table: ${t}`).toContain(t);
  });

  it("records the actor from created_by when app.user is unset", async () => {
    // The Neon HTTP driver issues one query per call, so SET LOCAL app.user
    // never survives to the mutation. Without this fallback changed_by is null
    // on every row the app ever writes.
    const { rows } = await client.query(
      "insert into chassis_probe (label, created_by) values ('a', 'someone@benwhistler.com') returning id",
    );
    const { rows: audit } = await client.query(
      "select action, changed_by from audit_log where table_name = 'chassis_probe' and row_id = $1",
      [rows[0].id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("insert");
    expect(audit[0].changed_by).toBe("someone@benwhistler.com");
  });

  it("bumps version and updated_at on update, and audits the change", async () => {
    const { rows } = await client.query(
      "insert into chassis_probe (label, created_by) values ('b', 'a@b.com') returning id, version",
    );
    expect(rows[0].version).toBe(1);
    const { rows: updated } = await client.query(
      "update chassis_probe set label = 'b2', updated_by = 'c@d.com' where id = $1 returning version",
      [rows[0].id],
    );
    expect(updated[0].version).toBe(2);

    const { rows: audit } = await client.query(
      "select action, changed_by from audit_log where table_name = 'chassis_probe' and row_id = $1 and action = 'update'",
      [rows[0].id],
    );
    expect(audit[0].changed_by).toBe("c@d.com");
  });

  it("refuses a version-mismatched update (the optimistic lock)", async () => {
    const { rows } = await client.query(
      "insert into chassis_probe (label, created_by) values ('c', 'a@b.com') returning id",
    );
    // The client believes it holds version 99; it does not.
    const stale = await client.query(
      "update chassis_probe set label = 'nope' where id = $1 and version = 99",
      [rows[0].id],
    );
    expect(stale.rowCount).toBe(0); // zero rows -> the route returns 409, never a silent overwrite
  });

  it("refuses to update or delete an audit_log row", async () => {
    await expect(client.query("update audit_log set changed_by = 'x' where id = (select min(id) from audit_log)"))
      .rejects.toThrow(/append-only/);
    await expect(client.query("delete from audit_log where id = (select min(id) from audit_log)"))
      .rejects.toThrow(/append-only/);
  });

  it("refuses to update a note", async () => {
    const { rows } = await client.query(
      "insert into notes (entity_type, entity_id, body, created_by) values ('probe', gen_random_uuid(), 'why', 'a@b.com') returning id",
    );
    await expect(client.query("update notes set body = 'rewritten' where id = $1", [rows[0].id]))
      .rejects.toThrow(/append-only/);
  });
});
