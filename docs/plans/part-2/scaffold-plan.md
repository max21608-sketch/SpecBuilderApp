# Part 2 — Scaffold the Project Spec Builder: execution plan

> **Temporary home.** Same status as `apps/spec-builder-brief.md`: this is
> app-specific content parked in the app-agnostic kit because the
> `SpecBuilderApp` repo has no content yet. When stage F lands, this file's
> content moves into `SpecBuilderApp/docs/plans/README.md` and this copy is
> deleted.
>
> Written 2026-09-12 against `apps/spec-builder-brief.md` ("Part 2 — Scaffold
> the Project Spec Builder") and `skills/start-new-app/SKILL.md`.
>
> **Executed 2026-09-12. Stages A–D are done and verified locally; stage E is
> blocked on two Vercel settings only the account owner can make.** What each
> stage actually produced is recorded at the end of this file.

Target: `~/Library/Mobile Documents/com~apple~CloudDocs/Documents/SpecBuilderApp`,
remote `git@github.com:max21608-sketch/SpecBuilderApp.git`
(`https://github.com/max21608-sketch/SpecBuilderApp.git`).

**Repo confirmed 2026-09-12.** It exists and is completely empty —
`git ls-remote` returns no refs over either HTTPS or SSH, and both authenticate
without a prompt. So there is no first commit to reconcile with and stage A's
"commit 1 is `.gitignore`" holds literally.

### The names, which are deliberately not all the same

The brief assumed one name throughout. Reality has four, so they are recorded
here to stop a future reader "fixing" one to match another:

| Thing | Name | Why |
|---|---|---|
| GitHub repo + local directory | `SpecBuilderApp` | Chosen 2026-09-12. Owner is the personal account `max21608-sketch`, **not** the `benwhistler` org. |
| Neon project | `SpecBuilder` | Already created, `dark-pond-59463734`, `aws-eu-west-2` |
| App slug (npm name, URL paths, Vercel project) | `spec-builder` | Lowercase-kebab is required here and mixed case is not valid |
| Session cookie | `sb_session` | Must differ from autofab's `fo_session` |

An earlier draft of this plan named `benwhistler/SpecBuilder`. That repo also
exists and is empty; it is **not** the target. Superseded 2026-09-12.

### Decision 2026-09-12 — one Neon project per environment, not one project with two branches

The brief assumed the autofab shape: one Neon project with a `sandbox` branch
alongside `production`. **Decided instead:** production gets a *completely
separate* Neon project, created later. `SpecBuilder`
(`dark-pond-59463734`) is the non-production database and nothing else will
ever live in it.

This is stronger isolation than branching, not weaker — a separate project
means separate credentials, and no console click can promote or reset across
the boundary. It costs the ability to branch production data into a sandbox for
debugging, which is a real loss when a production-only data shape is the thing
being investigated; the replacement is a restore from `db/backup.mjs` output.

**The one thing this leaves misaligned:** that project's only branch is still
*named* `production`, while the app will declare `DATABASE_ENVIRONMENT=sandbox`
against it. `script-env.mjs` prints the resolved host so a human can catch a
mismatch — but a Neon endpoint hostname does not contain the branch name, so
the print would show nothing wrong while the Neon console said "production".
That is exactly the declaration-versus-reality gap the guard cannot close by
itself.

**Resolved 2026-09-12 by adding a branch rather than renaming one.** The
project now holds two: `sandbox` (`br-old-mountain-zazagxh3`, endpoint
`ep-tiny-shadow-zaelukm4`) which the app uses, and the original default
`production` (`br-rapid-dawn-za6wfjt9`, endpoint `ep-muddy-shape-zaqo9p5y`)
— renamed to `root` the same day, see below — which is `sandbox`'s parent and
is otherwise unused.

**That leftover branch was a live trap — closed 2026-09-12 by renaming it
`root`.** It had been named `production` inside a project that the decision above
says is *not* production. So `DATABASE_ENVIRONMENT=production` plus
`--yes-production` — the two deliberate acts the guards demand before anything
touches production — would have succeeded against it and touched the wrong
database entirely, with every safety mechanism reporting exactly what it was
designed to report. No guard can catch that; only the name can, which is why
the fix was a rename rather than a new check. `root` is not a value
`DATABASE_ENVIRONMENT` accepts, so the mistake now has nothing to land on.
Delete the branch once `sandbox` no longer needs a parent.

Its credentials are also the ones pasted into a chat transcript on 2026-09-12
and should be rotated regardless of what the branch ends up called.

When the production project is created later, its branch keeps the name
`production`, and `DATABASE_ENVIRONMENT=production` plus `--yes-production`
guard it as designed.

**Ownership, noted not decided.** Both the GitHub repo (`max21608-sketch`) and
the Neon org (`max21608@gmail.com`, which also holds
`fabric-ordering-production`) are personal accounts, while the data is
NDA-covered client material under a Ben Whistler contract. That is a governance
question for the user, not a build choice, and nothing here depends on the
answer. Recorded so it is not mistaken for a decision already taken.

**Scope of this plan: stages A–F only** — a signed-in, deployed, empty app on
staging, with the brief's decisions and open questions written down. M1 (the
spec table and completion view) is scoped at the end as the next plan, not
built here. Production is not created and not authorized.

---

## What blocks on you, and when

Everything below runs unattended except these. They are ordered by when they
are first needed, so they can be done in one sitting before stage D:

| # | Needed at | What | Why it can't be scripted |
|---|---|---|---|
| ~~1~~ | ~~Stage A~~ | ~~Empty GitHub repo~~ — **done**, `max21608-sketch/SpecBuilderApp` exists and is empty | — |
| ~~2~~ | ~~Stage D~~ | ~~Neon project~~ — **done**, `SpecBuilder` / `dark-pond-59463734` / `aws-eu-west-2` (London), connection string received | — |
| ~~2b~~ | ~~Stage D~~ | ~~Rename the branch~~ — **moot**, a `sandbox` branch was created instead, `br-old-mountain-zazagxh3`, endpoint `ep-tiny-shadow-zaelukm4` | — |
| 3 | **End of stage A**, not stage D | Vercel project — **created**, `spec-builder-app` / `prj_kXiNJcm1Gvqc1mszncuFOP7hWWTQ`, Git connected to `max21608-sketch/SpecBuilderApp`. **Still to do: Production Branch is `main` and must be `staging`** (Settings → Git → Production Branch) | Account settings; mine to ask for, not to change. **Vercel does not offer the branch in that dropdown until the branch exists on the remote**, so this cannot be done before the first push |
| 3b | **M1, not Part 2** | Blob store + `BLOB_READ_WRITE_TOKEN` — not created yet, project has zero env vars | Account access |
| ~~4~~ | ~~Stage E~~ | ~~Staging hostname~~ — **given**, `spec-builder-app-rho.vercel.app` (Vercel's auto-assigned production alias; 404s today, no deployment yet) | — |

I generate `AUTH_SECRET`, write `.env.example`, and hand you the exact list of
variables to paste into Vercel — I do not set them.

Trap this ordering prevents: on autofab the `staging` branch turned out not to
feed the staging URL, so pushes produced Preview deployments on a different
hostname and session cookies did not carry. It was found late, after features
depended on it. Item 3 is the fix, and stage E is where it gets proven.

---

## Stage A — Repo, ignore rules, chassis

1. `mkdir SpecBuilderApp && git init -b staging`,
   `git remote add origin git@github.com:max21608-sketch/SpecBuilderApp.git`.
   **The initial branch is `staging`, not `main`** — this repo never has a
   `main` branch, and the chain below depends on that. **First commit is `.gitignore`, before any
   file is copied in.** Add the real-data patterns from the brief on top of the
   chassis ignore file: `*Job Spec Fields*.csv`, `*BOQ*.xlsx*`, `/Reference/`,
   `*.eml`, `/backups/`. NDA material in git history is forever and a private
   repo does not change that.
2. `cp -R chassis/. .`, `mv package.json.template package.json`, `cp -R house .`.
3. `npm install`. Commit the lockfile.

4. **Push `staging` early, at the end of stage A rather than at stage E.**
   Vercel will not list a branch in the Production Branch dropdown until that
   branch exists on the remote, so the setting cannot be changed before the
   first push. Pushing here is what unblocks it.

   That first push produces a Preview deployment with no environment variables,
   which will fail its build or boot. **That failure is expected and means
   nothing** — it is the empty chassis with no `APP_ENV`, not a broken app. Do
   not debug it.

5. **Checkpoint — hand back to the user.** Settings → Git → Production Branch →
   `staging`. Everything from stage E onward is meaningless until this is done,
   for the four reasons in the Vercel findings section. Stages B, C and D can
   proceed in the meantime; they touch neither Vercel nor the alias.

**Done when:** `git log` shows the ignore rules as commit 1, the branch is
`staging`, the remote has it, and `git status --ignored` lists nothing
real-client-shaped as tracked.

## Stage B — Placeholders

`grep -rn "CUSTOMIZE" --exclude-dir=node_modules .` and clear every hit.

- `CUSTOMIZE_APP_NAME` → `Project Spec Builder`, slug `spec-builder`.
- **`SESSION_COOKIE` → `sb_session`**, and it must differ from autofab's
  `fo_session`. Two apps on a shared parent domain otherwise read and write the
  same cookie and whichever signed in last wins in both.
- `WRITER_ROLES` in `src/middleware.ts` and the `users_role_check` constraint
  in `db/migrations/0001_foundation.sql` must agree. Allowlist, never a
  denylist — a denylist failed open on `"Viewer"`.
- `NAV` in `NavShell.tsx`: leave a single placeholder entry until M1 has a
  screen. An empty nav is honest; a nav full of dead links is not.
- Backup path defaults **outside iCloud** (autofab's dumps land inside the
  synced working directory).

**Done when:** the grep returns nothing outside `house/` and `templates/`-derived
prose that is deliberately generic.

## Stage C — Docs, skills, harness

1. Fill `templates/` into `CLAUDE.md`, `docs/{stack,environments,recovery,integration}.md`,
   `docs/plans/README.md`, `db/README.md`, `.env.example`, `README.md`.
   Copy `CLAUDE.md` → `AGENTS.md`; finish with `cmp -s CLAUDE.md AGENTS.md`.
   Do not restate `house/` content — point at it.
2. Into `CLAUDE.md` go, from the brief: the data-model table (`projects`,
   `spec_records`, `spec_record_splits`, `bws_job_links`, `project_materials`,
   `spec_fields`, `spec_values`, `item_categories`, `category_required_fields`,
   `gate_status`), the hard invariants, and the load-bearing workflows scaffold.
   The invariants are worth restating verbatim because each is a trap:
   - **BWS is read/download only, forever.** Nothing writes to BWS.
   - **The BWS import is a replacement, not a merge** — the export route emits
     the complete dataset for the quote/job set, never a delta. A partial export
     silently wipes fields. Enforced in the route, stated in a test.
   - **`TBC` is a distinct state** from missing and from N/A; gate rules read
     the state, not the presence of a string.
   - **VE rounds preserve the original**; reuse autofab's revisions model.
   - **Suppliers by modelled Capsule ID**, not free-text name.
   - `project_materials` is **project-scoped**, unlike autofab's global
     registers — the same client material code means different things across
     projects.
3. Into `docs/plans/README.md` go the seven open questions from the brief —
   dated, as observations, each naming who it waits on: gate model (TG0/1/2 vs
   Matthew's proposed TGQ — so **model gates as data, not an enum in code**),
   cheat-sheet ownership, `spec_fields` sync cadence, stale P17231 TOE dates,
   the missing finishes schedule, BWS access, and Anthropic zero-data-retention.
4. `cp -R <kit>/skills .claude/skills` and `.agents/skills`; keep them
   identical. Add `.codex/config.toml` and `.claude/launch.json`.
5. Run Claude Code here with autofab added read-only via `/add-dir`, so full
   implementations are readable when a chassis stub isn't enough.

**Done when:** `cmp -s CLAUDE.md AGENTS.md` passes, the two skills trees are
identical, and no `[CUSTOMIZE:` marker survives.

## Stage D — Database and local sign-in

Needs blockers 2 and 3 above.

1. Write `.env.local` (`DATABASE_ENVIRONMENT=sandbox` declared, never probed;
   `APP_ENV=development`). Use the **direct** Neon host for the `db/*.mjs`
   scripts — the `-pooler` endpoint is for the app's runtime queries, while
   `run-migrations.mjs` needs a real session for `begin`/`commit` and `DO`.
2. `npm run db:migrate` — applies `0001_foundation.sql` to the sandbox.
   **Run it twice**; the second run must apply nothing. That proves the
   `schema_migrations` ledger, which is the thing the kit's `verify` skill used
   to get wrong.
3. `npm run create-user` for yourself and one `viewer` account (the viewer is
   needed for the 403 check in stage E).
4. Confirm `db/restore.mjs` refuses a non-empty schema.
5. Confirm the db-tier tests **actually run** with `DATABASE_URL` set — they
   silently skip without it, which is exactly how an untested invariant hides.

**Done when:** `npm run lint && npm run typecheck && npm test && npm run build`
all pass, and you can sign in at `localhost`.

### Blob is not needed until M1

`@vercel/blob` is a dependency and `src/app/api/uploads/token/route.ts` exists,
but `handleUpload` reads `BLOB_READ_WRITE_TOKEN` **when it is called**, not at
module load. Nothing in stages A–E uploads anything, so the app boots, signs in
and deploys without the variable; the only thing that fails without it is
`POST /api/uploads/token`, which no screen calls yet. It becomes required at
M1, where the BOQ import is an upload.

When the store is created, the token is **not pasted by hand** — connecting a
Blob store to the project injects `BLOB_READ_WRITE_TOKEN` into the project's
environment automatically. Locally, pull it into a scratch file and copy the one
line into `.env.local`; `vercel env pull` writes a whole file and would
overwrite the hand-written `APP_ENV` / `DATABASE_ENVIRONMENT` declarations.

Two things to decide at creation, both easier then than later: pin the store's
region to London to match the database, and settle retention. The kit inherited
a real gap here — `del` from `@vercel/blob` is called nowhere and uploads use
`addRandomSuffix`, so NDA-covered source documents accumulate indefinitely and
sit in no backup.

### Two Vercel findings, 2026-09-12

**Production Branch is `main`.** Read from the project API at creation time.
This is the autofab failure verbatim, and it is worth stating mechanically
because the name makes it look like the wrong fix.

Vercel decides what a deployment *is* by one comparison: pushed branch equals
Production Branch, or not. Equal means a Production deployment, which gets the
stable aliases (`spec-builder-app-rho.vercel.app`). Not equal means a Preview
deployment on a freshly generated hostname. Four consequences follow, and each
one looks like a different bug:

1. **Environment variables are scoped by that same classification.** Variables
   added to the Production environment simply are not present in a Preview
   build. `src/lib/env.ts` throws when `APP_ENV` is unset, so the app fails at
   runtime with an env error while the dashboard reports a successful build.
2. **The session cookie is scoped to the hostname that set it.** Every push
   generates a new preview hostname, so every deploy signs you out, and any
   cookie set on the alias is invisible to the preview. This was autofab's
   symptom.
3. **Preview deployments sit behind Vercel Authentication by default**, so the
   URL asks for a Vercel login before the app is ever reached — easily misread
   as the app's own sign-in being broken.
4. **`spec-builder-app-rho.vercel.app` would 404 forever.** The repo has no
   `main` branch and will not have one, so with Production Branch left at `main`
   no Production deployment is ever produced and nothing claims that alias.

**The confusing part, stated so nobody "corrects" it later:** Vercel's
"Production deployment" is a deployment *class*, not our environment. Setting
Production Branch to `staging` does not create a production environment. The
`staging` branch becomes the branch that gets the stable alias and the
project's environment variables, and those variables declare
`APP_ENV=staging` and `DATABASE_ENVIRONMENT=sandbox`. Our production is a
different Vercel project with a different database, and does not exist yet.

Stage E exists to catch this; setting it correctly first means stage E confirms
rather than discovers.

**Functions are pinned to `iad1` (Washington DC) while the database is in London
(`aws-eu-west-2`).** Two separate costs. Latency: every query crosses the
Atlantic at roughly 75–90 ms round trip, and the review screens issue several
sequential queries, so this is felt rather than measured. Residency: NDA client
data would be processed in the US, which sits oddly next to the deliberate UK
region pin on the database.

The fix belongs in `vercel.json`, not the dashboard — a committed declaration
survives a project being recreated, and a dashboard setting does not:

```json
{ "regions": ["lhr1"] }
```

**This is a kit-level gap, not an app-level one.** `chassis/vercel.json` carries
`functions` and `experimentalTriggers` but declares no region at all, so every
app forked from the kit inherits whatever region the dashboard defaulted to.
Port `regions` into `chassis/vercel.json` with a dated `CHANGELOG.md` line —
fixes do not propagate across a fork point on their own.

## Stage E — Staging, and proving the deploy path

1. Push `staging`. Confirm in Vercel that the deployment is a **Production**
   deployment of the `staging` branch on `spec-builder-app-rho.vercel.app` —
   not a Preview on a generated hostname. That alias always serves whatever the
   Production Branch setting points at, which is why that setting, not the URL,
   is the thing to get right.
2. Confirm the deployment's source SHA equals the pushed commit. A new hosting
   project can deploy an old tip, and "redeploy" may rebuild the old commit.
3. Browser checks, via the `verify` skill: sign in on staging; the environment
   banner and the `[STAGING]` title render; a signed-out request to a protected
   route redirects; a write as `viewer` is 403'd by middleware (server-side —
   not hidden in the UI).
4. `/api/auth/me` on staging reports the **sandbox** database, not another one.
5. Report state in the six-term vocabulary from `house/deployment.md`
   (changed locally / committed locally / pushed / deploying / deployed /
   verified in the app). "Deployed" is not "verified in the app".

**Done when:** every check above is a yes, each named individually. Any "should
be fine" here is the autofab failure repeating.

## Stage F — Close out Part 2

1. Move this file and the brief's content into `SpecBuilderApp/CLAUDE.md` and
   `SpecBuilderApp/docs/plans/README.md`; delete `apps/` from the kit and note it
   in `CHANGELOG.md`.
2. If anything in the chassis had to be fixed to make stages A–E pass, port the
   fix back to the kit and add a dated `CHANGELOG.md` line — fixes do not
   propagate on their own across a fork point.
3. Open M1 as its own plan document.

---

## M1, scoped but not built here

**M1 — the spec table and completion view.** The thing that exists nowhere today.

- Seed `spec_fields` with the **56 BWS spec fields**, columns AF–CI of
  `BWS Job Spec Fields.csv` (`Routing`/34 … `Purchasing Notes`/24). Columns
  CJ–DE are 22 website/style fields and are **excluded**; A–AE are job metadata.
  The schema — column letters, JSON IDs, field names — is what gets committed.
  **No row of that 60,714-row export enters the repo, a fixture, or a seed.**
- Seed `category_required_fields` for the **Upholstery** categories from
  `AP346-P17231-project-context.md`. Create the Cabinetry categories with an
  **empty** requirement set, so they read as *not yet defined* rather than
  silently complete.
- The requirement matrix is **seed data, not code** — when SharePoint opens, the
  real cheat sheets replace it with a migration and a re-seed, touching no
  application logic. Build it that way deliberately.
- Import a BOQ XLSX via `intake-source.ts` (no AI needed) into `spec_records`
  keyed by client ref, using the 12 P17231 furniture lines as the fixture.
- Edit spec values under optimistic locking; show completion and gate status per
  record: green complete / amber TBC / red missing-or-overdue.

Before M1 starts, try SharePoint via the signed-in browser (cheat sheets, the
P17231 BOQ, the fabrics/trim schedule, the TOE folder). If those open, M1 is
seeded from the real cheat sheets instead of a context-doc summary — that
removes M1's main caveat. Read-only, always: reading and downloading to read is
fine, anything that changes state in a company system is not.

M2–M6 stay named and unbuilt: AI extraction of richer documents; BWS CSV export;
draft chase emails; shared-inbox ingestion; VE rounds and TG0 sign-off.
Excluded entirely for now: any write to BWS, automatic sending, SharePoint
writes, Teams/BWS Messenger ingestion, the TOE calculator's logic, Tony's
knowledge base, the post-order flow.

---

## Noted while checking the remote, not part of Part 2

`bw-app-kit` itself has **no git remote configured** — `git remote -v` is empty,
though the brief names `git@github.com:benwhistler/bw-app-kit.git`. Part 1 is
committed locally only, so the kit currently exists on one machine inside an
iCloud-synced folder. Worth pushing before Part 2 forks from it, but it is your
call and not a blocker.

---

## What actually happened, 2026-09-12

### Stages A–D: done

- **A.** `SpecBuilderApp` on branch `staging`; `.gitignore` is commit 1; chassis
  and `house/` copied; `npm install`; pushed to
  `max21608-sketch/SpecBuilderApp`.
- **B.** Every `CUSTOMIZE` slot resolved — app name, slug `spec-builder`,
  `SESSION_COOKIE=sb_session`. Comment-only markers were either resolved or
  re-labelled `M2:` so the grep gate stays meaningful. `grep -rn CUSTOMIZE`
  outside `house/` returns nothing.
- **C.** `CLAUDE.md` / `AGENTS.md` (`cmp -s` passes), `README.md`,
  `.env.example`, `db/README.md`, `docs/{stack,environments,recovery,integration}.md`,
  `docs/plans/README.md`. Eight skills in `.claude/skills/` mirrored to
  `.agents/skills/`; `start-new-app` deliberately not carried into an app.
  `.codex/config.toml` and `.claude/launch.json` added.
- **D.** `0001_foundation.sql` applied to the Neon `sandbox` branch; **re-run
  applied nothing**, proving the ledger. `db/restore.mjs` refused a non-empty
  schema. An admin and a viewer account created. **The db-tier tests run rather
  than skip with `DATABASE_URL` set: 48 passed, 0 skipped** (42 and 6 skipped
  without it).

Local verification against a real dev server, signed in:

| Check | Result |
|---|---|
| Title | `Ben Whistler — Project Spec Builder [STAGING]` |
| Signed-out `/dashboard` | 307 → `/login?from=%2Fdashboard` |
| Signed-out API | 401 `auth required` |
| `/api/auth/me` | `appEnv: development`, `databaseEnvironment: sandbox` |
| Dashboard signed in | 200, names the user and the database, sandbox banner shows |
| Write as `viewer` | 403 `This is a view-only account` |
| Cookie | `sb_session` |
| `npm run lint / typecheck / test / build` | all pass |

### Stage E: blocked, and on what

Two Vercel changes only the account owner can make:

1. **Settings → Git → Production Branch → `staging`.** Not possible before the
   first push, which is why stage A ends with one.
2. **The eight environment variables**, prepared in `.env.vercel-staging`
   (gitignored) in the app repo.

Until both land, a push to `staging` is a Preview deployment and stage E's
checks cannot mean anything.

### Two traps caught during execution, worth keeping

- **Port 3457 was already serving a different app** (the kit's own "Kit Probe"
  from Part 1's verification). The dev server failed to bind and `curl` still
  answered 200 — from the wrong app. Check the page title, not the status code.
- **`cp -R chassis/.` silently reverted the first commit's `.gitignore`
  additions**, because the chassis ships its own. A file of real staging
  secrets sat untracked-but-committable until `git check-ignore` caught it.
  Fixed in the app and in `skills/start-new-app`.

### Ported back to the kit

`chassis/vercel.json` region pin, `chassis/src/app/dashboard/`, and the
`start-new-app` ordering fix — all in `CHANGELOG.md` dated 2026-09-12.

### Stage E attempted 2026-09-13: the build is fixed, the deploy path is not

**The chassis had never actually been deployed.** Every push errored in
Vercel's `vercel.json` schema validation, before any application code ran —
`maxAttempts` is not a trigger key (it is `maxDeliveries`), and `queue/v2beta`
does not accept a `consumer` (that is `queue/v1beta`). `lint`, `typecheck`,
`test` and `build` all pass with an invalid `vercel.json`, so nothing short of
a deployment could have caught it. Fixed here and in the kit.

`4ff019f` then built and reached **READY**, in `lhr1` — the region pin works.

**Stage E's checks still cannot be run**, and the reason is the one this plan
predicted. With Production Branch still `main`, the push produced a *Preview*:

| Evidence | Reading |
|---|---|
| deployment `target: null`, alias `spec-builder-app-git-staging-…` | Preview, not Production |
| `spec-builder-app-rho.vercel.app/login` → 404 | nothing has ever claimed the alias |
| `…-git-staging-….vercel.app/login` → 302 "Redirecting…" | Vercel Authentication in front of the app |
| project env vars: `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY` only | a Blob store was connected; the eight app variables are not set |

So all four predicted consequences are now observed rather than argued. Stage E
resumes the moment Production Branch is `staging` and the variables from
`.env.vercel-staging` exist.
