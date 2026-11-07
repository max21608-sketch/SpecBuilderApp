// Database tier — a drawing of a code on two TWINNED lines of one phase lands
// on both (0060, `readTwinLines`); the same two lines unlinked are still the
// SX11A question.
//
// Two shapes, because the Aman pack has both:
//   * the page prints FUR-13 and the bill lists GR-FUR-13 and PL-FUR-13 (a
//     code END, `code: null`, one choice per phase until now);
//   * the bill lists one code twice in a phase (PL-FUR-11, one stool in two
//     suites).
// Each is confirmed through the real review GET and confirm route, so what
// the card shows is what the confirm writes. Synthetic; no model call.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import type { SpecFieldEntry, StagedDrawings } from "@/lib/drawing-document";
import { stageDrawingsV4 } from "@/lib/drawing-items";
import { DrawingsItemsOutput } from "@/lib/extraction-schema";
import { POST as confirmPost } from "@/app/api/imports/[id]/confirm/route";
import { GET as reviewRoute } from "@/app/api/imports/[id]/route";
import { withTransaction } from "@/lib/db-transaction";
import { linkTwins } from "@/lib/record-twins";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

const noOverall = { width: null, depth: null, height: null, seatHeight: null, diameter: null };
const drawing = (code: string) => ({
  documentNotes: null,
  nonItemPages: [],
  items: [
    {
      codes: [code],
      name: "Stool",
      pages: [1],
      whyOneItem: null,
      overall: {
        ...noOverall,
        width: { valueRaw: "450", unitRaw: "mm", view: "PLAN", page: 1, evidence: "plan, whole item", candidates: [] },
      },
      combinedLine: null,
      configurations: [],
      finishes: [],
      statements: [],
      mockup: { is: false, evidence: null },
      otherDimensions: [],
      notes: [],
      pictures: [],
      uncertain: [],
      confidence: "high",
    },
  ],
});

type Review = {
  resolution?: {
    id: string;
    targets: string[];
    blockers: { code: string }[];
    resolution: { twins?: { message: string }; runs: { status: string; twins?: boolean }[] };
  }[];
};

describeIfDb("a drawing over twin lines", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Drawing twins', 'qa', 'qa') returning id`,
        [qaNumber("P00063")],
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by) values ($1, '__QA Main', 0, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    fields = (await client.query(`select id, json_id, name from spec_fields order by sort_order`)).rows.map(
      (row: { id: string; json_id: number; name: string }) => ({ id: row.id, jsonId: Number(row.json_id), name: row.name }),
    );
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function line(code: string): Promise<string> {
    const id = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, qty, created_by, updated_by)
         values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                 'active', '__QA Stool', 2, 'qa', 'qa') returning id`,
        [projectId, runId],
      )
    ).rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [id, projectId, code],
    );
    return id;
  }

  async function stage(code: string): Promise<string> {
    const doc = stageDrawingsV4(DrawingsItemsOutput.parse(drawing(code)), fields, `__QA ${code}.pdf`, null);
    return String(
      (
        await client.query(
          `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
           values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
          [projectId, JSON.stringify(doc)],
        )
      ).rows[0].id,
    );
  }

  async function review(intakeRunId: string) {
    const response = await reviewRoute(new Request("http://localhost/test"), { params: Promise.resolve({ id: intakeRunId }) });
    return ((await response.json()) as Review).resolution![0]!;
  }

  async function confirm(intakeRunId: string, shownTargets: string[]) {
    const doc = (await client.query(`select parsed from intake_runs where id = $1`, [intakeRunId])).rows[0].parsed as StagedDrawings;
    const staged = doc.items[0]!;
    const response = await confirmPost(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          itemId: staged.id,
          itemVersion: staged.version,
          shownTargets,
          observations: staged.observations.filter((o) => o.reviewStatus === "pending").map((o) => ({ id: o.id, version: o.version })),
        }),
      }),
      { params: Promise.resolve({ id: intakeRunId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  async function widths(recordIds: string[]) {
    return (
      await client.query(
        `select record_id, value from record_attributes where record_id = any($1::uuid[]) and dimension_slot = 'W' and status = 'active' order by record_id`,
        [recordIds],
      )
    ).rows;
  }

  it("a code END on two lines is one choice until they are twins, then the drawing goes on both", async () => {
    const guest = await line("GR-FUR-13");
    const ambassador = await line("PL-FUR-13");
    const intakeRunId = await stage("FUR-13");

    const before = await review(intakeRunId);
    expect(before.targets).toEqual([]);
    expect(before.blockers.map((blocker) => blocker.code)).toContain("ambiguous_run");

    await withTransaction((txn) => linkTwins(txn, { recordId: guest, otherId: ambassador, reason: "__QA One stool", actor: "qa" }));
    const after = await review(intakeRunId);
    expect([...after.targets].sort()).toEqual([guest, ambassador].sort());
    expect(after.blockers.map((blocker) => blocker.code)).not.toContain("ambiguous_run");
    expect(after.resolution.twins?.message).toContain("are twins");

    const confirmed = await confirm(intakeRunId, after.targets);
    expect(confirmed.response.ok, JSON.stringify(confirmed.body)).toBe(true);
    // One row per record, each its own.
    expect(await widths([guest, ambassador])).toEqual(
      [guest, ambassador].sort().map((record_id) => ({ record_id, value: "450" })),
    );
  });

  it("one code twice in a phase stays SX11A unlinked, and is both lines once twinned", async () => {
    const bathroom = await line("PL-FUR-11");
    const wardrobe = await line("PL-FUR-11");
    const intakeRunId = await stage("PL-FUR-11");

    const before = await review(intakeRunId);
    expect(before.targets).toEqual([]);
    expect(before.resolution.runs[0]).toMatchObject({ status: "ambiguous" });
    expect(before.resolution.runs[0]?.twins).toBeUndefined();

    await withTransaction((txn) => linkTwins(txn, { recordId: bathroom, otherId: wardrobe, reason: "__QA One stool", actor: "qa" }));
    const after = await review(intakeRunId);
    expect(after.resolution.runs[0]).toMatchObject({ status: "ambiguous", twins: true });
    expect([...after.targets].sort()).toEqual([bathroom, wardrobe].sort());

    const confirmed = await confirm(intakeRunId, after.targets);
    expect(confirmed.response.ok, JSON.stringify(confirmed.body)).toBe(true);
    expect((await widths([bathroom, wardrobe])).map((row) => row.value)).toEqual(["450", "450"]);
  });

  it("a third line that is not a twin keeps the question", async () => {
    const one = await line("QA-FUR-77");
    const two = await line("QA-FUR-77");
    await line("QA-FUR-77");
    await withTransaction((txn) => linkTwins(txn, { recordId: one, otherId: two, reason: "__QA Two of three", actor: "qa" }));
    const intakeRunId = await stage("QA-FUR-77");
    const shown = await review(intakeRunId);
    expect(shown.targets).toEqual([]);
    expect(shown.blockers.map((blocker) => blocker.code)).toContain("ambiguous_run");
  });
});
