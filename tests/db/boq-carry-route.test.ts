// Database tier — a decision on one phase's tab reaches the same client ref on
// the others, through the REAL PATCH route.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// The pure half is `tests/lib/boq-carry.test.ts`. This is the half that proves
// the route writes what the plan says, into the STAGED JSON and nothing else:
// found-in-use "A level accepted on one phase's tab is still an unaccepted
// suggestion on the next, for the same client ref".
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type StagedLine = Record<string, unknown> & { index: number; code: string | null };

describeIfDb("a decision carries across a bill's phases", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";
  let otherCategoryId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90031")}', '__QA phase carry', 'qa', 'qa') returning id`,
      )
    ).rows[0]!.id;
    const categories = await client.query(
      `select c.id from item_categories c
       join requirements q on q.category_id = c.id
       group by c.id having count(q.id) >= 1
       order by c.id limit 2`,
    );
    categoryId = categories.rows[0]!.id;
    otherCategoryId = categories.rows[1]!.id;
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  function line(index: number, code: string | null, extra: Record<string, unknown> = {}): StagedLine {
    return {
      index,
      lineNo: index + 1,
      designer: null,
      boqCategory: null,
      area: null,
      code,
      itemDescription: `__QA item ${code ?? index}`,
      productReference: null,
      qty: 1,
      qtyUnit: "pcs",
      categoryId: null,
      categoryStatus: "none",
      ignored: false,
      ...extra,
    };
  }

  function sheet(name: string, lines: StagedLine[]) {
    return {
      sheetName: name,
      proposedRunName: name,
      headerRow: 1,
      skippedRows: 0,
      ignored: false,
      ignoredReason: null as string | null,
      metadata: { revision: "0", date: "14-Sep-26", notes: [] as string[] },
      lines,
    };
  }

  async function stage(sheets: ReturnType<typeof sheet>[]): Promise<string> {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [projectId, JSON.stringify({ schemaVersion: 3, filename: "__QA boq.xlsx", sourcePreserved: false, sheets })],
    );
    return run.rows[0]!.id;
  }

  async function read(importId: string): Promise<{ lines: StagedLine[] }[]> {
    const rows = await client.query(`select parsed from intake_runs where id = $1`, [importId]);
    return rows.rows[0]!.parsed.sheets;
  }

  /** MUR, MAIN RUN and MAIN RUN - VE, each quoting S-100 and S-201. */
  function threeTabs() {
    return [
      sheet("__QA MUR", [line(0, "S-100"), line(1, "S-201")]),
      sheet("__QA MAIN RUN", [line(0, "S-100"), line(1, "S-201")]),
      sheet("__QA MAIN RUN - VE", [line(0, "S-100"), line(1, "S-201")]),
    ];
  }

  it("accepting a level on one tab fills it in on the others, marked as carried", async () => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const importId = await stage(threeTabs());

    const res = await PATCH(patch({ sheetIndex: 0, index: 0, level: "simple" }), params(importId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.carried).toBe(2);
    expect(body.carriedTo).toBe("__QA MAIN RUN and __QA MAIN RUN - VE");

    const sheets = await read(importId);
    // The tab it was decided on says nothing about where it came from.
    expect(sheets[0]!.lines[0]!.levelStatus).toBe("chosen");
    expect(sheets[0]!.lines[0]!.levelCarriedFrom).toBeNull();
    for (const index of [1, 2]) {
      expect(sheets[index]!.lines[0]!.level).toBe("simple");
      // `chosen` is what tells the confirm to write `spec_records.level` rather
      // than the advisory `level_suggested`. A carried level IS the decision.
      expect(sheets[index]!.lines[0]!.levelStatus).toBe("chosen");
      expect(sheets[index]!.lines[0]!.levelCarriedFrom).toBe("__QA MUR");
    }
    // S-201 is untouched — a carry is about one client ref.
    expect(sheets[1]!.lines[1]!.levelStatus).toBeUndefined();
  });

  it("carries a category the same way, and folds a ref the other tab spells differently", async () => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const importId = await stage([
      sheet("__QA MUR", [line(0, "S-201")]),
      sheet("__QA MAIN RUN", [line(0, "S.201")]),
    ]);

    const res = await PATCH(patch({ sheetIndex: 0, index: 0, categoryId }), params(importId));
    expect((await res.json()).carried).toBe(1);

    const sheets = await read(importId);
    expect(sheets[1]!.lines[0]!.categoryId).toBe(categoryId);
    expect(sheets[1]!.lines[0]!.categoryStatus).toBe("chosen");
    expect(sheets[1]!.lines[0]!.categoryCarriedFrom).toBe("__QA MUR");
  });

  it("leaves a ref that appears twice in one tab alone, in both directions", async () => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const importId = await stage([
      sheet("__QA MUR", [line(0, "SX11A"), line(1, "S-100")]),
      sheet("__QA MAIN RUN", [line(0, "SX11A"), line(1, "SX11A"), line(2, "S-100")]),
    ]);

    // Receiving side: MAIN RUN carries SX11A twice, so there is no single row
    // to put the decision on. `findRecordsByRef`'s rule — offer the candidates,
    // choose none — is the one that applies.
    const toDuplicated = await PATCH(patch({ sheetIndex: 0, index: 0, level: "hero" }), params(importId));
    expect((await toDuplicated.json()).carried).toBe(0);

    // Sending side: which of MAIN RUN's two SX11A rows was decided says nothing
    // about the one on MUR.
    const fromDuplicated = await PATCH(patch({ sheetIndex: 1, index: 0, level: "complex" }), params(importId));
    expect((await fromDuplicated.json()).carried).toBe(0);

    const sheets = await read(importId);
    expect(sheets[1]!.lines[0]!.levelStatus).toBe("chosen");
    expect(sheets[1]!.lines[1]!.levelStatus).toBeUndefined();
    expect(sheets[0]!.lines[0]!.levelStatus).toBe("chosen");
    expect(sheets[0]!.lines[0]!.levelCarriedFrom).toBeNull();
    // S-100 is on both tabs once, so THAT one did carry, from the second press.
    expect(sheets[1]!.lines[2]!.levelStatus).toBeUndefined();
  });

  it("never overwrites a value a person set on the receiving tab", async () => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const importId = await stage(threeTabs());

    // MAIN RUN is decided on its own tab first — a VE phase legitimately being
    // a cheaper build is the case this protects.
    await PATCH(patch({ sheetIndex: 1, index: 0, level: "hero" }), params(importId));
    await PATCH(patch({ sheetIndex: 1, index: 0, categoryId: otherCategoryId }), params(importId));

    const res = await PATCH(patch({ sheetIndex: 0, index: 0, level: "simple" }), params(importId));
    // Only MAIN RUN - VE takes it: MUR is the source, MAIN RUN is spoken for.
    expect((await res.json()).carried).toBe(1);

    const sheets = await read(importId);
    expect(sheets[1]!.lines[0]!.level).toBe("hero");
    expect(sheets[1]!.lines[0]!.levelCarriedFrom).toBeNull();
    expect(sheets[2]!.lines[0]!.level).toBe("simple");
    expect(sheets[2]!.lines[0]!.levelCarriedFrom).toBe("__QA MUR");

    // And the category it set on its own tab stays its own.
    const category = await PATCH(patch({ sheetIndex: 0, index: 0, categoryId }), params(importId));
    expect((await category.json()).carried).toBe(1);
    expect((await read(importId))[1]!.lines[0]!.categoryId).toBe(otherCategoryId);
  });

  it("a row overridden on its own tab stops claiming the carry, and wins from then on", async () => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const importId = await stage(threeTabs());

    await PATCH(patch({ sheetIndex: 0, index: 0, level: "simple" }), params(importId));
    await PATCH(patch({ sheetIndex: 2, index: 0, level: "hero" }), params(importId));
    expect((await read(importId))[2]!.lines[0]!.levelCarriedFrom).toBeNull();

    // MUR decides again; VE now holds a decision of its own and keeps it.
    const again = await PATCH(patch({ sheetIndex: 0, index: 0, level: "complex" }), params(importId));
    expect((await again.json()).carried).toBe(1);
    const sheets = await read(importId);
    expect(sheets[1]!.lines[0]!.level).toBe("complex");
    expect(sheets[2]!.lines[0]!.level).toBe("hero");
  });

  it("carries nothing from a clear, from a blank ref, or into an ignored line or tab", async () => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const importId = await stage([
      sheet("__QA MUR", [line(0, "S-100"), line(1, null)]),
      sheet("__QA MAIN RUN", [line(0, "S-100", { ignored: true }), line(1, null)]),
      { ...sheet("__QA VE", [line(0, "S-100"), line(1, null)]), ignored: true },
    ]);

    // A CLEAR is "I do not know yet" and must not travel: it would destroy
    // values on tabs nobody opened with no decision behind it.
    const cleared = await PATCH(patch({ sheetIndex: 0, index: 0, level: null }), params(importId));
    expect((await cleared.json()).carried).toBeUndefined();

    const set = await PATCH(patch({ sheetIndex: 0, index: 0, level: "simple" }), params(importId));
    expect((await set.json()).carried).toBe(0);

    // A blank is not a ref every other blank shares.
    const blank = await PATCH(patch({ sheetIndex: 0, index: 1, level: "simple" }), params(importId));
    expect((await blank.json()).carried).toBe(0);

    const sheets = await read(importId);
    expect(sheets[1]!.lines[0]!.levelStatus).toBeUndefined();
    expect(sheets[1]!.lines[1]!.levelStatus).toBeUndefined();
    expect(sheets[2]!.lines[0]!.levelStatus).toBeUndefined();
  });

  it("writes nothing at all once a confirmed import is asked to change", async () => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const importId = await stage(threeTabs());
    await client.query(`update intake_runs set status = 'confirmed' where id = $1`, [importId]);

    const res = await PATCH(patch({ sheetIndex: 0, index: 0, level: "simple" }), params(importId));
    expect(res.status).toBe(409);
    const sheets = await read(importId);
    expect(sheets.every((each) => each.lines.every((row) => row.levelStatus === undefined))).toBe(true);
  });
});
