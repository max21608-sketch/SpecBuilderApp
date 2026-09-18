---
name: verify
description: Build, run, and drive this app in a real browser to verify a change end-to-end.
---

# Verifying a change end-to-end

Automated tests do not prove a user-facing change works. Drive it.

## What is already written

`files/` holds the two pieces that were being rebuilt every run. Neither is a
repo dependency, and neither belongs in one.

- `files/playwright-session.mjs` — a logged-in page, clipboard permissions,
  the dev-mode 404 retry, cookie-sharing downloads, and a console/network
  failure collector. Copy it next to the scratchpad Playwright project.
- `files/qa-cleanup.mjs` — deletes a QA run in foreign-key-safe order. Dry run
  by default; `--apply` writes. It leaves `audit_log` and `notes` alone by
  design, and it does NOT clear Vercel Blob.

## Build & launch

- `PORT=3457 npm run dev`. Port 3000 is often held by something else; pick a
  free one rather than fighting for it.
- Next.js loads `.env.local` automatically.
- The first hit to a route can 404 while dev-mode compiles it. Retry the goto
  once or twice before believing it.

## Auth handle

- Login form at `/login`: `input[type=email]`, `input[type=password]`,
  `button[type=submit]`. Redirects to `/dashboard`.
- Throwaway login (delete it afterwards — `files/qa-cleanup.mjs` matches
  `qa-` emails):
  ```
  node --env-file=.env.local tools/create-user.mjs qa-x@example.com "QA User" admin '<password>'
  ```
- To test the authorization boundary you need a **second** user at the
  read-only role. A write as that user must come back 403 from middleware.

## Browser driving

- Playwright is deliberately NOT a repo dependency — a verification tool in
  `package.json` is a tool product code starts importing. Install
  `playwright@latest` in the session scratchpad
  (`npm init -y && npm install playwright`), then copy
  `files/playwright-session.mjs` next to it. The Chromium build is already
  cached in `~/Library/Caches/ms-playwright`. Older pinned Playwright versions
  want a different build and fail — use latest.
- `openSession()` there already grants clipboard permissions and retries the
  dev-mode 404; `fetchAs(context, path)` downloads `.eml`, exports and check
  sheets over the session cookie, with the response headers intact.
- Attach `watchForFailures(page)` before navigating and read it at the end.
  Check the browser console and the network response, not just the rendered
  page: a failed API call in this app usually renders as an empty list rather
  than an error.

## What to actually check

- The happy path.
- **At least one failure path.** Malformed input, a 500, a concurrent edit.
  Error paths are where the "busy state stuck forever" bugs live.
- The environment chip (yellow `STAGING` / `DEV`) is in the dark top bar on
  every dashboard page and under the sign-in card, and `[STAGING]` is in the
  title, on non-production. There is no full-width banner any more (2026-09-18,
  Max's decision against the approved mock-ups); a screen without the chip is
  a screen whose layout dropped it.
- The screen matches its tab in `docs/design/spec-builder-mockups.html` like
  for like — same bands, same tiles, same columns. "Inspired by" is the fault
  that cost the first attempt (`17ff4e0`). See the `new-screen` skill.
- `/api/auth/me` reports the environment you think you are in.

## The drawings review has its own procedure

`docs/plans/intake-review-verification.md` — the twelve-point card checklist and
its verdict vocabulary. Read it before driving a pack, because this is the
screen where the app's defects have actually lived: four separate times the rows
were right in `intake_runs.parsed` and wrong in front of the reviewer, which is
exactly the class of failure the four checks cannot see.

Two things from it that apply to any drawings work:

- **Dump the run first.** `npm run dump:drawings -- --run=<id>` prints what the
  staged JSON reduces to through the REAL read-time pipeline: measured rows,
  placed slots, folded rows, unit provenance, and the composed BWS cell. Run it
  before and after a change and the diff IS the change. Do not re-derive any of
  that by reading the JSON yourself — a second implementation agrees with itself
  rather than with the app.
- **Never confirm on a real project.** A confirm creates records and variants
  and there is no undo for somebody's sandbox. Copy the project (`__QA ` prefix)
  and confirm on the copy. Copied records need `status = 'active'` set
  explicitly, and `/api/imports/<id>/source` 404s on a copy because the PDF
  stays under the original project's blob prefix — so no page previews and no
  crops there, by design.

## Test data & cleanup

- Seed rows directly with `pg` (write a `.mjs` file **in the repo root** and
  delete it afterwards — a script in the scratchpad cannot resolve `pg`),
  prefixing every project name with `__QA ` so cleanup is one `like` sweep.
  A record with a `parent_id` also needs `depth = 1` and a `split_reason` of
  `fabric` or `configuration`; a `dimension` attribute needs a slot.
- Write down the IDs you create as you go. Deleting by prefix works until a
  name gets edited during the test.
- Then:
  ```
  node --env-file=.env.local .claude/skills/verify/files/qa-cleanup.mjs
  node --env-file=.env.local .claude/skills/verify/files/qa-cleanup.mjs --apply
  ```
  Read the dry run before applying, and narrow it with
  `--prefix='__QA <this run>'` when somebody else's QA data is in the same
  sandbox. `--user-prefix=none` leaves throwaway logins alone.
- **Leave `audit_log` alone.** It is append-only by design, and a cleanup that
  deletes from it has broken the thing under test. The same goes for `notes`.
  The script already does.
- **Uploaded blobs are not covered.** Clear them from the Vercel Blob
  dashboard; the cleanup script has no blob credentials and must never be
  given any.

## Gotchas

- Migrations are tracked in `schema_migrations` and the runner is idempotent:
  `npm run db:migrate` is safe to re-run and will skip what is already applied.
  Do NOT hand-run individual migration files — that applies them without
  recording them, and the next run then tries to apply them again.
- Seeds are idempotent only until someone renames a seeded row by hand. After
  that, re-running duplicates it.
- Database-tier tests skip silently without `DATABASE_URL`. A green `npm test`
  does not mean they ran.
