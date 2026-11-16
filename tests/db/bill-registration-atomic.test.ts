// Database tier — registering a bill writes its attachment and its run as ONE
// write (review 2026-11-16, item 1.6).
//
// The attachment row and the `intake_runs` row were separate statements, so a
// failure between them left an attachment no run named: a stored bill that no
// screen can reach. Here the run's insert is made to fail by a trigger scoped
// to this file's own project, and the attachment must not survive it.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/bill-registration-atomic.test.ts
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber, QA_RUN_SUFFIX } from "./db-tier";
import { twoRowHeaderWorkbook } from "../fixtures/build-boq";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

/** The blob store, in memory: what was put, by pathname. */
const files = new Map<string, { bytes: Buffer; contentType: string }>();
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer, options: { contentType?: string }) => {
    files.set(pathname, { bytes: Buffer.from(body), contentType: options?.contentType ?? "application/octet-stream" });
    return { pathname, url: `https://blob.test/${pathname}` };
  },
  head: async (pathname: string) => {
    const file = files.get(pathname);
    return file ? { pathname, size: file.bytes.length, contentType: file.contentType } : null;
  },
  get: async (pathname: string) => {
    const file = files.get(pathname);
    if (!file) return null;
    return {
      statusCode: 200,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(file.bytes));
          controller.close();
        },
      }),
      headers: new Headers({ "content-length": String(file.bytes.length) }),
      blob: { contentType: file.contentType, size: file.bytes.length },
    };
  },
  copy: async () => {
    throw new Error("not used");
  },
}));

const databaseUrl = process.env.DATABASE_URL;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Per process, so two concurrent runs never drop each other's trigger.
const FAIL_FN = `__qa_fail_intake_run_${QA_RUN_SUFFIX}`;

describeIfDb("registering a bill", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  const upload = async (filename: string) => {
    const pathname = `projects/${projectId}/${filename}`;
    files.set(pathname, { bytes: await twoRowHeaderWorkbook(), contentType: XLSX });
    const { POST } = await import("@/app/api/imports/route");
    return POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, importType: "boq", pathname, filename, contentType: "" }),
      }),
    );
  };

  const count = async (table: "attachments" | "intake_runs") => {
    const where = table === "attachments" ? "entity_type = 'project' and entity_id = $1" : "project_id = $1";
    return (await client.query(`select count(*)::int n from ${table} where ${where}`, [projectId])).rows[0].n as number;
  };

  const dropTrigger = async () => {
    await client.query(`drop trigger if exists ${FAIL_FN} on intake_runs`);
    await client.query(`drop function if exists ${FAIL_FN}()`);
  };

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA atomic bill registration', 'qa', 'qa') returning id`,
        [qaNumber("P90516")],
      )
    ).rows[0].id as string;
  });

  afterAll(async () => {
    await dropTrigger();
    if (projectId) {
      await client.query(
        `delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`,
        [projectId],
      );
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  it("leaves no attachment behind when the run cannot be recorded", async () => {
    // The project id is a uuid this test made, so it is safe to inline: the
    // trigger refuses this project's runs and nobody else's.
    await client.query(`
      create function ${FAIL_FN}() returns trigger language plpgsql as $$
      begin
        if new.project_id = '${projectId}'::uuid then
          raise exception 'QA: the run insert is refused for this test';
        end if;
        return new;
      end $$
    `);
    await client.query(
      `create trigger ${FAIL_FN} before insert on intake_runs for each row execute function ${FAIL_FN}()`,
    );
    try {
      const response = await upload("__QA refused.xlsx");
      expect(response.status).toBeGreaterThanOrEqual(500);
      const body = (await response.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(await count("intake_runs")).toBe(0);
      expect(await count("attachments")).toBe(0);
    } finally {
      await dropTrigger();
    }
  });

  it("records the attachment and the run that names it when nothing fails", async () => {
    const response = await upload("__QA accepted.xlsx");
    const body = (await response.json()) as { ok: boolean; importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    const run = await client.query(
      `select r.status, a.filename from intake_runs r join attachments a on a.id = r.attachment_id where r.id = $1`,
      [body.importId],
    );
    expect(run.rows[0]).toEqual({ status: "parsed", filename: "__QA accepted.xlsx" });
    expect(await count("attachments")).toBe(1);
  });
});
