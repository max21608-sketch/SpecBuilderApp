#!/usr/bin/env node
// THE FIRST SESSION, DRIVEN — the release gate for Stage 1a.
//
//   PLAYWRIGHT_DIR=/path/to/scratchpad/pw \
//   PLAYWRIGHT_CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
//   BASE=http://localhost:3000 QA_EMAIL=... QA_PASSWORD=... \
//   node --env-file=.env.local .claude/skills/verify/files/first-session.mjs
//
//   ... --keep        leave the __QA project behind for a person to look at
//   ... --headed      watch it
//
// ============================================================================
// WHAT IT IS, AND WHY IT COSTS NOTHING
//
// `docs/plans/make-it-work-2026-09-19.md` §7.4: a script that does exactly what
// Matthew will do in his first session, against a `__QA` copy, so the wall is
// found before he hits it. The four checks were green through every defect the
// demo exposed; this is the thing that walks the flow.
//
// IT NEVER CALLS THE MODEL, and that is a design constraint rather than a
// preference: a release gate that costs money is a release gate people skip.
// Three consequences, each visible in the code below:
//
//   * IT REFUSES TO UPLOAD A SPECIFICATION DOCUMENT. A PDF, a drawing set or
//     an .eml is a charged read the moment it registers. Steps 5-9 run on a
//     CLONE of a pack the sandbox has already read.
//   * IT DECLARES THE BILL'S KIND rather than letting the classifier answer.
//     `/api/imports/classify` is a Haiku call — small, and still a call. The
//     upload screen's own rule is that a person's choice beats the suggestion,
//     so choosing is a real user action and not a way round the screen.
//   * A BILL OF QUANTITIES IS PARSED BY CODE. Uploading one costs nothing,
//     which is why steps 3-4 are a real upload of a real (synthetic) file.
//
// WHAT IT ASSERTS. Every assertion names the plan item it is the gate for, so
// an item that regresses is reported by number. Items not yet on `staging` are
// written and SKIPPED, with the number printed at the end, so the orchestrator
// flips one on as each lands rather than writing it then.
//
// IT IS NOT A SUBSTITUTE FOR MATTHEW, and it is not the visual review (§7.4a).
// It answers "does the flow work", nothing else.
//
// ---- WHERE IT RUNS -------------------------------------------------------
//
// From the REPO, so `pg` and `exceljs` resolve from the repo's own
// node_modules. Playwright is deliberately NOT a repo dependency (the skill
// insists, and a verification tool in package.json is one product code starts
// importing), so `PLAYWRIGHT_DIR` names the scratchpad project it IS installed
// in and `playwright-session.mjs` is imported from there by path — a module in
// that directory resolves `playwright` from that directory's node_modules.
//
// `BASE` comes from the environment, so the same script runs against local,
// against staging on a deployed SHA, and against pilot before a promotion.
// ============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { buildFixtureBill, FIXTURE_BILL_COUNTS, FIXTURE_BILL_FILENAME } from "./first-session-fixtures.mjs";

// ---- the pack this walk borrows, and the run it clones ---------------------
//
// One staged shop-drawings run on the sandbox's AP364e Panther project, read
// once and re-used for ever. It carries `S-100` (which the synthetic bill also
// carries, so the card resolves) and the `TBC – Yarn Collective…` fabric that
// plan item 1.8 is about.
const SOURCE_PROJECT = process.env.SOURCE_PROJECT ?? "188c6e2d-867e-4b81-96d0-d0797a2acdf0";
const SOURCE_RUN = process.env.SOURCE_RUN ?? "116b6b93-9bd8-4640-82c7-fd0fd373807d";

const ACTOR = "sandbox-test:first-session";
const keep = process.argv.includes("--keep");
const headed = process.argv.includes("--headed");

// ---- guards, before anything is touched ------------------------------------
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:  node --env-file=.env.local .claude/skills/verify/files/first-session.mjs");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (environment === "production") {
  console.error("This walk creates and deletes data. It never runs against production.");
  process.exit(1);
}
if (!process.env.QA_EMAIL || !process.env.QA_PASSWORD) {
  console.error("Set QA_EMAIL and QA_PASSWORD. Create the user with tools/create-user.mjs.");
  process.exit(1);
}
const playwrightDir = process.env.PLAYWRIGHT_DIR;
if (!playwrightDir) {
  console.error("Set PLAYWRIGHT_DIR to the scratchpad project that has playwright installed,");
  console.error("with playwright-session.mjs copied next to it. Playwright is not a repo dependency.");
  process.exit(1);
}

const BASE = process.env.BASE ?? "http://localhost:3000";
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${new URL(databaseUrl).host})`);
console.log(`App:    ${BASE}`);
console.log("Cost:   nothing. No specification document is uploaded and no classify call is made.\n");

const { openSession, fetchAs, watchForFailures } = await import(
  pathToFileURL(path.join(playwrightDir, "playwright-session.mjs")).href
);

// ---- what happened, per plan item ------------------------------------------
const results = [];
const skipped = [];
const notes = [];

/** One assertion, named for the plan item it gates. Never throws: one run reports everything. */
async function check(item, what, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, item, what, detail: detail ?? "" });
    console.log(`  PASS  [${item}] ${what}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ ok: false, item, what, detail });
    console.log(`  FAIL  [${item}] ${what} — ${detail}`);
  }
}

/**
 * An assertion for an item that is not on `staging` yet.
 *
 * Written now and run later: the orchestrator turns `skip` into `check` on the
 * day the item lands, rather than writing the assertion then, when the item is
 * already believed to work.
 */
function skip(item, what, why) {
  skipped.push({ item, what, why });
  console.log(`  SKIP  [${item}] ${what} — ${why}`);
}

/**
 * Wait for a screen to have actually rendered.
 *
 * A dev server compiles a route on its first hit, so a settle long enough on a
 * warm one leaves an assertion reading a half-painted page — which is reported
 * as a defect in a screen that works. Every check that reads text waits for
 * something only the finished screen carries.
 */
const PATIENCE = Number(process.env.WALK_PATIENCE ?? 60000);

/**
 * PRESS UNTIL IT OPENS.
 *
 * A click that lands before React has attached its handler does NOTHING — the
 * markup is painted by the server, so the control is there, visible and inert.
 * Under load that window is seconds long, and the walk then reports "the panel
 * carries no reason field" about a panel that simply never opened. The same
 * race as the sign-in form, in every disclosure on every screen.
 */
async function press(control, opened, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await control.click({ timeout: Math.min(PATIENCE, 30000) }).catch(() => {});
    for (let waited = 0; waited < 4000; waited += 500) {
      if (await opened()) return true;
      await page.waitForTimeout(500);
    }
  }
  return false;
}

async function ready(pattern, timeout = PATIENCE) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (pattern.test(text)) return text;
    await page.waitForTimeout(1000);
  }
  throw new Error(`the screen never rendered ${pattern}`);
}

/**
 * Wait for a screen to stop SAYING it is loading.
 *
 * `ready` waits for something to appear; this waits for the spinners to go.
 * The project screen paints its header, its tabs and its phase tally before
 * the records arrive, so a pattern that matches the shell is satisfied while
 * the table still reads "Loading spec records" — and the assertion under it
 * reports an empty table on a screen that was two seconds from showing one.
 */
async function settled(timeout = PATIENCE) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (text && !/Loading (project|spec records|records)/i.test(text)) return text;
    await page.waitForTimeout(1000);
  }
  throw new Error("the screen never stopped loading");
}

/**
 * Open a dashboard page and let it settle.
 *
 * NOT `networkidle`: this app's dashboard pages stream RSC payloads and poll,
 * so the network is never idle for 500ms and every goto times out at 30s
 * looking exactly like a hung page. `domcontentloaded` plus a settle is what
 * the screens actually need, and each assertion waits for its own element.
 */
// `WALK_PATIENCE` raises every navigation and every wait-for-render at once.
// A development machine under load answers a first-hit route in tens of
// seconds, and a walk that gives up there reports a working screen as broken.
async function open(url, settle = 1200) {
  // RETRIED, AND PATIENT. A dev server compiles a route on its first hit and
  // can exceed the default navigation timeout under load — the skill's
  // "the first hit to a route can 404 while dev-mode compiles it", in the shape
  // it takes when it does not answer at all. A walk that gives up there reports
  // a working screen as broken.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PATIENCE });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(2000);
    }
  }
  await page.waitForTimeout(settle);
}

const say = (line) => console.log(line);
const note = (line) => {
  notes.push(line);
  console.log(`  note  ${line}`);
};

/**
 * Where a screen still says "run" in OUR voice.
 *
 * `MAIN RUN` in capitals is a TAB NAME OFF A CLIENT'S OWN BILL — the pilot
 * writes MUR, MAIN RUN and MAIN RUN - VE — and printing it is printing what
 * the client wrote, not this app's vocabulary for a phase.
 * `tests/lib/vocabulary-guard.test.ts` allowlists exactly that string for the
 * same reason, and a rule here that flagged it would fail on correct data.
 */
function saysRun(text) {
  return (text.match(/(?<![\w-])runs?(?![\w-])/gi) ?? []).filter((word) => word !== "RUN");
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---- the manifest ----------------------------------------------------------
//
// Every row and blob this run created, written as it goes, so a walk that dies
// half way through still says what it left behind. `house/writing-docs.md`: the
// useful record is what happened, not what was intended.
const manifest = {
  startedAt: new Date().toISOString(),
  actor: ACTOR,
  base: BASE,
  databaseHost: new URL(databaseUrl).host,
  projectName: null,
  projectId: null,
  batchId: null,
  intakeRunIds: [],
  attachmentIds: [],
  recordIds: [],
  /** Blobs are NOT deleted by the cleanup — it has no blob credentials and must never be given any. */
  blobPathsReused: [],
  blobPathsCreated: [],
};
const manifestPath = path.join(
  process.env.MANIFEST_DIR ?? mkdtempSync(path.join(tmpdir(), "first-session-")),
  "first-session-manifest.json",
);
const writeManifest = () => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// KEEP-ALIVE, AND AN ERROR HANDLER. A browser step takes minutes, and an idle
// `pg` socket is dropped by the network long before it is next used —
// `qa-demo-project.ts` records the same failure, where a whole build was lost
// to `read ETIMEDOUT` on the closing query. Without the handler that arrives as
// an unhandled 'error' event and kills the process mid-walk, after the writes.
function connect() {
  const next = new pg.Client({ connectionString: databaseUrl, keepAlive: true });
  // ATTACHED TO EVERY CLIENT, INCLUDING THE REPLACEMENTS. The first version
  // replaced the client in place with `Object.assign`, which overwrote the
  // listener along with everything else — so the SECOND drop was an unhandled
  // 'error' event that killed the walk after step 9, past every write and
  // before the cleanup.
  next.on("error", (error) => console.log(`  note  database connection dropped: ${error.message}`));
  return next;
}

let client = connect();
await client.connect();

/** Re-connect if the socket died while the browser was working. */
async function query(text, params = []) {
  try {
    return await client.query(text, params);
  } catch (error) {
    if (!/ETIMEDOUT|terminat|Connection terminated|socket/i.test(String(error))) throw error;
    await client.end().catch(() => {});
    client = connect();
    await client.connect();
    return client.query(text, params);
  }
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const projectName = `__QA first session ${stamp}`;
const projectNumber = `QA${stamp.slice(-6)}`;
manifest.projectName = projectName;
writeManifest();

let browser;
let page;
let context;
let failures = [];

try {
  // =========================================================================
  // 1. Sign in; check the chip and /api/auth/me.
  // =========================================================================
  say("1. Sign in");
  const session = await openSession({ headless: !headed });
  ({ browser, context, page } = session);
  failures = watchForFailures(page);

  await check("1.1", "the environment chip is in the top bar", async () => {
    const chip = await page.locator("header, nav, body").first().textContent();
    const found = /DEV|STAGING|PILOT/.exec(chip ?? "");
    expect(found, "no DEV / STAGING / PILOT chip on the dashboard");
    return found[0];
  });

  await check("1.1", "/api/auth/me names the environment it is connected to", async () => {
    const me = await fetchAs(context, "/api/auth/me");
    expect(me.ok(), `/api/auth/me returned ${me.status()}`);
    const body = await me.json();
    const where = body.environment?.appEnv ?? body.environment?.name ?? body.environment ?? "?";
    return `${typeof where === "string" ? where : JSON.stringify(where)} as ${body.user?.email ?? "?"}`;
  });

  // =========================================================================
  // 2. Create a project; set the client and the programme dates.
  // =========================================================================
  say("\n2. Create the project");
  await open(`${BASE}/dashboard/projects`);
  // PRESS UNTIL THE FORM IS THERE. The form is `hidden` until React flips
  // `adding`, so a press that lands before hydration does nothing at all and
  // the fill then times out against an input that exists and is invisible —
  // which reads as a broken screen. The same hydration race the sign-in form
  // has, in its second place.
  const projectNumberInput = page.locator('input[placeholder="P17231"]');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByRole("button", { name: "Add a project" }).click();
    try {
      await projectNumberInput.waitFor({ state: "visible", timeout: 3000 });
      break;
    } catch {
      await page.waitForTimeout(1000);
    }
  }
  await page.fill('input[placeholder="P17231"]', projectNumber);
  await page.fill('input[placeholder="Project name"]', projectName);
  await page.fill('input[placeholder="Client (optional)"]', "__QA Client Ltd");
  // Adding does NOT navigate — the new project appears in the list below.
  // The press is the user action and it is what this step exercises; WHICH ROW
  // the list then paints is the list's business, and waiting on it made the
  // walk fail on a screen that was working. The row is the fact.
  await page.getByRole("button", { name: "Add project" }).click();
  for (let waited = 0; waited < 30000 && !manifest.projectId; waited += 1000) {
    const { rows } = await query(`select id from projects where name = $1`, [projectName]);
    if (rows[0]) manifest.projectId = rows[0].id;
    else await page.waitForTimeout(1000);
  }
  expect(manifest.projectId, "the project was not created");
  writeManifest();
  await open(`${BASE}/dashboard/projects/${manifest.projectId}`, 1500);
  say(`   ${projectName} — ${manifest.projectId}`);

  await query(
    `update projects set order_date = '2026-08-10', specs_agreed_by = '2026-09-25', delivery_date = '2026-12-18',
       updated_by = $2 where id = $1`,
    [manifest.projectId, ACTOR],
  );
  note("the programme dates are set directly: the details form is a person's form and step 2 is setup, not the gate");

  // =========================================================================
  // 3. Upload the pack — the synthetic bill only.
  // =========================================================================
  say("\n3. Upload the pack");
  say("   REFUSED, deliberately: a specification document (PDF / drawings / .eml) is a charged read.");
  say("   Steps 5-9 clone a pack the sandbox has already read instead.");

  const billBytes = await buildFixtureBill();
  await open(`${BASE}/dashboard/projects/${manifest.projectId}?tab=documents`);
  // The upload panel is behind "Add documents" — collapsed, because on a
  // project that already has a pack it is a form in front of the work.
  await page.getByRole("button", { name: "Add documents" }).click();
  const fileInput = page.locator("input[type=file]").first();
  await fileInput.setInputFiles({ name: FIXTURE_BILL_FILENAME, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: billBytes });

  await check("7.4", "the charge is stated before anything is uploaded", async () => {
    const text = await page.locator("body").innerText();
    expect(/nothing is charged|costs nothing/i.test(text), "the upload screen does not state the charge before the press");
    return "stated";
  });

  // DECLARED, never classified — see the header. This is the screen's own
  // "a person's choice beats the suggestion", and it is what keeps the walk free.
  const row = page.locator("li", { hasText: FIXTURE_BILL_FILENAME }).first();
  await row.locator("select").selectOption({ label: "Bill of quantities (creates the records)" });
  await page.getByRole("button", { name: /^Start intake/ }).click();

  // WAIT ON THE DATABASE, NOT ON THE REDIRECT. The screen navigates only when
  // nothing is still waiting on a person, so a file the app could not identify
  // leaves the walk waiting for a navigation that correctly never comes — and
  // "the upload hung" is then indistinguishable from "the upload was refused".
  // The run row is the fact; the redirect is a convenience.
  let boqRunId = null;
  for (let waited = 0; waited < 120000 && !boqRunId; waited += 2000) {
    const { rows } = await query(
      `select id, batch_id, status from intake_runs where project_id = $1 and source_kind = 'boq_xlsx' limit 1`,
      [manifest.projectId],
    );
    if (rows[0]) {
      boqRunId = rows[0].id;
      manifest.batchId = rows[0].batch_id;
      break;
    }
    await page.waitForTimeout(2000);
  }
  if (!boqRunId) {
    const shown = await page.locator("body").innerText();
    throw new Error(`the bill never registered. The screen says: ${shown.slice(0, 400).replace(/\s+/g, " ")}`);
  }
  manifest.intakeRunIds.push(boqRunId);
  writeManifest();
  say(`   batch ${manifest.batchId} · bill run ${boqRunId}`);

  // =========================================================================
  // 4. Review the bill and confirm it.
  // =========================================================================
  say("\n4. Review the bill");
  await open(`${BASE}/dashboard/imports/${boqRunId}`, 0);
  // WAIT FOR THE CONTROL, not for a fixed number of seconds. Every review
  // screen is a client component that fetches after mount, so a settle long
  // enough on a fast machine reads as "the screen is empty" on a slow one —
  // which is a failure report about the walk rather than about the app.
  const billConfirm = page.locator("button", { hasText: /^Confirm ·/ }).first();
  await billConfirm.waitFor({ timeout: PATIENCE });

  await check("1.1", "the bill review says PHASE, never run", async () => {
    const text = await page.locator("body").innerText();
    expect(/phase/i.test(text), "the word phase is nowhere on the bill review");
    expect(saysRun(text).length === 0, `the bill review still says "run" ${saysRun(text).length} time(s)`);
    return "phase throughout";
  });

  await check("1.2", "the header-row message names the right row, in words", async () => {
    const text = await page.locator("body").innerText();
    const header = /Header on row (\d+)\./.exec(text);
    expect(header, "the review does not say which row the header was found on");
    const items = /Items start on row (\d+)/.exec(text);
    expect(items, "the review does not say which row the items start on");
    expect(Number(items[1]) > Number(header[1]), `items start on row ${items[1]}, at or above the header on ${header[1]}`);
    // Rows above the header are READ, for the revision and the date. Calling
    // them skipped is what sent somebody looking for a lost line.
    expect(!/\bskipped\b/i.test(text), "the review still calls the rows above the header skipped");
    return `${header[0]} ${items[0]}`;
  });
  await check("1.5", "a packaging line is a QUESTION, and one press answers all of them", async () => {
    // `Include row 7` is an aria-label and never appears in `innerText`.
    // Waiting for it waits for ever on a screen that has already painted.
    const text = await ready(/SX11A/);
    // A SUGGESTION WITH ITS EVIDENCE, never a decision: `PACK` and `DEL` are
    // not furniture and the app may say so, but ignoring a bill line is a
    // person's act. `SuggestButton` refuses to render without the evidence.
    expect(/Not furniture/.test(text), "neither non-furniture line is questioned");
    // The evidence is the app's own words — "the code starts PACK", "the
    // description says “delivery”" — and the assertion is that BOTH lines carry
    // one, not that it is phrased a particular way.
    expect(
      /the code starts|the description says/i.test(text),
      "the suggestions do not name what they read",
    );

    const all = page.getByRole("button", { name: /^Ignore all 2 suggested/ }).first();
    expect(await all.count(), `no "Ignore all 2 suggested" on the sheet: the count is what the control does`);

    const countOn = async () => {
      const label = await billConfirm.innerText();
      return Number(/creates (\d+) record/.exec(label)?.[1] ?? 0);
    };
    const before = await countOn();
    expect(before === FIXTURE_BILL_COUNTS.total, `the confirm offered ${before} records, not ${FIXTURE_BILL_COUNTS.total}`);

    expect(await press(all, async () => (await countOn()) === before - 2), "Ignore all suggested changed no count");
    // EXACTLY THOSE TWO. A control that ignored a line nobody asked about would
    // take a real item out of the bill, and nothing downstream would question it.
    const ignoredText = await page.locator("body").innerText();
    expect(!/Not furniture/.test(ignoredText), "a line is still being asked about after ignoring all suggested");

    // AND IT IS REVERSIBLE BEFORE THE CONFIRM — house §5: every ignore path is.
    const include = page.locator('input[type=checkbox][aria-label^="Include row"]:not(:checked)').first();
    expect(await include.count(), "the ignored rows cannot be found to put back");
    expect(await press(include, async () => (await countOn()) === before - 1), "putting a row back did not restore it");
    // Ignored again, so the confirm below counts what this walk expects.
    const backOut = page.getByRole("button", { name: /^Ignore all 1 suggested/ }).first();
    if (await backOut.count()) await press(backOut, async () => (await countOn()) === before - 2);
    return `${before} → ${await countOn()} records, and back again`;
  });

  await check("7.4", "confirm creates a record per line per phase", async () => {
    const label = await billConfirm.innerText();
    await billConfirm.click();
    // A confirm writes a record per line per phase and then navigates. Polled,
    // because how long that takes is a function of the bill's size and a fixed
    // wait reads as "the confirm did nothing" on a slow one.
    let rows = [{ n: 0 }];
    for (let waited = 0; waited < 90000 && rows[0].n === 0; waited += 2000) {
      await page.waitForTimeout(2000);
      ({ rows } = await query(`select count(*)::int as n from spec_records where project_id = $1`, [manifest.projectId]));
    }
    // TWO FEWER THAN THE BILL'S LINES: `PACK` and `DEL` were ignored above, on
    // this sheet, as the reviewer's own act.
    const expected = FIXTURE_BILL_COUNTS.total - 2;
    expect(rows[0].n === expected, `expected ${expected} records after ignoring the two non-furniture lines, found ${rows[0].n}`);
    return `${label.trim()} → ${rows[0].n} records`;
  });

  const records = await query(`select id from spec_records where project_id = $1`, [manifest.projectId]);
  manifest.recordIds = records.rows.map((r) => r.id);
  writeManifest();

  await check("7.4", "one client ref on two lines is two records, paired with nothing", async () => {
    const { rows } = await query(
      `select count(*)::int as n from spec_records r
         join spec_record_refs f on f.record_id = r.id
        where r.project_id = $1 and f.ref_system = 'boq_code' and upper(f.ref_value) = 'SX11A'`,
      [manifest.projectId],
    );
    expect(rows[0].n === 4, `expected SX11A on 4 records (2 lines x 2 phases), found ${rows[0].n}`);
    return "4 records across 2 phases";
  });

  // =========================================================================
  // 5. Clone one staged drawings run onto this project.
  // =========================================================================
  say("\n5. Clone a staged pack (no model call)");
  note("qa-demo-project.ts STAGES its drawings from synthetic content; it has no clone to factor out, so nothing there was changed");

  const source = await query(
    `select r.parsed, r.document_kind, a.storage_path, a.filename, a.content_type, a.size
       from intake_runs r join attachments a on a.id = r.attachment_id
      where r.id = $1 and r.project_id = $2`,
    [SOURCE_RUN, SOURCE_PROJECT],
  );
  expect(source.rows[0], `the source run ${SOURCE_RUN} is not on project ${SOURCE_PROJECT} any more`);
  const staged = source.rows[0];
  manifest.blobPathsReused.push(staged.storage_path);

  // THE COPY IS PUT BACK TO ITS PRE-1.8 SHAPE, on purpose.
  //
  // Somebody has since edited the fabric row on the original (it sits at
  // version 3 with the marker already split out), and an assertion over that
  // proves only that the stored value is clean. Resetting the copy to what the
  // model staged — one value carrying both halves, at version 1, unruled —
  // makes step 6 exercise the READ-TIME upgrade, which is what 1.8 actually is.
  const parsed = staged.parsed;
  let resetFabric = false;
  for (const item of parsed.items ?? []) {
    for (const observation of item.observations ?? []) {
      if (observation.labelRaw === "FABRIC CODE" && typeof observation.valueRaw === "string") {
        observation.value = observation.valueRaw;
        observation.state = null;
        observation.version = 1;
        observation.reviewStatus = "pending";
        resetFabric = true;
      }
    }
  }
  expect(resetFabric, "the cloned run carries no FABRIC CODE row to reset");

  const clonedAttachment = await query(
    `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
     values ('project', $1, 'spec_document', $2, $3, $4, $5, $6) returning id`,
    [manifest.projectId, staged.storage_path, staged.filename, staged.content_type, staged.size, ACTOR],
  );
  manifest.attachmentIds.push(clonedAttachment.rows[0].id);
  const clonedRun = await query(
    `insert into intake_runs
       (project_id, attachment_id, batch_id, source_kind, document_kind, status, parsed, created_by, updated_by)
     values ($1, $2, $3, 'spec_document', $4, 'parsed', $5, $6, $6) returning id`,
    [manifest.projectId, clonedAttachment.rows[0].id, manifest.batchId, staged.document_kind, parsed, ACTOR],
  );
  const clonedRunId = clonedRun.rows[0].id;
  manifest.intakeRunIds.push(clonedRunId);
  writeManifest();
  say(`   cloned ${SOURCE_RUN} → ${clonedRunId}`);
  note("the copy points at the ORIGINAL project's blob, so /api/imports/<id>/source 404s there and no page preview renders — by design (verify skill)");

  await open(`${BASE}/dashboard/projects/${manifest.projectId}/intake/${manifest.batchId}`, 0);
  const packText = await ready(/document/);

  await check("1.6", "the pack says what it adds up to in ONE line", async () => {
    // Max, unprompted: a yellow notice per document is a wall at eleven and a
    // screen nobody can read at thirty. One sentence totals the set; what to do
    // about a single document is on that document's own row.
    const documents = await query(
      `select count(*)::int as n from intake_runs where project_id = $1 and batch_id = $2`,
      [manifest.projectId, manifest.batchId],
    );
    const total = documents.rows[0].n;
    // ONE LINE FOR THE PACK. A sentence about a SUBSET — the drawings link's
    // "1 document · 0 reviewed, 1 waiting for you" — is a different statement
    // about a different set, so the test is that the pack's own total is said
    // once, not that the word "document" appears once.
    const lines = packText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => new RegExp(`^${total} documents? · `).test(line));
    expect(lines.length === 1, `expected one summary line for ${total} documents, found ${lines.length}: ${lines.join(" | ")}`);
    return lines[0];
  });

  await check("1.7", "a document says how much is left, rather than being ticked", async () => {
    // The chip is the OUTSTANDING count while anything is pending, because
    // "Ready to review" is the same word for six rows and for none — and a
    // completion tick beside a document with proposals waiting is the tick
    // Matthew read as "done".
    // THE DRAWINGS DOCUMENT'S OWN ROW. The bill beside it IS reviewed and
    // legitimately reads Review complete, so asserting over the whole page
    // would fail on a screen that is telling the truth about both.
    const row = page.locator("tr, li", { hasText: staged.filename }).first();
    expect(await row.count(), `the pack screen does not list ${staged.filename}`);
    const rowText = await row.innerText();
    const left = /(\d+) to review/.exec(rowText);
    expect(left, `the drawings row says nothing about what is left: ${rowText.replace(/\s+/g, " ").slice(0, 160)}`);
    expect(!/Review complete/.test(rowText), "the drawings row reads Review complete with proposals still pending");
    return `${left[0]} on ${staged.filename}`;
  });

  // =========================================================================
  // 6. Review a drawings card.
  // =========================================================================
  say("\n6. Review the drawings card");
  await open(`${BASE}/dashboard/projects/${manifest.projectId}/intake/${manifest.batchId}/drawings`, 0);
  // `Confirm 12 specs` on an item card, `Confirm S-100 (2 configurations)` on a
  // configuration card — one card per CODE, which is what this run stages.
  let cardConfirm = page.getByRole("button", { name: /^Confirm\b/ }).last();
  await cardConfirm.waitFor({ timeout: PATIENCE }).catch(() => {});

  await check("1.8", "the TBC marker is a STATE and the fabric is the value", async () => {
    const text = await page.locator("body").innerText();
    expect(/Yarn Collective Tessarae/.test(text), "the fabric row is not on the card");
    const box = page.locator('input[value*="Yarn Collective Tessarae"]').first();
    expect(await box.count(), "the fabric value is not in an editable box");
    const value = await box.inputValue();
    expect(!/\bT\.?B\.?C\b/i.test(value), `the value box still carries the marker: ${value}`);
    const stateRow = page.locator("tr", { hasText: "Yarn Collective Tessarae" }).first();
    const state = await stateRow.locator("select").last().inputValue();
    expect(state === "tbc", `the state beside it reads "${state}", not tbc`);
    return `value "${value}" · state tbc`;
  });

  skip("1.9", "the item picture crops or says why it could not", "no page preview on a clone — the blob is the source project's");
  skip("1.10", "the swatch picker reaches page 2", "no page preview on a clone — the blob is the source project's");
  await check("1.15", "a level is set from the card by a BUTTON, and the click says how far it reaches", async () => {
    const text = await ready(/sets the level on \d+ records|Set a level…|Change…/);
    const panel = page.locator("div", { hasText: /sets the level on \d+ records/ }).last();
    const fanOut = /sets the level on (\d+) records/.exec(text);
    expect(fanOut, "the card does not say how many records a level would reach");
    // A PRE-FILLED SELECT CANNOT BE THE ACCEPT CONTROL: choosing the value it
    // already shows fires no change event, so the one action recording a
    // person's agreement would do nothing. Every choice is its own button.
    const picker = page.getByRole("button", { name: /^(Change…|Set a level…|Set another level…)$/ }).first();
    expect(await picker.count(), "no level control on the drawings card");
    const complex = page.getByRole("button", { name: "Complex", exact: true }).first();
    expect(await press(picker, () => complex.count()), "the level picker never opened");
    expect((await panel.locator("select").count()) === 0, "the level panel offers a select");

    const levelled = async () => {
      const { rows } = await query(
        `select count(*)::int as n from spec_records where project_id = $1 and level = 'complex'`,
        [manifest.projectId],
      );
      return rows[0].n;
    };
    // PRESSED ONCE. `press` retries, which is right for a disclosure and wrong
    // for a write: a second click is a second `level_set` change set, and the
    // count of those is the thing being asserted. The button is hydrated by
    // now — the picker opening is the proof — so one click is enough, and what
    // follows is a wait rather than a retry.
    // A moment for the re-rendered panel to hydrate: the buttons are painted by
    // the state flip the picker just caused, and the click that opened the
    // picker proves the PICKER was live, not these.
    await page.waitForTimeout(1500);
    // PRESSED AGAIN ONLY IF THE FIRST PRESS LEFT NO TRACE. A retry that fires
    // over a write is a second `level_set` change set, and one change set per
    // click is the thing being asserted — so the retry is gated on the CHANGE
    // SET being absent, which a landed click always leaves behind even while
    // the level is still being written.
    const traced = async () => {
      const { rows } = await query(
        `select count(*)::int as n from change_sets where project_id = $1 and kind = 'level_set'`,
        [manifest.projectId],
      );
      return rows[0].n;
    };
    let levels = 0;
    for (let attempt = 0; attempt < 3 && levels === 0; attempt += 1) {
      if ((await traced()) > 0 && attempt > 0) break;
      await complex.click().catch(() => {});
      for (let waited = 0; waited < 45000 && levels === 0; waited += 1000) {
        await page.waitForTimeout(1000);
        levels = await levelled();
      }
    }
    expect(levels > 0, "pressing Complex wrote no level");
    const written = await query(
      `select count(*)::int as n from spec_records where project_id = $1 and level = 'complex'`,
      [manifest.projectId],
    );
    expect(
      written.rows[0].n === Number(fanOut[1]),
      `the card said ${fanOut[1]} records and ${written.rows[0].n} carry the level`,
    );
    // ONE CLICK IS ONE CHANGE SET, not one per record — the
    // `acceptSuggestedLevels` rule, which is why the count is asserted rather
    // than the write alone.
    const changes = await query(
      `select count(*)::int as n from change_sets where project_id = $1 and kind = 'level_set'`,
      [manifest.projectId],
    );
    expect(changes.rows[0].n === 1, `expected one level_set change set, found ${changes.rows[0].n}`);
    return `${fanOut[0]} · one level_set change`;
  });

  await check("1.8", "a marker in the MIDDLE of a value is still the reviewer's question", async () => {
    // `TBC – subject to factory seat test` states something AND says it is not
    // settled, and 1.8 deliberately leaves that one alone: no separator binds
    // the marker to an edge, so neither code nor model decides which it is.
    // The card refuses to confirm until a person answers, which is the whole
    // point — and the walk answers it the way a reviewer would.
    // A STATE SELECT WITH NO VALUE, and VISIBLE. Not `hasText: "Choose…"` —
    // that matches the OPTION inside every state select on the card, answered
    // or not, and half of them are inside a folded panel.
    const selects = await page.locator("select:visible").all();
    const asking = [];
    for (const select of selects) {
      const values = await select.locator("option").evaluateAll((options) => options.map((o) => o.value));
      if (!values.includes("tbc") || !values.includes("confirmed")) continue;
      if ((await select.inputValue()) !== "") continue;
      asking.push(select);
    }
    expect(asking.length > 0, "no row is asking for a state — the middle-marker case did not reach the reviewer");
    for (const select of asking) {
      await select.selectOption("tbc");
      await page.waitForTimeout(600);
    }
    // WAIT ON THE AUTOSAVE, not on a stopwatch. Each answer is a PATCH, the
    // blocker is computed over the WHOLE card including rows this scan cannot
    // see inside a folded panel, and a reload that races the last save re-serves
    // the old JSON — which is how this step passed on one run and blocked on
    // the next for no reason anybody could see. The staged row is the fact.
    let unanswered = 1;
    for (let waited = 0; waited < 30000 && unanswered > 0; waited += 1500) {
      await page.waitForTimeout(1500);
      const { rows } = await query(
        `select count(*)::int as n
           from intake_runs, jsonb_array_elements(parsed->'items') item,
                jsonb_array_elements(item->'observations') o
          where intake_runs.id = $1
            and o->>'reviewStatus' = 'pending'
            and o->>'state' is null`,
        [clonedRunId],
      );
      unanswered = rows[0].n;
    }
    if (unanswered > 0) {
      // A row the scan could not reach: answered through the app it would be a
      // click, and this walk has no way to open every fold. Said, not hidden.
      note(`${unanswered} row(s) still have no state and are inside a panel this walk cannot open`);
    }
    await open(page.url(), 3000);
    return `${asking.length} row${asking.length === 1 ? "" : "s"} answered TBC`;
  });

  await check("7.4", "the card confirms onto the records the bill made", async () => {
    // Re-located: the card re-rendered under the reloads above.
    cardConfirm = page.getByRole("button", { name: /^Confirm\b/ }).last();
    await cardConfirm.waitFor({ timeout: Math.min(PATIENCE, 60000) }).catch(() => {});
    expect(await cardConfirm.count(), "no Confirm on the drawings card");
    const label = await cardConfirm.innerText();
    // WHY, not just that it is disabled. A card refusing to commit is the app
    // working; a walk that times out on the click reports it as a hang.
    if (await cardConfirm.isDisabled()) {
      const shown = await page.locator("body").innerText();
      const why = /cannot be confirmed yet[^\n]*/.exec(shown)?.[0] ?? "no reason printed";
      throw new Error(`the card is blocked: ${why}`);
    }
    await cardConfirm.click();
    let rows = [{ n: 0 }];
    for (let waited = 0; waited < 60000 && rows[0].n === 0; waited += 2000) {
      await page.waitForTimeout(2000);
      ({ rows } = await query(
        `select count(*)::int as n from record_attributes a join spec_records r on r.id = a.record_id
          where r.project_id = $1 and a.status = 'active'`,
        [manifest.projectId],
      ));
    }
    expect(rows[0].n > 0, "the confirm wrote no attributes");
    return `${label.trim()} → ${rows[0].n} attributes`;
  });

  await check("1.8", "a tbc attribute reaches the record as a tbc STATE, not as a word in the value", async () => {
    const { rows } = await query(
      `select a.value, a.state from record_attributes a join spec_records r on r.id = a.record_id
        where r.project_id = $1 and a.label = 'FABRIC CODE' and a.status = 'active' limit 1`,
      [manifest.projectId],
    );
    expect(rows[0], "no FABRIC CODE attribute was written");
    expect(rows[0].state === "tbc", `the attribute state is "${rows[0].state}"`);
    expect(!/\bT\.?B\.?C\b/i.test(rows[0].value ?? ""), `the stored value still carries the marker: ${rows[0].value}`);
    return `${rows[0].value} · ${rows[0].state}`;
  });

  await check("1.7", "a page with nothing to match on is dismissed in one press", async () => {
    // A page with no item code can never commit — no code, no resolved phases —
    // so it is collapsed to a summary line with ONE button that ignores the
    // whole page, rather than an Ignore per row. Until a reviewer presses it
    // the document is not reviewed, which is what the count beside it says.
    await open(`${BASE}/dashboard/projects/${manifest.projectId}/intake/${manifest.batchId}/drawings`, 0);
    await ready(/Ignore these rows|Review complete/);
    const dismiss = page.getByRole("button", { name: /^Ignore these rows$/ }).first();
    if ((await dismiss.count()) === 0) return "nothing left to dismiss";
    // TWO PRESSES, because the control ARMS before it fires — dismissing a
    // page is a reviewer's decision and the second press is where it is taken.
    // The label changes when armed, so the same locator stops matching: a
    // retry loop over the first name clicks nothing at all.
    const armed = page.getByRole("button", { name: /^Ignore all \d+ rows\?$/ }).first();
    expect(await press(dismiss, () => armed.count()), "the dismiss control never armed");
    const cleared = async () => {
      const { rows } = await query(
        `select count(*)::int as n
           from intake_runs, jsonb_array_elements(parsed->'items') item,
                jsonb_array_elements(item->'observations') o
          where intake_runs.id = $1 and o->>'reviewStatus' = 'pending'`,
        [clonedRunId],
      );
      return rows[0].n === 0;
    };
    await armed.click();
    let done = false;
    for (let waited = 0; waited < 60000 && !done; waited += 1000) {
      await page.waitForTimeout(1000);
      done = await cleared();
    }
    expect(done, "the codeless page could not be dismissed");
    return "the codeless page ignored, nothing pending";
  });

  await check("1.7", "and says Review complete once nothing is pending", async () => {
    await open(`${BASE}/dashboard/projects/${manifest.projectId}/intake/${manifest.batchId}`, 0);
    await ready(/document/);
    const row = page.locator("tr, li", { hasText: staged.filename }).first();
    const rowText = await row.innerText();
    expect(/Review complete/.test(rowText), `the confirmed drawings row still reads: ${rowText.replace(/\s+/g, " ").slice(0, 160)}`);
    return "Review complete";
  });

  // =========================================================================
  // 7. The phase table.
  // =========================================================================
  say("\n7. The phase table");
  const phases = await query(
    `select id, name from spec_runs where project_id = $1 and status = 'active' order by sort_order`,
    [manifest.projectId],
  );
  const firstPhase = phases.rows[0];
  expect(firstPhase, "the confirm created no phases");
  await open(`${BASE}/dashboard/projects/${manifest.projectId}?tab=${firstPhase.id}`, 3000);

  await check("1.1", "the project screen says PHASE, never run", async () => {
    await ready(/Needed to quote|Client code|Item/i);
    const text = await settled();
    // ONLY THE NEGATIVE HALF HERE. A phase tab is labelled with the CLIENT'S
    // own tab name, so a project whose bill says MAIN RUN may legitimately
    // never print the word phase on this screen — asserting that it does is an
    // assertion about the fixture rather than about the app.
    expect(saysRun(text).length === 0, `the phase table still says "run" ${saysRun(text).length} time(s)`);
    return `${phases.rows.length} phases, none called a run`;
  });

  await check("1.11", "the screen's primary action IS the next step", async () => {
    // `nextStep` decides it once and every screen renders the same answer, so
    // the assertion is that the project's header band carries one of its
    // labels — not a sentence telling somebody where to go.
    await open(`${BASE}/dashboard/projects/${manifest.projectId}`, 0);
    await ready(new RegExp(projectName.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const header = await page.locator("body").innerText();
    // EVERY label `nextStep` can produce. Written out rather than matched
    // loosely, because a loose pattern that happened to match a heading would
    // pass on a screen with no primary at all — which is the thing being
    // asserted. Keep it in step with `src/lib/next-step.ts`.
    const step =
      /Upload the pack|Reading \d+ documents?…|Retry the failed read|Retry \d+ failed reads|Review the bill|Review the document|Review \d+ documents|Categorise \d+ items?|Review \d+ items?|\d+ questions? waiting on a reply|Export/.exec(
        header,
      );
    expect(step, "no next-step primary on the project screen");
    return step[0];
  });
  await check("1.15", "the phase table shows the level as a DECISION, with no guess beside it", async () => {
    // Wait for the ROWS, not for the table's own headings: the header paints
    // with the shell and the records arrive with the fetch. The item's own
    // description is not a safe marker — the column truncates — so this waits
    // for the level column's own vocabulary.
    // The chip prints the STORED value — `complex`, the key — not the label.
    //
    // THREE WAITS, AND EACH CATCHES WHAT THE ONE BEFORE IT CANNOT. The header
    // proves the screen arrived; `settled` proves the spinners have gone — and
    // between "Loading project" going and "Loading spec records" appearing the
    // body carries neither, so on its own it returns in the gap and the level
    // column has not been painted yet. The LEVEL COLUMN'S OWN VOCABULARY is
    // what proves the rows are there.
    // WAIT FOR THE ROW, BY ITS CLIENT REF. The level column's own vocabulary is
    // not a safe marker either: the suggestion banner above the table says
    // "22 simple" and paints before the rows do, so a wait for the words
    // returns while the table is still empty.
    await ready(/Needed to quote|Client code|Item/i);
    await settled();
    // BY THE ITEM'S DESCRIPTION, not by its code: the project screen also lists
    // the PACK, and the drawing's filename is `… S-100 - Sofa.pdf`, so a match
    // on the code finds the DOCUMENT row and reports its chip as the level.
    // BY THE CLIENT REF CELL, exactly. Matching text anywhere in a row finds
    // the PACK's own row too — the drawing is `… S-100 - Sofa.pdf` — and
    // matching the item description depends on how the column renders it.
    const levelRow = page
      .locator("tr")
      .filter({ has: page.locator("td", { hasText: /^\s*S-100\s*$/ }) })
      .first();
    for (let waited = 0; waited < PATIENCE && (await levelRow.count()) === 0; waited += 1000) {
      await page.waitForTimeout(1000);
    }
    expect(
      await levelRow.count(),
      `the phase table has no row whose client ref is S-100. It shows: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300)}`,
    );
    const levelText = await levelRow.innerText();
    expect(
      /complex/i.test(levelText),
      `the level set on the card is not on the row: ${levelText.replace(/\s+/g, " ").slice(0, 200)}`,
    );
    // `level_suggested` and `level` are different columns and 0025 refuses a
    // row holding both. A row reading "Complex · guessed" would mean the click
    // wrote the guess rather than the decision.
    // A DECISION IS A CHIP; a suggestion is a `SuggestButton` carrying its
    // evidence. The two must not look alike, and the row this walk set is the
    // first kind.
    expect(
      !/guessed|Accept/i.test(levelText),
      `the row still offers it as a guess: ${levelText.replace(/\s+/g, " ").slice(0, 160)}`,
    );
    return "complex, decided";
  });

  await check("1.12", "the to-quote cell DISCLOSES what is missing, rather than linking away", async () => {
    await open(`${BASE}/dashboard/projects/${manifest.projectId}?tab=${firstPhase.id}`, 0);
    await ready(/Needed to quote|Client code|Item/i);
    await settled();
    const disclosure = page.locator("[aria-expanded]").first();
    expect(await disclosure.count(), "nothing on the phase table expands");
    const before = (await page.locator("body").innerText()).length;
    await disclosure.click();
    await page.waitForTimeout(1200);
    const after = await page.locator("body").innerText();
    expect(after.length > before, "the cell expanded and showed nothing");
    // The list is of QUESTIONS on that record, so it names fields rather than
    // repeating the count.
    expect(/[A-Za-z]{4,}/.test(after.slice(before)), "the expansion carries no field names");
    return `expanded, ${after.length - before} more characters of questions`;
  });

  // =========================================================================
  // 8. The record.
  // =========================================================================
  say("\n8. The record");
  // A record carrying a CONFIRMED DIMENSION, because that is what 1.13
  // corrects: the composed cell has to be seen to recompose, which a fabric
  // would not show.
  const target = await query(
    `select r.id, a.id as attribute_id, a.label, a.value, r.version
       from spec_records r join record_attributes a on a.record_id = r.id
      where r.project_id = $1 and a.status = 'active'
        and a.attr_group = 'dimension' and a.state = 'confirmed'
      order by a.sort_order limit 1`,
    [manifest.projectId],
  );
  expect(target.rows[0], "no record carries a confirmed dimension to correct");
  const recordId = target.rows[0].id;
  const correcting = target.rows[0];
  await open(`${BASE}/dashboard/records/${recordId}`, 0);
  // Four tabs over a client fetch: wait for the row this step is about rather
  // than for a number of seconds.
  await page.getByRole("tab").first().waitFor({ timeout: PATIENCE }).catch(() => {});
  await ready(new RegExp(String(correcting.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  await check("1.13", "a confirmed value is corrected from BESIDE it, and the page it came from is kept", async () => {
    // Matthew went looking for confirm-or-update on a confirmed record and
    // there was no such verb. Retiring destroys the statement; typing a new one
    // loses the page. Correcting keeps both.
    const row = page.locator("tr", { hasText: correcting.label }).first();
    const correct = row.getByRole("button", { name: "Correct", exact: true }).first();
    expect(await correct.count(), `no Correct beside “${correcting.label}”`);
    const panel = page.locator("tr", { hasText: `Correct “${correcting.label}”` }).first();
    expect(await press(correct, () => panel.count()), "the correction panel never opened");
    const value = panel.locator("input").first();
    await value.fill("1234");
    const why = panel.locator('input[placeholder^="Misread off page"]').first();
    expect(await why.count(), "the correction asks for no reason");
    // A REASON IS THE GATE. `attribute_correct` is in REASON_REQUIRED_KINDS and
    // has a database constraint behind it, so a correction with none writes
    // nothing at all.
    const save = panel.getByRole("button", { name: /^Save the correction$/ }).first();
    expect(await save.isDisabled(), "Save is enabled before a reason is typed");
    await why.fill("__QA first session — misread off the page");
    const corrected = async () => {
      const { rows } = await query(
        `select count(*)::int as n from record_attributes
          where record_id = $1 and status = 'active' and value = '1234'`,
        [recordId],
      );
      return rows[0].n > 0;
    };
    expect(await press(save, corrected), "Save the correction wrote nothing");
    await page.waitForTimeout(2000);

    const text = await ready(/1234/);
    expect(/1234/.test(text), "the corrected figure is not on the record");
    // THE COMPOSED CELL IS A PROJECTION OF THE ATTRIBUTES and must recompose.
    const answer = await query(
      `select a.value from spec_answers a join requirements q on q.id = a.requirement_id
        where a.record_id = $1 and q.spec_field_id is not null and a.value like '%1234%' limit 1`,
      [recordId],
    );
    expect(answer.rows[0], "the Dimensions answer did not recompose over the correction");

    const changes = await query(
      `select count(*)::int as n from change_sets where project_id = $1 and kind = 'attribute_correct'`,
      [manifest.projectId],
    );
    expect(changes.rows[0].n === 1, `expected one attribute_correct change set, found ${changes.rows[0].n}`);

    // THE RECORD'S OWN VERSION IS NOT TOUCHED. An attribute is its own row, and
    // bumping the record would invalidate every extraction snapshot and chase
    // coverage row taken against it for a reason that has nothing to do with them.
    const after = await query(`select version from spec_records where id = $1`, [recordId]);
    expect(
      Number(after.rows[0].version) === Number(correcting.version),
      `spec_records.version moved ${correcting.version} → ${after.rows[0].version}`,
    );

    // KEPT, NEVER DELETED: the old row is evidence that a document said it.
    const retiredToggle = page.locator("button", { hasText: /\d+ retired spec/ }).first();
    expect(await retiredToggle.count(), "the retired row is nowhere on the record");
    await press(retiredToggle, async () =>
      (await page.locator("body").innerText()).includes(String(correcting.value)),
    );
    const withRetired = await page.locator("body").innerText();
    expect(
      withRetired.includes(String(correcting.value)),
      `the old value “${correcting.value}” is not under show retired`,
    );

    // AND THE VERSION IS A VERSION, named for what happened.
    // The Versions tab loads only when opened — which is why its own tab
    // carries no count — so the press waits for the entry rather than for the
    // tab to look selected.
    const versions = page.getByRole("tab", { name: /Versions/i }).first();
    expect(await versions.count(), "the record has no Versions tab");
    const named = async () => /Spec corrected/.test(await page.locator("body").innerText());
    expect(await press(versions, named), "the record's versions do not name the correction");
    return `${correcting.value} → 1234 · one attribute_correct · record version ${after.rows[0].version} unchanged`;
  });

  // Back to the checklist for the assertions that read it.
  await page.getByRole("tab", { name: /Checklist/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);

  await check("1.3", "the BWS ordinal is not printed beside a field name", async () => {
    // `1 · COM 1` cost ninety seconds and a wrong guess. The id is the export's
    // key and belongs in a tip, never inline; the field NAME stays, because
    // that is the word BWS shows him.
    for (const tab of ["Checklist", "Gates"]) {
      const control = page.getByRole("tab", { name: new RegExp(tab, "i") }).first();
      if ((await control.count()) === 0) continue;
      await control.click();
      await page.waitForTimeout(1500);
      const text = await page.locator("body").innerText();
      const bare = /(?:^|\n)\s*\d+\s+·/.exec(text) ?? /\bBWS \d+\s*·/.exec(text);
      expect(!bare, `the ${tab.toLowerCase()} tab still prints an ordinal: ${bare?.[0]}`);
      expect(!/BWS null/.test(text), `the ${tab.toLowerCase()} tab prints "BWS null" for a question with no id`);
    }
    return "no ordinal on the checklist or the gates tab";
  });

  await check("1.4", "two counts that differ are explained in the same breath", async () => {
    const text = await page.locator("body").innerText();
    const outstanding = /(\d+) outstanding at TGQ/.exec(text);
    if (!outstanding) return "this record has no TGQ reading — the sentence has nothing to explain";
    // "5 outstanding at TGQ · 4 to chase, 1 you record here". The qualifier is
    // omitted where the difference is zero, which is the variance case.
    const chase = /(\d+) to chase/.exec(text);
    expect(chase, `"${outstanding[0]}" is printed with no chase count beside it`);
    const self = /(\d+) you record here/.exec(text);
    const difference = Number(outstanding[1]) - Number(chase[1]);
    expect(
      difference === 0 ? !self : self && Number(self[1]) === difference,
      `the counts differ by ${difference} and the sentence says ${self?.[0] ?? "nothing"}`,
    );
    return `${outstanding[0]} · ${chase[0]}${self ? `, ${self[0]}` : ""}`;
  });

  await check("7.4", "the record opens, names the item and shows what the drawing said", async () => {
    const text = await page.locator("body").innerText();
    expect(/Two-seat sofa/.test(text), `the record screen does not name the item: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
    expect(/Yarn Collective Tessarae/.test(text), "the fabric the card confirmed is not on the record");
    return "the confirmed fabric is on the record";
  });

  // =========================================================================
  // 9. The chase screen.
  // =========================================================================
  say("\n9. The chase screen");
  await open(`${BASE}/dashboard/drafts?projectId=${manifest.projectId}`, 0);
  await ready(/Draft it|Nothing ticked|Nobody chosen|Nothing needed to quote|Cannot be chased/i);

  await check("1.14", "nothing is preselected until a person is chosen", async () => {
    const text = await page.locator("body").innerText();
    expect(
      /Nobody chosen/i.test(text) || /Nothing ticked/i.test(text),
      "the chase screen preselected something with no contact chosen",
    );
    return "Everyone tab preselects nothing";
  });

  await check("1.14", "the preselection sentence counts both halves", async () => {
    const text = await page.locator("body").innerText();
    expect(
      /preselected/.test(text) || /Nobody chosen/i.test(text) || /Nothing needed to quote/i.test(text),
      "the footer says nothing about what was preselected",
    );
    return "stated";
  });

  note("no contact carries a designer code on this project, so there is nobody to chase — the per-contact preselection is covered in the component tier");

  // =========================================================================
  // 10. One forced failure: a stale version on the answer PATCH.
  // =========================================================================
  say("\n10. Force a failure");
  await check("7.4", "a stale version on an answer is a 409 the screen can show", async () => {
    const answer = await query(
      `select a.id, a.version from spec_answers a join spec_records r on r.id = a.record_id
        where r.project_id = $1 limit 1`,
      [manifest.projectId],
    );
    expect(answer.rows[0], "the project has no checklist answer to edit");
    const response = await context.request.patch(`${BASE}/api/answers/${answer.rows[0].id}`, {
      headers: { "content-type": "application/json" },
      data: { value: "__QA stale write", state: "confirmed", version: answer.rows[0].version - 1 },
    });
    expect(response.status() === 409, `expected 409, got ${response.status()}`);
    const body = await response.json().catch(() => ({}));
    expect(typeof (body.error ?? body.message) === "string", "the 409 carried no message for the row to show");
    const after = await query(`select value from spec_answers where id = $1`, [answer.rows[0].id]);
    expect(after.rows[0].value !== "__QA stale write", "the refused write landed anyway");
    return `409 · "${body.error ?? body.message}" · nothing written`;
  });

  await check("7.4", "the row unfreezes after a 409, and the message survives the reload it triggers", async () => {
    // THROUGH THE SCREEN, not through the API — the API half above proves the
    // server refuses; this proves the person is not left with a frozen row and
    // no idea why. A screen that reloads after every action clears its banner
    // on a successful load, so `setError` followed by `load()` showed the 409
    // for a few milliseconds and then nothing at all.
    await open(`${BASE}/dashboard/records/${recordId}`, 0);
    await page.getByRole("tab", { name: /Checklist/i }).first().waitFor({ timeout: PATIENCE });
    await page.getByRole("tab", { name: /Checklist/i }).first().click();
    await page.waitForTimeout(2500);

    // THE ROW IS CHOSEN OFF THE SCREEN, not out of the database. A question
    // picked by query may be one the checklist has not painted — folded into a
    // section, or below whatever the screen shows — and the walk then reports
    // "no control for X" about a screen that is working. Read the label the
    // page actually carries, then look THAT up.
    // `State of X` is an aria-label and never reaches `innerText`; waiting for
    // it waits for ever on a checklist that has already painted. Wait for the
    // states themselves, which are text, then read the labels off the DOM.
    await ready(/Missing|Confirmed|TBC/);
    const labels = await page
      .locator("select[aria-label^='State of ']")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    expect(labels.length > 0, "the checklist painted no state controls");
    const stale = await query(
      `select a.id, a.version, q.prompt from spec_answers a
         join requirements q on q.id = a.requirement_id
        where a.record_id = $1 and a.state = 'missing' and q.prompt = any($2::text[])
        limit 1`,
      [recordId, labels.map((label) => label.replace(/^State of /, ""))],
    );
    expect(stale.rows[0], "no unanswered question on screen to edit");
    const control = page.getByLabel(`State of ${stale.rows[0].prompt}`).first();
    expect(await control.count(), `no state control for “${stale.rows[0].prompt}”`);

    // SOMEBODY ELSE ANSWERS IT while the screen is open. A legitimate edit, at
    // the version the row actually holds — so the SCREEN is now one behind.
    //
    // TBC, NOT CONFIRMED, and that is not a detail: the checklist opens
    // filtered to what blocks a quote, so answering it outright takes the row
    // off the screen and the walk then reports a missing control on a screen
    // that is behaving correctly. TBC is an answer that still blocks.
    const bump = await context.request.patch(`${BASE}/api/answers/${stale.rows[0].id}`, {
      headers: { "content-type": "application/json" },
      data: { value: "__QA answered by somebody else", state: "tbc", version: stale.rows[0].version },
    });
    expect(bump.ok(), `the setup edit was refused: ${bump.status()}`);

    await control.selectOption("tbc");
    await page.waitForTimeout(3500);

    const text = await page.locator("body").innerText();
    expect(/changed by someone else|was not saved/i.test(text), "the 409 left no message on the screen");
    // AND THE ROW IS USABLE AGAIN. `savingId` is cleared in a finally path, so
    // an HTML error page or a refused request cannot leave the control disabled
    // with no way back.
    const reopened = page.getByLabel(`State of ${stale.rows[0].prompt}`).first();
    await reopened.waitFor({ timeout: Math.min(PATIENCE, 60000) });
    expect(!(await reopened.isDisabled()), "the row is still frozen after the refusal");
    return "message shown, control enabled";
  });
} catch (error) {
  results.push({ ok: false, item: "walk", what: "the walk reached the end", detail: error instanceof Error ? error.stack : String(error) });
  console.log(`\n  FAIL  [walk] ${error instanceof Error ? error.message : String(error)}`);
} finally {
  // =========================================================================
  // 11. Clean up from the manifest.
  // =========================================================================
  manifest.finishedAt = new Date().toISOString();
  manifest.results = results;
  manifest.skipped = skipped;
  manifest.notes = notes;
  manifest.consoleAndNetworkFailures = failures;
  writeManifest();

  say("\n11. Clean up");
  say(`   manifest: ${manifestPath}`);
  if (browser) await browser.close().catch(() => {});
  await client.end().catch(() => {});

  if (keep) {
    say(`   --keep: ${projectName} was left behind. Sweep it with:`);
    say(`   node --env-file=.env.local .claude/skills/verify/files/qa-cleanup.mjs --prefix='${projectName}' --user-prefix=none --apply`);
  } else {
    // THE ORDER IS KNOWLEDGE AND IT LIVES IN ONE FILE. `qa-cleanup.mjs` holds
    // the foreign-key-safe order, the tables it deliberately leaves alone
    // (audit_log, notes) and the production refusal. A second copy of that
    // order here is a second thing to keep in step with the schema.
    const sweep = spawnSync(
      process.execPath,
      [
        path.join(import.meta.dirname, "qa-cleanup.mjs"),
        `--prefix=${projectName}`,
        "--user-prefix=none",
        "--apply",
      ],
      { encoding: "utf8", env: process.env },
    );
    process.stdout.write((sweep.stdout ?? "").replace(/^/gm, "   "));
    if (sweep.status !== 0) say(`   cleanup exited ${sweep.status}: ${sweep.stderr ?? ""}`);
    say("   blobs are NOT deleted — the reused one belongs to the source project and must stay; see the manifest.");
  }

  // =========================================================================
  // What it found.
  // =========================================================================
  const failed = results.filter((r) => !r.ok);
  say("\n" + "=".repeat(72));
  say(`PASS ${results.length - failed.length}   FAIL ${failed.length}   SKIP ${skipped.length}`);
  if (failed.length) {
    say("\nFAILED:");
    for (const row of failed) say(`  [${row.item}] ${row.what} — ${row.detail.split("\n")[0]}`);
  }
  if (skipped.length) {
    say("\nSKIPPED — turn each into a check as its item lands on staging:");
    for (const row of skipped) say(`  [${row.item}] ${row.what} — ${row.why}`);
  }
  // A FAILED API CALL IN THIS APP USUALLY RENDERS AS AN EMPTY LIST rather than
  // an error, so "the page looked fine" is not evidence. Read this every run.
  say(`\nConsole and network failures: ${failures.length}`);
  for (const failure of failures.slice(0, 40)) say(`  ${failure}`);
  if (failures.length > 40) say(`  … and ${failures.length - 40} more (all of them are in the manifest)`);
  say("=".repeat(72));

  process.exit(failed.length ? 1 : 0);
}
