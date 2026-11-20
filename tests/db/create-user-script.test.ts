// `tools/create-user.mjs`, run as a person runs it, against a real `users`
// table (production hardening H5, 2026-11-20).
//
// The script is spawned with this process's environment, which on the local
// stack and in CI declares a sandbox database on this machine — the only
// database `requireScriptEnvironment` lets it write to without a flag. Every
// email carries this process's `qaNumber` suffix, so two runs of the tier never
// collide on `users_email_key`; the rows are deleted afterwards.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";

const SCRIPT = join(process.cwd(), "tools/create-user.mjs");
const GOOD_PASSWORD = "__qa correct horse battery";

function emailFor(base: string): string {
  return `${qaNumber(base).replace(/\s+/g, "-").toLowerCase()}@example.test`;
}

function createUser(args: string[], password: string | null = null): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NEW_USER_PASSWORD;
  if (password !== null) env.NEW_USER_PASSWORD = password;
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8", timeout: 30_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describeIfDb("tools/create-user.mjs", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const emails = ["env", "argv", "short", "nopass", "deact", "unknown"].map(emailFor);
  const [envEmail, argvEmail, shortEmail, noPassEmail, deactEmail, unknownEmail] = emails as [
    string, string, string, string, string, string,
  ];

  async function row(email: string) {
    const { rows } = await client.query(
      `select active, token_version, password_hash, name, role from users where email = $1`,
      [email],
    );
    return rows[0] as
      | { active: boolean; token_version: number; password_hash: string; name: string; role: string }
      | undefined;
  }

  async function passwordMatches(email: string, password: string): Promise<boolean> {
    const { verifyCredentials } = await import("@/lib/auth-node");
    return (await verifyCredentials(email, password)) !== null;
  }

  beforeAll(async () => {
    await client.connect();
    await client.query(`delete from users where email = any($1)`, [emails]);
  });

  afterAll(async () => {
    await client.query(`delete from users where email = any($1)`, [emails]);
    await client.end();
  });

  it("reads the password from NEW_USER_PASSWORD, prints the target host, and warns about nothing", async () => {
    const run = createUser([envEmail, "__QA Env", "editor"], GOOD_PASSWORD);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/Target: DATABASE_ENVIRONMENT=sandbox/);
    expect(run.stderr).not.toMatch(/shell history/);
    expect((await row(envEmail))?.active).toBe(true);
    expect(await passwordMatches(envEmail, GOOD_PASSWORD)).toBe(true);
  });

  it("still takes the password as an argument, and warns that it lands in the shell history", async () => {
    const run = createUser([argvEmail, "__QA Argv", "viewer", GOOD_PASSWORD]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toMatch(/shell history/);
    expect(await passwordMatches(argvEmail, GOOD_PASSWORD)).toBe(true);
  });

  it("refuses a password under 12 characters, from either place, and writes nothing", async () => {
    for (const run of [
      createUser([shortEmail, "__QA Short", "editor", "elevenchars"]),
      createUser([shortEmail, "__QA Short", "editor"], "elevenchars"),
    ]) {
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/shorter than 12 characters/);
    }
    expect(await row(shortEmail)).toBeUndefined();
    // Exactly twelve is enough.
    expect(createUser([shortEmail, "__QA Short", "editor"], "twelve chars").status).toBe(0);
  });

  it("refuses to run with no password at all, and says where to put one", async () => {
    const run = createUser([noPassEmail, "__QA None", "editor"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/NEW_USER_PASSWORD/);
    expect(await row(noPassEmail)).toBeUndefined();
  });

  it("never reads a --yes flag as the password", async () => {
    const run = createUser([noPassEmail, "__QA None", "editor", "--yes-pilot"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/NEW_USER_PASSWORD/);
    expect(await row(noPassEmail)).toBeUndefined();
  });

  it("--deactivate switches the account off and ends every session it holds", async () => {
    expect(createUser([deactEmail, "__QA Deact", "editor"], GOOD_PASSWORD).status).toBe(0);
    const before = await row(deactEmail);
    const run = createUser(["--deactivate", deactEmail]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/Target: DATABASE_ENVIRONMENT=sandbox/);
    const after = await row(deactEmail);
    expect(after?.active).toBe(false);
    expect(after?.token_version).toBe(before!.token_version + 1);
    // An inactive account cannot sign in, whatever its password.
    expect(await passwordMatches(deactEmail, GOOD_PASSWORD)).toBe(false);
  });

  it("refuses to reactivate a deactivated account by a re-run, and changes nothing", async () => {
    const before = await row(deactEmail);
    expect(before?.active).toBe(false);
    const run = createUser([deactEmail, "__QA Renamed", "admin"], "__qa a different password");
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/is deactivated/);
    expect(run.stderr).toMatch(/--activate/);
    expect(await row(deactEmail)).toEqual(before);
  });

  it("reactivates only with --activate", async () => {
    const before = await row(deactEmail);
    const run = createUser([deactEmail, "__QA Deact", "editor", "--activate"], GOOD_PASSWORD);
    expect(run.status, run.stderr).toBe(0);
    const after = await row(deactEmail);
    expect(after?.active).toBe(true);
    expect(after?.token_version).toBe(before!.token_version + 1);
    expect(await passwordMatches(deactEmail, GOOD_PASSWORD)).toBe(true);
  });

  it("--deactivate on an email nobody has is refused in words", async () => {
    const run = createUser(["--deactivate", unknownEmail]);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/No account has the email/);
  });

  it("a re-run for an ACTIVE account still resets the password and ends its sessions, as before", async () => {
    const before = await row(envEmail);
    const run = createUser([envEmail, "__QA Env", "editor"], "__qa a newer password");
    expect(run.status, run.stderr).toBe(0);
    const after = await row(envEmail);
    expect(after?.active).toBe(true);
    expect(after?.token_version).toBe(before!.token_version + 1);
    expect(await passwordMatches(envEmail, "__qa a newer password")).toBe(true);
  });
});
