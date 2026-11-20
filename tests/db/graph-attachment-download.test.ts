// Database tier — a Graph arrival's attachments download as the files listed
// (pre-push review E4, 2026-11-20), through the REAL ingestion function and
// the REAL download route.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/graph-attachment-download.test.ts
//
// ============================================================================
// WHAT FAILED. The download route refuses a file when a fresh parse of the
// stored `.eml` disagrees with the list the screen rendered
// (`sameListedAttachment`, 409 `attachment_changed`). For an upload that list
// is the parser's own. For a Graph arrival it was GRAPH's description of each
// attachment: a forwarded Outlook item is an `itemAttachment` with no content
// type (stored `application/octet-stream`, named by its subject) where the
// parser reads `message/rfc822` with no name — never equal — and Graph's order
// (inline images included) need not be the MIME's. Every Download on such a
// message would have been refused, or worse, the index would have named a
// different file. Latent while mailbox ingestion is disabled.
//
// WHAT HOLDS NOW. Where the message's bytes were stored and parsed, the list
// stored is the parser's reading of them — the list the route indexes — so
// the comparison is like with like, size included, as for an upload. Graph's
// own description is kept only where there are no parsed bytes.
//
// Graph, the store and the queue are mocked at the module boundary, as
// `email-auto-assign.test.ts` mocks them. The message routes nowhere, so
// nothing is assigned and nothing is read: the run is joined by hand below,
// as `assignMessage` would join it. Every key is this process's own.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber, QA_RUN_SUFFIX } from "./db-tier";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-graph-attach@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

/** The store: what ingestion put, and what the route reads back. */
const store = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }));

vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, bytes: Uint8Array | Buffer) => {
    store.files.set(pathname, new Uint8Array(bytes));
    return { pathname, url: `https://blob.test/${pathname}` };
  },
  copy: async (from: string, to: string) => ({ pathname: to, url: `https://blob.test/${to}` }),
  get: async () => null,
  head: async () => null,
}));

vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    readTrustedBlob: async (pathname: string, projectId: string) => {
      actual.assertProjectScopedPathname(pathname, projectId);
      const bytes = Buffer.from(store.files.get(pathname) ?? new Uint8Array());
      return { bytes, contentType: "message/rfc822", size: bytes.byteLength, pathname };
    },
  };
});

vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async () => {
      throw new Error("__QA nothing in this file may start a read");
    },
  };
});

const inflight = vi.hoisted(() => ({
  mime: Buffer.alloc(0),
  internetMessageId: "",
  graphListing: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/graph-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graph-client")>();
  return {
    ...actual,
    mailIngestionEnabled: () => true,
    mailboxPath: (suffix: string) => `/users/__qa-mailbox${suffix}`,
    // The message, and — on the `/attachments` path — Graph's own listing.
    graphJson: async (path: string) =>
      path.includes("/attachments")
        ? { value: inflight.graphListing }
        : {
            id: "__qa_graph_id",
            internetMessageId: inflight.internetMessageId,
            receivedDateTime: "2026-11-20T09:00:00Z",
            subject: "__QA FW: X-100 sizes",
            hasAttachments: true,
            toRecipients: [],
          },
    graphBytes: async () => ({ bytes: inflight.mime, contentType: "message/rfc822" }),
  };
});

const MAILBOX = `__qa_graph_attach_${QA_RUN_SUFFIX}`;

const png = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");
const sheet = Buffer.from("%PDF-1.7 __QA invented sizes sheet", "utf8");
const forward = ["From: __qa-client@example.test", "Subject: RE: __QA Seat heights", "", "The seat height is 450mm.", ""].join(
  "\r\n",
);

/**
 * An Outlook-shaped forward, invented throughout: an HTML body with a
 * signature image inline, the sheet, and the original as a forwarded item.
 * The MIME order is image, sheet, item.
 */
function mime(messageId: string): Buffer {
  return Buffer.from(
    [
      "From: Jane Doe <jane@designers.test>",
      "To: __qa-nobody@example.test",
      "Subject: __QA FW: X-100 sizes",
      `Message-ID: ${messageId}`,
      "Date: Fri, 20 Nov 2026 09:00:00 +0000",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="M"',
      "",
      "--M",
      'Content-Type: multipart/related; boundary="R"',
      "",
      "--R",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Sizes attached, and the original below.</p><img src="cid:image001.png@01">',
      "--R",
      'Content-Type: image/png; name="image001.png"',
      'Content-Disposition: inline; filename="image001.png"',
      "Content-ID: <image001.png@01>",
      "Content-Transfer-Encoding: base64",
      "",
      png.toString("base64"),
      "--R--",
      "--M",
      'Content-Type: application/pdf; name="__QA X-100 sizes.pdf"',
      'Content-Disposition: attachment; filename="__QA X-100 sizes.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      sheet.toString("base64"),
      "--M",
      "Content-Type: message/rfc822",
      "Content-Disposition: attachment",
      "",
      forward,
      "--M--",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

/**
 * What Graph says about the same three, in GRAPH's order and in Graph's
 * terms: the forward is an `itemAttachment` with no content type, named by
 * its subject; the image is flagged inline; every size is Graph's own count.
 */
const GRAPH_LISTING = [
  {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: "__QA X-100 sizes.pdf",
    contentType: "application/pdf",
    size: 4211,
  },
  { "@odata.type": "#microsoft.graph.itemAttachment", name: "RE: __QA Seat heights", size: 9874 },
  {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: "image001.png",
    contentType: "image/png",
    size: 2310,
    isInline: true,
  },
];

describeIfDb("a Graph arrival's attachments", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Graph attachments', 'qa', 'qa') returning id`,
        [qaNumber("P90420")],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    const messages = await client.query(`select id from email_messages where mailbox = $1`, [MAILBOX]);
    const ids = messages.rows.map((row) => String(row.id));
    await client.query(`delete from email_messages where mailbox = $1`, [MAILBOX]);
    if (projectId) {
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where storage_path like $1`, [`projects/${projectId}/%`]);
    }
    if (ids.length > 0) {
      await client.query(`delete from attachments where entity_type = 'email_messages' and entity_id = any($1::uuid[])`, [ids]);
    }
    if (projectId) await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("are listed as the stored bytes read, so each Download serves the file listed — the forwarded item and the inline image included", async () => {
    const graphMessageId = `__qa_graph_attach_${QA_RUN_SUFFIX}`;
    inflight.internetMessageId = `<__qa.graph.attach.${QA_RUN_SUFFIX}@example.test>`;
    inflight.mime = mime(inflight.internetMessageId);
    inflight.graphListing = GRAPH_LISTING;

    const { ingestGraphMessage } = await import("@/lib/mail-ingest");
    const outcome = await ingestGraphMessage({
      kind: "mail-ingest",
      mailbox: MAILBOX,
      graphMessageId,
      source: "notification",
      requestedBy: "system:microsoft-graph",
    });
    expect(outcome).toEqual(expect.objectContaining({ outcome: "stored", assigned: false }));
    const messageId = String((outcome as { messageId: string }).messageId);

    const row = (
      await client.query(`select attachments_meta, has_attachments from email_messages where id = $1`, [messageId])
    ).rows[0] as { attachments_meta: { filename: string | null; contentType: string; size: number; isRfc822: boolean }[]; has_attachments: boolean };
    expect(row.has_attachments).toBe(true);
    const listed = row.attachments_meta;
    expect(listed).toHaveLength(3);
    expect(listed.filter((entry) => entry.isRfc822)).toHaveLength(1);

    // Joined to a run on the project, as `assignMessage` joins it: the .eml
    // copied under the project, an attachment row, an email run.
    const storagePath = `projects/${projectId}/uploads/__qa-graph-${QA_RUN_SUFFIX}.eml`;
    store.files.set(storagePath, new Uint8Array(inflight.mime));
    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
       values ('email_messages', $1, 'mime', $2, '__QA FW X-100 sizes.eml', 'message/rfc822', $3, 'qa') returning id`,
      [messageId, storagePath, inflight.mime.byteLength],
    );
    const run = await client.query(
      `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, $2, 'spec_document', 'email', 'parsed', 'qa', 'qa') returning id`,
      [projectId, attachment.rows[0].id],
    );
    const runId = String(run.rows[0].id);
    await client.query(
      `update email_messages
          set project_id = $2, intake_run_id = $3, routing_status = 'assigned',
              assigned_by = 'qa', assigned_at = now(), assignment_kind = 'manual', updated_by = 'qa'
        where id = $1`,
      [messageId, projectId, runId],
    );

    const expected = new Map<string, Buffer>([
      ["application/pdf", sheet],
      ["image/png", png],
      ["message/rfc822", Buffer.from(forward, "utf8")],
    ]);
    const { GET } = await import("@/app/api/imports/[id]/attachments/[index]/route");
    for (const [index, entry] of listed.entries()) {
      const res = await GET(new Request("http://localhost/test"), {
        params: Promise.resolve({ id: runId, index: String(index) }),
      });
      const body = Buffer.from(await res.arrayBuffer());
      expect(res.status, `${index}: ${body.toString("utf8").slice(0, 200)}`).toBe(200);
      // The file sent is the file listed at the index clicked.
      expect(res.headers.get("content-type"), String(index)).toBe(entry.contentType);
      expect(body.byteLength, String(index)).toBe(entry.size);
      const wanted = expected.get(entry.contentType)!;
      expect(body.toString("latin1").trimEnd(), String(index)).toBe(wanted.toString("latin1").trimEnd());
    }
  });
});
