# Stack — what runs where

The Project Spec Builder is a Next.js app on Vercel with a Neon Postgres
database in London, used by Ben Whistler's KAM and sales-support people to hold
the specification record for a project from tender through to delivery. It is
small on purpose: the database is the product, and everything else is a way to
read and write it safely.

See also `environments.md` (which deployment is which) and `recovery.md` (what
to do when one of these is down).

## The services, and the cost of losing each

| Service | Holds | Cost of losing it |
|---|---|---|
| Vercel (`spec-builder-app`) | The application code | Low — redeploy from git in ~2 minutes |
| Neon Postgres (`SpecBuilder`, London) | Every spec record, value, gate and audit row | **Total.** This is the app. |
| Vercel Blob | Uploaded BOQs, FF&E schedules, spec bibles | High — not covered by database backups, and not provisioned yet |
| Anthropic API (M2) | Nothing; stateless | Extraction stops; existing data is fine |
| Microsoft Graph (M5) | Nothing; read-only | Inbound stops; nothing is lost |
| BWS | The job and quote records this app feeds | Out of our hands. Read-only from here, forever. |

**The database is the app.** The website is disposable and rebuildable; the
database is not. Every recovery decision follows from that.

## What each part does

**Neon Postgres** holds everything that matters. It is region-pinned to London
because the material is NDA-covered client specification data. The production
database will be a *separate Neon project* rather than a branch of this one, so
no console action can cross the boundary.

**Vercel** runs the app. Functions are pinned to `lhr1` in `vercel.json` rather
than set in the dashboard, because a committed declaration survives the project
being recreated and a dashboard setting does not. Left unpinned it defaults to
`iad1`, which puts every query across the Atlantic from a London database.

**Vercel Blob** will hold uploaded source documents. Reads are authenticated —
possession of a blob URL is not access — and uploads go straight from the
browser to the store rather than through a route handler, because a real source
document (12.4 MB on the fabric-ordering app) exceeds the request-body ceiling.

**The queue** exists because a model call takes minutes and a serverless request
cannot be held open that long. A cut connection would otherwise leave a row at
`processing` and a screen that polls forever. The consumer claims work in one
predicated `update ... returning`, so a retry cannot double-bill a model call.

**BWS** is the system of record for jobs and quotes. This app reads exports from
it and produces a file a human uploads back. It never writes.

## What it does **not** have

State the deliberate absences. Each one is a risk removed, and writing them
down stops someone assuming a safety net that is not there.

- **No write path to BWS.** None. The export is a file a human uploads.
- **No outbound email sending.** Drafts only, sent by a human from their own
  Outlook.
- **No third-party identity provider.** Own users table, scrypt hashes, a JWT
  cookie. No SSO, no password reset flow — an admin sets a password.
- **No per-project permissions.** Any signed-in account sees all client
  material; roles restrict writes only. With NDA material across multiple
  clients this is a real limitation, not an oversight — it is simply not built.
- **No monitoring or alerting.** Nobody is paged. You find out because someone
  tells you.
- **No blob backup or retention policy.** `del` is called nowhere and uploads
  use `addRandomSuffix`, so source documents accumulate indefinitely and are in
  no backup. Inherited from the kit and not yet fixed.
- **No production environment.** Not created, not authorized.
- **No automated backups.** `db/backup.mjs` is run by a human, or not at all.

## What runs on a schedule

| Job | When | What it does | What happens if it stops |
|---|---|---|---|
| — | — | Nothing is scheduled yet. M5's inbox poll is the first. | — |

## Where the code lives

| Concern | Path |
|---|---|
| Schema | `db/migrations/` |
| Authorization boundary | `src/middleware.ts`, `src/lib/session.ts` |
| Environment guard | `src/lib/env.ts` |
| Database client | `src/lib/db.ts` |
| Queue + consumer | `src/lib/extraction-queue.ts`, `src/app/api/queues/[topic]/route.ts` |
| Audit + optimistic locking | `src/lib/audit.ts` |
| Document parsing (XLSX/CSV/PDF) | `src/lib/intake-source.ts` |
| Fuzzy matching core | `src/lib/matching.ts` |
| Session landing page | `src/app/dashboard/` |

## How a change reaches the user

```
edit -> npm run lint / typecheck / test / build
     -> commit -> push staging
     -> Vercel builds THAT SHA -> Ready
     -> verify signed in on staging
     -> (explicit authorization) -> main -> production
```

A migration is a separate operation from a deploy, and the order matters. See
`house/deployment.md`.
