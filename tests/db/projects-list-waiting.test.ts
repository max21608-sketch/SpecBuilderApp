// THE PROJECTS LIST'S WAITING COUNT, SCOPED — and the proof that scoping it
// changed nothing.
//
// `GET /api/projects` used to call `loadOutstanding` over every project on the
// page to produce ONE INTEGER per row: measured on the sandbox 2026-09-22,
// 27,487 questions and 26.4 MB from 28 coverage rows, about 1.7 s of a 2 s
// route (`found-in-use.md`, 2026-09-19). It now passes a SCOPE, because
// `waitingByQuestion` walks the coverage rows and looks each one up — a
// question with no sent coverage row against it can never be in the answer.
//
// That is a narrowing, not an approximation, and this file is what says so.
//
// THE TRAP IT HOLDS. `OutstandingScope.lineIds` matches
// `coalesce(r.parent_id, r.id)` — the LINE, not the record — because a finish
// option is listed under its bill line. A coverage row names a RECORD, and
// that record may be a configuration, so passing coverage's record ids
// straight through matches nothing for a variant and the question silently
// reads as not waiting. `lineIdsForRecords` is the one lookup that fixes it,
// and the fixture below chases a CONFIGURATION on purpose: with the lookup
// removed, the scoped count drops and the unscoped one does not.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { lineIdsForRecords, loadOutstanding, loadSentCoverage, waitingByQuestion } from "@/lib/chase-drafts";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("the projects list's waiting count is scoped, and the scope changes nothing", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let runId = "";
  let contactId = "";
  let categoryId = "";
  let parentId = "";
  let variantId = "";
  let draftId = "";

  async function nextRecordNo(): Promise<number> {
    const row = await client.query(
      `select coalesce(max(record_no), 0) + 1 as n from spec_records where project_id = $1`,
      [projectId],
    );
    return Number(row.rows[0].n);
  }

  beforeAll(async () => {
    await client.connect();

    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P00097")}', '__QA List waiting', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;

    const contact = await client.query(
      `insert into project_contacts (project_id, name, email, role, designer_code, created_by, updated_by)
       values ($1, '__QA Hayley', 'hayley@example.test', 'designer', 'QAHAY', 'qa', 'qa') returning id`,
      [projectId],
    );
    contactId = contact.rows[0].id;

    const category = await client.query(
      `select c.id from item_categories c
         join requirements q on q.category_id = c.id
        group by c.id having count(q.id) >= 3
        order by c.id limit 1`,
    );
    categoryId = category.rows[0].id;

    // A bill line that was SPLIT, so its questions are the configurations'.
    const parent = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, designer, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, 'complex', '__QA Armchair', 'qahay', 'qa', 'qa') returning id`,
      [projectId, runId, await nextRecordNo(), categoryId],
    );
    parentId = parent.rows[0].id;

    const variant = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level, parent_id,
                                 depth, split_reason, variant_label, item_description, designer,
                                 created_by, updated_by)
       values ($1, $2, $3, 'active', $4, 'complex', $5, 1, 'fabric', 'A', '__QA Armchair', 'qahay',
               'qa', 'qa') returning id`,
      [projectId, runId, await nextRecordNo(), categoryId, parentId],
    );
    variantId = variant.rows[0].id;

    // A second, unsplit line with plenty of outstanding questions, so the
    // unscoped load is genuinely bigger than the scoped one.
    await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, designer, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, 'complex', '__QA Bench', 'qahay', 'qa', 'qa')`,
      [projectId, runId, await nextRecordNo(), categoryId],
    );

    // A SENT chase covering one question on the CONFIGURATION. That is the
    // whole point of the fixture: the coverage row names the variant, and the
    // scope is keyed on the line.
    const requirement = await client.query(
      `select id, prompt from requirements where category_id = $1 order by sort_order limit 1`,
      [categoryId],
    );
    const requirementId = requirement.rows[0].id;

    const draft = await client.query(
      `insert into email_drafts (project_id, contact_id, status, sent_at, sent_by, subject, intro_text,
                                 closing_text, body, project_label, created_by, updated_by)
       values ($1, $2, 'sent', now(), 'qa', '__QA chase', '', '', '<p>__QA</p>', '__QA List waiting',
               'qa', 'qa') returning id`,
      [projectId, contactId],
    );
    draftId = draft.rows[0].id;

    const record = await client.query(`select version from spec_records where id = $1`, [variantId]);
    await client.query(
      `insert into email_draft_items (draft_id, record_id, requirement_id, revision_no, answer_id,
                                      snapshot_answer_version, record_version, context_snapshot,
                                      prompt_text, sort_order, tier)
       values ($1, $2, $3, 0, null, null, $4, $5::jsonb, $6, 1, 'to_quote')`,
      [
        draftId,
        variantId,
        requirementId,
        Number(record.rows[0].version),
        JSON.stringify({ prompt: String(requirement.rows[0].prompt), refs: "", recordNo: null }),
        String(requirement.rows[0].prompt),
      ],
    );
  });

  afterAll(async () => {
    // GUARDED. A failed `beforeAll` leaves these empty, and an empty string is
    // not a uuid — the teardown then fails too and reports a second, unrelated
    // error over the real one (found-in-use, 2026-09-21).
    if (!projectId) {
      await client.end();
      return;
    }
    if (draftId) await client.query(`delete from email_draft_items where draft_id = $1`, [draftId]);
    await client.query(`delete from email_drafts where project_id = $1`, [projectId]);
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("answers exactly what the unscoped load answered, and loads far less to do it", async () => {
    const coverage = await loadSentCoverage([projectId]);
    expect(coverage.length).toBeGreaterThan(0);

    const everything = await loadOutstanding([projectId]);
    const lines = await lineIdsForRecords([...new Set(coverage.map((row) => row.recordId))]);
    const scoped = await loadOutstanding([projectId], {
      lineIds: lines,
      requirementIds: [...new Set(coverage.map((row) => row.requirementId))],
    });

    const before = waitingByQuestion(everything, coverage);
    const after = waitingByQuestion(scoped, coverage);

    // The answer, which is what the list prints.
    expect(after.size).toBe(before.size);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    // And it is a real narrowing, not the same query with extra words.
    expect(scoped.length).toBeLessThan(everything.length);
  });

  it("scopes to the LINE, so a chase on a configuration is still found", async () => {
    const coverage = await loadSentCoverage([projectId]);
    // The coverage row names the configuration...
    expect(coverage.some((row) => row.recordId === variantId)).toBe(true);
    // ...and the scope it produces names its BILL LINE, which is what
    // `loadOutstanding` matches on. Passing the record id straight through is
    // the mistake this asserts against.
    const lines = await lineIdsForRecords([variantId]);
    expect(lines).toEqual([parentId]);

    const scoped = await loadOutstanding([projectId], { lineIds: lines });
    expect(scoped.some((question) => question.recordId === variantId)).toBe(true);

    // The proof that the wrong reading fails: scoping on the RECORD id finds
    // nothing, because no line is keyed by a variant's own id.
    const wrong = await loadOutstanding([projectId], { lineIds: [variantId] });
    expect(wrong.length).toBe(0);
  });

  it("returns nothing when there is no coverage, rather than everything", async () => {
    // An EMPTY scope is nothing and an ABSENT one is everything: a project
    // that has never been chased must not fall through to the whole load.
    const none = await loadOutstanding([projectId], { lineIds: [], requirementIds: [] });
    expect(none).toEqual([]);
  });
});
