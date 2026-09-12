# Environments

Written to stand alone for someone who is not a developer.

## The short version

| | Local | Staging | Production |
|---|---|---|---|
| Branch | `staging` | `staging` | none yet |
| Hosting project | your machine | Vercel `spec-builder-app` | not created |
| Database | sandbox | sandbox | production |
| Blob store | sandbox | sandbox | production |
| `APP_ENV` | `development` | `staging` | `production` |
| `DATABASE_ENVIRONMENT` | `sandbox` | `sandbox` | `production` |
| Purpose | building | testing with test data | real work |

These are physically separate resources, not labels. Separate hosting project,
separate database, separate blob store, separate secrets.

**There is no `main` branch and there is no production.** Vercel's *Production
Branch* setting for this project is `staging`, which is what makes a push to
`staging` claim the stable alias `spec-builder-app-rho.vercel.app` and receive
the project's environment variables. Vercel's "production deployment" is a
deployment class, not our environment: the variables it receives declare
`APP_ENV=staging`. Setting that field back to `main` would send every push down
the Preview path — a fresh hostname each time, so session cookies do not carry;
no project environment variables, so the app throws on a missing `APP_ENV`; and
Vercel Authentication in front of the URL, which reads as the app's own sign-in
being broken.

## Running locally

```bash
npm install
npm run dev
```

Environment comes from `.env.local`, which is never committed. It must declare
both `APP_ENV` and `DATABASE_ENVIRONMENT`; the app refuses to start otherwise,
and refuses outright if the two disagree (`src/lib/env.ts`).

Local development must never point at the production database. There is no
legitimate reason to, and the guard exists because the temptation is real when
debugging something that only reproduces with real data. Take a backup and
restore it into a sandbox branch instead.

## Deploying to staging

Commit, push `staging`, then confirm a deployment exists **for that exact
SHA**, wait for `Ready`, and verify the changed flow signed in. See
`house/deployment.md` for the full sequence and the traps.

## Deploying to production

Requires explicit authorization for that specific action, every time.

## Where environment variables live

| Variable | Local | Staging | Production |
|---|---|---|---|
| `APP_ENV` | `.env.local` | Vercel project | Vercel project |
| `DATABASE_ENVIRONMENT` | `.env.local` | Vercel project | Vercel project |
| `DATABASE_URL` | `.env.local` | Vercel project | Vercel project |
| `AUTH_SECRET` | `.env.local` | Vercel project | Vercel project |
| `ANTHROPIC_API_KEY` | `.env.local` | Vercel project | Vercel project |
| `BLOB_READ_WRITE_TOKEN` | `.env.local` | auto-injected | auto-injected |
| `CRON_SECRET` | `.env.local` | Vercel project | Vercel project |
| `GRAPH_*` (M5) | `.env.local` | Vercel project | Vercel project | |

Changing a variable does not change an existing deployment. Set it, then
trigger a new build, then verify the new build uses it.

## How to verify which database a deployment is actually using

Sign in and open `/api/auth/me`. It reports `appEnv` and `databaseEnvironment`.

Do this before entering real data into anything you did not personally deploy.
`DATABASE_ENVIRONMENT` is a declaration, not a probe — it says what the
operator believed, and this endpoint is how you check the belief.

## Handling a schema change

1. Back up the target database.
2. Apply the migration to sandbox; verify.
3. Deploy the dependent code to staging; verify the flow.
4. With authorization: back up production, apply, deploy, verify.

Additive migrations go before the code that uses them. Destructive ones go
after the code that stopped using the column.

## Refreshing the sandbox

There is nothing to refresh from yet: production does not exist. When it does,
a refresh is `db/backup.mjs` against production followed by `db/restore.mjs`
into a fresh sandbox branch — never a live connection between the two.

Deliberately not copied, when that day comes: `users` (staging accounts stay
staging accounts, and password hashes should not travel), and the blob store.

Never copy sandbox data into production.

## KNOWN GAPS

**Observed 2026-09-12, at scaffold time. None of these are solved problems.**

1. **Staging and local share one database.** Both point at the Neon `sandbox`
   branch, so a local `db:migrate` or a careless delete changes what staging
   shows. Acceptable while nobody else is using staging; not acceptable once
   somebody is testing against it.
2. **No blob store exists.** M1's BOQ upload needs one. Uploads will fail with
   a missing-token error until it is created and connected.
3. **Production is undefined beyond "a separate Neon project".** No Vercel
   project, no domain, no branch, no authorization to create any of them.
4. **Backups are manual.** Nothing runs `db/backup.mjs` on a schedule, so the
   real recovery point is "whenever someone last remembered".
