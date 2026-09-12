---
name: verify
description: Build, run, and drive this app in a real browser to verify a change end-to-end.
---

# Verifying a change end-to-end

Automated tests do not prove a user-facing change works. Drive it.

## Build & launch

- `PORT=3457 npm run dev`. Port 3000 is often held by something else; pick a
  free one rather than fighting for it.
- Next.js loads `.env.local` automatically.
- The first hit to a route can 404 while dev-mode compiles it. Retry the goto
  once or twice before believing it.

## Auth handle

- Login form at `/login`: `input[type=email]`, `input[type=password]`,
  `button[type=submit]`. Redirects to `/dashboard`.
- Throwaway login (delete it afterwards):
  ```
  node --env-file=.env.local tools/create-user.mjs qa-x@example.com "QA User" admin '<password>'
  ```
- To test the authorization boundary you need a **second** user at the
  read-only role. A write as that user must come back 403 from middleware.

## Browser driving

- Playwright is deliberately NOT a repo dependency. Install `playwright@latest`
  in the session scratchpad (`npm init -y && npm install playwright`). The
  Chromium build is already cached in `~/Library/Caches/ms-playwright`. Older
  pinned Playwright versions want a different Chromium build and fail — use
  latest.
- Clipboard assertions:
  `context.grantPermissions(["clipboard-read","clipboard-write"], { origin: BASE })`
  then `navigator.clipboard.read()` inside `page.evaluate`.
- File downloads (`.eml`, exports): `page.request.get(href)` shares the session
  cookie, so no click/download dance is needed.
- Check the browser console and the network response, not just the rendered
  page. A failed API call often renders as an empty list rather than an error.

## What to actually check

- The happy path.
- **At least one failure path.** Malformed input, a 500, a concurrent edit.
  Error paths are where the "busy state stuck forever" bugs live.
- The staging banner and `[STAGING]` title are present on non-production.
- `/api/auth/me` reports the environment you think you are in.

## Test data & cleanup

- Seed rows directly with `pg`
  (`node --env-file=.env.local -e "..."`), prefixing every name with `__QA ` /
  `__qa_` so cleanup is one `like` sweep.
- Write down the IDs you create as you go. Deleting by prefix works until a
  name gets edited during the test.
- Delete in foreign-key-safe order, children first.
- **Leave `audit_log` alone.** It is append-only by design, and a cleanup that
  deletes from it has broken the thing under test. The same goes for `notes`.

## Gotchas

- Migrations are tracked in `schema_migrations` and the runner is idempotent:
  `npm run db:migrate` is safe to re-run and will skip what is already applied.
  Do NOT hand-run individual migration files — that applies them without
  recording them, and the next run then tries to apply them again.
- Seeds are idempotent only until someone renames a seeded row by hand. After
  that, re-running duplicates it.
- Database-tier tests skip silently without `DATABASE_URL`. A green `npm test`
  does not mean they ran.
