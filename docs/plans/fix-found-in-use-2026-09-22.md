# Fix what is found in use — the plan after the reconcile of 2026-09-22

Every item here traces to an entry in `docs/plans/found-in-use.md`, at the tree
`4f00b43`, where that file was reconciled against the SOURCE rather than
against the stage lists. Nothing in this plan is adjacent work: an item with no
FIU entry behind it does not belong in it, and the plan-drift rule of
`make-it-work-2026-09-19.md` §0.1 applies unchanged.

**This plans the fixes. It does not re-diagnose them.** Where an entry already
states a cause apart from what was seen, that cause is quoted and not
re-derived; where it does not, the item says so and the first step is to
measure.

**Read before starting:** the entry itself, `house/conventions.md`, and — for
every item touching a composed cell, a gate, an export or a chase — the
load-bearing section of `CLAUDE.md` the item names. The cheapest way to make
any of these worse is to fix the screen and leave the invariant.

---

## The plan on one page

Twenty-eight open findings, in four stages and one holding pen. The order is
**what lets a wrong answer out of the app**, then **what Max saw and asked
for**, then **what will bite when a real pack or a real mailbox arrives**,
then **noise**. Stage 3a mixes the first two, because the single most
consequential finding in the file is also one of the four Max raised.

| Stage | What it is | Items | Size |
|---|---|---|---|
| **3a** | The four Max raised on 2026-09-21, screenshot-backed | 4 | L + M + S + M |
| **3b** | The other confidently-wrong answers | 7 | 1×M, 6×S |
| **3c** | The queue, the reads and the mailbox | 6 | 2×M, 4×S |
| **3d** | 300 lines and up | 2 | L, measured first |
| **3e** | Noise, test infrastructure, housekeeping | 9 | all S |
| **held** | Blocked on a person, and named | 5 | — |

Sizes are **S** (one file, under a day), **M** (a few files plus tests), **L**
(design decided before code, per §2.4 of the stabilisation plan).

**Ship order inside a stage is the order written.** 3a.1 is the one to start,
and it is the one that needs a design sign-off first.

---

## 0. What this plan deliberately does NOT contain

Five findings are in the file and are **not** items here, because each waits on
a person and building either reading would be worse than waiting. They are
listed at the end under *Waiting on a person*, with who owns each.

Nothing here weakens the gate chain, filters an export, or moves a count into
SQL that a single implementation already computes. Those are the three ways
every item below could be "closed" while making the app less true.

---

## 1. Stage 3a — the four Max raised

All four are dated 2026-09-21, all four have a screenshot behind them, and
three of them are on screens he will put in front of Matthew.

### 3a.1 The checklist's Dimensions box is free text — FIU 2026-09-21 · **L, design first**

**The most consequential finding in the file**, and the reason this stage is
first. It lets an item reach a quotation with a key dimension nobody has.

**Seen:** record screen, Checklist tab, `DEMO-300-102 · Bench, luggage @
entrance`. `W1900 x D1400mm` typed into the Dimensions Answer cell and its
state set to **Confirmed** — no height, no seat height — and the TGQ tile
reads **0**, *"blocks a price going out"*. The header two lines above says
*"3 to answer at TGQ · 1 you record on this item's details · 2 counted as
separate slots"*. The screen contradicts itself.

**Max asked for**, recorded as the request and not as the design: show
Dimensions, and under it a breakdown of the key dimensions this line item
needs, with ALL of them required before it can read as confirmed.

**Cause, from the entry and confirmed in source.** `RecordChecklist.tsx:296`
special-cases `json_id === 3` for PROVENANCE only — it finds the first
attribute carrying a `dimension_slot` so the row can show where a value came
from. The CELL is the ordinary free-text answer control, so what a person
types is a string and no W/D/H/SH exists behind it. `promote-answers.ts:298`
then makes it permanent: a typed answer is written `manual`, and the composed-
dimensions branch touches an answer only while it is `missing` or
document-written, so **no later drawing or email confirm can ever recompose
that cell**.

**Build.** The infill screen already does this correctly and is the shape to
reuse, not to reinvent: `infill.ts:151` `rowKind` reads `jsonId === 3` and
returns `"dimension"`, and the row becomes slot + figure + unit written
through `POST /api/attributes`, with the answer following from
`applyAnswerFills`. Three parts:

1. **Extract the dimension control** out of `InfillRow.tsx` into a component
   both screens render. Two tables sharing one control is acceptable; two
   controls writing one cell is the `composeDimensionCell` trap in a new
   place.
2. **The Checklist tab's Dimensions row renders it**, and stops offering a
   free-text answer box for field 3 entirely. Nothing else about the row
   changes — the provenance line, the gates chips and the state select stay.
3. **The row lists the slots this item needs, and how many are on record.**
   `matrixFields` is ALREADY on the record payload
   (`api/records/[id]/route.ts:312`) and each row carries `dimensionSlot`
   (`gate-load.ts:90`), so the required set needs no new loader.

**Traps, each of which turns this into a worse screen if missed:**

- **Which slots an item needs is Matthew's matrix, per category** — rows 4–7
  for seating — and it is **null** for the eight cabinetry sheets his matrix
  does not reach. "All four, always" reports a missing seat height on a
  bedside table. Where `matrixFields` is null the row shows the five slots,
  requires NONE, and says so in words. That is `gatesForRecord` returning null
  rather than an empty set, in a second place.
- **`composeDimensionCell` stays the single composer**, and 0034's
  `dimension_note` stays the one free-text part of that cell. Whatever
  replaces the box must not become a second way to write the cell.
- **Do not rewrite the answers that are already typed.** A `manual` Dimensions
  answer with no attributes behind it is a person's own statement; silently
  replacing it is exactly what this app does not do. The row NAMES it —
  *"typed, with no measurements behind it"* — and offers the slot control
  beside it. A person's click supersedes it; nothing else does.
- **The state follows the slots and is not a fourth state model.**
  `planAnswerFills` already writes the composed answer as the weaker of its
  attributes, so once the free-text path is gone the hole closes with no new
  rule. Do not add a "block the Confirm select" branch instead — that leaves
  the bypass in place and guards it.
- **The `0` is the QUESTION count and it is right about what it measures.**
  There is one Dimensions question. Matthew's matrix carries four rows at TGQ.
  This is the already-recorded "the table's TGQ column is a DIFFERENT measure
  from the TGQ gate", landing where it does real harm. The fix is the row
  showing its slots, **not** re-pointing the tile at the gate — that is a
  separate decision (3a.2's territory) and doing both in one item hides which
  one worked.

**Design before code (§2.4).** One screenshot of the Dimensions row in three
states — a seating item with two of four slots, a seating item complete, a
cabinetry item with no matrix — put to Max before anything is written.

**Tests.** Component: the row renders five slots; a mapped category marks the
required ones; an unmapped category marks none and says why; a typed answer
with no attributes is named and not overwritten. Pure: unchanged
`composeDimensionCell`. DB: typing two slots leaves the answer `missing` at
the gate, and a later drawing confirm still recomposes the cell.

**DoD:** on `DEMO-300-102`, entering W and D leaves the record visibly short of
H and SH, the Gates tab and the Checklist row agree, and confirming a drawing
afterwards recomposes the cell rather than being locked out.

### 3a.2 The tiles count questions where they should count line items — FIU 2026-09-21 · **M**

**Seen:** project overview, 503 line items over 3 phases. **TGQ 8,769**,
**Also outstanding 10,841**, **Settled 65**. Max: *"these numbers are so high,
they're just meaningless."* Asked for in TWO renderings of one loader — the
tiles, and the SPECIFICATIONS table below them printing the identical
`TGQ 8,769` (*"can it be TGQ referencing line items, not individual
questions?"*).

**Build.** `project-summary.ts:229-232` counts the three over ANSWER rows;
line 205's `rec` CTE already counts records. Add three `count(distinct
record_id)` columns to the `ans` CTE beside the existing ones — not instead of
them, so the sub-line can still carry the question count where it helps — and
render the item count as the tile's number in both places.

**Traps:**

- **The three item counts OVERLAP where the question counts partition.**
  Every answer is exactly one of to-quote / also-outstanding / settled, so
  today the three add up; items do not. An item can be clear at TGQ and still
  carry other questions. "Settled" as an item count means *nothing outstanding
  at all* — a far smaller number than 65 answers implies. Three tiles that no
  longer sum must each say what they are over, or the strip trades one
  misleading reading for another.
- **A per-item count is already on the TGQ tile's sub-line** — *"166 items
  still on the placeholder"* — and it is a DIFFERENT statement (which TGQ
  model applies, not what is outstanding). The two must not read as one
  measure.
- **Two item populations are already on the screen and neither says which.**
  The tile reads `LINE ITEMS 503`; the banner reads *"166 of these 408
  items"*, and 408 + 95 uncategorised = 503. Putting item counts in both
  places without naming the population each is over is how somebody subtracts
  one from the other.
- **`loadProjectSummary` is not `loadProjectCompletion`,** and both duplicate
  `loadExportScope`'s predicate because the driver cannot share a SQL
  fragment. `tests/db/project-summary.test.ts` is where the new columns have
  to be held against the scope, not assumed into it.

**Tests.** DB: the three item counts over a fixture where one record is clear
at TGQ and outstanding elsewhere — asserting they deliberately do NOT sum.

**DoD:** DEMO-300's overview reads in items, each tile says what population it
is over, and the Specifications table's TGQ row agrees with the tile.

### 3a.3 The tiles are taller than they need to be — app-wide — FIU 2026-09-21 · **S**

**Seen:** the overview and the phase screen (`DEMO-300 · MAIN RUN - VE`).
Max: *"you could just display line items 503 … you don't need to actually have
'filter to these' displayed"*, and *"the same goes for the height of the boxes
here and in general — can they be shorter."* **It is every `StatTile` strip**,
not the two screens the shots happen to show. On the phase screen the five
tiles push the search, three filters and the table header below the fold.

**Build.** `StatTile.tsx:70` is the whole of it: the blue *action* line renders
only when the tile is pressable, and dropping it loses no behaviour — the tile
is a `<Link>` or a `<button>` for its whole area (`:87`). Thirty call sites
across eight files pass `action`; remove the prop and the call sites with it,
rather than leaving a prop nothing renders.

**Trap, and the reason this is not a one-line delete.** On the drafts screen
and the phase table the tiles are `onPress` FILTERS on the same page, and the
action word is what distinguishes *"showing these"* from *"show these"* — the
active state in words. The `active` prop's ring carries it visually; check at
1920×1080 AND 1440×900 that a filtered strip still reads as filtered before
the words go. If it does not, the fix is a stronger active state, not keeping
the line.

Decide at the same time — it is the other tall row — **whether the sub-line
stays**. Note that the phase strip's sub-line ALREADY holds the item count
3a.2 asks for (`TGQ 1,875` over *"102 of 118 items"*), so 3a.2 should land
first or the two items will fight over the same row.

**DoD:** screenshots of the overview and the phase screen at both sizes, the
table header above the fold on the phase screen, and `/dashboard/design`
re-rendered.

### 3a.4 The drawings card's table is clipped — FIU 2026-09-21 · **M**

**Seen:** pack drawings review, Ashcombe House — Shop Drawings Issue B, card
`BT-503 Bedside table · page 1`, full-width monitor. Six columns readable, the
table clipped at the card's right edge with a seventh past it. Max: *"I don't
want to have to scroll to view all of the fields on the table."*

**The seventh column has no heading** — `ObservationTableHead` ends with
`<Th className="px-4" />` and every spanning panel is `colSpan={7}`
(`ObservationRows.tsx:173`, `:506`, `:565`) — so what is hidden is the per-row
ACTION column, and nothing in the header goes missing to signal it.

**ASK MAX BEFORE STARTING.** The entry says so: *"all the rest seem to be fine
… it just seems to be that first one"* reads as the first CARD on the page or
the first ROW of the table, and they point at different fixes. He also said he
does not think it is unique to this page.

**Build, once that is answered.** Three layout facts, stated as findings and
not as the cause: both cards are `lg:grid-cols-[minmax(0,1fr)_300px]`
(`DrawingItemCard.tsx:400`, `ConfigurationCard.tsx:352`) with a FIXED 300px
picture column; the table sits in `overflow-x-auto`, so it is scrolling as
built and `docs/design-language.md` permits that; and almost every cell holds
a `<select>`, which does not shrink the way text does. The candidates, in the
order of least damage: give the action column a heading so the clipping is
visible at all; let the picture column shrink below 300px at the widths where
the table overflows; fold Group or Unit into another cell. **Whichever is
chosen, the spanning panels stay their own `<tr>` and the wrapper stays free
of `overflow-hidden`** — both are recorded traps that re-break the card
silently.

**DoD:** the card at 1920×1080 and 1440×900 with every column reachable
without a sideways scroll, on a real staged run, not a fixture.

---

## 2. Stage 3b — the other confidently-wrong answers

Each of these produces a plausible answer that is wrong, which is the failure
class this app exists to prevent. None was raised by Max; all were found by
coders driving the app.

### 3b.1 Three screens say "quantity not allocated" whatever the data — FIU 2026-09-21 (Coder G d3/d4) · **M**

The phase table conditions the words on `qty` being null; the infill line
(`InfillTable.tsx:444`) and the chase line (`ChaseQuestionTable.tsx:835`)
print them UNCONDITIONALLY, because `FinishOptionGroup` carries no `qty`.
True today only because nothing had set one — and `PATCH /api/records/[id]`'s
`details` HAS accepted `qty` on a configuration since 0028, so the moment
somebody sets one, three screens disagree. Carry `qty` through
`chase-grouping.ts` into both tables.

Two more from the same round, same size, same file family:

- **`/api/records`'s `refs` is every ref system while the export's Client Code
  is `boq_code` only**, so a record carrying only a `bws_job` ref shows a ref
  on the table and exports a blank code.
- **`loadUncategorisedRecords` (`chase-drafts.ts:830`) neither requires the
  run to be active nor excludes a split parent**, so an uncategorised split
  bill line is listed as an item to categorise when it is a heading.

### 3b.2 One malformed view region discards every view region on the page — FIU 2026-09-21 (Coder D row 2) · **S**

`viewRegions` (`extraction-schema.ts:835`) and `codeGroups` (`:855`) parse
with `.catch([])` on the WHOLE array, so one malformed entry throws away its
siblings. Survivable — the card proposes no picture and the item stays whole —
but the good entries are recoverable and are not recovered. **The shape is
already in the file**: `bareValuesAsList` drops a bad entry and keeps the rest,
and six other arrays now go through it. Apply it to these two. Do not widen it
to `items` or to an absent required array, which stay terminal, each saying
why.

### 3b.3 A subtotal row that carries a description becomes a record — FIU 2026-09-21 (Coder C row 6) · **S**

A code-less subtotal row is skipped and the review says how many; a section or
subtotal row carrying text in the description column becomes a spec record
with the subtotal's figure as its quantity, and nothing suggests ignoring it.
On a 300-line bill the Include box is the only way out. The word list that
catches it is `non-furniture-guess.ts`'s — **a suggestion, never a decision**,
and its own header says the list is Max and Matthew's to extend. So this item
is: extend the list with subtotal/section wording, and nothing else. It must
not start deciding.

### 3b.4 A bill's date prints as an ISO timestamp — FIU 2026-09-20 · **S**

The Panther bill's Revision reads `0 · 2026-09-15T00:00:00.000Z` on the BOQ
review and in the phase subtitle; a person reading the workbook sees
`15/09/2026`. `readMetadata` in `boq-import.ts:215,221` takes a Date-typed
cell's `toISOString()`. Format a Date-typed cell as the sheet displayed it (or
`YYYY-MM-DD`) **at parse time, still as text**. The rule that the value stays
text is right and is not what is wrong — the TOE-dates trap stands.

### 3b.5 The versions diff labels a phase "Run" — FIU 2026-09-20 · **S**

`CORE_FIELDS` in `snapshot-diff.ts:192` labels `runName` as `Run`, so a record
moved between phases shows a diff line headed "Run". One word. The vocabulary
guard reads screen sources, not `src/lib`, which is why item 1.1 missed it —
worth deciding in the same breath whether the guard's allowlist should reach
`src/lib` strings that render.

### 3b.6 The record payload's `state` is typed non-null and only a coalesce makes it true — FIU 2026-09-20 · **S**

Left open by the crash fixed in `be8539d`. `GET /api/records/[id]` coalesces
to `missing`; the type says non-null with nothing holding it. A route-tier
assertion closes it. Cheap, and it is the guard on a defect that took the
record screen white.

### 3b.7 Registration does not refuse a scanned PDF — FIU 2026-09-21 (Coder F) · **S**

`pdfHasTextLayer` and `scannedPdfRefusal` exist and the classify route checks
before the model (`91360b6`), but **registration does not**, so a
hand-declared kind on an image-only PDF still spends the read. Same check, one
more call site, with the same certain-or-null rule — a filter chain it cannot
decode must still proceed.

Related and one line: **a dropped `.msg` still reaches the project's blob
prefix before it is refused** (FIU 2026-09-21, Coder D row 3).
`INTAKE_UPLOAD_ACCEPT` is a file-picker filter drag-drop bypasses. A
client-side check in `IntakeBatchUpload`, beside the legacy-spreadsheet
refusal, closes it. No charge and no run today — a stray blob.

---

## 3. Stage 3c — the queue, the reads and the mailbox

Nothing here is visible on a demo. All of it is visible the first time a real
thirty-document pack or a live mailbox arrives, which is the point of the
stage.

### 3c.1 An attempt that passes its 24-hour deadline is settled by nothing — FIU 2026-09-21 · **M**

Pre-existing, made visible by the cap. An attempt whose `attempt_deadline_at`
passes stays `queued` with no worker coming; the screens offer *Restart*. The
cap steps around it — an expired attempt stops counting — but **nothing hands
its slot on at the moment of expiry**, so a pack whose three in-flight
attempts all expire sits still until somebody presses *Read all*. The fix is a
sweeper or a settle-on-expiry path, and **it belongs with the queue, not with
a screen**. It goes through the same `openAttempt` + `publishAttempt` protocol
— commit then publish — as every other hand-off, and it must not escalate a
lost claim into a terminal failure.

### 3c.2 `deferRead` refreshes the deadline on every press — FIU 2026-09-21 (Coder F) · **S**

So a document pressed repeatedly from the pack screen's per-row Read never
reaches the resting state where *Read all* would pick it up. Harmless while
the button is not offered for it, and it is the kind of harmless that stops
being harmless the moment 3c.1 lands.

### 3c.3 `readAll` issues two round trips per document, serially — FIU 2026-09-21 · **S**

Thirty documents read "Starting…" for sixty calls. Not a correctness fault;
it is the screen a person watches while a pack goes in.

### 3c.4 An automatic assignment leaves no trail and no queue — FIU 2026-09-21 (Coder E) · **M**

Three observations after 2.11, one item:

- **An auto-assigned read that fails still needs a person to press Retry**, and
  nothing but the inbox row says it happened. With Graph on, that is a queue
  somebody must watch. **A count on the inbox tiles is the cheap fix** and is
  what this item builds.
- **`assignMessage` opens no change set**, so an automatic assignment appears
  in the audit layer under `system:router` and NOT in a project's change
  trail. Decide deliberately: the gate says assignment starts a charged read,
  and a charged read a person did not ask for is exactly the thing a trail
  should carry. If it stays out, say why in `CLAUDE.md` beside the gate.
- **`tools/qa-demo-project.ts` carries a stale "would place on a project"
  line** and writes its review email as `assignment_kind = 'manual'` though it
  is addressed to the project's own inbox.

### 3c.5 `SpecDocumentReview.startExtraction` reports before it reloads — FIU 2026-09-21 · **S**

The `reloadThen` trap, surviving only because that state is local to the
component. Two of its siblings were already fixed in the 2.10.g sweep; this is
the third and it was found after.

### 3c.6 A misconfigured deployment dies at the first query — FIU 2026-09-19 · **M**

Seen on the first pilot deployment: `/login` served with the `[PILOT]` chip
(200), a clean 401 from `/api/auth/me`, and a **bodyless 500** on
`POST /api/auth/login`. `src/lib/env.ts`'s header says the environment pair is
enforced "from middleware.ts and db.ts at request time"; `src/middleware.ts`
never imports it. So the pair is checked only when `db.ts` is first called —
which on a fresh deployment is the login POST, and a deployment with
`APP_ENV=pilot` against a sandbox database **looks healthy on every page a
signed-out person can reach**.

Two things a fix does, neither done: make the doc match the code (enforce the
pair in middleware so a mismatch fails on the sign-in page, or correct the
comment — enforcing is the better half, because the `[PILOT]` title is not
proof the pair is right); and **carry the reason to the response as a sentence
on non-production builds**, because a blank 500 at sign-in sent a person to
look at the database string when the database was fine.

The cause of that particular 500 was never read from Vercel's runtime logs,
which are the definitive evidence. Read them first, or this item fixes the
class and leaves the instance unexplained.

---

## 4. Stage 3d — 300 lines and up

Both items are measured, both have the same likely cause, and neither should
be "fixed" by raising a bound.

### 4.1 The 300-line project overview takes 10.4 seconds — FIU 2026-09-20 · **L, measure first**

§7.4a of the stabilisation plan asks for under two. Measured on DEMO-300 (503
records, 3 phases). The same shape as 4.2, and `loadOutstanding` over 503
records is the LIKELY weight — the overview's tiles all read it — but that is
a reading and not a measurement. **Profile before changing anything.**

### 4.2 The projects list takes about two seconds — FIU 2026-09-19 · **L, same item**

Measured repeatably at 1.5–2.1s against 6 active projects and 11,673 answers.
**It is not an N+1** — the route already batches every loader over the page.
Its own header names the cause: `loadOutstanding` returns every outstanding
QUESTION across every project on the page, so the list loads the chase
inventory of the whole business to print one Waiting count per row.

**The trap that makes this an L.** The Waiting count cannot become a SQL count
without a second copy of the staleness rule (`canonicalJson` over the context
snapshot) — the `chased_at` trap, and the same class of mistake as two TGQ
models. The two candidate shapes are a scoped `loadOutstanding` (the infill
route's own precedent: a WHERE clause on the same query, never a second
loader) and making the Waiting count lazy, which the route's header already
proposes. Both are decisions worth taking once, for both screens, with a
measurement in front of them.

The test bound was raised to 30s as a documented stopgap
(`tests/db/project-overview.test.ts`). Putting it back is part of the DoD.

---

## 5. Stage 3e — noise, test infrastructure, housekeeping

All S. None changes what the app records. All of them cost somebody attention
every time they are seen, which is why they are in a stage rather than a
backlog.

| # | Finding | FIU date | Fix |
|---|---|---|---|
| 3e.1 | `/api/records/<id>/image` 404s for a record with no picture — console noise on every record open | 2026-09-20 | a `hasImage` flag on the record payload so `page.tsx:1180` does not ask; or a 204 |
| 3e.2 | The configuration card's second confirm returns 409 and lands in the failure collector every run | 2026-09-20 | consistent with "a refusal on B leaves A applied" and correct; a person reads it as an error. Say so on the card |
| 3e.3 | The BOQ review's loading state is a discarded variable — `const [, setLoading]` at `imports/[id]/page.tsx:252` | 2026-09-21 | render it, or remove it. Note it is the reason that screen's banner happens to survive a reload — check `reloadThen` before deleting |
| 3e.4 | The chase footer does not say why one to-quote question is not ticked (lines sum to 71, button says 70) | 2026-09-20 | one sentence: *"1 awaiting a reply, not selected"*. Both numbers are right |
| 3e.5 | `chase-drafts.test.ts` mutates the seeded `requirements.tgq_levels`, so a concurrent run reads `later` where it expects `to_quote` | 2026-09-21 | that suite needs its own category and requirement rows; no per-run name fixes shared seed |
| 3e.6 | The COMPONENT tier times out under machine saturation — two unbounded runs are sixteen forks on eight CPUs | 2026-09-21 | a second concurrent `checks` carries `--maxWorkers=4`; decide whether that goes in the script or stays a rule |
| 3e.7 | `tests/manual/verify-model.test.ts` still writes a literal `'__QA P99001'` | 2026-09-21 | `qaNumber`, like the other thirty files. Not the db tier, gated on `VERIFY_MODEL=1` |
| 3e.8 | The infill DoD walk left QA litter on DEMO-TEST-01 — four `__QA` answers, one attribute, two change sets | 2026-09-20 | 0014 refuses deleting a change set while its project exists, so `qa:demo --clear --apply` is the only sweep (~15 min). Do it before a call, not during one |
| 3e.9 | An answer typed on the infill screen is refused on the LOCAL dev server and only there — 3 of 3 local, 0 of 1 on staging | 2026-09-20 | **Prove it before fixing it.** The wording is `transactionErrorResponse`'s retryable branch and the route does not log WHICH — deadlock, `lock_timeout` or `statement_timeout`. Logging which is the first step and may be the whole item. This is the meeting screen |

3e.9 is the one in this stage worth doing early. A dev server sharing a laptop
with a full test run is the likeliest reading and it is unproven, and Matthew
is meant to sit in front of that screen with a client.

---

## 6. Waiting on a person — not items, and named

| Finding | Waiting on | What must not happen |
|---|---|---|
| **There is nowhere to record Product code** (FIU 2026-09-18) | **Matthew**, shown his own seed note | Do not build either reading. His matrix says *"derived automatically: if MF1 or MF2 is populated"*; Max's reading is the client's BOQ code. Building Max's makes every record satisfy the row from a different fact than the one it names. **Do not weaken the gate chain to get the ticks back** |
| **Whether a level can only be determined at the drawing stage** (FIU 2026-09-18, part 1) | **Max**, to check with Matthew | Part 2 is built (`941573d`). The level GUESS rules are still this repo's judgement and Matthew has not seen them — same sitting, same person, alongside TGQ |
| **The item picture crop failed on a real page** (FIU 2026-09-18 item 6) | nobody — **deferred with a cost** | Investigated in Stage 1b: the PROMPT is the fix, and it re-reads every document already read. A cost, not an oversight. It rides with the finishes-schedule re-read |
| **The sandbox database is full — `audit_log` is 460 MB of 489** (FIU 2026-09-19) | **Max**, a decision not a code fix | Option 2 (purge QA audit rows) is the one thing `house/conventions.md` §12 says never to do; it needs his explicit yes in writing, a backup first, and a dated line in the FIU file. Option 3 (a Neon branch per db-tier run) is the durable fix and the only one that keeps §12 intact. None of it from a script that runs unattended |
| ~~**iCloud writes `" 2"` copies into `.next` and typecheck reads them**~~ (FIU 2026-09-20) | **CLOSED by Max, 2026-09-22** | He moved the checkout out of iCloud, to `~/Documents/SpecBuilderApp`, so the cause is gone rather than worked around. It was chosen over excluding `.next` from sync because `fileproviderd` was the largest CPU consumer on the machine at load average 214, not only the source of the `" 2"` copies. Every worktree's `.git` link pointed into the old path and was restored with `git worktree repair`. What does NOT change: a push is still gated on lint, typecheck AND tests, each by its own exit code — the `" 2"` copies were how that rule was learned, not the only reason for it |

---

## 7. How this is run

Same discipline as Stages 1 and 2, which worked:

- **Opus coders in worktrees OUTSIDE iCloud** (`~/dev/worktrees`), removed when
  the coder is done. Four worktrees each carrying `node_modules` inside iCloud
  drove the load average to 79.
- **One brief per item**, quoting the FIU entry rather than summarising it.
- **`npm run checks` with the database tier REQUIRED before each cherry-pick**,
  and a second concurrent run carries `--maxWorkers=4` (3e.6).
- **`CLAUDE.md` / `AGENTS.md` belong to exactly one agent**, and `cmp -s` runs
  before any completion is reported.
- **Every item's FIU entry is marked FIXED with its date and commit** when it
  lands. Never deleted. An entry closed on a stage list somebody else wrote is
  the "fixed on paper" state the file exists to prevent — the 2026-09-22
  reconcile found two such entries and it is a week old.

**Stage 3a needs a design pass first** (3a.1's three screenshots, 3a.4's
question to Max). Stages 3b, 3c and 3e can start in parallel with it; 3d should
wait, because its measurement is worth taking on a quiet machine.

## 8. Definition of done for the whole plan

1. Every item above is either FIXED with a date and a commit in
   `found-in-use.md`, or moved to §6 with the person named.
2. `npm run checks` green with the database tier required.
3. The first-session script (`.claude/skills/verify/files/first-session.mjs`)
   runs against the deployment with no new skips.
4. The 300-line project overview renders in under two seconds (§7.4a), or 3d
   carries a measured statement of why not and what it would cost.
5. **Human acceptance stays outstanding until Max has driven 3a on a real
   screen.** Nothing in this plan is accepted by passing.
