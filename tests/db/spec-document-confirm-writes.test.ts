// Database tier — what a specification-document confirm writes onto a spec it
// shares with another document: the slot that filled since staging (E2), the
// finish code the library already holds (E3), and the pointer from a replaced
// spec to its replacement (E4).
//
// Skips silently without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/spec-document-confirm-writes.test.ts
//
// Every case here was written against the confirm as it stood at 2cb4630 and
// failed on it: E2 as a 500 ("Nothing was written. Check the logs."), E3 as a
// finish attribute with no `finish_id`, E4 as a retired row pointing nowhere.
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { Proposal, StagedSpecDocument } from "@/lib/spec-document";
import { normaliseFinishCode } from "@/lib/finishes";

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
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("a specification-document confirm over specs another document holds", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let categoryId = "";
  let recordId = "";
  let specRunId = "";
  let firstRunId = "";
  let secondRunId = "";
  let com1FieldId = "";

  async function scheduleRun(name: string): Promise<string> {
    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
       values ('project', $1, 'spec_document', $2, $3, 'application/pdf', 512, 'qa') returning id`,
      [projectId, `projects/${projectId}/${randomUUID()}.pdf`, name],
    );
    const run = await client.query(
      `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, $2, 'spec_document', 'ffe_schedule', 'parsed', 'qa', 'qa') returning id`,
      [projectId, attachment.rows[0].id],
    );
    return String(run.rows[0].id);
  }

  beforeAll(async () => {
    await client.connect();
    const category = await client.query(
      `select q.category_id from requirements q
         join spec_fields f on f.id = q.spec_field_id
        where f.json_id = 3
          and exists (select 1 from requirements c join spec_fields cf on cf.id = c.spec_field_id
                       where c.category_id = q.category_id and cf.json_id = 1)
        order by q.category_id limit 1`,
    );
    categoryId = String(category.rows[0].category_id);
    com1FieldId = String((await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id);

    projectId = String(
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber("P90051")}', '__QA Spec-document confirm writes', 'qa', 'qa') returning id`,
        )
      ).rows[0].id,
    );
    specRunId = String(
      (
        await client.query(
          `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main run', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
    firstRunId = await scheduleRun("__QA schedule A.pdf");
    secondRunId = await scheduleRun("__QA schedule B.pdf");
  });

  afterAll(async () => {
    if (!projectId) {
      await client.end();
      return;
    }
    await client.query(`delete from status_history where entity_type = 'intake_run' and entity_id = any($1::uuid[])`, [
      [firstRunId, secondRunId].filter(Boolean),
    ]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
    await client.query(`delete from attachments where entity_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  beforeEach(async () => {
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
    recordId = String(
      (
        await client.query(
          `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
           values ($1, $2, 9401, 'active', $3, '__QA Armchair', 'qa', 'qa') returning id`,
          [projectId, specRunId, categoryId],
        )
      ).rows[0].id,
    );
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, revision_no, state, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 0, 'missing', 'qa', 'qa' from requirements q where q.category_id = $2`,
      [recordId, categoryId],
    );
  });

  function base(overrides: Partial<Proposal>): Proposal {
    return {
      id: randomUUID(),
      sourceOrdinal: 0,
      runId: specRunId,
      runName: "__QA Main run",
      recordLabel: "__QA-9401",
      attributeTarget: null,
      version: 1,
      raw: { refRaw: "__QAS201", attributeRaw: "Seat height", valueRaw: "440mm", page: 3, sourceSheet: null, sourceRow: null, confidence: "high", note: null },
      recordCandidates: [],
      requirementCandidates: [],
      recordId,
      requirementId: null,
      target: null,
      proposedValue: null,
      proposedState: "confirmed",
      stateReason: null,
      overwriteAcknowledged: false,
      reviewStatus: "pending",
      reviewedAt: null,
      reviewedBy: null,
      applied: null,
      ...overrides,
    } as Proposal;
  }

  const seatHeight = (figure: string) =>
    base({
      dimension: { slot: "SH", figure, unit: "mm", unitSource: "stated", slotSuggested: false, qualifier: null, tbc: false },
      proposedValue: figure,
    });

  const fabric = (code: string, value: string, overrides: Partial<Proposal> = {}) =>
    base({
      finish: {
        group: "material",
        specFieldId: com1FieldId,
        specFieldName: "COM 1",
        codeRaw: code,
        value,
        tbc: false,
        reason: null,
      },
      raw: { refRaw: "__QAS201", attributeRaw: "Fabric", valueRaw: value, page: 4, sourceSheet: null, sourceRow: null, confidence: "high", note: null },
      proposedValue: value,
      ...overrides,
    });

  async function stage(runId: string, lines: Proposal[]) {
    const staged: StagedSpecDocument = { schemaVersion: 1, lines, documentNotes: null, filename: "__QA schedule.pdf" };
    await client.query(`update intake_runs set status = 'parsed', parsed = $2 where id = $1`, [runId, JSON.stringify(staged)]);
  }

  async function confirm(runId: string, lines: Proposal[]) {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(
      post({ action: "confirm", recordId, proposals: lines.map((line) => ({ id: line.id, version: line.version })) }),
      params(runId),
    );
  }

  async function finish(code: string, description: string): Promise<string> {
    return String(
      (
        await client.query(
          `insert into project_finishes (project_id, code, code_norm, description, state, created_by, updated_by)
           values ($1, $2, $3, $4, 'confirmed', 'qa', 'qa') returning id`,
          [projectId, code, normaliseFinishCode(code), description],
        )
      ).rows[0].id,
    );
  }

  it("refuses, in words, a slot another document filled after this one was read (E2)", async () => {
    // Two schedules read in parallel, both free to give the seat height.
    const first = [seatHeight("440")];
    const second = [seatHeight("450")];
    await stage(firstRunId, first);
    await stage(secondRunId, second);

    expect((await confirm(firstRunId, first)).status).toBe(200);

    const res = await confirm(secondRunId, second);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("slot_filled");
    expect(String(body.error)).toMatch(/Another document now holds/);

    // Nothing written: one SH, the first schedule's, and the second's row
    // still pending for the reviewer to re-match.
    const held = await client.query(
      `select value, source_run_id from record_attributes where record_id = $1 and dimension_slot = 'SH' and status = 'active'`,
      [recordId],
    );
    expect(held.rows).toEqual([{ value: "440", source_run_id: firstRunId }]);
    const staged = (await client.query(`select status, parsed from intake_runs where id = $1`, [secondRunId])).rows[0];
    expect(staged.status).toBe("parsed");
    expect(staged.parsed.lines[0].reviewStatus).toBe("pending");
  });

  it("links a finish whose code the library already holds, and leaves a conflicting one unlinked (E3)", async () => {
    const libraryId = await finish("__QA-FAB-07", "__QA Mohair Slate");
    const matched = [fabric("__QA-FAB-07", "__QA-FAB-07 __QA Mohair Slate")];
    await stage(firstRunId, matched);
    expect((await confirm(firstRunId, matched)).status).toBe(200);
    const linked = await client.query(
      `select finish_id from record_attributes where record_id = $1 and spec_field_id = $2 and status = 'active'`,
      [recordId, com1FieldId],
    );
    expect(linked.rows[0]?.finish_id).toBe(libraryId);

    // A code the library has committed to OTHER words links nothing (the
    // CONFLICT rule): linking would make the item render the library's words
    // while this document said something else. And nothing is created.
    await client.query(`delete from spec_records where id = $1`, [recordId]);
    recordId = String(
      (
        await client.query(
          `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
           values ($1, $2, 9402, 'active', $3, '__QA Armchair two', 'qa', 'qa') returning id`,
          [projectId, specRunId, categoryId],
        )
      ).rows[0].id,
    );
    const conflicting = [fabric("__QA-FAB-07", "__QA-FAB-07 __QA Velvet Plum"), fabric("__QA-FAB-99", "__QA-FAB-99 __QA Linen")];
    // The second claims COM 2 so the two do not clash on one field.
    const com2FieldId = String((await client.query(`select id from spec_fields where json_id = 2`)).rows[0].id);
    conflicting[1] = { ...conflicting[1]!, finish: { ...conflicting[1]!.finish!, specFieldId: com2FieldId, specFieldName: "COM 2" } };
    await stage(secondRunId, conflicting);
    expect((await confirm(secondRunId, conflicting)).status).toBe(200);
    const unlinked = await client.query(
      `select material_code, finish_id from record_attributes where record_id = $1 and attr_group = 'material' order by material_code`,
      [recordId],
    );
    expect(unlinked.rows).toEqual([
      { material_code: "__QA-FAB-07", finish_id: null },
      { material_code: "__QA-FAB-99", finish_id: null },
    ]);
    const library = await client.query(`select code from project_finishes where project_id = $1 order by code`, [projectId]);
    expect(library.rows.map((row) => row.code)).toEqual(["__QA-FAB-07"]);
  });

  it("points a replaced spec at the one that replaced it (E4)", async () => {
    const first = [seatHeight("440")];
    await stage(firstRunId, first);
    expect((await confirm(firstRunId, first)).status).toBe(200);
    const held = (
      await client.query(
        `select id, version, value, unit, label, state from record_attributes where record_id = $1 and dimension_slot = 'SH' and status = 'active'`,
        [recordId],
      )
    ).rows[0];

    // Not the bill's, and different: the ordinary replace tick.
    const second = [
      {
        ...seatHeight("460"),
        overwriteAcknowledged: true,
        attributeTarget: {
          attributeId: String(held.id),
          attributeVersion: Number(held.version),
          label: String(held.label),
          value: String(held.value),
          unit: "mm" as const,
          attrGroup: "dimension" as const,
          state: "confirmed" as const,
          fromBill: false,
        },
      },
    ];
    await stage(secondRunId, second);
    expect((await confirm(secondRunId, second)).status).toBe(200);

    const rows = await client.query(
      `select id, value, status, superseded_by_id from record_attributes where record_id = $1 and dimension_slot = 'SH' order by status`,
      [recordId],
    );
    const active = rows.rows.find((row) => row.status === "active");
    const retired = rows.rows.find((row) => row.status === "retired");
    expect(active?.value).toBe("460");
    expect(retired?.value).toBe("440");
    expect(retired?.superseded_by_id).toBe(active?.id);
  });
});
