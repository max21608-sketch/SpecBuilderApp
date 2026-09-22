# Fix what is found in use — the plan after the walkthrough of 2026-09-22

Every item below traces to an entry in `docs/plans/found-in-use.md` at
`bf85aa9`. Nothing here is adjacent work: an item with no FIU entry behind it
does not belong in it (`make-it-work-2026-09-19.md` §0.1). Seven items were
raised by Max on 2026-09-22 while driving the app screen by screen; the rest
are what the fix pass of the same day left open, each re-checked at the source
rather than taken from a stage list.

**This plans the fixes. It does not re-diagnose them.** Where an entry states a
cause the cause is quoted from it; where it does not, the item says so and the
first step is to measure.

**Read before starting:** the FIU entry itself, `house/conventions.md` §5 (a
suggestion pre-fills only when unambiguous; anything unresolvable is a visible
flag) and §6 (the model reads the page, the app names what it read), and the
load-bearing section of `CLAUDE.md` for whatever the item touches. The cheapest
way to make any of these worse is to fix the screen and leave the invariant.

---

## The plan on one page

Sixteen open findings, in five stages and one holding pen. The order is
**what Max asked for on 2026-09-22**, then **what lets a wrong answer out of
the app**, then **what bites when a real pack or a real mailbox arrives**, then
**speed**, then **noise**.

Leading with what Max asked for is a deliberate departure from the
predecessor's ordering, for the predecessor's own reason: Matthew is using the
app, Stage 2 closed on *stop adding features and make what exists work*, and
six of the seven things Max raised are a screen asking a person to do work the
app already has the facts to do. The one that writes wrong data (4b.1) sits in
the stage below because of what it is, not because of when it was found.

| Stage | What it is | Items | Size |
|---|---|---|---|
| **4a** | The seven Max raised on 2026-09-22 | 7 | L + M + M + M + M + S + S |
| **4b** | Wrong answers found beside them | 2 | M + S |
| **4c** | The mailbox and the meeting screen | 2 | 2×M, one measured first |
| **4d** | 300 lines and up | 2 | L, measure first |
| **4e** | Noise, test infrastructure, housekeeping | 3 | all S |
| **held** | Blocked on a person, and named | 7 | — |

Sizes are **S** (one file, under a day), **M** (a few files plus tests), **L**
(design decided before code, per `make-it-work-2026-09-19.md` §2.4).

**Ship order inside a stage is the order written.** 4a starts with 4a.1,
because the keying decision is the one other work waits on: 4a.2's swatch
control cannot exist until an uncoded fabric has somewhere to live.

---

## 0. What this plan deliberately does NOT contain

The seven person-blocked findings are not items here. Each waits on a named
answer, and building either reading would be worse than waiting — they are in
§6 below, with who owns each.

Nothing here weakens the gate chain, filters an export, moves a count into SQL
that a single implementation already computes, or keys a register on prose
where a code was available. Those are the four ways every item below could be
"closed" while making the app less true.

---

## 1. Stage 4a — the seven Max raised on 2026-09-22

> **CLOSED ON STAGING, 2026-09-23.** All seven landed, each cherry-picked after
> its own checks and re-verified here. The assembled result at `eb89a96`:
> `npm run checks` **exit 0** with the database tier required — lint 0 errors,
> typecheck clean, **2,117 tests passed, 1 skipped**, `next build` green.
> Migration **0036** applied to the sandbox.
>
> | Item | Landed |
> |---|---|
> | 4a.1 finish keying, minted internal codes | `e1d167a` |
> | 4a.2 swatch for any finish that resolves | `d7461d7` |
> | 4a.3 the upload guesses from the name | `a1e788a` |
> | 4a.4 apply-to-all on the by-question tab | `5dbbda6` |
> | 4a.5 a decision carries across phase tabs | `5cc39a9` |
> | 4a.6 the projects list sorts by recency | `44a714d` |
> | 4a.7 a note is asked for a state only where one is read | `1dd57a7` |
>
> **Fixed mid-stage because it blocked the stage:** `db:qa-clean` could not
> sweep an orphaned `__QA` category, and the litter failed `spec-field-gates`
> for three separate coders in three separate worktrees. Its own entry in
> `found-in-use.md` carries the fix and the guard.
>
> **HUMAN ACCEPTANCE IS OUTSTANDING ON ALL SEVEN.** Only 4a.4 was driven in a
> browser by the agent that built it. Nobody has cropped the S-203 chip off a
> real page, seen the `carried from` line, or watched the upload fill its own
> boxes. §8.6 stands: nothing here is accepted by passing.

Each was seen on a real screen with real data, and four decisions inside them
were taken by Max in the planning session on 2026-09-22. Where a decision
overruled a caveat this plan raised, the item says so — the caveat is recorded
so it can be re-read if it bites, not re-argued.

### 4a.1 A fabric with no client code never reaches the finishes library — FIU 2026-09-22 · **L, design first**

**Seen.** On the S-203 record, Specs captured: `Fabric reference` · *Aissa
Dione, ref. Losange raphia beige et écru* · BWS field **COM 1**, sourced to
`SPEC-346-Seating - S-203 - Armchair.pdf`. On the same project's Finishes tab:
*"No finishes yet."* Max: *"there's a finish in the item's specs captured page,
but it doesn't appear in the project finishes. Why is this? It should."*

**Cause, from the entry and confirmed in source.** `resolveFinishCode`
(`finishes.ts:164`) reads `materialCodeRaw` and returns `status: "none"` before
it looks at anything else, so `confirm-drawings.ts` writes the attribute with a
null `finish_id` and creates no library row. `project_finishes` is unique on
`(project_id, code_norm)`; *Aissa Dione* is a supplier and *Losange raphia
beige et écru* a product reference. There is no key to file it under. It is not
a broken link.

**MAX'S DECISION, 2026-09-22:** *"reviewer supplies a code at confirm; if [one
does not] exist create an internal one and then use this again if it matches in
another line item where the same fabric appears."*

**Build.**

1. **Migration: `project_finishes.code_origin`** — `'client' | 'internal'`, not
   null, default `'client'`, with a CHECK. A code the app minted and a code the
   client gave are different facts and the table must be able to say which.
2. **Mint an internal code** when the reviewer says there is none:
   `BW-F-001` upward, allocated per project under the project row lock (the
   `record_no` rule — `variant-create.ts` is the precedent, and the same
   concurrency defect is available to be rediscovered here).
3. **The drawings card asks.** An uncoded finish row gets *"file this as…"*
   with the client's code as a text box and *no code — file it internally* as
   the second answer. Never automatic: `createFinish` is a register write and
   §5's write boundary is a person's submit.
4. **Match a later appearance on the DESCRIPTION, exactly.** Fold case and
   whitespace only — `normaliseFinishCode`'s rule, and for its reason. An exact
   fold links automatically, the way a code match does today; anything less
   offers the candidate and links nothing.
5. **Wire up the link route that already exists.** `setAttributeFinish`
   (`finish-edit.ts:234`) and `POST /api/attributes/[id]/finish` are built,
   version-checked and reason-bearing, and **no screen calls either**. The
   record's Specs tab gets the control, which is also the recovery path for
   everything this item gets wrong.

**Traps, each of which turns this into a worse register if missed:**

- **An internal code must never reach BWS.** `composeFinishCell`
  (`finishes.ts:99`) emits `${code}; ${description…}` — code FIRST — so a
  minted code would ship into the file as though the client had issued it.
  `composeFinishCell` takes the origin and emits the body alone for an internal
  one. A test asserts no exported cell carries a `BW-F-` code.
- **Description matching is the one thing this repo has refused everywhere
  else**, and it is here by decision, not by drift. Keep it EXACT, keep it to
  internal finishes only (a client code is still the key where one exists), and
  never let it merge two descriptions that differ by a character. `CH-01.1` and
  `CH-01-1` stay two finishes; two spellings of a French fabric name are far
  more alike than that.
- **Linking changes what the file says.** `composeFinishCell` renders the
  library wherever an attribute is linked, so the BWS cell, the checklist
  answer and the record screen all move from the page's words to the library's.
  That is edit-once working, and it is why every link in this item is a
  person's act.
- **A conflict still links nothing**, unchanged.

**Design before code (§2.4) — DONE, and APPROVED.**
`docs/design/finish-keying-2026-09-23.html` (`5adaf1e`) shows the card asking
for a code, the row after it is filed internally, the exact-wording match on a
later item with a near miss beside it, the library showing both origins, and
the record's attach control. **Max approved all four of its questions on
2026-09-23 — "yes to all four":**

1. A minted code is **`BW-F-001`** upward, per project, `F` for finish.
2. The second control reads **"No code — file it internally"**, beside a box
   for the client's own code.
3. **An exact wording match links on its own** and says so, with a way out. A
   near miss is offered and files nothing.
4. **An internal code never reaches the BWS export, the quote or the costing
   sheet.** They show the description alone.

None of the four is open. A coder reading this builds what the mock-up shows.

**Tests.** DB: an uncoded finish confirmed with a minted code creates one row
with `code_origin = 'internal'`; the same description on a second item links to
it and creates nothing; a one-character difference links nothing and offers a
candidate; an internal code never appears in `composeRow`'s output. Pure:
`composeFinishCell` for both origins.

**DoD:** on a `__QA` copy of the Panther pack, confirming S-203 files *Aissa
Dione…* into the library under a minted code, the Finishes tab lists it, and
confirming another item carrying the same wording links to the same row rather
than making a second.

### 4a.2 The page prints a swatch and the intake takes no picture of it — FIU 2026-09-22 · **M, after 4a.1**

**Seen.** The S-203 sheet prints the woven chip directly under *Fabric
reference*, and the row has no swatch control at all. Max: *"in the intake, I
still don't think we're taking in a crop of the fabric or metal spec as an
image."*

**Cause, confirmed in source.** `ObservationRows.tsx:561` wraps the whole
`SwatchPicker` in `observation.materialCodeRaw &&`, with the reason written
beside it: a swatch is keyed to `project_finishes`, so a row with no code has
no finish to attach a picture to.

**Build.** Once 4a.1 gives every confirmed finish a code, the gate becomes
*resolves to a finish* rather than *carries a raw code*, and the control is
offered on fabric, timber and metal alike — `classifyCallout` already tells
them apart, so nothing new decides the kind. Keep the confirm-time refusal:
a crop whose row does not resolve fails the confirm rather than being dropped.

**Not in scope, and stated so on the card:** asking the model where the swatch
is. That is a tool-schema change which re-reads and re-pays for every document
already read, it is the same bill as the finishes-schedule code field, and it
rides with that re-read (§6). Until then a swatch is a reviewer's crop, as the
item picture was before it was proposed.

**DoD:** on a `__QA` Panther copy, the S-203 fabric chip is cropped from the
page and appears on the finishes library row created by 4a.1 — the first time
a swatch has been taken off a real page.

### 4a.3 The upload asks what eleven documents are before it has looked at one — FIU 2026-09-22 · **M**

**Seen.** Eleven rows, each a filename beside an unset *What is this?* select,
and `Start intake (11)` below them. Max: *"I want it to read first and try and
guess what the document is and then give you the option to change it, instead
of having to manually select what it is first … if we have 300 items, someone
having to go through and do all of that manually is a real pain."*

**MAX'S DECISION, 2026-09-22:** a **filename rule on drop**; the charged model
call stays behind the press, where the cost statement lives.

**Build.**

1. **`src/lib/document-name-guess.ts`**, a pure leaf: filename → kind +
   evidence, or null. Token matching on what these names actually say —
   `BOQ`, `bill of quantities`, `SPEC-…`, `FF&E`, `preamble`, `.eml`. **It
   abstains wherever two kinds are possible**: a name carrying only *schedule*
   could be FF&E or finishes, and the asymmetry the classify prompt already
   guards (a bill read as a schedule is a project's worth of wrong records)
   applies identically to a name. Pure-tier tested against the real eleven
   filenames and against names that must abstain.
2. **Fill the boxes on drop**, flagged, with the evidence beside each — the
   `level_suggested` shape: the app guesses, shows what it read, a person's
   action files it.
3. **The suggestion becomes a `SuggestButton`**, which also fixes the defect
   inside this entry: the select's value is already the suggestion and its
   `onChange` is the only thing that records a choice, so picking the option
   the box is showing fires nothing and the amber flag can never be cleared by
   agreeing with it. That is the level-picker trap in a second place.
4. **A progress line on the upload screen** — *n stored · n identified · n
   being read · n waiting for you* — and the sentence explaining what the press
   does moves ABOVE the rows, where it is read before the work looks mandatory.

**Traps.** The charge statement must stay true to the new order: a filename
guess costs nothing and the screen says so; the model call still happens at the
press and is still counted there. A person's choice beats both, unchanged. A
file the rule cannot name is held exactly as today — held is not an error.

**DoD:** dropping the eleven Panther files fills ten or eleven boxes before any
press, each saying what it was read from, with nothing uploaded and nothing
charged; one click changes any of them; the press then reads them and the line
above the rows counts them down.

### 4a.4 The by-question tab needs an apply-to-all — FIU 2026-09-22 · **M**

**Seen.** `Access - Select option` · *asked by 4 categories* · **ITEMS 28** ·
**TGQ 28**, opened to 28 rows each carrying the identical prompt and an empty
select. Max: *"we need basically an apply-to-all box … even better a tick box
with an option to select all, but then you can untick some. This screen doesn't
really make sense if they have to go through every single one."*

**MAX'S DECISION, 2026-09-22:** the **UI batch only** — select-all and untick,
applied to the ticked rows. Answering once per PROJECT (step 2 of the parked
`checklist-sections.ts` item, a `scope = 'project'` column) is **not** in this
plan and is not replaced by it: a batch applied to 28 does not stay right when
a 29th item is added, and that remains an open question for Matthew (§6).

**Build.** A tick column on the opened question, a select-all in its header, a
value control above the list, one press.

**The shape to copy is `POST /api/projects/[id]/finishes/kinds`**
(`finishes/kinds/route.ts:50`), not `acceptSuggestedLevels`: it takes
`{id, version}` per row, locks the set in a deterministic order, runs a
plan/skip pass that reports a per-row reason including `version mismatch`,
calls `changeSetForEdit` ONCE, and returns `{ filed, skipped }`.
`acceptSuggestedLevels` has **no version check at all**, deliberately, which is
right for accepting the app's own suggestions and wrong for writing a person's
value over rows they may not have re-read.

**`editAnswer` has no `changeSetId` parameter and needs one.**
`answer-edit.ts:92` hard-codes `changeSetForEdit(…)`, so N answer writes are N
change sets today. Add the parameter exactly as `editFinish` did
(`finish-edit.ts:124`) — that function's doc comment already names this
requirement.

**Traps, each of which turns this into a worse screen if missed:**

- **One press is ONE change set.** `editFinish` filed eleven codes as eleven
  trail entries until `changeSetId` was threaded through it.
- **"All" means what the screen is SHOWING, and says so.** This screen carries
  an area filter, a state filter and a search, and prints `58 of 58 questions
  shown`. *A filter narrows what is LISTED, never what is asked or written* —
  reaching rows the filter is hiding would break that rule in the most
  expensive direction there is. Select-all-then-untick is what makes the set
  visible, which is why Max asked for that shape and not a bare button.
- **Never on a dimension row.** `rowKind` reads `jsonId === 3` and writes an
  ATTRIBUTE, because the Dimensions cell is a projection of the attributes —
  one width applied to 28 items is the case where apply-to-all is certainly
  wrong. The tick column is not offered there, and the row says why.
- **An answer somebody already gave is not silently overwritten.** The control
  may offer to, and has to say how many it would.
- **Each item is written against its OWN category's requirement row.**
  `groupByQuestion` already carries `requirementIds` for the heading; a write
  keyed on the heading's own row would land on the wrong category.
- **`reason_required` fires per row, and a reason opens a NEW change set.**
  `editAnswer` asks for a reason only where an answer is already settled AND
  changing (`answer-edit.ts:85-90`), so in one batch some rows will trip it and
  most will not; and `changeSetForEdit` always opens a fresh change set when a
  reason is supplied (`change-sets.ts:212-218`), so a batch reason must not be
  passed row by row. Simplest honest answer, and the one `finishes/kinds`
  takes: the batch does not touch a settled row — it reports them as skipped
  and names them, and the person changes those deliberately.
- **A row only exists in memory once its heading is opened**
  (`QuestionGroups.tsx` holds `open: Set<string>` and no selection state at
  all), so "all" is ambiguous between loaded, visible and counted before any
  of this is built. Selection state is per loaded row, and the footer says
  which of the three number it is.

**DoD:** on DEMO-300, select-all on *Access*, untick two, apply one value —
26 answers written, one change set, one version per record, the two untouched,
and the footer saying so in words.

### 4a.5 A decision on one phase's tab does not reach the same ref on the next — FIU 2026-09-22 · **M**

**Seen.** Two tabs of one bill. On **MUR** the Level cell is a green **Simple**
with *Change* beside it; on **MAIN RUN** the same cell is the dashed **Simple ?**
suggestion with *Accept all 12*. `S-100` is on both, decided on one.

**MAX'S DECISION, 2026-09-22: both the category and the level carry outright.**
This plan raised the caveat that a VE phase may legitimately be a cheaper build,
so a level carried into it can claim a decision nobody took for it; Max chose
to carry both anyway. The caveat is recorded here to be re-read if it bites,
not re-argued.

**Build.** The carry happens at EDIT time, in the staged JSON, never inside the
confirm — writing into phases the reviewer never opened is *never commit a card
somebody did not see whole* in a new place. On accepting a category or a level,
the same normalised ref (`record-refs.ts`'s `normaliseRef`, the one
`findRecordsByRef` matches on — never `boq-import`'s looser fold) on every
other non-ignored sheet takes the same value, and **the receiving row says it
was carried from `<tab>`**, so the decision is visible where it landed and can
be changed there.

**Traps.** A ref carried by two rows of ONE tab fans out to nothing — `SX11A`,
and the screen already computes exactly that set (`duplicateGroups` /
`isDuplicated`). The carry never overwrites a value a person set on the
receiving tab. It is one change set for the press, as everywhere.

**DoD:** on a `__QA` copy of a three-tab bill, accepting the level and category
on `S-100` in MUR leaves MAIN RUN and MAIN RUN - VE showing the same values
marked as carried, and a ref that appears twice in one tab is untouched.

### 4a.6 The projects list sorts alphabetically, and should sort by most recently worked in — FIU 2026-09-22 · **S**

**Seen.** `AP364c`, `AP364d`, `AP364e`, `DEMO-300`, … — fourteen projects in
BWS-number order. Max: *"we should automatically sort projects by most recent —
most recently worked in, or edited, or added."*

**Build.** Sort key `greatest(max(change_sets.created_at), p.created_at)` as a
`left join lateral` on the list query itself (`projects/route.ts:33-49`),
served by `change_sets_project_idx (project_id, created_at desc)`, which 0012
already creates. The ORDER BY at `:44` becomes status bucket, then the key
descending, then `p.bws_project_number`.

**It has to be in SQL.** `loadProjectSummaries` returns a Map joined back in
memory (`project-summary.ts:161-168`, `route.ts:138`) so it cannot influence
order, and the page's four tabs are pure client-side filters that preserve the
server's array order — there is no client re-sort to change. One consequence:
`state` is DERIVED (`projectState(status, completion)`), so the Completed tab
cannot be bucketed server-side; only the archived bucket can, which is what
the existing first term already does.

**Traps.** `projects.updated_at` is the wrong column and is the one somebody
will reach for: it moves only when the project ROW is written, so it ranks a
rename above a day's work. `p.created_at` is the second term, or a project
added this morning with no change set sorts last — the opposite of the ask.
Active-first survives. `bws_project_number` stays as the final tiebreak, or two
untouched projects shuffle between reloads. **Not asked for and not to be
inferred:** sortable column headers.

**Known and accepted:** work that opens no change set does not move a project —
`assignMessage` opens none by design. Whether mail arriving counts as working
in a project is Max's, and is not decided here.

### 4a.7 A note is asked whether it is Stated or TBC, and nothing reads the answer — FIU 2026-09-22 · **S**

**Seen.** The merged general-conditions block — *Overall Dimensions: REFER TO
JACQUES GRANGE DRAWINGS · Supplier: TO BID · …* — with its state select reading
**Choose…**, the red *"Say whether this is stated or still TBC."* under it, and
the card refusing to confirm. Max: *"we don't need a state on the notes, and
special manufacturing instructions, and other things that probably don't
require it."*

**Cause, confirmed in source.** In `drawingItemBlockers`, `unit_missing`
(`drawing-document.ts:1072`) is scoped to `attrGroup === "dimension"`;
`no_state` (`:1058`), fourteen lines above it in the same loop, has no group
test. The argument is already written down for the unit — *"a note is never
ASKED for one … an empty select beside fifteen of them reads as fifteen
unanswered questions where there are none"* — and applied to one of the two
columns. `record_attributes.state` is `not null default 'confirmed'`, so no
migration is involved.

**Build.** Scope `no_state` to rows that REACH something — a BWS
`spec_field_id` or a `dimension_slot` — and hide the state control on the rows
where the blocker no longer fires.

**Take two clauses from `isMergeableNote` (`:1500-1509`) and NOT the other
three.** `!dimensionSlot` and `!specFieldId` are the ones that mean "this
composes into nothing". `labelRaw === "Note"` is there for merge idempotence
and means nothing here; `unit === null` would exclude exactly the unit-bearing
rows `no_state` should still guard; `attrGroup === "note"` is weaker than the
two that matter. The function is not exported and its comment is about
merging, so lift the two clauses into a named predicate of its own rather than
reusing it.

**Traps.**

- The line is what a row reaches, **not the word "note"**: a note-group row can
  carry a BWS field, and then `renderAttributeValue` puts its TBC marker into
  the exported cell, where the state is read and matters.
- **Scope the control with the blocker.** The `<select>` renders for every row
  there is; narrowing only the blocker leaves a control that can set a state
  nothing ever checks — the unit select is already the precedent, rendered for
  a dimension or a measured row and nothing else.
- `drawingItemBlockers` is re-checked inside the confirm transaction, not only
  on screen, so this lets rows through confirm that are refused today. That is
  the intent; it should be stated in the item's test rather than discovered.
- `empty_value` fires only on `state === "confirmed"` and its reachability
  changes with this.

**DoD:** the S-203 card confirms with its general-conditions block unruled, and
a note carrying a BWS field still asks.

---

## 2. Stage 4b — wrong answers found beside them

### 4b.1 The same three figures are staged twice — FIU 2026-09-22 · **M**

**Seen.** Three yellow rows — `Overall Dimensions 80 cm → Width`, `70 → Depth`,
`90 → Height`, each with the model's evidence *"first of three in the printed
line 80 x 70 x 90 cm under Overall Dimensions"* — and four rows below,
`Dimension 4 = 80 cm`, `Dimension 5 = 70`, `Dimension 6 = 90`, filed as notes,
same unit, same page. Six rows for three measurements, and six
`record_attributes` rows written at confirm. Max: *"why are the dimensions
getting duplicated? They shouldn't be."*

**Cause, confirmed in source, and the intent is already written beside it.**
Two loops in `stageDrawings` (`drawing-document.ts`) stage the same printed
line: the model's `dimensions` array, and `dimensionsCombinedRaw` parsed by
`parseCombinedDimensions`, whose bare parts get no slot and are still pushed as
notes. The second loop's own comment says why the bare part must not compete —
*"the model reports the same figure in `dimensions` with its slot and the
evidence for it, so a reviewer sees one answer with a reason rather than two
answers"* — and it is stopped from claiming the SLOT, not from becoming a ROW.
**Only the BARE parts survive, and that is the whole shape of the fix.** A
combined part that kept a printed prefix (`W1520`, `Dia.460`) carries a slot and
already collapses against its model twin on `dedupeMeasured`'s slot key
(`slot|figure|unit`). A bare part gets no slot, becomes a note, and falls to
`measuredKey` (`view|figure|unit`) with its view blanked — two different sets,
no collision. `mergeNoteBlocks` will not absorb it either: `isMergeableNote`
requires `labelRaw === "Note"`, and these are labelled `Dimension N`.

**Build — in `dedupeMeasured`, not in `stageDrawings`.** The reduction belongs
where the rule already lives: `dedupeMeasured` (`:2190-2209`) runs at READ time
from `upgradeDimensionSlots`, so a pack already staged gains the fix with no
second model call and no re-staging, exactly as `upgradeCalloutGuesses` and
`mergeNoteBlocks` do. Add one pass: drop a SLOTLESS overall row whose figure and
unit already appear on a SLOTTED row of the same item.

**Traps.**

- **Compare figures through `parseDimensionFigure`, never as strings.** The
  combined side deliberately keeps "TBC" inside `value` while the model side
  stores the split figure, so `"80"` and `"80 TBC"` are the same measurement.
- **`isOverall` discriminates nothing on the combined side** — it is hard-coded
  `true` at `:1763`. Do not use it as half the key.
- **A combined line may state a figure the model did not report**, so dropping
  every bare part loses it. Match, do not assume.
- **Two slots may share a figure** (`80 x 80 x 90`): keying on figure AND unit
  collapses two bare parts against two slotted rows one for one, where a rule
  deduping on figure alone would not.
- **Guard on `schemaVersion: 2`.** Version 1 runs are frozen: before the model
  was asked which figure was which, the combined line's parts were the only
  reading there was, and reducing them would delete the only copy.

**Tests.** Pure: the S-203 shape reduces from six rows to three; a bare part
with no slotted twin survives; `80` against `80 TBC` collapses; a version 1
staged run is unchanged.

**DoD:** `npm run measure:drawings` before and after on the staged Panther-d
pack — the diff is the change — and the S-203 card shows three dimension rows,
not six.

### 4b.2 Eight of the fourteen observation tables have no scroll box — FIU 2026-09-22 · **S**

**Measured, not reported.** At 1440×900 on the real staged Panther-d pack,
0 of 14 tables overflow and `0909fd7` holds — but 8 of the 14 have no
`.overflow-x-auto` ancestor at all; their effective box is the configuration
band's `overflow-hidden` at 1005px (`ConfigurationCard.tsx:789`). At a narrow
pane the same card already clips — 989px table in a 629px box — **with no
scrollbar**, which is strictly worse than the state Max reported on 2026-09-21,
where he could at least scroll to the hidden column.

**There are exactly three observation-table renders**, and only one lacks a
wrapper: `DrawingItemCard.tsx:403` and `ConfigurationCard.tsx:402` both have
`overflow-x-auto`; **`ConfigurationCard.tsx:825`, inside `ConfigurationSection`,
has none.** It is rendered once per configuration member, which is where the
eight come from.

**Build.** An `overflow-x-auto` wrapper around that one table. Do NOT loosen the
band at `:789`: its `overflow-hidden` is load-bearing for its rounded corners
and `border-l-4` colour. Do not make the new wrapper `overflow-hidden` either —
it becomes the sticky scroll container and the header then covers a row. Note
that `:825`'s markup is not identical to the other two (no `border-collapse
text-cell`), so this is a copy of the wrapper, not of the table.

**Whoever adds a column to `OBSERVATION_COLUMNS` closes this in the same
change**, whether or not this item has been picked up.

---

## 3. Stage 4c — the mailbox and the meeting screen

Nothing here shows on a demo. Both show the first time a live mailbox is on, or
the first time Matthew is in front of a client with the infill screen.

### 4c.1 An answer typed on the infill screen is refused on the local dev server — FIU 2026-09-20 · **M, measure first**

**Seen.** Three of three on `http://localhost:3000`, zero of one on staging.
Filling a text answer and blurring leaves it unwritten and the row prints
*"Nothing was written — try again"*; two attempts 45 s apart both failed. The
by-question tab's records also failed to arrive within 24 s, local only.

**Cause: NOT established, and the entry says so.** The wording is
`transactionErrorResponse`'s retryable branch — deadlock, `lock_timeout` (5 s)
or `statement_timeout` (15 s) — and **the route does not log which**;
`pg_locks` and `pg_stat_activity` showed no held lock afterwards. A dev server
sharing a laptop with a full test run is the likeliest reading and is unproven.

**Build.** Step one is the log line: name which of the three fired, with the
statement, on the server. Then reproduce on a quiet machine before changing any
lock or timeout. **This is the meeting screen** — it is worth proving before
Matthew is in front of a client with it, and a timeout raised without knowing
which one fired is a guess wearing a number.

### 4c.2 What an automatic assignment still does not do — FIU 2026-09-21 · **M**

Three observations from Coder E, one item. An auto-assigned read that FAILS
needs a person to press Retry and nothing but the inbox row says it happened —
with Graph on, that is a queue somebody must watch, and a count on the inbox
tiles is the cheap fix. `assignMessage` opens no change set, so an automatic
assignment appears under `system:router` in the audit layer and **not in the
project's change trail** — the trail is where "why does this record hold this?"
is answered, and a charged read that started itself belongs in it.
`tools/qa-demo-project.ts` still carries the stale *"would place on a project"*
line and writes its review email as `assignment_kind = 'manual'` though it is
addressed to the project's own inbox (that half is 4e.3).

**Trap.** Opening a change set inside `assignMessage` puts blob I/O and a
change in one transaction — the copy already runs OUTSIDE the transaction for
that reason. Whatever records the assignment must not pull the `.eml` copy back
inside it.

---

## 4. Stage 4d — 300 lines and up

### 4d.1 `loadProjectSummaries` takes about 1.6 seconds — FIU 2026-09-19/20 · **L, measure first**

The 2026-09-22 pass moved the projects list from **27,487 questions / 26.4 MB**
to **49 rows / 49 KB** and took the overview's contacts tally off the critical
path. What remains is `loadProjectSummaries` at ~1.6 s, and **it is not the
correlated `exists` that looks like the culprit**: precomputing per question
measured 1584 ms against 1652 ms over five runs each — noise — so that rewrite
was reverted rather than carried as unproven risk.

**Profile before touching this query.** `npm run measure:screens` is the
read-only tool; run it before and after, on a quiet machine.

### 4d.2 The 300-line overview is not yet under two seconds — FIU 2026-09-20 · **L, same item**

10.4 s measured on DEMO-300, improved by the same pass and still over the two
seconds §7.4a asks for. Same measurement discipline, same tool; it either lands
under two seconds or 4d carries a measured statement of why not and what it
would cost.

---

## 5. Stage 4e — noise, test infrastructure, housekeeping

| # | Finding | FIU date | Fix |
|---|---|---|---|
| 4e.1 | One component test sits at 3 s against a 5 s default, and five more fail 5 s timeouts under machine saturation | 2026-09-20 | raise the bound for the named files, or split them. `npm run checks:shared` already caps the fork pool and is the answer for two concurrent suites |
| 4e.2 | `tools/qa-demo-project.ts` carries a stale "would place on a project" line and writes its review email as `assignment_kind = 'manual'` though it is addressed to the project inbox | 2026-09-21 | correct both; the demo is what people are shown, so a stale sentence there is a wrong answer with an audience |
| 4e.3 | A second demo project collides on `email_messages (mailbox, graph_message_id)` — fixed for `--lines`, open for any future second demo | 2026-09-20 | derive the mailbox and the message ids from the project ref |

**One finding that is in the FIU file and is NOT an item, because it is already
fixed.** `tests/db/chase-drafts.test.ts` mutating the SEEDED
`requirements.tgq_levels` closed in `e0a171e` — the suite now creates its own
category and its own three requirements in `beforeAll` and drops the category in
teardown, so `:573` strikes a level off a row it owns. The FIU entry *"What the
concurrent-run proof did NOT fix"* still lists it and should be marked FIXED
with that commit in the same pass as anything else here.

What remains in that suite is a read-only DEPENDENCY on the seed, not a
mutation: the level-less-record test picks a real category out of
`spec_matrix_category_map` because its whole point is that Matthew's matrix
covers it. A fabricated category cannot be in his matrix, so this one does not
want fixing.

---

## 6. Waiting on a person — not items, and named

| Finding | Waiting on | What must not happen |
|---|---|---|
| **There is nowhere to record Product code** (FIU 2026-09-18) | **Matthew** | Do not build either reading. His matrix says *"derived automatically: if MF1 or MF2 is populated"*; Max's reading is the client's BOQ code. **Do not weaken the gate chain to get the ticks back** |
| **Whether a level can only be determined at the drawing stage** (FIU 2026-09-18) | **Max**, to check with Matthew | The level GUESS rules are still this repo's judgement and Matthew has not seen them — same sitting, same person, alongside TGQ |
| **The item picture crop failed on a real page** (FIU 2026-09-18 item 6 — the only one of the fifteen still open) | nobody — **deferred with a cost** | The PROMPT is the fix and it re-reads every document already read. It rides with the finishes-schedule re-read, and 4a.2's swatch regions ride with the same one |
| **The sandbox database is full — `audit_log` is why** (FIU 2026-09-19) | **Max**, a decision not a code fix | Purging QA audit rows is the one thing `house/conventions.md` §12 says never to do; it needs his explicit yes in writing, a backup first, and a dated line in the FIU file. A Neon branch per db-tier run is the durable fix and the only one that keeps §12 intact |
| **Finishes by room** (FIU 2026-09-22) | **Max and Matthew** | Not a defect — the S-203 sheet leaves Material/Finish blank and says *"refer to Argenta room by room schedule"*, and the empty TBC row is the honest reading. A larger build: is a room a configuration (0024 already models one bill line with two finishes) or a new axis on `record_attributes`? And the BWS file has one cell per field per record |
| **Answering a project-wide question once per project** (FIU 2026-09-22, inside 4a.4) | **Matthew** | `checklist-sections.ts` parked step 2 pending somebody asking again. Max asked for the batch instead; the batch does not stay right when a 29th item is added, and a `scope = 'project'` column is a data-model change nobody has agreed |
| **A 120-page drawing set has never been read for real**, the pack cap has never met the real queue, and the staged S-100 reads the sofa as 2 configurations | a real pack, and **a person against the pages** | None of these is a code change. The configuration reading is a person comparing the two pages; if it is wrong there it is wrong on the source project too |

---

## 7. How this is run

Same discipline as Stages 1, 2 and 3, which worked:

- **Opus coders in worktrees OUTSIDE iCloud** (`~/dev/worktrees`), removed when
  the coder is done. The checkout itself moved out of iCloud on 2026-09-22; a
  worktree written back into it is how that returns.
- **One brief per item**, quoting the FIU entry rather than summarising it.
- **`npm run checks` with the database tier REQUIRED before each cherry-pick**,
  and a second concurrent run uses **`npm run checks:shared`** — never
  `--maxWorkers=4`, which runs ZERO tests behind a non-zero exit.
- **`CLAUDE.md` / `AGENTS.md` belong to exactly one agent**, and `cmp -s` runs
  before any completion is reported.
- **Every item's FIU entry is marked FIXED with its date and commit** when it
  lands. Never deleted — an entry closed on somebody else's stage list is the
  "fixed on paper" state the file exists to prevent, and two such entries were
  found on 2026-09-22.

**4a.1 needs a design pass first** and 4a.2 waits on it; the rest of 4a can run
in parallel. 4b and 4e can run alongside. 4c.1 and all of 4d wait for a quiet
machine, because both are measurements.

---

## 8. Definition of done for the whole plan

1. Every item is either FIXED with a date and a commit in `found-in-use.md`, or
   moved to §6 with the person named.
2. `npm run checks` green with the database tier required.
3. The first-session script (`.claude/skills/verify/files/first-session.mjs`)
   runs against the deployment with no new skips.
4. `npm run measure:drawings` and `npm run measure:screens` each run before and
   after the item that touches what they measure, and the diff is quoted in the
   README entry.
5. The 300-line overview under two seconds, or 4d carries a measured statement
   of why not and what it would cost.
6. **Human acceptance stays outstanding until Max has driven 4a on a real
   screen.** Nothing in this plan is accepted by passing.
