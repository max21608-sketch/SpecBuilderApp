# Configurations, manual control and intake accuracy — plan, 2026-09-23

**Status: GO given 2026-09-23 ("just use the real docs"); step 0 amended to
run on copies of the real pack.** Two coders were already
running when Max asked for this plan (steps 2 and 4). They commit only to
their own branches, so nothing has reached `staging`; their output lands
through the review and browser gates below like everything else.

**The rule for every step: as simple as possible, as complex as necessary.**
Each step names the simplest version and the concrete wrong answer that
justifies anything beyond it. Anything that cannot name one is not built.

## 0. Where each item comes from

Every step traces to something Max said on 2026-09-23 (the found-in-use
entries of that date carry the evidence):

| # | Source | Step |
|---|---|---|
| S1 | "it's still not picking up … an actual crop … displaying the whole page" | 7 |
| S2 | "you have to reload the page to get it to switch from … scanning to ready" | 6 |
| S3 | "we still are not getting the different specs per line item right … type one to five … five different configurations" | 2 |
| S4 | "if both are uploaded, how do we deal with that kind of overlap … match the codes … and the individual configurations" | 5 |
| S5 | "the option to add a configuration manually, and it should come equipped with a default set of things to fill in" | 3, 4 |
| S6 | "not too bothered about how long … or how much it costs … the key is really just the accuracy" · "vercel is on pro" · "I think high is enough" | 1 |
| S7 | "verify in browser and make sure that things actually work and look okay visually before coming back to me" | 0, every gate |
| S8 | "if those were the configurations … act as kind of tabs … you just see configuration one, and it's got the dimensions and the fabric … it's the same every time" | 2, 3 |
| S9 | "what's going to happen if it's like a 100-page document? … What's going to happen with this system for large documents?" | 2 (page picker), 10 |

Decided with Max the same day and not re-opened here: five configurations for
S-301 (Types 1 and 5 are two, sharing their rows); a configuration is named as
the document names it (`S-301 TYPE 2`); manual control exists on the review
card and on the item after confirm; a manually added configuration starts with
the bill line's shared specs copied (each a tick; dimensions, timber and metal
ticked) and only COM 1–3 blank and first; extraction moves to Opus at effort `high`.

## How the work runs

- **One orchestrator** (the main session, Opus 5.5) owns the plan, every
  brief, every review, every landing, CLAUDE.md/AGENTS.md, and ALL browser
  verification. **Coders are Opus subagents**, one per step, each in its own
  worktree under `~/dev/worktrees`, on disjoint files where they run at once.
  A coder never verifies its own screen (§7.4a of the stabilisation plan).
- **Nothing lands unseen.** A step lands on `staging` only after: the diff is
  reviewed against its brief and CLAUDE.md; the four checks pass WITH the
  database tier running (against the local database, §0 below); and the step
  has been driven in a browser, with screenshots at 1920×1080 and 1440×900, a
  written checklist answered (everything present, the primary action visible
  without scrolling, nothing overlapping or squashed, both widths hold), and,
  for a list screen, a 300-line fixture.
- **The company-data rule.** The sandbox Neon database, the Vercel Blob store
  and SharePoint hold company data and are read-only for Claude. So Claude
  verifies on a LOCAL stack holding copies of the real Panther pack (§0), and
  the only presses on staging itself (Read, Confirm) are Max's, in a short
  acceptance session at the end (§8), with Claude reading the screens beside
  him.

## Step 0 — a local stack Claude can verify on (new, necessary)

**Why it is necessary:** without it, "verified in the browser" means either
writing to the sandbox (not allowed) or not verifying the drawings card's page
preview, crops and uploads at all. The database tier has also never run on
anything but the sandbox, so every db-tier test written today would land
unrun.

- **Local Postgres** (Postgres.app, already installed): `APP_ENV=development`,
  `DATABASE_ENVIRONMENT=sandbox` in a separate env file that points at
  `localhost`, never `.env.local`. Migrations and seeds are applied through the
  app's own `db:migrate` / `db:seed`, which print the host.
- **A local fake Blob server**, development only: `@vercel/blob` reads
  `VERCEL_BLOB_API_URL` / `NEXT_PUBLIC_VERCEL_BLOB_API_URL`, so a small local
  server answering the SDK's own calls needs little or no app code. Files live
  under `~/dev/localstack/blob/`. Any app code it does need refuses unless
  `APP_ENV=development` **and** the database host is `localhost`, so it cannot
  be switched on in a deployment by mistake. The pathname scope checks (`projects/<id>/`) stay exactly as they
  are.
- **The real Panther pack, COPIED** (Max, 2026-09-23: *"just use the real
  docs"*): the seating BOQ, the nine `SPEC-346` sheets and the preamble, copied
  to `~/dev/localstack/panther/` from Max's download. The originals are never
  touched, and the copies never enter the repo, a fixture or a seed. The local
  database and blob folder that hold them are Claude's own workspace, not a
  company system. The drawing set (`Apx 1a`) is not in that download; step 5
  fetches it read-only from SharePoint. Committed tests still use invented
  fixtures, as CLAUDE.md requires.
- **Model reads on the local stack are real, charged calls** (Max: cost does
  not matter), so the whole path (upload, Read, review, Confirm, record,
  export) can be driven end to end on the real documents.
- `npm run checks` runs against the local database, so the database tier runs
  on every landing from here on.

Simplest version: a folder, not an S3 emulator; one adapter, not a mock per
caller. Trap avoided: a shim that could be switched on against a real store.
**Who:** a coder (~2–3 h), then the orchestrator stands it up (~1 h).

## Step 1 — extraction reads with Opus 5 (built, branch `cfg-d-opus-extraction`)

`2cce414`: `EXTRACTION_MODEL = "claude-opus-5"`, effort stays `high`. Opus 5.5
was ruled out because it refuses the forced `tool_choice` every extraction
uses; Opus 5 accepts it. The timing inequality moves with it: model 740 s <
abort 770 s < `maxDuration` 800 s (Pro's generally available maximum), claim
900 s, queue visibility 1200 s (the queue allows 60 minutes). The pack bound
widens (an hour for eleven documents in the worst case) and still fails a cap
of one. Four checks green on the branch (1689 passed, db tier skipped).

**Not done:** no read has run on Opus. **DoD:** land, confirm the staging
deployment reaches Ready at that SHA (an 800 s `maxDuration` above the plan's
limit fails the deploy loudly, not silently), and one real document read
on the local stack records `model = claude-opus-5` with its elapsed time.
~30 min.

## Step 2 — configurations a document names (in flight, brief A)

The defect: the model read S-301's five room types correctly and the schema had
nowhere to put them, so they were welded into row labels and handed COM 1–3 of
ONE record. **Confirming that card writes one chair with three fabrics.**

**The card is TABS, one per configuration (S8, 2026-09-23).** Each tab shows
that configuration complete and in the same layout every time: dimensions,
then fabrics and finishes, then notes. A shared row appears in every tab as the
same observation, and says so in words ("shared by all 5"), so editing it once
edits it everywhere. Only one tab is on screen at a time, which also keeps one
input per observation. A code with no configurations has the same layout with
no strip. The "Page 1 / Page 2" chips at the top go; pages are sources and live
in the sidebar picker. The picker holds at most ~8 buttons and then becomes
prev/next with "page n of N" (S9), and the swatch's "Crop from" does the same.

Staged `schemaVersion: 3`: a page lists the configurations it names; a row says
which configurations it applies to (empty = shared); a page can say which
configurations it depicts (`MUR 1 & TYPO 5`). The confirm stays one request per
page and fans each row out to its configurations' records (five × two phases =
ten records), claiming COM slots PER RECORD. The card shows one chip per
configuration's tab, and says how many records confirming creates. A confirm that would create a configuration
beside differently-named existing ones is blocked until acknowledged (the floor
under step 5). v1 and v2 reads stay frozen; nothing parses old labels.

Simplest version: configurations are variants, which already exist (0024); no
new table. Trap avoided: a string rule reading `- Type 2` out of labels, which
is the inference the 2026-09-18 overhaul removed.
**Browser DoD (local):** read the real S-301 sheet (local copy); the card shows five
tabs `TYPE 1`–`TYPE 5`, each with the shared dimensions and its own cloth, a
shared edit showing on every tab, "creates 10 records";
confirm; the phase table shows ten configurations under S-301; each record's
Specs tab shows its own cloth in COM 1 and the shared `W550 x D565 x H735 x
SH430mm`; the BWS export carries ten rows and no S-301 parent row.
~4–5 h coder (running), ~1.5 h review and verification.

## Step 3 — manual control on the review card (queued, brief C1)

After step 2, same coder, same branch. On the card before confirm, a reviewer
can add, rename and remove a configuration, change which configurations a row
applies to, and split or join a code the model grouped wrongly. All of these are
reviewer edits to the staged JSON through the existing autosave and version
checks, with the model's reading kept beside them, so the card can say *"read
as 4, you set 5"*. No table, no migration.

Trap avoided: removing a configuration silently dropping the rows that were
only on it. Those rows become a blocker that needs a decision.
**Browser DoD (local):** on a card the model under-read, add `TYPE 5`, move the
Type 1 & 5 fabric onto it, rename a misread `TYP.O`, remove an invented one and
see its rows asked about, then confirm: the records match what the card showed.
~2–3 h coder, ~1 h review and verification.

## Step 4 — add a configuration after confirm (in flight, brief C2)

**Add a configuration** on the bill line's record screen and its phase-table
row. The panel asks for the name, then lists the bill line's specs and settled
answers as ticks: ticked by default except the differing fields (COM 1–3),
which start blank and sit first on the new record. Timber and metal are
carried (Max did not object, 2026-09-23; S-301's `WD-01` is the same on all
five types).
Copied rows keep their source page. It states in words what stops being
exported (anything left unticked, since the bill line becomes a heading).
One change set, one version, and the server re-checks the list the person saw.
Rename and retire in the same place.

This also closes a gap that has stood since 2026-09-17: a bill line that
already carries specs could not be split at all.
Trap avoided: a copied value arriving with no page, which would be
indistinguishable from one somebody made up; and specs vanishing from the
export with nothing saying so.
**Browser DoD (local):** on a confirmed item with dimensions and a timber
finish, add `TYPE 2`: dimensions and timber arrive ticked with their page,
COM 1 is blank and at the top; fill it; the export shows the configuration
and not the bill line; a duplicate name and a retired name are both refused in
words. Also at 300 lines on the phase table.
~3–4 h coder (running), ~1.5 h review and verification, plus reconciling
`variant-create.ts` with step 2 at landing (~30 min).

## Step 5 — two documents, one set of configurations (brief B, to write)

The pack holds S-301 twice: the spec sheet (`Type 1`–`Type 5`) and the drawing
set (`MUR 1 & TYPO 5`, `MUR 2`, `TYPO 3`, `TYPO 4`). They must land on the same
five records, and **they disagree about Type 2's fabric**, so a person has to
see it.

Simplest version, built on step 2's blocker rather than beside it:
- **An exact name match pairs silently.** A page that calls itself `Type 3`
  lands on the existing `TYPE 3`. Case and spacing are folded; nothing more.
- **Anything else is the reviewer's pick.** When a card would create a
  configuration under a bill line that already has others, the blocker becomes
  a choice per configuration: *pair with* one of the existing names, or *create
  new*. Nothing is guessed, and `MUR 2` is never matched to `TYPE 2` by the app.
  The pick is a reviewer edit on the staged JSON, like step 3's.
- **A disagreement is the existing replace-acknowledgement.** When the drawing
  set's `MUR 2` fabric lands on `TYPE 2`, which already holds the spec sheet's
  cloth, the card shows both values and requires the reviewer to acknowledge
  the replacement, as every revised drawing does today.

Trap avoided: a fuzzy step (`TYPO` ≈ `Type`, `MUR 1` ≈ `Type 1`) that pairs two
configurations the client kept apart, which nothing downstream would question.
Also recorded, NOT built: `CH-01.1` is a position code on this pack (four
cloths under one code), and the finishes library is keyed on the code; the
CONFLICT rule already leaves the extras unlinked, which is safe. That is Max's
call on another day.
**Browser DoD (local):** confirm the real S-301 spec sheet (five records), then
the real drawing set (fetched read-only from SharePoint): `TYPO 3` / `TYPO 4` pair with no question, `MUR 1 &
TYPO 5` and `MUR 2` ask; pairing `MUR 2` with `TYPE 2` shows both cloths and
requires the acknowledgement; the record keeps the replaced value under *show
retired*.
~3 h coder, ~1 h review and verification.

## Step 6 — the status moves on its own (FIU 2026-09-23)

Reproduce first, on the local stack, with five of the real specification sheets
(more than the three-at-a-time cap), noting which screen was open. The source
names two candidates, neither proven: the pack screen stops polling when every
unfinished document is *waiting for a slot* (its predicate counts only `queued`
and `parsing`), and the project overview does not poll at all. The fix is
whichever the reproduction shows, using the existing `usePoll`: no websocket,
no new mechanism.
**Browser DoD (local):** upload five, leave the screen alone, and every row
reaches *Ready to review* with no reload, on the pack screen and the overview.
~1 h coder, ~30 min verification.

## Step 7 — a picture crop, not the whole page (FIU 2026-09-18 item 6, 2026-09-23)

It was deferred because the fix is the PROMPT, and a prompt change means
re-reading every document already read. Both objections fell away today: step 2
already changes the drawings prompt and forces a re-read of S-301, and Max has
said cost does not matter. So it rides with step 2's re-read: the `viewRegions`
instruction names the specification-sheet layout (one small photograph in a
corner, a page of text) explicitly, and Opus reads it. The whole-page fallback
stays as the recovery path, and its sentence stays true.

Measure before and after: count, per staged run, items with no view region by
template (spec sheet or shop drawing). That count has never been taken.
**Browser DoD (local, then real in §8):** the real S-301 card
proposes the corner photograph, not the page.
~1 h coder (inside step 2's prompt work), measured in §8.

## Step 8 — the real pack on staging, with Max (~30 min of his time)

Steps 0–7 are verified on the real documents on the local stack, so this is
acceptance on the deployment itself rather than first contact. On staging, in
a `TEST:` project (it stays, named for what it exercised):
Max uploads the Panther seating BOQ, the S-301 specification sheet and the
drawing set, and presses Read (Opus, charged). Claude drives the pages
read-only beside him, compares each card with its page, and takes the
screenshots. Max presses Confirm on S-301 from each document and decides the
Type 2 pairing. Then the export and the check sheet for S-301 are read
against the pages.

**Done means** five configurations on each phase, each with its own cloth in
COM 1 and the shared geometry; the Type 2 disagreement shown and decided by
Max, not by the app; a crop of the chair on the spec sheet's card; no reload
needed at any point; and the export read line by line against the pages.

## Step 10 — large documents (S9): measure, then fix what breaks

The page buttons were never the problem: they list the ITEM's pages, not the
document's, so a 100-page set still shows each card its own two or three. The
limits that a large document hits are elsewhere, and none has been measured
(`found-in-use.md` 2026-09-20: *"A 120-page drawing set has never been read for
real"*):

- **The read's output ceiling.** One read can write 128K tokens, thinking
  included. Past that the run fails as `truncated` ("split it into smaller
  documents"). On Sonnet an 11-page set wrote about 5K; nobody knows what
  Opus writes for 100 pages.
- **The time budget.** 800 s from step 1.
- **The review screen.** One card per code: a 100-page set is perhaps 40–60
  cards in one long scroll, with no way to jump to an item or see what is left.
- **The known hard stops**, already refused in words: 600 pages, 20 MB at
  registration, 32 MB per request.

**No 100-page set exists yet** (Max, 2026-09-23: "I don't have one yet"). So
the measurement runs on the largest real document available: the whole Panther
pack (drawing set, nine specification sheets, preamble) MERGED into one PDF,
locally, as a copy. That is several dozen pages of different items, the
realistic "a pack arrives as one PDF" case. Read it on the local stack and
record pages, time, output tokens and whether it truncated; render its review
screen and time it. The warning threshold below is derived from output tokens
per page and is marked PROVISIONAL in the code and in `found-in-use.md`, to be
re-measured when a 100-page set arrives. Fix only what the measurement shows. The one fix already
known to be needed is **navigation on the review screen**: an item list at the
top (code, name, pending count) that jumps to the card, and a *show only
pending* filter. **Splitting one read into page ranges is currently on
CLAUDE.md's excluded list** ("splitting an oversize drawing set"). If the
measurement shows truncation at a size Panther-like packs reach, it comes back
to Max as a decision with the numbers, and it is not built on spec.

**Refused before upload, not after (Max, 2026-09-23: "is it worth having a
this document is too large to upload?").** Today 20 MB is refused at
registration, after the upload, and 600 pages only when the read starts,
because counting pages needs the bytes and registration deliberately reads
metadata only. The upload screen already loads pdf.js for the previews, so the
browser counts pages before a byte is stored and refuses over 20 MB or 600
pages on the upload row, in words and with the number. The OUTPUT ceiling is not
a page count, because it depends on how dense the drawings are, so it becomes a
WARNING at the page count the measurement shows ("over N pages, this may be too
large to read in one go; consider splitting it") and never a refusal. A refusal
set too low is the one error with no way round it. The server-side checks stay
as the backstop.
~1 h measuring, ~3–4 h coder for the navigation and the upload check, ~1 h
verification.

## Step 9 — close out

CLAUDE.md and AGENTS.md (the new load-bearing sections: named configurations,
manual control, cross-document pairing, the new timings, the local stack);
found-in-use entries marked FIXED with commits; `docs/plans/README.md` dated;
worktrees removed. ~1 h.

## Order and estimate

```
now ─┬─ step 2 (A, running) ── step 3 (C1) ──┐
     ├─ step 4 (C2, running) ────────────────┤
     ├─ step 0 (local stack) ── step 1 ──────┼── step 5 (B) ── step 6 ── step 7 measured ── step 8 (Max) ── step 9
     └─ (orchestrator: reviews, verification, landings throughout)
```

Steps 2 and 4 are already running; step 0 starts on your go, alongside them,
because every gate after it depends on it. Step 5 needs step 2's shape, so it
is briefed as soon as step 2 lands. Step 6 is independent and fills a gap.

| Step | Coder | Review + browser | Wall clock |
|---|---|---|---|
| 0 local stack | 2–3 h | 1 h | first half-day |
| 1 Opus | done | 30 min | with step 0 |
| 2 named configurations | 4–5 h (running) | 1.5 h | today |
| 3 card controls | 2–3 h | 1 h | tomorrow morning |
| 4 add after confirm | built (`6b75690`), timber/metal default to fix | 2 h | today / tomorrow morning |
| 5 two documents | 3 h | 1 h | tomorrow |
| 6 status refresh | 1 h | 30 min | tomorrow |
| 7 crop prompt | in step 2 | measured in §8 | — |
| 8 staging acceptance with Max | — | 30 min with Max | end of tomorrow or the day after |
| 10 large documents + upload check | 3–4 h | 2 h incl. measuring | tomorrow, alongside 5 |
| 9 close out | — | 1 h | last |

**Estimate: about two and a half working days to "ready for the real-pack
session"**, realistically 2–3 with step 10 and the tabs, with the session itself (about 30 minutes of Max's
time) at the end. The spread is in steps 2 and 5, which touch the most load-bearing
code in the app (the confirm fan-out and variant creation), and in whatever the
local stack turns up the first time the database tier runs off the sandbox.

## What this plan does not do

- Per-configuration quantities (the bill never says how many are Type 2; the
  screens keep saying *quantity not allocated*).
- The `CH-01.1` position-code question for the finishes library.
- Re-reading any document other than the Panther seating ones in §8.
- Anything on pilot. Promotion is a separate decision.
