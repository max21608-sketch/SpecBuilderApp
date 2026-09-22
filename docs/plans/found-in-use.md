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

**The plan that acts on what is open here is
`docs/plans/fix-found-in-use-2026-09-23.md`** (sixteen items in five stages,
seven more waiting on a person). Its predecessor,
`fix-found-in-use-2026-09-22.md`, closed the entries marked FIXED below.

**Reconciled 2026-09-22** against the tree at `553b8bf`, after Max asked
whether the file was current as of the Stage 2 build. Every status was checked
in the SOURCE rather than against the stage lists in `CLAUDE.md` — a stage
list records what was built, not what reached the screen, and an entry closed
on a list somebody else wrote is exactly the "fixed on paper" state this file
exists to prevent. Anything that could not be confirmed that way was left
open. Do the same on the next pass, and say in the entry what you checked.

---

## 2026-09-23

### `db:qa-clean` cannot sweep a `__QA` category, so one failed teardown breaks the tier for everybody

**Status: FIXED 2026-09-23** — the sweep now has an `item_categories` step, and
it was fixed mid-stage because the litter REGENERATED and cost a third coder
time. Verified after: 0 `__QA` categories, **17 categories still there** (the
cheat sheets, which is the guard that matters), `count(distinct prompt)` back to
74, and `tests/db/spec-field-gates.test.ts` green.

Two things in the fix are deliberate. The early `process.exit(0)` on "nothing
left behind" is gone, because it ran before the category step and would have
skipped it on exactly the run where only a category was orphaned. And the match
is `left(name, 5) = '__QA '`, **not** `like '__QA%'`: in SQL LIKE an underscore
is a single-character wildcard, so that pattern matches anything carrying QA in
the third and fourth places. The queries above it have always been written that
way and are safe because they also key on a project — a DELETE against
`item_categories` is not, and a sweep able to reach a seeded category would be a
script capable of emptying the requirement matrix.

**Seen once and not reproduced:** the first sweep aborted on a `spec_runs`
RESTRICT for a project that no longer existed by the time it was looked up —
almost certainly another coder's suite deleting rows underneath it, since one
was running. Re-running swept cleanly. Not recorded as a defect without
evidence; worth remembering if a sweep aborts on a quiet machine.

The original entry follows. **Status when found: open.** Found 2026-09-23 by the
chain above.

`tools/qa-clean.mjs` sweeps **by project**: it walks `email_drafts`,
`project_contacts`, `spec_answers`, `spec_record_refs`, `record_attributes`,
`attachments`, `spec_records`, `project_notes`, `spec_runs`, `intake_runs`,
`intake_batches` and finally `projects`, all keyed on a project id. There is
**no `item_categories` step and no `requirements` step**, so a `__QA` category
a fixture created and failed to drop is invisible to the sweep and stays for
ever.

**Why that is worse than an orphan row.** `requirements` is SEED data that
every category reads, so three leftover rows moved a project-wide count and
failed `tests/db/spec-field-gates.test.ts` on **every later run, in every
worktree, for every agent** — and it failed in a way that reads as a seed
regression in whatever commit is under test. Two agents lost time to it on
2026-09-23 before the cause was found.

**What the fix has to be careful about.** The sweep must match the `__QA `
prefix WITH its trailing space, as everything else does, and must delete the
requirements before the category. It must never touch a category that is not
`__QA` prefixed: the seventeen cheat sheets are the requirement matrix, and a
sweep that could reach one would be a script capable of emptying the register
this app is built on. `qa-clean` already refuses production outright and that
stays.

**Not adjacent work, whatever it looks like.** A cleanup script that cannot
clean up what the tier creates is the same class of defect as a fixture writing
a shared key — the rule `CLAUDE.md` states as *"the same goes for any other
shared key a fixture writes"*.

### A seeded-prompt count test fails on clean staging — 77 where it expects 74

**Status: the SYMPTOM is resolved and the CAUSE it exposed is open, below.**
The count is back to 74 and the test passes (verified 2026-09-23 on the
sandbox: zero `__QA` categories, `count(distinct prompt)` = 74).

**My first diagnosis here was wrong and is kept rather than deleted.** I wrote
this entry as three possible readings of a seed drift. It was none of them: the
database was carrying LITTER. `tests/db/chase-drafts.test.ts` creates its own
`__QA` category and three requirements in `beforeAll`; a run whose teardown
failed under concurrent-run contention left `__QA Chase drafts
category-fbfd6e` and its three requirements behind, and those three prompts are
the 77. Found by 4a.6's coder, who deleted the orphan by hand on a quiet
machine; checked here afterwards rather than taken on trust.

**One thing that coder reported is NOT right**, and it matters because it would
send the fix to the wrong file: the fixture's category IS per-process suffixed
— `qaNumber("Chase drafts category")`, `tests/db/chase-drafts.test.ts:96-101`,
which is why the leftover row carries `-fbfd6e`. The fixture is following the
rule. What failed is teardown, and what made a failed teardown permanent is the
sweep — see the entry below.

The original reading follows, wrong, as written. Checked independently on the
main checkout at `e89401c` with no item's changes present, and in a clean
detached worktree at `4d93816`; it failed identically in both, which was true
and told me nothing, because the litter was in the database they share.

`tests/db/spec-field-gates.test.ts:198` — *"a reused prompt is byte-identical"*
— asserts `select count(distinct prompt) from requirements` is **74** and the
sandbox now answers **77**. The test exists so a re-seed that PARAPHRASES a
prompt instead of reusing it is caught, which is exactly the class of drift a
count moving would indicate.

**Do not fix it by editing the number.** Three readings and they are not the
same: a re-seed genuinely added three distinct prompts (the number is right and
the expectation is stale), or three prompts were paraphrased where they should
have been reused (the test is doing its job), or the sandbox carries rows a
seed did not write. `select prompt, count(*) from requirements group by prompt`
against the seed files says which. Same discipline as the palette counts: a
count moving is not a number to edit, it means somebody should read the diff.

## 2026-09-22

### The projects list sorts alphabetically by BWS number, and should sort by most recently worked in

**Status: FIXED 2026-09-23, `44a714d`** (plan item 4a.6), on staging. Sorted by
`greatest(max(change_sets.created_at), p.created_at) desc` through a `left join
lateral`, with active-first and the `bws_project_number` tiebreak both kept.
EXPLAIN confirms `change_sets_project_idx` is used — one index-only search per
project, zero heap fetches — and the lateral is there rather than a scalar
subquery because inline it is evaluated per reference, which is two searches
per row for one fact. The sandbox reordered to `p4353453` (worked in 16:41),
`DEMO-300` (14:18), `DEMO-TEST-01`, `AP364c`… against the old alphabetical
`AP364c, AP364d, AP364e, DEMO-300`. The `updated_at` trap is written into the
query's own comment. Nobody has looked at the reordered list on a screen. The
original entry follows.

**Status when found: open. A CHANGE ASKED FOR.** Max, on the projects list: *"we should
automatically sort projects by most recent — and that should be most recently
worked in, or edited, or added."*

**What is on the screen.** `AP364c`, `AP364d`, `AP364e`, `DEMO-300`,
`DEMO-TEST-01`, `P17231` — fourteen projects in BWS-number order.
`src/app/api/projects/route.ts:44` is `order by case p.status when 'active'
then 0 else 1 end, p.bws_project_number`, so the list is alphabetical inside
each status and nothing about it moves when somebody spends a day in a project.

**The obvious column is the wrong one, and that is the whole of this entry.**
`projects.updated_at` exists and moves only when the PROJECT ROW is written —
renaming the client, setting the TOE dates. Confirming a hundred specs, running
an intake, filing a chase or correcting a finish never touches it, because
recording that something happened deliberately never writes the row it happened
to (the `bump_version` rule). Sorting on it would rank a project somebody
renamed above one somebody worked in all afternoon, and it would look right
until it mattered.

**`change_sets` is the honest source, and the index is already there.** Every
consequential act opens one and carries its project: a confirm, an answer, a
correction, a retire, a level accepted, a finish edited. `max(created_at) group
by project_id` is served by `change_sets_project_idx (project_id, created_at
desc)`, which 0012 already creates — so the sort key costs an index lookup per
project rather than a scan over the fastest-growing table in the schema, which
matters here: this database has run out of space once already, and the culprit
was `audit_log`.

Four things to settle rather than assume:

- **"Or added" is a second term in the same key.** A project created this
  morning with nothing done in it has no change set at all and would sort last
  — the opposite of what the ask says. The key is
  `greatest(max(change_sets.created_at), p.created_at)`, and the column that
  answers "when" has to be the one the row is sorted by, or the list and its
  own caption disagree.
- **Not everything that is "work" opens a change set**, and the two exceptions
  are recorded. `assignMessage` opens none — an automatic assignment carries
  `system:router` through the audit layer's `updated_by` instead — and there is
  deliberately no trigger refusing writes made outside a change set, because
  db-tier fixtures and hand fixes with `psql` write rows directly. So a project
  whose only recent event was mail arriving will not move. Whether a delivery
  into the inbox counts as working in the project is Max's call, not a
  technical one.
- **Active-first has to survive.** The current order puts active above archived
  when *All* is shown, so archiving a project moves it out of the way even for
  somebody looking at everything. A recency sort replaces the second term of
  that order, never the first.
- **Keep a stable tiebreak.** Two projects with no activity and the same
  creation second would otherwise shuffle between reloads; `bws_project_number`
  stays as the last term, where it can do no harm.

**Not asked for and not to be inferred:** sortable column headers. The ask is
what the list does by default.

### The by-question tab needs an apply-to-all, and Access is the question that proves it

**Status: FIXED 2026-09-23, `5dbbda6`** (plan item 4a.4), on staging, and the
only item of the stage a person has actually DRIVEN. On `p4353453`, *Access -
Select option*: 28 items, select-all, two unticked, a palette option chosen —
**26 answers written under ONE `manual_edit` change set, 26 snapshots over 26
distinct records, the two left `missing`.** Pressing again read *"Record on 0
items"*, which is the settled-row rule working. On DEMO-300 the same heading is
408 items and **Dimensions offers no tick at all**, printing the slate note.
Everything written was reverted; the sandbox is back to 28 `missing`.

**"All" means the rows DRAWN under the opened heading** — not the loaded set and
not the heading's own count — so every tick is visible to be taken off again.
The bar says which number it is in words, including *"2 more owe this question
and are hidden by your filters — a filter never changes what is written"*, and
the heading's own ITEMS/TGQ counts never move.

**A skipped row is named, never silently dropped.** The route returns
`{ filed, skipped }` and each skipped row carries its label and a reason —
*somebody changed it since this screen loaded*, *already answered — change that
one on its own*, *a dimension is recorded per item, not in a batch*, *it has
been retired*. Nothing appliable at all is a 409 naming every row.

**Two things beyond the brief, both kept.** `editAnswer` gained a `snapshot`
opt-out because `snapshotRecords` batches its lock and its `loadRecordAtoms`,
and calling it per answer re-does both: **13.6s → 6.9s for 26 answers**, one
version pass at the end. A caller that passes `false` and forgets is caught by
`tests/db/change-history.test.ts`, which reads the whole database — re-run here
after the cherry-pick and green. And an OPEN change wins over the route's own
reason, because `changeSetForEdit` opens a fresh change whenever a reason is
supplied, which would have detached the press from the meeting's `OpenChangeBar`.

**Measured and NOT done: a 408-row press has never been driven.** 26 rows is
6.9s, so 408 is roughly two minutes — inside the 300s budget, under a `MAX_ROWS`
of 500, and untested. Writing 408 answers into DEMO-300 would have spoiled a
TEST project kept in a demonstrable state.

**Still not built, and not replaced by this:** answering a project-wide question
ONCE per project. A batch applied to 28 does not stay right when a 29th item is
added — that remains Matthew's question. The original entry follows.

**Status when found: open. A CHANGE ASKED FOR — and it is the trigger condition
on something that was deliberately parked.** Max, on *Fill in what we know* → **By
question**: *"we need basically an apply-to-all box. For access, most likely it
is going to be the same for everything. Even better would be a tick box with an
option to select all, but then you can untick some. This screen doesn't really
make sense if they have to go through every single one — it's 'no, access has
been approved for everything', and we just go in quick and give access to every
item."*

**What is on the screen.** `Access - Select option` · *asked by 4 categories* ·
**ITEMS 28** · **TGQ 28**, opened to 28 rows — `p4353453-001 Headboard`,
`-002 Headboard`, `-003 Sofa`, … — each with `— not answered —`, `TBC`,
`Missing`, and each carrying the identical prompt *"Is access ok? Lift info (is
there a lift or lift size) Standard door (740 x 1900 mm)"*.

**That question is ALREADY classified as project-wide, and step 2 was parked
waiting for exactly this ask.** `db/seed/0003_requirements.sql` seeds it — BWS
field 6 — with `section = 'Project / commercial'` on all seventeen sheets, and
`src/lib/checklist-sections.ts` says in its own header that step 2, *"a column
(`scope = 'project'`) and answer it once for the whole project"*, is
**deliberately not built**, *"because folding the section is what Matthew asked
to see first and a fan-out is a data model change nobody has agreed."* The
recorded condition for building it was somebody asking again.

**The ask is BROADER than that section, and the two must not be run together.**

- **Answer once per PROJECT** is a data-model change: a scope column, one
  answer row for eighteen questions, and every screen that reads
  `spec_answers` learning that some answers belong to no record. It covers the
  Project / commercial section and nothing else.
- **Apply one value to the items on screen** is a UI batch over writes that
  already exist. It covers ANY question — a metalwork finish that happens to be
  the same on forty items, not just the eighteen — and it is what the
  screenshot asks for.

The second is much the smaller change and is not a substitute for the first: a
project-scoped answer stays right when a 29th item is added, and a batch
applied to 28 does not.

Five things the batch version has to get right, each already learned somewhere
in this repo:

- **One press is ONE change set.** `editFinish` filed eleven codes as eleven
  entries in the trail until `changeSetId` was threaded through it. Twenty-eight
  answers are one change and one version per record, not twenty-eight of each.
- **"All" must mean what the screen is SHOWING, and say so in words.** This
  screen carries an area filter, a state filter and a search, and prints
  `58 of 58 questions shown`. *A filter narrows what is LISTED, never what is
  asked or written* — an apply-to-all that quietly reached rows the filter is
  hiding would break that rule in the most expensive direction there is. The
  select-all-then-untick shape Max describes fixes it by making the set
  visible, which is the argument for building that one rather than a bare
  button.
- **It must not silently overwrite an answer somebody already gave.** A
  person's own answer is the single thing `applyAnswerFills` has never been
  allowed to touch. The control can offer to, and has to say how many.
- **Never on a dimension row.** `rowKind` reads `jsonId === 3` and writes an
  ATTRIBUTE rather than an answer, because the Dimensions cell is a projection
  of the attributes — applying one width to 28 items is the one case where
  apply-to-all is certainly wrong.
- **Twenty-eight writes are twenty-eight requests today**, each with its own
  optimistic lock, and a single row reloads itself on a 409. A bulk route has
  to keep that: a batch that half-lands with one banner leaves nobody knowing
  which half.

The fan-out target is not in doubt: `groupByQuestion` already carries
`requirementIds` — every `requirements` row folded into the heading — so each
item is written against its OWN category's row rather than the one the heading
happened to be named after.

### The page prints a swatch and the intake takes no picture of it

**Status: FIXED 2026-09-23, `d7461d7`** (plan item 4a.2), on staging, on top of
4a.1. The control is no longer gated on a raw client code: it is offered
wherever the row RESOLVES to a finish — a client code, a finish 4a.1 matched or
the reviewer accepted, or one about to be minted at confirm. Fabric, timber and
metal alike; `classifyCallout` already tells them apart.

**It reuses 4a.1's resolution rather than writing a second one** — `readUncodedFinish`,
the same pure function `confirm-drawings.ts` calls — so the screen and the
confirm cannot disagree about which library row a picture belongs to. **The
confirm path needed no change at all**: 4a.1 already built the map and the
`swatch_has_no_finish` refusal already sat downstream of it, so the brief's
"keep the refusal" was satisfied by tests rather than by code.

A row about to be minted shows the control with **no code on it**, because the
number is allocated under the project row lock at confirm and printing it early
names a code another reviewer's confirm may take. An unfiled row says *"No
swatch yet — file this finish above and the crop control appears"*, and a row
stating no value at all (`PIPING / TBC`) says nothing, because there is nothing
to file.

**Found and fixed on the way, not in the brief:** withdrawing a filing now
withdraws any crop held for that row. Without it, un-filing left a crop in the
screen's ref with no control and no preview, and the confirm then refused the
WHOLE card over a picture nobody could see. The refusal was right; discovering
it that way was not.

**Still true, and it is the DoD:** nobody has cropped the S-203 chip off a real
page. That remains the first swatch ever taken off a real drawing, and it wants
a VISIBLE browser — pdfjs renders nothing in a hidden or headless pane, which
`CLAUDE.md` records. The original entry follows.

**Status when found: open. Asked for**, and it chains onto the entry above. Max: *"in the
intake, I still don't think we're taking in a crop of the fabric or metal spec
as an image."*

He is right, and it is three separate things rather than one missing feature.

**1. A swatch control is only offered on a row that carries a CLIENT CODE.**
`ObservationRows.tsx:561` is a bare `observation.materialCodeRaw &&` around the
whole `SwatchPicker`, with the reason written beside it: *"a swatch needs a
code, because that is what `project_finishes` is keyed on. A row with no code
has no finish to attach a picture to, so the control is not offered rather than
offered and refused."* The reasoning is sound and the consequence is the S-203
page: the sheet prints the woven chip directly under *Fabric reference: Aissa
Dione, ref. Losange raphia beige et écru*, the caption carries no code, and
there is no control on that row at all. **The swatch has nowhere to go for the
same reason the library row does not exist** — one keying decision, two
symptoms.

**2. Nothing PROPOSES a swatch, even on a coded row.** The model is never asked
where one is: `CLAUDE.md` records it as a priced decision, not an oversight —
*"Swatches arrive by hand. A person uploads one and must say which document and
page it came from. Asking the model for swatch regions is a tool-schema change,
which means re-reading and re-paying for every document already read."* So a
reviewer has to notice the chip, press *Drag a box*, and draw it.

**The contrast with the ITEM PICTURE on the same card is the sharp part.** That
one IS proposed: the model reports `viewRegions`, and a page that reported none
*proposes the whole page* rather than defaulting to "no picture", because on a
specification sheet the page is the drawing of the item. Same page, same
`PageCropper`, two different behaviours — the photograph of the chair is
offered ready to accept, and the fabric chip beside it is offered only if the
caption is coded, and never proposed.

**3. Nobody has ever cropped one from a real page.** Already on the M8
outstanding list and still true: *"A swatch has never been cropped from a real
page. The upload path works and requires the source to be named; nobody has
used it."*

Three things a plan has to settle:

- **Whether the swatch waits on the keying decision or routes round it.** If a
  code-less finish gets a library row (the entry above), the control follows
  for free. If it does not, a swatch on an uncoded row needs somewhere else to
  live — and the obvious somewhere, the record's own attribute, is not what
  `project_finishes` was built for: *"a swatch belongs to the CODE, not to the
  item"*, because `WD-05` is on three pages of the real set and cropping it
  once should crop it for every item carrying it.
- **Whether to pay for the tool-schema change.** Asking the model for swatch
  regions re-reads every document already read. It is the same bill as the
  finishes-schedule code field, and both are about the same thing — so if one
  is paid for, both should land in that read rather than in two.
- **A metal or timber chip is the same shape as a fabric one.** Max named both.
  `classifyCallout` already tells a fabric from a timber from a metal, so
  nothing new is needed to know which kind a chip belongs to — only where on
  the page it is.

### A confirmed fabric is on the record and not in the finishes library, because it carries no code

**Status: FIXED 2026-09-23, `e1d167a`** (plan item 4a.1), on staging, with
migration **0036** applied to the sandbox. A finish the document named without a
code is filed under a minted `BW-F-001`, allocated per project under the project
row lock — the `record_no` rule — scanning retired and client-origin rows too,
so a code somebody quoted in an email never comes back and a client schedule
printing `BW-F-002` cannot collide. `project_finishes.code_origin` says whose
code it is, as a COLUMN and never as a reading of the spelling. The same wording
on a later item links to the same row; a near miss is offered and files nothing;
a third answer files it APART, because otherwise the one automatic step in the
item is the one nobody can undo. And the link route that was built with no
caller is wired to the record's Specs tab.

**The guard that matters passes:** no cell anywhere in `composeRow` contains
`BW-F-` (`tests/lib/bws-export.test.ts:489`), over a row carrying two internal
finishes. `composeFinishCell` returns the description alone for an internal
finish and every caller falls back to the attribute's own words — checked
caller by caller: the BWS export, the quote, the check sheet, the checklist
answer, the version diff, and the record screen. The costing sheet does not call
it. Concurrency is asserted by opening two transactions before either commits.

**Five departures from the approved mock-up**, each with its reason in the
commit: the control sits under the value rather than in a new column
(`OBSERVATION_COLUMNS` is load-bearing); the chip reads *"ours — a code on
confirm"* before the number exists, because printing `BW-F-001` early names a
code another reviewer's confirm may take first; the evidence line says *"Same
wording as BW-F-001"* rather than naming the item, which would be a second query
per observation; a near miss is a loose fold (accents and punctuation dropped,
so `écru`/`ecru` is offered) rather than an edit-distance threshold; and the
chip is blue rather than the mock's violet, because `tone.ts` is the only place
a colour may come from. **The last two are worth Max's eye** — the mock he
approved said *"Same wording as S-203"*, and what counts as a near miss was
never specified.

**Not done: the swatch control is still gated on a raw client code** — that is
4a.2, which this unblocks — and nobody has walked it in a browser. The original
entry follows.

**Status when found: open. Half of it is a keying DECISION and half of it is a
route with no button.** Max, comparing the two screens: *"there's a finish in the item's
specs captured page, but it doesn't appear in the project finishes. Why is
this? It should."*

**What is on the two screens.** On the S-203 record, Specs captured: `Fabric
reference` · *Aissa Dione, ref. Losange raphia beige et écru* · BWS field
**COM 1**, sourced to `SPEC-346-Seating - S-203 - Armchair.pdf`. On the same
project's **Finishes** tab: *"No finishes yet."*, and the Add box prompting for
a code shaped like `CH-01.1`.

**Why, exactly.** `project_finishes` is keyed on the CLIENT'S OWN CODE —
unique on `(project_id, code_norm)` — and this caption carries none.
`resolveFinishCode` (`src/lib/finishes.ts:164`) reads `materialCodeRaw`, and
with nothing there it returns `status: "none"` before it looks at anything
else; `confirm-drawings.ts` then writes the attribute with a null `finish_id`
and creates no library row. *Aissa Dione* is a supplier and *Losange raphia
beige et écru* is a product reference. Neither is a project finish code, and
the model was right not to invent one. The project holds no finishes at all for
the same reason: nothing confirmed so far carried a code.

**So it is not a broken link — it is that there is no key to file it under.**
And the table already has the right columns for this exact value:
`supplier_raw`, `reference`, `description`. What the row would lack is the one
thing the library is addressed by.

Three ways to close it, each with its own trap, none of them chosen here:

- **Key a code-less finish on its DESCRIPTION.** This is the
  `normaliseFinishCode` trap moved to a field made of prose: the same fabric
  written two ways on two pages becomes two rows, and a normaliser clever
  enough to merge them is clever enough to merge two things somebody kept
  apart. `CH-01.1` and `CH-01-1` are deliberately two finishes; two spellings
  of a French fabric name are far more alike than that.
- **Ask the reviewer for a code on the drawings card**, at confirm, where they
  are already looking at the page. Never-invent survives — a person supplies
  the key — and it adds a question to every uncoded finish on every card.
- **Allow a library row with no code and a surrogate key.** That changes the
  unique index the edit-once guarantee rests on, and every screen that says
  "this corrects every item carrying this code" has to say something else.

**And there is a real gap underneath it, found on the way: the link route
exists and NO SCREEN CALLS IT.** `setAttributeFinish` (`finish-edit.ts:234`)
and `POST /api/attributes/[id]/finish` are built, version-checked, reason-
bearing, `finish_link`/`finish_unlink` change kinds and all — and `grep` finds
no caller anywhere under `src/components` or `src/app/dashboard`. So even
today, with a code: somebody can add `CH-01.1` to the library by hand and there
is still no way to attach this record's COM 1 spec to it. `CLAUDE.md` already
records the neighbouring half — *"Bring them in" on the finishes page was not
built (`createFinish` links nothing)* — and the linking half turns out to be a
route waiting for a button.

**One consequence to keep in view when it is built.** `composeFinishCell`
renders the LIBRARY where an attribute is linked, so linking this row would
change what the BWS cell, the checklist answer and the record screen all say —
from the page's own words to the library's. That is the edit-once rule working
as designed, and it is exactly why linking has to be a person's act rather than
something a confirm does on a description match.

### Finishes by room — NOT a defect, and a build that has to happen at some point

**Status: not a fault. Recorded because it will be needed, and because the
screen that prompted it is behaving correctly.** Max, on the S-203 card
(screenshot, with the page beside it): *"this isn't an issue, because no
material or finish was actually stated — but at some point it raises a good
point, that we need an option to add finishes by room, or change finishes by
room at a later date if they're not referenced here, or change finishes from a
finish spec doc. This will probably be a larger build, not a bug fix, but it is
something that is going to have to be done."*

**Why the screen is right.** The sheet prints `Material/ Finish:` with nothing
after it, and under it `Area used: Refer to Argenta room by room schedule`. The
card stages an empty `Material/ Finish` row — group Other, no BWS field, TBC —
which is exactly what the page says: the field exists, the page left it blank,
and the page names ANOTHER DOCUMENT for the room-by-room part. Inventing a
finish there is the failure M8 exists to prove against; an empty row that says
TBC is the honest reading.

**So the pack itself states that a finish varies by room**, and names a
schedule this app has never been given.

**What exists today, so a build starts from the right place rather than
rediscovering it:**

- **Changing a finish later already works, project-wide.** `project_finishes`
  is the project-scoped library and editing one row corrects every item
  carrying that code — `composeFinishCell`'s three callers all render the
  library, which is what makes edit-once-and-propagate true rather than
  intended. The finishes page states the blast radius in words for that reason.
- **Setting the library out from a list exists** (`finish-bulk.ts`, preview
  first: which are new, which the project holds, which repeat in the paste).
- **Typing a finish onto ONE record exists** — `POST /api/attributes`, from the
  record's Specs tab or the infill screen — carrying no source page, honestly.
- **By AREA: nothing at all.** `spec_records.area` is the bill's own fourth
  column, free text, one value per record, and `area-filter.ts` is a pure
  client-side FILTER that narrows what is LISTED and never what is written.
  There is no path anywhere from an area to a finish.
- **From a finishes schedule: deliberately deferred, with a stated price.**
  `finishes_schedule` has been a `document_kind` with its own prompt since 0007,
  and the model's output shape carries `attributeRaw`/`valueRaw` and **no field
  for a finish code** — so pulling codes out of one means parsing them from
  prose. Adding a code to the tool schema is the right eventual answer and
  forces a RE-READ of every document already read (eleven billed calls for the
  Panther pack alone). A decision with a cost, not an oversight.

Four things the build has to answer, none of them answered here:

- **Is a room a variant, or a new axis?** 0024 already models one bill line with
  two finishes: configurations `S-201 A` / `B`, a letter per finish option,
  each exported as its own job. *"Fabric A in the Signature Suites, fabric B
  elsewhere"* is that mechanism with the room as the reason. Making the room a
  new coordinate on `record_attributes` instead gives every composer, the
  export scope and the check sheet one more dimension to be right about.
- **Two things block using configurations as they stand, both already
  recorded.** `ensureVariant` REFUSES to split a record that already holds
  confirmed attributes — and moving existing specs onto a configuration is a
  path that does not exist — and a quantity is never apportioned, which is
  precisely what a room-by-room allocation would want to say.
- **Whose word is the room?** `spec_records.area` is what the BILL wrote; the
  Argenta room-by-room schedule is a different document that may name the same
  rooms differently. Folding two room vocabularies is the `normaliseFinishCode`
  trap at the scale of a whole project, and `area-filter` folds case and
  whitespace only for exactly that reason.
- **The BWS file has one cell per field per record.** COM 1 is one value. A
  record holding two fabrics by room cannot be exported as one row without
  something deciding which one BWS gets — an argument for the variant shape,
  and a question for Matthew and for Tim's new importer rather than for this
  repo alone.

### The same three figures are staged twice — once slotted, once as notes

**Status: open, and a defect.** Max, on the S-203 drawings card (screenshot):
*"Why are the dimensions getting duplicated? They shouldn't be."*

**What is on the screen.** Three yellow rows — `Overall Dimensions 80 cm →
Width`, `70 → Depth`, `90 → Height`, each with the model's evidence, *"first of
three in the printed line 80 x 70 x 90 cm under Overall Dimensions"* — and then,
four rows below, `Dimension 4 = 80 cm`, `Dimension 5 = 70 cm`, `Dimension 6 =
90 cm`, filed as notes, same unit, same page. Six rows for three measurements.

**The cause, read in `stageDrawings` (`src/lib/drawing-document.ts`), and the
comment beside it already states the intent.** Two paths stage the same line:

- The model's own `dimensions` array. On a version 2 read it says which figure
  fills which slot AND what it read that from — and here it read all three off
  the printed combined line, which is what its evidence says.
- The combined line itself. `dimensionsCombinedRaw` is parsed by
  `parseCombinedDimensions` and each part is pushed as its own observation. A
  part the LINE prefixed (`W1520`, `Dia.460`) keeps that slot; a BARE figure
  gets no slot — and is still pushed, as a note.

The second loop's own comment says why the bare part must not claim a slot:
*"the model reports the same figure in `dimensions` with its slot and the
evidence for it, so a reviewer sees one answer with a reason rather than two
answers."* That reasoning is right and only half-applied — the bare part is
stopped from competing for the SLOT and is not stopped from becoming a ROW.

**`dedupeMeasured` cannot catch it, and not because of a bug.** A slotted row
is keyed `slot|figure|unit`; a note is keyed by `measuredKey`, which is
`view|figure|unit` with the view emptied for a positional label. So the pair is
`width|80|cm` against `|80|cm` — two different keys in two different sets. The
two paths never meet. The de-duplicator's own header states the rule this
breaks: *"One measurement stated twice is one measurement."*

**And they cannot fold away either.** The combined line's parts are staged
`isOverall: true` — correctly, it is the overall size — and `foldableRow` reads
`isOverall`, so the three phantom rows sit INLINE beside the four that matter
rather than under the "everything else this page measures" toggle. The fold
exists to keep exactly this kind of row out of the way.

**It reaches the record, not just the card.** Both paths are observations, so a
confirm writes six `record_attributes` rows where the page made three
statements. The composed cell is unaffected — `W800 x D700 x H900mm` is right
in the screenshot, because a note carries no slot — so this is noise and a
false count rather than a wrong measurement.

Two things a fix has to get right rather than assume:

- **A combined line may state a figure the model did not report.** Dropping
  every bare part would lose it. The narrow rule is to drop a bare part whose
  figure and unit already appear among that item's OVERALL rows — which is
  `measuredKey`'s question asked across the two paths instead of within one.
- **Two slots may legitimately share a figure** (`80 x 80 x 90`). Matching on
  figure and unit collapses two bare parts against two slotted rows, one for
  one, which is right — a rule that deduped by figure alone would not.

**Version 1 runs are not affected and must not be changed.** Before the model
was asked which figure was which, the combined line's parts were the only
reading there was; the staged shape is frozen at version 1 for that reason.

### A note is asked whether it is Stated or TBC, and nothing reads the answer

**Status: FIXED 2026-09-23, `1dd57a7`** (plan item 4a.7), on staging. Scoped by
a new exported predicate `asksForState` — the row carries a BWS field or a
dimension slot, which is what "composes into a cell" means — applied to the
`no_state` blocker AND to the state select together, so the two cannot
disagree. Two of `isMergeableNote`'s five clauses and only two; that function
is untouched.

**Found on the way, and it would have been a 500.** The column is `not null
default 'confirmed'`, but the insert in `confirm-drawings.ts` names `state`
POSITIONALLY, so a null reaches Postgres as a literal NULL and violates the
constraint instead of falling to the default — letting unstated rows past the
blocker would have turned Confirm into a 500. `stateToWrite` names the
default in the one place a null can arrive. `empty_value` had to move onto the
same helper, because the database refuses a confirmed value that is blank and
a blocker disagreeing with the insert is a 500 in place of a sentence; an
unasked row with a blank value now gets a sentence it can act on, since it has
no state control to reach for. The original entry follows.

**Status when found: open. A CHANGE ASKED FOR.** Max, on the same card: *"we don't need a
state on the notes, and special manufacturing instructions, and other things
you can think of that probably don't require it."*

**What is on the screen.** The merged general-conditions block — *Overall
Dimensions: REFER TO JACQUES GRANGE DRAWINGS · Supplier: TO BID · Description:
ARMCHAIR STRIKE OFF · Quantity: Argenta to confirm · Required Submittals: …* —
with its state select reading **Choose…**, the red line *"Say whether this is
stated or still TBC."* under it, and the card refusing to confirm until it is
answered.

**The rule already exists one blocker away, for the unit.** `CLAUDE.md`:
*"A note is never ASKED for a unit: nothing blocks a unitless note, so an empty
amber select beside fifteen remarks reads as fifteen unanswered questions where
there are none."* In `drawingItemBlockers`, `unit_missing` (`:1072`) is
scoped to `attrGroup === "dimension"`; `no_state` (`:1058`), fourteen lines
above it in the same loop, has no group test at all. The argument is written down and applied to one of
the two columns.

**It is a review rule, not a schema one.** `record_attributes.state` is
`text not null default 'confirmed'` (0007), so a row nobody ruled has a column
to land in and no migration is involved.

**Why this block is unruled at all, which is the part that makes it bite.**
`mergeNoteBlocks` takes the most cautious state of the lines it joins — one
line nobody ruled leaves the whole block `null`. The merge exists so that
fifteen REMARKS lines are not fifteen states to choose; the blocker turns them
back into one question, about a paragraph of general conditions, and that
question is what stands between the card and its confirm.

**The line to draw is what a row REACHES, not the word "note".** A note-group
row can still carry a BWS `spec_field_id` — `isMergeableNote` excludes exactly
those — and then `renderAttributeValue` puts the TBC marker into the exported
cell, where the state is read and matters. A row with no BWS field and no
dimension slot composes into no cell at all: the export, the check sheet and
`promote-answers` all reach it through one or the other, so its state is asked
for and never read. That predicate — no field, no slot — is the one to scope
the blocker with, and it is already written in `isMergeableNote`.

**What else to look at in the same pass**, since Max asked for "other things
you can think of": every control a row that reaches nothing still offers. The unit
select is not even RENDERED for a text note — `ObservationRows.tsx:507` offers
one to a dimension or a measured row and to nothing else, under a comment
making this exact argument — while the state select is rendered for every row
there is. And `empty_value` — *"a stated value cannot be blank"* — only
fires on `state === "confirmed"`, so it inherits whatever is decided here.

### CORRECTED — "the drawings card's table clears its wrapper by two pixels"

**This entry named a cause as fact and the cause was wrong.** Kept rather than
deleted, per this file's own rule, because the mistake is the useful part: it
is exactly what the preamble warns about, and a reader who saw only the
correction would not know this reading had been in circulation.

**What was actually measured** (while landing Stage 2 item 2.2, `2f09f19`, on
top of `0909fd7`), on the real Panther AP364e `S-301` run, and what is still
true: the observation table is **1003px** against a box of **1005px** at both
1920x1080 and 1440x900, so **3a.4's fix holds and item 2.2's palette control
costs the table nothing** — it adds height, not width.

**What was wrong, in three ways**, each found by the coder who owns that card
and recorded properly in *"Eight of the fourteen observation tables have no
scroll box, so the NEXT wide column clips silently"* (`b3d147d`), which is the
entry to act on:

- The declared wrappers **are `overflow-x-auto`**, not hidden
  (`DrawingItemCard.tsx:403`, `ConfigurationCard.tsx:402`). This entry read
  `table.parentElement` in the DOM and reported whatever that happened to be,
  which is not the declared wrapper.
- **The headroom is 0, not 2px, and headroom is the wrong thing to watch.**
  `table.w-full` sizes itself to its box, so 1003-against-1005 is not slack
  about to run out. The number that matters is the table's own min-content
  width against the box.
- **8 of the 14 tables have no `.overflow-x-auto` ancestor at all.** Their
  effective box is the configuration band (`ConfigurationCard.tsx:789`), which
  is `overflow-hidden` for its rounded corners and coloured border. So the risk
  is real but larger and elsewhere: those eight clip with **no scrollbar**,
  which is worse than what Max reported on 21 Sept, where he could at least
  scroll to the column he could not see.

**The lesson worth keeping:** measuring `getComputedStyle(el.parentElement)` in
a browser answers a question about the DOM you happened to land on, not about
the component. Read the declared class in source, and count how many instances
of the component actually have it.

### A level accepted on one phase's tab is still an unaccepted suggestion on the next, for the same client ref

**Status: FIXED 2026-09-23, `5cc39a9`** (plan item 4a.5), on staging. A category
or a level decided on one tab reaches the same normalised ref on every other
non-ignored sheet, marked **`carried from MUR`** under the cell, and the source
tab says how many other lines it filled in. It arrives as `levelStatus:
"chosen"`, so the confirm writes `spec_records.level` rather than the advisory
column — which is what it is, a person's decision, carried.

**One operation, not N patches**, and the reason is the item's own: a loop of
requests that half-fails leaves the bill saying two things about one item, which
is the state this fixes. The staged path opens no change set — nothing canonical
is written until the confirm — so what stands in for "one press is one change
set" is **one press is one commit**: the row is locked, `planCarry` runs against
the live `parsed`, and the source plus every receiver merge inside one
transaction.

**Two decisions inside it that Max did not settle**, both flagged rather than
buried: **a clear does not carry** — `— not set —` is "I do not know yet", and
pushing that across tabs nobody opened would destroy values with no decision
behind it; and `duplicateGroups`/`isDuplicated` moved into `boq-carry.ts` and
now fold with `normaliseRef` instead of the screen's own looser fold, so `S-201`
and `S.201` on one tab are named as the duplicates `boq-reconcile` has always
read them as. Keeping two folds would have let the amber panel and the carry
disagree about which rows are ambiguous.

**The `carried from` line and the source-tab notice have not been seen by
anybody** — the coder could not sign in to the sandbox from its worktree. The
behaviour is proved through the real route by the db tier. The original entry
follows.

**Status when found: open. A CHANGE ASKED FOR.** Max, on the BOQ review of a multi-tab
bill (two screenshots): *"when I've confirmed the level in the first phase they
don't automatically fill in on the next phase — if they're the same reference
number they should automatically be filled in, and any adjustment to a category
or a level should affect that item no matter where it was."*

**What is on the screen.** Two tabs of one bill. On **MUR** (4 lines) the Level
cell reads a green **Simple** with *Change* beside it — accepted. On **MAIN
RUN** (14 lines) the same cell is the dashed blue **Simple ?** suggestion, with
*12 have a suggested level* and *Accept all 12 ?* above the table. `S-100` is on
BOTH tabs: accepted on one, still asking on the other.

**The two tabs already agree about the guess; what does not carry is the
agreement.** Both print `Simple` with the same reason — *"the bill names no
metalwork and nothing calls it a hero piece"* — because `level-guess` runs per
bill line and both lines say the same thing. So the asked-for change is to carry
a DECISION across tabs, not to make a second inference.

**Nothing in the bill path looks at another sheet, at any stage.** Checked in
the source: every review edit is addressed `(sheetIndex, index)` and patches
exactly that line's JSON at `parsed->'sheets'->i->'lines'->j`
(`PATCH /api/imports/[id]`); `acceptAllLevels(sheetIndex, lines)` is per tab by
name; `confirm-boq.ts` reads each sheet's own lines and `levelDecision` is a
pure function of one staged line. After the confirm it is the same: a phase's
records are their own rows, `PATCH /api/records/[id]` sets one record's category
or level, and `acceptSuggestedLevels` covers one run.

**The app already holds the rule Max is asking for — in the drawings path.**
*One drawing, several runs: the item card is the unit of commit* — a code
matching one record PER RUN is a FAN-OUT and the confirm writes to all of them;
the same code matching TWO records in ONE run is the `SX11A` case and stays
ambiguous. The bill review is the same question (one client ref, several
phases) answered the other way round, and the ambiguity half of it is already
computed on this very screen: `duplicateGroups()` and `isDuplicated()` find a
ref carried by two rows of one tab and name the rows.

Four things a plan has to settle rather than assume:

- **A VE phase may legitimately differ, and a category almost never does.** A
  value-engineered phase quotes the same code at a cheaper build, so *hero on
  MAIN RUN, simple on VE* can be a true statement rather than a missed tick —
  and that is exactly the level that picks the BWS boilerplate the item is
  priced against. A sofa is a sofa on every tab. Whether the fan-out covers
  both fields, or the level only OFFERS on the other tabs where the category
  writes, is Max's call.
- **A ref repeated inside one tab must fan out to nothing.** `SX11A` is on the
  pilot bill twice with different quantities. `findRecordsByRef`'s rule — offer
  the candidates, choose none — is the one that applies, and the screen already
  knows which refs those are.
- **At edit time, not at confirm.** Carrying the decision into the other tabs'
  staged rows makes it visible and overridable before anything is written;
  doing it inside the confirm would write a level onto phases the reviewer
  never opened, which is *never commit a card somebody did not see whole* in a
  new place. The tab that receives it should say where it came from, the way
  every other suggestion on this screen says what it was read from.
- **"No matter where it was" also covers life after the confirm, and that is a
  bigger change.** Changing a category on one phase's record today leaves the
  same ref on the other phases as it was. A category change creates and removes
  that record's checklist answer rows, so fanning one out reaches answers on
  records the person is not looking at — a different item from this one, and it
  should be planned as its own.

The precedent for inheritance already exists one level down: `ensureVariant`
copies a parent's level to a configuration, decision as decision and suggestion
as suggestion, for this reason — *"a split hero item produced level-less
children blocking a chase for a decision taken one row up."*

### Eleven files, eleven empty dropdowns — the upload asks what each document is before it has looked at any of them

**Status: FIXED 2026-09-23, `a1e788a`** (plan item 4a.3), on staging. A pure
leaf `document-name-guess.ts` fills each box the moment files land, flagged,
with the evidence it read; the suggestion is a `SuggestButton`, which also
closes the defect inside this entry — a suggestion could not be AGREED with,
because the select already showed it and picking the same option fires no
change event. The explanatory sentence moved above the rows and the panel's
Tip, which still read *"Each file's kind is declared on upload"*, went with it.

**Measured on the real folder rather than on this entry's list.** The curated
Panther folder holds eleven files and the FF&E preamble this entry counted has
never been in it, so the rule was driven against twelve. All twelve fill, none
abstains: `BOQ` on a spreadsheet, `SHOP DRAWINGS`, `SPEC-346` and `Preamble`
each name one. Abstentions asserted: a bare `Schedule.xlsx`, `BOQ schedule`,
`SPEC-346 - BOQ`, `Example bill.pdf`, and `BOQ` on anything that is not a
spreadsheet. **`FF&E` alone never names a document** — it names the package.

**Two departures from the brief, both right.** A NAME never lets the press skip
the charged call: only a person's choice or a reading of the document does, so
accepting the suggestion is what removes the call, and the sentence counts what
is actually left. And the kind vocabulary moved to its own leaf
(`document-kinds.ts`, re-exported from `document-classify.ts`, the
`record-refs.ts` precedent) because `document-classify.ts` imports the Anthropic
SDK at module top and a client component importing it would ship the SDK to the
browser. Checked here structurally as well as by the build: the client path is
`document-name-guess` → `document-kinds` → `spec-vocab`, and nothing on it
reaches the SDK.

**Outstanding: a monitor-size screenshot for Max, and his acceptance.** The
Browser pane is 560px, so a 1600px emulation scales to illegible. The original
entry follows.

**Status when found: open. A CHANGE ASKED FOR, and one thing inside it is a defect.** Max,
on the intake upload screen of a project (screenshot, the Panther pack of 11):
*"when you upload the document, I want it to read first and try and guess what
the document is and then give you the option to change what it is, instead of
having to manually select what it is first … if we have 300 items, someone
having to go through and do all of that manually is a real pain."*

**What is on the screen.** The drop zone, then eleven rows, each one a filename
beside a select reading **What is this?** with nothing chosen, then *Remove*.
`AP364 - Apx 2 - Panther - BOQ - Seating.xlsx`, seven `SPEC-346-Seating`
sheets, two `SPEC-346-Upholstery` headboards, `AP364 - Apx 1b - Argenta FF&E
Preamble.pdf`. Under them, **Start intake (11)**. No row carries a suggestion,
a colour or a status, because nothing has been uploaded or looked at yet.

**Asked for, and restated as system-wide** — the same rule as the inbox entry
of 2026-09-18 below, which Max also gave as project-wide: *"it's in keeping
with, I've said it before, system-wide: we upload documents, read first,
suggest, and have an option."* In his words, the flow should be — press **Start
intake** once, the files download into the app, they are scanned, **a progress
tracker says what has been scanned and what is still being read**, each one
then **pops up with what it is**, and anything the app is unsure of **comes up
in yellow with a suggested button, one click to switch**.

**Most of that order is already what the press does, and the screen never says
so where it is being read.** Checked in `src/components/projects/IntakeBatchUpload.tsx`:
`start()` uploads each file, calls `/api/imports/classify`, writes the answer
into the select, prints the evidence under the row, registers it and — for a
specification document — starts the charged read. A file the model cannot
settle is held with an empty box and nothing is read for it. The sentence
saying all of this is at the BOTTOM of the component (`:457`), below the Start
intake button, in `text-xs text-neutral-500`. What a person meets first is
eleven required-looking questions above it. **This is the finding**: the
behaviour is right and the screen asks for the work anyway.

Four things behind it that are true in the source, and each is separate:

- **A SUGGESTION ON THIS SCREEN CANNOT BE AGREED WITH.** The select is
  `value={kindOf(item)}` — the person's choice, else the suggestion — and its
  `onChange` is the only thing that sets `choice` (`:385`–`:386`). Picking the
  option the box is already showing fires no change event, so `choice` stays
  empty, so `unchecked` (`:377`) stays true and the row stays amber for ever.
  The only way to clear the flag the screen raises is to choose a DIFFERENT
  kind. **This is the trap `CLAUDE.md` already names for the level picker** —
  *"a select already reading 'No' fires no change event when somebody chooses
  No, so the one action recording their agreement would do nothing"* — in a
  second place, and it is why the asked-for one-click switch is not a
  refinement of what is there.
- **This screen suggests with a nine-option select where the app's own
  primitive is a button.** `SuggestButton` is dashed blue, carries a REQUIRED
  evidence prop and accepts in one click; it is what the drawings card, the
  finishes library and the level panel all use. The upload screen predates none
  of that and uses an amber-bordered `<select>` instead, so the same idea reads
  as two different things in two places.
- **There is no progress tracker on this screen, and the loop is sequential.**
  `for (const item of queue)` (`:178`) uploads, classifies and registers ONE
  file before starting the next, so eleven documents are eleven round trips in
  series with a 24px status word per row (*Looking…*, *Registering…*, *Added*).
  The pack-level line Max is describing does exist — `PackSummary` prints
  *"11 documents · 8 reviewed · 1 still being read · 2 waiting for a slot"* and
  the pack screen polls it every three seconds — but it is on the NEXT screen,
  reached by a redirect (`:302`) that only fires once nothing is held or
  failed. So on the pack where something needs a person, the reading progress
  of the other ten is exactly where nobody looks.
- **The filename is not evidence, and the filenames here say it outright.**
  `/api/imports/classify` takes `filename` only to work out the source type and
  to refuse an `.xls`; `classifyDocument` sends the document bytes and the
  prompt, and the name never reaches the model (`src/lib/document-classify.ts`).
  Max's *"it's clearly in the name what it is"* is a description of this
  screenshot: `- BOQ - Seating.xlsx`, `SPEC-346-Seating - S-100 - Sofa.pdf`,
  `FF&E Preamble.pdf`. The old grey filename hint was removed for a stated
  reason — *"a filename is not the only evidence a document carries"* — which
  is not the same as it being no evidence.

Things a plan has to settle rather than assume:

- **Classifying on drop would spend money before the press that says it spends
  money.** The charge statement lives on Start intake, deliberately (2026-09-15:
  consent moved up to where the volume is visible). A FILENAME rule costs
  nothing and could fill the boxes in the moment the files land; a model call
  could not, without moving that statement. Which of the two Max means by
  "scan on upload" is his call. The precedent for a free answer already exists:
  a `.eml` is answered `charged: false` with no model call at all.
- **Whether a name may DECIDE or only pre-select.** The classify prompt already
  guards the asymmetric case — a bill and an FF&E schedule are both `.xlsx` and
  a wrong bill is a project's worth of wrong records — and a file called
  `… - BOQ - …` whose contents are a schedule is that case wearing a helpful
  name. Pre-selecting is cheap and reversible; deciding is not.
- **A progress tracker is only worth having if the work is concurrent.** Made
  parallel, it meets the pack's own cap — three reads at a time per pack
  (2.10.f) — so the tracker has to be able to say *waiting for a slot*, which
  `packTally` can already count.
- **Where the tracker lives.** Either this screen stops redirecting and grows
  the pack line, or the redirect becomes unconditional and the held files are
  answered on the pack screen. Today it is neither, and a person watching eleven
  documents read is looking at whichever screen the redirect happened to leave
  them on.

### Eight of the fourteen observation tables have no scroll box, so the NEXT wide column clips silently

**Status: FIXED 2026-09-23, `d98857d`** (plan item 4b.2), on staging. An
`overflow-x-auto` wrapper around the per-configuration table inside
`ConfigurationSection` — two functional lines. The band's `overflow-hidden` and
`border-l-4` are untouched (the wrapper is INSIDE it), and the wrapper is not
itself `overflow-hidden`, which would make it the sticky scroll container and
put the header over a row.

**Measured both ways off the same render**, on the real staged Panther-d pack,
by neutralising the new wrappers in the live DOM:

| Viewport | table | box | before | after |
|---|---|---|---|---|
| 1440×900 | 1003–1008px | 1005–1008px | 0 of 14 overflow; **8 land on the hidden band** | 0 overflow, 0 without a scroll box |
| 1920×1080 | 1003–1008px | 1005–1008px | identical | identical |
| 1024×900 | 961–987px | **629px** | **8 clip with no scrollbar** | 13 overflow and **all 13 scroll**, `scrollLeft` reaching its own max |

**The count of eight was right**, counted independently twice — eight wrappers
added, eight tables that had been landing on a hidden box. 3a.4's fix is intact:
nothing clips at either supported width. The entry's 989/629 reads as 987/629
now; the 2px is the palette control, which adds height and not width.

**Left alone deliberately, and recorded as its own concern:** that table is
`w-full text-sm` where the other two are `w-full border-collapse text-cell`.
`text-cell` is 13px against `text-sm`'s 14px, so normalising it would move every
figure above it. It looks like drift rather than a decision — but it is a
separate one. The original entry follows.

**Status when found: open — measured 2026-09-22 on the staging deployment (`2f09f19`),
found immediately after 3a.4 closed, and NOT fixed.** Nothing is clipped
today; this is about what happens the next time that card grows.

Raised by the pilot-readiness session after it rebased its palette control
onto `0909fd7`, in the form "the table is 1003px in a 1005px wrapper, and the
wrapper is `overflow-x: hidden`". Both halves of that turned out to be wrong,
and the thing underneath is worse, so it is written here as measured rather
than as reported.

**What the source says.** Both table wrappers are `overflow-x-auto`, not
hidden — `DrawingItemCard.tsx:403` and `ConfigurationCard.tsx:402`. So the
declared wrapper is right and 3a.4's fix is intact.

**What the DOM says**, at 1440×900 on the real staged Panther-d pack, 14
observation tables:

- **0 of 14 overflow.** 3a.4 holds, including with the palette control added,
  which adds height rather than width.
- **The headroom is not 2px, it is 0** — and that is not fragility, it is
  `table.w-full` sizing itself to its box. A `w-full` table does not overflow
  until its own min-content width exceeds the box, so the figure to watch is
  the content, not the gap.
- **8 of the 14 have NO `.overflow-x-auto` ancestor at all.** Their effective
  x-overflow box is `overflow-hidden` at 1005px — `ConfigurationCard.tsx:789`,
  the configuration band, which is `overflow-hidden` so its rounded corners
  and coloured left border clip cleanly. Only the shared-geometry table inside
  a configuration card gets the auto wrapper; the per-configuration finish
  tables do not.

**And the clipping is real, not hypothetical — one measurement proves it.**
The reading that this entry corrects also took a NARROW pane, and it is the
most useful number either session produced, so it is kept here rather than
lost with the entry it arrived in:

| Viewport | table | box | clipped |
|---|---|---|---|
| 1920×1080 | 1003px | 1005px | no |
| 1440×900 | 1003px | 1005px | no |
| 1024 (narrow pane) | 989px | 629px | **yes** |

1024 is not a supported width and is not the point. The point is that once the
content wins, these tables DO clip — so the eight without a scroll box are not
a theoretical fragility waiting on a hypothetical column, they are the same
card already failing at a width somebody could drag a pane to.

**Why it matters, stated apart from the measurement.** Those eight are one
column — or one long finish description — away from clipping **with no
scrollbar**, which is strictly worse than the state Max reported on
2026-09-21: he could at least scroll to the hidden column and knew something
was there. A silently truncated cell on a card whose whole job is deciding
what a document said is the failure `overflow-x-auto` exists to prevent, and
`docs/design-language.md` permits a wide table only *inside its own overflow-x
box*.

**Not fixed, deliberately.** The band's `overflow-hidden` is load-bearing for
its own rounding, so the fix is an auto wrapper around each of those eight
tables rather than loosening the band — and nothing overflows today, so this
is a trap to close before the next column lands on that card, not a defect on
screen now. Whoever adds a column to `OBSERVATION_COLUMNS` should close it in
the same change.

### Everything open in this file was worked through; here is what closed and what did not

**Status: a pass, not a finding.** `docs/plans/fix-found-in-use-2026-09-22.md`
took every open entry, in four stages, seven Opus coders in worktrees. On
staging at **`3f851b3`**: `npm run lint`, `npm run typecheck`, **1,947 tests
passing with the database tier REQUIRED** (0 failing, 1 skipped) and
`next build`. The four Max raised on 2026-09-21 are verified in a browser at
1440×900 and 1920×1080 and marked FIXED below, each with what was measured.

**Closed by their own entries below:** the three unconditional *quantity not
allocated* screens; `/api/records`' Code column saying what the file will
carry; the uncategorised list naming a heading or a retired phase; the ISO
bill date; the versions diff calling a phase a phase; the record payload's
non-null `state` (now a route-tier assertion); one malformed view region no
longer discarding its siblings; a subtotal row suggested for ignoring;
registration refusing a scanned PDF; a dropped `.msg` refused before the blob;
the attempt past its deadline (an hourly sweeper that NEVER republishes —
there is no exactly-once billing guarantee, so it settles and hands the slot
on, and starting a read stays a person's press); `deferRead` no longer
refreshing its own deadline; *Read all* at one call per document; the
auto-assignment queue count; the `reloadThen` trap in `SpecDocumentReview`;
the misconfigured deployment now failing on the sign-in page rather than at
the first query; the `/image` 404; the configuration card's 409 read as a
notice; the BOQ review's loading state (rendered, not deleted — and the
entry's guess about why the banner survives was wrong, see it); the chase
footer's third bucket; `chase-drafts.test.ts`'s shared-seed mutation; and
`verify-model`'s literal project number.

**THE WORKER-FLAG ADVICE WAS UNFOLLOWABLE, and that is the finding worth
keeping.** `CLAUDE.md` told a second concurrent `checks` to carry
`--maxWorkers=4`. It cannot work in this repo and never could: vitest leaves
`minWorkers` at the CPU count, tinypool throws `options.minThreads and
options.maxThreads must not conflict`, and **zero tests run** behind a
non-zero exit. Anybody who followed it got a green-looking nothing. It is now
`npm run checks:shared` (`VITEST_MAX_FORKS=4`, capped in `vitest.config.ts`
so both ends move together), and both instruction files are corrected.

**Measured and NOT fixed — the honest half of Stage 3d.** The projects list's
`loadOutstanding` went from **27,487 questions / 26.4 MB** to **49 rows /
49 KB** by scoping to what could possibly be waiting (provably equivalent: 14
waiting either way, asserted in `tests/db/projects-list-waiting.test.ts`,
which also holds the trap that the scope keys on the LINE and a coverage row
names a RECORD that may be a configuration). The overview's 6.7 s contacts
tally moved off the critical path, and the overview stopped loading
`loadOutstanding` TWICE — it was fetching `/api/records` only to count
designer codes. **What remains is `loadProjectSummaries` at ~1.6 s**, and it
is NOT the correlated `exists` that looked like the culprit: rewriting it to
precompute per question measured 1584 ms against 1652 ms over five runs each
— noise — so the rewrite was REVERTED rather than carried as unproven risk.
The next person should profile before touching that query. `npm run
measure:screens` is the read-only tool; run it before and after.

**Still open and untouched:** everything in §6 of the plan (Product code,
whether a level is only knowable at the drawing stage, the crop prompt, the
sandbox audit log) — each waits on a named person, not on code. The 120-page
drawing set is still unread for real, and the 300-line overview is faster but
not yet under the two seconds §7.4a asks for.

**Not accepted by anybody.** Human acceptance is outstanding on every screen.

## 2026-09-21

### The tiles are taller than they need to be — EVERYWHERE, not just the overview

**Status: FIXED 2026-09-22, `0b27318` on staging at `3f851b3`.** The `action`
prop and its blue line are gone from `StatTile` and from all 27 call sites;
`py-3` → `py-2`. Measured in the browser: 120px → 90px on the phase strip.
At 1440×900 the phase screen's tiles, search, three filters, table header AND
five data rows are above the fold (thead at y=446 of 900). The filtered state
still reads as filtered without the words — checked filtered and unfiltered at
both sizes — so the `active` ring did not need strengthening. The sub-line
STAYS: it is where the entry below names the population each count is over.
Original entry: **A CHANGE ASKED FOR**, in the same breath as the entry below
and shippable with it or on its own. Max: *"you could just display line items
503 and they can still have the same functionality, but you don't need to
actually have 'filter to these' displayed"*, and then, on the phase screen:
*"the same goes for the height of the boxes here and in general — can they be
shorter."* **It is app-wide, every `StatTile` strip**, not the two screens
these shots happen to show.

The label, the number, the sub-line and a blue *filter to these →* / *see them
all →* / *show only these →* / *open the library →* line make each tile four
rows tall. On the phase screen (`DEMO-300 · MAIN RUN - VE`, screenshot) that
strip is five tiles — TGQ, Waiting on a reply, No category, No level, Ready to
quote — and it pushes the search, the three filters and the table's own header
below the fold on a full-width monitor.

**The link line costs nothing to remove.** `StatTile` renders the whole tile
as a `<Link>` (`StatTile.tsx:87`); the `action` prop is only the blue line at
`:70`. Dropping it loses no behaviour — the tile stays pressable — and the
strip already carries one caption underneath saying *"Pressing a tile opens
the spec table already filtered to it."*

Worth deciding at the same time, since it is the other row: whether the
sub-line stays (*"3 phases"*, *"10841 unlooked · 0 TBC"*, *"2 codes not in the
library"*). The entry below may change what those say anyway — and note that
**the phase screen's strip already carries the item count the entry below
asks for**, as exactly that sub-line: `TGQ 1,875` over *"102 of 118 items"*.
Whichever of the two numbers survives, that tile is the one that already holds
both.

### The overview's tiles count QUESTIONS, and at 503 lines the numbers stop meaning anything

**Status: FIXED 2026-09-22, `4c5b4bf` + `0b27318`, on staging at `3f851b3`.**
On DEMO-300 the overview now reads **TGQ 408 items** (was 8,769 questions),
*Also outstanding* **243**, *Settled* **0**, each sub-line naming the
population (`of 409 items · 8,773 questions`) and a caption saying they do not
add up and why. The Specifications table's TGQ row reads 408 too, the same
unit as the No-category 94 beside it. `tests/db/project-summary.test.ts` is
NEW — this loader's agreement with `loadExportScope` had never been held —
and two of its cases assert the item counts deliberately do NOT sum.
**And the phase strip followed**, which was not in the original ask and had to:
its TGQ tile said 1,879 while every `focus` predicate on that strip selects
RECORDS, so pressing it produced 103 rows. Tile and filter now both say 103.
Original entry: **A CHANGE ASKED FOR**, not a fault — the tiles are counting
what they were built to count. Max, on a 503-line project: *"these numbers are
so high, they're just meaningless."*

Seen on the project overview (screenshot), 503 line items across 3 phases:
**TGQ 8,769**, **Also outstanding 10,841** (`10841 unlooked · 0 TBC`),
**Settled 65**.

**Asked for: TGQ, Also outstanding and Settled should be per LINE ITEM** — how
many items are still held at TGQ — rather than per question.

**It is asked for in TWO places on the same screen.** The SPECIFICATIONS table
below the tiles prints the identical `TGQ 8,769` with *"His matrix for 242
items, the placeholder for 166"* beside it, and Max asked for the same change
there — *"can it be TGQ referencing line items, not individual questions?"*
Both read the same loader, so this is one change in two renderings, not two
findings. Every other row of that table is ALREADY per item (No category 95,
No level 0, Unresolved finish codes 2), which is what makes the one question
count in the middle of them read as a fifth measure.

`project-summary.ts:229-232` counts those three over ANSWER rows
(`count(*) filter (where state in ('missing','tbc') and to_quote)` and its
siblings), while `records` on line 205 counts records. So the strip mixes two
units and only the first tile is in the one a person thinks in.

Two things a plan has to settle, and the second is a trap:

- **A per-item count already exists on the TGQ tile's own sub-line** — *"166
  items still on the placeholder"* — which is a different statement (it is
  which TGQ MODEL applies, not what is outstanding). Whatever the big number
  becomes, those two must not read as the same measure.
- **The three item counts will OVERLAP where the question counts partition.**
  Every answer is exactly one of to-quote / also-outstanding / settled, so
  today the three add up. Items do not: an item can be clear at TGQ and still
  carry other questions, so it belongs to two tiles at once, and "Settled" as
  an item count means *nothing outstanding at all* — a much smaller number
  than 65 answers implies. Three item tiles that no longer sum need to say
  what they each mean, or the strip trades one misleading reading for another.
- **Two different item totals are already on the screen and neither says
  which it is.** The tile reads `LINE ITEMS 503`; the banner under it reads
  *"166 of these 408 items"*. 408 + the 95 with no category = 503, so the
  table appears to be counting the CATEGORISED ones — reasonable, since an
  uncategorised record has no questions, and invisible to a reader. Putting
  item counts in both places without saying which population each is over is
  how somebody subtracts one from the other.

### The checklist's Dimensions box is free text, so two of four dimensions can be marked Confirmed

**Status: FIXED 2026-09-22, `91c9a6f`…`960af4d`, on staging at `3f851b3`.**
Field 3 no longer renders a free-text answer at all. The row is the infill
screen's slot writer, EXTRACTED into `src/components/records/DimensionAnswer.tsx`
so there is one control and not two, writing ATTRIBUTES through
`POST /api/attributes` with the answer following from `promote-answers`. Under
it, the breakdown Max asked for, from `matrixFields` (already on the payload):
on the demo bench, *0 of the 4 this item needs are on record* with
*Width not measured · Depth not measured · Height not measured · Seat height
not measured · Diameter —*, and the sentence *"Recording the cell is not the
same as measuring it: each of these is a separate figure, and the gate reads
the figures."* Where his matrix does not reach the category, five slots are
offered and NONE is required, said in words — `gatesForRecord`'s null rule in
a second place. **The state select went too**, in a second pass: it let
somebody mark the row Confirmed by hand, which wrote `manual` and locked the
cell out of recomposition for good — the same end state by a different
control. The state is now DERIVED and shown (*follows the measurements*),
because the composed cell is a projection of the attributes and so is its
state. Verified in the browser at 1440×900.
Original entry: **The most consequential thing found so far** — it lets an item
reach a quotation with a key dimension nobody has, and nothing downstream
says so. Max, on finding it: *"eventually someone's going to realise, oh
wait, we don't have this key dimension … because someone's said it's
confirmed with only two dimensions out of the four needed."*

Seen on the record screen, Checklist tab (screenshot),
`DEMO-300-102 · Bench, luggage @ entrance`.

The Dimensions row's Answer cell is a plain text box. `W1900 x D1400mm` was
typed into it and its state set to **Confirmed** — no height, no seat height —
and the **TGQ tile reads 0**, *"blocks a price going out"*.

**The same screen contradicts itself two lines apart.** The header above the
tabs already says *"3 to answer at TGQ · 1 you record on this item's details ·
2 counted as separate slots"*, and the tile underneath says 0.

Four things found by reading the code, kept apart from what was seen:

- **The box is disconnected from the slots, and that is the hole.**
  `RecordChecklist.tsx:296` special-cases field 3 for PROVENANCE only — it
  finds the first attribute carrying a `dimension_slot` so the row can show
  where the value came from. The cell itself is the ordinary free-text answer
  control, so what a person types there is a STRING, and no W/D/H/SH exists
  behind it.
- **The infill screen already does it the right way**, which is what makes
  this a gap rather than a design. `rowKind` reads `jsonId === 3` and turns
  the row into slot + figure + unit, writing through `createAttribute` —
  because the composed cell is a projection of the attributes. The record's
  Checklist tab never learned it.
- **The count that reads 0 is the QUESTION count, not the gate's.** There is
  ONE Dimensions question and it is confirmed, so the tile is right about what
  it measures. Matthew's matrix carries FOUR rows at TGQ, one BWS id each with
  a `dimension_slot`, and the Gates tab counts those. This is the
  already-recorded "the table's TGQ column is a DIFFERENT measure from the TGQ
  gate" landing somewhere it does real harm — the person reads 0 and stops.
- **A typed Dimensions answer is written `manual`, which locks the cell for
  good.** `planAnswerFills`' composed-dimensions branch touches an answer only
  while it is `missing` or document-written; `manual` and `email` are
  deliberately out of reach (`promote-answers.ts:298`). So after somebody
  types into that box, **no later drawing or email confirm can ever recompose
  the cell** — the record can hold four real slots off a page and go on
  showing the two somebody typed.

**What Max asked for**, recorded as the request and not as a design: show
Dimensions, and under it a breakdown of the key dimensions this line item
needs, with ALL of them required before it can read as confirmed.

Two things a plan has to settle rather than assume, both already written down
elsewhere:

- **Which slots a given item needs is Matthew's matrix, per category** — rows
  4-7 for seating — and it is null for the eight cabinetry sheets his matrix
  does not reach. "All four, always" would report a missing seat height on a
  bedside table.
- **`composeDimensionCell` stays the single composer**, and 0034's
  `dimension_note` is the one free-text part of that cell. Whatever replaces
  the box must not become a second way to write the cell directly.

### The drawings card's table is cut off, and a column can only be reached by scrolling sideways

**Status: FIXED 2026-09-22, `0909fd7`, on staging at `3f851b3`.** Measured
before choosing: `PageBody` caps at 1400px and the picture sidebar is a fixed
300px track, so the table gets **1010px at 1920 AND at 1440 alike** — the
viewport never mattered, which is why "it's fine on the others" was never
about screen size. 14 of the 16 observation tables overflowed, by 51–86px, and
what fell off was the headingless ACTION column. The UNIT column was folded
into the value (a figure and its unit are one statement, and it held an em
dash on every row that is not a measurement), and the four hand-written
`colSpan={7}`s became `OBSERVATION_COLUMNS` so a column added or removed
cannot leave a spanning panel short. Verified in the browser on the real
staged Panther-d pack: **16 tables, 0 overflowing** at 1440×900, and 14 of 14
at 1920×1080. The "which first one" question never had to be answered — both
readings are covered, because no card clips at either size.
Original entry: Seen on the pack drawings review (screenshot), Ashcombe House
— Shop Drawings Issue B, card `BT-503 Bedside table · page 1`, on a full-width
monitor.

Six columns are readable — Group, Label, Value, Unit, Dimension / BWS field,
State — and the table is **clipped at the card's right edge with a seventh
column past it**, reachable only by scrolling the table sideways. Max: *"I
don't want to have to scroll to view all of the fields on the table."*

**The seventh column has no heading.** `ObservationTableHead` ends with
`<Th className="px-4" />` and every spanning panel is `colSpan={7}`
(`src/components/imports/ObservationRows.tsx:140`), so the thing being hidden
is the per-row action column — which makes it the hardest clipping to notice,
because nothing in the header row goes missing.

Three layout facts, stated as findings rather than as the cause:

- Both cards lay out as `grid … lg:grid-cols-[minmax(0,1fr)_300px]`
  (`DrawingItemCard.tsx:400`, `ConfigurationCard.tsx:352`) — a FIXED 300px
  column for the picture, and the table takes what is left.
- The table sits in `overflow-x-auto`, so it is scrolling **as built**. This
  is not a broken container: `docs/design-language.md` allows a table wider
  than the page inside its own `overflow-x` box, and that permission is what
  is being overridden here.
- Almost every cell holds a `<select>`, and a select does not shrink the way
  text does.

**Which "first one" was meant is not settled.** Max said *"all the rest seem
to be fine … it just seems to be that first one"*, and the screenshot holds
one card. The first CARD on the page and the first ROW of the table are both
readable from that sentence, and they point at different fixes. Ask before
starting. He also said he does not think it is unique to this page.

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

### What the concurrent-run proof did NOT fix

**Status: open — observations from Coder F, 2026-09-21.**
`tests/db/chase-drafts.test.ts` strikes a level off the SEEDED
`requirements.tgq_levels` for one test, so a concurrent run reads `later`
where it expects `to_quote`; no per-run name fixes shared seed — that suite
needs its own category and requirement rows. The COMPONENT tier times out
under machine saturation, not database load: two unbounded runs are sixteen
forks on eight CPUs, and `boq-review-variance`, `spec-table-area`,
`failure-surfaces`, `record-correct` and `configuration-card` failed 5 s
timeouts that pass alone in about 3 s — a worker bound on the second run, or
on the tier. `GET /api/projects` is the slow route that cascades: the
archived-project test's four list calls hit the 30 s bound when another run's
`__QA` projects are on the list, and its in-flight PATCH then lands after
teardown. Registration does not check for a scanned PDF (classify does), so a
hand-declared kind on an image-only PDF still spends the read.
`tests/manual/verify-model.test.ts` still writes a literal `'__QA P99001'`
(not the db tier, gated on `VERIFY_MODEL=1`). `SpecDocumentReview.startExtraction`
sets its error before reloading — the `reloadThen` trap, surviving only
because that state is local to the component.

### Three screens say "quantity not allocated", and two of them say it whatever the data

**Status: open — observations from Coder G's rows d3/d4, 2026-09-21.** The
phase table conditions the words on `qty` being null; the infill line and the
chase line print *quantity not allocated* UNCONDITIONALLY, because
`FinishOptionGroup` carries no `qty`. True today only because nothing had set
one — and the record's details panel CAN set one (0028), so the moment somebody
does, three screens disagree. The fix is to carry `qty` through
`chase-grouping.ts` into both tables. Two more from the same round: `/api/records`'s
`refs` is every ref system while the export's Client Code is `boq_code` only, so
a record carrying only a `bws_job` ref shows a ref on the table and exports a
blank code; and `loadUncategorisedRecords` neither requires the run to be
active nor excludes a split parent, so an uncategorised split bill line would
be listed as an item to categorise when it is a heading.

### After 2.11: what an automatic assignment does not yet do

**Status: open — observations from Coder E, 2026-09-21.** An auto-assigned read
that fails still needs a person to press Retry and nothing but the inbox row
says it happened — with Graph on, that is a queue somebody must watch; a count
on the inbox tiles is the cheap fix. `assignMessage` opens no change set, so an
automatic assignment appears in the audit layer under `system:router` and NOT
in a project's change trail. `tools/qa-demo-project.ts` still carries the
stale "would place on a project" line and writes its review email as
`assignment_kind = 'manual'` though it is addressed to the project's own
inbox. A held row whose candidates span two tiers (subject says A, sender says
B) prints them joined by a comma — honest, terse.

### One malformed view region discards every view region on the page

**Status: open — observation from Coder D's row 2, 2026-09-21.** `viewRegions`
and `codeGroups` parse with `.catch([])` on the whole array, so one malformed
entry throws away its siblings. Survivable — the card proposes no picture and
the item stays whole — but the good entries are recoverable and are not
recovered. The `bareValuesAsList` treatment of the six other arrays (a bad
entry dropped, the rest kept) is the shape to apply.

### A dropped `.msg` still reaches the project's blob prefix before it is refused

**Status: open — observation from Coder D's row 3, 2026-09-21.** The route now
refuses an `.msg` declared as an email before anything is recorded or
dispatched, but `INTAKE_UPLOAD_ACCEPT` is a file-picker filter that drag-drop
bypasses and `UPLOAD_CONTENT_TYPES` admits `application/vnd.ms-outlook` for
evidence, so the bytes are stored under the project before the refusal. No
charge and no run; a stray blob. A client-side check in `IntakeBatchUpload`
alongside the legacy-spreadsheet refusal closes it.

### A 120-page drawing set has never been read for real

**Status: open — measured on paper only, 2026-09-21.** The 600-page cap stops
a file the model would refuse; a 120-page set under the cap may still truncate
(`truncated` says "split it") or run to the 240 s model deadline at high
effort. Handled in words, not measured against the API — measuring costs a
charged call on a synthetic PDF and is a deliberate spend, not a test.

### Two database-tier runs at once collide on hard-coded `__QA` project numbers

**FIXED 2026-09-21, `7d34ac9` + `85e8a8a`** (Coder F): `qaNumber` appends a
per-process suffix and thirty files ask for their number; proved by two full
passes at once, both green. Two things it does not cover are logged below.
Found by Coder C, twice in two full runs, while another coder ran the db tier. Fixtures create
`__QA P90014`-style projects with fixed numbers; the second run to arrive
fails in `beforeAll` on `projects_bws_project_number_key`, then fails AGAIN in
`afterAll` with `invalid input syntax for type uuid: ""` because `projectId`
was never assigned — two messages that read as unrelated defects. Every such
file passes alone. This matters because `npm run checks` is Stage 2's release
gate and two agents at once is the plan's normal state. Cause apart from
observation: a per-run suffix on the fixture's project number (or a
per-process prefix in `db-tier.ts`) removes the collision.

### A subtotal or section row that carries a description becomes a record

**Status: open — pinned as a gap by Coder C's row 6, 2026-09-21.** A code-less
subtotal row is skipped and the review says how many; a section or subtotal
row that carries text in the description column becomes a spec record with
the subtotal's figure as its quantity, and nothing suggests ignoring it. On a
300-line bill the Include box is the only way out. The word list that would
catch it is `non-furniture-guess.ts`'s, whose own header says it is Max and
Matthew's to extend.

### Three single-document review screens say "Not read yet" for a run the cap deferred

**FIXED 2026-09-21, `f91f43c`** (Coder F): the GET payload carries
`waitingForSlot` and the three screens say *Waiting for a slot*, with a 202
press reported as an info notice. Original entry: `DrawingsReview`,
`SpecDocumentReview` and `PreambleReview` call the extract
route and reload; a deferred press correctly shows no error, and then the
page's own chip reads *Not read yet* — the sentence for a document waiting for
a PERSON. `GET /api/imports/[id]` already selects `attempt_deadline_at`, so it
is one computed column plus three chip call sites. The pack screen and the
drawings step are right; the "On its own" link from the drawings step leads
straight to one of the three that are not. Also from the same round: `deferRead`
refreshes the 24-hour deadline on every press, so a document pressed
repeatedly from the pack screen's per-row Read never reaches the resting
state where *Read all* would pick it up (harmless while the button is not
offered for it); and `readAll` still issues two round trips per document,
serially, so thirty documents read "Starting…" for sixty calls.

### *Read all* starts every document at once, past the pack's cap

**FIXED 2026-09-21, `73cf827`** (Coder B round 3): the extract route's
`start` takes a slot or defers with a 202 that says *waiting*; the review's
chip reads *Waiting for a slot*; *Read all* reports the split and excludes
promised reads. Found the same day by Coder B while building the cap. Registration now
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

**Status: FIXED 2026-09-20, `9b626eb`**, the same day it was seen. The
heading, the fix and the observation had drifted into two headings with one
`Status: open` under them, so the entry contradicted itself; merged
2026-09-22, with both halves kept word for word.

`9b626eb`: the next-step action renders only in the *Review complete* state on
both drawings screens, and the BOQ review's confirmed box no longer draws a
disabled Confirm in the primary's fill. The pack screen's duplicated
"Review all 9 drawings together" (header and card) is item 1.6's territory.


**What was seen — the §7.4a screenshots of the `3b6d9db` deployment,
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

**Status: the iCloud half is RESOLVED 2026-09-22 — by moving the checkout,
not by a commit.** It now lives at `~/Documents/SpecBuilderApp`, outside
`Mobile Documents/com~apple~CloudDocs`, so nothing syncs `.next` and no
conflict copy can be written into it; `find . -name "* 2.*"` outside
`node_modules` returns nothing. **The second half of this entry is NOT
resolved**: the `manual-capture` timeout below is the concurrent-run
contention class, which has its own entries and stands. The rule the iCloud
half taught stands too — a check is judged by its own exit code, because this
one failed in a way that read as a regression in the commit under test.
Original status, seen 2026-09-20 on the Stage 1a checks: **open — environment,
not code.** `npm run typecheck` failed with `TS2300 Duplicate identifier` on
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

**Status: FOURTEEN OF THE FIFTEEN CLOSED, 6 still open** — re-checked
2026-09-22 (second pass, at `0bd39d2`) after Max asked for the stale statuses
to be fixed. Item **3 closed** when the two tile entries it pointed at were
fixed earlier the same day, and this header was itself wrong before that: it
read *"2 and 3 still open"* where the table below it said 2 CLOSED and 3 and 6
open. The table is what was checked; the header had the wrong two numbers in
it. First reconciled 2026-09-22 against the tree at `553b8bf`, after Max asked
whether this file was current as of the Stage 2 build. Each was checked in the source rather than
taken from CLAUDE.md's stage lists, and the numbered items below are left
exactly as they were written, because what was SEEN does not change:

| # | Where it stands |
|---|---|
| 1 | CLOSED — `describeHeader` is the single wording for the sheet sentence, and the comment beside it names this defect |
| 2 | CLOSED — `src/lib/non-furniture-guess.ts`, which cites "found-in-use 2" in its own header. A suggestion, never a decision |
| 3 | CLOSED 2026-09-22, by the two tile entries it pointed at — the numbers count line items rather than questions (`4c5b4bf` + `0b27318`) and the boxes lost their link line (`0b27318`), both on staging at `3f851b3`. Checked at the source as well as at the entries: the tile Matthew read aloud is gone, and every tile now on either strip names something to act on — TGQ, Waiting on a reply, No category, No level, Ready to quote on a phase; Line items, TGQ, Also outstanding, Settled, Finishes on the overview |
| 4 | CLOSED — a document's state on the pack screen is a pending count, not a tick for having been opened |
| 5 | CLOSED — one summary line (`n items still to review`) in place of the per-document banner stack |
| 6 | **STILL OPEN** — investigated in Stage 1b and concluded the PROMPT is the fix, which is deferred to the finishes-schedule re-read because it re-reads every document already read. A cost, not an oversight |
| 7 | CLOSED — `splitTbcMarker` in `drawing-document.ts`; the marker is a state, not part of the value |
| 8 | CLOSED — `SwatchPicker` takes `pages`, the union of the item's staged pages and the model's code group, defaulting to the row's own |
| 9 | CLOSED — no BWS ordinal renders in `ObservationRows` |
| 10 | CLOSED — `src/lib/checklist-sections.ts`; the project-wide section folds last and closed |
| 11 | CLOSED — `/dashboard/projects/[id]/infill` is the route from a confirmed intake to answering line by line |
| 12 | CLOSED, and worth reading before ticking: the phase table's gate count is now a `<Link>` to the record's Gates tab, with the outstanding number on the chip. The count OPENS onto the fields; it still does not list them on the phase table itself. If that was the ask, reopen it |
| 13 | CLOSED — each chase count says what it counts, and the header button counts what a chase will ask |
| 14 | CLOSED — `attribute-correct.ts` and `/api/attributes/[id]/correct`, migration 0033 |
| 15 | CLOSED — `defaultSelection` in `chase-selection.ts`, preselecting the TGQ set for the chosen contact |

Found by driving the Panther pack live in front of
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

**Status: the REQUEST is FIXED; the QUESTION behind it is still open.**
Reconciled 2026-09-22. Part 2 below — a way to set the level at the drawings
stage — was built as Stage 1b item 1.15: `LevelControl` renders on the item
card and the configuration card
(`src/components/imports/DrawingItemCard.tsx:42`), writing
`spec_records.level` through the levels route under one `level_set` change set
per click, one write per record of a fan-out. Part 1 — whether a level can
only really be DETERMINED at the drawing stage, and therefore whether guessing
at BOQ intake is worth doing at all — is unchanged and still Max's to check
with Matthew: *"I'm going to check up on this, but I'm pretty sure"*.

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

**FIXED 2026-09-21, `5b2b9f3`** (Stage 2 item 2.11) — Max amended the gate
("yes, amend") and the wording landed in `CLAUDE.md` in the same commit as the
code: the two strongest signals assign automatically under `system:router`;
sender and subject signals are held with the project named. Found on the way:
the Graph path had been auto-assigning on EVERY `assigned` outcome, weakest
signal included. The original entry follows for the reasoning.

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
