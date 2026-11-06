// Database tier — a finish code that is already live, met by a RESTORE or a
// RENAME, is refused in words naming the live row (audit E8, 2026-11-06).
//
// Skips without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/finish-code-clash.test.ts
//
// `project_finishes_code_key` is unique on (project, code) among ACTIVE rows
// (0018). Two writes met it with nothing in front: putting back a retired
// finish whose code a newer row now holds, and renaming a finish to a code
// another row holds. Both reached the library screen as a 500 reading
// "Nothing was written". `createFinish` has always refused the same clash in
// words; these two now do too, and say which row is in the way.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { normaliseFinishCode } from "@/lib/finishes";
import { DomainConflictError, withTransaction } from "@/lib/db-transaction";
import { editFinish } from "@/lib/finish-edit";
import { PATCH as finishPatch } from "@/app/api/projects/[id]/finishes/[finishId]/route";
import { deleteProjectRows } from "../../db/project-delete.mjs";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("a finish code that is already live", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  const addFinish = async (code: string, description: string, status: "active" | "retired" = "active") =>
    (
      await client.query(
        `insert into project_finishes (project_id, code, code_norm, description, state, status, retired_at, retired_by, created_by, updated_by)
         values ($1, $2, $3, $4, 'tbc', $5,
                 case when $5 = 'retired' then now() end, case when $5 = 'retired' then 'qa' end, 'qa', 'qa')
         returning id, version`,
        [projectId, code, normaliseFinishCode(code), description, status],
      )
    ).rows[0] as { id: string; version: number };

  beforeAll(async () => {
    await client.connect();
    projectId = String(
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber("P90418")}', '__QA Finish code clash', 'qa', 'qa') returning id`,
        )
      ).rows[0].id,
    );
  });

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    await client.end();
  });

  it("putting back a retired finish whose code is live again is refused, naming the live row", async () => {
    const old = await addFinish("QA-CL-01", "__QA Old brass", "retired");
    await addFinish("QA-CL-01", "__QA New brass");
    const res = await finishPatch(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: Number(old.version), status: "active", reason: "__QA back" }),
      }),
      { params: Promise.resolve({ id: projectId, finishId: old.id }) },
    );
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.code).toBe("code_exists");
    expect(body.error).toContain("QA-CL-01");
    expect(body.error).toContain("__QA New brass");
    const status = await client.query(`select status from project_finishes where id = $1`, [old.id]);
    expect(status.rows[0].status).toBe("retired");
  });

  it("renaming a finish to a code another row holds is refused, naming that row", async () => {
    const mine = await addFinish("QA-CL-02", "__QA Walnut");
    await addFinish("QA-CL-03", "__QA Smoked oak");
    const refused = await withTransaction((txn) =>
      editFinish(txn, {
        projectId,
        finishId: mine.id,
        expectedVersion: Number(mine.version),
        fields: { code: "qa-cl-03", description: "__QA Walnut" },
        reason: "__QA renumbered",
        actor: "qa",
      }),
    ).catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(DomainConflictError);
    expect((refused as DomainConflictError).code).toBe("code_exists");
    expect((refused as DomainConflictError).message).toContain("__QA Smoked oak");
  });

  it("renaming a finish to its own code in other capitals is not a clash", async () => {
    const mine = await addFinish("QA-CL-04", "__QA Ash");
    await withTransaction((txn) =>
      editFinish(txn, {
        projectId,
        finishId: mine.id,
        expectedVersion: Number(mine.version),
        fields: { code: "qa-cl-04", description: "__QA Ash" },
        reason: "__QA spelling",
        actor: "qa",
      }),
    );
    const row = await client.query(`select code from project_finishes where id = $1`, [mine.id]);
    expect(row.rows[0].code).toBe("qa-cl-04");
  });
});
