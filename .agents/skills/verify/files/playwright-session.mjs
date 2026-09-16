// A logged-in browser, and the two things that are fiddly to get right.
//
// ============================================================================
// HOW TO USE IT. Playwright is deliberately NOT a repo dependency — a
// verification tool in package.json is a tool that gets imported by product
// code. So the project lives in the session scratchpad and this file is copied
// or symlinked next to it:
//
//   cd "$SCRATCHPAD" && npm init -y && npm install playwright
//   cp "$REPO/.claude/skills/verify/files/playwright-session.mjs" .
//   QA_EMAIL=... QA_PASSWORD=... BASE=http://localhost:3457 node check.mjs
//
// Install `playwright@latest`. Older pinned versions want a Chromium build
// that is not in ~/Library/Caches/ms-playwright and fail on launch.
//
// CREDENTIALS COME FROM THE ENVIRONMENT AND ARE NEVER WRITTEN DOWN HERE.
// Create the throwaway user with tools/create-user.mjs, and delete it
// afterwards — qa-cleanup.mjs in this folder does that.
// ============================================================================
import { chromium } from "playwright";

export const BASE = process.env.BASE ?? "http://localhost:3457";

/**
 * Log in and hand back a page on /dashboard.
 *
 * The first hit to a route can 404 while dev-mode compiles it, which reads
 * exactly like a broken route and has sent more than one verification run
 * chasing a bug that was not there. Hence the retry.
 */
export async function openSession({ headless = true, email = process.env.QA_EMAIL, password = process.env.QA_PASSWORD } = {}) {
  if (!email || !password) throw new Error("Set QA_EMAIL and QA_PASSWORD. Create the user with tools/create-user.mjs.");

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  // Granted up front: a clipboard assertion cannot ask for permission
  // mid-test, and `navigator.clipboard.read()` rejects silently without it.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    if (response && response.status() < 400) break;
    await page.waitForTimeout(1500);
  }

  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });

  return { browser, context, page };
}

/**
 * A download (an .eml, an export, a check sheet) WITHOUT the click-and-wait
 * dance: `context.request` carries the session cookie, so a plain GET is
 * enough. Returns the response so a test can read its headers — which is where
 * `x-export-records` and `x-check-sheet-rows` live.
 */
export async function fetchAs(context, path) {
  return context.request.get(path.startsWith("http") ? path : `${BASE}${path}`);
}

/**
 * Console errors and failed requests, collected from the moment it is called.
 *
 * A failed API call in this app usually renders as an empty list rather than
 * an error, so "the page looks fine" is not evidence. Attach this before
 * navigating and read it at the end.
 */
export function watchForFailures(page) {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => failures.push(`request failed: ${request.method()} ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return failures;
}
