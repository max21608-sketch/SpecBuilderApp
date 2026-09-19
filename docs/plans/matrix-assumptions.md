# Matthew's matrix: what Max answered on his behalf, and how to undo it

**2026-09-17.** Matthew's `BWS_Spec_Decision_Matrix_for_Max.xlsx` arrived with
eight open questions attached (`docs/plans/questions-for-matthew.md` has the
earlier four; the new ones are in the draft reply). Rather than wait, Max
answered the ones that blocked code so the gate model could be built, on the
explicit understanding that **every answer here is a stand-in and each is still
to be checked with Matthew.**

This file is the checklist for that conversation. Each entry says what was
assumed, what it changed, what it costs if it is wrong, and how to reverse it.

Nothing here is expensive to undo. The gate model is seed data: a re-seed plus
a migration is the whole change, and five of the seven entries below are a
re-seed alone.

---

## 1. The matrix is adopted as the gate model — YES

**Max's answer:** "I think the answer is yes to the matrix, unless there's
anything really obvious. I assume it includes things like key dimensions."

**Checked:** it does. Rows 4–7 are Width, Depth, Height and Seat height, all at
TGQ, all carrying BWS id 3. Seat height is excluded from Daybeds, Ottomans and
Beds & Headboards in his own sheet, and that exclusion is preserved.

**What it changed:** `spec_field_gates` holds all 35 of his rows. The record
screen and the spec table report TGQ / TG0 / TG1 per record.

**To reverse:** delete the seed rows. Nothing else in the app reads them.

---

## 2. His TGQ set was NOT used to re-tier the quote questions — DELIBERATELY NOT DONE

**This is the one that would have been expensive, and it was left alone.**

Read literally, his fourteen TGQ rows say that only fourteen fields stop a
quotation going out. The app already has a to-quote tier — `requirements.tgq_levels`
(0019), read by `questionTier`, the chase emails, the drafts screen and the
spec table — and applying his reading to it would strike roughly 48 of the 62
distinct checklist questions out of that tier in one re-seed.

That is a big claim with a big blast radius, and it is exactly what the tick-box
workbook sent to Matthew on 2026-09-16 (`tools/tgq-checklist.mjs`) was built to
ask. So `tgq_levels` is untouched: all 788 requirement rows still carry all
three levels, and "Needed to quote" on the spec table means what it meant
yesterday.

**What to ask Matthew:** does the matrix answer the workbook? If yes, stop the
workbook — two answers to one question is worse than none — and the change is a
re-seed of `tgq_levels` with no code.

---

## 3. The category mapping — THREE JUDGEMENT CALLS

His nine seating categories are not our seventeen cheat sheets. The mapping is
in `db/seed/0005_spec_matrix_categories.sql`, and every debatable row carries
its reasoning in the `note` column so it is visible in the data.

Six of the nine are unambiguous. Three are not:

| Assumed | Why | If it is wrong |
|---|---|---|
| **A → `desk-chair-cinema-chair`** | He has no category for desk or cinema chairs at all. They are nearer occasional chairs than dining chairs, and swivel — which he asks of A — is already asked of a desk chair by our own seed. | Desk chairs get a gate view built from armchair rules. Remove the map row and they get no gate view instead, which is the honest fallback. |
| **S and B both → `armchairs-benches-stools-sofas`** | That is one sheet covering armchairs, benches, stools and sofas, so it receives his S, A and B together. | **Swivel widens**: he asks it of A and not of S or B, and it is now asked of all of them. |
| **S and D both → `sofas-bed-daybeds`** | That sheet covers sofa beds and daybeds. | **Seat height widens**: he asks it of S and explicitly not of D ("Not applicable: Daybeds, Ottomans, Beds"). |

**Union was chosen over intersection** on the repo's own rule — "a field nobody
can select is a spec value nobody can record". A widened question can be
answered N/A, which is a real state; a missing one cannot be answered at all.
But widening is still a decision, and `tests/db/spec-field-gates.test.ts`
asserts both of them explicitly, so changing the mapping fails a test rather
than quietly altering what gets asked.

**To reverse:** edit the map rows and re-seed.

---

## 4. Sixty new checklist questions — PROMPTS ARE HIS FIELD NAMES

Six BWS fields his matrix gates were asked by **no question anywhere in the
repo**: Assembly guide (191), Timber Finish 2 (31), Timber Finish 3 (143),
Metal Finish 2 (35), Back Cushion Build (25), Purchasing Notes (24). Three of
those were already flagged as a gap on 2026-09-16 in
`docs/plans/questions-for-matthew.md` Q2, and his matrix answers it: they are
wanted.

Two more (Seat Upholstery Build, Outdoor) were asked by some categories and not
others, where his matrix says all.

`db/seed/0007_requirements_gate_fields.sql` adds 60 rows, taking the checklist
from 728 to 788.

- Where a field is already asked somewhere, **that exact prompt is reused**, so
  one question reads identically across every category — the property that
  makes 788 rows only 68 distinct questions.
- Where it is asked nowhere there is no cheat-sheet wording to reuse, so the
  prompt is **Matthew's own field name** and the help text says so and names
  the matrix row.
- `tgq_levels` is all three, the 0019 default. **That is not a claim these six
  block a quote** — it is today's position, required of everything, until
  entry 2 above is settled.

**Visible side effect:** outstanding counts on already-categorised records went
up, correctly. There genuinely are more questions now.

---

## 5. A default does NOT satisfy a gate — ASSUMED

His sheet says Assembly guide is "No (default)".

**Assumed:** a default pre-selects a *control*; it never writes an *answer*.
`missing` means nobody has looked, and a gate passed by a default is a gate
passed by nobody. So Assembly guide reads as outstanding at TGQ and TG1 until
somebody answers it.

**If Matthew disagrees**, the change is one seeded palette option marked
`is_default` and a rule that treats it as confirmed — which would also mean
deciding what `Dimensions checked` means when nobody has checked them. Worth
asking before building the palettes (Stage 4).

---

## 6. The five BWS-owned palettes — NOTHING INVENTED

Timber finish, metal finish, seat build, back cushion and stud all say "From
the BWS … palette" and **this app holds none of them**.

They are recorded by key with his exact wording, the fields stay free text, and
the screen says "not loaded in this app yet" in words rather than offering an
empty dropdown. FMT-GEN-01: a BWS-owned vocabulary this app does not know is
left blank, never guessed.

**No assumption taken.** This is question 7 of the draft reply and it blocks
the finish dropdown he asked for in his first bullet.

---

## 7. Four things deliberately NOT built yet

Each is a stage of the plan, and each depends on an answer that has not come:

- **The free-text field**, one column or two. `Product code` and `Spec notes`
  currently report "Nowhere to record it" on the TGQ panel, which is the truth.
- **The qualifier / return line.** Nothing is captured and the export is
  unchanged and still one line per cell.
- **The Product code / boilerplate derivation**, and what selects Hero.
- **The costing sheet.** BUILT 2026-09-18, and the blocker recorded here was
  the wrong one — see below. What is still open is what `Specs 2` points at and
  whether `Tags` should go on receiving pasted prose.

---

## What got built, 2026-09-17

All of it on `staging`, none of it accepted by anybody.

| Stage | What | Migrations / seeds |
|---|---|---|
| 1 | **The gate model**, as a seeded overlay keyed on the BWS field. TGQ / TG0 / TG1 on the record screen and the spec table. | `0026`, `0027`, seeds `0005`–`0007` |
| 2 | **Creating things by hand** — a run, an item, a spec value — plus the two free-text columns and an editable bill line. | `0028` |
| 3 | **The qualifier**, the "return line". Stored apart, written inline into the file. | `0029` |
| 4 | **Palettes and the conditional fields.** Six lists seeded, five recorded empty. | `0030`, seeds `0008`–`0009` |
| 5 | **The quote CSV** and the BWS boilerplate register. Eight of twelve columns. | `0031`, seed `0010` |
| 7 | **Setting the finishes library out from a list** (partial — see below). | none |

### Four defects the work found, none of them in the plan

1. **A second hand-typed dimension could not update the answer the first one
   wrote.** `applyAnswerFills` only touches an answer still `missing` or one a
   shop-drawings run wrote, so a record showed W, D and H while its Dimensions
   answer said `W1900mm`. Fixed with a precise discriminator — `document` with
   a null `source_id` is only ever a hand-typed attribute.
2. **Saving one field of the details panel discarded text being typed in
   another.** Blur-save plus a reload that re-keyed every input. It was also
   four change sets for one correction. Now one Save.
3. **A sofa was handed the armchair boilerplate.** Our
   `armchairs-benches-stools-sofas` sheet maps to three of Matthew's codes and
   the first version took the first alphabetically. More than one code now
   derives nothing — which makes question 2 concrete rather than theoretical.
4. **`0028` deleted the `email_confirm` change-set kind**, by re-listing the
   `change_sets_kind_check` constraint from 0019's copy, which predated the
   0021 migration that added it. Every email confirm failed with a constraint
   violation reaching the reviewer as "Nothing was written". Restored by
   `0032`, and `tests/db/vocabulary-sync.test.ts` now asserts all twelve
   controlled vocabularies against their own CHECK so the next one fails in a
   second. **It was first misattributed to another agent's commit**, because
   the failure survived stashing the TypeScript changes — it survived because
   the constraint is in the database, which a stash does not touch.

### Two traces this work left that are not swept

- **Four change sets on the sandbox `AP364c` project**, from the browser
  walkthrough of stage 2 — `record_create`, two `manual_edit`s and an
  `attribute_create`, actor `__qa-probe@example.test`. The records were swept,
  which cascaded their versions away, but `change_sets` refuses a delete while
  its project exists and the project is real. They are inert; they are also
  why `tests/db/change-history.test.ts`'s whole-database assertion now requires
  at least one audit row whose target still exists. `npm run db:qa-clean` did
  not catch them because they are on a REAL project, not a `__QA` one — worth
  knowing before the next browser walkthrough on live data.
- **One checklist answer on the Panther armchair** was set and reverted during
  the palette check. The revert is recorded under actor `qa-revert`.

### What is NOT built, and why

- **Stage 6, the BW standard finishes register.** Blocked on Matthew's lists
  (question 7). Five palettes are seeded with zero options and the screen says
  so in words; nothing is invented.
- **The costing sheet.** ~~Blocked on his `skill.md` (question 8). The app
  holds no price of any kind and will not generate one.~~ **CORRECTED
  2026-09-18.** The skill.md and its user guide arrived; the skill generates no
  price either — it adds page links, crops photos, converts imperial to metric
  and deletes blank rows. Pricing was never the blocker. The export is built
  (`src/lib/costing-sheet.ts`): columns A-J of
  `Estimating Sheet Template - with stone.xlsx`, the item block, with the
  composed dimensions in `Tags`. K rightwards is still the estimator's and this
  app still holds no rate of any kind — that part of the old note stands.
- **Loading the finishes library BY SCANNING the schedule.** `finishes_schedule`
  is already a document kind with its own prompt, but the model's output shape
  (`RawProposal`) has no field for a finish code — so pulling codes out of it
  means parsing them from prose, which is the inference
  `house/conventions.md` §6 puts on the far side of the line. Adding a code
  field to the tool schema is the right eventual answer and **forces a re-read
  of every document already read** — eleven billed calls for the Panther pack
  alone. That is a decision with a cost, not an oversight. What is built
  instead is a paste box: a person pastes the codes, the app says which are
  new, which it already holds and which repeat, and one confirm creates them.
- **The gate model's TGQ half.** `tgq_levels` is untouched — see entry 2 above.

## 2026-09-18 — TGQ now reads his matrix first, per category

Max's decision, taken with the numbers in front of him. Until this date two
models both answered "does this block a quote" and nothing reconciled them: the
sandbox S-100 sofa read **48 needed to quote** in the spec table
(`requirements.tgq_levels`) and **6 outstanding** in its own TGQ gate panel
(`spec_field_gates`). Both were labelled TGQ-ish on screen.

**What was decided.** For a category Matthew's written matrix covers, TGQ is
computed from HIS matrix. For a category it does not cover, the old
`tgq_levels` model continues, under the same name. One name, one number per
record, and which model produced it is stated where it matters.

**Why not simply switch everything to his matrix.** His matrix covers nine
upholstered seating categories. The eight cabinetry sheets are not in it and
the cabinetry half has not been written, so every cabinetry item would report
zero blocking questions — not because it is ready but because nobody has
written its rules. That is the confidently-wrong answer the gate model exists
to prevent.

**Why not re-seed `tgq_levels` from his matrix.** That is the genuinely clean
end state — one model behind one number — and it is a seed plus a migration
rather than application logic. It also moves every figure on every screen and
would bake in the six assumptions in this file before Matthew has confirmed
them. It stays the target, not the step taken.

**What it changed, measured on the sandbox the same day.**

| Project | Before | After | On his matrix | On the placeholder |
|---|---|---|---|---|
| AP364c (Panther) | 1,899 | **167** | 39 | 0 |
| P17231 (Maybourne Paris) | — | **230** | 47 | 12 |
| DEMO-TEST-01 | — | **61** | 18 | 11 |

**What it does NOT change.** The TGQ workbook still has not been applied, so
the placeholder half remains "everything blocks a quote". The cabinetry matrix
still has not been written. The nine-to-seventeen category mapping is still
this file's three judgement calls. When Matthew answers, the fallback half
narrows and the caveat on the overview disappears on its own — it is seed data,
and no code changes.

**How to reverse it.** `questionTier` in `src/lib/tgq.ts` takes the matrix as
its third argument and ignores it when null. Passing null from
`loadOutstanding`, from the record route and from `project-summary.ts` restores
the old behaviour exactly, and `tests/lib/tgq.test.ts` asserts that a call with
no matrix is unchanged.

## 2026-09-19 — Max answered the catchup's nine questions on Matthew's behalf

`docs/plans/catchup-2026-09-18.md` §7 put nine questions to Matthew. Max
answered them the same day, **on the same basis as the rest of this file: every
one is a stand-in and each is still to be checked with him.** Two of them are
not assumptions at all — they are facts already in this repo that the answers
confirmed or contradicted, and those are marked.

### Q1 Levels — GREY OUT AND DEMOTE, and it is smaller than it sounded

> *"I think you're right with not recording specs. So the grey out and demote is
> probably enough."*

**Checked, and the change is nearly nothing.** `tgq_levels` is read in exactly
one place that matters — `questionTier` (`src/lib/tgq.ts:164`) — and it returns
`to_quote` or `later`. It is a **badge**, not a filter. `RecordChecklist.tsx`
passes it in to decide that badge and nothing else. **No specification field is
hidden by level anywhere today**, so Sebastian's shape is most of the way built
and what remains is sorting the `later` ones down and greying them.

One thing the answer does not touch, deliberately: a **null** level still blocks
a CHASE (`questionTier` refuses it, and a level-less record is a blocker on the
drafts screen). That is about chasing, not recording, so it stands.

**Reversing it:** presentation only. No seed, no migration.

### Q2 The TGQ workbook — DEFERRED

> *"Don't worry about that. That's not an issue for now."*

So `requirements.tgq_levels` stays at 0019's seeded default — all three levels
on all 728 rows, everything required of everything — for every category
Matthew's matrix does not reach. §2 of this file already says applying the
workbook only ever REMOVES entries, so waiting costs nothing but noise on the
cabinetry half.

### Q3 Product code — MAX'S ANSWER AND THE SEED DISAGREE, AND THE SEED IS MATTHEW

> *"I'm pretty sure that is the code on the client's spec document, on the BOQ
> document that they give."*

**Do not build this yet.** Matthew's own words in his matrix say something
different, and they are transcribed verbatim in `db/seed/0006_spec_field_gates.sql`
at row 1:

- `capture` is **`auto`**, not something a person types.
- `palette_raw` is *"Selected from boilerplate list (BW-Sofa,Simple /
  BW-Sofa,w-Metalwork / etc.)"*.
- `notes` is *"Boilerplate derived automatically: if MF1 or MF2 is populated ->
  with-Metalwork variant; otherwise Simple"*.

That is the **BWS boilerplate product code** — Ben Whistler's own register, the
45 codes in `bws_boilerplates` (0031) — and `pickBoilerplate` in
`src/lib/quote-lines.ts` already derives it.

**So the reason it reads `unanswerable` on all 179 records is not a missing
field.** It is that the derivation is AMBIGUOUS: our
`armchairs-benches-stools-sofas` is one cheat sheet receiving three of Matthew's
nine codes, so `pickBoilerplate` correctly returns nothing rather than pricing a
sofa against the armchair template. That is §3 of this file — the category
mapping — showing up somewhere new.

**What it costs to take Max's reading instead.** The client's own code is
already held, as `spec_record_refs.boq_code`, so wiring it in is about ten
lines — and every record would then satisfy that TGQ row **while the BWS product
code stayed underivable**. A gate would report satisfied on a different fact
from the one it names, which is the failure `gateStatus` refuses an empty field
list to avoid.

Both readings are cheap. Choosing the wrong one is not. **This is the first
question to put to Matthew**, and it is worth showing him his own note when
asking.

### Q4 Substrate — (b) YES, (c) IT ALREADY EXISTS, (a) PROVISIONAL

> *"(b) definitely yes, it does satisfy TGQ. (c) I believe it does have a BWS
> code. (a) …it's going to be for the item, not the whole project. We may need
> to come back to that."*

**(c) is confirmed and better than expected. Substrate is already one of the 56
BWS fields**: `json_id` 192, `column_letter` CF, section Finishing
(`db/seed/0001_spec_fields.sql:79`), and `docs/bws-spec-grid.md` places it in
the **Cabinetry** block, AG–AR. So no new column is needed anywhere. What is
needed is for it to be **reachable on a seating item**, which today's grid
blocks do not do — and the grid is a screen layout, never a filter, so a field
outside a block still appears. Worth checking that it really does.

**(a) per ITEM, recorded as provisional** — Max corrected himself twice and said
to come back to it. The per-item reading is also the cheaper and more reversible
one: it is a `record_attributes` row against field 192, which every existing
composer, promoter and exporter already carries. Project-scoping it would mean a
column on `project_finishes` and a second place a finish is described.

**(b) is the expensive half and it is not yet designed.** "A known substrate
satisfies TGQ" is a **conditional in the gate model**, not a value: it means a
`TBC` Timber finish stops blocking TGQ when Substrate is confirmed.
`spec_field_gates` already carries `conditional_on_key` / `conditional_on_value`
and `gateStatus` already has an `unknown` outcome for a conditional whose
controller is unanswered, so the machinery exists. What has to be decided is
**which fields substrate releases** — all three timber finishes? metal too? —
and that is a question for Matthew, not an implementation detail.

### Q5 Areas — RELIABLE

> *"Yes, the areas are reliable in the BOQ."*

Unblocks grouping the chase email by area, and area as a filter. No curation
step needed per project.

### Q6 Versioning — V1 FIRST, AND THE NUMBER BELONGS TO THE PROJECT

> *"For the client it should start at V1. Every time you make a small change
> internally we'll version it 1.1, 1.2, 1.3, and then every time a document gets
> issued to the client, the project moves from version one to version two."*

Three things this settles, all of which the room left open:

- **The first client-facing version is V1**, not V0. Matthew's *"it starts off
  as version zero"* is not adopted.
- **The number belongs to the PROJECT** — *"the project moves from version one
  to version two"* — not to each record. The per-record `snapshot_no` stays what
  it is: the internal count.
- **Issuing bumps the major; sign-off does not.** Tony's *"when it's signed off
  by the client it's V4"* would have been a second increment and is not adopted.

**The consequence is that this is probably not a new numbering scheme at all.**
A project-level issue counter over named baselines is what `baseline_members`
(0013) already is, and it is already materialised under the project lock for
exactly this reason — *"the newest version as at that date"* is wrong, because
`created_at` is transaction start time. So: an issue is a baseline, the issue
number is the count of them, and `<issue>.<internal>` is a display rule over two
numbers the app already holds. Confirm that reading before building anything.

### Q7 Palettes beyond the five — NOTED, COME BACK TO IT

Which other fields are `palette` type, and whether any palette is closed, is
unanswered. It does not block the sync: the BWS field index itself marks which
fields are palettes (§3.32 of the catchup), so the scrape can discover them.
What stays open is whether free text should ever be REFUSED, and until somebody
says so the answer is no — "Other…" stays on every list, which is already the
rule.

### Q8 The overview tiles — THIS REPO'S JOB, NOT MATTHEW'S

> *"Think about what could be some really useful information to display instead
> of just displaying it for the sake of it."*

Not a question for Matthew after all. A proposal has to come from here first,
and the test is the one Max just set: a tile earns its place by being something
somebody would act on, not by being a number that was easy to count.

### Q9 The cabinetry matrix — WE ARE NOT MISSING IT; HE HAS NOT WRITTEN IT

> *"Are you asking for it? Are we missing it? Is that the issue? … You could
> probably draft one to go in its place for now."*

**Nothing has been lost.** Matthew's workbook covers his **nine seating
categories** (`S, A, DC, BS, B, D, O, BH, BQ`). Our 17 cheat sheets are 9
upholstery and **8 cabinetry** — consoles/desks/dressing tables, dining tables,
drinks cabinets/service stations, mirrors, shelves/bookcase,
side/coffee/bedside tables, sideboards/dressers, wardrobes
(`db/seed/0002_item_categories.sql`). Those eight are unmapped, so
`gatesForRecord` returns **null** and a cabinetry record gets no gate view at
all. That is deliberate: an empty field list computes as "nothing outstanding",
and a record reported TG0-ready because nobody wrote its rules is the
confidently-wrong failure the gate model exists to prevent.

**A stand-in draft is feasible, and half of it already exists.** The cabinetry
FIELD list is written down — `docs/bws-spec-grid.md`, block AG–AR: Substrate
(192), Timber Finish 1 (4), Timber Finish 2 (31), Timber Finish 3 (143), Metal
Finish 1 (5), Metal Finish 2 (35), Glass & Mirror Spec (15), Stone (147),
Runners (10), Hinges (9), BW Supplied Hardware (75), Drawer liner (190). What
does not exist is **which gate each sits at** and **which of the eight
categories each applies to** — runners and hinges do not apply to a mirror.

If it is drafted it must be seeded as visibly ours: a distinct `matrix_row`
range so a re-issued workbook still diffs, and its own entry in this file. It
is Stage 3 work in the catchup plan, and doing it ahead of Stage 1 would be
choosing it over the work that lets Matthew use the app at all.

---

## How to check this file is still true

```bash
npm run db:seed                      # idempotent; re-seeding is how the model changes
node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/spec-field-gates.test.ts
```

The db-tier test asserts the 35 rows, both widenings, that every mapped
category can answer every field its gates name, that the eight cabinetry sheets
get no gate view, and that the five BWS palettes are still empty. If Matthew
changes an answer, that test is what tells you what else moves.
