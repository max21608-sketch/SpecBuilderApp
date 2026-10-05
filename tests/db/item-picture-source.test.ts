// Database tier — a photo or a render beats a drawing (Max, 2026-10-05).
//
// Through the REAL drawings confirm route, the real record route, the real
// image route and the real swap route, with the blob store held in memory.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/item-picture-source.test.ts
//
// ============================================================================
// WHAT IT PROVES:
//
// - a drawings confirm over a BILL'S picture keeps it current and stores the
//   crop beside it as an alternative, named by the page it came off, and says
//   so in its result;
// - the record payload says where the current picture came from and offers
//   the other one; the image route serves the current one, or an offered one
//   by the record's own attachment id;
// - the swap is a person's write: a change set, a version of the record whose
//   picture moved, rows superseded and inserted — never deleted, never
//   re-pointed — and it goes both ways;
// - a swap against a picture that has changed since is a 409 in words that
//   writes nothing;
// - a drawings confirm over a DRAWING crop supersedes it (the count of rows
//   only ever goes up), and every reader then reads the new one.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { stageDrawings, type SpecFieldEntry } from "@/lib/drawing-document";
import { loadRecordAtoms } from "@/lib/record-atoms";

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
  put: async () => {
    throw new Error("not used");
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
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type PicturePayload = {
  record: { has_image: boolean };
  picture: {
    current: { id: string; source: { kind: string; row?: number | null; page?: number | null } } | null;
    offered: { id: string; source: { kind: string; row?: number | null; page?: number | null } } | null;
  };
};

describeIfDb("a photo or a render beats a drawing", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let recordId = "";
  let fields: SpecFieldEntry[] = [];
  const code = "__QAPIC1";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA item pictures', 'qa', 'qa') returning id`,
        [qaNumber("P90091")],
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA MAIN', 1, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    recordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, qty, created_by, updated_by)
         values ($1, $2, 1, 'active', '__QA Lounge chair', 2, 'qa', 'qa') returning id`,
        [projectId, runId],
      )
    ).rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [recordId, projectId, code],
    );
    const fieldRows = await client.query(`select id, json_id, name from spec_fields order by sort_order`);
    fields = fieldRows.rows.map((row: { id: string; json_id: number; name: string }) => ({
      id: row.id,
      jsonId: Number(row.json_id),
      name: row.name,
    }));
  });

  afterAll(async () => {
    if (projectId) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(`delete from attachments where entity_type = 'spec_records' and entity_id in ${records}`, [projectId]);
      await client.query(`delete from status_history where entity_id in ${records}`, [projectId]);
      await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [projectId]);
      await client.query(`delete from spec_answers where record_id in ${records}`, [projectId]);
      await client.query(`delete from record_attributes where record_id in ${records}`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  // ---- helpers --------------------------------------------------------------

  const pictureRows = async () =>
    (
      await client.query(
        `select id, kind, storage_path, filename, superseded_at from attachments
         where entity_type = 'spec_records' and entity_id = $1 order by created_at, id`,
        [recordId],
      )
    ).rows as { id: string; kind: string; storage_path: string; filename: string; superseded_at: Date | null }[];

  const payload = async (): Promise<PicturePayload> => {
    const { GET } = await import("@/app/api/records/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(recordId));
    expect(response.status).toBe(200);
    return (await response.json()) as PicturePayload;
  };

  const served = async (query = "") => {
    const { GET } = await import("@/app/api/records/[id]/image/route");
    const response = await GET(new Request(`http://localhost/test${query}`), params(recordId));
    return { status: response.status, bytes: response.status === 200 ? Buffer.from(await response.arrayBuffer()) : null };
  };

  const choose = async (body: unknown) => {
    const { POST } = await import("@/app/api/records/[id]/image/choose/route");
    const response = await POST(post(body), params(recordId));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  /** A staged drawings run for the record's code, and its confirm with a crop off `page`. */
  async function confirmDrawing(label: string, page: number) {
    const staged = stageDrawings(
      [
        {
          itemCodeRaw: code,
          itemNameRaw: "__QA Lounge chair",
          page,
          // A different slot each time, so a second confirm replaces nothing.
          dimensions: [{ labelRaw: label === "first" ? "Width" : "Height", valueRaw: `${800 + page}mm` }],
          materials: [],
          dimensionsCombinedRaw: [],
          notesRaw: [],
          confidence: "high" as const,
        },
      ],
      fields,
      `__QA ${label}.pdf`,
      null,
    );
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id, version`,
      [projectId, JSON.stringify(staged)],
    );
    const item = staged.items[0]!;
    const pathname = `projects/${projectId}/item-images/${item.id}-${label}.png`;
    files.set(pathname, { bytes: Buffer.from(`crop ${label}`), contentType: "image/png" });
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(
      post({
        version: Number(run.rows[0].version),
        action: "confirm",
        itemId: item.id,
        itemVersion: item.version,
        observations: item.observations.filter((o) => o.reviewStatus === "pending").map((o) => ({ id: o.id, version: o.version })),
        image: { pathname, filename: `${item.id}.png`, page, width: 40, height: 30, size: 12 },
      }),
      params(String(run.rows[0].id)),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status, String(body.error)).toBe(200);
    return { body, pathname, itemId: item.id };
  }

  const billPath = () => `projects/${projectId}/bill-images/${runId}/__qa-photo.png`;
  let billId = "";
  let cropPath = "";

  // ---- the drawings confirm over a bill's picture ----------------------------

  it("keeps a bill's picture over a drawing crop, and offers the crop on the record", { timeout: 60_000 }, async () => {
    // What `giveBillPicture` writes at bill confirm.
    files.set(billPath(), { bytes: Buffer.from("bill photo"), contentType: "image/png" });
    billId = (
      await client.query(
        `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, uploaded_by)
         values ('spec_records', $1, 'item_image', $2, 'bill row 36.png', 'image/png', 'qa') returning id`,
        [recordId, billPath()],
      )
    ).rows[0].id;

    const { body, pathname, itemId } = await confirmDrawing("first", 2);
    cropPath = pathname;
    expect(body.picturesKept).toBe(1);
    expect(body.pictureNote).toBe("Kept the bill's picture; the drawing's crop is offered on the record.");

    const rows = await pictureRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: billId, kind: "item_image", superseded_at: null });
    expect(rows[1]).toMatchObject({
      kind: "item_image_alternative",
      storage_path: pathname,
      filename: `${itemId}-page-2.png`,
      superseded_at: null,
    });

    const shown = await payload();
    expect(shown.record.has_image).toBe(true);
    expect(shown.picture.current).toEqual({ id: billId, source: { kind: "bill", row: 36 } });
    expect(shown.picture.offered).toEqual({ id: rows[1]!.id, source: { kind: "drawing", page: 2 } });

    // The current picture is the bill's; the offered one is served by its id.
    expect((await served()).bytes?.toString()).toBe("bill photo");
    expect((await served(`?attachment=${rows[1]!.id}`)).bytes?.toString()).toBe("crop first");
    // Never anything that is not one of this record's pictures.
    expect((await served(`?attachment=00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await served(`?attachment=not-a-uuid`)).status).toBe(404);

    const atoms = (await loadRecordAtoms(async (s, ...v) => (await client.query(toPg(s), v)).rows, [recordId])).get(recordId)!;
    expect(atoms.itemImage?.attachmentId).toBe(billId);
  });

  // ---- the swap ------------------------------------------------------------

  it("refuses a swap against a picture that changed since, and writes nothing", async () => {
    const before = await pictureRows();
    const offered = (await payload()).picture.offered!;
    const stale = await choose({ attachmentId: offered.id, currentAttachmentId: offered.id });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("picture_changed");
    expect(String(stale.body.error)).toMatch(/picture changed since you looked/);
    expect(await pictureRows()).toEqual(before);
    // And a picture that is not this record's at all.
    const foreign = await choose({ attachmentId: "00000000-0000-0000-0000-000000000000", currentAttachmentId: billId });
    expect(foreign.status).toBe(404);
  });

  it("swaps the drawing's crop in as a person's write, with a change set and a version", async () => {
    const offered = (await payload()).picture.offered!;
    const versionsBefore = Number(
      (await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [recordId])).rows[0].n,
    );
    const recordVersion = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;

    const swapped = await choose({ attachmentId: offered.id, currentAttachmentId: billId });
    expect(swapped.status, String(swapped.body.error)).toBe(200);
    expect(swapped.body.source).toEqual({ kind: "drawing", page: 2 });

    const rows = await pictureRows();
    expect(rows).toHaveLength(3);
    // The bill's picture and the offer are superseded, not deleted; the new
    // current row names the crop's file and is a fresh item_image.
    expect(rows.find((row) => row.id === billId)?.superseded_at).not.toBeNull();
    expect(rows.find((row) => row.id === offered.id)).toMatchObject({ kind: "item_image_alternative" });
    expect(rows.find((row) => row.id === offered.id)?.superseded_at).not.toBeNull();
    const current = rows.find((row) => row.id === swapped.body.attachmentId);
    expect(current).toMatchObject({ kind: "item_image", storage_path: cropPath, superseded_at: null });

    // A change set with a version of the record; the record's own version is untouched.
    const change = await client.query(`select kind, actor, reason from change_sets where id = $1`, [swapped.body.changeSetId]);
    expect(change.rows[0]).toMatchObject({ kind: "manual_edit", actor: "__qa@example.test" });
    expect(change.rows[0].reason).toMatch(/cropped off the drawings, page 2/);
    const snapshot = await client.query(
      `select snapshot_no, atoms from record_snapshots where record_id = $1 and change_set_id = $2`,
      [recordId, swapped.body.changeSetId],
    );
    expect(snapshot.rows).toHaveLength(1);
    expect(Number(snapshot.rows[0].snapshot_no)).toBe(versionsBefore + 1);
    expect(snapshot.rows[0].atoms.itemImage).toEqual({ attachmentId: current!.id, storagePath: cropPath });
    expect((await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version).toBe(recordVersion);
    // The audit rows of the swap carry the change.
    const audited = await client.query(
      `select count(*)::int as n from audit_log where table_name = 'attachments' and change_set_id = $1`,
      [swapped.body.changeSetId],
    );
    expect(audited.rows[0].n).toBeGreaterThanOrEqual(3);

    // Every reader now reads the crop.
    expect((await served()).bytes?.toString()).toBe("crop first");
    const shown = await payload();
    expect(shown.picture.current).toEqual({ id: current!.id, source: { kind: "drawing", page: 2 } });
    // And the reverse is offered: the choice is always reversible.
    expect(shown.picture.offered).toEqual({ id: billId, source: { kind: "bill", row: 36 } });
  });

  it("swaps the bill's picture back, and offers the crop again", async () => {
    const shown = await payload();
    const back = await choose({ attachmentId: shown.picture.offered!.id, currentAttachmentId: shown.picture.current!.id });
    expect(back.status, String(back.body.error)).toBe(200);
    expect(back.body.source).toEqual({ kind: "bill", row: 36 });
    const rows = await pictureRows();
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.kind === "item_image" && row.superseded_at === null)).toHaveLength(1);
    expect((await served()).bytes?.toString()).toBe("bill photo");
    const again = await payload();
    expect(again.picture.current?.source).toEqual({ kind: "bill", row: 36 });
    expect(again.picture.offered?.source).toEqual({ kind: "drawing", page: 2 });
    // Choosing the picture that is already current is refused in words.
    const same = await choose({ attachmentId: again.picture.current!.id, currentAttachmentId: again.picture.current!.id });
    expect(same.status).toBe(400);
  });

  // ---- the drawings confirm over a drawing crop ------------------------------

  it("supersedes a drawing crop with the next one, deleting nothing", { timeout: 60_000 }, async () => {
    // Put the crop back as the picture first, so the next confirm meets a drawing.
    const shown = await payload();
    expect((await choose({ attachmentId: shown.picture.offered!.id, currentAttachmentId: shown.picture.current!.id })).status).toBe(200);
    const before = await pictureRows();
    const oldCurrent = before.find((row) => row.kind === "item_image" && row.superseded_at === null)!;
    expect(oldCurrent.storage_path).toBe(cropPath);

    const { body, pathname } = await confirmDrawing("second", 5);
    expect(body.picturesKept).toBeUndefined();
    expect(body.pictureNote).toBeUndefined();

    const after = await pictureRows();
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((row) => row.id === oldCurrent.id)?.superseded_at).not.toBeNull();
    const current = after.filter((row) => row.kind === "item_image" && row.superseded_at === null);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ storage_path: pathname });
    expect(current[0]!.filename).toMatch(/-page-5\.png$/);

    expect((await served()).bytes?.toString()).toBe("crop second");
    const now = await payload();
    expect(now.picture.current?.source).toEqual({ kind: "drawing", page: 5 });
    // The bill's picture it displaced long ago is still the one offered back.
    expect(now.picture.offered?.source).toEqual({ kind: "bill", row: 36 });
    const atoms = (await loadRecordAtoms(async (s, ...v) => (await client.query(toPg(s), v)).rows, [recordId])).get(recordId)!;
    expect(atoms.itemImage).toEqual({ attachmentId: current[0]!.id, storagePath: pathname });
  });

  it("leaves no change set in this project without a version", async () => {
    const uncovered = await client.query(
      `select cs.id, cs.kind from change_sets cs
        where cs.project_id = $1
          and exists (select 1 from audit_log al where al.change_set_id = cs.id
                       and al.table_name in ('spec_records', 'spec_answers', 'record_attributes', 'spec_record_refs', 'attachments'))
          and not exists (select 1 from record_snapshots s where s.change_set_id = cs.id)`,
      [projectId],
    );
    expect(uncovered.rows).toEqual([]);
  });
});

/** A tagged template as a pg query: `$1`, `$2`… for the values. */
function toPg(strings: TemplateStringsArray): string {
  return strings.reduce((text, part, index) => (index === 0 ? part : `${text}$${index}${part}`), "");
}
