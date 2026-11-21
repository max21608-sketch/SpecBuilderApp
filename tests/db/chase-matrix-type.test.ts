// Database tier — a TYPED record is chased, and filled in, on its type's rows
// (decision B, carried into the chase and the fill-in by Stage 2 of Track 2).
//
// Until this, `loadOutstanding` tiered every record by the UNION of its
// sheet's types, so a sofa a person had typed S lost Swivel from its gate
// panel, its TGQ and the overview — and was still chased for it, and still
// listed it as TGQ on the fill-in screen. `tgqMatrixFor` is the one lookup.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("a typed record, chased on its type's rows", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let typed = "";
  let untyped = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(`insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA typed chase', 'qa', 'qa') returning id`, [
        qaNumber("P90065"),
      ])
    ).rows[0].id;
    const runId = (
      await client.query(`insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA run', 'qa', 'qa') returning id`, [projectId])
    ).rows[0].id;
    // By slug: the one seeded sheet carrying his S, A and B.
    const categoryId = (await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)).rows[0].id;
    const add = async (no: number, type: string | null) =>
      (
        await client.query(
          `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, matrix_type, created_by, updated_by)
           values ($1, $2, $3, 'active', $4, '__QA Three seat sofa', $5, 'qa', 'qa') returning id`,
          [projectId, runId, no, categoryId, type],
        )
      ).rows[0].id as string;
    typed = await add(1, "S");
    untyped = await add(2, null);
  });

  afterAll(async () => {
    if (projectId) {
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  it("tiers Swivel as TGQ on the untyped sofa and NOT on the sofa typed S", async () => {
    const { loadOutstanding } = await import("@/lib/chase-drafts");
    const swivel = (await loadOutstanding(projectId)).filter((q) => q.jsonId === 232);
    expect(swivel.find((q) => q.recordId === untyped)?.tier).toBe("to_quote");
    expect(swivel.find((q) => q.recordId === typed)?.tier).toBe("later");
    expect(swivel.find((q) => q.recordId === typed)?.matrixType).toBe("S");
  });

  it("reads the same tier through the coverage loader the generate route uses", async () => {
    const { loadOutstanding, loadQuestionsByKey } = await import("@/lib/chase-drafts");
    const swivel = (await loadOutstanding(projectId)).find((q) => q.jsonId === 232 && q.recordId === typed)!;
    const live = await loadQuestionsByKey(projectId, [{ recordId: typed, requirementId: swivel.requirementId }]);
    expect([...live.values()][0]?.tier).toBe("later");
  });

  it("hands the record screen each question's AUDIENCE, so the gate row's role reads it and not the kind (Stage 2)", async () => {
    const { sql } = await import("@/lib/db");
    const { loadGateContext } = await import("@/lib/gate-load");
    const { gateRowRole } = await import("@/lib/chase-counts");
    const context = await loadGateContext(sql, [typed]);
    const questions = [...context.questionsByCategory.values()].flat();
    // Assembly guide fills a BWS field and is ours (seed 0015).
    const assembly = questions.find((q) => q.json_id === 191)!;
    expect(assembly).toMatchObject({ kind: "spec_field", audience: "in_house" });
    expect(gateRowRole({ outcome: "blocking", field: { specFieldJsonId: 191, localKey: null } }, { ...assembly, section: null })).toBe("readiness");

    vi.doMock("@/lib/session", () => ({ getSessionUser: async () => ({ id: "x", email: "__qa@example.test", name: "QA", role: "admin" }) }));
    vi.resetModules();
    try {
      const { GET } = await import("@/app/api/records/[id]/route");
      const body = await (await GET(new Request("http://localhost/test"), { params: Promise.resolve({ id: typed }) })).json();
      const answer = body.answers.find((a: { json_id: number | null }) => a.json_id === 191);
      expect(answer.audience).toBe("in_house");
    } finally {
      vi.doUnmock("@/lib/session");
      vi.resetModules();
    }
  });
});
