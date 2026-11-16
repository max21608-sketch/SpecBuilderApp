// Database tier — GET /api/email-messages/count, the one number the top bar
// carries.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/email-messages-count-route.test.ts
//
// What it holds (review 5.1; the route's header): it counts an email that is
// held AND open, and nothing else — not an assigned one, not one somebody ruled
// on — and it is the inbox route's `heldCount`, word for word, because a bubble
// counting something slightly different from the list it opens is worse than
// none.
//
// The count is global and other runs write email at the same time, so every
// reading is taken until two in a row agree; the assertions are on deltas.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber, QA_RUN_SUFFIX } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "00000000-0000-0000-0000-000000000000", email: "__qa@example.test", name: "QA User", role: "admin" }),
}));

const databaseUrl = process.env.DATABASE_URL;
const MAILBOX = `__qa_count_${QA_RUN_SUFFIX}@example.test`;

describeIfDb("the unplaced-email count", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90202")}', '__QA email count', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from email_messages where mailbox = $1`, [MAILBOX]);
    if (projectId) await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function count(): Promise<number> {
    const { GET } = await import("@/app/api/email-messages/count/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    return Number(body.unplaced);
  }

  /** A reading two consecutive calls agree on. */
  async function steady(read: () => Promise<number>): Promise<number> {
    let last = await read();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const next = await read();
      if (next === last) return next;
      last = next;
    }
    return last;
  }

  async function message(fields: { routing: string; project?: string | null; triage?: string }): Promise<void> {
    const assigned = fields.routing === "assigned";
    const triaged = (fields.triage ?? "open") !== "open";
    await client.query(
      `insert into email_messages (mailbox, origin, routing_status, project_id, assigned_by, assigned_at, assignment_kind,
                                   triage, triaged_by, triaged_at, subject, created_by, updated_by)
       values ($1, 'upload', $2, $3, $4, $5, $6, $7, $8, $9, '__QA count', 'qa', 'qa')`,
      [
        MAILBOX,
        fields.routing,
        fields.project ?? null,
        assigned ? "qa" : null,
        assigned ? new Date() : null,
        assigned ? "manual" : null,
        fields.triage ?? "open",
        triaged ? "qa" : null,
        triaged ? new Date() : null,
      ],
    );
  }

  it("counts a held, open email, and not an assigned one or one somebody ruled on", async () => {
    const before = await steady(count);
    await message({ routing: "unassigned" });
    await message({ routing: "ambiguous" });
    await message({ routing: "assigned", project: projectId });
    await message({ routing: "unassigned", triage: "nothing_to_record" });
    await message({ routing: "ambiguous", triage: "not_specification" });
    const after = await steady(count);
    expect(after - before).toBe(2);
  });

  it("is the inbox route's heldCount, so the bubble and the list it opens agree", async () => {
    const { GET } = await import("@/app/api/email-messages/route");
    const inbox = async () => {
      const res = await GET(new Request("http://localhost/api/email-messages"));
      expect(res.status).toBe(200);
      return Number((await res.json()).heldCount);
    };
    // Read both until neither moves between them.
    let agreed = false;
    for (let attempt = 0; attempt < 10 && !agreed; attempt += 1) {
      const a = await count();
      const held = await inbox();
      const b = await count();
      if (a === b) {
        expect(held).toBe(a);
        agreed = true;
      }
    }
    expect(agreed).toBe(true);
  });
});
