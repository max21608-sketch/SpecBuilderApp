// Database tier — the bill fills the finishes library (2026-10-05): a fabric
// line's picture becomes its code's swatch, an uncoded fabric with real words
// is filed as an in-house fabric (`BW-<short code>-001`), a placeholder is
// filed nowhere, and the backfill does to an older bill what a confirm now
// does. Through the real registration, the real review GET and the real
// confirm, with the blob store held in memory.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node ~/dev/localstack/one-db-test.mjs tests/db/bill-fabric-library.test.ts
//
// Nothing here is a client document: `fabricSwatchBillWorkbook` is built from
// source every run, codes `ZZ-`, words "Example …".
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { FABRIC_SWATCH_BOUCLE, fabricSwatchBillWorkbook } from "../fixtures/build-boq";
import type { TxnSql } from "@/lib/db-transaction";

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
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (method: string, body: unknown) =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

type ConfirmBody = {
  ok: boolean;
  error?: string;
  fabricSpecs?: number;
  inHouseFinishes?: number;
  fabricSwatches?: number;
  swatchNotices?: string[];
};

describeIfDb("the bill fills the finishes library", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const projects: string[] = [];
  let withCode = "";
  let withoutCode = "";
  let billRunId = "";
  /** The swatch somebody already gave ZZ-FAB-15, which the bill must never replace. */
  const ownSwatch = () => `projects/${withCode}/swatches/__qa-own-mohair.png`;

  // A tagged template over this client, as the backfill script builds one.
  const txn: TxnSql = async (strings, ...values) => {
    let text = "";
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i] ?? "";
      if (i < values.length) text += `$${i + 1}`;
    }
    return (await client.query(text, values)).rows as Record<string, unknown>[];
  };

  const newProject = async (number: string, prefix: string | null) => {
    const id = (
      await client.query(
        `insert into projects (bws_project_number, name, finish_code_prefix, created_by, updated_by)
         values ($1, '__QA bill fills the library', $2, 'qa', 'qa') returning id`,
        [qaNumber(number), prefix],
      )
    ).rows[0].id as string;
    projects.push(id);
    return id;
  };

  beforeAll(async () => {
    await client.connect();
    withCode = await newProject("P90441", "ZZA");
    withoutCode = await newProject("P90442", null);
    // ZZ-FAB-15 is in the library already, with a swatch somebody cropped.
    const mohair = (
      await client.query(
        `insert into project_finishes (project_id, code, code_norm, description, state, created_by, updated_by)
         values ($1, 'ZZ-FAB-15', 'ZZ-FAB-15', 'Fabric @ Pouf Collection: Example Mohair', 'tbc', 'qa', 'qa') returning id`,
        [withCode],
      )
    ).rows[0].id;
    await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, uploaded_by)
       values ('project_finishes', $1, 'finish_swatch', $2, 'swatch-page-1.png', 'image/png', 'qa')`,
      [mohair, ownSwatch()],
    );
  });

  afterAll(async () => {
    for (const projectId of projects) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(
        `delete from attachments where entity_type = 'project_finishes'
           and entity_id in (select id from project_finishes where project_id = $1)`,
        [projectId],
      );
      await client.query(`delete from attachments where entity_type = 'spec_records' and entity_id in ${records}`, [projectId]);
      await client.query(`update record_attributes set finish_id = null where record_id in ${records}`, [projectId]);
      await client.query(`delete from status_history where entity_id in ${records}`, [projectId]);
      await client.query(`delete from spec_answers where record_id in ${records}`, [projectId]);
      await client.query(`delete from record_attributes where record_id in ${records}`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
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

  async function register(projectId: string, name: string): Promise<string> {
    const pathname = `projects/${projectId}/${name}`;
    files.set(pathname, {
      bytes: await fabricSwatchBillWorkbook(),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      jsonRequest("POST", { projectId, importType: "boq", pathname, filename: name, contentType: "" }),
    );
    const body = (await response.json()) as { ok: boolean; importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    return body.importId;
  }
  const confirm = async (runId: string): Promise<ConfirmBody> => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", {}), params(runId));
    const body = (await response.json()) as ConfirmBody;
    expect(response.status, body.error).toBe(200);
    return body;
  };
  const stagedPath = async (runId: string, row: number) =>
    (
      (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as {
        rowImages: Record<string, Record<string, { pathname: string | null }>>;
      }
    ).rowImages.Bill?.[String(row)]?.pathname ?? null;

  /** What the library holds, and what links to it: the thing a fresh confirm and the backfill must agree on. */
  const libraryState = async (projectId: string) => ({
    finishes: (
      await client.query(
        `select code, code_origin, description, state from project_finishes
          where project_id = $1 and status = 'active' order by code`,
        [projectId],
      )
    ).rows,
    links: (
      await client.query(
        `select r.record_no, a.value, f.code
           from record_attributes a
           join spec_records r on r.id = a.record_id
           left join project_finishes f on f.id = a.finish_id
          where r.project_id = $1 and a.status = 'active' and a.attr_group = 'material'
          order by r.record_no, a.sort_order`,
        [projectId],
      )
    ).rows,
    swatches: (
      await client.query(
        `select f.code, s.storage_path, s.filename
           from attachments s join project_finishes f on f.id = s.entity_id
          where s.entity_type = 'project_finishes' and s.kind = 'finish_swatch' and s.superseded_at is null
            and f.project_id = $1
          order by f.code`,
        [projectId],
      )
    ).rows,
  });

  it("says on the review what each fabric row will do", { timeout: 60_000 }, async () => {
    billRunId = await register(withCode, "__QA fabric swatches.xlsx");
    const { GET } = await import("@/app/api/imports/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(billRunId));
    const body = (await response.json()) as {
      fabricFilings: Record<number, Record<number, { filing: string; swatch: string | null; askForShortCode: boolean }>>;
      import: { parsed: { sheets: { lines: { index: number; lineNo: number; rowKind?: string }[] }[] } };
    };
    const indexOf = (row: number) => body.import.parsed.sheets[0]!.lines.find((line) => line.lineNo === row)!.index;
    const line = (row: number) => body.fabricFilings[0]?.[indexOf(row)];
    expect(line(4)).toEqual({ filing: "new library entry ZZ-FAB-13", swatch: "swatch: this row's picture", askForShortCode: false });
    expect(line(6)?.filing).toBe("new library entry ZZ-FAB-13, with row 4");
    expect(line(8)?.swatch).toBe("swatch: none — rows 8 and 10 differ");
    expect(line(12)).toEqual({
      filing: "new in-house fabric — numbered BW-ZZA-… at confirm",
      swatch: "swatch: this row's picture",
      askForShortCode: false,
    });
    expect(line(14)).toEqual({
      filing: "same words as row 12 — one in-house code",
      swatch: "swatch: row 12's picture",
      askForShortCode: false,
    });
    expect(line(16)).toEqual({ filing: "placeholder — not filed", swatch: null, askForShortCode: false });
    expect(line(18)).toEqual({
      filing: "matches ZZ-FAB-15 in the library",
      swatch: "swatch: none (the library already has one)",
      askForShortCode: false,
    });
  });

  it("files every fabric line, mints one in-house code, and takes the swatches the review promised", { timeout: 60_000 }, async () => {
    const result = await confirm(billRunId);
    expect(result.fabricSpecs).toBe(8);
    expect(result.inHouseFinishes).toBe(1);
    expect(result.fabricSwatches).toBe(2);
    expect(result.swatchNotices).toEqual(["ZZ-FAB-14: rows 8 and 10 carry different pictures — no swatch taken"]);

    const state = await libraryState(withCode);
    expect(state.finishes).toEqual([
      { code: "BW-ZZA-001", code_origin: "internal", description: FABRIC_SWATCH_BOUCLE, state: "tbc" },
      { code: "ZZ-FAB-13", code_origin: "client", description: "Fabric @ Stool Collection: Example Velvet, Colour: Claret", state: "tbc" },
      { code: "ZZ-FAB-14", code_origin: "client", description: "Fabric @ Armchair Collection: Example Linen, Colour: Sand", state: "tbc" },
      { code: "ZZ-FAB-15", code_origin: "client", description: "Fabric @ Pouf Collection: Example Mohair", state: "tbc" },
    ]);
    // Two lines of one code with one picture: ONE swatch. Different pictures: none.
    // The library's own swatch: untouched. The in-house code: its row's picture.
    expect(state.swatches).toEqual([
      { code: "BW-ZZA-001", storage_path: await stagedPath(billRunId, 12), filename: "bill row 12.png" },
      { code: "ZZ-FAB-13", storage_path: await stagedPath(billRunId, 4), filename: "bill row 4.png" },
      { code: "ZZ-FAB-15", storage_path: ownSwatch(), filename: "swatch-page-1.png" },
    ]);
    // The same words twice: one code, both linked. The placeholder: linked to nothing.
    const codeOf = (value: string) => state.links.filter((link) => link.value === value).map((link) => link.code);
    expect(codeOf(FABRIC_SWATCH_BOUCLE)).toEqual(["BW-ZZA-001", "BW-ZZA-001"]);
    expect(codeOf("Fabric @ Ottoman (Option 1) Technical details TBC")).toEqual([null]);
    // A placeholder's picture is filed nowhere.
    const placeholderPicture = await stagedPath(billRunId, 16);
    const filedAnywhere = await client.query(
      `select 1 from attachments where entity_type = 'project_finishes' and storage_path = $1`,
      [placeholderPicture],
    );
    expect(filedAnywhere.rows).toHaveLength(0);
  });

  it("never ships the in-house code: the BWS export carries the fabric's words alone", { timeout: 60_000 }, async () => {
    const { GET } = await import("@/app/api/projects/[id]/export/route");
    const response = await GET(new Request("http://localhost/test?format=csv"), params(withCode));
    expect(response.status).toBe(200);
    const file = await response.text();
    expect(file).toContain("Example Boucle");
    expect(file).not.toContain("BW-ZZA-");
    expect(file).not.toContain("BW-F-");
  });

  it("mints BW-F-nnn on a project with no short code", { timeout: 60_000 }, async () => {
    const runId = await register(withoutCode, "__QA fabric swatches, no short code.xlsx");
    const result = await confirm(runId);
    expect(result.inHouseFinishes).toBe(1);
    const internal = await client.query(
      `select code from project_finishes where project_id = $1 and code_origin = 'internal'`,
      [withoutCode],
    );
    expect(internal.rows.map((row) => row.code)).toEqual(["BW-F-001"]);
  });

  it("backfills an older bill exactly as a fresh confirm filed it, and a dry run writes nothing", { timeout: 90_000 }, async () => {
    const { applyBillSwatchBackfill, planBillSwatchBackfill } = await import("@/lib/bill-swatch-backfill");
    const fresh = await libraryState(withCode);

    // AS AN OLDER CONFIRM LEFT IT: no swatch off the bill, no in-house code,
    // the uncoded fabric linked to nothing.
    await client.query(
      `delete from attachments where entity_type = 'project_finishes' and filename like 'bill row %'
         and entity_id in (select id from project_finishes where project_id = $1)`,
      [withCode],
    );
    await client.query(
      `update record_attributes set finish_id = null
        where finish_id in (select id from project_finishes where project_id = $1 and code_origin = 'internal')`,
      [withCode],
    );
    await client.query(`delete from project_finishes where project_id = $1 and code_origin = 'internal'`, [withCode]);
    const older = await libraryState(withCode);
    expect(older.swatches).toHaveLength(1);

    const plan = await planBillSwatchBackfill(txn, withCode);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.series).toBe("BW-ZZA-");
    expect(plan[0]!.actions.map((action) => [action.kind, action.rowNo])).toEqual([
      ["mint", 12],
      ["mint", 14],
      ["swatch", 4],
      ["swatch", 12],
    ]);
    expect(plan[0]!.notes).toEqual(["ZZ-FAB-14: rows 8 and 10 carry different pictures — no swatch taken"]);
    // The dry run is the plan: nothing moved.
    expect(await libraryState(withCode)).toEqual(older);

    await client.query("begin");
    let changeSetId: string | null = null;
    try {
      const result = await applyBillSwatchBackfill(txn, plan[0]!, "__qa@example.test");
      await client.query("commit");
      expect(result).toMatchObject({ minted: 1, linked: 2, swatches: 2 });
      changeSetId = result.changeSetId;
    } catch (cause) {
      await client.query("rollback");
      throw cause;
    }
    expect(await libraryState(withCode)).toEqual(fresh);

    // A version of every record whose fabric moved, under the backfill's change.
    const versions = await client.query(`select count(*)::int as n from record_snapshots where change_set_id = $1`, [
      changeSetId,
    ]);
    expect(versions.rows[0].n).toBe(2);

    // Safe to re-run: nothing left to do.
    expect(await planBillSwatchBackfill(txn, withCode)).toEqual([
      expect.objectContaining({ actions: [], notes: ["ZZ-FAB-14: rows 8 and 10 carry different pictures — no swatch taken"] }),
    ]);
  });

  it("sets the short code on the project upper-cased, and refuses one in words", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const version = async () =>
      Number((await client.query(`select version from projects where id = $1`, [withoutCode])).rows[0].version);
    const refused = await PATCH(jsonRequest("PATCH", { version: await version(), finishCodePrefix: "A-B" }), params(withoutCode));
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toMatch(/two to six letters or digits/);

    const set = await PATCH(jsonRequest("PATCH", { version: await version(), finishCodePrefix: " zzb " }), params(withoutCode));
    expect(set.status).toBe(200);
    expect(((await set.json()) as { project: { finish_code_prefix: string } }).project.finish_code_prefix).toBe("ZZB");
    // Renames nothing already minted.
    const internal = await client.query(
      `select code from project_finishes where project_id = $1 and code_origin = 'internal'`,
      [withoutCode],
    );
    expect(internal.rows.map((row) => row.code)).toEqual(["BW-F-001"]);
    // Blank clears it.
    const cleared = await PATCH(jsonRequest("PATCH", { version: await version(), finishCodePrefix: "" }), params(withoutCode));
    expect(((await cleared.json()) as { project: { finish_code_prefix: string | null } }).project.finish_code_prefix).toBeNull();
  });
});
