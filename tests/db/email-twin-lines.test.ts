// Database tier — an email naming a code that is on two lines of one phase
// (prod-ready E1, 2026-11-20). Through the real re-match route, which
// re-resolves the staged statements against the project's live registers —
// twin links included — without a model call.
//
// ============================================================================
// THE DEFECT. `HH-CH-02` on two lines the reviewer had linked as twins (0060):
// the drawings card landed on both, and the email review called the code
// ambiguous and the row said "Item not found" — landing on neither.
//
//  * LINKED twins: the statement lands on EACH line, one proposal per record,
//    by the drawings' own predicate (`everyPairTwinned`).
//  * NOT linked: still the person's question (SX11A), but said in words —
//    "… is on 2 lines of … — choose which" — never "Item not found".
// ============================================================================
//
// Rows are prefixed `__QA `; the project delete cascades. audit_log is left alone.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { describeIfDb, qaNumber } from "./db-tier";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { linkTwins } from "@/lib/record-twins";
import { proposalBlockers, resolveProposals, type Proposal, type StagedSpecDocument } from "@/lib/spec-document";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import type { RawProposal } from "@/lib/extraction-schema";
import { describeChange } from "@/lib/spec-change";

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

describeIfDb("an email's code on two lines of one phase (E1)", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  const PHASE = "__QA Guest Rooms";
  let projectId = "";
  let twinA = "";
  let twinB = "";
  let plainA = "";
  let plainB = "";
  let runId = "";
  let raws: RawProposal[] = [];

  const line = (phase: string, ref: string, area: string) =>
    withTransaction((txn) =>
      createRecord(txn, { projectId, runId: phase, itemDescription: "Lounge chair", clientRef: ref, qty: 2, area, actor: "qa" }),
    ).then((result) => result.recordId);

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Email twins', 'qa', 'qa') returning id`,
        [qaNumber("P90212")],
      )
    ).rows[0].id;
    const phase = (await withTransaction((txn) => createRun(txn, { projectId, name: PHASE, actor: "qa" }))).runId;
    twinA = await line(phase, "__QA-CH-02", "Suite A");
    twinB = await line(phase, "__QA-CH-02", "Suite B");
    plainA = await line(phase, "__QA-CH-03", "Suite A");
    plainB = await line(phase, "__QA-CH-03", "Suite B");

    // READ BEFORE THE LINK, as the worker reads: both codes are on two lines
    // of the phase, so both statements stage as the person's question.
    const raw = (ref: string) => ({
      refRaw: ref,
      attributeRaw: "Seat height",
      valueRaw: "450mm",
      page: null,
      sourceSheet: null,
      sourceRow: null,
      confidence: "high" as const,
      note: null,
      quotedText: `${ref} seat height is 450mm`,
    });
    raws = [raw("__QA-CH-02"), raw("__QA-CH-03")];
    const before = resolveProposals(raws, await loadExtractionRegisters(projectId), () => randomUUID());
    expect(before.every((proposal) => proposal.recordId === null && proposal.recordCandidates.length === 2)).toBe(true);
    const staged: StagedSpecDocument = { schemaVersion: 1, lines: before, documentNotes: null, filename: "__QA message.eml" };
    runId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
         values ($1, 'spec_document', 'email', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
        [projectId, JSON.stringify(staged)],
      )
    ).rows[0].id;

    // Then the reviewer links the CH-02 lines as one chair.
    await withTransaction((txn) => linkTwins(txn, { recordId: twinA, otherId: twinB, reason: "__QA one chair, two suites", actor: "qa" }));
  }, SLOW);

  function expectLanded(lines: Proposal[]) {
    // LINKED: one proposal per twin, each placed, one SH each, saying why.
    const twins = lines.filter((proposal) => proposal.raw.refRaw === "__QA-CH-02");
    expect(twins.map((proposal) => proposal.recordId).sort()).toEqual([twinA, twinB].sort());
    expect(twins.every((proposal) => proposal.dimension?.slot === "SH")).toBe(true);
    expect(twins.every((proposal) => proposal.runName === PHASE)).toBe(true);
    expect(new Set(twins.map((proposal) => proposal.sourceOrdinal)).size).toBe(1);
    expect(twins[0]?.readingNote).toMatch(/are twins: the bill lists one item on 2 lines, so this goes on each/);

    // NOT LINKED: still one question, and it says which question.
    const plain = lines.filter((proposal) => proposal.raw.refRaw === "__QA-CH-03");
    expect(plain).toHaveLength(1);
    const asked = plain[0]!;
    expect(asked.recordId).toBeNull();
    expect(asked.recordCandidates.map((candidate) => candidate.id).sort()).toEqual([plainA, plainB].sort());
    expect(describeChange(asked).label).toBe(`__QA-CH-03 is on 2 lines of ${PHASE} — choose which`);
    expect(proposalBlockers(asked, lines).map((blocker) => blocker.message)).toEqual([
      `__QA-CH-03 is on 2 lines of ${PHASE} — choose which line this is for.`,
    ]);
  }

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("an email READ after the link lands on each twin, and asks in words about lines that are not", async () => {
    expectLanded(resolveProposals(raws, await loadExtractionRegisters(projectId), () => randomUUID()));
  }, SLOW);

  it("an email read BEFORE the link lands on each twin at a re-match (free)", async () => {
    const { POST } = await import("@/app/api/imports/[id]/rematch/route");
    const version = Number((await client.query(`select version from intake_runs where id = $1`, [runId])).rows[0].version);
    const res = await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: version }),
      }),
      params(runId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).rematched).toBe(1);
    expectLanded(((await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedSpecDocument).lines);
  }, SLOW);
});

// THE ITEM WAS FOUND AND HAS NO CATEGORY (prod-ready follow-up, 2026-11-20).
// T20120's "HH-CH-02 lounge chair: no swivel." carried the twin note and one
// candidate per twin, and read "Not placed · Item not found" — the lounge
// chairs had no category, so no question could be matched. Nothing is placed
// differently; the row says which item, and what to do.
describeIfDb("an email's statement about an item with no category", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let twinA = "";
  let twinB = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Email no category', 'qa', 'qa') returning id`,
        [qaNumber("P90214")],
      )
    ).rows[0].id;
    const phase = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Guest Rooms", actor: "qa" }))).runId;
    const line = (area: string) =>
      withTransaction((txn) =>
        createRecord(txn, { projectId, runId: phase, itemDescription: "Lounge chair", clientRef: "__QA-CH-02", qty: 2, area, actor: "qa" }),
      ).then((result) => result.recordId);
    twinA = await line("Suite A");
    twinB = await line("Suite B");
    await withTransaction((txn) => linkTwins(txn, { recordId: twinA, otherId: twinB, reason: "__QA one chair", actor: "qa" }));
  }, SLOW);

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  const swivel: RawProposal = {
    refRaw: "__QA-CH-02",
    attributeRaw: "Swivel",
    valueRaw: "no swivel",
    page: null,
    sourceSheet: null,
    sourceRow: null,
    confidence: "high",
    note: null,
    quotedText: "__QA-CH-02 lounge chair: no swivel.",
  };

  it("says each twin has no category, names it, and places nothing", async () => {
    const registers = await loadExtractionRegisters(projectId);
    const label = (id: string) => registers.records.find((record) => record.id === id)!.label;
    const lines = resolveProposals([swivel], registers, () => randomUUID());
    expect(lines).toHaveLength(2);
    // Not placed: a record with no category has no question to match.
    expect(lines.every((proposal) => proposal.recordId === null)).toBe(true);
    expect(lines.map((proposal) => proposal.uncategorised?.recordId).sort()).toEqual([twinA, twinB].sort());
    for (const proposal of lines) {
      const sentence = `${label(proposal.uncategorised!.recordId)} has no category — give it one on the record, then Re-match`;
      expect(describeChange(proposal).label).toBe(sentence);
      expect(proposalBlockers(proposal, lines)).toEqual([{ code: "no_category", message: `${sentence}.` }]);
    }
  }, SLOW);

  it("a run staged before the field reads as before, and gains it at a (free) re-match", async () => {
    const registers = await loadExtractionRegisters(projectId);
    // As staged before the field existed: the same rows without it.
    const before = resolveProposals([swivel], registers, () => randomUUID()).map((proposal) => {
      const old = { ...proposal };
      delete old.uncategorised;
      return old;
    });
    expect(describeChange(before[0]!).label).toBe("Item not found");
    const runId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
         values ($1, 'spec_document', 'email', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
        [projectId, JSON.stringify({ schemaVersion: 1, lines: before, documentNotes: null, filename: "__QA swivel.eml" })],
      )
    ).rows[0].id;
    const { POST } = await import("@/app/api/imports/[id]/rematch/route");
    const res = await POST(
      new Request("http://localhost/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      params(runId),
    );
    expect(res.status).toBe(200);
    const after = ((await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedSpecDocument).lines;
    // The same rows, ids kept, each now naming its own item.
    expect(after.map((proposal) => proposal.id).sort()).toEqual(before.map((proposal) => proposal.id).sort());
    for (const proposal of after) {
      expect(proposal.uncategorised?.recordId).toBe(proposal.recordCandidates[0]?.id);
    }
    expect(after.map((proposal) => proposal.uncategorised?.recordId).sort()).toEqual([twinA, twinB].sort());
  }, SLOW);
});
