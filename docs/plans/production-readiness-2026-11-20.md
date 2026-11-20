# Production readiness, 2026-11-20: what was tested, what is wrong, and the plan to launch

Asked for by Max on 2026-11-20: "get this app production ready in a few days …
come up with a very detailed plan, having tested, having gone through the app …
take screenshots … sanity checking everything … you need to replace me."

**Status (2026-11-20, evening): TESTED, FIXES BUILT ON THREE BRANCHES, NOTHING
PUSHED.** Claude cannot push (GitHub is read-only for Claude under the
organisation's policy) and cannot create production (Neon, Vercel and the
Blob store are consoles only Max holds). Everything below that says "Max" is
a step only Max can take. Every branch below is `committed locally` in the
six terms of `house/deployment.md` — nothing has left this machine.

---

## 1. The answer in short

**Not today, and not by flipping a switch. Yes within the week, if four
decisions are made on day one and the three fix branches land.**

The core of the app is sound. Drawings are read accurately (cm read off the
page, overall figures placed, non-overall figures kept as notes, twins
offered), the finishes schedule and the preamble are read word-perfect, the
chase builds the right email, the exports are complete and refuse rather than
hand over a partial file, the error pages say what happened in words, a
view-only account is refused on the server, and every screen loads in under a
second on the production build with 79 records.

What stops a wider launch is concentrated in four places, all found today by
doing the work as a new user would:

1. **A bill in a layout the app has not seen** (the normal case for a new
   client) turns its section headings and finish lines into records, places no
   size, files a metal frame as timber and writes one finish into two BWS
   fields. Fixed on `prod-bill` (§4).
2. **A revised bill** duplicates every phase if Confirm is pressed with the
   default left alone, and wipes a designer a person set. One fixed on
   `prod-bill`; the other on `prod-flows` (§4).
3. **An email** cannot be confirmed whenever it says one thing about an item
   the app cannot place (the server refuses for ever and tells the user to
   reload), and a bill without price columns is filed as an FF&E schedule and
   read at a charge with no records made. On `prod-flows` (§4).
4. **Production itself does not exist**, and four decisions decide how it is
   built: who sees which client's material, whether the BWS file is imported
   into BWS at launch, whose accounts hold the data, and how it is backed up
   (§5).

Nothing found today corrupts confirmed data silently except the designer wipe
(fixed) and the duplicate finish (fixed); everything else is either visible on
the review screen before Confirm or refused by the server.

---

## 2. How it was tested

Everything ran on the LOCAL STACK (Postgres 18, the fake Blob store, reads
in-process), because the sandbox and pilot are company data and read-only for
Claude. The worktree was `~/dev/worktrees/prod-ready` at `ebbd762` (= staging,
= pilot v1.15 plus documentation). Screenshots and scripts are outside the
repo: `~/dev/localstack/shots/prod-ready/` and `~/dev/localstack/pw/prod-*.mjs`.
The running log of every finding is `~/dev/briefs/prod-ready/findings.md`.

| What | How |
|---|---|
| The four checks, database tier required | `checks-shared.mjs` at the start: 409 files, **5,120 tests passed**, lint, typecheck and build green |
| A new client, end to end, through the screens | Project `T20111`, an INVENTED pack in a layout the app had never seen (generator `~/dev/localstack/synthetic-hhh/`): a 4-tab bill (cover, two areas, a VE option), two spec sheets (one in cm with the unit printed, one in mm without), a finishes schedule, a preamble and a reply email. Uploaded in one drop, every review screen used, every confirm pressed, levels and categories accepted, fill-in answered, a contact added, a chase drafted, downloaded and recorded as sent, all four outputs downloaded and read cell by cell |
| A revised bill | Rev B of the same bill: one quantity changed, one item dropped, one added, one size changed; paired and confirmed |
| Corrections | Edit value with a reason, retire with a reason, put back, add by hand, history, name a point, compare |
| Scale | A 300-line invented bill (20 section headings); the 79-record Aman test project (32 reads); the 101-line AMB bill |
| Speed | `next build` + `next start` on the local stack, every main screen and export timed cold and warm |
| Roles and errors | A view-only account (screen and direct API), unknown pages, unknown and malformed record ids, a chase with no project, an export with a bad phase id |
| Code and plans | Two read-only reviews: one of everything production changes (security, ops, config); one of every open item in `docs/plans/` |

**Not tested, and why.** Microsoft Graph mail ingestion (disabled everywhere);
Capsule (no token); a real BWS import of the export (Tim's contract, a person's
step); timings against Neon over HTTP from Vercel (needs pilot or production,
which only Max can sign in to); a fresh charged read of a real client pack
(the real packs were read before and are covered by the bill regression
goldens; today's money went on the invented pack and the 300-line file).

---

## 3. What was found

D = data wrong or lost · U = a person misled or stuck · C = cosmetic or friction.
"Branch" says where the fix is built; "open" means not built.

### 3.1 Data

| # | Found | Sev | Fix |
|---|---|---|---|
| B1 | Section headings (`GUEST ROOM TYPE A`, no description, no quantity) stage as items and become records | D | `prod-bill` R2 — suggested "Section heading?", accepted per row or per tab |
| B2 | Finish lines (`FAB-01 / Finish: …`, no quantity, under an item) stage as items | D | `prod-bill` R3 — suggested "Finish for <item>?" |
| B3 | An unlabelled `W520 x D560 x H810mm` line in a description places no size (all 37 items: "no size placed") | D | `prod-bill` R1 |
| B4 | `Frame: MTL-02` is filed into Main timber finish — the part word "frame" beats the client's metal code | D | `prod-bill` R4 (measured against every staged run before it shipped) |
| B5 | One finish code in a description AND on a finish line is written twice (Main metal finish + Metal Finish 2), the second unlinked; the quote then prints "METAL 2: Finish: Brushed brass…" to the client | D | `prod-bill` R6 |
| RV1 | A revision wipes a designer a person set when the bill has no designer column (confirmed in the database: `NPI` → empty) | D | `prod-bill` R7 |
| RV0 | A sheet named like an existing phase defaults to "a new phase"; one press of Confirm duplicates every phase and record | D | `prod-flows` RV0 — "a revision of …?" suggested, Confirm held until decided |
| E4 | An email's Confirm is refused for ever (409 "rows changed… Reload") when the same item has a statement the app cannot place; reload and Re-match do not help | D | `prod-flows` E0 |
| E1 | A code on two LINKED twin lines: a drawing lands on both, an email on neither ("Item not found") | D | `prod-flows` E1 |
| K1 | A bill with no price columns — even named "… Bill of Quantities.xlsx" — is filed by the model as an FF&E schedule and read at a charge: 1,500 proposals, no records, no question asked. The box showed "Bill of quantities" and the press overrode it | D | `prod-flows` K1 — a disagreement between the name and the model holds the file for a person |
| B7 | A decimal quantity (`6.4` lm banquette) is "not given": `spec_records.qty` is an integer | D | **decision** D8 |

### 3.2 A person misled or stuck

| # | Found | Fix |
|---|---|---|
| C1 | A bill with no designer column: every question "Nobody can be asked"; the only fix was the Edit panel, one record at a time | `prod-harden` U2 — "Set designer…" on the phase table's selection |
| C2 | A contact's "Draft a chase" reloaded the same page (the link dropped the contact) | `prod-harden` U1 |
| C3 | Fill-in: Enter did not save; a reload after Enter lost the answer | `prod-harden` U4 |
| P1 | After "Add project" the list stayed with the form open | `prod-harden` U3 — opens the new project |
| P3 | An email uploaded with the pack was listed as "uploaded before deliveries were grouped" | `prod-harden` U5 — listed under "Emails" |
| B6 | The bill review opened on the dropped Cover sheet | `prod-bill` R5 |
| F4 | A code whose words differ from the library is called "not in the library", and the next step says to add it (it exists) | `prod-flows` F4 |
| F1–F3 | Preamble and finishes-schedule reviews: the confirm only at the bottom; a secondary charged action in the primary slot; "Add 0 notes" left after; kinds shown on the schedule not filed, so the library asks again | `prod-flows` F1–F3 |
| I1 | The Inbox scrolls sideways at 1440 (a routing sentence that does not wrap) | `prod-flows` I1 |
| E2 | An email a person uploaded says "auto · nothing names a project" | `prod-flows` E2 |
| V1 | A view-only account sees every write button enabled and is refused at Save | `prod-flows` V1 if it is small; otherwise §7 |
| RV2 | A revised size held back on a carried line with a generic sentence; the screen does not show what changed | open — §7 |
| RV3 | Linked twins are "pair by hand" on a revision even when their areas tell them apart | open — §7 |
| R1 | The record header line argues with its own button ("the button says 3 (differs — see the rows)") | open — §7, Max's direction of 2026-10-15 applies |
| W2 | A second press of a drawing card's Confirm says "targets changed" (safe, misleading) | open — §7 |

### 3.3 Security and operations (from the code review)

| # | Found | Sev | Fix |
|---|---|---|---|
| S2 | With no `AUTH_SECRET`, sign-in returned a bodyless 500 (the 2026-09-19 pilot failure again) | blocker | `prod-harden` H1 — 503 in words; 32-character minimum in production only |
| S5 | No Origin check: a sibling site on the same company domain could post as a signed-in user (SameSite=Lax does not stop it) | should | `prod-harden` H2 |
| S6 | No HSTS header | should | `prod-harden` H3 |
| S8 | No health check, no error alerting: an uptime check on `/login` stays green with the database down | should | `prod-harden` H4 — public `/api/health` (runs `select 1`, names the commit) and one `[request-error]` log line per uncaught error |
| S4 | `create-user` took any password on the command line, had no way to deactivate | should | `prod-harden` H5 |
| S1 | The production chase email had never run; it sent empty `x-intended-*` headers | should | `prod-harden` H6 (test + fix) |
| S3 | `npm audit`: `next` 15.5.25 has advisories fixed in later 15.5.x; `postal-mime` 3.0.0 (every uploaded .eml) has a high advisory; `zod` memory advisory | should | **not built** — §6 day 1, its own worktree with its own `node_modules` |
| B1-sec | No per-project access: every account sees every client's NDA material | blocker | **decision** D1 |
| S7 | Nothing bounds a person's model spend and nothing records it | should | **console** D3 (a spend limit) |
| S9 | Blob store region unverified; Anthropic data residency not written down | should | **decision** D7 |
| S10 | Backups are a plain SQL dump on a laptop; uploaded files are in no backup | blocker | **decision** D4 |
| A5 | Production extraction runs on a beta queue trigger (`queue/v1beta`) | after | **decision**, accept knowingly |

### 3.4 Waiting on Matthew (not defects; listed so nobody fixes them by guessing)

- "Lounge chair" and "End of bed bench" match no category (`item_category_aliases`).
- Swivel is asked of every sofa and bench, because they share a cheat sheet
  with armchairs; project-level questions (TOE agreement, "Expedited project
  confirmed by Jason?") block every item.
- Sofas and armchairs get no BWS boilerplate product code (their cheat sheet
  maps to several of his nine categories).
- Cabinetry has no gate model, so its TGQ counts every question.
- Everything in `CLAUDE.md` "Decisions awaiting somebody" under his name.

---

## 4. The fix branches

All three are cut from `staging` at `ebbd762`, built by Opus coders in their
own worktrees under `~/dev/worktrees/`, each item with a test that fails
without it, and the four checks with the database tier required on the local
stack at the end. None touches a migration.

| Branch | Items | State |
|---|---|---|
| `prod-harden` | H1–H7 (above), U1–U5 | built; four checks green (5,181 tests) before U1–U5; final run in the coder's report |
| `prod-bill` | R1–R7, with a before/after regression run of every real bill on this machine | in progress |
| `prod-flows` | E0, RV0, E1, K1, I1, E2/E3, F4, F1–F3, V1 | queued |

**How they reach production.** Merge the three into one integration branch
(`prod-int`), run the four checks with the database tier required and the
overflow audit, walk the same rehearsal again on the production build with
screenshots at 1920 and 1440, then Max pushes `prod-int` to `staging`. From
there the existing route: CI green on the SHA (both jobs), staging deployment
verified, pilot promoted through `docs/environments.md` *Promoting to pilot*,
Matthew and Claudia use it on pilot, and production is created from a SHA that
pilot has run.

---

## 5. Decisions only Max can make — with a recommendation for each

Each one changes what is built. The first four block the launch.

**D1 — Who sees which client.** There is no per-project access: every account
sees every project's documents, mail, swatches and exports. *Recommendation:*
launch to Ben Whistler staff only, with a written decision that every staff
account may see every client's material (check the NDAs say staff may; most
name the company, not a team). Build project membership after launch if any
client's terms require it. If they do require it today, it is two to three
days' work (a `project_members` table, a check in every project-scoped loader
and route, an admin screen) and the launch moves.

**D2 — Is the BWS file imported into BWS at launch?** The import REPLACES what
it is given; the file carries no job number; Tim's importer contract is
unwritten; nobody has done a real import. *Recommendation:* NO at launch. The
"Spec upload" stays a file a person reads and checks, which is what the help
file already says. Import becomes a separate go-live once Tim has written the
contract and one supervised import of one real project has been compared
field by field.

**D3 — Whose accounts.** Vercel, Neon and GitHub are one person's accounts and
nobody owns the Anthropic Console (`docs/recovery.md`). *Recommendation:*
create production in a company-owned Vercel team, Neon organisation and
Anthropic workspace, each with a second administrator; give production its
own Anthropic API key with a monthly spend limit and an alert email.

**D4 — Backups.** *Recommendation:* (a) read the production Neon plan's
point-in-time restore window and write it into `docs/recovery.md`; (b) a
nightly `db/backup.mjs --yes-production` to an encrypted, off-laptop location
(a company SharePoint library or an encrypted disk, not `~/bw-backups`); (c)
decide whether uploaded documents need their own backup — they are the
client's originals, so the honest answer may be "the client and SharePoint
hold the originals" written down; (d) one restore drill into a scratch Neon
branch before launch.

**D5 — Retention.** Nothing uploaded is ever deleted, and a deleted project's
contacts and values stay in `audit_log` for ever. *Recommendation:* write the
rule down now (for example "kept for the life of the project plus six years,
deleted on request through `db:delete-project`") even if nothing enforces it
yet.

**D6 — The production branch and domain.** `CLAUDE.md` forbids Claude creating
a production branch. *Recommendation:* Max creates `production`, which only
ever fast-forwards to a SHA pilot has run, with the same branch protection
`docs/environments.md` asks for on `pilot`; the Vercel project's Production
Branch is `production`. A company domain (e.g. `spec.benwhistler.com`).

**D7 — Data residency.** Create the production Blob store in a London/EU
region if Vercel offers it; record where Anthropic processes requests.

**D8 — Decimal quantities.** Banquettes and anything sold by the metre lose
their quantity. *Recommendation:* make `spec_records.qty` numeric (one
migration; the exports and the quote/costing composers then print the bill's
figure) — but only after Tim confirms the BWS importer accepts a decimal
Item Count. Until then the record keeps the bill's words (`qty_raw`) and says
"quantity not given".

**D9 — Pilot data.** *Recommendation:* production starts empty (seeds and
users only); pilot stays as Matthew's working build until production is
accepted, then is frozen. Real enquiries already on pilot are re-uploaded to
production rather than copied, because pilot holds test-era defects (the
list under Max in `docs/plans/README.md`).

**D10 — Mail.** *Recommendation:* mail ingestion stays disabled at launch
(`MAIL_INGESTION_MODE=disabled`); people save replies as `.eml` and upload
them, which works (once E0 lands).

**D11 — CSP.** *Recommendation:* keep the full policy report-only for the
first week of production and enforce it after one walk of every screen shows
no violation in the console.

---

## 6. The plan, day by day

**Day 1 — code (Claude; Max pushes).**
1. Land `prod-harden`, `prod-bill`, `prod-flows` on `prod-int`; the four
   checks with the database tier required; the overflow audit; the rehearsal
   walked again on the production build, screenshots at 1920 and 1440.
2. Dependency bump in its own worktree with its own `node_modules`: `next` to
   the latest 15.5.x, `postal-mime` to 4.x (a major — the email tests are the
   proof), `zod` to the patched 3.x. The four checks again.
3. `docs/environments.md`: a "Creating production" section mirroring pilot's
   (§8 below), `KNOWN_HOSTS.production` filled in once the host exists, the
   help file updated for every screen that changed.
4. Max: push to `staging`, read CI (both jobs), confirm the staging
   deployment for the SHA (`/api/health` now names the commit without signing
   in), walk the first-session script.
5. Max: decide D1–D4 (they shape day 3).

**Day 2 — acceptance (Matthew, Claudia; Max).**
1. Promote pilot to that SHA through the eight-step checklist (no migration is
   pending).
2. Matthew and Claudia take one real new enquiry through pilot end to end:
   upload, bill, drawings, finishes, levels, fill-in, chase, the three files.
   Two people, one hour, notes in `found-in-use.md`.
3. Fix what they find the same day; anything that is a design question waits
   for them.

**Day 3 — production (Max at the consoles; Claude writes and checks).**
Follow §8 exactly. Then §9's smoke test, signed in, on production.

**Day 4 — go-live.** Accounts for the first users (`create-user` with
`NEW_USER_PASSWORD`), the help file sent with the link, the first real
enquiry with Max watching, the uptime check and the spend alert armed.
"Hypercare" for a week: one person reads the `[request-error]` lines daily.

---

## 7. After launch (not blocking)

- RV2 show what changed in a held-back description on a revision; RV3 pair
  linked twins by area; R1 the record header line; W2 the double-press
  wording; V1 if it did not fit; the US-style dates on History; one finish
  "— TBC" separator.
- Per-project access if D1 says "later".
- A cost view over `model_metadata` (every read already stores its usage).
- A very large spec-document review renders as one page (1,500 rows were
  143,000 pixels tall); paginate or group by item.
- The overview polls the whole project every 5 s.
- Supplier register by Capsule id (`project_finishes.supplier_raw` is free
  text).

---

## 8. Creating production — the checklist

Once, by Max, after D1–D7. Mirrors *Creating the pilot environment* in
`docs/environments.md`; the differences are in bold.

1. **Neon:** a NEW project `SpecBuilder Production` in `aws-eu-west-2`, in the
   company organisation (D3). Note its point-in-time restore window (D4).
   Pooled URL for the app, direct URL for the scripts.
2. **Vercel:** a NEW project `spec-builder-production` from this repository,
   in the company team. Production Branch: **`production`** (D6). Region
   `lhr1`. **Environment variables scoped to Production ONLY** — if they are
   scoped to "All environments", every Preview build of any branch connects to
   the production database.
3. **Variables** (every one, before the first deploy):
   `APP_ENV=production`, `DATABASE_ENVIRONMENT=production`, `DATABASE_URL`
   (pooled), **`AUTH_SECRET` new, ≥ 32 characters (`openssl rand -base64 48`)**
   — the app refuses to start in production with a shorter one (H1),
   **`CRON_SECRET` new**, `ANTHROPIC_API_KEY` **the production key with a
   spend limit** (D3), `APP_BASE_URL` = the production URL,
   `MAIL_INGESTION_MODE=disabled`, `AUTO_READ_DAILY_CAP=20`, `GRAPH_*` unset,
   `CAPSULE_API_TOKEN` optional.
4. **Blob:** a new PRIVATE store connected to the project, region per D7.
5. **Domain** per D6.
6. **First deploy** of the SHA pilot runs. Confirm the deployment exists for
   that exact SHA and is Ready; `GET /api/health` must answer
   `{"ok":true,"commit":"<that SHA>"}` without signing in.
7. **First run:** add the production host to `KNOWN_HOSTS.production` in
   `db/script-env.mjs` (a one-line commit) so the scripts check it; then
   `node --env-file=.env.production db/run-migrations.mjs --yes-production`
   (read the total: 60 applied), `node --env-file=.env.production
   db/run-seed.mjs --yes-production`, and the first accounts with
   `NEW_USER_PASSWORD=… node --env-file=.env.production tools/create-user.mjs
   <email> <name> <role> --yes-production`.
8. **Signed in:** `/api/auth/me` reports `production`/`production`; no chip and
   no `[…]` title marker (production shows none).
9. **Monitoring:** an uptime check on `/api/health` every 5 minutes (note: it
   keeps the Neon compute awake, which costs a little), a log drain or alert
   on `[request-error]`, the Anthropic spend alert.
10. **Backups:** the first nightly backup run by hand, its file opened, and
    the restore drill (D4).
11. **Branch protection** on `production` and `pilot` (no force push, no
    deletion, linear history, CI required).

## 9. The go-live smoke test (20 minutes, signed in on production)

Uses the invented pack in `~/dev/localstack/synthetic-hhh/out/` (nothing in it
is client material), so production's first project can be deleted afterwards
with `db:delete-project`.

1. Add a project; it opens on "Upload the pack".
2. Upload the six files; each is identified; Start intake.
3. The bill: headings and finish lines arrive as suggestions; accept them;
   sizes are placed; Confirm creates 29 records on 3 phases.
4. The preamble (7 notes), the finishes schedule (14), both drawings
   (W2100 x D950 x H820 x SH440mm; W780 x D820 x H760 x SH420mm), the email
   (Re-match, Confirm).
5. Set designer on the phase table; add a contact; draft a chase; download the
   `.eml` — it is addressed to the CONTACT, with no `[…]` subject marker
   (the production branch, H6); record it as sent.
6. Download the four outputs; the Spec upload has 29 rows and no finish twice.
7. Sign out; sign in as a viewer; a write is refused in words.
8. Delete the smoke project by script.
