# Make it work — the stabilisation plan after the catchup of 2026-09-18

**Written 2026-09-19.** The plan for turning what the catchup exposed into an
app the company can use. It takes `docs/plans/catchup-2026-09-18.md` §6 as its
skeleton, folds in every open entry of `docs/plans/found-in-use.md`, and adds
the two things the catchup document did not set out to carry: **how each change
is proven to have landed**, and **how the app is made to survive input it was
not demonstrated on**.

Read the catchup document first. This file does not restate what was said or
why; it says what gets built, in what order, by whom, and how we know it works.
Where a section number is cited bare (§3.22, §4.10) it is the catchup document's.
Where an item is cited as `FIU n` it is finding *n* of the 2026-09-18 entry in
`found-in-use.md`.

| | |
|---|---|
| Governs | D5 — *stop adding features; make what exists work* |
| Milestone | M8 is unchanged. Step 4 (a human calls the export flawless) is still what done means |
| Horizon | Stage 0 → Stage 2. Stage 3 waits on answers. A first production version is **after** all of it and is sketched in §9 only so it is not forgotten |
| Constraint | Claude usage headroom is real (§1 of the catchup). Every stage is ordered so that stopping early leaves something whole |

---

## The plan on one page

For the reader who needs the order and not the argument. Everything below
this box is the reasoning; nothing below it changes this order.

| Stage | What | Done when |
|---|---|---|
| **0 — unblock** | BWS account for Max · Matthew's first project named · the 7 red db tests fixed · the db tier proven to run · the pilot environment | suite green with the db tier on; pilot answers `/api/auth/me` with its own name |
| **1a — before the hand-over** | rename run → phase · header-row message · hide the ordinal · explain the two counts · a route from intake to each line to what is missing · the phase table shows *what* is missing · **the correction verb** · chase preselects TGQ · `TBC –` becomes a state · pilot | the first-session script runs clean on pilot; Matthew has the link. **Then stop and wait for his screenshots** |
| **1b — first promotion after** | non-furniture lines suggested · pack summary line · pack review states · picture crop measured then fixed · swatch reaches page 2 · level set on the drawing | same script; promoted to pilot deliberately, once |
| **2 — while he uses it** | infill screen for meetings · area filter · chase EMAIL by question × area · dimension qualifier · outstanding-by-question · project-wide questions folded, then answered once · palettes (when the account exists) · tiles proposal · the variance matrix, row by row · the rate cap · auto-assign (gate amendment) | each item meets §7.1 on the deployed SHA; §7.5 review for the design-first ones |
| **3 — needs an answer** | versioning · substrate · product code · export (Tim's contract) · public pictures · finishes-schedule read · SharePoint · TOE · level grey-out | not started until the named person has answered |
| **After** | the first production version | planned then, not now |

**Rules that hold throughout:** every item traces to a source line (§0.1); as
simple as possible and as complex as necessary (§0.2); Fable orchestrates and
Opus writes, two coders at once (§2); nothing is done until it is proven on the
deployed build and written down (§7.1); every screen is checked visually at
monitor size and with 300 lines before Max sees it, so his review is "does it
feel right" and never "the table is compressed" (§7.4a); real documents come
off SharePoint, read-only and read once, into sandbox `TEST` projects that are
named for what they exercised and left for demos, while the repo's fixtures
stay synthetic (§2.7); Matthew's findings become log entries, not fixes
(§7.7).

**Effort, honestly.** Stage 1a is about eight coder-sessions and 1b about six,
at two coders in parallel, so roughly a week of orchestration each if Claude
usage headroom allows two coders every day — which it has not always. Stage 2
is larger than 1a and 1b together and is deliberately not estimated as a
whole: it is built one item at a time, in the order Matthew's first session
makes right.

---

## 0. The thesis, and what "works" means here

The catchup showed an app that demonstrates well and could not be driven by
the person it is for. Matthew could not find the route into reviewing a line
(§3.19), could not find the control that corrects a confirmed value (§3.22),
read two counts that disagreed by one (§3.21), and watched a picture crop fail
(§3.11) — none of which any of the 1,223 automated tests could see. Max's own
reading, 2026-09-19: *"at the moment we're focusing a lot on 'it works
flawlessly when it comes in this one document' … we need to broaden our
horizons a little and think past the demo document."*

So "works" is defined here as four properties, and **every work item in this
plan has to state how it satisfies each one before it is called done**:

1. **It does the thing.** The behaviour is what the request describes, and a
   test at the right tier holds it.
2. **It survives the input it was not demonstrated on.** The item names at
   least one *variance case* — a document, email or record in a shape the demo
   did not use — and says what the app does with it: proceeds, flags, or
   refuses with a sentence. Silently producing a plausible wrong answer is the
   one outcome that is never acceptable (house §5).
3. **A person can find it.** Somebody who is not Max, starting from the
   projects list, reaches the control in the number of clicks the item
   states, without being told where it is. Max, 2026-09-19: *"if the user can
   think of the next step, they can just instantly find a button and move
   on."* So the test is not that a route exists but that **the layout is the
   workflow**: the next step is the screen's primary action, in the place the
   design language puts a primary action, and a sentence of guidance at the
   foot of a page does not satisfy it. §0.3.
4. **It is proven on the deployed build, not in the working tree.** Verified
   in a browser against the staging SHA, with the failure path exercised,
   and the result written down in the six terms of `house/deployment.md`.

That is the **definition of done** (§7.1) and it is deliberately heavier than
"the four checks pass". The four checks were green through every defect the
demo exposed.

### 0.1 Plan drift, and the rule against it

Max, 2026-09-19, while this was being written: *"watch out for plan drift."*
A plan of this length invites it: an item that sounds adjacent gets added, a
design decision grows a second feature, a variance row becomes a product.

So every item in this plan carries a **source line** — a § of the catchup
document, an `FIU n`, a named line of `found-in-use.md`, or one of the four
things Max asked for in the brief that produced this file (proving changes
landed; robustness beyond the demo document; the editing model; Fable as
orchestrator only). **An item with no source line is not briefed.** When a
coder or Fable finds something that looks worth doing and has no source, it
goes into `found-in-use.md` as an observation and waits for the next stage
close, where it is either given a source or left.

Three places this plan itself was trimmed to hold the rule:

- §9 (production) is a pointer, not a plan. Max: *"we'll leave it for now."*
- Stage 3's tail (3.10–3.13) comes from `CLAUDE.md`'s own open list, not the
  meeting, and is labelled so.
- The variance matrix (§6.10) is the one place scope is *meant* to grow, and
  it grows one row at a time, each row briefed alone, in the order Matthew's
  first project makes likely.

At each stage close (§7.6) the first check is this one: re-read the stage
table against the catchup's §6 and this section, and strike anything that
crept in without a source.

### 0.2 As simple as possible, and as complex as necessary

Max, 2026-09-19: *"This is inherently a complex app. There's no getting around
that. But let's try and make it as simple as possible."*

The app's complexity is real and most of it is load-bearing: the gate chain,
the single composer, the change sets, the unit-resolution order each exist
because a simpler version produced a confident wrong answer, and `CLAUDE.md`
names the trap beside each. That is *necessary* complexity, and this plan
does not touch it. What the rule is for is everything else — the second
screen where one would do, the new table where a column would do, the third
state where two are derivable, the new tool where an existing one could be
extended.

So the test, applied to every item before it is briefed and written into the
brief (§2.2):

> **Name the simplest version that meets the definition of done. Build that,
> unless you can name the trap it falls into.** A trap is a concrete wrong
> answer somebody would act on — not "it might be nice to", not "we will
> probably need". If the trap cannot be named, the simpler version is the
> right one.

Where this pass applied it to the plan itself:

- **1.7** has two derivable review states, not three, because "opened" is
  recorded nowhere and a third state would be invented.
- **1.11** is one function deciding the next step, rendered as each screen's
  **primary action** — not four screens each deciding what comes next, and
  not a line of text (§0.3).
- **1.16** is the smallest environment that satisfies "stable, with its own
  data": one new Vercel project, one new Neon project, one new `APP_ENV`
  value. Nothing else about the model changes.
- **2.3** works without opening a change; opening one is offered, not
  required. A screen that demands ceremony before the first edit is a screen
  people stop opening.
- **2.8** builds the fold first and the answer-once fan-out **only if Matthew
  asks again** after seeing the fold.
- **7.3** extends the three measurement tools that exist and adds one, rather
  than adding three.
- **7.4** runs on a copy of a staged pack and never calls the model, so the
  release gate costs nothing to run twice.
- **§9** is a pointer.

And where complexity stays, named: the correction verb (1.13) is a
supersession and not an in-place edit, because an in-place edit leaves a row
citing a page that does not say what the row says; the infill and chase
screens are two screens sharing one loader, because a tick box and an edit box
on the same row is a screen that does not know what it is for; the two chase
counts (1.4) stay two numbers, because making them agree would mean chasing
somebody about a field only we can fill in.

### 0.3 The layout is the workflow

Max, 2026-09-19: *"someone who didn't design the app needs to be able to use
it … it shouldn't be a case of just writing a piece of text somewhere at the
bottom of the page. It should be intuitive. The button layout should match the
workflow — you're on one page, you go to the next page, or there's an option,
and if the user can think of the next step, they can just instantly find a
button and move on."*

This is what §3.19 and §3.22 were: the app could do both things and the
controls were not where the work was. Four rules follow, and every item that
touches a screen is judged against them in review (§2.3):

- **Each screen has one primary action, and it is the next step in the
  workflow.** `docs/design-language.md` already allows one `primary` button
  per group; this makes it *mean* something — the primary is what a person
  does next, decided by the same function everywhere (1.11). A screen whose
  primary action is not its next step has its layout wrong, whatever else it
  says.
- **A control lives beside the thing it acts on.** Correct lives beside the
  value (1.13), the level control beside the level (1.15), the swatch beside
  the finish (1.10), the missing fields inside the row that is missing them
  (1.12). Never on a separate page a person has to know exists.
- **Guidance text is a last resort, and never a substitute.** A sentence that
  explains where the button is means the button is in the wrong place. Where
  the plan says a screen "says in words" (1.4, 1.7), it is explaining a
  *number* or a *state*, not a route.
- **The order of screens is the order of the work.** Upload → bill review →
  pack → drawings review → phase table → record → chase. Each screen's
  primary action lands on the next one in that list, and its header carries
  the way back. A person should never need the browser's back button to
  continue.

The test for a screen, in review: hand it to the verifier agent (or to Max)
with the task named and no route given — *"correct the width on the sofa"* —
and count the clicks and the hesitations. The item's DoD states the click
count; the hesitations are the finding.

### The two roles

The primary user is no longer one person. The PM loads and reviews; the CAM
fills in what they remember; the client answers what is left (§3.24). Each
work item below says which role hits it. A screen optimised for one person
working alone is optimised for the wrong thing, and the infill screen (§4.5)
exists because a chase need not leave the building.

---

## 1. Where the app actually is — the baseline

Measured 2026-09-19, so the plan starts from a number rather than an
impression. Re-measure at each stage close (§7.6).

| | Measured |
|---|---|
| Commits | 172 on `staging`, 8 days, 60 of them on 2026-09-18 alone |
| Tests | pure 50 files / 814 cases · component 20 / 138 · db 25 / 271 · manual 1 |
| Screens | 11 dashboard pages, 60 API routes, 24,176 lines in `src/lib` |
| Largest surfaces | `drawing-document.ts` 2,438 lines; project page 1,910; record page 1,128; `imports/[id]` review 943 |
| Known red | **Seven db-tier tests fail on the sandbox and predate the design-language work** (`chase-drafts` ×3, `intake-routes` ×3, `project-overview` ×1 — README, 2026-09-18). A red suite hides the next red |
| Human acceptance | **None.** Every "verified" line in `CLAUDE.md` means verified by the agent that built it |
| Edit paths | `POST /api/attributes` (type a spec, no page), `PATCH /api/attributes/[id]` (retire / restore, reason required), `PATCH /api/answers/[id]` (checklist answer). **There is no path that changes a confirmed attribute's VALUE.** A misread dimension is retire-with-reason plus add-by-hand, and the hand-typed replacement carries no page (§4) |

The last row is the finding the plan is built around. §3.22 was not a
navigation problem only; the verb Matthew went looking for does not exist.

> **Baseline run, 2026-09-19.** `npm run typecheck`, `npm run lint` and the
> full suite with the db tier enabled were run while this file was written;
> the result is recorded in §1.1 below. Whatever it says is the starting line.

### 1.1 The measured baseline

Run 2026-09-19 at `d0c0036`, working tree, with `.env.local` loaded so the
db tier ran against the sandbox:

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 2 warnings (both in the `meeting-recap` skill's transcript harvester, not app code) |
| `npm test` (db tier ON) | **7 failed · 1,235 passed · 1 skipped**, 64s |

The seven, by name, so 0.3 starts from the list and not from a re-run:

| File | Test | Symptom |
|---|---|---|
| `tests/db/chase-drafts.test.ts` | *refuses to chase a record with no level, and writes nothing* (+2 siblings) | generate returned **201 where 409** was expected — the TGQ-matrix change of 2026-09-18 made a level unnecessary for a matrix-covered category, and the test predates it. **The code may be right and the test stale**; read `tgq.ts`'s `questionTierOrNull` before touching either |
| `tests/db/intake-routes.test.ts` | *keeps a corrected figure in its slot instead of re-guessing it away* | `width` undefined — the observation shape changed with `schemaVersion: 2` |
| `tests/db/intake-routes.test.ts` | *confirms two pages of one code onto configurations A and B* | 409 where 200 expected — the configuration split now needs the model's `configurations` answer, which the fixture does not carry |
| `tests/db/intake-routes.test.ts` | *refuses to split a record that already carries confirmed specs* | refuses correctly but with the **occupancy** message, not the *already carries* one — two guards fire and the wrong one speaks first |
| `tests/db/project-overview.test.ts` | *hides an archived project from the list unless it is asked for* | 5s timeout — a slow query or a lock, not a logic failure; measure before rewriting |

Every one of these is in the area Stage 1 lands on (chase defaults, the
drawings confirm, the projects list). Landing on a red suite is how the next
regression goes unnoticed, which is why 0.3 is Stage 0 and not a tidy-up.

**Re-measured 2026-09-19 after 0.3 (`a96e44f`):** `npm test` with the db
tier on — **1,243 passed · 1 skipped · 0 failed**. The one skipped is the
manual model-verification test, gated on `VERIFY_MODEL=1` because it spends
money. No application code changed to get there; the Stage 0 brief at the end
of this file says what each of the eight was.

**Re-measured at Stage 0 close (`ded4dcf`, evening of 2026-09-19):**
`npm run checks` — lint 0 errors, typecheck clean, **1,262 passed · 1 skipped
· 0 failed** with the db tier required, build clean. The 19 new tests are
0.4's guard and 0.5's environment and chip tests. Between the two
measurements the sandbox hit Neon's 512 MB ceiling and Max raised the plan;
the audit log's growth is item 0.7.

---

## 2. How the work is run

Max works in Fable **as the orchestrator only**. Code is written by Opus
subagents, one per work item, each in its own worktree. This section is the
contract between the two, and it is written down because the alternative —
Fable fixing "this little thing, this little thing" itself — is what produced
sixty commits in a day with no acceptance behind any of them.

### 2.1 Roles

| Who | Does | Never does |
|---|---|---|
| **Fable** (orchestrator) | Reads the request against this plan; writes the brief (§2.2); reviews the diff against the DoD; runs the four checks; drives or delegates the browser verification; owns `CLAUDE.md`/`AGENTS.md`, `docs/plans/README.md` and `found-in-use.md`; is the one agent that pushes | Writes application code except a one-line fix found during verification, and says so in the commit |
| **Opus coder** (one per item) | Implements one work item in a worktree from a brief; writes the tests the brief names; runs the checks in the worktree; reports in the six terms | Touches `CLAUDE.md`/`AGENTS.md`; runs `db:migrate` against the sandbox; pushes; widens scope |
| **Opus verifier** (optional, per stage) | Drives the walkthrough script (§7.4) against staging; files anything found as a `found-in-use.md` entry, not a fix | Fixes what it finds |
| **The migration owner** | Exactly one agent per stage owns `db:migrate` and the sandbox (`house/writing-docs.md`). Named in the stage table | — |

**Concurrency: two coders at once, at most.** `house/writing-docs.md`: *"two
agents works. Three does not, and would likely be slower than two."* The
memory that other sessions commit into the same checkout stands: coders work in
worktrees, Fable stages by path, nobody amends.

### 2.2 The brief

Every coder gets a brief with these headings and nothing else. The brief is
the unit of accountability, and a brief missing a heading is not sent.

1. **The item** — its number here, the §/FIU it answers, one sentence of intent.
2. **Read first** — the load-bearing `CLAUDE.md` section(s) and files named
   in the item. Every item below lists them.
3. **What to build** — the item's design decision, taken already, in §3–§6.
   The coder does not re-open it; if it is wrong they say so and stop.
4. **The simplest version, and the trap it would fall into** — §0.2. If the
   brief cannot name the trap, the brief describes the simplest version and
   nothing more.
5. **The variance cases** — the inputs it must survive, and what it does with
   each.
6. **The tests** — tier, file, and what each asserts. Named in the item.
7. **The DoD** — §7.1, plus the item's own click count and observable.
8. **What not to touch** — usually `CLAUDE.md`, migrations, the export.

### 2.3 The review

Fable reviews every diff against three questions before the checks are even
run, because the checks cannot answer them:

- **Does it do what the item says, and nothing else?** Scope creep is how a
  rename becomes a refactor.
- **Would Matthew find it?** Walk from the projects list. Count the clicks.
- **What does it do with the variance cases?** Read the code path for each.
  A case the code does not mention is a case it handles by accident.

Then the four checks, then the browser (§7.4), then the report.

### 2.4 Design before code, for the items that need it

Four items in this plan are architecture rather than fixes — the correction
verb (3.6), the infill screen (4.5), the chase-email regrouping (4.4) and the
editing model as a whole (§5). For each, the design is written into this file
**first**, reviewed by Max, and only then briefed. The user's instruction: *"what
are we trying to do? How are we going to achieve it? Okay, let's do it in this
way. And then review: does it make sense?"* The review after building is
§7.5.

### 2.5 Why there is no plan per stage — decided 2026-09-19

Max asked whether each stage should have an agent produce its own plan and
then implement it, given how much is here. **No**, for three reasons, and the
third is the one that decides it.

- **A plan written by the agent that implements it is the agent agreeing with
  itself.** The check this plan builds in (§2.3, §7.1) works because the
  brief is written by one party and the work judged by another. Collapsing
  them removes the only review that does not depend on a test.
- **Two plans for one thing drift apart**, and this repo has already paid for
  that once: `matrix-assumptions.md` recorded the costing sheet as blocked on
  pricing, the skill it cited generated no price, and the wrong blocker stood
  for days because two documents described one task.
- **The unit that needs planning is the item, not the stage**, and the item's
  plan is its brief (§2.2), which this file already carries in outline for
  every item. A stage is a *schedule* of items, and scheduling is Fable's job,
  not a document's.

What replaces a per-stage plan is a **stage brief**, one page, appended to this
file at the start of each stage by Fable: the items in the order they will be
briefed, which coder holds which workstream, which files each may touch (so
two coders never meet in one file — Workstream B and C both want the
drawings card, and the stage brief says who has it when), which migrations are
in the stage and who owns `db:migrate`, and what the stage's close looks like.
Nothing in it re-decides an item.

The one exception is the four **design-first** items (§2.4). For each, Fable
writes the design into §5 or §6 of this file — the correction verb and the
infill screen are already there — Max reads it, and only then is it briefed.
A coder who finds the design wrong stops and says so rather than planning
around it.

### 2.6 What `CLAUDE.md` changes, per stage

`CLAUDE.md`/`AGENTS.md` belong to Fable alone. So the changes are listed here,
once, so no coder writes them and none is forgotten.

| Stage | Change |
|---|---|
| 1a | "run" → "phase" in the vocabulary, with the note that the table is still `spec_runs` and `runId` still the API word. The *primary user* line becomes the two roles (§0). The editing section gains the **correction** verb beside retire and type-by-hand, and the load-bearing paragraph on why it keeps the page |
| 1a | `docs/environments.md` gains the pilot column and the promotion checklist; `CLAUDE.md`'s Stack section names three environments |
| 1b | The level section records that a level can be set on the drawings card, on a click, one change set per phase |
| 2 | The chase section: the EMAIL is grouped by question × area and the SCREEN by item — the catchup's §5 already says the doc reads as though one answer covers both. The infill screen gets its own load-bearing section (§5.3's traps). The palettes section moves from "we have never had it" to the sync's date and the test that guards it |
| 2 | **The hard approval gate on inbound email** is amended by Max, in words, in the same commit as 2.11 — or 2.11 does not land |
| each | The *Current milestone* section: what shipped, what was verified, what is still not accepted. A stale status section is worse than none |
| 0 | The *Reference material* section records the SharePoint authorisation and the `TEST` project convention (§2.7) — done with this plan, 2026-09-19 |

### 2.7 Real data, and the projects left behind — authorised 2026-09-19

Max: *"You have access using the Microsoft connector to all of the files on
Ben Whistler, so you shouldn't be short of real data. I'm giving you
authorisation to go and fetch that without having to ask me. Whatever's on
SharePoint, you can use — to tune extraction or to populate the database."*
And: *"I'd quite like to see your work live in some projects. There's no issue
with you creating new projects and just leaving them there … name it with
what it was you were testing."*

This changes what the variance matrix (§6.10) is built from and what a QA run
leaves behind. Five things hold, and they are traps rather than preferences:

- **SharePoint is a READ.** The org rule is read-only for every company
  system, and the connector's SharePoint tools are search and fetch. Nothing
  is uploaded, moved, renamed or written back — a document is fetched to the
  session scratchpad, uploaded into the app, and the scratchpad copy is
  discarded.
- **Real client material still never enters the repo.** `CLAUDE.md`'s rule is
  unchanged: no fixture, no seed, no test file. The place real documents live
  is the **sandbox database and its blob store**, as staged runs inside test
  projects. `tests/fixtures/` stays synthetic, so a variance row has two
  halves: a real document staged in the sandbox that shows the shape exists,
  and a synthetic fixture in the repo that holds the rule. The real one is
  where the finding comes from; the synthetic one is what stops it coming
  back.
- **Reading a real document spends money.** Registration dispatches a charged
  model call per specification document (`CLAUDE.md`). A real pack is eleven
  to thirty calls, and Claude usage headroom is already a constraint. So a
  real pack is read **once**, for a named reason recorded on the project, and
  the staged runs are then reused: `__QA` copies for anything that confirms,
  `dump:drawings` and `measure:drawings` for anything that measures. Never
  re-read a pack to check a code change that does not touch the prompt or the
  tool schema — that is what versioning the staged shape is for.
- **Two prefixes, two fates.** `__QA ` projects are working copies and are
  swept by the cleanup scripts, as now. **`TEST` projects stay.** They are
  named for what they exercised and when — *`TEST: intake, 300-line bill
  (2026-09-24)`*, *`TEST: email review, three-phase fan-out (2026-09-25)`* —
  and the cleanup scripts must never match them. Max wants them to demo from, so
  a `TEST` project is left in a state worth showing: reviewed, not
  half-confirmed. Not every run leaves one; a run that found nothing new
  leaves a `__QA` copy to be swept. *"Obviously don't include excessive
  amounts."*
- **The Panther pilot stays curated.** M8 step 4 is still judged against the
  curated Panther folder, and *do not crawl the wider tree for Panther
  documents* still holds for the pilot. The authorisation is for the variance
  matrix and the test projects: other projects' bills, packs, schedules and
  emails, chosen because their shape is one the demo never used. Stage 0.2's
  answer — Matthew's first project — decides which shapes come first.

**Where to look first**, from what the repo already knows: the P17231 tree
(`docs/docs for building/P17231 SharePoint Index.md` maps it, with the
conflicting copies named — those conflicts are themselves a variance case);
the 300-line project Matthew mentioned (§3.2), once he names it; any project
folder carrying a *Finishes Schedule* (item E of the catchup's asks — the
document 3.6 needs to see before its schema is designed); and any saved
client correspondence, for the email rows of §6.10.c. NDA-covered material
stays in the UK region as everything in this app does; the sandbox is in
London and so is the blob store.

---

## 3. Stage 0 — unblock and stop the bleeding

Nothing here adds behaviour. It is what has to be true before Matthew's first
session and before any coder is briefed.

| # | Action | Owner | Blocked on |
|---|---|---|---|
| 0.1 | **A real BWS account for Max.** Blocks every palette task (§4.8) and blocked him live | Steve / Matthew | — |
| 0.2 | **Confirm which project Matthew starts on** and get its pack (the catchup's §7, item F). One or two new projects, not the 300-line one. **This also sets the order of the variance matrix** (§6.10) | Matthew / Max | — |
| 0.3 | **Fix the seven red db-tier tests.** They predate the design-language work and were left. A suite that is already red cannot report a new red, and Stage 1 lands on top of it. Read each against the TGQ-matrix change of 2026-09-18 (README) before assuming the test is wrong — the code may be | Fable → one Opus coder | sandbox |
| 0.4 | **Make the db tier's skip visible.** `npm test` is green with 283 skipped when `DATABASE_URL` is unset, and nothing says so. Add a `checks` script that runs all four, and a guard: when `REQUIRE_DB_TESTS=1` the db tier fails rather than skips. Every stage close runs `checks` with the guard on | Opus coder | — |
| 0.5 | **The pilot environment** — item 1.11 below, moved here because it gates handing over a link | Max + one Opus coder | Vercel + Neon access |
| 0.6 | **Send Matthew the link and a login** to the pilot build, with the one-paragraph "how to report" (screenshot + written explanation, §3.37) | Max | 0.5, Stage 1 |
| 0.7 | **Run the db tier against a throwaway Neon branch per run**, created before and deleted after, so test audit rows never land in the sandbox. Added 2026-09-19 after the sandbox hit its 512 MB ceiling on a week of test runs (`found-in-use.md`, option 3). The trap the extra moving part prevents is measured, not guessed: 50–140 MB of append-only audit JSON a day, on a table the cleanup must never touch. Belongs with `checks`; not started | Opus coder | 0.4 (landed) |

Stage 0 is done when: the suite is green with the db tier proven to have run,
the pilot build answers `/api/auth/me` with its own environment, and Matthew
has a login he has not yet used.

---

## 4. Stage 1 — make the first session survivable

The test for inclusion is the catchup's: *would Matthew hit this in his first
session?* Every item here was hit in the demo. They are grouped into
workstreams so that two coders can hold two streams without touching the same
files.

**Stage 1 is split in two, because sixteen items before a hand-over is a
hand-over that keeps slipping.** D4 wants Matthew using it; every week he is
not is a week of findings we do not have. So the split is walls versus
friction: a *wall* is something that stops him or corrupts what he records; a
*friction* is something he would screenshot and carry on past.

| | Items | Why here |
|---|---|---|
| **1a — before the hand-over** | 1.1, 1.2, 1.3, 1.4, 1.8, 1.11, 1.12, 1.13, 1.14, 1.16 | 1.11 and 1.13 are the two walls the demo exposed. 1.14 is the 199-question draft he would send. 1.8 puts TBC *into a value that reaches the export*, which is corruption not friction. 1.16 is the prerequisite. 1.1–1.4 and 1.12 are cheap and he asked for them by name |
| **1b — first promotion after** | 1.5, 1.6, 1.7, 1.9, 1.10, 1.15 | Each is friction he can work around: ignore a line by hand, scroll past banners, draw the crop box, crop the swatch from the record. 1.9 needs a measurement first and may need a re-read, which should not gate the hand-over |

1b is promoted to pilot **once**, deliberately, after the script runs clean —
not item by item, or the pilot stops being the stable build Tony asked for.

Each item states: what was seen · what to build · files · variance cases ·
tests · DoD observable. Sizes are S (an hour's brief), M (a session), L (more
than one session and a design note first).

### Workstream A — vocabulary and messages (one coder, one pass)

#### 1.1 Rename "run" to "phase" on every screen and in every document — D1, §4.1 · **M**

**Seen:** *"Can we change run to phase? Because that matches BWS."*

**Build:** one pass, one commit, never gradual — a half-renamed vocabulary
reads as two concepts. Scope, decided here:

- **Changes:** every user-facing string in `src/components` and `src/app`
  (29 files carry the word); tab labels; the `AddRun` component's text; the
  export's own sheet headings where they say run; `docs/*.md`,
  `docs/plans/*.md` where they describe the screen (113 lines carry the word
  — mechanical, but read each: some describe the TABLE, which keeps its name);
  `CLAUDE.md`/`AGENTS.md` vocabulary — **Fable does this half**, because those
  two files belong to one agent.
- **Does not change:** `spec_runs`, `run_id`, `runId` in API paths and query
  parameters, function names, `intake_runs`. Renaming an API contract has no
  user benefit and every link written before today points at `?tab=<runId>`.
  The staged shape's `proposedRunName` stays.
- **Grey zone:** `intake_runs` are *document reads*, not phases. Where a
  screen says "run" meaning a document read (the pack screen's "this run
  failed"), the right word is not phase either — it is "read" or "document".
  The coder lists each such string and Fable rules on them in review.

**Variance:** none — this is text. **Robustness:** a lexical guard test in the
pure tier greps user-facing string literals in `src/components` and `src/app`
for `\bRun\b|\bruns\b` outside identifiers, with an allowlist for the grey-zone
strings ruled above. It is the `tone.test.ts` pattern: a rule the compiler
cannot hold, held by a test that reads source.

**Files:** every `.tsx` under `src/components`, `src/app/dashboard`;
`src/lib/intake-status.ts`; `docs/`; `CLAUDE.md`/`AGENTS.md` (Fable).

**DoD:** zero hits from the guard; a walk of every dashboard screen in the
browser reads "phase" everywhere a sub-quote is named; `?tab=<runId>` links
from before still open the right tab.

#### 1.2 The header-row message names the wrong row — §3.4, FIU 1 · **S**

**Seen:** *"row 6 was skipped, header found on row 6"*; products start at 7.

**Build:** `boq-import.ts:341` returns `headerRow` (1-based) and
`skippedRows`. The review at `imports/[id]/page.tsx:620` prints both under
"Header found on". Reword to what a person wants to know: *"Header on row 6.
Items start on row 7. 5 rows above the header were read as the phase's notes
(revision, date, terms)."* Rows above the header are not "skipped" — 0007 reads
them for revision and date, and the message should say that is what happened to
them.

**Variance cases:** (a) header on row 1 — "nothing above it"; (b) a sheet with
blank rows between header and first item — the count of items should not
include them, and the message should not claim items start on the row after the
header if it is blank; check `parseBoqSheets` for how it treats the gap; (c)
the header not found — the existing refusal (`boq-import.ts:283`) stays and
names the columns it looked for.

**Tests:** pure, `tests/lib/boq-import.test.ts` — three fixtures for the three
cases, asserting the message text.

**DoD:** the sentence on the BOQ review for the Panther bill names row 6 and
row 7 correctly.

#### 1.3 Hide the internal field ordinal — §3.17, FIU 9 · **S**

**Seen:** `1 · COM 1`, `3 ·`. Ninety seconds and a wrong guess.

**Build:** `RecordChecklist.tsx:478` prints `BWS {json_id} · {field_name}`;
`AddSpec.tsx:207` prints `{name} ({json_id})`; `GatePanel.tsx:393` prints the
id in a column. The id is real and useful to *us* — it is the export's key —
so it moves into a `Tip` on hover or a `title` attribute, never inline. The
BWS field NAME stays, because that is the word BWS shows him.

**Variance:** a field with no `json_id` (a readiness question, local key) —
already renders "—" in the gate board; make sure the checklist prints nothing
rather than "BWS null".

**Tests:** component, `tests/components/record-checklist.test.tsx` — asserts
the visible text of a row does not contain the ordinal and that the tip does.

**DoD:** open any record's checklist and gates tab: no bare number beside a
field name.

#### 1.4 Two counts differ by one, unexplained — §3.21, FIU 13 · **S**

**Seen:** the gate panel *"5 to answer"*, the button *"Chase the 4"*. The
reason — Spec notes is a manual entry, not a question for anybody else — is
right and unspoken.

**Build:** the number on the button is `readiness.toQuote` (record page 639,
995) and the panel's is `toAnswer` (GatePanel 312), and they legitimately
count different things. Say so in words beside the button: *"5 outstanding at
TGQ · 4 to chase, 1 you record here"*, and mark the you-record-here rows in the
gate list with the same words. Never make the two numbers agree by changing
what one of them counts — the chase count must not include a question nobody
external can answer.

**Variance:** a record where the difference is 0 (no self-recorded rows) — the
qualifier is omitted, not "0 you record here"; a record where *all* outstanding
rows are self-recorded — the button does not render (nothing to chase) and the
panel says why.

**Tests:** component, `tests/components/gate-panel.test.tsx` — the three
cases.

**DoD:** the sentence reads correctly on the sofa record from the demo.

### Workstream B — the first intake screens (one coder)

#### 1.5 Packaging and delivery lines are suggested for ignoring — §3.6, FIU 2 · **M**

**Seen:** `PACK` and `DEL` became furniture. Matthew: they should not be there.

**Build — a suggestion, never a decision.** The BOQ review gets a per-line
*Not furniture?* suggestion rendered with `SuggestButton` (evidence required),
and a *Ignore all suggested (n)* action at the top that ignores exactly the
suggested set in one click. Nothing is ignored on its own: an ignore is a
reviewer's decision and stays reversible, as every ignore path is.

The suggester lives in a leaf, `src/lib/non-furniture-guess.ts`, and reads
three things in order, stopping at the first that decides: the code's own
prefix against a small explicit list (`PACK`, `DEL`, `DELIV`, `INST`, `FREIGHT`,
`SHIP`, `CRATE`); the description's words against a list (`packaging`,
`delivery`, `installation`, `freight`, `shipping`, `crating`, `transport`,
`storage`, `attendance`); and a **missing category alias match** as
*supporting* evidence only, never on its own — a bench with a novel name is
not packaging. Every suggestion carries which rule fired and the words it
matched, printed beside the button.

**Variance cases:** (a) a bill where every line is furniture — no suggestions,
no banner; (b) a line coded `DEL-01` that is a real *delivery table* — the
description word list must not fire on "table" being absent; the suggestion
fires on the code, the reviewer sees the description beside it and declines,
which is the design working; (c) a bill with a subtotal or section-header
row — `parseBoqSheets` already skips those, confirm it still does and the
suggester never sees them; (d) a 300-line bill with 40 non-furniture lines —
the *Ignore all suggested* action is the whole point; test that it ignores
exactly the suggested set and nothing that was unticked.

**Tests:** pure, `tests/lib/non-furniture-guess.test.ts` (each rule, each
case); route/db, the confirm writes no record for an ignored line and the
ignore is restorable.

**DoD:** the Panther bill review shows `PACK` and `DEL` each with a yellow
*Not furniture?* and its reason; one click ignores both; confirm produces 12
records not 14; both lines can be restored before confirm.

**Role:** PM, first screen of the first intake.

#### 1.6 The pack screen's banner stack — §3.8, FIU 5 · **S**

**Seen:** one white or yellow notice per document; *"you'd have like 300."*

**Build:** the per-document notices on
`projects/[id]/intake/[batchId]/page.tsx` are replaced by ONE summary line per
state across the pack — *"11 documents · 9 read · 1 failed (retry) · 1 waiting"*
— with the per-document detail on the document's own row, where it already
renders. Matthew checked the banners carried nothing needing review, and they
do not; what needs review is on the rows.

**Variance:** a pack with one document — the summary still reads correctly
("1 document · read"); a pack where every document failed — the summary is
red and the retry-all control is beside it; a pack still uploading — the count
updates while polling.

**Tests:** component — a new `tests/components/intake-pack.test.tsx` with a
fixture of eleven runs in mixed states, asserting the one line and the
absence of per-document banners.

**DoD:** the Panther pack screen shows one summary line.

#### 1.7 A document is ticked because it was opened — §3.9, FIU 4 · **M**

**Seen:** *"so it's ticked because you've opened it."*

**Build:** the pack's tick is derived from `intake_runs.status`. Read what it
actually means today: `status = 'confirmed'` on a run means *no pending
proposals remain* (`CLAUDE.md`, *Review complete*). If the tick renders for
anything short of that — for an opened run, or a run with proposals still
pending — that is the defect. Three states, three words, never one tick: **Not
looked at** (no reviewer has opened it), **In review** (opened, proposals still
pending — with the count), **Review complete** (nothing pending). If "opened"
is not recorded anywhere — check whether the GET route or the review screen
writes anything on open — then only two states are derivable and the screen
must not pretend to a third. The likely honest answer is two states plus the
pending count, and that is enough.

**Variance:** a run confirmed with every proposal *ignored* — that is Review
complete and must read so, because ignoring is a decision; a run that failed
extraction — its own state, not "not looked at".

**Tests:** component, in the same `intake-pack.test.tsx`.

**DoD:** the pack screen never shows a completion tick beside a document that
still has pending proposals.

#### 1.8 `TBC – <fabric>` puts the marker inside the value — §3.13, FIU 7 · **M**

**Seen:** the sheet prints a fabric *and* TBC; both landed in the value.
Matthew: *"it shouldn't really be in the name."*

**Build:** the marker is a **state**, and the fabric is the value. At staging
(`stageDrawings`) and at read time (a new `upgradeTbcMarkers` beside
`upgradeCalloutGuesses`, same discipline: pending, `version === 1`, so a
reviewer's edit is never second-guessed), a value whose leading or trailing
token is one of `TBC_TOKENS` followed by a separator (`–`, `-`, `:`, `/`)
becomes `state: 'tbc'` with the remainder as the value. The card shows the
value with the amber TBC state beside it, and the composed finish cell
carries the marker the way `renderAttributeValue` already does — once, from
the state, never parsed back out of the string.

**Never** strip a token from the middle of a value: `Yarn TBC Collective`
means nothing and must be left alone and flagged. Never strip where the whole
value is only the token — `TBC` alone is state tbc, value null, which is
already the rule.

**Variance cases:** `TBC – Yarn Collective Tessarae` → tbc / `Yarn Collective
Tessarae`; `Yarn Collective (TBC)` → tbc / `Yarn Collective`; `TBC` → tbc /
null; `To be confirmed - oak` → tbc / `oak` (the token list already carries the
long form — check); `TBC by DLA Projects` (the BWS Routing boilerplate value)
→ **left whole**, because *by* is not a separator and the phrase is a real
value; a value already at state tbc with the marker in it → the marker comes
out and the state is unchanged.

**Tests:** pure, `tests/lib/drawing-document.test.ts` — every case above; and a
`renderAttributeValue` assertion that a tbc finish renders the marker exactly
once.

**DoD:** the S-100 sofa card on the sandbox shows the Yarn Collective fabric
with an amber TBC beside it and no TBC in the value box; the record's COM 1
cell reads the marker once.

#### 1.9 The item picture crop failed on a real page — §3.11, FIU 6 · **M, investigation first**

**Seen:** *"the picture extract hasn't worked very well this time."* Max drew
the box by hand.

**Build — measure before deciding.** Two different failures look identical on
screen: the model returned no view region (the whole-page fallback fires,
which is the design), or it returned one and the crop drew the wrong box
(coordinates off, wrong page, wrong scale). `npm run measure:drawings` counts
dimension guesses; extend it to count **view regions**: per staged item, did
the model report a region, of which kind (3D / front / other), and does the
region fall inside the page bounds. Run it across the 18 staged runs. Then:

- If the model rarely reports a region on this template, the fix is the
  prompt (ask for the bounding box of the largest pictorial view, in page
  fractions, with the view's caption as evidence) and it costs a re-read —
  which lands with the finishes-schedule schema change (3.6) so the pack is
  re-read once, not twice.
- If regions arrive and the crop misplaces them, the fix is in `pdf-crop.ts`
  / `ItemImagePicker` — check the page-fraction to pixel conversion against a
  rotated (landscape) page, which is what a shop drawing is.

**Variance:** a landscape page; a page with two items (a region per item,
which the code group's `itemCodes` now allows); a page with no drawing at all
(a cover sheet) — no region, whole-page fallback, and the card says so.

**Tests:** pure, `tests/lib/pdf-crop.test.ts` for the coordinate maths on
portrait and landscape; the measurement is a tool, re-run before and after.

**DoD:** the measurement's before/after counts are in the commit message; the
S-100 page crops to its 3D view without a hand-drawn box, or the card says
plainly that no picture was reported and offers the page.

#### 1.10 The swatch picker cannot reach page 2 — §3.14, FIU 8 · **M**

**Seen:** *"It was on the second page, and I've only got one page."*
Two-page items are normal: shop drawing, then finishes.

**Build:** `SwatchPicker` is scoped to the page the card shows. An item now
groups pages (`codeGroups`, one item on two pages since 2026-09-18), so the
picker offers **every page of the item**, defaulting to the page the finish
observation was read from (`source_page` is on the row). A page selector, the
same `PageCropper`, one implementation. The document and page the crop came
from are recorded as today — that requirement is what makes a swatch
checkable and it does not relax.

**Variance:** an item on one page (no selector shown); an item on three pages;
a finish observation whose page is unknown (older staged run, version 1) —
default to the card's page and say so.

**Tests:** component, `tests/components/swatch-picker.test.tsx` (new) — the
selector appears only for multi-page items and defaults to the observation's
page.

**DoD:** on the S-100 card, the swatch for the fabric can be cropped from page
2 without leaving the card.

### Workstream C — the record, and the way in (one coder, after §2.4 sign-off on 1.13)

#### 1.11 A visible route from confirmed intake → each line → what is outstanding — §3.19, FIU 11 · **M**

**Seen:** *"How do you get to this page? At what point in the workflow do you
come to this?"* The app can do all of it; Matthew could not find the way in.

**Build — one function decides the next step; every screen renders it as its
primary action (§0.3).** Not a line of text, anywhere.

- **`nextStep(project)`**, pure, in `src/lib/next-step.ts`, over the numbers
  `loadProjectSummary`, `loadOutstanding` and the intake status labels already
  hold: documents waiting to be read → a document that failed → items with no
  category → items with to-quote gaps → questions waiting on a reply → ready
  to export. The first that applies is the next step, with its count and its
  destination. Nothing new is computed; one place decides.
- **Each screen's PRIMARY button is that step**, in the header band where the
  design language puts a primary action. On the project overview it is the
  header's primary. On the BOQ confirm's success state and on the drawings
  review's *Review complete* box, the existing *Open the phase table* becomes
  the primary and reads what it leads to (*"Review 14 items — 5 missing a
  to-quote spec"*). On the phase table, the row is the workflow: the item
  name opens the record and 1.12 puts the missing fields inside the row.
- **Every screen carries the way back** in its header, so the browser's back
  button is never the route to continuing.
- **No "what to do next" sentence.** Where the earlier draft of this item had
  one, the button replaced it. If a screen still needs a sentence to explain
  its primary action, the primary action is wrong.

**Variance:** a project with no documents yet (next step: upload); a project
whose only phase is confirmed and fully specified (next step: export, and the
completion pill shows); a project with a failed document read (next step:
retry it, and it links to the pack).

**Tests:** pure — `nextStep`'s precedence, one fixture per state and one
where nothing applies; component — the header's primary action on the
overview, the BOQ success state and the *Review complete* box each render the
step `nextStep` returns and nothing else as primary.

**DoD:** from the projects list, a person who has never seen the app reaches
"this item is missing its seat height" in ≤ 4 clicks — project → phase tab →
item → checklist — **by pressing the primary action each time**, without
reading any guidance; the verifier records hesitations (§0.3).

#### 1.12 The phase table shows *what* is missing, not a button — §3.21, FIU 12 · **M**

**Seen:** *"On this page, you can't see what's missing? There's a button to go
and see them."*

**Build:** the *Needed to quote* cell already holds a count from
`loadOutstanding`. It becomes a disclosure: the count, and on expand a list of
the to-quote questions still open on that row, each the field's name, each
linking to that question on the record's checklist (`#answer-<id>`). The
mock-up file governs the look (`docs/design/spec-builder-mockups.html`, the
spec-table tab); if the mock-up has no expansion, the deviation is written into
`docs/design-language.md` as the others are. The list is the *record's own*
questions, never filtered by the table's filters — the chase screen's rule.

**Variance:** a row with 48 outstanding (the fallback-TGQ half, everything
required) — the expansion lists them grouped by section, collapsed to the
first six with "and 42 more"; a row with no level on an uncovered category —
the cell says *needed for the boilerplate*, as it does today, and the
expansion explains rather than lists nothing.

**Tests:** component, `tests/components/spec-table-outputs.test.tsx` gains the
expansion cases.

**DoD:** on the AP364c MAIN RUN tab, expanding the sofa's cell lists its
missing to-quote fields by name and one of them opens on the record.

#### 1.13 A confirmed value can be corrected, and the control is findable — §3.22, §4.10, FIU 14 · **L, design in §5.2 first**

**Seen:** Matthew went looking for confirm-or-update on a confirmed record and
neither he nor Max found it. *"Are we going to mess it up?"*

**The finding that changes the item:** there is no such verb. A confirmed
`record_attributes` row can be **retired** (reason required) or a new one
**typed** (no page). Nothing edits a value in place, so correcting `W1900` to
`W1090` off the same page means two actions, two change sets, and a
replacement that has lost the page it was read from.

**Build:** the **correction** verb, §5.2. Summary here: `POST
/api/attributes/[id]/correct` takes the new value (and unit, slot, state),
the version seen, and a reason; in one transaction it retires the old row
with `superseded_by_id` pointing at a new row that **keeps the old row's
source run and page** (the page is still where to check it), opens one
`attribute_correct` change set, recomposes the checklist through the existing
`recomposeAnswers`, and snapshots the record. On the record's Specs tab every
confirmed value carries **Correct** beside **Retire**; Correct opens an inline
editor pre-filled with the current value (a *pre-filled control is fine here*,
because the action is the Save, not the select — the level picker's trap does
not apply). The old value stays visible in the history with who corrected it
and why.

**Variance cases:** correcting a dimension's *unit* only (cm → mm: the value
stays, the composed cell changes — the recompose must run); correcting a
finish whose code is linked to the library (the correction changes the
attribute's words; the library row is untouched and the row shows *unlinked*
if the words now disagree — the CONFLICT rule); correcting a row that was
already superseded (refused, naming the newer row); a concurrent edit (409 on
version, as everywhere); correcting a TBC row to a confirmed value (allowed;
the state changes and the checklist promotes); a hand-typed row (no page —
the correction keeps no page either, and says so).

**Tests:** db, `tests/db/attribute-correct.test.ts` (new) — every case,
including that the change-history coverage assertion still passes (one change
set, one version); component — the Correct control renders on confirmed rows
and its editor saves once.

**DoD:** on the sandbox sofa record, correcting the width from the Specs tab
takes one click to open and one to save, the composed cell updates, the
Versions tab shows v(n+1) with one changed line, and the old row is visible as
superseded with the reason.

**Role:** PM (misread) and CAM (knows better).

### Workstream D — chase defaults and levels (one coder)

#### 1.14 The chase draft preselects the TGQ set only — §3.30, FIU 15, D3 · **S**

**Seen:** *"it's still selecting all of them, when in fact it should have just
selected [the four]."*

**Build:** `drafts/page.tsx:173` initialises `selected` empty and the table
ticks on load. Preselect **exactly the `to_quote` tier** for the chosen
contact, on first load and when the contact changes; a filter change never
touches the selection (the existing rule). The footer says *"n to-quote
questions preselected · m also outstanding, not selected"*. D3 makes this the
default; the *later* questions stay tickable.

**Variance:** a contact whose to-quote set is empty (nothing preselected, the
footer says so, the button is disabled with the reason); a record with no
tier because it has no level on an uncovered category (excluded from the
preselection, listed under the blocker panel as today).

**Tests:** component, `tests/components/chase-question-table.test.tsx` and the
drafts page's selection logic extracted to a pure function with its own test.

**DoD:** open the chase screen for the demo contact: the count on the button
equals the red-dot count.

#### 1.15 A level can be set at the drawings stage — FIU "A level cannot be set or changed at the drawings stage" · **M**

**Seen:** every BOQ row read *Simple · guessed*, including packaging; the
drawings review has no level control, and the drawing is where the brass leg
is visible.

**Build:** a level control on the item card and the configuration card,
writing `spec_records.level` **only on a person's action**, one `level_set`
change set per confirm (the `acceptSuggestedLevels` precedent). It renders the
current suggestion and its reason with `SuggestButton` (*Accept Complex —
"brass leg" on page 2*), never as a pre-filled select. `guessLevelFromAttributes`
still never returns `simple`. It never blocks the card: a level is not part of
what the card confirms, and the card's confirm request does not carry it —
levels go through the existing levels route so the two writes cannot be
confused.

**Also:** the BOQ guess must not fire on a line suggested as non-furniture
(1.5), or packaging keeps reading *Simple · guessed*.

**Variance:** an item that fans out to three phases — one control, one write
per record, one change set, and the card says *"sets the level on 3
records"*; a record whose level is already a decision — the card shows it and
offers no suggestion; a configuration — inherits, as `ensureVariant` does.

**Tests:** component, `drawing-item-card.test.tsx` — the control is a
button, never a pre-filled select; route — the write is one change set for a
fan-out.

**DoD:** on the S-200 card, accepting the suggested level writes it to the
records on the ticked phases and the phase table shows it without *guessed*.

**Note for Matthew:** the level guess rules are this repo's judgement and he
has not seen them (`CLAUDE.md`). He doubts the app should guess at all (§3.5).
Item 1.15 gives a person the control; whether the guess stays is his call,
asked with §7 Q1.

### Workstream E — the pilot environment (Max, with one coder)

#### 1.16 A stable build for Matthew, with its own data — §4.13 · **M**

**Seen:** Tony: *"a separate instance… so Matthew is working off a known one."*
Sebastian: with its own clean data.

**Build — a third environment inside the existing model, not a new model.**

| | Pilot |
|---|---|
| Git | a `pilot` branch that only ever fast-forwards to a commit already on `staging`, by Max, deliberately. **Not** a production branch: `house/deployment.md` still governs and nothing here is production |
| Vercel | a second project, `spec-builder-pilot`, region `lhr1`, production-branch setting = `pilot` (the same trick `environments.md` documents for staging) |
| Database | its own Neon **project** (not a branch of sandbox — a branch shares the parent's history and a restore into it is a trap), London |
| Blob | its own store, private |
| `APP_ENV` | `pilot`; `DATABASE_ENVIRONMENT` `pilot`. `env.ts` accepts the new pair and the guard refuses a mismatch as it does for the others |
| Chip | `PILOT`, a different colour from `STAGING`, so a screenshot from Matthew says which build it is |
| Queue | its own topic consumer — a queue topic has no consumer until the deploy declaring it lands; check `vercel.json` per project |
| Migrations | applied by Max to the pilot database **before** promoting a commit that needs them (schema releases are two operations) |
| Data | seeds only, then whatever Matthew loads. Never a copy of the sandbox |
| Promotion | a checklist in `docs/environments.md`: backup pilot db → apply pending migrations → fast-forward `pilot` → confirm a deployment for that SHA → `/api/auth/me` → walk the first-session script (§7.4) on pilot |

**Variance (of the environment):** a promotion where a migration was
forgotten — the app must fail loudly at start, not serve half a schema; check
that `run-migrations` ledger comparison is something the promotion checklist
reads.

**Tests:** pure — `env.ts` accepts `pilot`/`pilot` and refuses `pilot`/`sandbox`.

**DoD:** `/api/auth/me` on the pilot URL reports `pilot`/`pilot`; the chip
reads PILOT; a migration applied to pilot is in its `schema_migrations`;
`docs/environments.md` has the pilot column and the promotion checklist.

### Stage 1 close

**1a closes** when its ten items meet §7.1, the walkthrough script (§7.4)
runs clean on staging and then on pilot, `CLAUDE.md` says "phase" and carries
the correction verb in the editing section (§5), and Matthew has the link.
**Then stop building and wait for his screenshots.** 1b starts only after
the link is sent, and **1b closes** with one promotion to pilot after the same
script runs clean again. Anything Matthew reports in between is a
`found-in-use.md` entry, grouped into 1b or Stage 2 at that close — never
fixed straight from the message (§7.7).

---

## 5. The editing model — the architecture behind Stage 1.13 and Stage 2

The user's instruction: *"we edit records after they've gone through the
intake, because that is really where this app becomes useful, and that will
happen many, many times … does it actually make sense to do it that way?"*

### 5.1 Where a change comes from

Every edit to a record after intake has one of six origins, and the app should
treat them differently because the evidence behind each is different:

| # | Origin | Evidence | Verb today | Gap |
|---|---|---|---|---|
| E1 | **A misread** — the page says 1090, the card said 1900 | the same page | retire + type by hand (loses the page) | **no correction verb** |
| E2 | **Internal knowledge** — the CAM remembers what the client said | a person's word, dated | `POST /api/attributes` (no page) or a checklist answer, `source_kind = 'manual'` | findable only on the record; nothing lists the gaps to fill |
| E3 | **A client's email** | the `.eml`, attached | email intake: staged, reviewed, confirmed under `email_confirm` | the question match is unseeded; the mailbox is not live, so it is upload-an-`.eml` |
| E4 | **A call or meeting** — nothing written by the client | the person's note: who, when | none — typed as E2, with the "why" lost unless a change is opened first | **no meeting mode** |
| E5 | **A revised drawing** | the new page | drawings confirm with the replace acknowledgement, supersession | works; §1.9 crop aside |
| E6 | **A revised bill** | the new sheet | BOQ reconcile, staged pairing | works; untested for real |

E1 and E4 have no verb. E2 has a verb and no screen. That is what Stage 1.13
and Stage 2 items 2.3 and 2.7 build, and nothing else in the editing model is
new.

### 5.2 The correction verb (Stage 1.13)

A correction is a **supersession by a person**, and it keeps the page.

- **Why not edit in place.** `record_attributes` is *what a document said*. An
  in-place edit would make the row say something the page does not, with the
  page still cited as its source — a false provenance. Supersession keeps the
  misread on record (retired, with who and why), and the correction beside it.
  The history then answers "what did the card say before Max fixed it".
- **Why it keeps the source run and page.** The page is still the right place
  to check the corrected value. A correction that dropped the page would be
  indistinguishable from a value somebody made up.
- **Why a reason is required.** It overrides something a document said, the
  same test `attribute-retire.ts` applies. An *open change* satisfies it, as
  everywhere: a reviewer working through a call opens one change and every
  correction attaches to it.
- **What it must not do.** Touch `spec_records.version` (the extraction
  snapshot trap); write the answer directly (the checklist is recomposed from
  the attributes by `recomposeAnswers`, or the next drawing confirm wipes the
  correction); accept a correction onto a row that is not the current active
  occupant of its slot (refused, naming the occupant).
- **Where it appears.** Beside every confirmed spec on the record's Specs tab;
  on the drawings card **only before confirm** (the card's editable value box
  is already that); never on the applied proposal afterwards, which stays
  immutable history.

### 5.3 Meeting mode, and the infill screen (Stage 2.3)

Matthew's handover-meeting picture (§3.24): the app open in front of the
client, capturing as they go. The infill screen is Max's proposal — *"a page
quite similar to [the chase screen], but instead of a tick box there's an edit
box"* — and the meeting is what gives it its shape:

- **It offers to open a change**, named for the occasion — *"Handover call
  with Hayley, 2026-09-22"* — using `changeSetForEdit`'s existing rule of at
  most one open change per actor per project. Every value typed while it is
  open attaches to it, so the history reads *"12 values recorded on the
  handover call"* rather than twelve rows reading "update". The evidence slot
  takes a calendar invite or a note afterwards. **It is offered, not
  required** (§0.2): the first edit works without it, and a value that
  overrides a settled answer still asks for its reason as everywhere else. A
  screen that demands ceremony before the first edit is a screen people stop
  opening.
- **It lists what is outstanding**, from `loadOutstanding`, grouped as the
  chase screen groups — by furniture line, collapsed, finish options nested —
  because that is the order a client walks a bill in. With **area** as a
  filter (2.4), because a client walks a building room by room.
- **Each outstanding question is an edit box**, saving on blur through
  `PATCH /api/answers/[id]` as `source_kind = 'manual'` — which already takes
  the answer out of `applyAnswerFills`' reach for good. A dimension question
  is different: its answer is composed from attributes, so its box writes an
  attribute through `POST /api/attributes` with the slot, not the answer.
  The screen must know the difference, and the row must say *"recorded as a
  W dimension"*.
- **It shows what is already known** beside each gap — the sister
  configurations' values, the library's description of a finish code — as
  *reference*, never pre-filled. The M8 rule stands: a value is never filled
  from a sister item.
- **Nothing on it sends anything.** It is internal. When the meeting is over
  the chase screen still lists what is left, and that is the client email.

Whether this is one screen with two modes or two screens was left open (§8 of
the catchup). **Decided here: two screens sharing one loader and one
grouping** — the chase screen selects questions to *ask*, the infill screen
*answers* them, and a tick box beside an edit box on one row is a screen that
does not know what it is for. They share `loadOutstanding` and
`groupIntoLines` so they can never disagree about what is outstanding.

### 5.4 Email into the app — the answer to "should they send an email?"

Yes, and it is already the design: an email is a document, and M5 (Graph
ingestion) is built and disabled. Until the mailbox exists, the path is
forward-to-`.eml`-and-upload, which Matthew followed without difficulty
(§3.28). Two things make it the *secondary* editing path rather than the
primary:

- **Most spec changes at tender are not in an email.** They are in a call, a
  meeting or Jay's memory (E2, E4). The infill screen is for those.
- **A reply answers three of ten and asks a new one** (§3.28). The email
  review handles the three; the new question is a project note today, and
  where it should go is a Stage 3 question rather than something to build on
  a guess.

The change asked for in `found-in-use.md` — **auto-assign a confidently routed
email** — moves a hard approval gate and is Stage 2.11, with its own decision
step.

### 5.5 What "editing works" means, as tests

- Every verb in §5.1's table has a db-tier test that walks the whole path and
  asserts the history: one change set, one version, the right `source_kind`,
  the record's own `version` untouched.
- A composed dimension cell is recomposed after every one of E1–E5 (a test per
  origin), because the cell being a projection of the attributes is the
  invariant most likely to be broken by a new write path.
- The change-history coverage assertion (`tests/db/change-history.test.ts`)
  keeps running over the whole database; it has earned itself twice.

---

## 6. Stage 2 — while Matthew is using it

Work that does not change the pilot build's behaviour until promoted, or that
is clearly additive. Order within the stage is dependency order; the two
coders take one stream each.

| # | Item | § / FIU | Size | Depends on | Design first? |
|---|---|---|---|---|---|
| 2.1 | Sync the five BWS palettes | §4.8 | M | **0.1** | no — `external-vocabulary-sync` skill |
| 2.2 | Offer the palette at intake and on the record | §3.32 | M | 2.1 | no |
| 2.3 | **The infill screen** (meeting mode) | §4.5, §5.3 | L | — | **yes, §5.3** |
| 2.4 | Area as a real filter (chase, infill, phase table) | §4.4 | S | — | no |
| 2.5 | **The chase EMAIL grouped by question × area**; internal recipients | §4.4 | L | 2.4 | **yes** |
| 2.6 | The dimensions qualifier box | §4.3 | M | — | yes, short |
| 2.7 | Outstanding-by-question view | §4.6 | M | 2.3's loader | no |
| 2.8 | Project-level questions asked once | §3.18, FIU 10 | M | — | yes, short |
| 2.9 | Phase overview tiles: propose, then build | §3.7, FIU 3 | S+ | Matthew's answer to our proposal | proposal in §6.9 |
| 2.10 | The robustness programme | user's brief | L, ongoing | — | §6.10 |
| 2.11 | Auto-assign a confidently routed email | FIU (change asked for) | M | a rate cap (2.10.f); Max amending the gate in `CLAUDE.md` | **yes** |
| 2.12 | The progress tracker | `docs/plans/progress-tracker.md` | L | Stage 1; its own plan | already written, another session's |
| 2.13 | **Ask Tony for the typical-dimensions reference** — not code. A per-family range of what normal looks like, used as a **flag** ("this sofa would be 8m wide") and never a value | §4.15 | — | Tony's knowledge-base proposal | no — an email, and a note in `CLAUDE.md`'s unit-resolution section when it arrives, saying it is a fifth signal that never fills a slot |

### 6.1 Sync the BWS palettes — §4.8

Blocked on 0.1. When it lands: scrape the **Palette options** box per
`palette`-type field on `bws.whistlercloud.com/standard_specification_fields/<id>/edit`
— never the Values page — keep the BWE codes, seed `spec_palette_options`,
set `synced_at`, and **replace** the db-tier test asserting the five are empty
with one asserting they are populated and unchanged since the sync. BWS is
read-only; this is a read. The `external-vocabulary-sync` skill is the
procedure and its capture note goes in `docs/plans/`.

**Variance:** an option string with a pipe in it (`Standard - French Natural |
BWE Code: U1660-6031`) — the code is parsed into its own column, the label
keeps the whole string; a palette BWS has since changed — the sync diffs and a
removed option that an answer already holds is **kept and flagged**, never
deleted.

### 6.2 Palettes at intake and on the record — §3.32

`normalisePaletteValue` and `AnswerValue` already do the record half. Intake:
when a drawing's callout resolves to a BWS field with a palette, the staged
row carries a `paletteMatch` — exact only (house §6: the exact step, never the
nearest) — shown as a suggestion with the option beside the page's words.
No match leaves free text, as Matthew asked.

**Variance:** a drawing saying `polished nickel` where the palette says
`Standard - Polished Nickel | U1660-1031` — no exact match, so no suggestion;
this is the case that argues for a *substring within option* second step, and
that step is a **decision, not a default**: build the exact step, count how
many real callouts it misses, then decide.

### 6.3 The infill screen — §5.3

Designed above. Files: `src/app/dashboard/projects/[id]/infill/page.tsx`
(new); `src/components/infill/*` (new); reuses `loadOutstanding`,
`groupIntoLines`, `ChaseQuestionTable`'s grouping (extract the shared table
body if the tick column is the only difference); `changeSetForEdit`;
`PATCH /api/answers/[id]`; `POST /api/attributes`.

**Variance:** a record with no category (no questions; the screen lists it
under *cannot be filled in until categorised*, with the category picker);
a question whose answer is a palette (the dropdown, with Other…); a
dimension question (slot picker + figure + unit, writing an attribute); a
question already `tbc` (the box shows TBC and offers to confirm a value); a
second person editing the same record during the meeting (409, shown on the
row, the row reloads).

**Tests:** component for the row types; db for the change attachment (twelve
edits, one change set); route for the 409.

**DoD:** open a change, fill four gaps on two items in under a minute, close
the change; the history shows one entry with four lines; the chase screen no
longer lists the four.

### 6.4 Area as a filter — §4.4

`spec_records.area` is the BOQ's fourth column and is a search box today. It
becomes a select on the chase screen, the infill screen and the phase table,
populated from the distinct values on the phase. A filter narrows what is
LISTED, never what is asked or counted (the rule in three places already).

**Variance:** areas that differ by case or whitespace (`Living Room`, `living
room`) — grouped by a case/whitespace fold for the *select*, shown as the
document wrote them; a record with no area — listed under *no area given*,
never dropped by the filter; 300 lines with 40 areas — the select is
searchable.

### 6.5 The chase email grouped by question × area — §4.4, D3

The strongest product criticism in the meeting. **Design, before briefing:**

- The email's unit becomes the **question**, then the **area**, then the items
  under it: *"Metalwork finish — Dressing area: S-301 desk chair (×2), S-402
  bench. Living area: S-100 sofa."* Matthew's *"we think so-and-so said you
  want it in polished steel"* is the infill screen's job before the email, and
  where a TBC value exists it prints beside the question as *our understanding*.
- The coverage rows (`email_draft_items`) are unchanged — one per record ×
  question — so the send gate's guarantee (the body and the coverage are the
  same set) survives; only `chase-template.ts`'s rendering of them changes.
  A test asserts the set of (record, requirement) pairs in the rendered body
  equals the coverage set, exactly as today.
- The tier banner stays first: TGQ questions, then *also outstanding*. D3 says
  the tender chase covers the TGQ set only, and 1.14 makes that the default
  selection.
- **Internal recipients**: the recipient picker offers project contacts *and*
  colleagues; the template's wording drops "your" where the recipient is
  internal (*"we still need"* not *"we still need from you"*). The tier banner's
  words change to match. No sending — there is still no send path.

**Variance:** a question outstanding on one item only (no grouping header
needed — one line); an item with no area; a question with 40 items across 12
areas (the grouping is the whole point; the test fixture is the 300-line
shape); an email covering questions for two designers (one draft per contact,
as today).

**Tests:** pure, `chase-template.test.ts` — the grouping and the coverage
equality; a rendered-HTML snapshot for the Word-renderer border rule (the
banner is a one-cell table, kept).

### 6.6 The dimensions qualifier — §4.3

One qualifier for the **dimension statement as a whole**, typed by a person,
never read off a page. It is not the per-attribute placement qualifier of
0029 and must not reuse it.

**Decided:** a column, `spec_records.dimension_note text`, written through
`PATCH /api/records/[id]` under a change set; **composed by
`composeDimensionCell`** as an input, rendered in a bracket after the
millimetre group — `W1900 x D790 x H720mm (1250 L-shaped return)` — so the
export, the quote, the costing sheet's `Tags` and the record screen all show
one cell. It is a record atom, so a version diff shows it changing. The check
sheet prints it apart from the composed figures, as it does the placement
qualifier, so a reviewer can tell which half a page said.

**Variance:** a note with a newline (refused; a BWS cell is one line — the
existing no-newline export test holds it); a note on a record with no
dimensions at all (the cell is the bracket alone, and the screen says
*dimensions not yet recorded*); a note longer than the cell can reasonably
carry (cap at 200 characters, say so).

### 6.7 Outstanding-by-question — §4.6

*"Show me all the jobs with dimensions missing."* A second grouping of
`loadOutstanding`, on the infill screen and the phase table: group by
requirement, then list the records. Same loader, one implementation, so it can
never disagree with the per-item view. A tab on the infill screen rather than a
new page.

### 6.8 Project-level questions asked once — §3.18, FIU 10

The commercial block (TOE agreement, sales folder, …) is identical on all
seventeen cheat sheets and is asked inside every item.

**Design, decided here in two steps:**

- **Step 1 (Stage 1-cheap, do it there if time allows):** `requirements.section`
  already exists. Fold the project-wide section on the checklist under one
  heading, collapsed, reading *"Project-wide — the same answer applies to every
  item"*. Nothing about the data changes.
- **Step 2 (Stage 2, and only if Matthew asks again after seeing step 1 —
  §0.2):** a **Project questions** panel on the project overview that answers
  each project-wide question **once and writes it to every in-scope record's
  answer row** in one change set (`project_answer_set`), as
  `source_kind = 'manual'`. Fan-out, not a new table: the BWS export is per
  job and these may be BWS job fields, so the per-record row has to exist
  anyway, and a `project_answers` table would be a second place an export
  cell could come from. A new record created later (a revised bill's new
  line) gets the project's current answer at creation, flagged *from the
  project*. **Which questions are project-wide is seed data**, a
  `scope = 'project'` column on `requirements` seeded from the section, and
  Matthew confirms the list (§11 A). The trap step 1 alone falls into, which
  is what would justify step 2: a 300-line project answering "TOE agreement"
  three hundred times.

**Variance:** a project-wide answer that one item genuinely differs on (the
item's own row can still be edited and shows *differs from the project*);
a project with two phases (the answer covers both — a project fact is not a
phase fact).

### 6.9 The phase overview tiles — §3.7

Matthew returned it: *"think about what could be really useful."* **Proposal,
to put to him before building:** five tiles, every number from a loader that
already exists, every tile a link —

| Tile | Reads | From |
|---|---|---|
| Can quote | *9 of 14 items* | quote readiness per record (`loadOutstanding` + `questionTier`) |
| Needed to quote | *23 questions on 5 items* | same |
| Waiting on a reply | *7 questions · oldest 6 days* | `waitingByQuestion` |
| Not yet categorised / levelled | *2 · 3* | `/api/records` |
| Documents | *11 read · 1 failed* | intake status |

Replacing *22 product categories*, which nobody acted on. If Matthew's answer
is different, his wins.

### 6.10 The robustness programme — "think past the demo document"

The user's brief, and the part of this plan that has no line in the catchup.
The app has been tuned against one pack. The programme is a **variance
matrix**: for each intake shape, a **real document off SharePoint** staged in
a sandbox `TEST` project (§2.7 — authorised, read-only, read once), a
synthetic fixture in the repo that holds the rule (never a real client
document — `CLAUDE.md`'s rule), the expected behaviour, and a test or a
measured run. The real document is where each row's finding comes from; the
fixture is what keeps it fixed. The rule for the expected behaviour column is always one of
three words: **proceeds**, **flags** (with what the screen says), **refuses**
(with what the screen says). A fourth outcome — a plausible wrong answer — is
a defect wherever it is found.

Built incrementally: one row at a time, each row a small brief, prioritised
by what Matthew's first project is likely to contain (0.2 tells us).

#### a. Bills of quantities

| Shape | Expected | Holds it |
|---|---|---|
| Header synonyms not matched (a bill saying "Item No." / "Product") | **refuses** naming the columns it looked for and the words it accepts; a person adds the alias | pure test; the alias list is seed data |
| No quantity column | **flags** — records created with `qty` null and the phase table says *quantity not given*; never 1 | pure + db |
| Merged cells / a two-row header | **proceeds** if the second row completes the first; otherwise refuses naming the row | pure, fixture |
| Codes with spaces, dots, mixed case (`S 201`, `s-201`, `S.201`) | **proceeds** — `normaliseRef` folds them; the check is that the *same* fold is used for matching everywhere (the `groupItemsByCode` lesson) | pure |
| The same code on two lines (`SX11A`) | **proceeds** as two records; every matcher offers candidates and picks none | db (exists) |
| A level column (`L1`..`L6`) | **proceeds** — never read as qty (exists); test that a bill with only level columns and no qty column flags, not orders | pure |
| An `.xls` (BIFF) or `.csv` bill | **refuses** with *"save as .xlsx"* — or proceeds if the parser accepts it; measure which, say which on the upload screen | pure |
| Subtotal / section rows | **proceeds**, skipped, and the review says how many | pure (exists?) |
| 300 lines, 40 areas, 60 non-furniture lines | **proceeds**; the review renders in under two seconds; *Ignore all suggested* works | component + a timed fixture |
| A bill inside a PDF | **refuses** — explicitly excluded; the classifier says *bill of quantities as PDF — not supported, export it to Excel* rather than reading it as a drawing | classify test |
| Two bills in one pack | **flags** — which is the revision of which is a person's call; both stage | route |

#### b. Drawings and specification sheets

| Shape | Expected | Holds it |
|---|---|---|
| No item code on the page | **flags** — codeless card, collapsed, ignorable whole (exists) | component |
| Two items on one page | **proceeds** — `itemCodes` list; one card per code (built 2026-09-18, **never driven with a real two-item page**) | fixture + measure |
| One item across three pages | **proceeds** — grouped; the swatch picker reaches all three (1.10) | component |
| Unit printed nowhere (Panther) | **flags** every touched row (exists, and Matthew accepted it) | pure |
| **Inches** | **flags** — `ARM 18"` is not `mm` or `cm`; the unit vocabulary has no inch, so the figure is kept as a note with its unit text and the card says *imperial — not converted*. Never converted silently: the costing skill rounds imperial to metric and that is right for an estimator and wrong for a spec | pure, fixture |
| A third specification-sheet template (not Panther's two) | **measured** — run the pack through `measure:drawings`; the number of unplaced labels is the finding | tool |
| A scanned (image-only) PDF | **refuses** early with *"scanned document — not supported"* rather than a four-minute read returning nothing; detect no text layer at classify time | classify test |
| 100+ pages in one file | **refuses or splits with a stated page cap**, never hangs to the function timeout; today it is unknown — measure with a synthetic 120-page PDF | manual, gated |
| The model returns malformed output / a string for a list | **proceeds** — never fails a paid run over a hint (exists for `itemCodes`); extend the rule to every optional field in the tool schema | pure |
| Anthropic 429 on an eleven-document pack | **proceeds** after a retry that does not burn a delivery; today it can reach `failed` — see f. | db + timing test |
| A page rotated 90° | **proceeds** — the crop maths (1.9) | pure |

#### c. Emails

| Shape | Expected | Holds it |
|---|---|---|
| A reply quoting the whole question | **proceeds** — quoted history marked, not stripped (exists) | pure |
| An email answering 3 of 10 and asking a new question | **proceeds** on the 3; the new question is shown under *not a spec answer*, kept as a project note candidate | pure + component |
| HTML-only body | **proceeds** — `html-text` (exists) | pure |
| An `.msg` (Outlook binary) instead of `.eml` | **refuses** with *"save as .eml"* — or is converted; decide, say which | classify |
| An email whose spec is in an **attached PDF** | **flags** — the body is read, the attachment is listed as *not read*, with a button to register it as its own document | route |
| A message for a project the app does not have | **held** as unassigned (exists) | db |
| A message naming two projects equally | **held** as ambiguous, never arbitrated (exists) | pure |

#### d. Records and phases

| Shape | Expected | Holds it |
|---|---|---|
| Uncategorised record | no questions; blocks completion; every screen says *categorise first* rather than showing zero outstanding | db (exists) |
| No level, category on the fallback TGQ half | tier null; the screen says what the level is needed FOR (exists) | pure |
| A record with zero refs | export ships a blank client code and the check sheet lists it; the phase table flags it | db |
| A configuration with no quantity | *quantity not allocated* everywhere (exists); a person still cannot set it — **gap, Stage 3** | — |
| Retired records and phases | filtered from every default list, toggle to show (exists); the export refuses a retired phase | db |

#### e. Finishes

| Shape | Expected | Holds it |
|---|---|---|
| `CH-01.1` vs `CH-01-1` | two finishes, never merged (exists) | pure |
| One code, two descriptions across pages | **flags** — conflict, links nothing (exists); the finishes page lists it | db |
| A code with no description anywhere | library row with the code alone; *kind* unsuggested; the page says so | db |

#### f. Load and concurrency

| Shape | Expected | Holds it |
|---|---|---|
| Eleven documents registered at once | a **per-batch in-flight cap** (proposed: 3) — the M8 note has said "watch the first real delivery" since 2026-09-15 and Matthew's first pack is that delivery. Build the cap before 2.11, because auto-assigned mail is the same problem with no upload step to stagger it | db + timing |
| Two reviewers on one record | 409, named (exists) | db |
| A dev server and a `next build` in one directory | the build clobbers `.next`; **build in a worktree** — a rule for the coders' brief, not the app | brief |

#### g. Failure surfaces

Every failure the app can have must reach a screen as a sentence with a next
action. The audit for this is one pass over every `catch` in `src/app` and
`src/components`: does it set an error the screen renders, does the loading
state reset in `finally`, and does the message survive the reload
(`reloadThen`)? The `verify` skill already demands one failure path per
verification; this makes it a sweep. Held by: a component test per screen that
mocks a 500 and a non-JSON response and asserts the fallback renders and the
controls unfreeze.

### 6.11 Auto-assign a confidently routed email — FIU change asked for

Moves a hard approval gate; **Max amends the list in `CLAUDE.md` in the same
commit**, or it does not land. Design, decided here:

- Act on `assigned` only where the deciding signal is `forwarding_header` or
  `recipient_is_inbox` (the two strongest). **Hold** `subject_reference` and
  `sender_is_contact` for a person, because a contact who works on two
  projects sends about both, and a wrong assignment costs a charged read and
  a staged run on the wrong project.
- The inbox shows *"assigned automatically — addressed to the project inbox"*
  with **Unassign** beside it, and the change trail records `system:router`
  as the actor.
- Requires 2.10.f's cap first: a morning's mail is the eleven-document pack
  with no upload screen.
- `assignMessage` remains the only thing that puts a message on a project.

**Variance:** a message addressed to two project inboxes (ambiguous, held);
a message to the project inbox with no spec content (assigned, read, zero
proposals — the run says *nothing found*, which is a real answer).

### 6.12 The progress tracker

`docs/plans/progress-tracker.md` is another session's plan, written
2026-09-17 and untracked at the time of writing. It overlaps this plan in two
places — its *Chased / waiting* column and its per-record notes are close to
the infill screen's needs — and it must build on `gates.ts` rather than beside
it. Sequence it after Stage 1 and after 2.3, so the tracker's notes and the
infill screen's change do not become two ways of writing "spoke to Jay".

---

## 7. Validation — how we know each change landed

The user's second ask, and the one the app has never had: *"validating that
we have actually made the changes that we set out to make once the code has
landed."*

### 7.1 The definition of done, per work item

An item is done when Fable can write each of these as a fact:

| | Evidence |
|---|---|
| **Built** | the diff does what the item says and nothing else (§2.3) |
| **Tested** | the tests the brief named exist and pass; the db tier **ran** (0.4) |
| **Variance** | each variance case is either tested or driven, and the behaviour is one of proceeds / flags / refuses |
| **Findable** | the click count from the projects list, counted in a browser by someone who did not build it, **pressing each screen's primary action and reading no guidance** (§0.3); hesitations recorded as findings |
| **Simplest** | the brief named the simplest version and either built it or named the trap it falls into (§0.2); a reviewer can point at the trap in the code |
| **Looks right** | screenshotted at 1920×1080 and 1440×900, the §7.4a checklist answered in writing, and the 300-line fixture walked for every list screen touched — **by someone other than the coder, before Max sees it**. A layout fault Max reports is this row having been skipped |
| **Failure path** | at least one failure exercised in the browser (a 409, a 500, a non-JSON response); the screen recovers |
| **Deployed** | a Vercel deployment exists **for that SHA**, `Ready`, and the flow was driven on it — the six terms, stated |
| **Recorded** | a dated line in `docs/plans/README.md` naming the item, the SHA and what was verified; the `found-in-use.md` entry marked FIXED with date and commit; `CLAUDE.md` amended where a load-bearing rule moved |
| **Accepted** | *outstanding* until Matthew or Max has driven it. Written as outstanding, every time, until it is not |

### 7.2 The four tiers, and what each is for

| Tier | Runs | Holds |
|---|---|---|
| pure (`tests/lib`) | always | rules: composers, parsers, guessers, groupers. Every variance-matrix row that is a parsing rule lands here |
| component (`tests/components`) | always, jsdom | what a screen shows for a given payload, and that a control does what its label says. The first eleven component tests found a defect nobody had reported; write one for every screen this plan touches |
| db (`tests/db`) | with `DATABASE_URL`, **proven to have run** | the write paths: one change set, one version, the right source kind, the record's version untouched, scope equals the export's |
| route | with `DATABASE_URL` | the boundary: a bad body is 400, a stale version 409, a forbidden role 403 from middleware, and the response is JSON |

Two additions this plan makes to the tiers:

- **The lexical guards** (1.1's run/phase test, `tone.test.ts`) — rules the
  compiler cannot hold, held by a test that reads source. Use sparingly, and
  only where a miss is silent.
- **The fixture library**, `tests/fixtures/` — synthetic BOQs, PDFs and
  `.eml`s built by a script committed beside them (`tests/fixtures/build.mjs`),
  so a fixture is reproducible and provably not a client document. The
  variance matrix's rows point at them. A fixture is written **after** the
  real document has shown the shape (§2.7), modelled on it, carrying none of
  its content — the real one stays in the sandbox `TEST` project it was
  staged in, which is where a reader goes to see the shape for real.

### 7.3 The measurement tools

`measure:drawings`, `dump:drawings` and `vocab:gap` are the pattern: read
only, calling the app's own functions, printing a number that can be re-run.
A sentence in a document cannot be re-run. Extend what exists rather than
adding beside it (§0.2):

- **`measure:drawings` gains view regions** (1.9) — reported, in bounds, per
  template — as new columns in the same report, because the pack it measures
  is the same pack.
- **`dump:drawings` gains the BOQ** — `--import=<id>` prints what a staged
  bill reduces to: header row, items, non-furniture suggestions, colliding
  codes, areas. Run before and after 1.2 and 1.5.
- **One new tool, `measure:outstanding`** — per project: to-quote questions,
  by the matrix and by the fallback, per record and per question. It earns
  its place because it is the number 1.12, 2.3, 2.7 and the tiles all show,
  and if it moves when a screen changes, a screen has grown a second
  implementation. Nothing existing measures it.

Every measurement's before and after goes in the commit message of the change
that moved it.

### 7.4 The walkthrough — the first-session script, driven

The `verify` skill has the pieces (`playwright-session.mjs`, the cleanup
script) and no script that walks the app the way a user will. Write one,
under `.claude/skills/verify/files/first-session.mjs` (Playwright stays out
of `package.json`, as the skill insists), that does **exactly what Matthew will
do in his first session**, against a `__QA` copy.

**It never calls the model** (§0.2). Steps 3–4 upload a synthetic bill, which
is parsed by code and costs nothing. Steps 5–9 run on a `__QA` copy of an
already-staged pack — the sandbox Panther runs, or `qa:demo`'s project — so
the drawings review, the confirm and the record all exercise real staged JSON
without a charged read. The script refuses to upload a specification document
and says why; a release gate that costs money is a release gate people skip.

1. Sign in; check the chip and `/api/auth/me`.
2. Create a project; set the client and the programme dates.
3. Upload a pack: a synthetic bill (two tabs, a `PACK` line, an `SX11A`
   duplicate) and two synthetic specification sheets. Assert the classifier's
   answers and that the charge is stated before upload.
4. Review the bill: assert the header message (1.2), the non-furniture
   suggestions (1.5); ignore them; confirm. Assert the record count.
5. Open the pack: assert one summary line (1.6) and the three review states
   (1.7).
6. Review a drawings card: assert the TBC marker is a state (1.8), the
   picture crops or says why (1.9), the swatch reaches page 2 (1.10), the
   level control is a button (1.15); confirm on the copy.
7. Open the phase table: assert "phase" (1.1), expand the to-quote cell (1.12),
   open an item.
8. On the record: correct a value (1.13), assert the cell recomposes and the
   version increments; assert no ordinal (1.3); read the two-count sentence
   (1.4).
9. Open the chase screen: assert the TGQ preselection (1.14); draft; download
   the `.eml`; open it as text and assert the tier banner and the grouping.
10. Force one failure — a stale version on the answer PATCH — and assert the
    409 reaches the row and the row unfreezes.
11. Clean up with the manifest the run wrote.

It runs against local before a push, against staging on the deployed SHA, and
against pilot before a promotion. It is not a substitute for Matthew; it is
the thing that catches the wall before he hits it. Its console/network failure
collector is read at the end, every run — *a failed API call in this app
usually renders as an empty list rather than an error*.

### 7.4a Visual review, before it reaches Max

Max, 2026-09-19: *"I shouldn't be having to say the table's not being shown on
the page, it's getting compressed, or the image is overlapping with text.
That's not what I'm here for. I'm here for seeing the end product and saying
yeah, that works, or no, it just doesn't feel right."*

So there are two reviews of every screen and they are not the same review.
**Does it look right** is Fable's, done with screenshots before a change is
reported. **Does it feel right** is Max's and Matthew's, and it is the only
question they should be spending their time on. A layout fault that reaches
Max is a failure of this step, whatever the tests said.

**How it is done, for every item that touches a screen:**

- **Screenshot every affected screen, full page, at the size it will be used
  at.** The end user is on a standard monitor: **1920×1080 at 100%** is the
  primary size, **1440×900** the second (a laptop beside the monitor). The
  browser pane's default size is neither, and a screen that fits the pane and
  not the monitor has not been checked. Screenshots go in the session
  scratchpad, never the repo, and the report names each one.
- **Walk the checklist against each screenshot**, and write the answer down
  rather than glancing:
  1. Is everything that should be on the page on the page — every table,
     every tile, the header band, the tabs, the chip?
  2. Is the primary action where §0.3 puts it, and visible **without
     scrolling**?
  3. Is anything overlapping, clipped, compressed to a column, or wrapped to
     six lines? (The design-language doc lists the DOM traps that do this
     silently: a spanning panel not in its own `<tr>`, `overflow-hidden` on a
     sticky-header wrapper, CSS `line-clamp` on a block, a picture not in its
     grid track.)
  4. Do the two content widths hold — 1100px or 1400px, nothing in between —
     and does the header title keep its floor beside the action cluster?
  5. Does it match its tab in `docs/design/spec-builder-mockups.html` like for
     like — same bands, same tiles, same columns — not "inspired by"?
  6. Dark mode and the chip: is the environment marker present?
- **Then the 300 test.** *"A lot of the demo data might have 15 lines. What
  happens when it has 300?"* Every list screen — the phase table, the BOQ
  review, the pack, the drawings review, the chase screen, the infill screen,
  the finishes library, the inbox — is screenshotted again with a **300-line
  fixture** loaded (a `__QA` project; `qa:demo` gains a `--lines=300` option so
  the fixture is one command), and four things are checked that fifteen
  lines can never show:
  - **No action that a person needs lives only at the bottom.** Confirm,
    Draft the email, Ignore all suggested, Export: each is in the header band
    or sticky, reachable from row 1 and from row 300 without a scroll to find
    it. A button at the foot of a 300-row table is a button nobody finds.
  - **The header row and the filters stay put** while the table scrolls, and
    the filters narrow what is listed without losing the selection or the
    counts (the rule the chase screen already holds).
  - **The page renders in under two seconds** and does not paginate silently.
    If it needs paging or virtualisation, the screen says how many rows there
    are and how many are shown, in words.
  - **The summary line stays one line** — 300 documents on the pack screen is
    the case 1.6 exists for.
- **Fix before reporting.** A visual fault found here is fixed in the same
  item, not filed. The report says the review was done, at which sizes, with
  which fixture, and names the screenshots. If it was not done, the report
  says so and the item is not done (§7.1, *Looks right*).

**Who.** Fable, or an Opus verifier briefed with this section and the
checklist, using the built-in browser at the two sizes. Never the coder who
built the screen — the first eleven component tests found a defect the
builder had not seen, and screenshots are the same principle.

**What this does not replace.** The first-session script (§7.4) checks that
the flow works; this checks that it looks right; Max checks that it feels
right. Three reviews, three questions, and the third is the only one that
needs a person.

### 7.5 The "does it make sense" review, after building

For each design-first item (§2.4), after it is deployed to staging and before
it is promoted to pilot: Max drives it as the role it is for, with the design
note open, and answers three questions in `docs/plans/README.md` — *does it do
what we set out to do; is this the right way to do it; what did driving it
show that the design did not.* A no on the second is a redesign, not a
polish. The user's words: *"let's not be afraid to rejig a few things."*

### 7.6 Stage close

At the close of each stage, Fable re-reads this plan's stage table and the
catchup's §6 and writes, per item, the evidence for each row of §7.1 — against
the deployed SHA, not the commit list. Re-measure §1's table. Anything that
does not have evidence goes back into the stage; the stage is not closed by
declaring it closed. Then the `found-in-use.md` sweep: every entry the stage
was meant to fix reads FIXED with a commit, or its status says why not.

### 7.7 Matthew's findings become entries, not fixes

D4's format — a screenshot and a written explanation — arrives as a
`found-in-use.md` entry, dated by when he saw it, in his words, with the cause
separated from the observation. The entry is grouped into the next stage by
Fable; **nothing is fixed straight from the message**, which is the habit that
produced sixty commits without acceptance.

---

## 8. Stage 3 — needs an answer first, so do not start it

Unchanged from the catchup's §6 Stage 3, with the questions that gate each.
Listed so nobody builds one on a guess.

| # | Item | Waiting on | Notes added by this plan |
|---|---|---|---|
| 3.1 | Two-part versioning (D2) | Max's answer stands in: client V1, internal 1.1…, an issue moves the **project** V1→V2, sign-off does not bump — **confirm with Matthew** | Probably a display rule over `baseline_members`: an issue is a named baseline of kind `issue`; the major is the count of issue baselines; the minor is versions since. No new scheme, no stored number |
| 3.2 | Substrate | Q4: per item (provisional); satisfies TGQ (a gate conditional); BWS field 192 exists | Design the conditional in `spec_field_gates` (a `conditional` column exists) before touching a screen |
| 3.3 | Product code | **Q3, the live disagreement**: Max says the client's BOQ code; Matthew's own seed note says the BWS boilerplate, derived. Show him his note | Either reading is ~10 lines; the wrong one satisfies a gate on a different fact from the one it names. `pickBoilerplate` already derives and refuses ambiguity |
| 3.4 | Anything touching the BWS export | Tim's importer contract, in writing (item C) | Fold `questions-for-matthew.md` into the same conversation |
| 3.5 | Item pictures on a public URL | a decision about NDA material | not on one sentence |
| 3.6 | Finishes-schedule extraction (+ view regions, 1.9, + a placement field, 0029's note) | a decision to pay for re-reading every document, **once**, with every tool-schema change batched | The re-read is `reread:drawings`; the schema changes are three and should land together |
| 3.7 | SharePoint folder as an intake source | confirm it is wanted | — |
| 3.8 | TOE dates and calculator | his next phase | — |
| 3.9 | The level grey-out | **checked: nothing hides a field by level today**; sort + grey is the whole change | Small; do it in Stage 2 if Matthew's first session says the level noise bothers him |

**Not from the meeting.** The four below are `CLAUDE.md`'s own *STILL OPEN*
lines, carried here so a coder does not build one thinking it was asked for.
None has a source in the catchup or in `found-in-use.md`; each waits for
Matthew's first session to say whether it matters.

| # | Item | Waiting on | Notes |
|---|---|---|---|
| 3.10 | A configuration's quantity | nothing lets a person set one; the gap is reported everywhere | one field, one route, when somebody hits it |
| 3.11 | Splitting a record that already carries specs | `ensureVariant`'s guard; no path to move specs onto a configuration | design needed; thirteen sandbox records are in this state |
| 3.12 | What the email review does with a fabric stated for a configuration that does not exist | Max's decision | — |
| 3.13 | Where a client's *new question* in a reply goes | see §5.4 | — |

---

## 9. After all of it — the first production version

Max: *"at some point we need to create the first production version …
probably after we've done all of this, so we'll leave it for now."* Left for
now, as asked. **Nothing here starts before Stage 2 closes and Matthew has
accepted the pilot**, and the plan for it is written then, not here.

Three things decided in Stage 1–2 will shape it, and are the only reason this
section exists: the pilot environment (1.16) is the dress rehearsal for a
physically separate production, so its promotion checklist should be written
as if it were; the rate cap (2.10.f) is a production requirement being built
early; and `environments.md`'s four KNOWN GAPS of 2026-09-12 — shared
database, no blob store, production undefined, manual backups — are the list
that production planning starts from. `house/deployment.md` governs, and
production requires explicit authorization for every action, every time.

---

## 10. Decisions this plan takes, that Max should overrule if wrong

Each is a call made here so the coders are not left to make it. Reversing any
of them is cheap now and expensive after Stage 2.

1. **API paths and parameters keep `run`/`runId`**; only words on screens and
   in documents change (1.1).
2. **Non-furniture lines are suggested, never auto-ignored** (1.5).
3. **The TBC marker is a state**, extracted only from the ends of a value,
   never from the middle (1.8).
4. **A correction is a supersession that keeps the page**, requires a reason,
   and never edits a row in place (1.13, §5.2).
5. **The infill screen and the chase screen are two screens sharing one
   loader** (§5.3).
6. **The dimension qualifier is a record column composed by the single
   composer**, not an attribute (2.6).
7. **Project-wide answers fan out to every record's row**; there is no
   `project_answers` table (2.8).
8. **Auto-assignment acts on the two strongest routing signals only** and
   waits for the rate cap (2.11).
9. **The pilot is a third environment with its own Neon project**, a `pilot`
   branch that only fast-forwards, and its own chip (1.16).
10. **The level control on drawings writes only on a person's click** and the
    BOQ guess stops firing on suggested non-furniture lines (1.15).
11. **The first-session script is the release gate** for staging → pilot
    (§7.4), and it never calls the model.
12. **Sizes and order in §4 and §6**; two coders at once; Fable does not write
    application code.
13. **No plan per stage** — a one-page stage brief appended here, and a design
    note in §5/§6 for the four design-first items (§2.5). **Agreed by Max,
    2026-09-19.**
14. **Stage 1 is split into 1a and 1b** on walls versus friction, and 1b is
    promoted to pilot once, not item by item (§4).
15. **The simplest version is the default** and complexity must name its trap
    (§0.2); **the next step is every screen's primary action**, never a line
    of text (§0.3).
16. **Visual review is Fable's job and happens before Max sees a screen**
    (§7.4a): screenshots at 1920×1080 and 1440×900, the checklist answered in
    writing, and the 300-line fixture for every list screen. Max's review is
    "does it feel right" only. **Asked for by Max, 2026-09-19.**
17. **SharePoint is the source of real test data, read-only and read once**,
    staged into sandbox `TEST` projects that stay, named for what they
    exercised; `__QA ` copies are swept; the repo's fixtures stay synthetic;
    the Panther pilot stays curated (§2.7). **Authorised by Max, 2026-09-19.**

---

## 11. Questions this plan adds for Matthew

The catchup's §7 questions stand (Max's stand-in answers are in
`matrix-assumptions.md`). These are new, raised by designing the items above.
Ask them in the same message as the screenshots come back, not before.

| | Question | Gates |
|---|---|---|
| A | **Which questions are project-wide?** Our reading: the commercial block on every sheet (TOE, sales folder, …). Confirm the list | 2.8 |
| B | **Correcting a value: does the corrected value need the client's confirmation before it is *confirmed*, or is our reviewer's correction enough?** Our reading: the reviewer's correction is confirmed if the page says so, TBC otherwise | 1.13 |
| C | **In a handover meeting, is one "change" per meeting the right grain**, or one per item? Our reading: per meeting, with the evidence being the invite | 2.3 |
| D | **The tiles** — our proposal in §6.9. Yes, or say what instead | 2.9 |
| E | **Should the level guess exist at all** (§3.5), now that a person can set it on the drawing? | 1.15 |
| F | **An email that arrives with the spec in an attached PDF** — how often? It decides whether 2.10.c's attachment path is a button or a pipeline | 2.10 |

---

## 12. Still open, and honestly so

- **Nothing in this plan is built.** It was written on 2026-09-19 from the
  catchup document, `found-in-use.md`, and a read of the code; every size is
  an estimate and every design decision in §10 is untested.
- **The baseline in §1.1 is whatever the run said**, including the seven red
  db-tier tests. Stage 0.3 exists because of it.
- **Matthew's first project is not known** (0.2), so the variance matrix's
  priority order is a guess until it is.
- **The BWS account does not exist**, so 2.1 and 2.2 cannot start and Stage 2
  begins with 2.3.
- **Claude usage headroom** bounds how many coders can run. Two at once is the
  plan; one may be the reality on some days.
- **The progress tracker plan is another session's uncommitted file.** This
  plan sequences it and does not own it.
- **`docs/integration.md` still describes the old mailbox model** (README,
  2026-09-17). It is not in this plan's scope and should be.
- **Human acceptance is outstanding on every screen**, and will be until
  Matthew's screenshots arrive. That is the whole point of Stage 1 closing
  with a hand-over and not with a commit.

---

## Stage briefs

Appended at the start of each stage (§2.5). A stage brief schedules; it does
not re-decide an item.

### Stage 0 brief — opened 2026-09-19

Max: *"let's start Stage 0, fix the seven red tests."*

| | |
|---|---|
| **Order** | 0.3 first (the red tests), then 0.4 (the `checks` script and the db-tier guard), then 0.5 (the pilot environment, which needs Max at the Vercel and Neon consoles). 0.1, 0.2 and 0.6 are not code and run alongside |
| **Coders** | One Opus coder on 0.3, in a worktree; 0.4 follows on the same branch once 0.3 is green, because the guard is only worth adding to a suite that passes |
| **Files** | 0.3 touches `tests/db/chase-drafts.test.ts`, `tests/db/intake-routes.test.ts`, `tests/db/project-overview.test.ts`, and whatever guard or query in `src/lib` a real defect turns out to live in. 0.4 touches `package.json` and one file under `tests/setup/` or `tests/db/` |
| **Migrations** | none expected. If 0.3 needs one, it stops and says so — a red test is not a reason to change the schema |
| **`db:migrate` / sandbox** | Fable. No coder runs it |
| **Re-measured today** | the three red files re-run before briefing: **8 failed, 66 passed** — one more than the baseline. `project-overview` › *refuses an empty change* fails with the record's version moved (17 where 16 expected), most likely contamination from the timed-out test before it; the brief tells the coder to run it alone first |
| **Readings given to the coder** | the three `chase-drafts` failures are probably stale tests describing the level-based fallback for a category the matrix now covers; the two `intake-routes` fixture failures probably predate `schemaVersion: 2`; the split-guard message is probably a real guard-order defect; the timeout may be a real performance finding for the projects list. Each is a hypothesis in the brief, to be verified by reading before acting, and the trap named: *make the assertion match whatever the code does now* |
| **Close** | full suite green with the db tier proven to have run; typecheck, lint and build clean in the worktree; commits cherry-picked onto `staging` by Fable and pushed; §1.1 re-measured; this brief updated with what each of the eight turned out to be |

**0.3 closed, 2026-09-19.** One Opus coder, one worktree, one commit
(`a96e44f` on `staging`, cherry-picked from the worktree branch). **No
application code changed.** Every one of the eight was a fixture describing
the world before a design decision, or a timeout measured rather than assumed:

| # | Test | Was | Rule it now holds |
|---|---|---|---|
| 1–3 | `chase-drafts` tier tests | **stale fixture** — its category query took the first sheet with three questions and got `sofas-bed-daybeds`, one of Matthew's nine, which since 2026-09-18 needs no level. Now pinned to a sheet his matrix does not cover | 0019's fallback: where the matrix does not reach, a level is required and `tgq_levels` decides |
| new | *chases a level-less record where Matthew's matrix covers its category* | **added** — nothing at the route tier held the other half | a mapped category needs no level; the tier comes from his matrix |
| 4 | *keeps a corrected figure in its slot* | **stale fixture** — `stageDrawings` only emits `schemaVersion: 2`, so a test about the FROZEN v1 guess pipeline was holding nothing. An `asVersion1` helper strips the model's answers rather than relabelling | the v1 read-time pipeline does not re-guess a correction away; still live for nine unre-read runs in the sandbox |
| 5, 6 | the two configuration tests | **stale fixtures** — two pages of one code no longer letter anything without the model's `configurations` answer, so both pages wrote to the bill line and collided. The fixtures now carry the answer | a page count is not evidence of a split; `ensureVariant`'s guard fires once a split is attempted |
| 6 | the guard-order reading in the brief | **wrong, and the coder said so** — `ensureVariant` already runs before the occupancy read; the occupancy message was the correct refusal of a *different* request | — |
| 7 | *hides an archived project* | **performance finding**, measured: `GET /api/projects` takes 1.5–2.1s per call against 6 active / 9 total projects and 11,673 answers, and the test makes four calls (9.3s). Not an N+1; the route's own header names the fix (make `loadOutstanding` lazy). Bound raised to 30s **as a documented stopgap**; logged in `found-in-use.md` | unchanged |
| 8 | *refuses an empty change* | **contamination** — test 7's in-flight PATCH landed after teardown and bumped the version. Passed alone; fixing 7 fixed it | unchanged |
| + | *RECOMPOSES its own answer as later slots arrive* | surfaced in the full run only: 3.7s alone, timed out at 5s under contention. Given the 40s the configuration tests beside it carry | unchanged |

Proven on `staging` by Fable, not by the coder's report: **1,243 passed · 1
skipped · 0 failed**, db tier on. Typecheck and lint clean (the two
pre-existing warnings are in the meeting-recap skill's harvester). Build clean
in the worktree. Deployment state: **pushed** once this brief is committed;
documentation and tests only, so no deployment matters.

Two observations out of scope, recorded and not fixed: the slow projects list
(now in `found-in-use.md`), and that several db-tier tests sit within a second
of the 5s default against a remote database — a file-level `testTimeout` for
`tests/db/` in `vitest.config.ts` would stop this recurring one test at a
time, and belongs with 0.4.

**0.4 and 0.5 opened, 2026-09-19**, two coders in parallel, disjoint files:
0.4 holds `package.json`, `vitest.config.ts` and the db-tier skip helper; 0.5
holds `env.ts`, `script-env.mjs`, the chip, `.env.example`,
`docs/environments.md` and the `verify` skill. The console half of 0.5 —
the Vercel project, the Neon project, the blob store — is Max's, and the doc
0.5 produces is the checklist for it.

**0.6 drafted, 2026-09-19 — NOT SENT.** Sending waits for two things: the
pilot link (0.5's console half) and Stage 1a closing (the plan's own rule —
the link goes out when the first-session script runs clean on pilot, not
before). The draft is here so it is ready that day. Max sends it from his own
Outlook; there is no send path in this app and the org rule makes sending a
write.

> **Subject: Spec Builder — your login, and how to tell me what's wrong**
>
> Matthew,
>
> Here is the build for you to use: `<pilot URL>`. Your login is
> `<email>`; I'll send the password separately. This build is yours: it
> has its own database, nothing I push day to day reaches it, and I'll
> tell you before anything on it changes. The chip in the top bar reads
> **PILOT** so you can tell it apart from anything else I show you.
>
> As agreed on the 18th: start with `<the project you named>`, not the
> 300-line one. Load the pack the way you would for real.
>
> When something is wrong, or you can't find the thing you want to do:
> take a screenshot and write me a few sentences — what you were trying to
> do, what you expected, what happened. Send them in a batch whenever suits
> you; I won't fix them one at a time, I'll group them, so don't hold one
> back because it seems small. "I couldn't find where to…" is the most
> useful sentence you can send.
>
> Two things you'll notice that are deliberate: a level (simple / complex /
> hero) is suggested and never set for you — it needs your click; and a
> value read off a drawing shows the page it came from, so if a number
> looks wrong, the page is one click away.
>
> Six short questions are attached — no rush, answer them alongside the
> screenshots rather than before you start.
>
> Max

The six questions are §11 of this plan (A–F); the catchup's §7 questions
have Max's stand-in answers already and go in the same message only where
one needs Matthew to overrule (Q3, product code, with his own note quoted).

**0.4 and 0.5 landed, 2026-09-19** (`201a4b5`, `2e70220` on `staging`,
cherry-picked from the two worktrees). Both reviewed against §2.3 before
landing; neither widened scope.

- **0.4:** `npm run checks` runs the four checks with the database tier
  REQUIRED (`REQUIRE_DB_TESTS=1`). The twenty-five files that each declared
  their own `describeIfDb` now import one (`tests/db/db-tier.ts`), which also
  carries a 30s suite timeout for the db tier alone — pure and component keep
  the 5s default and a test proved both directions. The refusal is one test
  (`require-database.test.ts`), so a missing `DATABASE_URL` fails once rather
  than twenty-six times. `.claude/worktrees/**` is now ESLint-ignored, because
  a coder's worktree was 149 of this repo's lint errors for an hour.
- **0.5:** `pilot` is a third `APP_ENV`/`DATABASE_ENVIRONMENT` pair, paired in
  both directions; `--yes-pilot` mirrors `--yes-production` and does not cover
  it; `qa-clean` now requires `sandbox` exactly (it refused `production` only,
  and would have swept Matthew's data); the chip reads PILOT in the `live`
  tone and the title marker comes from the same function;
  `docs/environments.md` carries the pilot column, the console steps and the
  promotion checklist; 18 new tests.

**The console half of 0.5, as far as it went today.** Neon project
`SpecBuilder Pilot` (`sweet-tree-21270018`, London) exists, its default branch
named `production` by Neon. The Neon CLI is installed under `~/.npm-global`
and linked in this directory; `neon.ts` is the two-line config Max gave;
`neon deploy` reported no changes. `.env.pilot.local` holds the direct
connection string, git-ignored. The `pilot` git branch exists on the remote at
the `staging` tip of the time (`b0675eb`) and has NOT been fast-forwarded to
the 0.5 code yet. Vercel project, blob store and environment variables are
still Max's to create; migrations wait for that and for the storage decision
below.

**An incident on the way, reversed.** `neon link` pulled the pilot project's
`DATABASE_URL` into `.env.local`, the sandbox env file, and said so in one
INFO line. For six minutes every db run in this checkout pointed at the empty
pilot database while still declaring `sandbox` — the exact declaration-not-
probe trap of `house/conventions.md` §3. Restored from the sandbox project's
own connection string (direct endpoint), verified by count (9 projects, 32
migrations), both coders told to discard runs in the window. `neon deploy`
has the same default and was run with `--no-env-pull`. Recorded in
`docs/environments.md` by 0.5.

**Stage 0 is NOT closed, and the reason is a Neon storage ceiling.** Both
coders hit it independently at about 18:20: every write to the sandbox fails
with *could not extend file because project size limit (512 MB) has been
exceeded*. Measured: the database is 489 MB, `audit_log` is 460 MB of it, and
343 MB of that is two QA actors (`__qa@example.test` 217 MB, `qa` 126 MB) —
before-and-after JSON for test rows the cleanup deleted long ago, which the
cleanup never touches because the table is append-only by trigger and
`house/conventions.md` §12 says leave it alone. It grew 50–140 MB a day this
week. **The close condition "db tier proven to have run" cannot be met until
Max decides how to free the space**; the options are in `found-in-use.md`
under 2026-09-19. The 0.4 commit's own db-tier proof is the coder's green
run at 18:13, the last one with room; 0.5's is its 18:16 run.

Left behind by the wall: the 0.5 coder's `qa-clean` attempt failed part way
(it is not transactional), so one `__QA` project may be missing its drafts
and contacts rows and still exist. Re-running the sweep once space is freed
finishes it. Seven `__QA` projects are in the sandbox.

**Stage 0 CLOSED, 2026-09-19, later the same evening.** Max raised the Neon
plan (option 1 in `found-in-use.md`); nothing was deleted from the audit log.
The seven `__QA` leftovers were swept with `db:qa-clean` (which has no dry-run
mode and applies on the first run — worth knowing). Then `npm run checks`,
the new script, with the database tier REQUIRED:

| Check | Result |
|---|---|
| lint | 0 errors, the 2 pre-existing warnings |
| typecheck | clean |
| test, db tier on and required | **1,262 passed · 1 skipped · 0 failed** |
| build | clean |

Against Stage 0's own close condition: suite green with the db tier proven
to have run — yes; pilot answers `/api/auth/me` with its own name — **not
yet**, the Vercel project does not exist; Matthew has a login he has not used
— **not yet**, no user is created on pilot (Max creates it, because it needs a
password and Matthew's address). Those two are the remaining console half of
0.5 and 0.6, and neither is code.

**Pilot, as left tonight.** `pilot` fast-forwarded to `ded4dcf`, the `staging`
tip, so its first deployment will start. The pilot database has all 32
migrations and 10 seed files applied, 797 requirements, 56 spec fields, 0
projects, 0 users — seeds only, as the rule says. The doc's env-file name was
corrected to `.env.pilot.local`, the name the `.env*.local` pattern already
ignores, so no `.gitignore` change was needed.

**Still open from Stage 0, carried into the plan rather than lost:**

- The sandbox will fill again at 50–140 MB a day of test audit rows. Option
  3 (run the db tier against a throwaway Neon branch per run) is the durable
  fix and is added as **item 0.7**, not started: it belongs with `checks`,
  and a plan of ~500 MB headroom a week is a plan with a date on it.
- The projects list at ~2s per call (`found-in-use.md`), unchanged.
- The chase draft's `[STAGING]` prefix and redirect will read `[STAGING]` on a
  pilot draft (0.5 coder's observation); the safety holds, the word is wrong.
  A Stage 1b line item, cheap.
- The two Neon dependencies `neon config init` added to `package.json` are
  uncommitted and Max's to keep or drop.

**Later still, 2026-09-19: the Vercel project exists and two logins are on
pilot.** Max created `spec-builder-pilot` at the console. Two users were
created through `tools/create-user.mjs --yes-pilot` (the guard refused the
first attempt without the flag, printing the host first — the script working
as written): `matthew@benwhistler.com` (Matthew Lewis) and
`demo@benwhistler.com` (Demo), both `editor`. Editor rather than admin because
`WRITER_ROLES` treats them alike for every write and nothing in the app is
admin-only yet — least privilege until something is. Passwords were generated
once and handed to Max in the session, to be sent separately from the link;
the same script upserts by email, so either can be reset with one command.
The pilot URL is not yet known to this repo (the default `.vercel.app` slug
does not resolve), so `/api/auth/me` on pilot and the PILOT chip are still
unverified. 0.6 remains: the hand-over message is drafted above and waits for
Stage 1a.

### Stage 1a brief — opened 2026-09-19

Max: *"ok lets go with stage 1a."* Ten items: 1.1, 1.2, 1.3, 1.4, 1.8, 1.11,
1.12, 1.13, 1.14, 1.16. Nothing here re-decides one.

| | |
|---|---|
| **Order** | **Round 1:** 1.1 (coder A) beside 1.8 (coder B). The rename goes first and alone in its stream because it touches 29 screen files — every later item rebases onto "phase", or the tree carries two vocabularies for a week. **Round 2**, once 1.1 is on `staging`: 1.2 → 1.3 → 1.4 (coder A, same worktree, one commit each) beside 1.14 (coder B, after rebasing onto the rename — the chase screen is in both). **Round 3**, once A's four are on `staging`: 1.11 → 1.12 → 1.13 (coder C, one worktree) beside the verifier writing the first-session script and the 300-line fixture (§7.4, §7.4a). 1.16's code half landed in Stage 0.5; its console half is Max's and runs alongside |
| **1.13 and §2.4** | The design is §5.2 of this file, written before Max said go. "Go with 1a" is taken as covering it, and 1.13 is deliberately LAST in the coder order so that Max can overrule §5.2 before it is briefed. A coder who finds §5.2 wrong stops and says so |
| **Coders** | Two at once, never three: A and B in round 1 and 2, C and the verifier in round 3. Each in its own worktree under `.claude/worktrees/` (ESLint-ignored since 0.4), off `staging`, no `.env.local` — every 1a test is pure or component and the db tier skipping is correct for them, except 1.13's, which the Fable session runs against the sandbox after cherry-picking |
| **Files — A** | user-facing strings in `src/components/**`, `src/app/dashboard/**`, `src/lib/intake-status.ts`, `docs/*.md`, `docs/plans/*.md` (screen descriptions only — the TABLE keeps its name, and this plan's own stage briefs are not touched); a new `tests/lib/vocabulary-guard.test.ts`. Then `src/lib/boq-import.ts` (the header message's shape only), `src/app/dashboard/imports/[id]/page.tsx`, `tests/lib/boq-import.test.ts`; `RecordChecklist.tsx`, `AddSpec.tsx`, `GatePanel.tsx`, `tests/components/record-checklist.test.tsx`; `src/app/dashboard/records/[id]/page.tsx`, `tests/components/gate-panel.test.tsx` |
| **Files — B** | `src/lib/drawing-document.ts`, `src/lib/spec-vocab.ts` (only if a token is missing), `src/components/imports/ObservationRows.tsx` and `DrawingItemCard.tsx` (how a tbc state shows, nothing else), `tests/lib/drawing-document.test.ts`, `tests/lib/bws-export.test.ts`. Then, after the rename lands: `src/app/dashboard/drafts/page.tsx`, `src/components/drafts/ChaseQuestionTable.tsx`, a new `src/lib/chase-selection.ts` and its test, `tests/components/chase-question-table.test.tsx` |
| **Files — C** | new `src/lib/next-step.ts` + test; `src/app/dashboard/projects/[id]/page.tsx` (header primary), `src/app/dashboard/imports/[id]/page.tsx` (BOQ success state), `DrawingsReview.tsx` and `PackDrawingsReview.tsx` (the *Review complete* box's link), `SpecTable.tsx` and `tests/components/spec-table-outputs.test.tsx`; then new `src/lib/attribute-correct.ts`, new `src/app/api/attributes/[id]/correct/route.ts`, `src/lib/change-sets.ts`, the record's Specs tab, `db/migrations/0033_attribute_correct.sql`, new `tests/db/attribute-correct.test.ts`. C never touches the export, `promote-answers.ts` or `attribute-retire.ts` beyond calling them |
| **Nobody's** | `CLAUDE.md`/`AGENTS.md` (Fable), `src/lib/bws-export.ts` except a test, every migration before 0033, `loadExportScope` |
| **Migrations** | ONE: `0033`, adding `attribute_correct` to the change-set kinds. It re-lists the CHECK from the LIVE constraint (`\d+ change_sets` on the sandbox), not from 0032's text — the 0028/0032 lesson. Written by coder C, applied by Fable |
| **`db:migrate` / sandbox** | Fable. No coder runs it |
| **Fable's own** | this brief; `CLAUDE.md`/`AGENTS.md`: "run" → "phase" in the vocabulary (landing in the same push as 1.1, so the two files never disagree with the screens), the correction verb in the editing section after 1.13, the Stack section's three environments; a dated line per item in `docs/plans/README.md`; the fifteen `found-in-use.md` findings 1, 7, 9, 11, 12, 13, 14, 15 marked FIXED with commit; the §2.3 review of every diff before its checks; the four checks with the db tier REQUIRED before every cherry-pick; the §7.4a screenshots at 1920×1080 and 1440×900, by Fable or the verifier, never the coder |
| **Grey zone, ruled now** | An `intake_runs` row is a DOCUMENT READ, not a phase. Where a screen says "run" meaning that (the pack screen's "this run failed", "Read all"), the word is *read* or *document*, never *phase*. Coder A lists every such string in the commit body; anything not on the list that the guard's allowlist admits is a review question |
| **Close** | the ten items each have §7.1's rows written as facts against the deployed SHA; `first-session.mjs` runs clean on staging, then on pilot after one promotion by the `docs/environments.md` checklist; `CLAUDE.md` says "phase" and carries the correction verb; the 0.6 message goes with the pilot link, sent by Max. **Then stop and wait for screenshots** |

**Stage 1a, as of 2026-09-20 midday.** All ten items are built, checked with
the database tier required, driven in the browser on the sandbox and on
`staging` (`docs/plans/README.md`, 2026-09-20, has the per-item evidence).
Three things stand between this and the close: the first-session script and
the 300-line fixture (the verifier, in progress), the pilot's console half
(Max), and the hand-over message (Max, §0.6). Migration 0033 is applied to
the sandbox and NOT yet to pilot — it goes on the promotion checklist.

**Stage 1a CLOSED on `staging`, 2026-09-20.** Against the plan's own close
line — "its ten items meet §7.1, the walkthrough script runs clean on staging
and then on pilot, `CLAUDE.md` says phase and carries the correction verb, and
Matthew has the link" — three of four are done and the fourth is Max's:

| §7.1 row | Evidence |
|---|---|
| Built · Tested | ten items, 1,412 tests green with the database tier REQUIRED at `f888e1e`; every diff reviewed against §2.3 before its checks; three items came back from review with a real finding (1.4's cause, 1.13's finish fixture, the null-state crash) and none was accepted until fixed |
| Variance | every case named in the items is tested or driven; the per-item lines are in `docs/plans/README.md`, 2026-09-20 |
| Findable | projects list → project → primary → item → Checklist is four presses on AP364c, pressing the primary each time (1.11); the first-session script presses them too |
| Simplest | each brief named the simplest version and the trap; the two places complexity was kept are recorded as decisions for Max — the two chase counts stay two numbers, and the correction is a supersession |
| Looks right | nine screens screenshotted at 1920×1080 and 1440×900 on the `3b6d9db` deployment: no horizontal overflow, the chip on every screen, one primary per band after `9b626eb`; the 300-line fixture DEMO-300 exists and its overview renders in 10.4s — recorded as open, not fixed |
| Failure path | the 409 on a stale answer PATCH reaches the screen with nothing written (the script's step 10, run against the deployment); the checklist deep link that crashed was found and fixed |
| Deployed | `3b6d9db` (1a complete) and `b76cfb0` (1b's drawings items) on `spec-builder-app-rho.vercel.app`, each SHA read back from `/api/auth/me` and the flow driven on it |
| Recorded | `README.md` per item; `found-in-use.md` findings 1, 7, 9, 11, 12, 13, 14, 15 FIXED with commits; `CLAUDE.md` says phase and carries the correction verb |
| Accepted | **outstanding on every item**, until Matthew or Max has driven it |

**The first-session script, run against the `b76cfb0` deployment on 2026-09-20: `PASS 20 · FAIL 0 · SKIP 8`** — the eight skipped are 1.13 (its assertion is written and waits to be turned on), 1.15 (on staging since `b76cfb0`, the script's skip is stale), 1.5/1.6/1.7 (1b, in progress), 1.9/1.10 (a clone has no page preview, by design) and the 409 row-unfreeze half that needs 1.13's control. Turning 1.13 and 1.15 on is a small edit to the script, queued.

**Not done, and not this repo's to do:** the promotion to pilot (migration
0033 first, then the fast-forward, by `docs/environments.md`'s checklist),
the first-session script run on pilot, and the 0.6 message with the link.

### Stage 1b brief — opened 2026-09-20

Max, 2026-09-20: *"keep going until you have completed the whole of stage
1."* The plan had 1b waiting for Matthew's first screenshots; that wait is
lifted by that instruction, and 1b is built on `staging` in the same way as
1a. The promotion to pilot stays ONE deliberate step by Max, after the
first-session script runs clean on staging. Six items: 1.5, 1.6, 1.7, 1.9,
1.10, 1.15.

| | |
|---|---|
| **Order** | Two coders, disjoint files. **Coder B (intake screens):** 1.5 → 1.6 → 1.7, one commit each — the BOQ review, then the pack screen twice. **Coder D (the drawings card):** 1.10 → 1.15 → 1.9 — the swatch page selector, then the level control, then the crop INVESTIGATION, which stops at a measurement and a conclusion where the fix is the prompt (a re-read is charged and lands with the finishes-schedule schema change, not here) |
| **Files — B** | new `src/lib/non-furniture-guess.ts` + test; `src/lib/boq-import.ts` (the staged line gains `nonFurnitureSuggested`, read-time computed for old runs); `src/app/dashboard/imports/[id]/page.tsx`; `src/lib/level-guess.ts` (`guessLevelFromBill` does not fire on a suggested non-furniture line); `src/app/dashboard/projects/[id]/intake/[batchId]/page.tsx` and a new `src/components/imports/PackSummary.tsx` if the page is not testable as a component; new `tests/components/intake-pack.test.tsx`; the BOQ confirm db test gains the ignore/restore case |
| **Files — D** | `src/components/imports/SwatchPicker.tsx`, `DrawingItemCard.tsx`, `ConfigurationCard.tsx`, `ItemImagePicker.tsx`, `src/lib/pdf-crop.ts`, `src/lib/level-guess.ts` (reading `guessLevelFromAttributes` only), the levels route under `src/app/api/projects/[id]/levels/`, `tools/measure-drawing-reading.ts` + a pure view-region helper; new `tests/components/swatch-picker.test.tsx`, `tests/lib/pdf-crop.test.ts`. **Never** the extraction prompt or tool schema (`anthropic.ts`, `extraction-schema.ts`) |
| **Nobody's** | `CLAUDE.md`/`AGENTS.md`, the export, `confirm-drawings.ts`'s confirm request shape (a level is not part of what a card confirms), migrations |
| **Migrations** | none expected. 1.15 writes `spec_records.level` through the existing levels route |
| **Measurement** | `npm run measure:drawings` before and after 1.9, run by Fable against the sandbox's staged runs; the numbers go in the commit body. 1.9 may CONCLUDE rather than fix |
| **Fable's own** | the four checks with the db tier required before every cherry-pick, each gated on its own exit code (the 1.4 push went out on the build's code alone — never again); the browser walk of each DoD on the sandbox; `found-in-use.md` findings 2, 4, 5, 6, 8 and the level entry marked FIXED with commits; the dated README lines; the `CLAUDE.md` level section gains "a level can be set on the drawings card, on a click, one change set per phase" (§2.6, 1b) |
| **Close** | the six items each have §7.1's rows written as facts against the deployed SHA; the first-session script runs clean on staging with every 1a and 1b assertion un-skipped; `found-in-use.md` swept. Then ONE promotion to pilot by the `docs/environments.md` checklist — Max's step — and the 0.6 message |

*Written 2026-09-19 against `d0c0036` on `staging`. Where this document says a
thing exists, it means exists in the code on that commit, verified by nobody.*
