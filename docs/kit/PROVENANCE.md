# Chassis provenance

Every file here came from `benwhistler/fabric-ordering-app` (the "autofab"
repo), captured 2026-09-12. This file records where each one came from and what
was changed, so an upstream fix can be ported **deliberately** rather than by
accident or not at all.

There is no automatic sync. That is the trade: no cross-repo coupling, at the
cost of having to look. When you fix something here that also exists upstream —
or vice versa — port it and note it in the kit `CHANGELOG.md`.

## Verbatim

Copied unchanged. An upstream fix to any of these is worth porting.

| Kit path | Origin |
|---|---|
| `src/lib/db.ts` | `src/lib/db.ts` |
| `src/lib/env.ts` | `src/lib/env.ts` |
| `src/lib/auth-node.ts` | `src/lib/auth-node.ts` |
| `src/lib/session.ts` | `src/lib/session.ts` |
| `src/lib/audit.ts` | `src/lib/audit.ts` |
| `src/lib/api-fetch.ts` | `src/lib/api-fetch.ts` |
| `src/lib/use-poll.ts` | `src/lib/use-poll.ts` |
| `src/lib/numeric.ts` | `src/lib/numeric.ts` |
| `src/lib/html-text.ts` | `src/lib/html-text.ts` |
| `src/app/api/auth/login/route.ts` | same |
| `src/app/api/auth/logout/route.ts` | same |
| `src/app/api/auth/me/route.ts` | same |
| `src/app/globals.css` | same |
| `src/components/ui/Spinner.tsx` | same |
| `src/components/ui/IssueLink.tsx` | same |
| `src/components/layout/EnvironmentBanner.tsx` | same |
| `db/script-env.mjs` | same |
| `db/restore.mjs` | same |
| `db/run-seed.mjs` | same |
| `tools/hash-password.mjs` | same |
| `tests/lib/api-fetch.test.ts`, `tests/lib/eml.test.ts`, `tests/lib/html-text.test.ts` | same paths | unchanged |
| `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.mjs` | same (excluded dir renamed `Past work` → `Reference`) |

## Changed

| Kit path | Origin | Change, and why |
|---|---|---|
| `src/lib/auth.ts` | `src/lib/auth.ts` | `SESSION_COOKIE` is a `CUSTOMIZE_` placeholder. Two apps on a shared parent domain would otherwise share `fo_session` and overwrite each other's sessions. |
| `src/lib/eml.ts` | same | Comments de-domained. Logic unchanged, CR/LF header stripping intact. |
| `src/lib/html-sanitize.ts` | same | `data-rfq-address` → `data-address-block`. |
| `src/lib/intake-source.ts`, `src/lib/intake-source-types.ts` | same | `RfqSource`→`DocumentSource`, `prepareRfqSource`→`prepareDocumentSource`, `INTAKE_UPLOAD_CONTENT_TYPES`→`UPLOAD_CONTENT_TYPES`. |
| `src/lib/extraction-queue.ts` | same | Message union reduced to one placeholder variant; added the note that a topic has no consumer until its `vercel.json` deploy lands. |
| `src/lib/extraction-claim.ts` | same | Comments de-domained. Constants unchanged. |
| `src/lib/matching.ts` | same | Cut to the generic core (`normaliseName`, `wordSet`, `scoreMatch`, `findBestMatches`, `MatchResult`) plus a generic `matchName`. The fabric/supplier denylist and the distributor + fabric-specific wrappers were dropped. |
| `src/middleware.ts` | same | **Matcher polarity inverted.** Upstream lists 26 protected prefixes, so a forgotten route is wide open. The kit is default-protected with an explicit public list, so a forgotten route is merely inaccessible. Roles generalised to `admin`/`editor`/`viewer`. |
| `src/app/api/uploads/token/route.ts` | `src/app/api/intake/upload-token/route.ts` | Path and const renamed. |
| `src/app/api/queues/[topic]/route.ts` | `src/app/api/queues/document-extraction/route.ts` | One message kind; calls the generic run module. Retry, `MAX_DELIVERIES`, `visibilityTimeoutSeconds` and the terminal-failure write are unchanged. |
| `src/lib/extraction-run.ts` | `src/lib/project-import-run.ts` | The claim / release-vs-fail / stale-reclaim skeleton kept in full, with the model call and staging write reduced to commented `CUSTOMIZE` blocks. This file is the single most valuable thing in the chassis. |
| `src/app/layout.tsx`, `src/app/login/page.tsx`, `src/components/ui/NavShell.tsx` | same | App name and nav entries replaced with placeholders. |
| `src/hooks/useUnsavedChangesWarning.ts` | `src/components/reference/useUnsavedChangesWarning.ts` | Moved to `hooks/`; default message de-domained. |
| `db/run-migrations.mjs` | same | `BASELINE` backfill removed — a new app has no pre-ledger history. The comment explains when you would need it back. |
| `db/backup.mjs` | same | **Default output moved outside the repo** to `~/bw-backups/<app>/`. Upstream writes into an iCloud-synced working directory, which uploads NDA-covered client data to a personal cloud account. `BACKUP_DIR` overrides. |
| `tools/create-user.mjs` | same | Role list generalised, and **switched from the Neon HTTP driver to `pg` + `requireScriptEnvironment`**. Upstream's version bypasses the preflight entirely: it prints no target host and honours no `--yes-production` guard, on the one script that creates admin accounts. Found while verifying the chassis, 2026-09-12. Worth porting back upstream. |
| `tests/lib/intake-source.test.ts` | same | Renamed symbols; fixture filenames de-domained. |
| `tests/lib/html-sanitize.test.ts` | same | `data-rfq-address` → `data-address-block`. |
| `package.json.template` | `package.json` | Name is a placeholder. `mammoth`, `pdfjs-dist`, `fflate` and `postal-mime` dropped — add them back only if the app reads .docx, PDFs, OOXML or .eml. Scripts unchanged. |
| `next.config.ts` | same | `pdfjs-dist` note kept and marked conditional. |

## New — not from autofab

| Kit path | Why |
|---|---|
| `db/migrations/0001_foundation.sql` | Composed from autofab's `0001` **plus its later fixes already folded in**: the `write_audit` actor fallback (`0002`), the empty-GUC `nullif` (`0012`), and audit-log immutability (`0019`). Do not re-derive from autofab's `0001` alone — it is missing all three. `status_history` and `notes` were made polymorphic; `notes` gained the append-only trigger from `0018`. |
| `.github/workflows/ci.yml` | autofab has no CI at all. |
| `vercel.json` | Restructured for the single generic queue topic, and `regions: ["lhr1"]` added — autofab declares no region, so functions default to `iad1` while the database is in London. |
| `src/app/page.tsx`, `src/app/dashboard/` | New, no upstream equivalent. `/api/auth/login` redirects to `/dashboard`, so a chassis with no page there answers a successful sign-in with a 404 — indistinguishable from a broken sign-in at exactly the moment someone is proving a deployment works. The page states who is signed in, the app environment and the database environment. |
| `.gitignore` | Client-data patterns generalised. |
| `tests/db/foundation.test.ts` | New: tests the shared trigger functions against a scratch table, so it works with no domain tables present. |
| `tests/lib/matching.test.ts` | Rewritten for the generic API. |

## Known gaps inherited from upstream, NOT fixed here

- **No blob backup and no retention policy.** `del` from `@vercel/blob` is
  called nowhere upstream and uploads use `addRandomSuffix`, so NDA-covered
  documents accumulate indefinitely and are in no backup. The kit documents
  this in `templates/db/README.md` but does not solve it.
- **No monitoring or alerting.** Nobody is paged. You find out because someone
  tells you.
