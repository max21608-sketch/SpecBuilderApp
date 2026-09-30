#!/usr/bin/env node
// NOTHING IS WIDER THAN ITS BOX — walked, at the two widths every screen is
// reviewed at. Read only: it opens pages and presses nothing.
//
//   PLAYWRIGHT_DIR=/path/to/dir/with/playwright \
//   PLAYWRIGHT_CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
//   BASE=http://localhost:3100 QA_EMAIL=... QA_PASSWORD=... \
//   node tools/overflow-audit.mjs [--project=<uuid>] [--records=2]
//
// ============================================================================
// Against a DEV server only: the detector is `src/lib/overflow.ts`, exposed by
// the dev-only `OverflowWatch` as `window.__specBuilderOverflows`, so this
// script and the console warning a developer sees are one predicate. A
// production build does not carry it, and the script says so rather than
// reporting a clean screen it never measured.
//
// It walks: the projects list; each project's overview and every tab in its
// tab strip; the first N records of the first phase and each of their four
// tabs; the project's fill-in and chase screens; the inbox; and each document
// review linked from the Documents tab. At 1920x1080 and 1440x900. Exit 1 if
// any page has an overflow, listing each one with the box and its pixels.
//
// Playwright is not a repo dependency (see
// `.claude/skills/verify/files/playwright-session.mjs`), so it is imported from
// `PLAYWRIGHT_DIR` by path, the way `first-session.mjs` does.
// ============================================================================
import path from "node:path";
import { pathToFileURL } from "node:url";

const playwrightDir = process.env.PLAYWRIGHT_DIR;
if (!playwrightDir) {
  console.error("Set PLAYWRIGHT_DIR to a directory with playwright installed (see the header).");
  process.exit(2);
}
// `playwright-session.mjs` copied next to playwright, as first-session.mjs wants it.
const { openSession, BASE } = await import(pathToFileURL(path.join(playwrightDir, "playwright-session.mjs")).href);

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const onlyProject = arg("project", null);
const recordsPerProject = Number(arg("records", "2"));
const WIDTHS = [
  [1920, 1080],
  [1440, 900],
];

const { browser, page } = await openSession();

async function settle() {
  await page.waitForLoadState("networkidle").catch(() => {});
  // A spinner is not a screen: wait for the page's own content, then a beat
  // for the late-loading panels.
  await page.locator("main h1").first().waitFor({ timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

async function hrefs(selector) {
  return page.$$eval(selector, (as) => [...new Set(as.map((a) => a.getAttribute("href")).filter(Boolean))]);
}

// ---- the pages to walk ---------------------------------------------------
await page.goto(`${BASE}/dashboard/projects`);
await settle();
const measured = await page.evaluate(() => typeof window.__specBuilderOverflows === "function");
if (!measured) {
  console.error("This page carries no overflow detector: run against a DEV server (`npm run dev:local`).");
  await browser.close();
  process.exit(2);
}

const pages = new Set(["/dashboard/projects", "/dashboard/inbox"]);
const projectLinks = onlyProject
  ? [`/dashboard/projects/${onlyProject}`]
  : (await hrefs('a[href^="/dashboard/projects/"]')).filter((h) => /^\/dashboard\/projects\/[0-9a-f-]{36}$/.test(h)).slice(0, 3);

for (const project of projectLinks) {
  pages.add(project);
  await page.goto(`${BASE}${project}`);
  await settle();
  for (const tab of await hrefs(`a[href^="${project}?tab="]`)) pages.add(tab);
  pages.add(`${project}/infill`);
  // The first phase tab is the one with records on it.
  const phase = (await hrefs(`a[href^="${project}?tab="]`)).find((h) => !/tab=(overview|finishes|documents|history)$/.test(h));
  if (phase) {
    await page.goto(`${BASE}${phase}`);
    await settle();
    await page.locator("table tbody tr").first().waitFor({ timeout: 90000 }).catch(() => {});
    const records = (await hrefs('a[href^="/dashboard/records/"]')).slice(0, recordsPerProject);
    for (const record of records) {
      const base = record.split("?")[0];
      for (const tab of ["specs", "checklist", "gates", "versions"]) pages.add(`${base}?tab=${tab}`);
    }
  }
  await page.goto(`${BASE}${project}?tab=documents`);
  await settle();
  for (const review of (await hrefs('a[href^="/dashboard/imports/"]')).slice(0, 4)) pages.add(review);
}

// ---- measure ---------------------------------------------------------------
let failures = 0;
for (const [width, height] of WIDTHS) {
  await page.setViewportSize({ width, height });
  for (const url of pages) {
    await page.goto(`${BASE}${url}`);
    await settle();
    await page.locator("table tbody tr").first().waitFor({ timeout: 15000 }).catch(() => {});
    const found = await page.evaluate(() => window.__specBuilderOverflows?.() ?? []);
    if (found.length === 0) {
      console.log(`ok    ${width}  ${url}`);
      continue;
    }
    failures += found.length;
    console.log(`OVER  ${width}  ${url}`);
    for (const overflow of found) console.log(`        ${overflow.overBy}px  ${overflow.where}`);
  }
}
await browser.close();
console.log(failures === 0 ? `\nNo overflow on ${pages.size} pages at 1920 and 1440.` : `\n${failures} overflow(s).`);
process.exit(failures === 0 ? 0 : 1);
