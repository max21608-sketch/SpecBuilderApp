// Step D's one verification call against a REAL model. NOT part of the suite.
//
// It is gated on VERIFY_MODEL=1 and skips otherwise, because it SPENDS MONEY
// and sends a document to Anthropic. Run it deliberately:
//
//   VERIFY_MODEL=1 node --env-file=.env.local ./node_modules/.bin/vitest run tests/manual/verify-model.test.ts
//
// The document is SYNTHETIC — invented refs, invented finishes, a throwaway
// project deleted at the end. No client material goes to the model from here.
//
// What it proves, and why each matters:
//   - the installed SDK accepts the exact parameter combination (a wrong one
//     fails at full price on a real document)
//   - a non-strict tool schema with anyOf nullable enums is accepted
//   - streaming + finalMessage() survives the round trip
//   - raw_response and model_metadata are persisted
//   - ONE request is billed, not three (maxRetries: 0)
//   - the resolver's rules hold against real model output, not a fixture
import { describe, it, expect } from "vitest";
import pg from "pg";
import { put, del } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import type { StagedSpecDocument } from "@/lib/spec-document";

const enabled = process.env.VERIFY_MODEL === "1" && Boolean(process.env.DATABASE_URL);
const describeIfEnabled = enabled ? describe : describe.skip;

// Deliberately contains every case the resolver must not get wrong.
const CSV = [
  "Item ref,Description,Attribute,Value,Area,Notes",
  "QA-100,Lounge armchair,Leg finish,Antique brass,Level 3 lounge,",
  "QA-100,Lounge armchair,Seat fabric,TBC,Level 3 lounge,Client to confirm at sample stage",
  "QA-100,Lounge armchair,Piping,N/A,Level 3 lounge,No piping on this model",
  "QA-200,Console table,Main timber finish,Walnut veneer satin lacquer TBC,Level 4 corridor,",
  "QA-200,Console table,Leg finish,Polished nickel,Level 4 corridor,",
  "QA-200,Console table,Leg finish,Brushed steel,Level 4 corridor,Revision B supersedes - conflicting",
  "QA-999,Unknown item,Leg finish,Chrome,Level 5,Not in the bill of quantities",
].join("\n");

describeIfEnabled("one real model call", () => {
  it("reads a synthetic FF&E schedule end to end", { timeout: 300_000 }, async () => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();

    const project = (
      await c.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('__QA P99001','__QA Step D verification','verify','verify') returning id`,
      )
    ).rows[0];
    const projectId = String(project.id);
    let blobUrl = "";

    try {
      const category = (
        await c.query(
          `select c.id, c.name from item_categories c join requirements q on q.category_id=c.id
           group by c.id, c.name having count(q.id) >= 5 order by c.id limit 1`,
        )
      ).rows[0];

      for (const [index, ref] of ["QA-100", "QA-200"].entries()) {
        const record = (
          await c.query(
            `insert into spec_records (project_id, record_no, status, category_id, item_description, created_by, updated_by)
             values ($1,$2,'active',$3,$4,'verify','verify') returning id`,
            [projectId, index + 1, category.id, index === 0 ? "Lounge armchair" : "Console table"],
          )
        ).rows[0];
        await c.query(
          `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
           values ($1,$2,'boq_code',$3,$3,'verify','verify')`,
          [record.id, projectId, ref],
        );
        await c.query(
          `insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
           select $1, q.id, q.spec_field_id, 'missing','verify','verify' from requirements q where q.category_id=$2`,
          [record.id, category.id],
        );
      }

      const blob = await put(`projects/${projectId}/qa-ffe-schedule.csv`, CSV, {
        access: "private",
        addRandomSuffix: false,
        contentType: "text/csv",
      });
      blobUrl = blob.url;

      const attachment = (
        await c.query(
          `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
           values ('project',$1,'spec_document',$2,'qa-ffe-schedule.csv','text/csv',$3,'verify') returning id`,
          [projectId, blob.pathname, CSV.length],
        )
      ).rows[0];

      const attemptId = randomUUID();
      const run = (
        await c.query(
          `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status,
              attempt_id, queued_at, attempt_deadline_at, claim_count, created_by, updated_by)
           values ($1,$2,'spec_document','ffe_schedule','queued',$3, now(), now() + interval '1 hour', 0,'verify','verify')
           returning id`,
          [projectId, attachment.id, attemptId],
        )
      ).rows[0];

      const { runDocumentExtraction } = await import("@/lib/extraction-run");
      const started = Date.now();
      const outcome = await runDocumentExtraction({
        extractionId: String(run.id),
        attemptId,
        actor: "verify@benwhistler.com",
      });
      const wallMs = Date.now() - started;

      const after = (
        await c.query(
          `select status, model, error, model_metadata, parsed, raw_response is not null as has_raw
             from intake_runs where id=$1`,
          [run.id],
        )
      ).rows[0];

      const staged = after.parsed as StagedSpecDocument | null;

      // Printed, not only asserted: this run's whole purpose is to be READ.
      console.log("\n=== step D verification ===");
      console.log("category:", category.name);
      console.log("outcome:", JSON.stringify(outcome));
      console.log("status:", after.status, "| model:", after.model, "| raw kept:", after.has_raw);
      console.log("error:", after.error);
      console.log("metadata:", JSON.stringify(after.model_metadata));
      console.log("wall clock:", (wallMs / 1000).toFixed(1) + "s");
      if (staged) {
        console.log("documentNotes:", JSON.stringify(staged.documentNotes));
        console.log(`proposals: ${staged.lines.length}`);
        for (const p of staged.lines) {
          console.log(
            `  ${p.raw.refRaw ?? "-"} | "${p.raw.attributeRaw ?? "-"}" = "${p.raw.valueRaw ?? "-"}"` +
              ` | rec:${p.recordId ? "YES" : `no(${p.recordCandidates.length})`}` +
              ` req:${p.requirementId ? "YES" : `no(${p.requirementCandidates.length})`}` +
              ` state:${p.proposedState ?? "NONE"}` +
              (p.stateReason ? ` [${p.stateReason.slice(0, 44)}]` : ""),
          );
        }
      }
      console.log("=== end ===\n");

      expect(outcome).toEqual({ outcome: "parsed" });
      expect(after.status).toBe("parsed");
      expect(after.has_raw).toBe(true);
      expect(after.model_metadata?.requestId).toBeTruthy();
      expect(staged?.lines.length).toBeGreaterThan(0);

      // The document said TBC. It must not have become a settled answer.
      const tbc = staged?.lines.filter((line) => (line.raw.valueRaw ?? "").trim().toUpperCase() === "TBC") ?? [];
      for (const line of tbc) expect(line.proposedState).toBe("tbc");

      // The contradictory value must have no state and a reason.
      const contradictory = staged?.lines.find((line) => /lacquer tbc/i.test(line.raw.valueRaw ?? ""));
      if (contradictory) {
        expect(contradictory.proposedState).toBeNull();
        expect(contradictory.stateReason).toBeTruthy();
      }

      // A ref that is in no bill of quantities must resolve to nothing.
      const unknown = staged?.lines.filter((line) => (line.raw.refRaw ?? "").includes("999")) ?? [];
      for (const line of unknown) expect(line.recordId).toBeNull();
    } finally {
      await c.query(
        `delete from spec_answers where record_id in (select id from spec_records where project_id=$1)`,
        [projectId],
      );
      await c.query(`delete from spec_record_refs where project_id=$1`, [projectId]);
      await c.query(`delete from spec_records where project_id=$1`, [projectId]);
      await c.query(`delete from intake_runs where project_id=$1`, [projectId]);
      await c.query(`delete from attachments where entity_id=$1`, [projectId]);
      await c.query(`delete from projects where id=$1`, [projectId]);
      if (blobUrl) await del(blobUrl).catch(() => {});
      await c.end();
    }
  });
});
