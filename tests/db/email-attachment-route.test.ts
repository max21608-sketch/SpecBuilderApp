// Database tier — one attachment out of a stored email, through the REAL route.
//
// Stage 2 variance row 4 (plan §6.10.c). Skips silently without DATABASE_URL:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run tests/db/email-attachment-route.test.ts
//
// ============================================================================
// WHAT IS WORTH PROVING HERE RATHER THAN IN A PURE TEST
//
// The pathname is resolved from the RUN'S OWN attachment row and re-checked
// against the run's project prefix — `blob-source.ts`'s rule — so the claims
// that need a database are the ones about which run the caller named: that a
// signed-out caller gets nothing, that a run that is not an email is not
// answered for, and that an index the message does not have is refused rather
// than guessed at.
//
// THE STORE IS MOCKED AND NOTHING IS DISPATCHED. There is no blob in a test
// environment, and there must be no model call: the route registers nothing,
// opens no attempt and publishes nothing, which is the point of it being a
// read. The .eml is four lines of invented multipart.
//
// Rows are prefixed `__QA ` and deleted FK-safe.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => signedIn.value,
}));

const signedIn = vi.hoisted(() => ({
  value: null as null | { id: string; email: string; name: string; role: string },
}));

const store = vi.hoisted(() => ({ bytes: new Uint8Array() }));

vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    // The scoping rules themselves are `blob-source.test.ts`'s job; what this
    // stands in for is the store, which a test environment has none of.
    readTrustedBlob: async (pathname: string, projectId: string) => {
      actual.assertProjectScopedPathname(pathname, projectId);
      const bytes = Buffer.from(store.bytes);
      return { bytes, contentType: "message/rfc822", size: bytes.byteLength, pathname };
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string, index: string) => ({ params: Promise.resolve({ id, index }) });
const request = () => new Request("http://localhost/test");

const sheet = Buffer.from("%PDF-1.7 invented sizes sheet", "utf8");

function eml(): Buffer {
  return Buffer.from(
    [
      "From: Jane Doe <jane@designers.test>",
      "To: Project Panther <p17726@benwhistler.test>",
      "Subject: __QA X-100 - sizes attached",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="B1"',
      "",
      "--B1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Sizes are in the attached sheet.",
      "--B1",
      'Content-Type: application/pdf; name="__QA X-100 sizes.pdf"',
      'Content-Disposition: attachment; filename="__QA X-100 sizes.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      sheet.toString("base64"),
      "--B1--",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

describeIfDb("the email attachment route", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let emailRunId = "";
  let pdfRunId = "";

  beforeAll(async () => {
    store.bytes = new Uint8Array(eml());
    signedIn.value = {
      id: "00000000-0000-0000-0000-000000000001",
      email: "__qa@example.test",
      name: "QA User",
      role: "admin",
    };
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ('${qaNumber("P90044")}', '__QA Attachments', '__QA Example Client', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;

    const make = async (kind: string, filename: string, contentType: string) => {
      const attachment = await client.query(
        `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
         values ('email_messages', gen_random_uuid(), 'mime', $1, $2, $3, 2048, 'qa') returning id`,
        [`projects/${projectId}/uploads/__qa-${kind}`, filename, contentType],
      );
      const run = await client.query(
        `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, $2, 'spec_document', $3, 'parsed', 'qa', 'qa') returning id`,
        [projectId, attachment.rows[0].id, kind],
      );
      return String(run.rows[0].id);
    };
    emailRunId = await make("email", "__QA reply.eml", "message/rfc822");
    pdfRunId = await make("shop_drawings", "__QA S-100.pdf", "application/pdf");
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from attachments where storage_path like $1`, [`projects/${projectId}/%`]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("hands back the attachment's own bytes, as a download and never inline", async () => {
    const { GET } = await import("@/app/api/imports/[id]/attachments/[index]/route");
    const response = await GET(request(), params(emailRunId, "0"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    // NEVER inline. An attachment is bytes somebody outside the company chose,
    // and a browser rendering it is this app showing a stranger's file as its
    // own — the same rule the .eml download follows.
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-disposition")).toContain("__QA X-100 sizes.pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer()).equals(sheet)).toBe(true);
  });

  it("registers nothing and spends nothing", async () => {
    // A read. If this ever opened a run or an attempt it would be a charged
    // model call behind a download link.
    const counts = `select count(*)::int as runs,
                           count(attempt_id)::int as attempts,
                           count(*) filter (where status <> 'parsed')::int as moved
                    from intake_runs where project_id = $1`;
    const before = await client.query(counts, [projectId]);
    const { GET } = await import("@/app/api/imports/[id]/attachments/[index]/route");
    await GET(request(), params(emailRunId, "0"));
    const after = await client.query(counts, [projectId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("refuses an index the message does not carry, and a nonsense one", async () => {
    const { GET } = await import("@/app/api/imports/[id]/attachments/[index]/route");
    expect((await GET(request(), params(emailRunId, "7"))).status).toBe(404);
    expect((await GET(request(), params(emailRunId, "-1"))).status).toBe(400);
    expect((await GET(request(), params(emailRunId, "one"))).status).toBe(400);
  });

  it("answers only for an email, and only for a signed-in caller", async () => {
    const { GET } = await import("@/app/api/imports/[id]/attachments/[index]/route");
    // A PDF's own embedded files are not something this app has ever read, and
    // answering for one here would be a second meaning for the same URL.
    expect((await GET(request(), params(pdfRunId, "0"))).status).toBe(404);
    expect((await GET(request(), params("00000000-0000-0000-0000-0000000000ff", "0"))).status).toBe(404);

    signedIn.value = null;
    try {
      expect((await GET(request(), params(emailRunId, "0"))).status).toBe(401);
    } finally {
      signedIn.value = {
        id: "00000000-0000-0000-0000-000000000001",
        email: "__qa@example.test",
        name: "QA User",
        role: "admin",
      };
    }
  });
});
