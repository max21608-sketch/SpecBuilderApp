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
// AND THE NEWEST ONE WANTS A BUILD THAT IS NOT CACHED EITHER, which is the
// same failure from the other end and cost a session to find. Point it at the
// Chromium that IS on the machine rather than downloading one:
//
//   export PLAYWRIGHT_CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
//
// `ls ~/Library/Caches/ms-playwright` names the build numbers actually there.
// Unset, this launches Playwright's own default, which is right on a machine
// where the download has been done.
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
export async function openSession({
  headless = true,
  email = process.env.QA_EMAIL,
  password = process.env.QA_PASSWORD,
  executablePath = process.env.PLAYWRIGHT_CHROMIUM,
} = {}) {
  if (!email || !password) throw new Error("Set QA_EMAIL and QA_PASSWORD. Create the user with tools/create-user.mjs.");

  const browser = await chromium.launch(executablePath ? { headless, executablePath } : { headless });
  const context = await browser.newContext();
  // Granted up front: a clipboard assertion cannot ask for permission
  // mid-test, and `navigator.clipboard.read()` rejects silently without it.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();

  // The retry catches a THROW as well as a bad status: a dev server compiling
  // the route under load exceeds the navigation timeout rather than answering,
  // and an uncaught timeout on the first hit ends the run before it starts.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (response && response.status() < 400) break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await page.waitForTimeout(2000);
  }

  // WAIT FOR HYDRATION BEFORE TYPING, or the form submits NATIVELY.
  //
  // The sign-in form is a React component with an `onSubmit` handler, and until
  // that handler is attached the browser treats it as an ordinary HTML form:
  // filling and pressing before hydration does a full-page GET to /login with
  // the credentials on the query string, which lands back on the sign-in page
  // looking exactly like a rejected password. Found the hard way, twice.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  // TWICE, if the first press does nothing. Hydration is a race with the dev
  // server's own compile, and a press that lands a moment early submits the
  // form natively and comes back to /login — which is indistinguishable from a
  // rejected password unless the walk tries again.
  let signedIn = false;
  for (let attempt = 0; attempt < 2 && !signedIn; attempt += 1) {
    await page.fill("input[type=email]", email);
    await page.fill("input[type=password]", password);
    try {
      // Both in flight together: the navigation can complete before a separate
      // `waitForURL` is even registered, and then it waits for one that has
      // already happened.
      await Promise.all([
        page.waitForURL(/\/dashboard/, { timeout: 20000 }),
        page.click("button[type=submit]"),
      ]);
      signedIn = true;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2000);
    }
  }

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
