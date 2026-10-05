// Database tier — the tracker's furniture rows reach the bill's line items,
// and a value that disagrees with the BILL is kept beside it (2026-10-05).
//
// Skips silently without DATABASE_URL. Run against the local stack with:
//   node ~/dev/localstack/one-db-test.mjs tests/db/tracker-intake.test.ts
//
// ============================================================================
// WHAT THE PURE TIER CANNOT PROVE.
//
//   * "Also read its furniture": a finishes schedule's own file registered a
//     second time as an FF&E schedule, in the same pack, through the one
//     registration protocol — and a second press returns the run it made.
//   * The worker resolves the read against the live registers, so a bill's
//     own values arrive marked as the bill's (`attribute-from-bill.ts`), and
//     a zone list lands on GR-FUR-04 and PL-FUR-04 with MUR named.
//   * The confirm, in its own transaction: a width that differs from the
//     bill's leaves the bill's ACTIVE and records ONE open disagreement; the
//     same fabric writes nothing; a statement no question matches becomes a
//     note; the bill's "Model Ref" disagreeing is a disagreement too; "use
//     this document's instead" retires the bill's; a card that only agrees
//     takes no version and opens no change.
//   * Re-confirming the same statement, and re-matching, never stacks a
//     second open disagreement.
//
// The MODEL IS STUBBED and nothing is charged. Every code is shaped like the
// Aman bill's (the shape is the point) on a `__QA` project that takes its
// changes with it.
// ============================================================================
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import type { Proposal, StagedSpecDocument } from "@/lib/spec-document";
import type { RawProposal } from "@/lib/extraction-schema";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    readTrustedBlob: async (pathname: string) => ({
      bytes: Buffer.from("__QA"),
      contentType: "application/pdf",
      size: 4,
      pathname,
    }),
    headTrustedBlob: async (pathname: string) => ({ pathname, contentType: "application/pdf", size: 4 }),
  };
});

vi.mock("@/lib/intake-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intake-source")>();
  return { ...actual, prepareDocumentSource: async () => ({ type: "pdf" as const, base64: "X" }) };
});

/** What the stubbed read "finds" on the tracker's furniture pages. */
const tracker = vi.hoisted(() => ({ proposals: [] as unknown[], calls: 0 }));
vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...actual,
    extractSpecDocument: async () => {
      tracker.calls += 1;
      return {
        ok: true,
        output: { outputKind: "observations", data: { proposals: tracker.proposals, documentNotes: null } },
        model: "__qa-model",
        rawResponse: { __qa: true },
        usage: { input_tokens: 1, output_tokens: 1 },
        requestId: "req___qa_tracker",
        elapsedMs: 1,
      };
    },
  };
});

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

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown, method = "POST") =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function observation(overrides: Partial<RawProposal>): RawProposal {
  return {
    refRaw: "GR-FUR-04",
    attributeRaw: "Size",
    valueRaw: "W540 x D610 x SH430 mm",
    page: 9,
    sourceSheet: null,
    sourceRow: null,
    confidence: "high",
    note: null,
    ...overrides,
  };
}

describeIfDb("the tracker's furniture against the bill", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let batchId = "";
  let phaseId = "";
  let billRunId = "";
  let finishesRunId = "";
  let furnitureRunId = "";
  let categoryId = "";
  let com1 = "";
  let gr04 = "";
  let pl04 = "";
  let billWidth = "";
  let billFabric = "";
  let billModel = "";

  async function line(code: string, recordNo: number): Promise<string> {
    const recordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, qty, category_id, created_by, updated_by)
         values ($1, $2, $3, 'active', '__QA Desk chair', 2, $4, 'qa', 'qa') returning id`,
        [projectId, phaseId, recordNo, categoryId],
      )
    ).rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [recordId, projectId, code],
    );
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, revision_no, state, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 0, 'missing', 'qa', 'qa' from requirements q where q.category_id = $2`,
      [recordId, categoryId],
    );
    return recordId;
  }

  async function billAttribute(recordId: string, row: Record<string, unknown>): Promise<string> {
    return (
      await client.query(
        `insert into record_attributes
           (record_id, attr_group, dimension_slot, label, value, unit, material_code, spec_field_id, state,
            source_run_id, sort_order, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, 1, 'qa', 'qa') returning id`,
        [recordId, row.group, row.slot ?? null, row.label, row.value, row.unit ?? null, row.code ?? null, row.field ?? null, billRunId],
      )
    ).rows[0].id;
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA tracker intake', 'qa', 'qa') returning id`,
        [qaNumber("P90461")],
      )
    ).rows[0].id;
    batchId = (
      await client.query(
        `insert into intake_batches (project_id, label, created_by, updated_by) values ($1, '__QA pack', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    phaseId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA CASEGOODS+SEATING+TABLES', 0, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    billRunId = (
      await client.query(
        `insert into intake_runs (project_id, batch_id, source_kind, status, created_by, updated_by)
         values ($1, $2, 'boq_xlsx', 'confirmed', 'qa', 'qa') returning id`,
        [projectId, batchId],
      )
    ).rows[0].id;
    // A category that asks Dimensions AND COM 1, so both the composed cell and
    // the fabric's answer are part of what is proved.
    categoryId = (
      await client.query(
        `select c.id from item_categories c
         where exists (select 1 from requirements q join spec_fields f on f.id = q.spec_field_id
                       where q.category_id = c.id and f.json_id = 3)
           and exists (select 1 from requirements q join spec_fields f on f.id = q.spec_field_id
                       where q.category_id = c.id and f.json_id = 1)
         order by c.sort_order limit 1`,
      )
    ).rows[0].id;
    com1 = (await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id;

    gr04 = await line("GR-FUR-04", 9461);
    pl04 = await line("PL-FUR-04", 9462);
    // What the bill said about GR-FUR-04: bespoke, W21", the fabric FAB-01.
    billWidth = await billAttribute(gr04, { group: "dimension", slot: "W", label: "Sizes (ft-in)", value: '21"', unit: "in" });
    billFabric = await billAttribute(gr04, { group: "material", label: "Fabric", value: "FAB-01 Smoked velvet", code: "FAB-01", field: com1 });
    billModel = await billAttribute(gr04, { group: "note", label: "Model Ref:", value: "Bespoke" });

    const attachmentId = (
      await client.query(
        `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
         values ('project', $1, 'spec_document', $2, '__QA OMS and FF&E Tracker.pdf', 'application/pdf', 4, 'qa') returning id`,
        [projectId, `projects/${projectId}/__qa-tracker.pdf`],
      )
    ).rows[0].id;
    finishesRunId = (
      await client.query(
        `insert into intake_runs (project_id, batch_id, attachment_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, $2, $3, 'spec_document', 'finishes_schedule', 'parsed', 'qa', 'qa') returning id`,
        [projectId, batchId, attachmentId],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      const records = `select id from spec_records where project_id = $1`;
      await client.query(`delete from attribute_disagreements where project_id = $1`, [projectId]);
      await client.query(`update record_attributes set finish_id = null, superseded_by_id = null where record_id in (${records})`, [projectId]);
      await client.query(`delete from record_attributes where record_id in (${records})`, [projectId]);
      await client.query(`delete from spec_answers where record_id in (${records})`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_id = $1`, [projectId]);
      await client.query(`delete from intake_batches where project_id = $1`, [projectId]);
      // Deleting the project cascades the change sets, versions and records.
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  const staged = async (runId: string): Promise<StagedSpecDocument> =>
    (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedSpecDocument;
  const active = async (recordId: string) =>
    (
      await client.query(
        `select id, attr_group, dimension_slot, label, value, unit, source_run_id, source_page
           from record_attributes where record_id = $1 and status = 'active' order by sort_order, created_at`,
        [recordId],
      )
    ).rows;
  const openDisagreements = async () =>
    (
      await client.query(
        `select id, record_id, held_attribute_id, source_run_id, source_page, attr_group, dimension_slot, label, value, unit, status, change_set_id
           from attribute_disagreements where project_id = $1 and status = 'open' order by created_at, label`,
        [projectId],
      )
    ).rows;
  const versions = async (recordId: string) =>
    Number((await client.query(`select count(*) as n from record_snapshots where record_id = $1`, [recordId])).rows[0].n);

  async function confirm(runId: string, recordId: string): Promise<Response> {
    const lines = (await staged(runId)).lines.filter((line) => line.reviewStatus === "pending" && line.recordId === recordId);
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(
      request({ action: "confirm", recordId, proposals: lines.map((line) => ({ id: line.id, version: line.version })) }),
      params(runId),
    );
  }

  /** A fresh ffe run staged straight from observations, resolved exactly as the worker resolves one. */
  async function stagedRun(observations: RawProposal[]): Promise<string> {
    const runId = (
      await client.query(
        `insert into intake_runs (project_id, batch_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, $2, 'spec_document', 'ffe_schedule', 'parsed', 'qa', 'qa') returning id`,
        [projectId, batchId],
      )
    ).rows[0].id;
    const { loadExtractionRegisters } = await import("@/lib/spec-document-registers");
    const { resolveProposals } = await import("@/lib/spec-document");
    const { randomUUID } = await import("node:crypto");
    const registers = await loadExtractionRegisters(projectId, { intakeRunId: runId });
    const document: StagedSpecDocument = {
      schemaVersion: 1,
      lines: resolveProposals(observations, registers, randomUUID),
      documentNotes: null,
      filename: "__QA tracker.pdf",
    };
    await client.query(`update intake_runs set parsed = $2 where id = $1`, [runId, JSON.stringify(document)]);
    return runId;
  }

  it("reads a finishes schedule's furniture as an FF&E schedule, once, over the same file in the same pack", async () => {
    const { POST } = await import("@/app/api/imports/[id]/read-furniture/route");
    const res = await POST(request({}), params(finishesRunId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { importId: string; autoRead: { dispatched: boolean } };
    furnitureRunId = body.importId;
    expect(body.autoRead.dispatched).toBe(true);
    expect(published).toEqual([furnitureRunId]);

    const [created, finishes] = (
      await client.query(
        `select id, document_kind, attachment_id, batch_id, registration_request_id, attempt_id
           from intake_runs where id = any($1::uuid[]) order by (id = $2) desc`,
        [[furnitureRunId, finishesRunId], furnitureRunId],
      )
    ).rows;
    expect(created.document_kind).toBe("ffe_schedule");
    expect(created.attachment_id).toBe(finishes.attachment_id);
    expect(created.batch_id).toBe(batchId);
    expect(created.registration_request_id).toBe(`ffe-of:${finishesRunId}`);

    // A second press returns the run the first one made, and publishes nothing.
    const again = await POST(request({}), params(finishesRunId));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ importId: furnitureRunId, reused: true });
    expect(published).toHaveLength(1);

    // The finishes review now links to it rather than offering the button.
    const { GET } = await import("@/app/api/imports/[id]/route");
    const review = (await (await GET(new Request("http://localhost/test"), params(finishesRunId))).json()) as {
      furnitureRunId: string | null;
    };
    expect(review.furnitureRunId).toBe(furnitureRunId);

    // Something other than a finishes schedule is refused.
    const wrong = await POST(request({}), params(billRunId));
    expect(wrong.status).toBe(400);
  });

  it("lands a zone list on each line it names, names the one with no line, and marks the bill's values", async () => {
    tracker.proposals = [
      observation({ refRaw: "GR / MUR / PL FUR04" }),
      observation({ refRaw: "GR / MUR / PL FUR04", attributeRaw: "Fabric", valueRaw: "FAB-01" }),
      observation({ refRaw: "GR / MUR / PL FUR04", attributeRaw: "Model ref", valueRaw: "WEWOOD — Caravela" }),
      observation({ refRaw: "GR / MUR / PL FUR04", attributeRaw: "Supplier", valueRaw: "WEWOOD, Porto — sales@example.test" }),
    ];
    const attemptId = (await client.query(`select attempt_id from intake_runs where id = $1`, [furnitureRunId])).rows[0].attempt_id;
    const { runDocumentExtraction } = await import("@/lib/extraction-run");
    const outcome = await runDocumentExtraction({ extractionId: furnitureRunId, attemptId: String(attemptId), actor: "__qa" });
    expect(outcome).toEqual({ outcome: "parsed" });
    expect(tracker.calls).toBe(1);

    const lines = (await staged(furnitureRunId)).lines;
    expect(new Set(lines.map((line) => line.recordId))).toEqual(new Set([gr04, pl04]));
    expect(lines.every((line) => /MUR-FUR04 — no line on the bill/.test(line.readingNote ?? ""))).toBe(true);
    const grWidth = lines.find((line) => line.recordId === gr04 && line.dimension?.slot === "W")!;
    expect(grWidth.attributeTarget).toMatchObject({ attributeId: billWidth, fromBill: true });
    // PL-FUR-04 has no bill note, so both statements are plain notes there.
    const plNotes = lines.filter((line) => line.recordId === pl04 && line.note);
    expect(plNotes.map((line) => line.note?.label)).toEqual(["Model ref", "Supplier"]);
    expect(plNotes.every((line) => !line.attributeTarget)).toBe(true);

    // The review GET reads the same comparison off the live registers.
    const { GET } = await import("@/app/api/imports/[id]/route");
    const body = (await (await GET(new Request("http://localhost/test"), params(furnitureRunId))).json()) as {
      import: { parsed: StagedSpecDocument };
    };
    const shown = body.import.parsed.lines.find((line) => line.id === grWidth.id)!;
    expect(shown.attributeTarget?.fromBill).toBe(true);
    expect(shown.attributeTarget?.state).toBe("confirmed");
  });

  it("keeps the bill's width and model beside the tracker's, writes the rest, and the same fabric writes nothing", async () => {
    const before = await versions(gr04);
    const res = await confirm(furnitureRunId, gr04);
    expect(res.status, await res.clone().text()).toBe(200);

    const held = await active(gr04);
    // The bill's three rows are all still the live values.
    expect(held.map((row) => row.id)).toEqual(expect.arrayContaining([billWidth, billFabric, billModel]));
    expect(held.filter((row) => row.dimension_slot === "W").map((row) => row.id)).toEqual([billWidth]);
    expect(held.filter((row) => row.label === "Fabric")).toHaveLength(1);
    // D and SH were free, so they are written; the Supplier statement is a note.
    expect(held.filter((row) => row.dimension_slot === "D").map((row) => row.value)).toEqual(["610"]);
    expect(held.filter((row) => row.dimension_slot === "SH").map((row) => row.value)).toEqual(["430"]);
    const supplier = held.find((row) => row.attr_group === "note" && row.label === "Supplier");
    expect(supplier).toMatchObject({ value: "WEWOOD, Porto — sales@example.test", source_run_id: furnitureRunId, source_page: 9 });

    const open = await openDisagreements();
    expect(open.map((row) => [row.held_attribute_id, row.value])).toEqual(
      expect.arrayContaining([
        [billWidth, "540"],
        [billModel, "WEWOOD — Caravela"],
      ]),
    );
    expect(open).toHaveLength(2);
    const width = open.find((row) => row.held_attribute_id === billWidth)!;
    expect(width).toMatchObject({ record_id: gr04, source_run_id: furnitureRunId, source_page: 9, attr_group: "dimension", dimension_slot: "W", unit: "mm" });
    // Recorded under the confirm's change, which took a version (D, SH and the note changed the record).
    const change = (await client.query(`select kind from change_sets where id = $1`, [width.change_set_id])).rows[0];
    expect(change.kind).toBe("spec_document_confirm");
    expect(await versions(gr04)).toBe(before + 1);

    const lines = (await staged(furnitureRunId)).lines.filter((line) => line.recordId === gr04);
    expect(lines.every((line) => line.reviewStatus === "applied")).toBe(true);
    const fabric = lines.find((line) => line.finish)!;
    expect(fabric.applied).toMatchObject({ outcome: "agrees", attributeId: billFabric });
    expect(lines.find((line) => line.dimension?.slot === "W")?.applied).toMatchObject({ outcome: "recorded_beside" });
  });

  it("never stacks a second open disagreement for one statement, on a re-confirm or a re-match", async () => {
    const { POST: rematch } = await import("@/app/api/imports/[id]/rematch/route");
    const res = await rematch(request({}), params(furnitureRunId));
    expect(res.status).toBe(200);
    expect(await openDisagreements()).toHaveLength(2);

    // The same statement confirmed again off the same document (a restaged
    // copy of it): the one open row stands.
    const again = (await staged(furnitureRunId)).lines
      .filter((line) => line.recordId === gr04 && line.dimension?.slot === "W")
      .map((line): Proposal => ({ ...line, reviewStatus: "pending", applied: null, version: 1, id: crypto.randomUUID() }));
    const document = await staged(furnitureRunId);
    await client.query(`update intake_runs set parsed = $2, status = 'parsed' where id = $1`, [
      furnitureRunId,
      JSON.stringify({ ...document, lines: [...document.lines, ...again] }),
    ]);
    const changes = async () =>
      Number((await client.query(`select count(*) as n from change_sets where project_id = $1`, [projectId])).rows[0].n);
    const changesBefore = await changes();
    const confirmed = await confirm(furnitureRunId, gr04);
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    expect(await openDisagreements()).toHaveLength(2);
    // Saying it again records nothing new, so it opens no change either.
    expect(await changes()).toBe(changesBefore);
  });

  it("uses the document's value instead when the reviewer says so: the bill's width is retired", async () => {
    const runId = await stagedRun([observation({ refRaw: "GR-FUR-04", valueRaw: "W545 mm" })]);
    const [line] = (await staged(runId)).lines;
    expect(line?.attributeTarget?.attributeId).toBe(billWidth);

    // "Use this document's instead" is the replace tick, set by the autosave.
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const patched = await PATCH(
      request({ proposalId: line!.id, expectedProposalVersion: line!.version, changes: { overwriteAcknowledged: true } }, "PATCH"),
      params(runId),
    );
    expect(patched.status).toBe(200);

    const before = (await openDisagreements()).length;
    const res = await confirm(runId, gr04);
    expect(res.status, await res.clone().text()).toBe(200);
    const status = (await client.query(`select status from record_attributes where id = $1`, [billWidth])).rows[0].status;
    expect(status).toBe("retired");
    const widths = (await active(gr04)).filter((row) => row.dimension_slot === "W");
    expect(widths.map((row) => [row.value, row.unit, row.source_run_id])).toEqual([["545", "mm", runId]]);
    // Nothing recorded beside: the reviewer chose to replace.
    expect(await openDisagreements()).toHaveLength(before);
  });

  it("a card that only agrees writes nothing, opens no change and takes no version", async () => {
    // GR-FUR-04 holds D 610 from the tracker's own confirm above. A document
    // saying the same again is not a change of anything.
    const runId = await stagedRun([observation({ refRaw: "GR-FUR-04", valueRaw: "D610 mm" })]);
    const [line] = (await staged(runId)).lines;
    expect(line?.attributeTarget).toBeTruthy();
    const changesBefore = Number((await client.query(`select count(*) as n from change_sets where project_id = $1`, [projectId])).rows[0].n);
    const versionsBefore = await versions(gr04);
    const attributesBefore = (await active(gr04)).length;

    const res = await confirm(runId, gr04);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await staged(runId)).lines[0]?.applied).toMatchObject({ outcome: "agrees" });
    expect((await active(gr04)).length).toBe(attributesBefore);
    expect(await versions(gr04)).toBe(versionsBefore);
    const changesAfter = Number((await client.query(`select count(*) as n from change_sets where project_id = $1`, [projectId])).rows[0].n);
    expect(changesAfter).toBe(changesBefore);
  });

  it("an equal value over the bill's writes nothing and records no disagreement", async () => {
    // The bill's model note, said again in other case: agrees.
    const runId = await stagedRun([observation({ refRaw: "GR-FUR-04", attributeRaw: "MODEL REF", valueRaw: "bespoke" })]);
    const [line] = (await staged(runId)).lines;
    expect(line?.note).toBeTruthy();
    expect(line?.attributeTarget?.attributeId).toBe(billModel);
    const before = await openDisagreements();
    const res = await confirm(runId, gr04);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await openDisagreements()).toEqual(before);
    expect((await active(gr04)).filter((row) => row.attr_group === "note" && /model/i.test(String(row.label)))).toHaveLength(1);
  });
});
