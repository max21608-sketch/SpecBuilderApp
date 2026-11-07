# The milestone diary (moved from CLAUDE.md on 2026-11-07)

Everything `CLAUDE.md`'s "Current milestone and scope" section held up to the
audit build of 2026-11-06, verbatim: the milestone, every dated "Built …" and
"Verified …" paragraph, what was excluded and why, and the decisions awaiting
somebody. `CLAUDE.md` now keeps a short status; this is the history behind it,
and `docs/plans/README.md` is the dated decision log. Nothing here is edited
after the move; new history goes in the README.


A stale status section is worse than none, because agents and people both make
decisions from it. The full dated list is in `docs/plans/README.md`.

**2026-11-06: the whole-codebase audit, and its build.** Max asked for every
area read meticulously and a plan to green-light; `docs/plans/audit-2026-11-06.md`
is the audit (twelve confirmed defects in its short version, five stages) and
the same day he said "run all the stages… use your best judgment" on its
questions. The build runs on `audit-int` with Opus coders in worktrees, every
landing checked on the local stack with the database tier required. Stage 1
(the file and the bill) is landed: answer provenance (0050), configurations
follow their line, the one number reader, the replace tick follows its row,
the finish planner, the gate slot rule. Stage 2 (what a person hits) is
landed: the click's version, the checklist keeps what is typed, an error
boundary, the chase respects the matrix (0051), reads that cost what they
should, refusals written for people, the category as a suggestion. Stage 3
(before Graph) is landed: re-assignment works, a daily cap on automatic
reads, only stamped evidence auto-assigns, one row per email. Stage 4 (the
boundary and the trail) is landed: the write boundary in every handler,
locks before occupancy, the category guard, a deletable project and a trail
that keeps only what it should (0054–0057), one version per transaction and
the diff pairing supersessions (0052), sessions that can be ended (0053).
Stage 5 (shape) is in progress: CI runs the database tier (and its first
fresh-database run found two tests that passed only on the shared
database's history, which 0058 and a fixture fix close). The sections above carry each rule
under its own heading, dated 2026-11-06; §4 of the audit places the open items
of the 12 Oct, 23 Oct and 15 Oct plans against it. Pilot needs 0050 and the
provenance backfill before this code (the promotion notes are in
`docs/plans/README.md`).

### M8 — the Panther pass. Still the milestone; the ORDER changed on 2026-09-18.

**Read `docs/plans/catchup-2026-09-18.md` before planning against this
section.** M8's four steps are unchanged and step 4 is still what "done" means.
What changed is what comes first: Matthew is now using the app himself (D4), and
he and Max agreed to stabilise rather than build (D5). Work that lets him get
through a first session beats work that adds anything.

**2026-10-01: the pack being worked on is Aman's, not Panther's.** Since
2026-09-23 the bill and drawing work has been driven by the Miami Beach pack
(P18181, Aman Interiors), and the catch-up of 2026-10-01 showed it on pilot:
the bill held, and one desk drawing put two figures in Width and a height in
Depth. Read `docs/plans/catchup-2026-10-01.md` before planning intake work.

**DECIDED 2026-10-04 (Max): intake work is on the Aman pack, and the drawing
read is being rebuilt around the ITEM, not the page, on Opus 5.5.** The plan
is `docs/plans/intake-items-2026-10-04.md` — read it before touching
extraction, staging or the drawings review. Its end state is the Aman project
in PILOT, correct, with Max pressing the buttons Claude may not (pilot is
read-only for Claude). Panther stays in the golden because it holds the
multi-page and configuration cases.

**2026-10-12: past intake, and the Aman project is no longer a live quote.**
Read `docs/plans/catchup-2026-10-12.md` before planning. Matthew called intake
mostly done. The next phase is a screen for reviewing specs item by item: for
each spec, confirm it, mark it needed for TGQ or TG0, fill it in, or raise it
as a question. He and Claudia design that screen themselves this week, so
**do not build it ahead of their design**. The next test projects are new
enquiries filed in BWS's P-number folder format. Max decides what to implement
in a separate session; nothing from that meeting is built yet.

**2026-10-15: the first new enquiry, Ronnie Scott's (P16717), went in on
pilot with Matthew watching.** Read `docs/plans/catchup-2026-10-15.md`. The
bill confirmed. The review screen confused both people, and in the room two
values that had been dropped were said to have gone in. Matthew placed the
categories for this project's lines only, and nothing is seeded from them.
At the 17:00 part 2, all 25 drawings were read. **Matthew and Claudia now
review them on pilot themselves**, so what they hit next is the test. Matthew
on quoting: "only qualify the bits you need for TGQ… but keep all the other
information in there" (part 2, 59:22). That is the stage-by-stage capture the
item-review screen is for.

**DIRECTION, Max, 2026-10-15: a blocker is HIGHLIGHTED where it is, and says
the next step in a few words.** "They're very much like developer style error
messages… what we need is just like things to get highlighted… we get stuck
quite a few places, where… we don't know what the next step is." Both calls
that day stalled on blockers the screen did know about. One was a reason given
only in a button's hover title. One was "Checked" boxes nobody could see. One
was a replace box read backwards for eight minutes. The full explanation still
exists, one click away. It is never deleted, because it is how a reviewer
checks a value. But it is not what the person reads first.
**Built 2026-10-15 (`e888e75`):**
- One "needs you" list sits at the top of the bill review and of the
  single-item drawing card (`NeedsYou`, `src/lib/needs-you.ts`). Each blocker
  is a few words and a link. The link switches tab or unfolds the row, then
  scrolls to it and lights it (`goToAndFlash`). The full sentences are under
  "Why".
- A bill tab still waiting shows red (`Tabs`, `attention`).
- The replace box reads "The bill says W 900mm · this drawing says W 3500mm",
  with a "Use this drawing's" tick (`replace-words.ts`).
- A source is named "the bill", never "another page" (`source-words.ts`).
- "Correct" is now "Edit value".
- The blockers themselves are unchanged: the list only shortens them and
  points at them.
- The two configuration cards carry the list too
  (`configurationNeedsYou`). A link opens the configuration's tab first.
- **The dimension menu, reworked (workstream E, `be090a6`).** The bill's
  expanded line and the drawing card show ONE row per figure, each with one
  W · D · H · SH · Dia · note picker (`SlotPicker`), and what BWS receives in
  large type at the top (`WhatBwsReceives`).
  - Every figure a bill line prints can take a slot (`LineFigure`). A figure
    not on the placed line is keyed `<line> | <part>`, and keys stored before
    this are unchanged.
  - Picking a slot another figure holds moves that holder to a note in the
    same write (`slotChangeFor`, the drawing card's swap rule).
  - The bill as printed is labelled as the document and shown last.
  - Not reworked yet: the configuration cards' geometry tables.
  - The mock-up (`docs/design/dimension-picker-mockup.html`) was built
    without Max's sign-off, at his "keep going". His walk is outstanding.
- **A size row is named by its slot** (`attributeDisplayLabel` in
  `src/lib/attribute-label.ts`, `d0a8c2b`; Max, 2026-10-16: "the dimension
  labels should just read height or width…"). Every size row read off a bill's
  Dims column used to carry that column's heading as its label, so TB-08
  showed three rows each labelled "DIMENSIONS CM / MM L X W X H".
  - A row holding a slot now reads Width, Depth, Height, Seat height or
    Diameter, with nothing under it. A note keeps its own label.
  - There are five names and no Length: a bill's L is set to W or D on
    review.
  - `record_attributes.label` is unchanged and shows on hover
    (`documentLabelTitle`).
  - Every screen that lists a spec row calls the function. The export, the
    composer and the check sheet never do.
  - Two things keep the document's words, because they say where a figure was
    printed: the drawing card's "where" line, and the bill review's "Figure,
    as the bill prints it".

Agreed at the review of 2026-09-14 and confirmed by the user on 2026-09-15. The
pilot is **Project Panther** (`AP364`, BWS project `P17726`) — a manageable,
curated document set — **not** Maybourne Paris, whose documents exist in several
revisions nobody has reconciled. One pack in, one export out, and the export has
to be right.

Done means all four, in order:

1. **The curated pack goes in as one delivery.** One `intake_batches` row: the
   seating BOQ with each tab a run, the shop-drawing set, the nine `SPEC-346`
   specification sheets, and the preamble when it reaches the folder.
2. **Every BOQ line becomes a record keyed by its client item ref**, and every
   drawing spec lands on the right record in the right run.
3. **The first pass transposes; it does not complete.** What the documents say
   is recorded with its source; what they do not say is `TBC` or missing.
   Inferring a value, or filling a gap from a sister item or a category
   template, is the failure this milestone exists to prove against. A statement
   the requirement matrix has no question for is kept as a `record_attributes`
   row — that is why attributes are requirement-free — never dropped for not
   fitting the template.
4. **The BWS-layout export is judged flawless by a human**, read line by line
   against the pack. Tim's CSV grid importer is the target shape; the file is
   still a complete dataset a person uploads, never a delta and never a write.

Two readings to head off. "Trained on the Panther BOQ" means tuned against it —
prompts, `item_category_aliases`, `requirement_aliases`, unit handling, seeded
only from verified Panther wording. **No model is fine-tuned and none will be.**
And "flawless" is a human acceptance test, not a passing suite: the four checks
passing is the floor, not the milestone.

Everything under *Explicitly excluded* stays excluded while this runs, including
the gate model — a grid that is right is worth more than a gate over a grid that
is not.

**THE CATCHUP OF 2026-09-18 CHANGED THE ORDER, NOT THE MILESTONE.** Max
demonstrated the whole app to Matthew, Sebastian, Steve and Tony for 2h18m —
the first time anybody but Max has watched it run. Everything said, with
timestamps, and the plan that follows, is
**`docs/plans/catchup-2026-09-18.md`. Read it before planning anything.**
The defects seen on screen are in `docs/plans/found-in-use.md`; the decisions
are dated in `docs/plans/README.md`. Five things were settled in the room:

- **"Run" becomes "phase"** on every screen and in every document, because that
  is the BWS word. The table stays `spec_runs`.
- **Versioning is two-part** — internal minor, client-facing major. V1.1, 1.2,
  1.3 internally; issuing to the client makes it V2, then 2.1; reissue makes it
  V3. Nothing is built; two questions are open first.
- **Chasing at tender covers the TGQ set only.**
- **Matthew runs a real intake himself**, on a smaller project, and sends back
  screenshots with written explanations.
- **STOP ADDING FEATURES; MAKE WHAT EXISTS WORK.** Max proposed it and Matthew
  accepted it outright. The feature list from that meeting is long and
  **Matthew explicitly does not want it built yet** — *"some of what I briefed
  you to do is probably not quite on the money."* Work that makes his first
  session survivable comes before anything new.

Four things it changed that a reader of this file would otherwise get wrong:

- **The five BWS-owned palettes are obtainable now.** Matthew showed the screen:
  `bws.whistlercloud.com/standard_specification_fields/<id>/edit`, the **Palette
  options** box, per field whose `Field type` is `palette`. There is no export,
  so it is a SCRAPE, the way the boilerplates were taken. **The trap is his
  own**: a field's *Values* page is what people have typed (`self-piped`,
  thirteen times), NOT the palette — and somebody on the call had already drawn
  a wrong conclusion from it. Seeding from Values fills a controlled vocabulary
  with other people's free text. Blocked on Max having a real BWS account. BWS
  stays read-only; this is a read.
- **Tim is building a NEW BWS spec importer** — specs plus free text, CSV as the
  interchange, images by public URL. The complete-dataset rule exists because
  the CURRENT importer replaces; whether the new one does is unknown. **Do not
  move the export until Tim's column contract is in writing**, and item pictures
  on a public URL is a decision about NDA-covered client material, not a config
  change.
- **A level must never constrain which specification fields are offered.**
  Matthew doubts the app should work the level out at all; Sebastian's shape —
  show everything, demote and grey what the level says is unlikely — was
  adopted. `spec_records.level` STAYS: it picks the BWS boilerplate and it is
  still a person's decision, and 0025 already keeps the guess out of every
  gate's reach.
- **Substrate is a concept nothing models — but its BWS FIELD ALREADY EXISTS.**
  A client says "oak" with no colour; BWS free-texts `oak substrate` so the item
  can be priced before the finish is agreed. `Substrate` is `json_id` 192,
  column CF, section Finishing, and `docs/bws-spec-grid.md` puts it in the
  CABINETRY block — so no new column is needed, only for it to be reachable on a
  seating item. Max answered on Matthew's behalf 2026-09-19: it is **per ITEM**
  (provisional) and a known substrate **satisfies** TGQ. That second half is a
  gate CONDITIONAL, not a value, and which fields it releases is still his to
  say.

- **The app serves at least TWO ROLES, not one.** Matthew described the PROJECT
  MANAGER loading the pack and reviewing it, taking the outstanding summary to
  the CAM, and only then going to the client — and a chase that need not be
  external at all. The line above saying the primary user is the KAM /
  sales-support role is half the picture.

Two endorsements, because they settle arguments this repo has had with itself.
**Structured dimensions are right** — *"much more powerful having it as
numbers"* — and what Matthew wants beside the five slots is a qualifier a PERSON
types (`1250 (L-shaped return)`), not the slots removed. And **the project
finishes library is exactly what he asked for**; he named the document that
should fill it, a Finishes Schedule table, which costs a tool-schema change and
therefore a re-read of every document already read.

And one explanation for something that has been stuck: **the TGQ tick-box
workbook is not how Matthew thinks** — *"I found it quite hard to do like a tick
box thing. I ended up basically typing sentences."* The next attempt is a
conversation transcribed into the matrix, not another workbook.

**Shipped to staging:**

- **M1 — the spec table and completion view** (2026-09-13). Migrations
  `0002`–`0004` and four seed files: 56 BWS spec fields, 17 categories, 728
  requirements, the BOQ alias vocabulary. BOQ upload → parse → review → one
  atomic confirm → record screen under optimistic locking → completion view.
  Verified against the real pilot BOQ: 59 lines in, 59 records out, `SX11A`
  landing as two records with different quantities.
- **M2 — extraction** (`0006`). The blob trust boundary, the model wrapper and
  its tool/Zod schemas, the proposal resolver, the queue producer, claim
  protocol and fenced worker, the review screen and the confirm boundary. The
  API was verified on 2026-09-13 with ONE approved synthetic document; every
  safety rule held; one request billed. `tests/manual/verify-model.test.ts`
  repeats it, gated on `VERIFY_MODEL=1` because it spends money.
- **M4 — draft chase emails** (`2eb58b3`). `0005` applied to sandbox. **HIDDEN
  as of 2026-09-14, not deleted** — see below.

**Built 2026-09-14, the intake rebuild (`0007`).** The product is refocused on
getting a tender pack in, staged, reviewed and out again:

- **A pack, not a file.** `intake_batches` groups the documents that arrived
  together; the upload takes several at once and each file's kind is DECLARED.
- **Runs.** Every BOQ tab is parsed, and each becomes a `spec_runs` row with its
  own records and its own tab on the project. `record_attributes` holds what a
  drawing said about an item; `project_notes` holds what a preamble said about
  the package.
- **Two new document kinds** (`preamble`, `shop_drawings`) with their own static
  prompts, tool schemas, staged shapes and review screens.
- **A BWS-layout export**, per run or per project, xlsx or csv.
- **Category no longer blocks intake.** `PATCH /api/records/[id]` sets one
  afterwards and creates the answer rows with it.

**Built 2026-09-15, dimension slots (`0011`).** Matthew's grid ruled what BWS
field 3 contains, so a dimension is now one of five slots — W, D, H, SH, Dia —
composed into `W1900 x D790 x H720 x SH440mm` by `src/lib/dimensions.ts`.
Everything else a document measures is kept as a note with its unit intact,
which is why `record_attributes_unit_is_dimension` was replaced. Blocks and
formatting rules: `docs/bws-spec-grid.md`. Pushed to staging; **not yet
exercised in the app by anyone**.

**Built 2026-09-16, the overall dimension printed as one line.** The Panther
pack carries two specification-sheet templates and the second prints
`80 x 70 x 90 cm` with no labels at all, so it cannot be treated as malformed.
`dimensionsCombinedRaw` asks for the line verbatim and
`parseCombinedDimensions` reads it: a printed prefix (`W1520`, `Dia.460`) is
taken exactly, three bare figures are read as W x D x H **in printed order and
badged as assumed**, and anything else gets no slot and becomes a note. The
same change made `suggestUnit` count only values that are one figure — it
stripped every non-digit, so `80 x 70 x 90` read as 807090, one value far over
the threshold, enough to carry the page's vote to millimetres and record an
80cm armchair as 8 metres.

**Built 2026-09-16, tidying what a drawing review asks of a reviewer.** The
first real S-100 and S-101 sheets produced a card nobody could act on and a card
nobody could read: a codeless second page with twelve rows, and 34 rows of which
fifteen were one block of preamble REMARKS. Codeless pages now collapse and can
be ignored whole; a sheet's note block merges into one row, at staging and on
read, id-stable; a note no longer asks for a unit; and a failed action's message
survives the reload it triggers. No prompt, schema or model change — nothing was
re-read and nothing was charged again. Verified in the browser against copies of
the real Panther S-100 and S-101 runs; **not yet accepted by Max**.

**Built 2026-09-15, the first run-through's findings.** Max walked the app end
to end and four things were wrong, all of them flow rather than data:

- **The spec table never merges runs.** A second screen used to mount the table
  with no run and list every sub-quote in one flat list, and the projects list
  pointed at it. Deleted. `SpecTable` now REQUIRES a `runId`, the projects list
  and the BOQ confirm both land on the project's run tabs, and a record screen
  goes back to the run it is on. `/api/records` still answers without a `runId`
  — the contacts panel reads the whole project for designer-code hints — but no
  screen renders that.
- **Intake is grouped by pack.** The overview listed runs flat, so the pack
  screen and the combined drawings review were reachable only from the redirect
  that fires once after upload. Each pack now links to both.
- **Specification documents are read automatically.** See the section above; it
  is the one consequential change here.
- Projects list: the duplicate *Open* button is gone and *Add a project* is at
  the top. Intake status labels live in `src/lib/intake-status.ts`, because
  three copies had already drifted on `parsing`.

**Built 2026-09-15, attributes reach the checklist.** Confirming a drawing card
now fills the checklist answers its attributes answer — see the load-bearing
section above. It is the first thing that makes `spec_answers` fill from a
document rather than by typing. Two limits worth knowing before reading the
result:

- **Only 6 of the Panther project's 33 attributes carry a BWS field**, so apart
  from dimensions — which work for every record, because all 17 categories ask
  field 3 — very little else promotes yet. The lever is
  `requirement_aliases` and attribute matching, which is a seeding job from
  verified wording, not code.
- **The existing attributes were back-filled on 2026-09-15** by
  `db/backfill-answers.ts` — 11 answers across five records, sandbox.
  The script is dry-run by default, prints the resolved host before acting,
  refuses production without `--yes-production`, and is safe to re-run: it
  calls the SAME `planAnswerFills`/`applyAnswerFills` the confirm route calls,
  so a second pass writes the same values and a person's answer is never in
  scope. It is not a numbered migration on purpose — rebuilding
  `composeDimensionCell` in SQL is the second composer the dimension design
  exists to prevent.

**Built 2026-09-16, the export check sheet.** Step 4 of M8 — the export judged
flawless line by line — had a person, a screen and a memory of what the
drawings said, and no artefact. `/api/projects/[id]/export/check-sheet` now
emits one line per record × field with the document and page each value came
from and three empty columns for the reviewer; the procedure and the verdict
vocabulary are in `docs/plans/export-verification.md`. The export route was
rewired onto the same `loadExportScope` so the two files cannot describe
different sets of records. **Nobody has filled one in** — its column choices
are a guess at what makes the reading possible, and the first real pass tests
the sheet as much as the export.

**Built 2026-09-16, versioning, change history and the finishes library
(`0012`–`0018`).** The first work outside M8's four steps, asked for directly:
"you need to be able to view previous versions, there needs to be audit trails,
and changes need to be easy to see". Six pieces, each shippable alone, and the
load-bearing sections above carry the reasoning.

- **Every change is a change set and every record has versions.** Who, when,
  why, and the document or email that caused it. A record screen shows v1..vN
  with a diff table; a project screen shows the whole trail and compares any
  two points. `audit_log.change_set_id` links the forensic layer to it.
- **Evidence.** An `.eml`, `.msg` or PDF uploaded against a change, so "the
  client says they never asked for this" is answered by opening the email. It
  downloads and opens in Outlook; nothing renders a message body.
- **Named baselines**, materialising their exact membership, so "Rev A vs what
  we hold now" is two exact sets.
- **A spec can be retired and a revised drawing can replace one**, with the
  checklist recomposed either way.
- **A revised BOQ replaces the bill and keeps the drawings**, with the pairing
  staged and one-to-one only.
- **A finishes library**, keyed by the client's code, edit-once-and-propagate,
  with a swatch.

**Verified in the browser against the sandbox Panther and P17231 data**, not
against fixtures: 101 records back-filled to v1; an overwrite refused without a
reason and accepted with one; two baselines around one edit reporting 1 changed
and 13 unchanged; retiring the real S-100 fabric pulling its COM 1 answer back
to `missing` and putting it back refilling it; the P17231 bill reconciled
against its own run as 57 paired, 2 ambiguous — correctly refusing to guess
which `SX11A` is which; and one finish edit moving 3 records and 8 answers.
**Not accepted by Max**, on any screen.

**Built 2026-09-17, the first run-through's six findings.** Max drove the app
end to end and reported one data defect, one gap and four UI changes. Each is
shippable alone; the load-bearing sections above carry the reasoning.

- **A fabric came through as "Other" with no BWS field.** `classifyCallout` is
  now the one reading behind both the group and the field, the word lists carry
  the vocabulary a swatch caption uses, the client's own finish code is read as
  evidence, and a caption naming the item itself is taken as its upholstery —
  flagged yellow, because that step is an inference. Applied to packs already
  read, at read time: **no document was re-read and nothing was charged
  again.**
- **A finished review says so.** A green *Review complete* box on both drawings
  screens, and *Open the project page* at the bottom of each.
- **The projects list is a table** with a search box, a status pill and no
  duplicate Overview button.
- **A project becomes COMPLETED on its own** when every question on every
  record in the export's scope is confirmed or N/A. Computed, never stored, and
  there is no button.
- **The project page reads as cards**, with versions, baselines and the change
  trail on the page rather than behind a History tab (old `?tab=history` links
  land on the page).
- **A level is guessed at intake**, per bill line, flagged, inherited by a
  line's configurations, and accepted a run at a time.

**Verified in the browser against the sandbox packs**, not fixtures: the real
AP364 Panther drawings showing `UPH-07` captions resolving to COM 1 plainly and
`CH-01.1` captions resolving to COM 1 in yellow with their reason, a caption
whose label names a different piece left alone; the confirmed AP364c run
showing *Review complete · 240 specs applied*; the projects list, its search and
a COMPLETED pill appearing with no button pressed; and a run's two suggested
levels accepted in one click under one change set. **Not accepted by Max**, on
any screen.

**Built 2026-09-17, the email review is a table and the match works.** Max drove
the first real email review and reported both halves: "I don't know why it's
failed to match it… everything with an S-201 for this specific project, it's
going to apply for", and "what we should essentially have is just a table
listing each of the specs and then just list the changes". The load-bearing
section above carries the reasoning.

- **The run fan-out**, which is `resolveDrawingTargets`' rule applied to the
  pipeline that never got it. Verified against the sandbox Panther email: seven
  observations became 21 proposals across MUR, MAIN RUN and MAIN RUN - VE, every
  one with its record resolved, **with no document re-read and nothing charged
  again** — `POST /api/imports/[id]/rematch` re-resolves from the `raw` already
  on record.
- **One row per SPEC**, with what the email does to it, its value, and the runs
  it writes to; the per-run controls are inside the row, unchanged. The card
  stack and the separate amber "Not yet placed" panel are gone.

**Verified in the browser against the real staged email**, not fixtures: seven
rows fanned to three runs each, the two fabric rows badged as configurations, a
question set on one run flipping the verb to *Provides* and raising "the runs do
not agree", and the hydration error that first build introduced found and fixed
in the DOM. **Not accepted by Max.**

Two things it does NOT fix. The **question** match is still unseeded —
"Seat height" scores nothing against a category asking "Dimensions", so all seven
rows read *Question not matched* and a person picks from the dropdown; that is
`requirement_aliases`, a seeding job from verified wording. And **what to do
with a fabric stated for a configuration that does not exist** is undecided —
see the load-bearing section.

**Built 2026-09-17, an email's specs reach their BWS fields.** Max asked for
dimensions first, then the rest. Both are done and the load-bearing section
above carries the reasoning. Against the REAL pilot email, all seven values now
place: `Overall` to W/D/H, `Seat height` to SH, `Timber (legs and front rail)`
to Main timber finish, and the three fabrics to COM 1, COM 2 and COM 3 — with
no document re-read and nothing charged again.

`Arm height` stays unplaced, correctly: it is not one of the five slots, it
carries no finish code, and the requirement matrix has no question for it.

**Verified by 8 database-tier tests against the sandbox** — three slots writing
three attributes and ONE composed answer; a second email supplying SH
recomposing the whole cell; the qualifier kept as a note; a replacement refused
without an acknowledgement and writing nothing; the old row retired and the cell
recomposed with one; a stale occupant refused; a TBC recorded as a state; and a
finish landing on COM 1 and filling that checklist answer. Two defects were
found by running the real email rather than a fixture, and both are tested:
every re-matched fabric taking COM 1, and a finish re-reading looking like a
no-op. **Not accepted by Max.**

**Built 2026-09-18, the costing sheet's item block — the third output.** Matthew
sent the `skill.md` and its user guide; Max supplied a REAL COMPLETED sheet
(Maybourne Paris seating, 69 items). All three were read, and the first finding
was that **this repo had recorded the wrong blocker**: the skill generates no
price either, so "the app holds no pricing" was never what stood in the way.
`docs/plans/matrix-assumptions.md` is corrected.

`/api/projects/[id]/export/costing` emits columns A-J of
`Estimating Sheet Template - with stone.xlsx` — xlsx with real hyperlinks and
embedded item pictures, or csv — sharing `loadExportScope` with the BWS file,
the check sheet and the quote. The load-bearing section above carries the
reasoning, including why it stops at J and why `Tags` carries the composed
dimensions.

**What the skill does that the app now makes unnecessary:** OCRing 300 pages to
learn which page each ref is on (the app recorded it at confirm, per
attribute), a ruled-line heuristic with a `BLANK_THRESHOLD` you lower when pale
items crop blank (the app has a reviewer-confirmed crop), and deleting
section-header rows (`parseBoqSheets` never made records from them). What the
skill contributed was the target: the template, its location and its layout.

**One rule of the skill is deliberately NOT adopted.** It converts every
dimension and rounds UP to the nearest 0.5cm. That is right for an estimator
pricing the safe side and wrong for the spec record, where
`composeDimensionCell` refuses to emit a number it could not derive. The export
ships the composed millimetre cell; nothing here learned to round.

**Verified against the sandbox, not fixtures** — AP364c MAIN RUN, 19 rows, 11
carrying dimensions off the real shop drawings, 11 links, 11 pictures, and a
configuration correctly carrying a blank quantity — plus 22 pure-tier tests.
**`Specs 2` has never fired against real data**, because no record in the
sandbox is yet specified across two pages. **Not accepted by Max**, and nobody
has pasted one into the real template.

**Built 2026-09-18, the gates build on each other.** Reported on sight of a real
record: `TGQ 2 outstanding` · `TG0 5 outstanding` · `TG1 ✓`. A gate is now
satisfied only when every gate before it is, `gateStatus` no longer returns a
field called `satisfied` at all, and the panel and the spec table both say what
a gate is waiting on instead of ticking it. The load-bearing section above
carries the reasoning. **No schema change, no seed change, no model call.**

**Verified in the browser against the sandbox demo project**, not fixtures: the
exact record from the screenshot now reads `TGQ 2 outstanding` ·
`TG0 TGQ first · 5 of its own` · `TG1 TGQ first`, its tab count `0 of 3` rather
than `1 of 3`, the panel naming both gates in its way with a click through to
each, and the spec table's TG1 column reading `0 after TGQ` in slate where it
ticked green before. Plus 7 new pure-tier tests. **Not accepted by Max.**

**And it found a bigger one, measured rather than assumed: `Product code` is
`unanswerable` on all 179 sandbox records that have a matrix view** — one of
Matthew's id-less rows with no home in this app — so NO record can satisfy TGQ,
and with the chain none can reach TG0 or TG1 either. Every gate tick in the
sandbox is now correctly gone. This is a seed/migration question and a question
for Matthew, not something a reviewer can answer, and it must not be fixed by
weakening the chain.

**Built 2026-09-18, the intake reads the document and the app stops guessing.**
Three defects reported in one sitting — a transposed dimension cell, a card
nobody could read, one armchair about to become two BWS jobs — were three faces
of code inferring what the model could have been asked to read off the page.
`house/conventions.md` §6 was rewritten to allow it; the two load-bearing
sections above carry the reasoning. Measured before and after with a new read-only
`npm run measure:drawings`. **On the Panther-d pack, re-read for ten charged
calls: items slotted by size 10 → 0, disputes 14 → 0, label disagreements 3 → 0,
false configuration splits 4 → 0, inline rows with no figure 25 → 3.** The nine
other staged runs are untouched and still version 1, which is what versioning the
staged shape is for. **Not accepted by Max**, and the intake classification path
has never been driven with real files.

**Built 2026-09-18, the app is what was signed off — the design language.**
Max drew sixteen mock-ups (`docs/design/spec-builder-mockups.html`) and the
whole app was rebuilt to them in one day: a dark top bar with the environment
chip and an unplaced-mail bubble, a header band and URL-backed tabs on every
screen, two content widths, one tone vocabulary, and the screens themselves —
sign-in, projects list, project overview, spec table, the record's four tabs,
finishes library, chase, inbox, intake pack, BOQ review, drawings review,
email review — each built to its tab of the file. Five loaders were added so
every number the mock-ups show is real (Owes us, per-question waiting, quote
readiness, the gate matrix rows, what an email found), each calling the single
implementation that already existed. The rules are in
`docs/design-language.md`, rendered at `/dashboard/design`, and the procedure
is the `new-screen` skill. Found and fixed on the way: the two inverted
`STATE_PILL` maps, the title squeezed by the export cluster, a held inbox row
printing "specs" with no number, "n days ago" counting hours, a filename
wrapping a row to six lines, an email review labelling a fabric "Dimensions",
and both open `found-in-use.md` entries on the record screen. **Not built:**
the spec table's Columns chooser, per-spec ticks on the email review (a confirm
is per RECORD and refuses a subset), "Bring them in" on the finishes page
(`createFinish` links nothing), a chase email preview, and a configuration's
quantity. **Verified in the browser against the sandbox DEMO-TEST-01 by the
agents that built each screen and by a walk of the projects list, overview,
run tab and record tabs; not accepted by Max on any screen.**

**Built 2026-09-19/20, Stage 1a of `docs/plans/make-it-work-2026-09-19.md`.**
Ten items, three Opus coders in worktrees, every diff reviewed against §2.3,
the four checks run with the database tier REQUIRED before each cherry-pick,
and each DoD driven in a browser on the sandbox before its push: **phase** on
every screen and in every document (with a lexical guard over the screen
sources); the BOQ header sentence; the BWS ordinal off every screen; the two
chase counts each saying what they count, the header button counting what a
chase will ask; `TBC – <fabric>` as a state; one `nextStep` rendered as every
screen's primary; the phase table's count opening onto the missing fields; the
correction verb (0033); the chase preselecting the TGQ set for the chosen
contact. The dated evidence per item is in `docs/plans/README.md`
(2026-09-20). **Not accepted by Max or Matthew on any screen.** The
first-session script (`.claude/skills/verify/files/first-session.mjs`, the
release gate that never calls the model) ran against the `b76cfb0` deployment
on 2026-09-20: 20 pass, 0 fail, 8 skipped by design — so **Stage 1a is
closed on staging**. Remaining and Max's: the script on pilot and the
hand-over message; 0033 and the promotion itself are done (see below).
**Stage 1b is built and
deployed at `da863b7`**, at Max's instruction of 2026-09-20: packaging lines
suggested for ignoring, one summary line on the pack, a document's state as a
pending count, the swatch reaching page 2, a level set on the drawings card,
and the crop investigation concluding that the prompt is the fix (deferred to
the finishes-schedule re-read). Not accepted by anybody. The whole of Stage 1
is therefore on staging, and on PILOT since 2026-09-22; the script on pilot
and the hand-over message are still Max's.

**Stage 2 opened 2026-09-20** (its stage brief is at the end of the plan), in
dependency order because Matthew's screenshots have not arrived. **On staging
so far: 2.4** (area as a filter on the phase table and the chase screen) and
**2.5** (the chase EMAIL grouped by question × area; a colleague as recipient),
both verified in the browser on the sandbox — 300-line phase narrowed to one
floor, `18 of 300 shown`, tiles unmoved; a 69-question draft whose body holds
exactly its 69 coverage rows under 8 question tables and 28 area rows; a
colleague's draft reading "we still need". **2.3 and 2.7** (the infill screen
and its by-question tab) followed the same day: `/dashboard/projects/[id]/infill`,
measured first (`npm run measure:outstanding`), lines shipped rather than the
19 MB of questions, four gaps on two items filed under one meeting's change in
nine seconds. **2.6** (the dimension note, migration 0034 on the sandbox),
**2.8 step 1** (the project-wide fold) and the snapshot-race fix landed at
`9715b0f`; **2.10.f** (three reads at a time per pack, the rest *waiting for a
slot*, and since `73cf827` *Read all* too) and **2.10.g** (the failure
sweep: every `catch` and every fetch under the dashboard reaches a rendered
sentence, three fixed) at `d1e56b3`; **2.10's variance matrix** — 23 rows over
bills, drawings, emails, records, phases and finishes, each proceeds / flags /
refuses, thirteen of them changing code — and **2.11** (a confidently routed
email assigned automatically, the gate amended by Max in the same commit)
followed on 2026-09-21. **Stage 2 is CLOSED on staging as of 2026-09-21**
(the plan's stage brief carries the §7.1 evidence); what stays open waits on
a person: 2.9 Matthew's tiles answer, 2.12 another
session's plan, 2.13 the note to Tony. Still true at `9715b0f`: the demo sofa reads `W1830 x D880 x H760 x SH440mm (1250 L-shaped
return)` on its Specs tab, its checklist and the BWS export after one Save,
one change set and one version. Not accepted by anybody. **Blocked
and saying so:** 2.9 (a proposal for
Matthew), 2.11 (the rate cap first, then Max's own amendment of the inbound-
email gate above), 2.12 (another session's plan).

**PROMOTED TO PILOT 2026-09-22, at Max's instruction, with the §7.5 gate
KNOWINGLY OVERRIDDEN.** The stage brief said nothing promotes until Max has
driven 2.3 and 2.5 as the roles they are for, and that review is still not
recorded — it is still owed before Matthew is pointed at this build. What
made the override cheap: **the pilot database held no projects at all**, so
there was no stable build to disturb. `pilot` fast-forwarded `da863b7` →
`0bd39d2` (153 commits, the whole of Stages 1 and 2), after a backup, the
four checks green at that SHA with the database tier required (1986 passed,
1 skipped, clean build), `0034` and `0035` applied BEFORE the code, and a
re-seed that finally puts the 96 BWS palette options on pilot. Steps 4–8 of
`docs/environments.md` — a deployment for that SHA, `Ready`, `/api/auth/me`,
the PILOT chip, the first-session script — are Max's at the console; the
pilot URL is recorded nowhere in this repo. Details: `docs/plans/README.md`,
2026-09-22.

**Built 2026-09-23, configurations, manual control and Opus**
(`docs/plans/configurations-2026-09-23.md`, ten steps from one morning's
reports). Extraction reads with Opus 5; a page's named configurations come
through as tabs and land one cloth per record; a reviewer fixes the reading on
the card; a person adds, renames and retires a configuration after confirm; two
documents meet on one set of configurations through a question; the intake
status moves without a reload; an oversize document is refused before upload.
**Verified in a browser on a LOCAL stack holding copies of the real Panther
pack** (the sandbox is company data and read-only for Claude), and the
database tier ran there for the first time off the sandbox — it found four
defects on its first run, one of them a SQL comment that would have broken the
pack screen. **Not accepted by Max**; the staging session with the real pack is
the acceptance.

**Built 2026-09-23 (afternoon), any bill, never stuck** —
`docs/plans/any-bill-2026-09-23.md`, from Max and Matthew's run-through on the
Miami Beach pack. Five Opus coders through `anybill-int`, the four
checks with the database tier on the local stack before each landing, and every
step walked in a browser on copies of the REAL Miami Beach and Panther files:
a bill mapped rather than refused (Columns panel, seeded synonyms, saved
layouts, the model's structure read, fabric lines onto their items — 101/101
on the real AMB bill); the pilot mass failure explained and fixed (the silent
classify failure and the self-closing upload panel); bulk assign; the COM 1
clash answered as "same fabric or two"; configurations numbered 12.1 under
their line with common specs edited once; the BW standard beside the client's
words; the inbox per project. Migrations 0039, 0040 (+ seed 0012) and 0041
must be on a database BEFORE this code: an empty `boq_column_aliases` fails
every bill. **Not accepted by Max or Matthew on any screen**, and still open:
per-specifier tuning of the bill's own specification read (Step 8 — 559
proposals, few placed until the row-resolution work lands), a real 300-line
bill, and the three defaults awaiting Max (Sub-Area composed into the area, a
proposed standard holding at TBC, layouts saved per specifier).

**Outstanding — judgement, not code.**

- **Nobody has used any of this.** The four checks pass with the database tier
  running; human acceptance is outstanding on every screen.
- **The level guess rules are unconfirmed.** Nothing in the 17 cheat sheets
  defines simple / complex / hero; the rules read the BWS boilerplate split
  (metalwork → complex) and the document's own word for a hero. Matthew has not
  seen them. Until he has, what they produce is a suggestion on a screen, which
  is the reason nothing writes `spec_records.level` without a person.
- **No real bill has been parsed with a level column yet.** The parse → review
  → confirm path is covered by a route-tier test, and the sandbox's staged BOQs
  all predate the feature, so their Level cells read "— not yet —" (correct).
  The first real import is the test.
- **Nothing has been through the revised-BOQ path for real.** The P17231 bill
  was reconciled against its own run and read correctly, and then NOT
  confirmed: doing so would have rewritten 57 records of Max's sandbox data.
  The first real revision is the test.
- **`status_history` is still written and still never read.** Six confirm
  paths write it; the `spec_record` lines the BOQ and drawings confirms used to
  add are now change sets instead, and the `intake_run` lifecycle lines stay.
  The singular/plural `entity_type` defect is untouched and still matters
  before anything renders that table.
- **A swatch has never been cropped from a real page.** The upload path works
  and requires the source to be named; nobody has used it.
- **A pack now reads three documents at a time** (2.10.f, 2026-09-21 — see
  the registration section). What is NOT settled: an attempt that passes its 24-hour deadline
  frees its slot by ceasing to count rather than by anything handing on. The
  cap has never been exercised against the real queue — its db tests stub the
  publisher — so the first real Panther delivery is still the test.
- **A combined line's W x D x H order is assumed, and a human has never checked
  one.** `parseCombinedDimensions` reads "80 x 70 x 90 cm" positionally — the
  only inference in the dimension model that the page does not state. It is
  badged amber on the card and the composed cell is shown beside it, which is
  the whole safeguard. Two bare figures, four or more, and a line mixing
  prefixed with bare parts all get no slot instead. Nothing has been through a
  real S-203 sheet yet.
- **The real drawing set HAS now been through the model, and the review screen
  has been driven against it** (2026-09-17) — eleven pages, six cards, every
  page placing four slots in a known unit, one card confirmed onto
  configurations A and B across three runs on a `__QA` copy. What has NOT
  happened is the reading that decides whether intake is usable: a person
  comparing each card to its page, expected vs extracted, misses, wrong values,
  wrong units. `docs/plans/intake-review-verification.md` is the sheet for it
  and **nobody has filled one in**. This is step 2 of M8.
- **The export's job columns are this repo's judgement**: `Project Ref` is the
  project name, `Client` the client, `Name` the item description, `Item Count`
  the quantity, `Client Code` the BOQ refs. Confirm them against a real BWS
  import before anybody relies on the file.
- **`requirement_aliases` is still empty, and MEASURING IT SAYS TO LEAVE IT
  THAT WAY** (2026-09-17, `npm run vocab:gap`). Across all 19 staged documents
  — 1,428 observations, 128 distinct labels — 103 labels are unplaced, and
  every one is a dimension or finish the drawings path already classifies, a
  document's own metadata (title block, scale, vendor, date) or a supplier
  quotation's commercial columns. None of them answers a cheat-sheet question.
  36 have SOME overlap with a question and **not one of the 36 is correct**:
  `WIDTH SEAT` → "Seat upholstery build", `plan view depth` → "COM Payment
  Plan", `Delivery cost` → "Delivery direct to the client from PT or BG?". The
  control settles it — a document using BWS's OWN field name reaches the right
  question **221/221**. The matcher is not the limit; the pilot documents
  simply do not answer these questions, because a stitching spec or an
  interliner is settled by a designer's reply and no reply has been through the
  app yet. Seed this from a real chase reply, not from the drawings, and run
  `vocab:gap` first.
- **The level guess rules are this repo's judgement too**, and for a harder
  reason than the job columns: nothing written down defines simple / complex /
  hero. `src/lib/level-guess.ts` encodes the BWS boilerplate split and Max's
  description of it. Put them in front of Matthew with the TGQ workbook — it is
  the same sitting and the same person.

**Explicitly excluded, so they are not built speculatively:** feeding preamble
notes into later model calls; a BWS *import* file carrying job numbers; images
and scanned documents OTHER than a bill (PDF bills are BUILT since 2026-10-15:
*A PDF bill is read by its text*); splitting an oversize drawing set. M6
VE rounds. Any write to BWS. Automatic email sending.
SharePoint writes. (SharePoint READS as an intake source: Matthew asked about
them on 2026-09-18 without requesting them. On 2026-10-12 he asked Max to
INVESTIGATE reading from BWS's per-project P-number folder and mailbox. Not
built, and not to be built before that investigation and the talk with Steve:
`docs/plans/catchup-2026-10-12.md`, P5 and P6.) BWS Messenger and Teams ingestion. The
post-order/production flow.

**Two things left this list on 2026-09-18 and neither is next.** Gates are built
and were demonstrated, so "gap and completeness checking, and gates" was stale.
And **the TOE calculator's own logic is no longer excluded on principle** —
Matthew named it as wanted (*"maybe even have the terms of engagement calculator
in the app"*) as part of the app replacing specification development in BWS. It
is his next-phase picture, not this one; do not start it.

**Email intake (2026-09-16).** An email is a `document_kind`, staged, reviewed
and confirmed like any other specification document, writing
`spec_answers.source_kind = 'email'` under an `email_confirm` change that
carries the message as evidence. Verified end to end by uploading a saved
`.eml`, including one real model call.

**Microsoft Graph ingestion is BUILT AND DISABLED, and has never talked to
Graph.** The subscription lifecycle, the webhook, the delta poll and the
ingestion worker exist; `MAIL_INGESTION_MODE` is `disabled` and no mailbox,
tenant or secret is set anywhere, so none of it runs. Its own guards are
tested — webhook authentication, message-id validation, the paging-link origin
check, every disabled path. One defect the disabled path was hiding has been
FIXED (2026-09-17): a message stored under the mailbox prefix could not be read
once assigned, so every Graph-ingested email would have failed its first read.
See the copy rule in the email section above. The subscription lifecycle, the
delta semantics and the message shape Graph really sends are NOT. Turning it on
is six environment variables (`GRAPH_CLIENT_STATE` was required and documented
nowhere until audit H8, 2026-11-06; `AUTO_READ_DAILY_CAP` is optional) and a
redeploy, and the first real message is the test that matters:
`docs/integration.md` carries the checklist, including the access-policy check
that must pass in BOTH directions and "The spend guards", six checks with real
messages (a forged forwarding header held, a real forward stamped, a To line
delivered elsewhere held, the cap holding, one email by three routes making
one row, a move between projects and back) that must be walked before
ingestion is left on.

**The chase screen is grouped by furniture line (2026-09-17).** One row per
BOQ item, collapsed, in a table, with its finish options nested under it and a
search and filters above — see the load-bearing section. The screen is full
width; as of 2026-09-18 every dashboard screen is one of TWO widths through
`PageBody` (1100px, or 1400px for a dense table) — see
`docs/design-language.md`. **Verified by the four
checks and by 20 new tests across the pure and component tiers; nobody has
looked at it against real data.**

**Chase emails are back (2026-09-16), with a to-quote tier.** The screen is
restored with entry points on the projects list and the project overview, the
Waiting column and its derivation are back in `src/app/api/records/route.ts`
and `SpecTable`, and a **Needed to quote** column sits beside them. `GET
/api/drafts` now checks the session like every other draft route.

**Decisions awaiting the user:**

- **The gate model is SEEDED but its answers are Max standing in for Matthew.**
  Matthew's matrix arrived 2026-09-17 and is in as `spec_field_gates` (0026).
  Max answered the six open questions on Matthew's behalf on the same day so
  the work could start, and **nine more on 2026-09-19 after the catchup. Every
  one of them is still to be confirmed with him** — read `docs/plans/matrix-assumptions.md`, which lists each assumption,
  what it changed, and how to reverse it. The two that would cost most if wrong
  are the category mapping (three judgement calls, two of which widen a
  question onto items he excluded) and whether his TGQ set means only fourteen
  fields block a quote. `required_at_gate` is still null on all 788 rows and
  stays that way; TG2 is still unmodelled, and the cabinetry half of his matrix
  has not been written yet.
- **TGQ IS PARKED** (2026-09-19). Max, answering for Matthew: *"don't worry
  about that, that's not an issue for now."* And Matthew explained on 2026-09-18
  why the workbook never came back — *"I found it quite hard to go through it and
  do like a tick box thing. I ended up basically typing sentences."* So
  `requirements.tgq_levels` stays at 0019's seeded default, everything required
  of everything, for every category his matrix does not reach; the next attempt
  is a conversation transcribed into the matrix, not another workbook. The
  paragraph below is the record of how it was designed, not a live task.
  **2026-10-12: Matthew named a different route.** TGQ is to be marked IN THE
  APP, per job, while he and Claudia work real projects ("on this job, these
  are the critical specifications for TGQ … teach it … as we're doing it",
  45:00). Nothing in the schema holds a per-record TGQ mark. `tgq_levels` is
  per question and level, and `spec_field_gates` is per field and category.
  How a mark on one job becomes a category rule, and who promotes it, is
  undecided (`docs/plans/catchup-2026-10-12.md`, P2).
- **TGQ is out with Matthew** (2026-09-16), as a spoken interview. Read
  `docs/plans/tgq-for-matthew.md` before acting on the answers. The 728
  requirement rows are only **62 distinct questions** — "Stitching spec" is on
  fifteen cheat sheets and the commercial block is identical on all seventeen —
  so whether a question gates a QUOTE is one decision, not fifteen.
  `tools/tgq-interview.mjs` asks each once, per **level** (simple / complex /
  hero, the system Matthew described and BWS's boilerplates already name), and
  `tools/tgq-answers.mjs` expands the answer back over every category that asks
  it. `tools/tgq-checklist.mjs` is the same decision as a workbook, and is the
  route in use: **three tick boxes per question, all empty, and a tick means
  NOT needed to quote**. Empty states today's position rather than inventing
  one, since all 728 questions are required of everything now, so the value in
  the returned file is what Matthew strikes out. Three traps in that: the box
  is a bordered cell and the tick a plain `X` (Excel's own checkbox is a cell
  format exceljs cannot write, and 1,368 Form Controls make an unscrollable
  file); an empty box must be `null`, never `''`, which exceljs writes as a
  shared-string cell that `COUNTA` counts as ticked; and an empty box means
  "needed" AND "not looked at yet", which the per-category **"Been through
  it?"** tick disambiguates at 17 clicks rather than 1,368. **N/A** and unsure
  no longer have a control and go in Notes. Four things they settle and one
  they do not: an answer
  is inferred from nothing — unreached is `-` and unsure is `?`, both reported
  rather than defaulted to "No"; an exception is only recorded where Matthew
  named a category, and one naming a category that does not ask the question is
  REFUSED as invented; question ids are positional, so the pack carries a
  fingerprint of its question list and a stale answer sheet is refused rather
  than landing answers on shifted questions; **N/A** prunes a question off a
  category at the same sitting. What they do not settle: **an item's level is
  recorded nowhere**, so a TGQ rule has nothing to read until somebody sets a
  level on a record the way they set a category. Applying the answers is a
  re-seed plus a migration, not application logic.
- **Who owns the requirement matrix is undecided** — it currently relies on
  KAM / sales-support knowledge. Claudia Nogueira wrote the SharePoint cheat
  sheets it was seeded from (2026-10-01). On 2026-10-12, Matthew said he and
  Claudia will qualify it on real projects "for the next few months". That
  makes them its working owners in practice, but nobody has said so as a
  decision.
- **The question-to-BWS-field mapping is this repo's judgement, not Matthew's.**
  Only 28 of the 56 BWS fields are reachable from a cheat-sheet question. Review
  it before the export is relied on.
- **Source-document version precedence is undefined.** The SharePoint survey
  found the same BOQ and COM content at differing sizes in two places, and six
  incompatible revision conventions across the tree. A run now records the
  revision and date its bill printed, which is a start, not the rule. Curating
  the Panther folder sidesteps this for the pilot; it does not answer it, and
  Maybourne Paris stays deferred until Hayley confirms which revisions are
  current.
- **The Panther mailbox is not confirmed.** `projects.shared_inbox` has a column
  waiting for it and M5 ingestion stays disabled either way, so this blocks
  nothing in M8.
- **A BWS category boilerplate is a best guess, not a field list.** A complex
  item on a simple template will be short of fields. The tool must surface the
  extra statement rather than discard it, and several BWS columns are post-sale
  only — the pre-sale grid holds what the client provided. All 47 boilerplates
  were captured and mapped to `spec_fields` on 2026-09-15 and the feature stays
  deferred: read `docs/plans/boilerplate-grouping.md` before building grouping,
  it measures which 21 columns are post-sale and shows why a boilerplate cannot
  say what an item needs.

Keep this section current.
