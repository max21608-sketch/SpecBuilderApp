// Database tier: an email UPLOADED, through the real registration route.
//
// Two things the auto-assign suite cannot reach, because it enters through the
// Graph ingestion function:
//
//   * audit B8: the same `.eml` uploaded twice was two messages, two runs and
//     two charged reads. The second upload now answers 200 with the message
//     that already exists, and records and reads nothing.
//   * audit A1, the upload half: an uploaded message's file is under the
//     project it was uploaded to, not under the mailbox, so moving it to
//     another project has to copy it from THERE, and from nowhere else.
//
// NO MODEL IS CALLED AND NOTHING IS PUBLISHED: the queue, the session and the
// blob store are mocked at the module boundary. The store serves bytes from a
// map, so `readTrustedBlob` and its scope check run as they always do.
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { describeIfDb, qaNumber, QA_RUN_SUFFIX } from "./db-tier";
import pg from "pg";

const published: string[] = [];
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: { extractionId: string }) => {
      published.push(message.extractionId);
    },
  };
});

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

/** The store, as a map from pathname to bytes. */
const store = new Map<string, Buffer>();
const copied: { from: string; to: string }[] = [];
vi.mock("@vercel/blob", () => ({
  head: async (pathname: string) => {
    const bytes = store.get(pathname);
    return bytes ? { pathname, size: bytes.byteLength, contentType: "message/rfc822" } : null;
  },
  get: async (pathname: string) => {
    const bytes = store.get(pathname);
    if (!bytes) return null;
    return {
      statusCode: 200,
      blob: { contentType: "message/rfc822" },
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(bytes));
          controller.close();
        },
      }),
    };
  },
  put: async (pathname: string) => ({ pathname, url: `https://blob.test/${pathname}` }),
  copy: async (from: string, to: string) => {
    copied.push({ from, to });
    const bytes = store.get(from);
    if (bytes) store.set(to, bytes);
    return { pathname: to, url: `https://blob.test/${to}` };
  },
}));

const databaseUrl = process.env.DATABASE_URL;
const UPLOADED_TO = qaNumber("P90215");
const MOVED_TO = qaNumber("P90216");

function eml(tag: string): Buffer {
  return Buffer.from(
    [
      `Message-ID: <__qa.upload.${tag}.${QA_RUN_SUFFIX}@example.test>`,
      "Date: Mon, 21 Sep 2026 09:00:00 +0000",
      "From: someone@elsewhere.test",
      "To: kam@benwhistler.test",
      `Subject: __QA upload ${tag}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "The seat height on the lounge chair is 445mm.",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

const post = (body: unknown) =>
  new Request("http://localhost/api/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("an uploaded email", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let otherId = "";

  async function upload(pathname: string, filename: string) {
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(
      post({
        projectId,
        importType: "spec_document",
        documentKind: "email",
        pathname,
        filename,
        contentType: "message/rfc822",
      }),
    );
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Upload project', 'qa', 'qa') returning id`,
        [UPLOADED_TO],
      )
    ).rows[0].id;
    otherId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Upload moved to', 'qa', 'qa') returning id`,
        [MOVED_TO],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    // Every message this file recorded carries this run's suffix in its
    // Message-ID; its attachments belong to the message.
    const messages = await client.query(`select id from email_messages where internet_message_id like $1`, [
      `<__qa.upload.%.${QA_RUN_SUFFIX}@example.test>`,
    ]);
    const ids = messages.rows.map((row) => String(row.id));
    if (ids.length > 0) {
      await client.query(`delete from email_messages where id = any($1::uuid[])`, [ids]);
      await client.query(`delete from attachments where entity_type = 'email_messages' and entity_id = any($1::uuid[])`, [
        ids,
      ]);
    }
    for (const id of [projectId, otherId].filter(Boolean)) {
      await client.query(`delete from intake_runs where project_id = $1`, [id]);
      await client.query(`delete from projects where id = $1`, [id]);
    }
    await client.end();
  });

  beforeEach(() => {
    published.length = 0;
    copied.length = 0;
  });

  it("records the same .eml once, however many times it is uploaded, and says where it is", async () => {
    const bytes = eml("twice");
    const first = `projects/${projectId}/uploads/__qa-twice-1.eml`;
    const second = `projects/${projectId}/uploads/__qa-twice-2.eml`;
    store.set(first, bytes);
    store.set(second, bytes);

    const one = await upload(first, "__QA twice.eml");
    expect(one.status).toBe(201);
    expect(published).toHaveLength(1);

    published.length = 0;
    const two = await upload(second, "__QA twice (copy).eml");
    // OFFERED, not recorded: 200, the message that exists, and a sentence.
    expect(two.status).toBe(200);
    expect(two.body.duplicateOf.messageId).toBe(one.body.messageId);
    expect(two.body.note).toContain("already in the inbox");
    expect(published).toHaveLength(0);

    const rows = await client.query(
      `select count(*)::int as n, min(mime_sha256) as sha from email_messages where internet_message_id = $1`,
      [`<__qa.upload.twice.${QA_RUN_SUFFIX}@example.test>`],
    );
    expect(rows.rows[0].n).toBe(1);
    // The hash is written, so a copy with no Message-ID is caught too.
    expect(String(rows.rows[0].sha)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("moves an uploaded message to another project by copying it from the project it was uploaded to", async () => {
    const path = `projects/${projectId}/uploads/__qa-move.eml`;
    store.set(path, eml("move"));
    const placed = await upload(path, "__QA move.eml");
    expect(placed.status).toBe(201);
    const messageId = String(placed.body.messageId);

    const { assignMessage, unassignMessage } = await import("@/lib/email-registration");
    const version = async () =>
      Number((await client.query(`select version from email_messages where id = $1`, [messageId])).rows[0].version);
    await unassignMessage(messageId, { actor: "__qa@example.test", expectedVersion: await version() });

    published.length = 0;
    const moved = await assignMessage({
      messageId,
      projectId: otherId,
      kind: "manual",
      actor: "__qa@example.test",
      expectedVersion: await version(),
    });
    expect(moved.read).toBe(true);
    expect(published).toEqual([moved.runId]);
    expect(copied).toEqual([{ from: path, to: `projects/${otherId}/emails/${messageId}.eml` }]);

    const run = await client.query(
      `select r.project_id, a.storage_path from intake_runs r join attachments a on a.id = r.attachment_id where r.id = $1`,
      [moved.runId],
    );
    expect(String(run.rows[0].project_id)).toBe(otherId);
    expect(String(run.rows[0].storage_path)).toBe(`projects/${otherId}/emails/${messageId}.eml`);
  });
});
