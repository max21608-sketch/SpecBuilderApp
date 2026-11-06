// Database tier: a session is answered by the user's ROW (audit A4, 0053).
//
// The pure tier (`tests/lib/session-boundary.test.ts`) drives the same code
// with the row stubbed. This file uses a real `users` row, so what it proves
// is that the column exists, that the query reads it, and that the sign-out
// statement moves it -- against the schema rather than a mock of it.
//
// The user's email carries this process's `qaNumber` suffix, so two runs of
// the tier never collide on `users_email_key`. The row is deleted afterwards.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("a session is answered by the user's row", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  // `qaNumber` has spaces; an email may not. Same suffix, so it is still this
  // process's alone.
  const email = `${qaNumber("session").replace(/\s+/g, "-").toLowerCase()}@example.test`;
  let userId = "";

  beforeAll(async () => {
    await client.connect();
    const row = await client.query(
      `insert into users (email, name, role, password_hash) values ($1, '__QA Session', 'editor', 'scrypt$00$00') returning id`,
      [email],
    );
    userId = row.rows[0].id;
  });

  afterAll(async () => {
    if (userId) await client.query(`delete from users where id = $1`, [userId]);
    await client.end();
  });

  async function signIn(): Promise<void> {
    const version = await client.query(`select token_version from users where id = $1`, [userId]);
    const { makeSessionToken } = await import("@/lib/auth");
    jar.set(
      "sb_session",
      await makeSessionToken({ id: userId, email, name: "__QA Session", role: "editor", tokenVersion: version.rows[0].token_version }),
    );
  }

  /** A write route whose body check runs AFTER `requireWriter`: an empty body is a 400 if the role passed. */
  async function tryToWrite(): Promise<number> {
    const { POST } = await import("@/app/api/projects/route");
    const response = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    return response.status;
  }

  it("refuses the next write after a demotion, without signing in again", async () => {
    await client.query(`update users set role = 'editor', active = true where id = $1`, [userId]);
    await signIn();
    // Past the role check: the empty body is what is refused.
    expect(await tryToWrite()).toBe(400);

    await client.query(`update users set role = 'viewer' where id = $1`, [userId]);
    // The same cookie. Before 0053 this was still an editor for a week.
    expect(await tryToWrite()).toBe(403);
  });

  it("refuses a deactivated user at once", async () => {
    await client.query(`update users set role = 'editor', active = true where id = $1`, [userId]);
    await signIn();
    await client.query(`update users set active = false where id = $1`, [userId]);
    expect(await tryToWrite()).toBe(401);
  });

  it("signing out ends a copy of the same cookie", async () => {
    await client.query(`update users set role = 'editor', active = true where id = $1`, [userId]);
    await signIn();
    const copied = jar.get("sb_session")!;
    const before = await client.query(`select token_version from users where id = $1`, [userId]);

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST();
    expect(response.status).toBe(200);
    const after = await client.query(`select token_version from users where id = $1`, [userId]);
    expect(after.rows[0].token_version).toBe(before.rows[0].token_version + 1);

    // Another browser still holding the cookie is no longer signed in.
    jar.set("sb_session", copied);
    const { getSessionUser } = await import("@/lib/session");
    expect(await getSessionUser()).toBeNull();
  });
});
