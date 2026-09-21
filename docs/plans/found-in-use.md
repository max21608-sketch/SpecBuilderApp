# Found in use

A running record of things that need fixing, written down as they are found so
they stop being fixed one at a time out of order.

**This file plans nothing.** Each entry says what was seen, where, and what is
actually wrong — enough that somebody can later group these into a plan without
re-diagnosing them. No entry is a design, and no entry is a promise about how it
gets fixed. Nothing here is fixed unless its own line says so.

Asked for on 2026-09-18: "I just end up fixing this little thing, this little
thing, this little thing, and I have so many agents going and so many people
working on the project."

**How to add one.** Newest section at the top, one `###` per finding, dated by
when it was SEEN. Say what was on the screen, not what you think the cause is —
and where you do name a cause, say so separately, because a wrong diagnosis
written as fact is what sends the fix to the wrong file. Never delete an entry;
mark it FIXED with the date and the commit.

---

## 2026-09-20

### An answer typed on the infill screen is refused on the LOCAL dev server, and only there

**Status: open — found 2026-09-21 by the verifier's first-session runs, three
of three on `http://localhost:3000`, zero of one on the staging deployment.**
Filling a text answer on an opened infill line and blurring leaves it unwritten
and the row prints "Nothing was written — try again"; two attempts 45 s apart
both fail. On staging the same step succeeds (`outstanding 989 → 988`). Cause
apart from observation: the wording is `transactionErrorResponse`'s retryable
branch — deadlock, `lock_timeout` (5 s) or `statement_timeout` (15 s) inside
the guarded transaction — and the route does not log which; `pg_locks` and
`pg_stat_activity` showed no held lock afterwards. The by-question tab's
records also failed to arrive within 24 s on local only, probably the same
cause. A dev server sharing a laptop with a full test run is the likeliest
reading, and it is unproven; this is the meeting screen, so it is worth
proving before Matthew is in front of a client with it.

### `chase-template.ts` held two raw NUL bytes — FIXED same day

**Status: FIXED 2026-09-21, on staging with the verifier's script.** Two key
separators were written as literal `\0` bytes rather than `\u0000` escapes,
so `file` called the source `data`, `grep` printed nothing for any symbol in
it (Fable's greps on 2026-09-20 returned empty for exactly this reason and it
was blamed on a shell function), and `git diff` treated the file as binary.
Same technique, escaped; behaviour unchanged, the template tests green.

### *Read all* starts every document at once, past the pack's cap

**Status: open — found 2026-09-21 by Coder B while building the cap (Stage 2
item 2.10.f); briefed the same day as Coder B's round 3.** Registration now
reads three documents of a pack at a time and defers the rest, but
`PackDrawingsReview.readAll` loops `POST /api/imports/[id]/extract` with
`action: "start"`, which takes no slot — one press on an eleven-document pack
still starts eleven concurrent reads, and retrying eleven documents a 429
storm just failed is the case the cap exists for. The review's chip also
reads *Not read yet* for a run that is in fact waiting for a slot, because
`loadBatchDrawings` does not carry the marker. Cause apart from observation:
the cap was added at the two registration paths and not at the third way a
read starts.

### An attempt that passes its 24-hour deadline is settled by nothing

**Status: open — pre-existing, made visible by the cap, 2026-09-21.** An
attempt whose `attempt_deadline_at` passes stays `queued` with no worker
coming; the screens offer *Restart*. The cap steps around it — an expired
attempt stops counting against the pack — but nothing hands its slot on at
the moment of expiry, so a pack whose three in-flight attempts all expire
sits still until somebody presses Read all. The fix is a sweeper or a
settle-on-expiry path, and it belongs with the queue, not with a screen.

### The BOQ review's loading state is a discarded variable

**Status: open — observation, 2026-09-21.** `src/app/dashboard/imports/[id]/page.tsx`
has `const [, setLoading] = useState(false)`: the value is never read, so
`setLoading` is a bare re-render and the screen shows no loading state. Harmless
today, and the reason that screen's banner happens to survive a reload.

### A record's version number is taken without a lock, and two edits collide

**FIXED 2026-09-20, `929a5b6`** (Stage 2, Coder B round 2): `snapshotRecords`
locks the records it versions before reading the number; a db test races two
transactions deterministically. Found by Coder B while driving the infill
screen on the sandbox.
`snapshotRecords` (`src/lib/record-snapshot.ts`) reads `max(snapshot_no)` for
a record and inserts the next number with no lock on the record; `editAnswer`
locks the ANSWER row only. Two edits to two different questions on one item —
a palette picked, then a tab out of the next box — both claim the same number,
the second dies on `record_snapshots_record_no_key`, and the reviewer sees a
**500** saying nothing was written. Every write path shares it; the infill
screen serialises its own saves so a meeting does not provoke it. Cause named
apart from the observation: the baseline already writes under the project row
lock for the same class of reason (0013); a version needs the record's.

### The infill DoD walk left QA litter on the demo project

**Status: open — housekeeping, not a defect. 2026-09-20.** Coder B's
definition-of-done walk wrote four `__QA`-prefixed answers, one `W845mm`
attribute and two change sets named "__QA Handover call with Hayley,
2026-09-22" into DEMO-TEST-01 (`252bcdcf…`). 0014 refuses deleting a change
set while its project exists, so it cannot be tidied piecemeal;
`npm run qa:demo -- --clear --apply` rebuilds the project (~15 minutes) if it
matters before a call. Fable's own 2.5 walk generated one ordinary draft for
Priya Raman there and removed the temporary `QA Colleague` contact and its
draft.

### One component test sits at 3 s against a 5 s default

**Status: open — observation from Stage 2's full runs, 2026-09-20.**
`tests/components/spec-table-area.test.tsx › renders every area on a 300-line
phase` takes about 3.0 s alone and timed out once under a full concurrent
run; `extraction-queue.test.ts › exactly ONE of two simultaneous deliveries`
did the same on another run. Both pass alone and passed on the run that
gated the fast-forward. Same class as the Stage 1b contention timeouts.

### The versions diff labels a phase "Run"

**Status: open — seen 2026-09-20 while reviewing Stage 2 item 2.6's
files, not in the browser.** `CORE_FIELDS` in `src/lib/snapshot-diff.ts`
labels `runName` as `Run`, so a record moved between phases would show a diff
line headed "Run". The vocabulary guard reads screen sources, not `src/lib`,
which is why 1.1 missed it. One word; belongs with the next item that touches
that file (2.6 adds a core field there).

### Found by the first-session script and the 300-line fixture, 2026-09-20

**Status: open, six observations from the Stage 1a verifier's runs** on the
sandbox, none fixed. The script (`.claude/skills/verify/files/first-session.mjs`)
walked all eleven steps of the plan's §7.4 — 20 assertions pass, 8 are
deliberately skipped (1.13's, 1b's, and two that need a page preview a clone
does not have) — and `npm run qa:demo -- --lines=300 --no-checklist --apply`
built **DEMO-300** (`a88aed3e-ef7f-4290-a732-0ef173ae3474`, 503 records over
3 phases, 416 seconds), beside DEMO-TEST-01 rather than instead of it.

1. **The 300-line project overview takes 10.4 seconds to render.** Measured
   on DEMO-300. §7.4a asks for under two. The same shape as the two-second
   projects list already recorded; `loadOutstanding` over 503 records is the
   likely weight and the overview's tiles all read it.
2. **The configuration card issues one confirm per configuration and the
   second returns 409** while the first succeeds; attributes are written and
   the card reloads correctly. Consistent with "a refusal on B leaves A
   applied", but it lands in the failure collector every run — a person would
   read it as an error.
3. **`/api/records/<id>/image` 404s for a record with no picture**, console
   noise on every record open. A 204, or not asking, would be quiet.
4. **The staged S-100 run `116b6b93…` reads the sofa as 2 configurations**,
   so a confirm on a clone creates variants A and B. If that grouping is wrong
   on the real pack it is wrong on the source project too — a reading for a
   person against the pages, not a code question.
5. **`qa:demo --clear --apply` sweeps every `DEMO%` project**, now DEMO-300 and
   the walkthrough together. Unchanged behaviour, worth knowing an hour before
   a call.
6. **A second demo project needed its own mailbox**: `email_messages` is unique
   on `(mailbox, graph_message_id)` with fixed ids, fixed for `--lines`; any
   future second demo hits it.

And one about the machine rather than the app: the repo lives in iCloud Drive,
and four coder worktrees each carrying `node_modules` drove the load average
to 79 (`fileproviderd`, `cloudd`, `bird`); typecheck did not finish in one
worktree in forty minutes, and conflict copies named `* 2.ts` appeared in a
worktree's `src/lib`. Worktrees go outside iCloud from now on, and are removed
when their coder is done.

### Two dark controls on the drawings review and the BOQ review

### The two dark controls on the review screens — FIXED same day

`9b626eb`: the next-step action renders only in the *Review complete* state on
both drawings screens, and the BOQ review's confirmed box no longer draws a
disabled Confirm in the primary's fill. The pack screen's duplicated
"Review all 9 drawings together" (header and card) is item 1.6's territory.


**Status: open — seen in the §7.4a screenshots of the `3b6d9db` deployment,
2026-09-20, at both 1920×1080 and 1440×900.** On a drawings review that is
still being reviewed, the page carries the card's `Confirm S-100 (2
configurations)` AND item 1.11's next step `Review 9 documents` — and this
document is one of the nine. The BOQ review of an already-confirmed bill shows
its (disabled) `Confirm · creates 34 records on 3 phases` beside `Review 9
documents`. The pack screen carries `Review all 9 drawings together` twice
(header and card), which predates 1a. §0.3: one primary per screen, and it is
the next step. The rule the step should follow on a review screen: render it
only in the *Review complete* state (the plan's own wording for 1.11), never
beside a live Confirm. A 1b line for the coder holding the drawings card.

### A checklist question with no answer row crashed the record screen

**Status: FIXED 2026-09-20, `be8539d` (cherry-picked from Coder C's `100a511`),
the same day it was found.** Driving item 1.12's disclosure link —
`/dashboard/records/<id>?tab=checklist#q-<requirement>` — rendered
"Application error: a client-side exception has occurred",
`Cannot read properties of undefined (reading 'chip')`. The record loaded
with `?tab=checklist` alone and with `#q-…` alone; only the combination
crashed.

**Cause, stated apart from the observation:** `GET /api/records/[id]` builds
its answers off `requirements` with a LEFT JOIN to `spec_answers` and selected
`a.state` with no coalesce, so a requirement added to a category after the
record was categorised came back `state: null`. Every filtered view of the
checklist tests the state and dropped the row silently; the anchor path
clears the filter so the target is on the page, the row reached
`TONE[ANSWER_STATE_TONE[null]].chip`, and the screen went white. A latent
defect since the checklist existed, reached for the first time by a link that
opens the checklist unfiltered. Fixed at both ends: the route coalesces to
`missing` (the reading `loadOutstanding` and `loadProjectSummary` already
carry), and the tone lookup falls back to plain, `intakeStatusTone`'s rule.
Three component tests render the checklist under a `#q-` hash with every
state, including none. Also found by the test: `scrollIntoView` was called
unguarded inside an effect, which jsdom does not implement.

**Still open from it:** the payload's `state` is typed non-null while only
the route's coalesce makes that true. A route-tier assertion would hold it.

### iCloud writes " 2" copies into `.next`, and typecheck reads them

**Status: open — environment, not code. Seen 2026-09-20 on the Stage 1a
checks.** `npm run typecheck` failed with `TS2300 Duplicate identifier` on
`.next/types/cache-life.d 2.ts`, a conflict copy iCloud Drive made while the
dev server and a worktree build both wrote `.next`; `routes-manifest 2.json`
and three siblings appeared beside it. The build passed, so the failure read as
a regression in the commit under test and was not. `find .next -name "* 2.*"
-delete` and a rerun was clean. The checkout lives under `Mobile
Documents/com~apple~CloudDocs`; moving it, or excluding `.next` from sync, is
Max's call. Also in the same run: `tests/db/manual-capture.test.ts` › *a typed
dimension PROMOTES* failed once at 7.3s under the full concurrent run and
passed alone — a third name for the contention class recorded on 2026-09-19.

### A bill's date prints as an ISO timestamp

**Status: open — seen on the BOQ review and the phase header while verifying
Stage 1a item 1.2, 2026-09-20.** The Panther bill's `Revision` field reads
`0 · 2026-09-15T00:00:00.000Z`, and the phase subtitle `BOQ rev 0,
2026-09-15T00:00:00.000Z`. The rule that the date stays TEXT is right (the
TOE-dates trap), but the text kept is the spreadsheet library's serialisation
of a date CELL, not what the sheet printed — a person reading the workbook sees
`15/09/2026`. Cause, stated apart: `readMetadata` in `boq-import.ts` takes a
Date-typed cell's `String()` form. The fix is to format a Date-typed cell the
way the sheet displayed it (or `YYYY-MM-DD`) AT PARSE TIME, still as text, and
it is not a Stage 1a item.

### The chase footer does not say why one to-quote question is not ticked

**Status: open — an observation from verifying Stage 1a item 1.14, not a
fault in it.** On the sandbox demo project, chasing Priya Raman: the lines'
to-quote column sums to **71**, the button and footer say **70**. The one is a
to-quote question on DEMO-TEST-01-003 already chased and awaiting a reply, which
the preselection excludes by the plan's own rule and the line still counts
because it is still outstanding. Both numbers are right; the footer reads
"70 to-quote questions preselected · 113 also outstanding, not selected" and
names no third bucket. The same shape as finding 13 of 2026-09-18 (two counts,
one unexplained), on a different screen. A sentence — "1 awaiting a reply, not
selected" — closes it; not built, because 1.14's source line does not ask for
it and the "Include questions awaiting a reply" control already exists.

## 2026-09-19

### Two tests fail under the full concurrent run and pass alone

**Status: open. An observation from Stage 1a's first full `npm run checks`
against the sandbox, 2026-09-19, not a fault in what either test covers.**
With the database tier required, **2 failed · 1,280 passed · 1 skipped**; both
files then passed on their own, first attempt, and neither touches anything
the commit under test (`d853976`, the drawings pipeline's TBC marker) changed.

1. `tests/components/record-history.test.tsx` › *counts what did not move, and
   keeps it one click away* — `findByRole` timed out looking for the
   "unchanged — show them" button. Alone: 7 passed in 295ms. The component
   tier's default `findBy*` wait is 1s, and under a full run jsdom shares the
   machine with the db tier's setup (48s of it in this run).
2. `tests/db/boq-concurrency.test.ts` › *allocates distinct record numbers for
   two simultaneous imports* — one of the two concurrent confirms answered
   **503** where 200 was expected. Alone: 7 passed, that test in 4.9s. Under the
   full run the sandbox is also serving every other db-tier file's writes, so a
   lock wait on the project row is the likely reading; which guard returns the
   503 is worth naming before anything is changed.

**Cause stated separately from the observation:** both look like contention in
a full run against a remote database, the same shape as the Stage 0 timeouts
(`make-it-work-2026-09-19.md`, Stage 0 brief, rows 7–8 and the last). The
plan's rule stands — a red test is run alone first, and a green run alone is
not a licence to raise a bound without measuring. This entry exists so the
next full run that shows the same two names is recognised rather than
re-diagnosed. If a third run shows them, item 0.7 (a throwaway Neon branch per
run) is the durable fix for the second; the first wants its wait raised
deliberately, with the reason beside it.

### A misconfigured deployment renders its sign-in page and dies at the first query

**Status: open. Seen on the first pilot deployment, 2026-09-19 evening.**
The pilot build at `spec-builder-app-4g38.vercel.app` served `/login` with the
title `[PILOT]` and the PILOT chip (200), answered `/api/auth/me` with a clean
401, redirected `/` to login — and returned a bodyless **500** on
`POST /api/auth/login` with a deliberately wrong password, where staging
returns 401. The same pooled string connects from a laptop through the app's
own driver.

**What that shape means.** `src/lib/env.ts`'s header says the environment
pair is enforced "from middleware.ts and db.ts at request time". `grep` says
`src/middleware.ts` never imports it. So `APP_ENV` is read non-throwingly for
the title and chip, the session check runs without touching the database, and
the pair (`APP_ENV` against `DATABASE_ENVIRONMENT`) is checked only when
`db.ts` is first called — which on a fresh deployment is the login POST. A
deployment with `APP_ENV=pilot` and `DATABASE_ENVIRONMENT=sandbox` therefore
looks healthy on every page a signed-out person can reach and fails at the
first thing they do. The `[PILOT]` title is not proof the pair is right; only
a signed-in `/api/auth/me` is.

**Cause of tonight's 500, stated separately:** not yet read from Vercel's
runtime logs, which are the definitive evidence. Consistent with either
`DATABASE_ENVIRONMENT` not being `pilot` on the project, or `DATABASE_URL`
absent or pasted with quotes. The message the guard throws names which.

**Two things a fix should do, neither done:** make the doc match the code
(either enforce the pair in middleware, so a mismatch fails on the sign-in
page, or correct the comment); and make the 500 carry its reason to the
response as a sentence on non-production builds, because a blank 500 at
sign-in sent a person to look at the database string when the database was
fine.

### The sandbox database is full, and the audit log is why

**Status: open — a decision for Max, not a code fix.** Found by both Stage 0
coders independently at about 18:20: every write to the sandbox fails with
*could not extend file because project size limit (512 MB) has been
exceeded*. Reads still work. The database tier of the test suite cannot run
until it is resolved, and neither can anything else that writes.

Measured, read-only, at 18:30:

| | |
|---|---|
| Database | 489 MB of a 512 MB project limit (Neon free tier) |
| `audit_log` | **460 MB**, 527,834 rows, 8 days |
| of which `__qa@example.test` | 217 MB |
| of which `qa` | 126 MB |
| of which demo/seed actors | 30 MB |
| everything else in the database | 29 MB |
| Growth | 13 MB (12 Sept) → 139 MB (16 Sept) → 54 MB (18 Sept) per day |

So two thirds of the whole database is before-and-after JSON for test rows
that the QA cleanup deleted long ago. The cleanup never touches `audit_log`
**by design**: the table is append-only by trigger (`audit_log_no_delete`,
`audit_log_no_update`) and `house/conventions.md` §12 says a QA run that
deletes from it has broken the thing under test. That rule is right for a QA
run and it is what filled the sandbox.

**Cause, stated separately from the observation:** every db-tier test writes
real rows through `write_audit()`, which stores whole-row JSON twice per
change; `spec_answers` alone accounts for 267 MB of the log because a
fixture creates and deletes hundreds of answers per run. Nothing removes them.

**Options, each with its cost — Max decides:**

1. **Raise the Neon plan** (Launch tier, 10 GB). Fastest; buys months; changes
   nothing about the growth, and the pilot project will need headroom too.
2. **A one-off, authorised purge of the QA actors' audit rows** — disable the
   delete trigger inside one transaction, delete where `changed_by` is a QA
   actor, re-enable, then let Neon vacuum. Frees ~340 MB. It is the one thing
   §12 says never to do, so it needs Max's explicit yes in writing, a backup
   first, and a dated line here saying it was done. It does not stop the
   growth either.
3. **Stop the tests filling the sandbox at all**: run the db tier against a
   Neon BRANCH created per run and deleted after (branches are copy-on-write,
   so a run's writes cost only their delta while the branch lives). The
   durable fix, and the only one that keeps §12 intact; it belongs with the
   `checks` script of Stage 0.4 and is a small item on its own. Does not free
   today's 460 MB.

The honest combination is probably 2 once, then 3 so it does not recur; 1 if
Max would rather not touch the log at all. None of it should be done from a
test or a script that runs unattended.

**Also left by the wall:** the 0.5 coder's `db:qa-clean` attempt failed
part way through (it is not transactional), so one `__QA` project may be
missing its drafts and contacts rows and still exist; re-running the sweep
once space is freed finishes it. And the seven `__QA` projects currently in
the sandbox are a product of the same week.

### The projects list takes about two seconds to answer

**Status: open. A performance finding, measured, not a fault in what it
shows.** Found while fixing the red db-tier tests (plan Stage 0.3): the test
*hides an archived project from the list unless it is asked for* timed out at
the 5s default, and the timeout was corrupting the test after it.

Measured against the sandbox — 6 active projects, 9 including archived,
11,673 `spec_answers` rows: `GET /api/projects` takes **1.5–2.1 seconds per
call**, repeatably. On the projects list screen that is the wait before the
table appears, every time.

**It is NOT an N+1.** `src/app/api/projects/route.ts` already batches every
loader over the whole page — one completion query, one summaries query, one
`loadOutstanding`. Its own header names the cause and the fix: `loadOutstanding`
returns every outstanding QUESTION across every project on the page, so the
list is loading the chase inventory of the whole business to print one Waiting
count per row, and "if this list ever gets long that is the thing to make
lazy". The Waiting count cannot become a SQL count without a second copy of
the staleness rule (`canonicalJson` over the context snapshot), which is the
`chased_at` trap.

Nine projects is not long. The plan's 300 test (`make-it-work-2026-09-19.md`
§7.4a) asks what happens at scale, and this is the first screen with a
measured answer. The test bound was raised to 30s as a documented stopgap
(`tests/db/project-overview.test.ts`); the route is unchanged.

**Cause named separately from the observation:** the loader, per the route's
own comment. Not verified by profiling the query itself — the time was
measured at the route.

## 2026-09-18

### Seen in the catchup demo of 2026-09-18 — fifteen things, all small

**Status: all open.** Found by driving the Panther pack live in front of
Matthew, Sebastian, Steve and Tony. The full record of that call — what was
said, by whom, with timestamps — is `docs/plans/catchup-2026-09-18.md`; this
entry exists so the defects are in the place defects live, and nothing here
plans a fix.

Grouped because each is a line or two, not because they are one problem.

1. **The header-row message names the wrong row.** The BOQ review said *"row 6
   was skipped, header found on row 6"*. Matthew opened the workbook: products
   start at row 7. The message is about the header and reads as an error about
   the data. (12:39) **FIXED 2026-09-20, `cbfd614`**
   (Stage 1a item 1.2): the review now prints "Header on row 6. Items start on
   row 7. 5 rows above the header were read as the phase's notes (revision,
   date, terms)." — the items-start row read off the first parsed line, never
   header + 1. Verified on the sandbox against the real Panther bill.
2. **Packaging and delivery came through as records.** `PACK` and `DEL` lines
   became furniture. Matthew confirmed outright they should not be there. Max:
   *"probably a good test — how easy is it to ignore?"* Today it is a per-row
   action with nothing suggesting it. (19:47)
3. **The phase overview's tiles say nothing anybody acted on.** Max, unprompted:
   *"just an overview of where it is, a few just little boxes. We can change
   those to have something useful or meaningful in them."* Matthew read one
   aloud — *"the 22 product categories"* — and immediately re-described the run
   as *"sofas and armchairs, basically"*. Nobody said the number was wrong; a
   tile that needs that much explaining is one nobody is reading. (19:15)
4. **A pack document is ticked because it was OPENED, not checked.** Matthew:
   *"so it's ticked because you've opened it."* Max: *"because I've reviewed it
   now."* He let it go, but the pack's progress is therefore a record of what
   somebody looked at. On a thirty-document pack that distinction matters.
   (23:29)
5. **The per-document banner stack does not scale.** White and yellow notices,
   one per document on the pack screen. Max, unprompted: *"if you were doing a
   larger order it would just stack up and you'd have like 300."* Matthew
   checked they carried nothing needing review. (24:02)
6. **The item picture crop failed on a real page.** *"The picture extract hasn't
   worked very well this time. It's meant to just take a crop of the image, but
   it hasn't."* Max drew the box by hand. The card offering the whole page and
   *Drag a box* is what saved it, so the recovery path works — the extraction
   did not. (28:02)
7. **`TBC – <fabric>` puts the marker inside the value.** The sheet prints a
   fabric *and* the word TBC; both landed in the value. Matthew: *"it shouldn't
   really be in the name."* (31:01) **FIXED 2026-09-19, `d853976`** (Stage 1a
   item 1.8): a separator-bound marker at either edge of a value is the STATE
   and the remainder is the value, at staging and at read time, so the packs
   already staged show it without a re-read. Verified on the sandbox S-100 card.
   A canonical row confirmed before that date keeps its old value and is
   rendered once by `renderAttributeValue`, as before.
8. **The swatch picker cannot reach the page the finishes are on.** *"It was on
   the second page, and I've only got one page, so… I need to work on that."*
   Matthew confirmed two-page items are normal for this pack: *"you've got the
   shop drawing and then with the finishes."* (31:59)
9. **The internal BWS field ordinal leaks to the screen.** `1 · COM 1` beside a
   fabric, `3 ·` beside dimensions. Matthew spent about ninety seconds working
   out whether the number was a BWS reference — including a wrong guess,
   *"it's the reference for the JSON file"* — before Max said *"that's just an
   internal app thing… I'll get it to hide it."* (36:43) **FIXED 2026-09-20,
   `9cd7105`** (Stage 1a item 1.3): the field NAME stays and the id moves onto
   the element's title, on the checklist, the Add-a-spec list and the gate
   board (whose `BWS id` column is gone — a recorded deviation from the
   mock-up). A readiness question prints nothing extra. Verified on the
   sandbox record that showed `1 · COM 1`.
10. **Project-level questions are asked inside every item's checklist.** TOE
    agreement, sales folder and similar appear on each furniture line. Matthew:
    *"you do that once for the project presumably?"* (40:22) **Step 1 FIXED 2026-09-20, `9715b0f`** (Stage 2 item 2.8): the section folds last and closed on every checklist; answering once per project (step 2) waits for Matthew to ask again.
11. **There is no visible route from a confirmed intake to reviewing each line.**
    Matthew asked *"how do you get to this page? At what point in the workflow do
    you come to this?"* and, when told email intake would handle it, correctly
    pushed back: the intake may have missed a dimension, so there has to be a
    pass where you confirm, deny and adjust — and know what is outstanding while
    you do it. Max: *"sorry, I misunderstood that."* **The app can do all of
    this.** He could not find the way in. (41:42–45:06)
12. **The phase table shows a button where it should show what is missing.**
    *"On this page, you can't see what's missing? There's a button to go and see
    them, but you can't see it on this page."* Confirmed by Max. (50:44)
13. **Two counts differ by one on the same screen, unexplained.** The gate panel
    read *"5 to answer"*; the button top right read *"Chase the 4"*. Sebastian
    asked outright: *"top right-hand corner is 4. Is that something different?"*
    It took Max a moment to work out why — Spec notes is a manual entry and is
    not chased. The reason is right; the screen says none of it. (49:38–50:18) **FIXED 2026-09-20, `7d569c3`** (Stage 1a item 1.4). The cause
    as measured in code was not quite the one given in the room: the panel
    counts FIELDS off the gate rows and the button counts QUESTIONS, and the
    extra rows are fields recorded on the item's details (Spec notes, Designer
    reference) that have no checklist question, plus — on other records — the
    four dimension slots against one Dimensions question. Both numbers stay;
    each now says what it counts ("6 to answer at TGQ · 4 to chase · 2 you
    record on this item's details"), the rows are labelled, and the button
    counts what the chase screen will tick (`toChase`, spec-field to-quote
    questions — the one change of meaning, Max to overrule). Verified on the
    sandbox sofa record.
14. **A confirmed record's update path could not be found, and Matthew went
    looking for it.** *"I remember seeing a page… where it kind of had confirm,
    or you could update it. You could confirm that what was captured is correct,
    or you could update it."* Max: *"I think it's kind of been locked down at
    this point."* Immutability of an applied proposal is deliberate; the route
    to changing a value on purpose is what is missing. Same failure as 11, one
    step later. (51:08–51:58)
15. **The chase draft preselects everything instead of the TGQ set.** Max named
    it in the room: *"it hasn't automatically selected… it's still selecting all
    of them, when in fact it should have just selected [the four]."* Red dot =
    needed to quote, grey = also outstanding; the reading is right and the
    default selection is not. (1:21:29) **FIXED 2026-09-20, `1fcc506`** (Stage
    1a item 1.14): exactly the chosen contact's `to_quote` questions are ticked
    on load and again when the contact changes; a filter never touches the
    ticks. Verified on the sandbox: Draft the email · 70, footer "70 to-quote
    questions preselected · 113 also outstanding". One observation left open
    below. **FIXED 2026-09-20, `e0254fb`** (Stage 1a item 1.11): one pure
    `nextStep` decides the next step from the numbers the loaders already hold
    — upload → reading → retry a failed read → review the bill → review the
    staged documents → categorise → review to-quote gaps → export — and every
    screen's PRIMARY button is that step: the overview header, the *Review
    complete* box on both drawings screens, the BOQ's confirmed state. Driven
    on the sandbox: AP364e's primary reads "Review 9 documents" (its drawings
    are staged and unreviewed); AP364c's reads "Categorise 6 items" and from
    the projects list the route project → primary → item → Checklist is four
    presses. Two judgements recorded: the review-documents step was not in the
    plan's list and is the §0.3 order applied; the label counts questions, not
    items, because that is what the summary holds. **FIXED 2026-09-20, `77895e4`** (Stage 1a item 1.12): the *Needed to
    quote* count is a disclosure; expanded, it lists the record's own missing
    to-quote fields by name, grouped by section, six at a time, each a link to
    that question on the checklist. The list comes out of the same loop that
    makes the count (`?withToQuote=1`, asked for on the first expand), so the
    two cannot disagree. Driven on AP364c's phase tab: the headboard's 5 opens
    into Access, Dimensions, Outdoor, Assy guide required, Headboard fitted?. **FIXED 2026-09-20, `51f7bb8` + migration `0033`** (Stage 1a item 1.13,
    design §5.2 of the plan): the CORRECTION verb. Beside every active spec on
    the record's Specs tab, *Correct* opens an inline editor pre-filled with
    the value; *Save the correction* retires the old row with
    `superseded_by_id` pointing at a new row that KEEPS the source run and
    page, under one `attribute_correct` change set (reason required, as
    retire), recomposes the checklist and snapshots the record. Driven on the
    demo sofa: two clicks, `W1820 x …` → `W1830 x …`, Versions v10 "1 changed ·
    1 added · 1 removed · 60 unchanged · Spec corrected". The old row sits under
    *show retired*, naming the value that replaced it. **FIXED 2026-09-20, `36dbed5`** (Stage 1b item 1.10): the picker offers
   every page of the item — "Crop from: page 1 · page 2" — defaulting to the
   page the finish was read from, one `PageCropper`, and the crop's payload
   carries the page it was cropped FROM. Driven on the sandbox S-100 card.
   Observation left: `attachments` has no source-page column, so a
   drawings-confirmed swatch records its page in the filename only. **INVESTIGATED 2026-09-20, `7b9ee6e` (Stage 1b item 1.9) — the fix
   is the PROMPT, deferred to the finishes-schedule re-read.** `measure:drawings`
   now counts item pictures: across the sandbox's 33 runs and 100 items, 162
   regions were reported and every one is usable (in bounds, not inverted,
   above the cropper's 2% floor, on its own page); 0 faulty. The crop is
   exonerated. The 42 items with NO region split two ways: the same `Apx 1a`
   file read twice, one read reporting 46 regions and the other none
   (read-to-read variance), and two SPEC-346 sheets (S-100, S-201) silent in
   every one of their eight reads (a property of those pages). Neither is a
   coordinate bug and neither is fixable in code; a stronger ask for the
   largest pictorial view's box is a prompt change and costs a charged re-read
   of every document, so it lands with the finishes-schedule schema change,
   once. Until then the whole-page proposal with *Drag a box* is the designed
   path, and it is what saved the demo. Still to look at with a person: a
   region that is in bounds but TRANSPOSED on a landscape sheet, which no
   measurement can see. **FIXED 2026-09-20, `1c2fe43`** (Stage 1b item 1.5): a leaf suggester
   reads the code's prefix, then the description's words, with a missing
   category as supporting evidence only; the review shows *Not furniture?* with
   its reason as a `SuggestButton` and *Ignore all suggested (n)* ignores
   exactly that set in one press; nothing is ignored on its own and every
   ignore is restorable. The level guess no longer fires on a suggested line.
   Confirmed bills show no suggestion (nothing left to ignore). The DoD on a
   fresh bill is the first-session script's 1.5 check, being turned on. **FIXED 2026-09-20, `26ea895`** (Stage 1b item 1.7): "opened" is
   recorded nowhere (the GET writes nothing), so there are two derivable states
   and a count — `29 to review` while proposals are pending, `Review complete`
   when none are — and the count wins over the status everywhere the pack
   reads it; the pending count is a SQL count over the staged JSON's three
   named shapes, never the blob. Driven on the sandbox AP364e pack. **FIXED 2026-09-20, `38e6f65`** (Stage 1b item 1.6): one summary line
   per pack — "11 documents · 2 reviewed · 9 waiting for you" — with the
   detail on the document's own row, and one primary on the screen. Driven on
   the sandbox AP364e pack.

One thing that looked like a defect and is not: **"These pages do not agree"**
fired because two pages state the same dimension in different units. Sebastian
asked whether it could divide by ten; Max explained the drawings state no unit
anywhere, so the app reasons about the range and flags every row it touched.
Matthew accepted it. That is the unit-resolution rule working, in front of a
user, and it should be left alone. (26:23)

And one that is a gap rather than a fault: **Product code has nowhere to be
recorded**, said out loud by Max to the person who wrote the requirement —
*"I haven't included this in the app yet, so there's nowhere to record that."*
It is already its own entry below. What changed is that Matthew has now seen
it. (48:59)

### A level cannot be set or changed at the drawings stage

**FIXED 2026-09-20, `941573d`** (Stage 1b item 1.15): a LEVEL panel on the
item card and the configuration card — the suggestion and its reason as a
`SuggestButton`, "Change…" opening three BUTTONS (never a pre-filled select),
one `level_set` change set per click through the existing levels route
(which now also takes `recordIds` + `level`), "sets the level on 3 records"
for a fan-out, and the confirm request untouched. Driven on the sandbox
S-100 card, where the level is already decided on 3 of 3 and the panel says
so. The level GUESS rules are still this repo's judgement and Matthew has not
seen them.

**Status: open. A CHANGE ASKED FOR, and its first half is still to be
confirmed by Max** — "I'm going to check up on this, but I'm pretty sure".

Seen on the BOQ review screen (screenshot), `MAIN RUN`, 14 lines. Every row
reads **Simple · guessed**, including `PACK · Packaging` and `DEL · Delivery`,
which are not furniture at all. The descriptions the guess had to work with are
`Sofa`, `Armchair`, `Desk chair`, `Headboard` — one or two words each.

Two separate things were said, and they are not the same size:

1. **Probably the level can only really be determined at the drawing stage.**
   Max's own reading, offered as something he will go and check. If it holds,
   it questions whether guessing at BOQ intake is worth doing at all.
2. **At minimum, there must be a way to switch it AT the drawings intake
   stage.** Asked for outright, and not conditional on (1).

**(2) is a plain gap today.** `confirm-drawings.ts:689` revises the level after
a drawings confirm — but only `level_suggested`, only where `level is null`,
and `guessLevelFromAttributes` never returns `simple`, because "this page named
no metal" is not evidence the item has none. So a drawing can strengthen a
suggestion and can never be used by a person to SET one: the drawings review
screen carries no level control at all. The only places a level can be set are
the record screen, the drafts blocker's inline picker, and the BOQ review's own
Level column.

That means today a level decided at the moment it is actually knowable — the
reviewer has the page open and can see the brass leg — has to be recorded
somewhere else, one record at a time.

Three things a plan has to carry, all already written down elsewhere:

- **The level guess rules are this repo's judgement and Matthew has not seen
  them.** Nothing in the 17 cheat sheets defines simple / complex / hero;
  `src/lib/level-guess.ts` encodes the BWS boilerplate split. (1) is the same
  conversation and the same person — put it in front of him together.
- **Nothing infers a level onto `spec_records.level`, ever.** 0025 keeps the
  guess in `level_suggested` where no gate can read it. Whatever goes on the
  drawings screen writes `level` only on a person's action, and the run-wide
  `acceptSuggestedLevels` is the precedent for doing that in one change set
  rather than 59 visits.
- **A pre-filled select cannot be the accept control.** The screenshot shows
  every row's select already reading `Simple`, so choosing Simple fires no
  change event and the one action recording the reviewer's agreement does
  nothing. Whatever is built for drawings must not repeat it.

### A confidently routed email still waits for somebody to press Assign

**Status: open. This one is a CHANGE ASKED FOR, not a fault** — the app is
behaving as designed and the design is what is being changed. Read the whole
entry before planning it: it moves one of the hard approval gates.

Seen on the Inbox screen (screenshot), `Not on a project (17)`. Asked for at
the same time, and stated as project-wide: **whenever a document is uploaded it
should be read and assigned automatically, and only genuine doubt should be
flagged for a person.**

What the screen shows is that routing had already decided, and nothing acted on
it. `Ashcombe House — OT-401 bed end ottoman, fabric` reads *addressed to the
project inbox — addressed to ashcombe.specs@example.com*, which is
`recipient_is_inbox`, the second-strongest signal there is. It sits in the
unassigned list with a dropdown offering *Assign and read (one charged call)*.
Several others read *the sender is a contact on one project*. Two of the
seventeen — `FW: client comments - armchairs`, `Statement of account — August` —
correctly say nothing names a project.

**Most of the asked-for rule is already true, and the exception is email.**
Specification documents uploaded through intake have been read automatically
since 2026-09-15: registration opens an attempt per document, and the human
decision moved to the upload screen, which states the document count and the
charge before anything uploads. So "uploaded means read" is the existing
behaviour everywhere except the inbox.

**What stands in the way is a stated gate, not a missing feature.** `CLAUDE.md`
lists under *Hard approval gates*: *"Placing an INBOUND email on a project. It
is what starts the charged read, and nothing is ever auto-assigned from an
ambiguous routing outcome."* Changing it is Max's call and he has now asked for
it — but it is a deliberate amendment to that list, in the same commit as the
code, not something to slip in as a bug fix.

**The flag path the request asks for already exists.** `email-routing.ts`
returns three outcomes, not two: `assigned` (one project, with the signal and
the evidence that decided it), `ambiguous` (two projects match equally well)
and `unassigned` (nothing names a project). The asked-for rule maps onto them
exactly — act on `assigned`, hold the other two — so nothing about routing has
to become cleverer, and `assignMessage` staying the ONLY thing that puts a
message on a project should survive the change rather than be worked around.

Four things a plan has to settle rather than assume:

- **Assignment is the spend point.** Auto-assigning means auto-charging. The
  precedent from 2026-09-15 is that consent moved UP to where the volume is
  visible and was stated in numbers; the inbox equivalent of that statement
  does not exist yet.
- **Nothing limits how many model calls start at once** — already recorded as
  an M8 outstanding note for packs. A morning's mail arriving at once is the
  same problem with no upload step to stagger it. **The cap landed 2026-09-21
  (`fb03d07`, Stage 2 item 2.10.f): three reads per pack, and a per-project
  cap of the same size for emails, which have no pack.** The remaining
  prerequisite for auto-assignment is Max's amendment of the gate in
  `CLAUDE.md`.
- **A wrong auto-assignment costs twice** — the call, and a staged run on the
  wrong project. `unassignMessage` exists and the mailbox copy is kept as the
  arrival record, so it is reversible; whether the reviewer can tell it happened
  is the open half.
- **How confident is confident.** Whether `sender_is_contact` — the weakest
  signal, and the one behind most of the seventeen — is strong enough to spend
  money on its own is the actual judgement in this change.

### The item picture does not line up with the card beside it

**Status: FIXED, 2026-09-18**, by the record screen's rebuild against
`#record-screen`. The picture is no longer a track
beside `RecordDetails`; it HEADS its own sticky column on the Specs tab, and
the left column now starts with a `Card`. Both columns therefore begin with a
box at the same top edge, which is what `items-start` needed and did not have.
The 3D view sitting off-centre in its own crop is untouched, as the entry says
it should be.

Seen on the record screen (screenshot),
`DEMO-TEST-01-006 · Armchair, lounge @ suite living area`.

The picture panel's top edge sits **higher than everything in the left column**
— above the details card AND above the `THIS ITEM` heading itself — so the two
columns of the grid visibly do not start on the same line. The `Edit` button,
which is on the card, ends up level with the middle of the picture rather than
with anything in the picture's own box.

**This is not the float bug coming back**, and whoever picks it up should not
start by re-doing that fix. The picture was `float-right` and landed clipped
across the top of the details card; it was made a real sticky grid column
earlier the SAME DAY (2026-09-18, the long comment above the grid in
`src/app/dashboard/records/[id]/page.tsx:606`). The grid already carries
`items-start`. What is left is that the left column's own top — the `THIS ITEM`
label inside `RecordDetails` — is not where the right column's box top is, so
`items-start` aligns two things that do not begin at the same place.

**It is the COLUMN, confirmed by Max on the day.** Asked whether he meant the
column or the crop, the answer was the column. The 3D view also sits off-centre
in its box with a sliver of the neighbouring view down the left edge — that is
a confirmed crop being what it is, it is NOT what was reported here, and
changing it is not part of this.

### A gate's count folds "nowhere to record it" into "outstanding"

**Status: FIXED, 2026-09-18**, by the record screen's Gates tab rebuilt against
`#record-gates`. A gate in play now shows up to TWO chips — `n to answer` in
red and `n nowhere to record` in dashed slate — and they are never added
together. The board's Chase button counts only the first, because chasing
somebody about a field this app has nowhere to store is asking them to fix our
migration. `src/lib/gates.ts` was not touched: `unanswerable` still counts
against the gate, which was never the fault. Checked against the record the
entry names — it reads `1 to answer` and `1 nowhere to record`, and the list
under it is Spec notes and Product code.

Seen on a record screen (screenshot), Armchair, lounge @ suite
living area — `Uph · Armchairs Benches Stools Sofas`, level Simple.

The pill reads **`TGQ 2 outstanding`**. Reading the list underneath it, exactly
one row is work anybody can do:

| Row | Badge |
|---|---|
| Product code | Nowhere to record it |
| Spec notes | Outstanding |
| Swivel mechanism | N/A |
| the other nine TGQ rows | Settled |

So the 2 is **Spec notes + Product code**, and a reviewer looking for two
questions to answer finds one.

**N/A is NOT the cause**, and this is worth stating because it was the first
suspicion. `outstanding()` in `src/components/records/GatePanel.tsx` is
`counts.blocking + counts.unknown + counts.unanswerable` — `not_applicable` is
already excluded, and Swivel mechanism is correctly contributing nothing.

What is happening is that `unanswerable` — *the app has nowhere to record this,
the fix is a seed or a migration and no reviewer can help* — is counted in the
same number as `blocking`, under the same word. The panel ALREADY breaks that
split out in words, but **only for a predecessor gate**: the "TG0 · TGQ first"
line renders "n to answer" beside "n nowhere to record" (`GatePanel.tsx`, the
comment at the `c.unanswerable > 0` branch). The gate whose turn it actually is
gets the folded number.

`src/lib/gates.ts` is not wrong here and should not be the first place anybody
looks: `unanswerable` counting against a gate is deliberate and documented —
folding it into `satisfied` would pass a gate over fields nobody can record.
The question is what the COUNT ON THE PILL says, not whether the gate is met.

Related and not the same thing: `Product code` is `unanswerable` on all 179
sandbox records that have a matrix view, so this reads on nearly every record,
not just this one.

### There is nowhere to record Product code

**Status: open.** The same screenshot, first row of TGQ: *"On Matthew's matrix
with no BWS field and no home in this app yet."*

One of the ten id-less rows in Matthew's matrix of 2026-09-17. Because the gates
chain, a TGQ nobody can satisfy means **no record in the sandbox can reach TG0
or TG1** — measured 2026-09-18, all 179 records with a matrix view. Every gate
tick in the sandbox is gone, correctly.

Asked for directly on 2026-09-18: **build the Product code field in the app.**

**2026-09-19, and this is now the live disagreement.** Max, answering for
Matthew: *"I'm pretty sure that is the code on the client's spec document, on
the BOQ document that they give."* **The seed says otherwise, in Matthew's own
words** — `db/seed/0006_spec_field_gates.sql` row 1 is `capture = 'auto'` with
his note *"Boilerplate derived automatically: if MF1 or MF2 is populated ->
with-Metalwork variant; otherwise Simple"*. If Max's reading is taken, every
record satisfies the row from `spec_record_refs.boq_code` while the BWS product
code stays underivable — a gate reporting satisfied on a different fact from
the one it names. **Do not build either reading until Matthew has been shown his
own note.**

Two things a later plan has to settle rather than assume, both already written
down elsewhere:

- Matthew's own matrix says the product code is *"derived automatically: if MF1
  or MF2 is populated"* — the with-Metalwork / Simple pair — which is why
  `spec_field_gates` carries no palette key for it. Whether it is a field
  somebody answers, or a derivation off `bws_boilerplates` (0031) that the gate
  reads, is the actual decision.
- `src/lib/quote-lines.ts` already derives a boilerplate and **deliberately
  derives nothing when the code is ambiguous** — our
  `armchairs-benches-stools-sofas` is one sheet receiving three of Matthew's
  nine codes. Whatever records a product code has to behave the same way there.

Do NOT close this by weakening the gate chain to get the ticks back.
