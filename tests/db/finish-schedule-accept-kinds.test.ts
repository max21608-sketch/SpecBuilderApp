// Database tier — a finishes schedule's suggested kinds accepted in ONE press,
// and carried into the library rows "Add N to the library" writes
// (prod-ready F3, 2026-11-20). Through the app's own routes.
//
// THE DEFECT. Every schedule row offered "Fabric ?", "Add 11 to the library"
// filed no kind, and the library then said "14 of 14 finishes have no kind"
// and asked again. The confirm writes only an ACCEPTED kind (a person's click),
// which is right; what was missing was accepting them all at once.
//
// No document is read and nothing is charged. Rows are prefixed `__QA `.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { RawFinishEntry } from "@/lib/extraction-schema";
import { stageFinishSchedule } from "@/lib/finish-schedule";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { GET as importGet, PATCH as importPatch } from "@/app/api/imports/[id]/route";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const entry = (over: Partial<RawFinishEntry>) => RawFinishEntry.parse({ otherRaw: [], ...over });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) =>
  new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describeIfDb("a schedule's suggested kinds, accepted in one press (F3)", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90413")}', '__QA Schedule kinds', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    let n = 0;
    const staged = stageFinishSchedule(
      [
        entry({ codeRaw: "QK TIM 01", kindRaw: "TIMBER", nameRaw: "NATURAL OAK", page: 1 }),
        entry({ codeRaw: "QK FAB 01", kindRaw: "FABRIC", nameRaw: "WOOL BOUCLE", page: 1 }),
        entry({ codeRaw: "QK STN 01", kindRaw: "STONE", nameRaw: "WHITE MARBLE", page: 2 }),
      ],
      "__QA schedule.pdf",
      null,
      () => `qk-entry-${(n += 1)}`,
    );
    runId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
         values ($1, 'spec_document', 'finishes_schedule', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
        [projectId, JSON.stringify(staged)],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("files the accepted kinds in one request, all or none, and the confirm carries each into its library row", async () => {
    const got = await (await importGet(request("GET"), params(runId))).json();
    expect(got.review.map((row: { suggestion: { kind: string } | null }) => row.suggestion?.kind)).toEqual([
      "timber",
      "fabric",
      "stone",
    ]);

    // A stale version anywhere refuses the whole press and files nothing.
    const stale = await importPatch(
      request("PATCH", {
        kinds: [
          { entryId: "qk-entry-1", expectedVersion: 1, kind: "timber" },
          { entryId: "qk-entry-2", expectedVersion: 9, kind: "fabric" },
        ],
      }),
      params(runId),
    );
    expect(stale.status).toBe(409);
    const untouched = (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed;
    expect(untouched.entries.map((row: { kind: string | null }) => row.kind ?? null)).toEqual([null, null, null]);

    // The press: two of the three suggestions accepted. The third is left as a suggestion.
    const accepted = await importPatch(
      request("PATCH", {
        kinds: [
          { entryId: "qk-entry-1", expectedVersion: 1, kind: "timber" },
          { entryId: "qk-entry-2", expectedVersion: 1, kind: "fabric" },
        ],
      }),
      params(runId),
    );
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).filed).toBe(2);

    const staged = (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed;
    const confirmed = await confirmRoute(
      request("POST", {
        action: "confirm",
        entries: staged.entries.map((row: { id: string; version: number }) => ({ id: row.id, version: row.version })),
      }),
      params(runId),
    );
    expect(confirmed.status).toBe(200);

    const library = await client.query(
      `select code, kind from project_finishes where project_id = $1 and status = 'active' order by code`,
      [projectId],
    );
    // Accepted kinds are filed; the one nobody accepted is not.
    expect(library.rows).toEqual([
      { code: "QK-FAB-01", kind: "fabric" },
      { code: "QK-STN-01", kind: null },
      { code: "QK-TIM-01", kind: "timber" },
    ]);
  });

  it("refuses a word that is not a kind", async () => {
    const res = await importPatch(request("PATCH", { kinds: [{ entryId: "qk-entry-1", expectedVersion: 1, kind: "wood" }] }), params(runId));
    expect(res.status).toBe(400);
  });
});
