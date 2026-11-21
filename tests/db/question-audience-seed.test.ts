// Database tier — seed 0015 (who each question is for, how a client reads it,
// which are answered once per area) and 0003's three section moves (decision
// C: answered once per PROJECT). Reads the seeded rows; re-runs 0015 in a
// transaction it rolls back, to prove a re-seed writes nothing and a listed
// key that matches no row fails the seed by name.
import { readFileSync } from "node:fs";
import path from "node:path";
import { it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { describeIfDb } from "./db-tier";

const databaseUrl = process.env.DATABASE_URL;
const SEED = readFileSync(path.join(process.cwd(), "db/seed/0015_question_audience.sql"), "utf8");

describeIfDb("seed 0015 and the project-wide moves", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  beforeAll(() => client.connect());
  afterAll(() => client.end());

  /** Every distinct value one seed key carries across the categories that ask it. */
  async function values(column: string, seedKey: string): Promise<(string | null)[]> {
    const { rows } = await client.query(
      `select distinct ${column} as v from requirements where created_by = 'seed' and seed_key = $1 order by 1`,
      [seedKey],
    );
    expect(rows.length, seedKey).toBeGreaterThan(0);
    return rows.map((row) => row.v);
  }

  it("gives D's project-wide questions to the CAM, to us, or to the client", async () => {
    const expected: Record<string, string> = {
      "q:toe-agreement": "cam",
      "q:client-contact-list": "cam",
      "q:com-payment-plan": "cam",
      "q:expedited-project-confirmed-by-jason": "in_house",
      "q:bws-project-page-folder-set-up": "in_house",
      "field:7": "in_house",
      "field:191": "in_house",
      "field:24": "in_house",
      "q:floor-plans": "client",
      "q:fsc-required": "client",
      "field:6": "client",
    };
    for (const [key, audience] of Object.entries(expected)) expect(await values("audience", key), key).toEqual([audience]);
  });

  it("makes E's questions worded for BW in-house, and leaves metal finish the client's with a client wording", async () => {
    for (const key of ["q:needs-split-where", "q:fabric-quantities", "q:image-drawing-repeat-reference"]) {
      expect(await values("audience", key), key).toEqual(["in_house"]);
    }
    expect(await values("audience", "field:5")).toEqual(["client"]);
    expect(await values("client_prompt", "field:5")).toEqual(["Metal finish 1, and where on the item"]);
  });

  it("makes every other seeded question the client's — a readiness question nobody listed included", async () => {
    expect(await values("audience", "q:fabric-with-pattern-direction")).toEqual(["client"]);
    const { rows } = await client.query(
      `select audience, count(*)::int as n from requirements where created_by = 'seed' group by 1 order by 1`,
    );
    const counts = Object.fromEntries(rows.map((row) => [row.audience, row.n]));
    expect(counts.client).toBeGreaterThan(counts.in_house);
    expect(counts.cam).toBe(5 * 17);
  });

  it("words COM 1/2/3 as Fabric 1/2/3 and Main timber finish as Timber finish 1, and nothing else", async () => {
    expect(await values("client_prompt", "field:1")).toEqual(["Fabric 1"]);
    expect(await values("client_prompt", "field:2")).toEqual(["Fabric 2"]);
    expect(await values("client_prompt", "field:14")).toEqual(["Fabric 3"]);
    expect(await values("client_prompt", "field:4")).toEqual(["Timber finish 1"]);
    const { rows } = await client.query(
      `select count(distinct seed_key)::int as n from requirements where created_by = 'seed' and client_prompt is not null`,
    );
    expect(rows[0].n).toBe(5);
  });

  it("asks four questions once per area, and no other", async () => {
    for (const key of ["field:130", "field:39", "field:73", "q:is-fully-outdoor-or-partially-protected"]) {
      expect(await values("answer_scope", key), key).toEqual(["area"]);
    }
    const { rows } = await client.query(
      `select count(distinct seed_key)::int as n from requirements where created_by = 'seed' and answer_scope = 'area'`,
    );
    expect(rows[0].n).toBe(4);
  });

  it("moves the fire standard, visible fixings and the exact-copy question into the project-wide section (0003)", async () => {
    for (const key of [
      "field:74",
      "q:visible-fixinings-standard-ral-9005-powder-coated",
      "q:the-client-is-expecting-exact-copy-from-their-drawing-or-there-is-possibility-of-sugestion-bw-standards-sabos-metal-bars-curved-back-leg-thickness-etc",
    ]) {
      expect(await values("section", key), key).toEqual(["Project / commercial"]);
    }
  });

  it("writes nothing when run again", async () => {
    await client.query("begin");
    try {
      const before = await client.query(`select count(*)::int as n from audit_log where table_name = 'requirements'`);
      await client.query(SEED);
      const after = await client.query(`select count(*)::int as n from audit_log where table_name = 'requirements'`);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    } finally {
      await client.query("rollback");
    }
  });

  it("fails by name on a listed key that matches no seeded question", async () => {
    await client.query("begin");
    try {
      await expect(client.query(SEED.replace("'q:floor-plans'", "'q:floor-plnas'"))).rejects.toThrow(/q:floor-plnas/);
    } finally {
      await client.query("rollback");
    }
  });
});
