# Environments

Written to stand alone for someone who is not a developer.

## The short version

| | Local | Staging | Pilot | Production |
|---|---|---|---|---|
| Branch | `staging` | `staging` | `pilot` | none yet |
| Hosting project | your machine | Vercel `spec-builder-app` | Vercel `spec-builder-pilot` | not created |
| Region | — | `lhr1` | `lhr1` | `lhr1` |
| Database | sandbox | sandbox | its own Neon **project**, `SpecBuilder Pilot` | its own Neon project |
| Blob store | sandbox | sandbox | its own, private | production |
| `APP_ENV` | `development` | `staging` | `pilot` | `production` |
| `DATABASE_ENVIRONMENT` | `sandbox` | `sandbox` | `pilot` | `production` |
| Chip / title | `DEV` | `STAGING` (yellow) | `PILOT` (sky) | none |
| Purpose | building | testing with test data | Matthew's stable build, his own data | real work |

These are physically separate resources, not labels. Separate hosting project,
separate database, separate blob store, separate secrets.

**Pilot is not production.** It carries real work and it is still a test
deployment: `isProduction()` is false there, the chip and the `[PILOT]` title
marker stay on, chase emails still redirect to the signed-in user, and
`house/deployment.md`'s production rules apply to production and to nothing
else. What pilot buys is the one thing staging cannot: a build that does not
change under Matthew while Max pushes to staging hourly.

Two names will tell you otherwise and both are somebody else's word for
something else. Neon named the pilot project's default branch `production`, and
Vercel calls a deployment off a project's *Production Branch* a "production
deployment". Neither is this app's production environment, which does not
exist. `DATABASE_ENVIRONMENT` is what says which database you are on, and it is
a declaration a human sets — check it against the host every script prints.

**Its chip is a different colour on purpose.** Matthew reports by screenshot.
Two deployments whose chips read the same word means a screenshot cannot say
which build it came from, which sends somebody looking for a defect in code
that is not running.

**There is no `main` branch and there is no production.** The two deploy
targets are `staging` and `pilot`, and each Vercel project's *Production
Branch* setting names its own — `spec-builder-app`'s is `staging` and
`spec-builder-pilot`'s is `pilot`. That setting is what makes a push to
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

Local development must never point at the production database, or at the pilot
one. There is no legitimate reason to, and the guard exists because the
temptation is real when debugging something that only reproduces with real
data. Take a backup and restore it into a sandbox branch instead.

**The Neon CLI rewrites `.env.local`.** `neon link` and `neon deploy` pull
`DATABASE_URL` into it by default, with no prompt — on 2026-09-19 that
repointed the sandbox file at an empty project for six minutes while
`DATABASE_ENVIRONMENT` still read `sandbox`, which is the one mismatch a
declaration cannot catch. Pass `--no-env-pull` every time, and read the host
each script prints before it acts.

## Deploying to staging

Commit, push `staging`, then confirm a deployment exists **for that exact
SHA**, wait for `Ready`, and verify the changed flow signed in. See
`house/deployment.md` for the full sequence and the traps.

## Promoting to pilot

Pilot moves deliberately and only ever forwards, to a commit that is **already
on `staging`** and has been verified there. A commit that exists only on
`pilot` is a commit nobody can reproduce, and the next fast-forward silently
refuses.

Run these in order. Nothing here is automatic.

1. **Back up the pilot database.**
   `node --env-file=.env.pilot db/backup.mjs --yes-pilot`
   Read the `Target: DATABASE_ENVIRONMENT=pilot (<host>)` line it prints before
   it acts. The declaration is not a probe — the host is what you check.
2. **Apply any pending migrations to pilot, BEFORE the code that needs them.**
   `node --env-file=.env.pilot db/run-migrations.mjs --yes-pilot`
   It prints one line per file — `Applying …` or `Skipping … (already
   applied)` — and a total. **Read that total.** `Applied 0 migration(s); N
   already present` with `N` equal to the number of files in `db/migrations/`
   is what "nothing pending" looks like; anything else means the commit you are
   about to promote needs a schema pilot does not have. A schema release is two
   operations and this is the first one.
3. **Fast-forward the branch.** `git push origin <sha>:pilot`, where `<sha>` is
   a commit already on `staging`. Never `--force`, and never a commit that is
   not on `staging` — if the push is rejected as non-fast-forward, stop and
   find out why rather than forcing it.
4. **Confirm a deployment exists for THAT exact SHA.** Search all of the
   `spec-builder-pilot` project's deployments for the SHA. A push may not
   trigger one, and "Redeploy" can rebuild the previous commit.
5. **Wait for `Ready`.** Space any polling by at least 15 seconds.
6. **Check `/api/auth/me` on the pilot URL.** It must report
   `appEnv: "pilot"` and `databaseEnvironment: "pilot"`. If the app refuses to
   start instead, the two variables disagree and `src/lib/env.ts` is saying so
   — that is the guard working, not an outage to route around.
7. **Check the chip reads `PILOT` and the tab title ends `[PILOT]`.** Both come
   from one function, so one of them saying `STAGING` means the deployment did
   not pick up `APP_ENV`.
8. **Walk the first-session script** (`docs/plans/make-it-work-2026-09-19.md`
   §7.4) signed in on pilot. A promotion is not done until a person has done
   this.

If step 2 was skipped and step 8 finds a broken screen, the app is ahead of its
schema. Apply the migration and redeploy; do not roll the code back first, or
the ledger and the code disagree in the other direction.

## Creating the pilot environment

Once, by Max, at the consoles. Nothing in the repo can do any of it.

**Neon.** A NEW project, not a branch of `SpecBuilder`. A branch shares the
parent's history and a restore into it is a trap — and pilot is the one
database that must be recoverable independently of the sandbox. Region London
(`aws-eu-west-2`), to match the rest of the stack: this app handles NDA-covered
client specification material. Take both connection strings: the app's
serverless driver wants the POOLED one, and the `db/*.mjs` scripts want the
DIRECT one, exactly as `.env.example` explains for sandbox.

Created 2026-09-19: project **`SpecBuilder Pilot`**, id `sweet-tree-21270018`,
region `aws-eu-west-2`.

**Its default branch is NAMED `production`, and that is Neon's word, not
ours.** Neon names a new project's first branch `production` and offers no way
to decline it. That branch is the PILOT database: `APP_ENV=pilot`,
`DATABASE_ENVIRONMENT=pilot`, and this app's production environment still does
not exist. Read the branch name as a label Neon printed, the way the sandbox
project's parent branch is called `root` and nothing connects to it. Anyone who
reads it as the environment will believe they are looking at production data
and act accordingly — which is the whole reason `DATABASE_ENVIRONMENT` is a
declaration a human sets rather than something inferred from the connection.

**Do not use the Neon CLI in this repository without `--no-env-pull`.** Hit for
real on 2026-09-19: `neon link` and `neon deploy` REWRITE `DATABASE_URL` in
`.env.local` by default, silently, so the sandbox file spent six minutes
pointing at the newly created and entirely empty pilot project. Nothing warns
you and nothing in the app can catch it — `DATABASE_ENVIRONMENT` still read
`sandbox`, which is exactly the mismatch a declaration cannot detect and only
the printed host can. Pass `--no-env-pull` on every invocation, and read the
`Target: DATABASE_ENVIRONMENT=… (<host>)` line the scripts print. **No script
in this repository calls the Neon CLI, and none should** — a script that
rewrites the operator's `.env.local` as a side effect is the same accident with
nobody typing it.

**Vercel.** A new project, `spec-builder-pilot`, from this same repository.

- **Production Branch: `pilot`.** This is the trick `environments.md` already
  documents for staging — it is what makes a push to `pilot` claim a stable
  alias and receive the project's environment variables. Vercel's "production
  deployment" is a deployment class, not our environment; the variables it
  receives declare `APP_ENV=pilot`. Leaving this as `main` sends every push
  down the Preview path: a fresh hostname each time so session cookies do not
  carry, no project environment variables so the app throws on a missing
  `APP_ENV`, and Vercel Authentication in front of the URL, which reads as the
  app's own sign-in being broken.
- **Region `lhr1`.** `vercel.json` pins the functions, but set the project's
  own default too.
- **Environment variables**: every row of the table above, in the Pilot column.
  `AUTH_SECRET` and `CRON_SECRET` are NEW values, generated for this project —
  not copied from staging. `ANTHROPIC_API_KEY` may be the same key.
  `GRAPH_*` stays unset.

**Blob.** A new store, PRIVATE, connected to the new Vercel project — which is
what injects `BLOB_READ_WRITE_TOKEN`. Set `BLOB_STORE_ID` to the new store's
id: registration checks an uploaded blob belongs to THIS store before fetching
it, so a stale id from staging refuses every upload.

**The queue.** Nothing extra to do, and this is worth stating because a queue
topic has no consumer until the deploy declaring it lands. The
`document-extraction` topic and its consumer are declared in `vercel.json`,
which is in the repository, so the first pilot deployment declares them for the
pilot project the same way staging's does for staging. The consequence to watch
for: documents registered before that first deployment is `Ready` sit
undelivered.

**First run**, once the project deploys and `/api/auth/me` answers:

1. `node --env-file=.env.pilot db/run-migrations.mjs --yes-pilot`
2. `node --env-file=.env.pilot db/run-seed.mjs --yes-pilot`
3. `node --env-file=.env.pilot tools/create-user.mjs --yes-pilot` — there is no
   self-signup, so Matthew's account is created here.

Three things to say plainly, because each has a tempting wrong version:

- **Do not call it production.** No production authorization applies to it and
  none is granted by it. `house/deployment.md` governs production and pilot is
  not production.
- **There is no `main` branch.** `pilot` and `staging` are the only deploy
  targets this repository has.
- **Pilot data is never copied from the sandbox.** Seeds only, then whatever
  Matthew loads. The sandbox holds invented demo projects, `__QA` leftovers and
  real client documents staged for testing; none of it is his. The `qa:*`
  scripts and `db:qa-clean` refuse anything but sandbox for the same reason.

## Deploying to production

Requires explicit authorization for that specific action, every time.

## Where environment variables live

| Variable | Local | Staging | Pilot | Production |
|---|---|---|---|---|
| `APP_ENV` | `.env.local` | Vercel project (`staging`) | Vercel project (`pilot`) | Vercel project |
| `DATABASE_ENVIRONMENT` | `.env.local` | Vercel project (`sandbox`) | Vercel project (`pilot`) | Vercel project |
| `DATABASE_URL` | `.env.local` | Vercel project | Vercel project — its own Neon project | Vercel project |
| `AUTH_SECRET` | `.env.local` | Vercel project | Vercel project — **a NEW value** | Vercel project |
| `ANTHROPIC_API_KEY` | `.env.local` | Vercel project | Vercel project — may be the same key | Vercel project |
| `BLOB_READ_WRITE_TOKEN` | `.env.local` | auto-injected | auto-injected by its OWN store | auto-injected |
| `BLOB_STORE_ID` | `.env.local` | Vercel project | Vercel project — its own store's id | Vercel project |
| `APP_BASE_URL` | `.env.local` | Vercel project | Vercel project — the pilot URL | Vercel project |
| `EMAIL_MODE` | `.env.local` | `disabled` | `disabled` | `disabled` |
| `MAIL_INGESTION_MODE` | `.env.local` | `disabled` | `disabled` | `disabled` |
| `CRON_SECRET` | `.env.local` | Vercel project | Vercel project — **a NEW value** | Vercel project |
| `GRAPH_*` (M5) | `.env.local` | Vercel project | unset (ingestion disabled) | Vercel project |
| `CAPSULE_API_TOKEN` | `.env.local` | Vercel project | optional; absent means the Capsule search answers 503 and the manual contact form still works | Vercel project |

**The two secrets that must be NEW rather than copied** are `AUTH_SECRET` and
`CRON_SECRET`. A shared `AUTH_SECRET` makes a staging session cookie valid on
pilot, which is the one thing separate environments exist to prevent; a shared
`CRON_SECRET` lets one deployment's queue and cron callers reach the other's
routes. `BLOB_READ_WRITE_TOKEN` and `BLOB_STORE_ID` belong to the store and
cannot be shared even by accident. `ANTHROPIC_API_KEY` legitimately can be the
same key — it is a billing credential, not an identity.

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
4. Back up pilot, apply it there with `--yes-pilot`, then promote — step 2 of
   *Promoting to pilot*, and it comes BEFORE the fast-forward.
5. With authorization: back up production, apply, deploy, verify.

Additive migrations go before the code that uses them. Destructive ones go
after the code that stopped using the column.

## Refreshing the sandbox

There is nothing to refresh from yet: production does not exist. When it does,
a refresh is `db/backup.mjs` against production followed by `db/restore.mjs`
into a fresh sandbox branch — never a live connection between the two.

Deliberately not copied, when that day comes: `users` (staging accounts stay
staging accounts, and password hashes should not travel), and the blob store.

Never copy sandbox data into production, or into pilot. Pilot gets seeds and
then whatever Matthew loads — the sandbox holds invented demo projects and
`__QA` leftovers, and a project he did not create is one he will report as a
defect.

## KNOWN GAPS

**Observed 2026-09-12, at scaffold time. None of these are solved problems.**

1. **Staging and local share one database.** Both point at the Neon `sandbox`
   branch, so a local `db:migrate` or a careless delete changes what staging
   shows. Acceptable while nobody else is using staging; not acceptable once
   somebody is testing against it. **Partly addressed 2026-09-19**: the person
   this was written about is Matthew, and he works on PILOT, which has its own
   Neon project and its own `--yes-pilot` flag on every script that writes. The
   gap itself is unchanged — staging and local still share sandbox, and they
   always will until somebody separates them.
2. **No blob store exists.** M1's BOQ upload needs one. Uploads will fail with
   a missing-token error until it is created and connected.
3. **Production is undefined beyond "a separate Neon project".** No Vercel
   project, no domain, no branch, no authorization to create any of them.
4. **Backups are manual.** Nothing runs `db/backup.mjs` on a schedule, so the
   real recovery point is "whenever someone last remembered".
