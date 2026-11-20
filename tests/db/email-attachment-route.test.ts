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
// THE LIST A PERSON CLICKS IS THE ONE STORED AT REGISTRATION (2026-11-20).
// Each email run has its `email_messages` row with the `attachments_meta` the
// screen renders, and one of them holds what postal-mime 3.0.0 recorded for a
// message 4.2.1 reads differently: a base64 forward with no disposition, which
// 3.0.0 rendered into the body and 4.2.1 lists first, so index 0 is the PDF on
// the screen and the forward in a fresh parse.
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

const store = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }));

vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    // The scoping rules themselves are `blob-source.test.ts`'s job; what this
    // stands in for is the store, which a test environment has none of.
    readTrustedBlob: async (pathname: string, projectId: string) => {
      actual.assertProjectScopedPathname(pathname, projectId);
      const bytes = Buffer.from(store.files.get(pathname) ?? new Uint8Array());
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

/**
 * The same sheet, after a forward that is base64 with no Content-Disposition.
 * postal-mime 3.0.0 rendered that forward into the body and listed ONE
 * attachment, the sheet; 4.2.1 lists the forward first. Invented throughout.
 */
function emlWithEncodedForward(): Buffer {
  const forward = ["From: __qa-client@example.test", "Subject: __QA the original", "", "The seat height is 450mm.", ""].join(
    "\r\n",
  );
  return Buffer.from(
    [
      "From: Jane Doe <jane@designers.test>",
      "To: Project Panther <p17726@benwhistler.test>",
      "Subject: __QA FW: X-100 - sizes attached",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="B2"',
      "",
      "--B2",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "See below, and the sheet.",
      "--B2",
      "Content-Type: message/rfc822",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(forward, "utf8").toString("base64"),
      "--B2",
      'Content-Type: application/pdf; name="__QA X-100 sizes.pdf"',
      'Content-Disposition: attachment; filename="__QA X-100 sizes.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      sheet.toString("base64"),
      "--B2--",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

/** What registration stored for the sheet: `parseEnvelope`'s own entry. */
const sheetListed = { filename: "__QA X-100 sizes.pdf", contentType: "application/pdf", size: sheet.byteLength, isRfc822: false };

describeIfDb("the email attachment route", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let emailRunId = "";
  let pdfRunId = "";
  let movedRunId = "";
  let unlinkedRunId = "";
  const mailbox = `__qa-attachments-${qaNumber("P90044")}@example.test`.replace(/\s+/g, "-");

  beforeAll(async () => {
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

    const make = async (kind: string, slug: string, filename: string, contentType: string, bytes?: Buffer) => {
      const storagePath = `projects/${projectId}/uploads/__qa-${slug}`;
      if (bytes) store.files.set(storagePath, new Uint8Array(bytes));
      const attachment = await client.query(
        `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
         values ('email_messages', gen_random_uuid(), 'mime', $1, $2, $3, 2048, 'qa') returning id`,
        [storagePath, filename, contentType],
      );
      const run = await client.query(
        `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, $2, 'spec_document', $3, 'parsed', 'qa', 'qa') returning id`,
        [projectId, attachment.rows[0].id, kind],
      );
      return String(run.rows[0].id);
    };
    // The message row the screen lists the attachments from, as registration
    // writes it for an upload.
    const message = (runId: string, listed: unknown[]) =>
      client.query(
        `insert into email_messages (mailbox, origin, subject, routing_status, project_id, intake_run_id,
                                     assigned_by, assigned_at, assignment_kind, has_attachments, attachments_meta,
                                     created_by, updated_by)
         values ($1, 'upload', '__QA X-100 - sizes attached', 'assigned', $2, $3,
                 'qa', now(), 'manual', true, $4::jsonb, 'qa', 'qa')`,
        [mailbox, projectId, runId, JSON.stringify(listed)],
      );
    emailRunId = await make("email", "reply", "__QA reply.eml", "message/rfc822", eml());
    await message(emailRunId, [sheetListed]);
    pdfRunId = await make("shop_drawings", "s100", "__QA S-100.pdf", "application/pdf");
    movedRunId = await make("email", "moved", "__QA forward.eml", "message/rfc822", emlWithEncodedForward());
    // What postal-mime 3.0.0 recorded for that message: the sheet alone, at 0.
    await message(movedRunId, [sheetListed]);
    // An email run whose message was taken off this project: no row joins it.
    unlinkedRunId = await make("email", "unlinked", "__QA unlinked.eml", "message/rfc822", eml());
  });

  afterAll(async () => {
    await client.query(`delete from email_messages where mailbox = $1`, [mailbox]);
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
    // The real name travels in filename*, percent-encoded (audit A6); the
    // plain filename is the ASCII fallback.
    expect(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "")).toBe(
      "__QA X-100 sizes.pdf",
    );
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

  it("refuses an attachment that reads differently now from the list the screen showed, rather than send another file", async () => {
    // Index 0 on the screen is the sheet; in a fresh parse it is the forward.
    // Sending what the fresh parse holds at 0 would save the forwarded email
    // under the name of the sheet the person clicked.
    const { GET } = await import("@/app/api/imports/[id]/attachments/[index]/route");
    const response = await GET(request(), params(movedRunId, "0"));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { ok: boolean; code: string; error: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("attachment_changed");
    expect(body.error).toContain("open the .eml");
    // The index past the stored list is refused before anything is read.
    expect((await GET(request(), params(movedRunId, "1"))).status).toBe(404);
  });

  it("answers for an email only through the message the screen listed it from", async () => {
    const { GET } = await import("@/app/api/imports/[id]/attachments/[index]/route");
    const response = await GET(request(), params(unlinkedRunId, "0"));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe("email_not_on_document");
  });
});
