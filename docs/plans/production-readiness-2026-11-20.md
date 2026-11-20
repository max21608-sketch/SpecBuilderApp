# Production readiness, 2026-11-20: what was tested, what is wrong, and the plan to launch

Asked for by Max on 2026-11-20: "get this app production ready in a few days …
come up with a very detailed plan, having tested, having gone through the app …
take screenshots … sanity checking everything … you need to replace me."

**Status (2026-11-20, late afternoon): TESTED; ALL FOUR FIX BRANCHES MERGED
INTO `prod-ready`; THE FOUR CHECKS GREEN ON THE WHOLE INTEGRATION (5,333 tests,
database tier required); THE REHEARSAL RE-RUN ON ITS PRODUCTION BUILD; NOTHING
PUSHED.** Claude cannot push (GitHub is read-only for Claude under the
organisation's policy) and cannot create production (Neon, Vercel and the
Blob store are consoles only Max holds). Everything below that says "Max" is
a step only Max can take. Every branch below was `committed locally` in the
six terms of `house/deployment.md` while this plan was written. **Since
2026-11-20 evening `prod-ready` is `pushed` to `origin/staging` at `72a69fe`,
by Max**; the staging deployment and CI on that SHA are not read by Claude,
and nothing is on pilot.

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
| A bill with headings the app does not know | `Spec Ref / Room / Item & Specification / No. Req'd / Lead time / £ each` — the model's column read mapped every role right and held Confirm for "The columns are right" |
| The production first run | An EMPTY local database: 60 migrations, 13 seed files (17 categories, 797 questions, 56 BWS fields, 115 palette options, 33 heading aliases), the first admin with the password from the environment |
| What is deployed | Pilot's sign-in page serves `[PILOT]` and v1.15 (the 2026-11-18 promotion is live) |
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
| B8 | A size written without `x` (`Overall: W 850 D 900 H 780 mm`, `H760mm SH 420`) places nothing — the same reader as found-in-use's `SH450` | D | `prod-bill` R9 (0 changes on every real bill and all 58 staged drawing runs) |
| B9 | A finish line's own label ("Finish: Brushed brass…") reached the BWS cell and the quote | D | `prod-bill` R8 |
| B10 | Library rows a bill creates carry no description, so the BWS cell is "MTL-01 TBC" with no words (MTL-01's words lost through R6; the fabric codes' never filled) | D | `prod-bill` R10 (on the real Aman bill: MTL-01 "Antique Bronze", TIM-03 "SMOKED STAINED OAK VENEER"; placeholders stay empty) |
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
| S3 | `npm audit`: `next` 15.5.25 has a critical and a high advisory fixed in 15.5.29; `postal-mime` 3.0.0 (every uploaded .eml) has a high one; `zod`'s needs zod 4 | should | `prod-deps`: next 15.5.29, the transitive fixes, postal-mime 4.2.1 (which also fixed calendar invites downloading as 0 bytes). Production audit 15 → 10, no critical; zod, the blob chain and Next's own postcss written up in `docs/stack.md` as accepted, with what would change it |
| S11 | After the parser upgrade an email attachment download could serve a different file than the one listed; a sender could fake Exchange's AutoForwarded stamp with `Name : value` | should | `prod-deps` F1, F2 |
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
| `prod-harden` | H1–H7, U1–U5 | done, 5,205 tests; **merged into `prod-ready`**; health, HSTS, cross-site refusal, add-project, Set designer, chase link and Emails group checked on the production build |
| `prod-bill` | R1–R10 and the revision polish RV2–RV5, with a before/after regression run of every real bill and staged run on this machine | done, 5,182 tests; **merged into `prod-ready`**; checked on a fresh project on the production build (and one layout regression it caused fixed in `63030a9`) |
| `prod-flows` | E0, RV0, E1, K1, I1, E2/E3, F4, F1–F3 (V1 not built — §7) | done, 5,159 tests; **merged into `prod-ready`** (two conflicts resolved by hand: the bill route's imports and the help file's revision paragraph) |
| `prod-deps` | next 15.5.29, `npm audit fix`, postal-mime 4.2.1, the accepted advisories written up; the attachment download match and exact header names; the record header, one confirm per press, en-GB History | done, 5,147 tests; **merged into `prod-ready`**, which now has its own `node_modules` from the merged lockfile |

### 4.1 The rehearsal again, on the merged production build

A fresh project (`T20120`), the same invented pack, every screen, scripted with
a pass/fail per finding (`~/dev/localstack/pw/prod-60-final-rehearsal.mjs`,
`prod-63-final-continue.mjs`; log `~/dev/localstack/final-continue.log`):
add project opens it · the bill opens on a real tab · headings and finish
lines suggested · sizes placed · Confirm creates exactly 29 records · the
preamble and schedule confirms are visible without scrolling and end in a done
state · both drawing cards W2100 x D950 x H820 x SH440mm and W780 x D820 x H760
x SH420mm · a double press never says "targets changed" · the email header says
it was uploaded · the email confirms (7 applied, no reload loop) · Set designer
on a whole phase · the chase `.eml` downloads · all outputs download · Rev B is
offered as a revision and Confirm waits for the decision — **all pass.**

Found by the re-run and dealt with the same afternoon:

- **An email already on another project** sent the person to an empty pack
  page ("That pack is not on this project") and lost the server's sentence.
  Fixed in `prod-ready` (`a867ca7`, with a test that fails without it): the
  panel stays open with "This email is already in the inbox as …, on T20111.
  Nothing was recorded or read again."
- **A statement about an item with no category** says "Item not found" though
  the item was found (its question cannot be matched without a category).
  Sent back to `prod-flows`.
- **The model read differs run to run**: on the second read of the same spec
  sheet it flagged the lounge chair's height as uncertain and held the card
  ("Check the height — then press Mark checked"). That is the design working
  and the reason a person reviews every card.
- **A finishes schedule now conflicts with the bill's own words** for codes
  the bill described (FAB-01 "Kvadrat Hallingdal 65, col. 130 — to sofas"
  against the schedule's "Hallingdal 65, colour 130"), because R10 gives the
  library the bill's words first. The conflict rule predates today (WD-02 did
  it this morning); R10 makes it more frequent. **Decision D12.**

### 4.2 The pre-push review (later on 2026-11-20)

Max chose "Review first" over pushing. Three reviewers who had not built any
of it read the 65 commits, one slice each: security and operations; the bill
reader and the confirm; email, documents and the screens. Each was given the
code and the load-bearing rules, not the builders' conclusions.

**Twelve defects survived their reading, plus one the 300-line walk found
(F6).** Fixed on `prod-fix-e` and `prod-fix-f`, each with a test that fails
without it, and merged into `prod-ready`:

| | What was wrong | Fix |
|---|---|---|
| E1 | "Set designer…" locked records in TICK order, one line at a time, and lost the whole batch on any lock wait. It deadlocked against a phase retire. | The project row first, then every ticked record and its configurations by id, before the first line |
| E2 | The designer route set a 60 s limit, below the project's 800 s default | removed |
| E3 | `/api/health` answered ok while every other page answered 503 for a missing or short `AUTH_SECRET` | 503 with the problem's code, never a value |
| E4 | The attachment-download check compared Graph's attachment list with the parser's, so mail delivered by Graph (latent; ingestion is off) would always be refused | the parser's list is stored for Graph arrivals too |
| E5 | Sign-in sat outside the cross-site refusal (login CSRF) | the same rule in the login handler |
| E6 | An unlabelled size line with a part word after it, such as `Dia 900 x H 25 top`, placed the part's size as the item's | it stays a note. Every real bill reads byte-identical before and after |
| E7 | A revision whose sheet mapped only a Category column wrote the category over the record's area | area is stated only by an area or sub-area column |
| F1 | Uploading one new email on its own made an empty pack and landed on "That pack is not on this project" | an email joins no pack, and lands on its own review |
| F2 | An email read before two lines were twinned asked the reviewer to pick one line | it says "linked as twins since this was read — Re-match (free)" |
| F3 | The twins sentence named four lines across two phases as "one item" | one sentence per phase's twin group |
| F4 | A file held for name/model disagreement lost the cost sentence for a PDF bill the model must transcribe, and was miscounted as a call to make | both corrected |
| F5 | "Confirm all" on the email review could send twice while an edit saved | one press, one confirm (the drawings' guard) |
| F6 | A held file's box already read "Bill of quantities", but only the small chip counted as a choice | the box reads "— say which —" until a person chooses |

**Then four small polish items** (`prod-fix-g`). Two usability walks that
afternoon found them, one of them by a reviewer who had never seen the app;
see `after-intake-2026-11-20.md`. Each is a defect by anyone's measure:

- **G1:** no names, file paths or "repo's judgement" on user screens or in the
  costing file, and "unlooked" → "not answered";
- **G2:** a grey dot, not green, for an item with no category;
- **G3:** a chase draft is signed with its creator's name;
- **G4:** "Upload the pack" opens the uploader in one press.

**Verified:**
- **Four checks:** pass on the final `prod-ready` (`cef9a40`), with the
  database tier required: 5,386 tests.
- **Overflow audit:** no box wider than itself on 31 pages at 1920 and 1440
  (`tools/overflow-audit.mjs`, dev server).
- **CI's `db-tier` job:** rehearsed exactly as CI runs it (`env -i`, a fresh
  empty database, `run-migrations` and `run-seed` from nothing,
  `tools/localstack/ci.mjs`) with 5,372 tests passing, before the polish
  items G1–G4 landed. This was on Postgres 18; CI runs 17.
- **CI's `check` job:** rehearsed in a bare environment; tests and the build
  pass.
- **Browser:** every fix above that a person can see was re-checked on the
  production build with a pass/fail script
  (`~/dev/localstack/pw/uxm-09-recheck.mjs`), and all pass.

**Not fixed, and why:**
- The single-record edits still take a share lock on the project row after
  their record. That is older than today and crosses every writer that locks
  the project for update, which now includes the designer batch. It is
  recorded here, not changed in a push week.
- A drawing's extra words on a code the bill already named are not kept
  (`after-intake` §9d). That is a deliberate rule, and changing it is Max's
  decision.

**Swept in by accident (17:15).** The intake session had given Max a
command for when this session was done:
`git -C ~/dev/worktrees/prod-ready merge intake-2026-11-20`. A run of it at
about 17:07 stopped before committing and left the merge in progress
(`MERGE_HEAD`). No session wrote in this worktree; the intake session
confirmed it ran only read-only git there. A doc commit here (`a47710f`)
then concluded the merge, so `prod-ready` also carries two commits from the
intake branch:
- `e0cb0f8`, "the file check is Haiku 5.5" (Max's decision of the same day,
  in the classify route and the upload panel);
- `45bf924`, its plan `open-intake-2026-11-20.md`.

The result is exactly a clean merge of the two sides; nothing on either side
was lost. The four checks were re-run on the combined tip `8677936` and pass
(5,388 tests, database tier required). On its own branch, `e0cb0f8` also
passed the four checks (5,374 tests), and live Haiku 5.5 calls filed every
test file correctly, including the real Panther Apx 1a set (intake session,
2026-11-20). The intake session wants it to ship. It was not part of the
pre-push review, and whether it ships in this push is Max's call. To take it out,
revert the merge's second-parent changes in a new commit; never rewrite
`prod-ready`, because the intake branch is built on it.

**How it reaches production.** Everything above is merged on `prod-ready`
(it took the place of the `prod-int` this section first planned), and it
fast-forwards `origin/staging`. Max pushed it to `staging` on 2026-11-20
(`ebbd762..72a69fe`). From there the existing route: CI green on the SHA (both jobs), staging deployment
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

**D12 — Which document's words describe a finish.** A finishes schedule
exists to say what each code IS; a bill line's words are a passing mention.
Today the library keeps whichever arrived first and every later disagreement
is a person's decision. *Recommendation:* record where a library description
came from (one column), let a finishes schedule replace words that came from a
bill (never words a person typed or confirmed), and keep the conflict for
everything else. This is your pending "source-document version precedence"
decision in its smallest form.

**D11 — CSP.** *Recommendation:* keep the full policy report-only for the
first week of production and enforce it after one walk of every screen shows
no violation in the console.

---

## 6. The plan, day by day

**Day 1 — code (Claude; Max pushes).**
1. Land `prod-harden`, `prod-bill`, `prod-flows`, `prod-deps` on `prod-ready`; the four
   checks with the database tier required; the overflow audit; the rehearsal
   walked again on the production build, screenshots at 1920 and 1440.
2. Because `prod-deps` changes the lockfile, `prod-ready` gets its OWN
   `node_modules` (`npm ci`) for the final four checks and the walk — every
   other worktree symlinks the main checkout's, which still has the old
   packages until Max runs `npm ci` there after the push.
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
- A view-only account sees every write button enabled (the server refuses,
  403 in words). No screen receives the user's role today; about twenty record
  components and the phase table would need it (Coder C's measured shape).
- A pack's header counts a duplicate email it did not register ("6 documents"
  over five rows).
- Per-project access if D1 says "later".
- A cost view over `model_metadata` (every read already stores its usage).
- The bill review's six separate "Accept all …" buttons per tab could be one
  "Accept every suggestion on this tab" (Max's call; each still names its
  evidence per row).
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
