#!/usr/bin/env tsx
// A whole demo project, built out of nothing, so the app can be walked through
// end to end in front of somebody.
//
//   npm run qa:demo                    dry run — says what it would build
//   npm run qa:demo -- --apply         builds it
//   npm run qa:demo -- --clear --apply removes it again
//
// ============================================================================
// WHY IT IS INVENTED RATHER THAN COPIED
//
// There is a fully loaded project in the sandbox already, and it is Panther:
// real client drawings, real client codes, NDA-covered. A walkthrough given to
// somebody outside the business must not be a walkthrough of that. So every
// name, code, figure, fabric and email in tools/demo/content.ts is made up,
// every address is at example.com (IANA-reserved, unregistrable), and the
// documents are DRAWN by tools/demo/sheets.ts rather than taken from anywhere.
//
// ONE EXCEPTION, asked for directly: the item PICTURES are real cropped views
// borrowed from the AP364c pack already in the sandbox, because the drawn
// silhouettes are obviously synthetic and the screens a walkthrough lingers on
// are the ones that show them. Pictures only, seating only, store to store,
// and nothing enters the repo — tools/demo/real-pictures.ts carries the whole
// argument and degrades to the silhouettes where that pack is absent.
//
// ---- IT GOES THROUGH THE APP'S OWN FUNCTIONS -------------------------------
//
// The same argument as tools/qa-fake-inbox.ts. What is being demonstrated is
// what the app does with a pack, so the pack goes through `parseBoqSheets`,
// `confirmBoqImport`, `stageDrawings`, `confirmDrawingItem`, `resolveProposals`
// and `recordMessage` — the real ones. A script that inserted its own
// `spec_records` would be a second implementation of the thing on screen, and
// it would agree with the app right up until the app changed.
//
// Two places it cannot, and both are stated where they happen:
//
//   EXTRACTION IS NOT RUN. A model read costs money and this script is going
//   to be re-run. So the RAW output a read would have produced is written by
//   hand, in the model's own output shape, and handed to the same staging
//   functions the worker hands it to. Everything downstream of staging — the
//   review screen, the blockers, the confirm, the fan-out — is the real path.
//   `intake_runs.model` says `demo (no model call)` so nothing later mistakes
//   these runs for reads that happened.
//
//   ASSIGNING THE REVIEW EMAIL DOES NOT CALL `assignMessage`. That function
//   publishes a queue attempt, which is exactly the paid read above. Its
//   database effects are reproduced here instead, with the staged output
//   already in place.
//
// ---- HOW IT LEAVES NO TRACE ------------------------------------------------
//
// house/conventions.md §12 asks for a `__QA ` prefix so cleanup is one `like`
// sweep. A prefix like that ON SCREEN would defeat the entire purpose of a
// demo, so the marker is the project NUMBER instead: `DEMO-TEST-01`, with TEST
// in the name as well so a screenshot taken out of the walkthrough cannot be
// mistaken for a live job. The sweep is still one `like 'DEMO%'`, `--clear` is
// that sweep, and a demo project is self-evidently a demo project to anybody
// looking at the list.
//
// Sandbox only, with no `--yes-production` escape hatch. A backfill has a
// reason to run against production; inventing a client does not.
// ============================================================================
import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import ExcelJS from "exceljs";
import pg from "pg";

import { sql } from "@/lib/db";
import { withTransaction } from "@/lib/db-transaction";
import { parseBoqSheets, BOQ_SCHEMA_VERSION } from "@/lib/boq-import";
import { matchName, type MatchCandidate } from "@/lib/matching";
import { guessLevelFromBill } from "@/lib/level-guess";
import { confirmBoqImport } from "@/lib/confirm-boq";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import {
  stageDrawings,
  specFieldEntries,
  resolveDrawingTargets,
  assertStagedDrawings,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { confirmDrawingItem } from "@/lib/confirm-drawings";
import { stagePreamble } from "@/lib/preamble-document";
import { confirmPreambleNotes } from "@/lib/confirm-preamble";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import { resolveProposals, PROPOSAL_SCHEMA_VERSION } from "@/lib/spec-document";
import { recordMessage } from "@/lib/email-ingest";
import { createFinish } from "@/lib/finish-edit";
import { openChangeSet } from "@/lib/change-sets";
import { takeBaseline } from "@/lib/baselines";
import { setRecordCategory, setRecordLevel, acceptSuggestedLevels } from "@/lib/record-category";
import { editAnswer } from "@/lib/answer-edit";

import { drawingPdf, preamblePdf, itemPicture, swatch } from "./demo/sheets";
import { loadSourcePictures, sourceItemFor, copyPictureInto, type RealPicture } from "./demo/real-pictures";
import {
  BILL,
  BILL_METADATA,
  CONTACTS,
  DRAWINGS_A,
  DRAWINGS_B,
  FINISH_DETAIL,
  INBOX,
  PASTED_FINISHES,
  PREAMBLE_NOTES,
  PROJECT,
  REVIEW_EMAIL,
  rawDrawingItems,
  type DemoDrawing,
  type DemoMessage,
} from "./demo/content";

const ACTOR = "demo-seed";
const apply = process.argv.includes("--apply");
const clear = process.argv.includes("--clear");

// ---- guards, before anything is touched ------------------------------------
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:  npm run qa:demo   (reads .env.local)");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (environment !== "sandbox") {
  console.error(`DATABASE_ENVIRONMENT is "${environment}". This script only ever runs against sandbox.`);
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set. The pack has to be stored, or no review screen can open a page.");
  process.exit(1);
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${new URL(databaseUrl).host})`);
console.log(apply ? "Mode:   APPLY\n" : "Mode:   dry run (add --apply to write)\n");

// ---- the direct connection, and why it is opened twice ---------------------
//
// `sql` (the HTTP driver) does the building; this client is only for the
// pre-flight check, the sweep and the closing summary — the three places that
// want plain SQL with no app semantics around it.
//
// It is CLOSED before the build and re-opened for the summary. A build takes
// upwards of twenty minutes, almost all of it on the HTTP driver, and a `pg`
// socket left idle across that is dropped by the network long before it is
// next used: the first run to fill the checklist ended in `read ETIMEDOUT` on
// the summary query, AFTER every write had committed. Nothing was lost but the
// closing report, and a stack trace at the end of a script somebody runs an
// hour before a call reads exactly like a failed build.
let client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const say = (step: string, detail = ""): void => console.log(`  ${step.padEnd(34, " ")} ${detail}`);

/** Everything this run stored, so `--clear` can take the files with it. */
const stored: string[] = [];

async function store(pathname: string, bytes: Buffer, contentType: string): Promise<string> {
  const result = await put(pathname, bytes, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  stored.push(result.pathname);
  return result.pathname;
}

// ---- real item pictures, where the sandbox has a pack to borrow from -------
//
// Loaded once. `sourcePictures` is empty on a database with no source pack,
// and then every lookup below returns null and the drawn silhouettes stand —
// which is why no caller has a branch for "is there a source pack".
const sourcePictures = await loadSourcePictures();
const borrowedByCode = new Map<string, RealPicture | null>();

/** The real crop that stands in for this bill code, copied in on first ask. */
async function realPictureFor(code: string): Promise<RealPicture | null> {
  if (borrowedByCode.has(code)) return borrowedByCode.get(code) ?? null;
  const item = sourceItemFor(code);
  const source = item ? sourcePictures.get(item) : null;
  if (!source) {
    borrowedByCode.set(code, null);
    return null;
  }
  const copied = await copyPictureInto(
    source,
    `projects/${projectId}/demo/picture-${code.toLowerCase()}.png`,
    process.env.BLOB_READ_WRITE_TOKEN!,
  );
  if (copied) stored.push(copied.pathname);
  borrowedByCode.set(code, copied);
  return copied;
}

// ===========================================================================
// --clear
// ===========================================================================
async function sweep(): Promise<void> {
  const projects = await client.query<{ id: string; bws_project_number: string }>(
    `select id, bws_project_number from projects where bws_project_number like 'DEMO%'`,
  );
  if (projects.rows.length === 0) {
    console.log("Nothing to remove — no project numbered DEMO%.");
    return;
  }
  for (const project of projects.rows) {
    const id = project.id;
    if (!apply) {
      console.log(`  would remove ${project.bws_project_number}`);
      continue;
    }
    // Stored files first: the rows are what say where they are.
    const files = await client.query<{ storage_path: string }>(
      `select storage_path from attachments
       where (entity_type = 'project' and entity_id = $1)
          or (entity_type = 'spec_records' and entity_id in (select id from spec_records where project_id = $1))
          or (entity_type = 'project_finishes' and entity_id in (select id from project_finishes where project_id = $1))
          or (entity_type = 'email_messages' and entity_id in (select id from email_messages where project_id = $1))`,
      [id],
    );
    const mailbox = await client.query<{ mailbox_storage_path: string | null }>(
      `select mailbox_storage_path from email_messages where mailbox like 'demo@%' or project_id = $1`,
      [id],
    );
    for (const path of [
      ...files.rows.map((row) => row.storage_path),
      ...mailbox.rows.map((row) => row.mailbox_storage_path).filter((path): path is string => Boolean(path)),
    ]) {
      await del(path, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => undefined);
    }

    // The project delete cascades change sets, snapshots, records, runs and
    // attachments (0013/0014/0015). What it does NOT cascade is anything whose
    // FK is RESTRICT, and a chase draft is one — deliberately, because a draft
    // is a communication record. Those go first, in FK-safe order.
    await client.query(
      `delete from email_draft_items where draft_id in (select id from email_drafts where project_id = $1)`, [id],
    );
    await client.query(`delete from email_drafts where project_id = $1`, [id]);
    // Email messages are not on the project's cascade either — a held message
    // never had a project — so they go by their mailbox as well as by project.
    await client.query(`delete from email_messages where mailbox like 'demo@%' or project_id = $1`, [id]);
    await client.query(`delete from project_contacts where project_id = $1`, [id]);
    // A finish is RESTRICTed by the attributes that point at it, and the order
    // in which two cascades fire is not something to rely on. Unlinked first,
    // then removed, so the project delete has nothing left to trip over.
    await client.query(
      `update record_attributes set finish_id = null
        where finish_id in (select id from project_finishes where project_id = $1)`, [id],
    );
    await client.query(`delete from project_finishes where project_id = $1`, [id]);
    await client.query(`delete from projects where id = $1`, [id]);
    console.log(`  removed ${project.bws_project_number} and its files`);
  }
}

if (clear) {
  await sweep();
  await client.end();
  process.exit(0);
}

// ===========================================================================
// What it is going to build, said before it builds it.
// ===========================================================================
const existing = await client.query(`select id from projects where bws_project_number = $1`, [PROJECT.number]);
if (existing.rows.length > 0) {
  console.error(`${PROJECT.number} already exists. Remove it first:  npm run qa:demo -- --clear --apply`);
  await client.end();
  process.exit(1);
}

const billLines = BILL.length;
console.log(`${PROJECT.number} — ${PROJECT.name}`);
say("bill of quantities", `3 tabs, ${billLines} lines on the main run`);
say("shop drawings", `issue A (${DRAWINGS_A.length} sheets, confirmed) + issue B (${DRAWINGS_B.length} sheets, on the desk)`);
say("preamble", `${PREAMBLE_NOTES.length} notes`);
say("correspondence", `${INBOX.length} held in the inbox, 1 on the project awaiting review`);
say("finishes", `${Object.keys(FINISH_DETAIL).length} codes, each with a swatch`);
say("pictures", "one per record on the main run");

if (!apply) {
  console.log("\nDry run. Nothing was written and nothing was stored. Add --apply to build it.");
  await client.end();
  process.exit(0);
}

// Nothing below needs it until the summary, and the build is long enough that
// an idle socket does not survive it. See the note where it was opened.
await client.end();

console.log("");

// ===========================================================================
// 1. The project, its people and the delivery its documents arrived in.
// ===========================================================================
const project = await sql`
  insert into projects
    (bws_project_number, name, client, shared_inbox, order_date, specs_agreed_by, delivery_date,
     default_dimension_unit, status, created_by, updated_by)
  values
    (${PROJECT.number}, ${PROJECT.name}, ${PROJECT.client}, ${PROJECT.inbox},
     ${"2026-08-10"}, ${"2026-09-25"}, ${"2026-12-18"}, ${PROJECT.defaultUnit}, 'active', ${ACTOR}, ${ACTOR})
  returning id
`;
const projectId = String(project[0]?.id);
say("project", projectId);

for (const contact of CONTACTS) {
  await sql`
    insert into project_contacts (project_id, name, email, organisation, role, designer_code, created_by, updated_by)
    values (${projectId}, ${contact.name}, ${contact.email}, ${contact.organisation},
            ${contact.role === "Interior designer" ? "designer" : "client"},
            ${contact.role === "Fabric supplier" ? null : contact.code}, ${ACTOR}, ${ACTOR})
  `;
}
say("contacts", CONTACTS.map((contact) => contact.name).join(", "));

const batch = await sql`
  insert into intake_batches (project_id, label, created_by, updated_by)
  values (${projectId}, ${"Tender pack, issued 28 Aug"}, ${ACTOR}, ${ACTOR})
  returning id
`;
const batchId = String(batch[0]?.id);

// ===========================================================================
// 2. The bill of quantities: written as a real .xlsx, read back by the app's
//    own parser, staged the way the registration route stages one, confirmed
//    by the app's own confirm.
// ===========================================================================
async function buildBoqWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const tabs: [string, "mockUp" | "main" | "ve", { revision: string; date: string }][] = [
    ["MOCK-UP", "mockUp", BILL_METADATA.mockUp],
    ["MAIN RUN", "main", BILL_METADATA.main],
    ["MAIN RUN - VE", "ve", BILL_METADATA.ve],
  ];
  for (const [name, key, metadata] of tabs) {
    const sheet = workbook.addWorksheet(name);
    // The rows ABOVE the header, which carry the revision, the date and the
    // terms the run is priced under. A client template writes the label in one
    // cell and the value in the NEXT one, and this one does too.
    sheet.addRow([PROJECT.name]);
    sheet.addRow([BILL_METADATA.notes[0]]);
    sheet.addRow(["Revision:", metadata.revision, "", "Date:", metadata.date]);
    sheet.addRow([BILL_METADATA.notes[1]]);
    sheet.addRow([BILL_METADATA.notes[2]]);
    sheet.addRow([]);
    sheet.addRow(["Designer", "Category", "Area", "Code", "Item Description", "Product Reference", "TOTAL Q-ty", "Unit"]);
    for (const line of BILL) {
      const qty = line[key];
      if (qty === null) continue;
      sheet.addRow([
        line.designer,
        line.category,
        line.area,
        line.code,
        line.description,
        line.productReference,
        qty,
        "pcs",
      ]);
    }
    sheet.addRow([]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const boqBytes = await buildBoqWorkbook();
const boqName = "Ashcombe House - BOQ - Seating and Casegoods - Rev B.xlsx";
const boqPath = await store(`projects/${projectId}/demo/boq-rev-b.xlsx`, boqBytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
const boqAttachment = await sql`
  insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
  values ('project', ${projectId}, 'boq', ${boqPath}, ${boqName},
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ${boqBytes.byteLength}, ${ACTOR})
  returning id
`;

const boqRun = await sql`
  insert into intake_runs (project_id, attachment_id, batch_id, source_kind, status, created_by, updated_by)
  values (${projectId}, ${boqAttachment[0]?.id}, ${batchId}, 'boq_xlsx', 'parsing', ${ACTOR}, ${ACTOR})
  returning id
`;
const boqRunId = String(boqRun[0]?.id);

{
  // The staging block below mirrors `parseBoqInto` in src/app/api/imports/route.ts.
  // It is copied rather than called because that function is a route handler
  // returning a Response; the PARSING and the MATCHING are the app's own.
  const sheets = await readSpreadsheetSheets(boqBytes, boqName, "");
  const parsed = parseBoqSheets(sheets);
  if (!parsed.ok) throw new Error(`the demo bill did not parse: ${parsed.error}`);

  const categories = await sql`select id, name from item_categories`;
  const aliases = await sql`select category_id, term from item_category_aliases`;
  const candidates: MatchCandidate[] = [
    ...categories.map((row) => ({ id: String(row.id), name: String(row.name) })),
    ...aliases.map((row) => ({ id: String(row.category_id), name: String(row.term) })),
  ];

  const suggest = (line: { itemDescription: string; productReference?: string | null }, index: number) => {
    const guess = guessLevelFromBill(line);
    const level = guess
      ? { level: guess.level, levelStatus: "suggested" as const, levelReason: guess.reason }
      : { level: null, levelStatus: "suggested" as const, levelReason: null };
    const match = matchName(line.itemDescription, candidates);
    if (match.status === "confident") {
      return { index, ...line, ...level, categoryId: match.id, categoryStatus: "suggested", ignored: false };
    }
    if (match.status === "ambiguous") {
      const ids = [...new Set(match.candidates.map((candidate) => candidate.id))];
      if (ids.length === 1) {
        return { index, ...line, ...level, categoryId: ids[0] ?? null, categoryStatus: "suggested", ignored: false };
      }
      return {
        index, ...line, ...level, categoryId: null, categoryStatus: "ambiguous", ignored: false,
        categoryCandidates: ids.map((id) => ({
          id, name: String(categories.find((row) => String(row.id) === id)?.name ?? id),
        })),
      };
    }
    return { index, ...line, ...level, categoryId: null, categoryStatus: "none", ignored: false };
  };

  const stagedSheets = parsed.sheets.map((sheet) => ({ ...sheet, lines: sheet.lines.map(suggest) }));
  await sql`
    update intake_runs
       set status = 'parsed',
           parsed = ${JSON.stringify({
             schemaVersion: BOQ_SCHEMA_VERSION,
             filename: boqName,
             sourcePreserved: true,
             sheets: stagedSheets,
           })}::jsonb,
           updated_by = ${ACTOR}
     where id = ${boqRunId}
  `;
  say("bill parsed", `${stagedSheets.length} tabs, ${stagedSheets.reduce((total, sheet) => total + sheet.lines.length, 0)} lines`);
}

const confirmed = await withTransaction((txn) =>
  confirmBoqImport(txn, { runId: boqRunId, expectedVersion: null, actor: ACTOR }),
);
say("bill confirmed", `${confirmed.imported} records across ${confirmed.runIds.length} runs`);

const runs = await sql`select id, name from spec_runs where project_id = ${projectId} order by sort_order`;
const runByName = new Map(runs.map((row) => [String(row.name), String(row.id)]));

// The levels this app guessed, accepted a run at a time — which is what the
// screen's own button does. Left UNACCEPTED on the mock-up and VE runs, so the
// demo has something to press.
// ---- the categories nothing could choose ---------------------------------
//
// `matchName` returns AMBIGUOUS where a description reads as two categories —
// "Desk chair" is a desk chair and a desk, "Ottoman @ bed end" is an ottoman
// and a bed — and the confirm writes no category rather than picking one. That
// is the right refusal and it leaves the record with no checklist, so here a
// person settles them, through `setRecordCategory`, which is what the record
// screen calls. `JU-950` is left alone on purpose: nothing matches a bespoke
// joinery unit, and a project with one uncategorised record is worth showing.
{
  const categories = await sql`select id, slug from item_categories`;
  const bySlug = new Map(categories.map((row) => [String(row.slug), String(row.id)]));
  const byCode: Record<string, string> = {
    "AC-102": "desk-chair-cinema-chair",
    "OT-401": "ottomans-storage-boxes",
    "SD-502": "side-coffee-bedside-tables",
  };
  let set = 0;
  for (const [code, slug] of Object.entries(byCode)) {
    const categoryId = bySlug.get(slug);
    if (!categoryId) continue;
    const rows = await sql`
      select r.id, r.version from spec_records r
      join spec_record_refs f on f.record_id = r.id and f.ref_system = 'boq_code' and f.ref_value = ${code}
      where r.project_id = ${projectId} and r.category_id is null and r.status = 'active'
    `;
    for (const row of rows) {
      await withTransaction((txn) =>
        setRecordCategory(txn, { recordId: String(row.id), categoryId, expectedVersion: Number(row.version), actor: ACTOR }),
      );
      set += 1;
    }
  }
  say("categories settled", `${set} records the bill could not place on its own`);
}

const mainRunId = runByName.get("MAIN RUN") ?? null;
if (mainRunId) {
  const accepted = await withTransaction((txn) =>
    acceptSuggestedLevels(txn, { projectId, runId: mainRunId, actor: ACTOR }),
  );
  say("levels accepted", `${accepted.accepted} on the main run; the other two runs are left to demonstrate`);
}

// ===========================================================================
// 3. The shop drawings.
//
// THE MODEL IS NOT CALLED. `rawDrawingItems()` returns what a read WOULD have
// returned, in the model's own output shape, from the same figures the PDF
// prints — and `stageDrawings` is the app's own. Everything the review screen
// then does (the unit resolution, the slot guessing, the note merging, the
// callout classification, the run fan-out, the blockers) is real.
// ===========================================================================
const fieldRows = await sql`select id, json_id, name from spec_fields order by sort_order`;
const fields = specFieldEntries(fieldRows);

type RecordEntry = {
  id: string; recordNo: number; label: string; itemDescription: string; categoryId: string | null;
  categoryName: string | null; refs: string[]; boqCodes: string[]; parentId: string | null;
  variantLabel: string | null; runId: string; runName: string; version: number;
};

async function loadRecords(): Promise<RecordEntry[]> {
  const rows = await sql`
    select r.id, r.record_no, r.item_description, r.category_id, r.version,
           r.run_id, run.name as run_name, p.bws_project_number, r.parent_id, r.variant_label,
           coalesce((select array_agg(x.ref_value order by x.ref_value)
                       from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code'), '{}') as boq_codes
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    where r.project_id = ${projectId} and r.status = 'active'
    order by run.sort_order, r.record_no
  `;
  return rows.map((row) => ({
    id: String(row.id),
    recordNo: Number(row.record_no),
    label: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
    itemDescription: String(row.item_description),
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: null,
    refs: (row.boq_codes as string[] | null)?.map(String) ?? [],
    boqCodes: (row.boq_codes as string[] | null)?.map(String) ?? [],
    parentId: row.parent_id ? String(row.parent_id) : null,
    variantLabel: row.variant_label ? String(row.variant_label) : null,
    runId: String(row.run_id),
    runName: String(row.run_name),
    version: Number(row.version),
  }));
}

async function stageDrawingRun(
  drawings: DemoDrawing[],
  revision: string,
  documentNotes: string,
): Promise<{ runId: string; pathname: string }> {
  const bytes = drawingPdf(drawings, revision);
  const filename = `Ashcombe House - Shop Drawings - Issue ${revision}.pdf`;
  const pathname = await store(`projects/${projectId}/demo/drawings-issue-${revision.toLowerCase()}.pdf`, bytes, "application/pdf");
  const attachment = await sql`
    insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
    values ('project', ${projectId}, 'spec_document', ${pathname}, ${filename}, 'application/pdf', ${bytes.byteLength}, ${ACTOR})
    returning id
  `;
  const staged = stageDrawings(rawDrawingItems(drawings), fields, filename, documentNotes, "mm");
  const run = await sql`
    insert into intake_runs
      (project_id, attachment_id, batch_id, source_kind, document_kind, status, parsed, model, model_metadata,
       registration_request_id, created_by, updated_by)
    values
      (${projectId}, ${attachment[0]?.id}, ${batchId}, 'spec_document', 'shop_drawings', 'parsed',
       ${JSON.stringify(staged)}::jsonb, ${"demo (no model call)"},
       ${JSON.stringify({ demo: true, proposals: staged.items.reduce((total, item) => total + item.observations.length, 0) })}::jsonb,
       ${`demo:drawings:${revision}:${projectId}`}, ${ACTOR}, ${ACTOR})
    returning id
  `;
  return { runId: String(run[0]?.id), pathname };
}

const issueA = await stageDrawingRun(
  DRAWINGS_A,
  "A",
  "Four seating and upholstery sheets. Figures on SD-100 are drawn without a printed unit; the rest state millimetres.",
);
say("drawings issue A", `${DRAWINGS_A.length} sheets staged`);

await stageDrawingRun(
  DRAWINGS_B,
  "B",
  "A second issue. The desk chair is drawn twice, once per fabric. SD-002 is a general arrangement and names no item.",
);
say("drawings issue B", `${DRAWINGS_B.length} sheets staged, left on the reviewer's desk`);

// ---- confirming issue A, card by card, with a picture and its swatches -----
//
// One request per card, which is what the screen issues: the record is the
// unit of commit, so a card either applies whole or applies not at all.
{
  const records = await loadRecords();

  for (const [index, drawing] of DRAWINGS_A.entries()) {
    // RE-READ THE STAGED DOCUMENT EVERY TIME.
    //
    // `confirmDrawingItem` rewrites this run's `parsed` — the observations it
    // applied go to `reviewed` and their versions move. Holding one copy
    // across the loop and writing it back for the next card's targets rewinds
    // every card confirmed before it: the specs stay written, but the review
    // screen shows them pending again and re-confirming raises a replace
    // blocker on a value nobody changed. Found on the first real build, where
    // three of issue A's four cards came back as unreviewed.
    const staged = assertStagedDrawings(
      (await sql`select parsed from intake_runs where id = ${issueA.runId}`)[0]?.parsed,
      fields,
    ) as StagedDrawings;
    const item = staged.items[index];
    if (!item) continue;

    const resolution = resolveDrawingTargets(item.itemCodeRaw, records);
    if (resolution.suggested.length === 0) {
      say("  card skipped", `${drawing.sheet} resolves to no record`);
      continue;
    }

    // The reviewer's tick, written into the staged document exactly as the
    // screen's autosave writes it. The item version is NOT bumped: this is the
    // decision the confirm is about to check, not an edit underneath it.
    const withTargets = {
      ...staged,
      items: staged.items.map((row) =>
        row.id === item.id ? { ...row, targets: { ticked: resolution.suggested, unticked: [] } } : row,
      ),
    };
    await sql`update intake_runs set parsed = ${JSON.stringify(withTargets)}::jsonb where id = ${issueA.runId}`;

    // The picture, and a swatch for every callout carrying a finish code.
    //
    // A reviewer crops this off the page in front of them, so a real crop off
    // a real drawing is the honest thing to show here — borrowed where the
    // sandbox has one for this kind of item, drawn where it does not.
    const borrowed = drawing.code ? await realPictureFor(drawing.code) : null;
    const picture = borrowed ? null : itemPicture(drawing);
    const picturePath =
      borrowed?.pathname ??
      (await store(
        `projects/${projectId}/demo/picture-${(drawing.code ?? drawing.sheet).toLowerCase()}.png`,
        picture!,
        "image/png",
      ));
    const swatches: { observationId: string; pathname: string; filename: string; size: number }[] = [];
    for (const observation of item.observations) {
      const code = observation.materialCodeRaw;
      if (!code) continue;
      const bytes = swatch(code);
      swatches.push({
        observationId: observation.id,
        pathname: await store(`projects/${projectId}/demo/swatch-${code.toLowerCase()}.png`, bytes, "image/png"),
        filename: `${code}.png`,
        size: bytes.byteLength,
      });
    }

    const pending = item.observations.filter((row) => row.reviewStatus === "pending");
    const result = await withTransaction((txn) =>
      confirmDrawingItem(txn, {
        runId: issueA.runId,
        expectedVersion: null,
        itemId: item.id,
        itemVersion: item.version,
        observations: pending.map((row) => ({ id: row.id, version: row.version })),
        image: {
          pathname: picturePath,
          filename: `${drawing.code ?? drawing.sheet}.png`,
          width: borrowed?.width ?? 520,
          height: borrowed?.height ?? 380,
          size: borrowed?.size ?? picture!.byteLength,
        },
        swatches,
        actor: ACTOR,
      }),
    );
    say(`  ${drawing.sheet} ${drawing.code ?? ""}`, `${result.applied} specs onto ${result.records} records, ${result.answersFilled} answers filled`);
  }
}

// ===========================================================================
// 4. The FF&E preamble: what the pack says about the package as a whole.
// ===========================================================================
{
  const bytes = preamblePdf(PREAMBLE_NOTES);
  const filename = "Ashcombe House - FF&E Preamble - Issue B.pdf";
  const pathname = await store(`projects/${projectId}/demo/preamble.pdf`, bytes, "application/pdf");
  const attachment = await sql`
    insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
    values ('project', ${projectId}, 'spec_document', ${pathname}, ${filename}, 'application/pdf', ${bytes.byteLength}, ${ACTOR})
    returning id
  `;
  const staged = stagePreamble(PREAMBLE_NOTES, filename, "Package-wide requirements. Nothing here is about one item.");
  const run = await sql`
    insert into intake_runs
      (project_id, attachment_id, batch_id, source_kind, document_kind, status, parsed, model,
       registration_request_id, created_by, updated_by)
    values (${projectId}, ${attachment[0]?.id}, ${batchId}, 'spec_document', 'preamble', 'parsed',
            ${JSON.stringify(staged)}::jsonb, ${"demo (no model call)"},
            ${`demo:preamble:${projectId}`}, ${ACTOR}, ${ACTOR})
    returning id
  `;
  const runId = String(run[0]?.id);
  const result = await withTransaction((txn) =>
    confirmPreambleNotes(txn, {
      runId,
      expectedVersion: null,
      notes: staged.notes.map((note) => ({ id: note.id, version: note.version })),
      actor: ACTOR,
    }),
  );
  say("preamble confirmed", `${result.applied} notes onto the project`);
}

// ===========================================================================
// 5. The finishes library.
//
// The drawing confirms have already created a row for every code their
// callouts carried. These are the rest — the codes somebody pastes in off the
// finishes schedule — and then every row is filled in, which is the library's
// edit-once rule doing its work: one edit moves every item carrying the code.
// ===========================================================================
{
  const existingFinishes = await sql`select id, code, version from project_finishes where project_id = ${projectId}`;
  const byCode = new Map(existingFinishes.map((row) => [String(row.code), { id: String(row.id), version: Number(row.version) }]));

  const toCreate = [...PASTED_FINISHES, ...Object.keys(FINISH_DETAIL)].filter(
    (code, index, all) => all.indexOf(code) === index && !byCode.has(code),
  );
  for (const code of toCreate) {
    const id = await withTransaction((txn) => createFinish(txn, { projectId, fields: { code }, actor: ACTOR }));
    byCode.set(code, { id, version: 1 });
  }
  say("finishes created", `${byCode.size} codes (${toCreate.length} pasted in, the rest off the drawings)`);

  // Filled in, one at a time, each its own change — which is what a person
  // doing it on the library screen produces.
  let filled = 0;
  for (const [code, finish] of byCode) {
    const detail = FINISH_DETAIL[code];
    if (!detail) continue;
    const { editFinish } = await import("@/lib/finish-edit");
    const result = await withTransaction((txn) =>
      editFinish(txn, {
        projectId,
        finishId: finish.id,
        expectedVersion: finish.version,
        fields: {
          code,
          kind: detail.kind as never,
          description: detail.description,
          supplierRaw: detail.supplier,
          reference: detail.reference,
          colour: null,
          notes: null,
          state: "confirmed",
        },
        reason: "Filled in from the finishes schedule issued with the tender pack.",
        actor: ACTOR,
      }),
    );
    filled += 1;
    if (result.recordsTouched > 0) {
      say(`  ${code}`, `${result.recordsTouched} records, ${result.answersFilled} answers re-rendered`);
    }

    // A swatch for every code, including the ones no drawing has reached yet.
    const already = await sql`
      select id from attachments
      where entity_type = 'project_finishes' and entity_id = ${finish.id}
        and kind = 'finish_swatch' and superseded_at is null
    `;
    if (already.length > 0) continue;
    const bytes = swatch(code);
    const pathname = await store(`projects/${projectId}/demo/swatch-${code.toLowerCase()}.png`, bytes, "image/png");
    await sql`
      insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
      values ('project_finishes', ${finish.id}, 'finish_swatch', ${pathname}, ${`${code}.png`}, 'image/png',
              ${bytes.byteLength}, ${ACTOR})
    `;
  }
  say("finishes filled in", `${filled} with a description, a supplier and a swatch`);
}

// ===========================================================================
// 6. A picture on every record.
//
// The app gets these from a reviewer cropping a drawing page, and the four
// cards confirmed above did exactly that. The rest of the bill has no drawing
// yet, so their pictures are written the way that confirm writes one — an
// `item_image` attachment under the project's own prefix — with the crop
// skipped. It is the one place this script writes something the app would
// normally only write behind a human's click, and it does it because a spec
// table where three rows in fifty have a picture demonstrates nothing.
// ===========================================================================
{
  const silhouetteFor: Record<string, string> = {
    AC: "armchair", SO: "sofa", BE: "bench", ST: "ottoman", HB: "headboard",
    OT: "ottoman", CT: "table", SD: "table", BT: "bedside", DK: "table",
    WR: "wardrobe", DR: "bedside", MR: "wardrobe", LB: "bench", JU: "wardrobe",
  };
  const records = await sql`
    select r.id, r.item_description,
           (select x.ref_value from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code' limit 1) as code
    from spec_records r
    where r.project_id = ${projectId} and r.status = 'active'
      and not exists (
        select 1 from attachments a
        where a.entity_type = 'spec_records' and a.entity_id = r.id and a.kind = 'item_image'
      )
  `;
  const cached = new Map<string, string>();
  let drawn = 0;
  let real = 0;
  for (const row of records) {
    const code = row.code ? String(row.code) : null;
    if (!code) continue;
    let pathname = cached.get(code);
    let size = 0;
    if (!pathname) {
      // A real cropped view off the source pack where there is one for this
      // kind of item, and the drawn silhouette where there is not.
      const borrowed = await realPictureFor(code);
      if (borrowed) {
        pathname = borrowed.pathname;
        size = borrowed.size;
        real += 1;
      } else {
        const kind = silhouetteFor[code.slice(0, 2)] ?? "table";
        const bytes = itemPicture({
          sheet: code, code, name: String(row.item_description).split("@")[0]?.trim() ?? code,
          silhouette: kind as never, callouts: [], notes: [], unitPrinted: "mm", scale: "",
          view3d: [0, 0, 1, 1],
        });
        size = bytes.byteLength;
        pathname = await store(`projects/${projectId}/demo/picture-${code.toLowerCase()}.png`, bytes, "image/png");
      }
      cached.set(code, pathname);
    }
    await sql`
      insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
      values ('spec_records', ${row.id}, 'item_image', ${pathname}, ${`${code}.png`}, 'image/png', ${size || null}, ${ACTOR})
    `;
    drawn += 1;
  }
  say("pictures", `${drawn} records given one (${real} real crops, the rest drawn); the confirmed cards already had theirs`);
}

// ===========================================================================
// 7. The correspondence.
//
// Every message goes through `recordMessage`, so the inbox screen shows what
// routing ACTUALLY decided rather than what this script hoped it would. The
// five below are HELD: assignment is the spend point, and it stays a click.
//
// The sixth is the exception, and it is assigned by reproducing what
// `assignMessage` writes rather than by calling it — that function publishes a
// queue attempt, which is a paid model read, and this script is going to be
// re-run. Its staged output is written straight in, from `resolveProposals`.
// ===========================================================================
const MAILBOX = "demo@ashcombe.example.com";

function rfc2822(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const two = (value: number) => String(value).padStart(2, "0");
  return (
    `${days[date.getUTCDay()]}, ${two(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} +0000`
  );
}

function receivedAt(message: { daysAgo: number; hour: number }): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - message.daysAgo);
  date.setUTCHours(message.hour, 0, 0, 0);
  return date;
}

function eml(message: DemoMessage | typeof REVIEW_EMAIL): { bytes: Buffer; messageId: string } {
  const date = receivedAt(message);
  const messageId = `<demo.${message.key}.${date.getTime()}@example.com>`;
  const headers = [
    `Message-ID: ${messageId}`,
    `Date: ${rfc2822(date)}`,
    `From: ${message.from}`,
    `To: ${message.to.join(", ")}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(", ")}`] : []),
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    "X-Mailer: Microsoft Outlook 16.0",
    "X-Demo-Fixture: invented correspondence, spec builder demo project",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  return { bytes: Buffer.from(`${headers.join("\r\n")}\r\n\r\n${message.body}\r\n`, "utf8"), messageId };
}

function mailboxPath(key: string, received: Date): string {
  const yyyy = String(received.getUTCFullYear());
  const mm = String(received.getUTCMonth() + 1).padStart(2, "0");
  return `mailbox/${MAILBOX.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}/${yyyy}/${mm}/demo-${key}.eml`;
}

for (const message of INBOX) {
  const received = receivedAt(message);
  const { bytes } = eml(message);
  const storagePath = mailboxPath(message.key, received);
  await store(storagePath, bytes, "message/rfc822");
  const recorded = await recordMessage({
    mailbox: MAILBOX,
    origin: "graph",
    graphMessageId: `demo_${message.key}`,
    bytes,
    storagePath,
    mimeSize: bytes.byteLength,
    actor: ACTOR,
  });
  const outcome =
    recorded.routing.status === "assigned"
      ? `would place on a project — ${recorded.routing.evidence}`
      : recorded.routing.status;
  say(`  ${message.subject.slice(0, 40)}`, outcome);
}
say("inbox", `${INBOX.length} messages, all held`);

// ---- the one that is on the project, staged and waiting to be reviewed -----
{
  const received = receivedAt(REVIEW_EMAIL);
  const { bytes } = eml(REVIEW_EMAIL);
  const storagePath = mailboxPath(REVIEW_EMAIL.key, received);
  await store(storagePath, bytes, "message/rfc822");
  const recorded = await recordMessage({
    mailbox: MAILBOX,
    origin: "graph",
    graphMessageId: `demo_${REVIEW_EMAIL.key}`,
    bytes,
    storagePath,
    mimeSize: bytes.byteLength,
    actor: ACTOR,
    intendedProjectId: projectId,
  });

  // Copied under the project's own prefix, never moved: the mailbox path is
  // the arrival record, and every read is scoped to `projects/<id>/`.
  const projectPath = await store(`projects/${projectId}/email/${recorded.id}.eml`, bytes, "message/rfc822");

  const registers = await loadExtractionRegisters(projectId);
  const staged = {
    schemaVersion: PROPOSAL_SCHEMA_VERSION,
    lines: resolveProposals(REVIEW_EMAIL.proposals, registers, randomUUID),
    documentNotes: REVIEW_EMAIL.documentNotes,
    filename: `${REVIEW_EMAIL.subject}.eml`,
  };

  const attachment = await sql`
    insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
    values ('email_messages', ${recorded.id}, 'mime', ${projectPath},
            ${`${REVIEW_EMAIL.subject.replace(/[^\w .-]+/g, " ").trim()}.eml`}, 'message/rfc822',
            ${bytes.byteLength}, ${ACTOR})
    returning id
  `;
  const run = await sql`
    insert into intake_runs
      (project_id, attachment_id, source_kind, document_kind, status, parsed, model,
       registration_request_id, created_by, updated_by)
    values (${projectId}, ${attachment[0]?.id}, 'spec_document', 'email', 'parsed',
            ${JSON.stringify(staged)}::jsonb, ${"demo (no model call)"},
            ${`email:${recorded.id}`}, ${ACTOR}, ${ACTOR})
    returning id
  `;
  await sql`
    update email_messages
       set project_id = ${projectId}, routing_status = 'assigned', assigned_by = ${ACTOR}, assigned_at = now(),
           assignment_kind = 'manual', mime_attachment_id = ${attachment[0]?.id}, intake_run_id = ${run[0]?.id},
           updated_by = ${ACTOR}
     where id = ${recorded.id}
  `;
  const placed = staged.lines.filter((line) => line.recordId).length;
  say("email on the project", `${staged.lines.length} proposals, ${placed} with their record already resolved`);
}

// ===========================================================================
// 8. A few answers typed by a person.
//
// Everything so far came off a document. These are the ones a KAM answers from
// a phone call or from the preamble — and they matter to the demo because a
// person's answer is the one thing no later document may overwrite.
// ===========================================================================
{
  const wanted: { match: string; value: string | null; state: "confirmed" | "tbc" | "na" }[] = [
    { match: "fire", value: "Crib 5 throughout, certification with the first delivery", state: "confirmed" },
    { match: "warrant", value: "Five years on frames, two on upholstery and finishes", state: "confirmed" },
    { match: "delivery", value: "Access is 780mm — demountable where wider", state: "confirmed" },
    { match: "assembly", value: null, state: "tbc" },
    { match: "castor", value: null, state: "na" },
  ];
  let edited = 0;
  for (const target of wanted) {
    const rows = await sql`
      select a.id, a.version, q.prompt
      from spec_answers a
      join requirements q on q.id = a.requirement_id
      join spec_records r on r.id = a.record_id
      where r.project_id = ${projectId} and r.status = 'active' and a.state = 'missing'
        and lower(q.prompt) like ${`%${target.match}%`}
      order by r.record_no
      limit 4
    `;
    for (const row of rows) {
      await withTransaction((txn) =>
        editAnswer(txn, {
          answerId: String(row.id),
          value: target.value,
          state: target.state,
          expectedVersion: Number(row.version),
          reason: "Answered from the preamble at tender review.",
          actor: ACTOR,
        }),
      );
      edited += 1;
    }
  }
  say("answers typed in", `${edited} confirmed, TBC or not-applicable by hand`);
}

// ===========================================================================
// 8b. The rest of the checklist, worked up the way a KAM works one up.
//
// Steps 1-8 leave the project about 4% answered, which is an honest picture of
// a pack that has just been read and a poor one to open a walkthrough on: the
// spec table is a wall of "missing", every gate is blocked for the same reason
// and nothing distinguishes the questions that are genuinely waiting on
// somebody. `tools/demo/answers.ts` carries the rest — the commercial terms,
// the access and site facts, the build details — and the gap it leaves is
// designed rather than left over.
//
// ONE OPEN CHANGE FOR ALL OF IT. `changeSetForEdit` attaches an edit with no
// reason of its own to the actor's open change (CLAUDE.md: at most one per
// actor per project), and `snapshotRecords` is `on conflict (record_id,
// change_set_id) do nothing`. So this whole pass is ONE entry in the trail and
// ONE new version per record, which is what a person working through a
// checklist in an afternoon actually produces — not eleven hundred of them.
// ===========================================================================
{
  const { demoAnswerFor } = await import("./demo/answers");
  const { closeChangeSet } = await import("@/lib/change-sets");

  const pending = await sql`
    select a.id, a.version, q.prompt,
           r.id as record_id, r.item_description, r.level, r.level_suggested,
           ic.name as category,
           (select x.ref_value from spec_record_refs x
             where x.record_id = r.id and x.ref_system = 'boq_code' limit 1) as code
    from spec_answers a
    join spec_records r on r.id = a.record_id
    join requirements q on q.id = a.requirement_id
    left join item_categories ic on ic.id = r.category_id
    where r.project_id = ${projectId} and r.status = 'active' and a.state = 'missing'
    order by r.record_no, q.sort_order
  `;

  // Grouped by record so one transaction covers one record's whole checklist.
  const byRecord = new Map<string, typeof pending>();
  for (const row of pending) {
    const key = String(row.record_id);
    if (!byRecord.has(key)) byRecord.set(key, [] as unknown as typeof pending);
    byRecord.get(key)!.push(row);
  }

  const changeSetId = await withTransaction((txn) =>
    openChangeSet(txn, {
      projectId,
      kind: "manual_edit",
      reason: "Specification worked up from the terms of business, the site visit and the designer's replies.",
      actor: ACTOR,
      open: true,
    }),
  );

  let written = 0;
  let skipped = 0;
  for (const [recordId, rows] of byRecord) {
    const first = rows[0]!;
    const context = {
      code: first.code ? String(first.code) : null,
      description: String(first.item_description),
      category: first.category ? String(first.category) : null,
      level: first.level ? String(first.level) : first.level_suggested ? String(first.level_suggested) : null,
    };
    const planned = rows
      .map((row) => ({ row, answer: demoAnswerFor(String(row.prompt), context) }))
      .filter((entry): entry is { row: (typeof rows)[number]; answer: NonNullable<ReturnType<typeof demoAnswerFor>> } =>
        entry.answer !== null,
      );
    skipped += rows.length - planned.length;
    if (planned.length === 0) continue;

    // One transaction per record. Every edit inside it finds the open change
    // above and attaches, so the record takes exactly one new version.
    await withTransaction(async (txn) => {
      for (const { row, answer } of planned) {
        await editAnswer(txn, {
          answerId: String(row.id),
          value: answer.value,
          state: answer.state,
          expectedVersion: Number(row.version),
          actor: ACTOR,
        });
      }
    });
    written += planned.length;
    say(`  ${context.code ?? recordId.slice(0, 8)}`, `${planned.length} answered, ${rows.length - planned.length} left for the designer`);
  }

  await withTransaction((txn) => closeChangeSet(txn, changeSetId, ACTOR));
  say("checklist worked up", `${written} answered by hand, ${skipped} deliberately left outstanding`);
}

// ===========================================================================
// 9. A baseline, and then a change after it — so comparing two points shows
//    something rather than nothing.
// ===========================================================================
{
  const baseline = await withTransaction((txn) =>
    takeBaseline(txn, {
      projectId,
      label: "Tender issue A",
      reason: "The position the tender was priced against, before the mock up room review.",
      actor: ACTOR,
    }),
  );
  say("baseline taken", `“${baseline.label}” — ${baseline.members} records`);

  // One decision taken after it: the two hero items get their level set by
  // hand, which is a change the comparison will report.
  const heroes = await sql`
    select id, version from spec_records
    where project_id = ${projectId} and status = 'active' and level_suggested = 'hero'
    limit 2
  `;
  for (const row of heroes) {
    await withTransaction((txn) =>
      setRecordLevel(txn, { recordId: String(row.id), level: "hero", expectedVersion: Number(row.version), actor: ACTOR }),
    );
  }
  if (heroes.length > 0) say("change after it", `${heroes.length} levels decided, so a comparison has something to report`);
}

// ===========================================================================
// 10. The chase.
//
// One email already sent, so the Waiting column has something in it, and one
// still being prepared. Both are written the way POST /api/drafts/generate
// writes them — same rendering, same coverage snapshot, same tier on the row.
// Nothing here sends anything: there is no send path in this app.
// ===========================================================================
{
  const { loadOutstanding, coveredFromQuestion, groupsFromCovered, groupByContact } = await import("@/lib/chase-drafts");
  const { buildChaseEmail, defaultClosing, defaultIntro, tierCounts, TEMPLATE_VERSION } = await import("@/lib/chase-template");
  const { ANSWER_STATE_LABELS } = await import("@/lib/spec-vocab");

  const contactRows = await sql`
    select id, name, email, organisation, role, designer_code, version from project_contacts where project_id = ${projectId}
  `;
  const contacts = contactRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: row.email ? String(row.email) : null,
    organisation: row.organisation ? String(row.organisation) : null,
    role: String(row.role) as "designer" | "client" | "internal",
    designerCode: row.designer_code ? String(row.designer_code) : null,
    version: Number(row.version),
  }));

  const outstanding = await loadOutstanding(projectId);
  const { groups, blocked } = groupByContact(outstanding, contacts);
  const designer = groups.find((group) => group.contact.role === "designer");

  if (designer) {
    const projectLabel = `${PROJECT.number} ${PROJECT.name}`;
    // The questions that block a QUOTE go in the sent one; the rest wait.
    const toQuote = designer.questions.filter((question) => question.tier === "to_quote").slice(0, 14);
    const rest = designer.questions.filter((question) => !toQuote.includes(question)).slice(0, 26);

    const writeDraft = async (
      questions: typeof designer.questions,
      status: "draft" | "sent",
      sentDaysAgo: number | null,
    ): Promise<void> => {
      if (questions.length === 0) return;
      const covered = questions.map(coveredFromQuestion);
      const chaseGroups = groupsFromCovered(covered);
      const intro = defaultIntro(projectLabel, tierCounts(chaseGroups));
      const closing = defaultClosing();
      const { subject, body } = buildChaseEmail({
        projectLabel,
        contactName: designer.contact.name,
        intro,
        closing,
        groups: chaseGroups,
        now: new Date(),
        environmentPrefix: "[STAGING]",
      });
      const sentAt = sentDaysAgo === null ? null : new Date(Date.now() - sentDaysAgo * 86_400_000).toISOString();
      const draftRows = await sql`
        insert into email_drafts
          (project_id, contact_id, kind, status, intro_text, closing_text, subject, body, body_format,
           template_version, recipient_name, recipient_email, cc_email, contact_version, project_label,
           sent_at, sent_by, created_by, updated_by)
        values
          (${projectId}, ${designer.contact.id}, 'chase', ${status}, ${intro}, ${closing}, ${subject}, ${body},
           'html', ${TEMPLATE_VERSION}, ${designer.contact.name}, ${designer.contact.email}, ${PROJECT.inbox},
           ${designer.contact.version}, ${projectLabel}, ${sentAt}, ${status === "sent" ? ACTOR : null},
           ${ACTOR}, ${ACTOR})
        returning id
      `;
      const draftId = String(draftRows[0]?.id);
      let sortOrder = 0;
      for (const item of covered) {
        sortOrder += 1;
        await sql`
          insert into email_draft_items
            (draft_id, record_id, requirement_id, revision_no, answer_id, snapshot_answer_version, record_version,
             context_snapshot, prompt_text, field_label, current_value_text, sort_order, tier, record_no,
             requirement_sort, created_by)
          values
            (${draftId}, ${item.recordId}, ${item.requirementId}, 0, ${item.answerId}, ${item.answerVersion},
             ${item.recordVersion}, ${JSON.stringify(item.context)}::jsonb, ${item.prompt}, ${item.fieldLabel},
             ${item.currentValueText ?? ANSWER_STATE_LABELS[item.context.state]}, ${sortOrder}, ${item.tier},
             ${item.recordNo}, ${item.requirementSort}, ${ACTOR})
        `;
      }
      say(`  ${status === "sent" ? "sent draft" : "current draft"}`, `${covered.length} questions to ${designer.contact.name}`);
    };

    await writeDraft(toQuote, "sent", 4);
    await writeDraft(rest, "draft", null);
  }
  say("chase", `${groups.length} recipient(s), ${blocked.length} record(s) blocked and named`);
}

// ===========================================================================
// 11. The document that is NOT loaded.
//
// Written to disk instead, so there is something to upload while somebody is
// watching. See the header on DRAWINGS_LIVE: this is the only part of the
// demo that goes through registration, the queue, the worker and the model
// for real, and it is the part that proves the rest was not staged by hand.
//
// It is written OUTSIDE any project prefix and never registered here. Putting
// it in the store would make it a document the app already holds, which is
// exactly what it must not be.
// ===========================================================================
{
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { DRAWINGS_LIVE } = await import("./demo/content");

  const directory = join(process.cwd(), "demo-documents");
  mkdirSync(directory, { recursive: true });
  const filename = "Ashcombe House - Shop Drawings - Issue C.pdf";
  const path = join(directory, filename);
  writeFileSync(path, drawingPdf(DRAWINGS_LIVE, "C"));
  say("live document written", path);
  say("", `${DRAWINGS_LIVE.length} sheets — ${DRAWINGS_LIVE.map((d) => `${d.sheet} ${d.code}`).join(", ")}`);
}

// ===========================================================================
// What was built.
// ===========================================================================
// A fresh connection: the one opened at the top was closed before the build.
client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const summary = await client.query(
  `select
     (select count(*) from spec_records where project_id = $1 and status = 'active') records,
     (select count(*) from spec_runs where project_id = $1) runs,
     (select count(*) from record_attributes a join spec_records r on r.id = a.record_id
       where r.project_id = $1 and a.status = 'active') attributes,
     (select count(*) from spec_answers a join spec_records r on r.id = a.record_id
       where r.project_id = $1 and a.state <> 'missing') answered,
     (select count(*) from project_finishes where project_id = $1) finishes,
     (select count(*) from project_notes where project_id = $1) notes,
     (select count(*) from change_sets where project_id = $1) changes,
     (select count(*) from record_snapshots s join spec_records r on r.id = s.record_id where r.project_id = $1) versions,
     (select count(*) from email_messages where project_id = $1) emails_on_project,
     (select count(*) from email_drafts where project_id = $1) drafts,
     (select count(*) from attachments where entity_type = 'spec_records'
        and entity_id in (select id from spec_records where project_id = $1) and kind = 'item_image') pictures`,
  [projectId],
);
const row = summary.rows[0] as Record<string, string>;
console.log(`\n${PROJECT.number} built.\n`);
for (const [key, value] of Object.entries(row)) say(key.replace(/_/g, " "), String(value));
console.log(`\n  ${stored.length} files stored under projects/${projectId}/ and mailbox/`);
console.log(`\n  Open it at /dashboard/projects/${projectId}`);
console.log("  Remove it again with:  npm run qa:demo -- --clear --apply\n");

await client.end();
