# Gates, TGQ, the chase and the fill-in

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### A gate slot is settled by a figure, and a Dia stands for W and D (provisional)

`src/lib/gates.ts` (`slotStatus`)

A slot row was satisfied by `state = 'confirmed'` and any unit, so a confirmed
`approx 720-740` at mm passed TGQ while the file shipped `[W "approx 720-740"
— not a number]` (audit F5). It is now satisfied only when
`parseDimensionFigure` — the composer's own reader — reads ONE figure, with no
TBC printed beside it and a unit (stated, or the value's own feet and inch
marks); `approx 720-740`, `1520 TBC` and `1,200` block, saying why. On a round
item a Dia satisfies the W and D rows and says so (`Dia. 600`, "Diameter
recorded. On a round item it stands for W and D."): before this a pouffe read
"No W has been recorded" for ever and the chain held TG0 and TG1 behind it
(F3). **That branch is PROVISIONAL pending Matthew** (Max, 2026-11-06: ship
the code, Matthew confirms the rule; if he rules for a "round" conditional in
the seed instead, the branch goes and the seed carries it). A Dia BESIDE a W
or a D blocks both rows, because it is the composer's `dia_conflict`.

### Gate rules read state, not strings

A spec value is `confirmed`, `tbc`, `missing` or `na`, and those are four
different things. `TBC` means a human actively said "not yet decided" — an
answer, and it blocks a gate. `missing` means nobody has looked. `na` means the
field does not apply to this category. A rule testing for a non-empty string
treats the last three as satisfied and reports a record ready for TG1 when it
is not.

### A gate belongs to a FIELD, and the same field sits at two gates

`db/migrations/0026_spec_field_gates.sql`, `db/seed/0005_spec_matrix_categories.sql`,
`db/seed/0006_spec_field_gates.sql`, `db/seed/0007_requirements_gate_fields.sql`,
`src/lib/gates.ts`, `src/lib/gate-load.ts`

`requirements.required_at_gate` has existed since 0002 with the comment "null
until a human authors the gate model", and **nothing ever wrote it**. Matthew
sent the first written gate model on 2026-09-17: 35 spec fields across TGQ /
TG0 / TG1 for nine seating categories, with palettes and two conditionals.

It does not fit that column, and the reason is the whole design. **His matrix
puts the same field at two gates** — Assembly guide (191) is TGQ *and* TG1,
Dimensions (3) is TGQ (four slots) *and* TG1 (the whole cell re-checked). One
text column cannot hold two, which is 0019's argument for `tgq_levels text[]`
arriving from the other end. `required_at_gate` stays null, is never written,
and goes in a destructive migration.

So the gate is a seeded **overlay keyed on `spec_fields.json_id`**, and six
things about it are traps rather than preferences.

- **Keyed on the FIELD, not on the question.** Every BWS id in his matrix
  matches `db/seed/0001_spec_fields.sql` exactly, so the field half needs no
  translation. His nine CATEGORIES do not match our seventeen cheat sheets, and
  keying on the field is what let the model be seeded and read while that
  mapping was still being settled.
- **The category mapping is many-to-many in both directions**, which is why it
  is a join table and not a column. His Sofas lands on two of our sheets, and
  our `armchairs-benches-stools-sofas` is one sheet receiving his S, A and B.
  **Union semantics widen exactly two rows** — swivel onto benches and sofas,
  seat height onto daybeds — and `db/seed/0005` names both in the data, not
  just in a comment. Widening is right ("a field nobody can select is a spec
  value nobody can record") and it is still a decision somebody has to confirm.
- **An unmapped category gets `null`, never an empty gate.** The eight
  cabinetry sheets are not in his matrix and the cabinetry version is still to
  come. An empty field list computes as "nothing outstanding", and a record
  reported TG0-ready because nobody has written its rules yet is the
  confidently-wrong failure the model exists to prevent. `gateStatus` refuses
  an empty list and `gatesForRecord` returns null before it gets there.
- **Five outcomes, because three would lie.** `satisfied` / `blocking` /
  `not_applicable` are the obvious three. `unknown` is a conditional whose
  CONTROLLER is unanswered — we cannot tell whether the field even applies, and
  a default must never decide it. `unanswerable` is a field the matrix wants
  and this category's checklist cannot ask, or one of his ten id-less rows with
  no home yet: it counts against the gate, and the fix is a seed or a
  migration rather than a person answering. Folding `unanswerable` into
  `blocking` puts questions on a reviewer's desk that they cannot answer;
  folding it into `satisfied` passes a gate over fields nobody can record.
- **A dimension is settled by the ATTRIBUTE that carries the slot**, never by
  the composed cell. `W840 x D790 x H720mm` confirmed as a whole says nothing
  about whether a seat height was ever measured, which is why rows 4–7 of his
  matrix are four rows carrying one BWS id and a `dimension_slot`.
- **One implementation, two callers**, the `questionTier` rule again. The spec
  table's TG0/TG1 columns and the record screen's gate panel both run
  `gateStatus` over bulk-loaded rows. Computing the table's numbers in SQL
  would be a second gate model, and a table saying TG0 is met over a record
  whose own screen lists three blockers is worse than no column.

`applies_to` is stored expanded AND raw. "All categories" and "All UPY seating"
expand to the same nine in a seating-only workbook and **are not the same
statement**: when cabinetry arrives the first widens and the second must not.
`matrix_row` carries his own `#`, so a re-issued workbook diffs.

Five palettes in his matrix are BWS-owned and **this app holds none of them** —
timber finish, metal finish, seat build, back cushion, stud. `palette_key`
names them and `palette_raw` keeps his wording, so the gap is a recorded
question rather than a forgotten one, and the screen says so in words instead
of offering an empty dropdown. FMT-GEN-01 applies: never invent one.

**They are obtainable as of 2026-09-18 and the gap should close.** Matthew
showed where they live —
`bws.whistlercloud.com/standard_specification_fields/<id>/edit`, the **Palette
options** box, per field whose `Field type` is `palette`. There is no export, so
it is a scrape. **Never take a field's *Values* page instead**: that is what
people have TYPED (`self-piped`, thirteen times), and somebody had already been
caught by it. Never-invent still stands — this is a read of BWS's own list, not
a list we made up.

**THE GAP IS CLOSED (2026-09-22, item 2.1).** All 84 fields were read
read-only from Max's own session — 59 palettes, 413 option lines — into
`docs/plans/bws-palette-capture-2026-09-22.json`, with
`docs/plans/bws-palette-capture-2026-09-22.md` as the capture note, and the
five are seeded by `db/seed/0011_bws_palette_options.sql` (96 options; timber
35, metal 15, seat build 27, back cushion 6, stud 13). Do not scrape again;
re-scrape only to RE-sync, and diff against that file. The paragraph above is
the history, not the state — the section below carries the rules that now hold
it. Two things the capture recorded and this repo did NOT act on, both
Matthew's: row 23 may be pointing at the wrong field (BWS has a separate
`Seat Cushion build`, id 18, that we do not hold and that parallels row 24's
field 25), and the six palettes seeded as `owner = 'app'` each have a real BWS
list behind them whose wording differs.

### The gates BUILD ON EACH OTHER, and only the chained reading is called satisfied

`src/lib/gates.ts` (`GATES`, `chainGates`, `GateFieldsStatus`),
`src/lib/gate-load.ts` (`gatesForRecord`, `gateSummary`),
`src/components/records/GatePanel.tsx`, `src/components/records/SpecTable.tsx`

The panel printed `TGQ 2 outstanding` · `TG0 5 outstanding` · `TG1 ✓` on a real
record, and the spec table ticked the same TG1. Max, 2026-09-18: "it's
impossible to be at TG1 if you haven't reached TG0 or TGQ. They build on each
other." TGQ is enough to put a price on the item, TG0 is the design intent
agreed on top of that price, TG1 is the production lock on top of that intent.

Judged field by field they look independent and they are not — Matthew's matrix
deliberately puts the SAME field at two gates (Assembly guide at TGQ and TG1,
Dimensions at TGQ as four slots and at TG1 as the whole cell re-checked), so a
later gate is largely a RE-CHECK of an earlier one. A TG1 re-check reported as
met over a TGQ nobody could judge is the app agreeing with itself.

Five things are load-bearing.

- **The ORDER of `GATES` is the model.** It was a display list and is now the
  prerequisite chain; reordering it changes which gate requires which.
- **The FIELD LIST does not chain, only the VERDICT does.** TG1 still lists
  TG1's own rows and nothing else — asked for in the same breath ("it's fine to
  have it so that in TG1 it only shows the TG1 specific specs"), and mixing
  three gates' fields into one list is how the panel became unreadable before.
- **`gateStatus` returns `GateFieldsStatus`, which HAS NO `satisfied`.** Only
  `chainGates` produces a `GateStatus`, and only that type carries `satisfied`.
  This is the guarantee, not a convention: a future caller reaching for the
  obvious name on a single gate's reading gets a type error rather than the
  wrong answer. `ownSatisfied` is kept and reported apart, because "TG1 has
  nothing of its own left" and "TG1 is met" are different states and collapsing
  them either puts finished work back on a desk or claims a gate nobody
  reached.
- **A blocked gate is SLATE, never red, and never green.** Its own count still
  shows — hiding it would say less than the screen used to — but painting it red
  for work that cannot start yet teaches people to ignore red, the same argument
  that keeps `unanswerable` slate. The pill names the EARLIEST unmet gate,
  because that is the one to do next; the panel lists them all and each one
  opens from there.
- **An `unanswerable` predecessor blocks the whole chain, and that is correct.**
  `gateStatus` has always refused to call a gate satisfied over a field the app
  cannot record; the chain inherits it. The consequence is large and was
  MEASURED on the sandbox, 2026-09-18: **Product code is unanswerable on all 179
  records with a matrix view** — one of Matthew's id-less rows with no home in
  this app — so no record can satisfy TGQ, and therefore none can reach TG0 or
  TG1. Every gate tick in the sandbox is gone, correctly. Closing it is a seed
  or a migration, NOT a person answering, so the panel breaks a predecessor's
  count into "n to answer" and "n nowhere to record" rather than putting an app
  gap on a reviewer's desk. Do not weaken the chain to get the ticks back.

**The table's TGQ column is still a DIFFERENT measure from the TGQ gate**, and
the chain makes that visible: a row can read "Can quote" beside "5 after TGQ".
The column counts outstanding to-quote QUESTIONS and the gate counts FIELDS —
the gap the section below already records as not directly comparable. It is now
side by side on one screen, and which of the two the column should show is
Max's decision, not this repo's.

### A chase records that a question was asked, and writes no answer

`db/migrations/0005_chase_drafts.sql`, `src/lib/chase-drafts.ts`,
`src/app/api/drafts/[id]/confirm-sent/route.ts`

Recording a send must NOT write to `spec_answers`. The obvious design is a
`chased_at` column; it fires `bump_version`, which invalidates every M2
extraction snapshot taken against that answer for a reason unrelated to the
answer — and writes a communication event into a business record. "Waiting for
a reply" is therefore DERIVED: a question is waiting when it is still
outstanding and some sent `email_draft_items` row still matches it.

Two consequences that look like omissions and are not:

- **Undo does not check `version = snapshot + 1`.** The
  `email-draft-and-send-gate` skill requires it where confirming a send mutates
  the covered lines, so one bump proves nothing else touched them. Nothing is
  mutated here, so there is no bump to count.
- **Staleness compares a context snapshot, not just versions.** `requirements`
  and `spec_record_refs` carry no version, so an edited prompt or a corrected
  client ref would otherwise be invisible. Compare with `canonicalJson`; plain
  `JSON.stringify` fails, because `jsonb` does not preserve key order and every
  draft then reads as stale the instant it is generated.

Only `intro_text` and `closing_text` are author-edited, as plain text; the
question table is generated from the coverage rows. That is what makes the body
and the coverage provably the same set — the guarantee the gate rests on. Do
not add a whole-body HTML editor.

`tracking_eligible` was a third condition on the Waiting query and **nothing
ever wrote it false**: the case it described — recording a send whose coverage
was already stale — is refused outright by the gate. The predicate is gone; the
column goes in a destructive migration once the screen has been accepted.

**Staleness never reads the record's version** (audit F10, 2026-11-06).
`bump_version` fires on every `spec_records` update, an internal note
included, and comparing `recordVersion` dropped every question on the record
out of Waiting and refused an unsent draft at confirm-sent with nothing the
email printed having moved: the `chased_at` trap in reverse. The context
snapshot carries every field the email prints, and a category that no longer
asks the question reads `questionGone` through `loadQuestionsByKey`'s
category join. `record_version` is still written on coverage rows and decides
nothing (`coverageStaleReasons`).

### A quote is blocked by SOME of the questions, and the email says which

`db/migrations/0019_item_level_and_tgq_levels.sql`, `src/lib/tgq.ts`,
`src/lib/chase-template.ts`, `docs/plans/tgq-for-matthew.md`

TGQ is the pre-sale gate — enough information to put a price on the item.
Reporting confirmed / TBC / missing across all 728 cheat-sheet questions says
how full the form is, not whether a quotation can go out, and only the second
question is worth anything at tender stage.

Three things carry it, and each is a trap rather than a preference:

- **`requirements.tgq_levels text[]`, not `required_at_gate`.** Matthew answers
  per question AND per level, so "needed for a hero sofa, not a simple one" is
  the normal case and a single-valued column cannot hold it. `required_at_gate`
  stays null and reserved for TG0/TG1/TG2. The seed writes all three levels on
  all 728 rows — today's position, everything required of everything — so
  applying the workbook only ever REMOVES entries, and it is a re-seed with no
  code change. An empty array is a question that never blocks a quote.
- **A LEVEL NEVER HIDES A SPECIFICATION FIELD, and today none is hidden.**
  Matthew, 2026-09-18: *"if it means that you're not gonna get offered the
  specification field, then maybe that's not particularly useful to have."*
  `tgq_levels` is read by `questionTier` and nowhere else that matters, and it
  returns a BADGE — `to_quote` or `later` — so nothing filters by it. Keep it
  that way: the agreed shape is show everything, sort the `later` ones down and
  grey them, never remove one.
- **A level is REQUIRED before anything is TIERED.** `questionTier` does not
  accept a null level, and `questionTierOrNull` returns null rather than
  picking a reading: "needed at any level" makes a level-less record look
  urgent and "needed at none" makes it look quotable, and both are the app
  answering a question only a person can. A record with no level is a BLOCKER
  on the drafts screen — with an inline level picker, because 59 records must
  not mean 59 visits — reads "Set level" in the spec table, and is refused by
  the generate route with that reason named.
- **The tier is a COLUMN on `email_draft_items`, never part of
  `context_snapshot`.** The snapshot is compared with `canonicalJson` to decide
  whether a sent draft still describes reality, so a field added to it makes
  every existing row stale at once. Worse, a tier is a reading of the gate
  model: applying the workbook re-tiers hundreds of questions in one re-seed,
  which inside the snapshot would 409 every unsent draft and empty Waiting for
  a reason unrelated to any answer — the `chased_at` trap again. A question
  moving between the halves is an amber advisory on the card, not a conflict.

The email prints TIER FIRST: a red-bordered banner "Needed before we can quote",
then the records under it, then a grey "Also outstanding". The banner is a
one-cell table, because Word's renderer drops borders declared on a `<p>` and
that banner carries the whole point of the message. `questionTier` is the single
implementation, called by the drafts inventory, the generate and edit routes,
the record screen, the spec table and the template — the server reads the tier
off the live row and a request that tries to SET one is a 400, because the tier
decides what the email claims is blocking, and the client does not get to say.

### The chase SCREEN is a list of ITEMS; the chase EMAIL is a list of QUESTIONS

`src/lib/chase-grouping.ts`, `src/components/drafts/ChaseQuestionTable.tsx`,
`src/lib/chase-drafts.ts` (`loadOutstanding`), `src/lib/chase-template.ts`

**The two halves are grouped differently and it is deliberate.** Everything
below is about the SCREEN, and it is right: Matthew drove it without complaint
on 2026-09-18. The EMAIL is the opposite, asked for twice in that meeting on
Jay's behalf — *"we end up repeating the question on ten lines"*, and
*"what you want to do is say, oh, for the dressing area, we don't have a
metalwork finish"*. A person works item by item; a CLIENT answers question by
question, by area. Building the email the way the screen is built is the defect
being reported. **Built 2026-09-20 (Stage 2 item 2.5)**, and five things about
the EMAIL are load-bearing:

- **The regrouping lives in `chase-template.ts` and nowhere else.** The body's
  unit is the QUESTION, then the AREA (the document's own wording, "No area
  given" last), then the items under it; a question outstanding on one item
  prints as one line with no area row. `groupByQuestionAndArea` is a pure
  regrouping of the same coverage rows the screen and the send gate use.
- **The coverage rows did not change shape.** `email_draft_items` is still one
  row per record × question, and `tests/lib/chase-template.test.ts` extracts
  the `(record, requirement)` pairs back out of the rendered body (each item
  row carries `data-record` / `data-requirement`, which Outlook and Word
  ignore) and asserts they equal the coverage set. That equality is what the
  send gate rests on; a regrouping that built its own rows would break it
  silently.
- **The quantity is NOT on the item line**, though it is the obvious place. A
  coverage row is a frozen `context_snapshot` compared with `canonicalJson`,
  and it has never carried a quantity; adding a field makes every unsent draft
  read as stale the moment it ships — the `chased_at` trap. The line is
  `record · refs · description`. Max's call whether to pay that cost.
- **A colleague can be the recipient, and the wording comes from the LIVE
  contact row.** `groupByContact` gives a `project_contacts.role = 'internal'`
  contact EVERY outstanding question with a level (a colleague is not routed
  by designer code, and `blocked` is deliberately unchanged — it describes the
  designer routing). The generate route reads `role` off the locked row and
  passes `internal` to `defaultIntro`, which says *"we still need"* where a
  designer gets *"we need from you"*; a request cannot set it (the
  `questionTier` rule). A colleague's tab REPLACES the designers' groups on
  the screen rather than sitting beside them, or `groupIntoLines` buckets
  every question twice — found on the 300-line project as "5702 questions
  ticked" for 2851.
- **The tier banner is unchanged**: still first, still a one-cell table, still
  counting coverage rows rather than question tables — one conservative count
  rather than three of one thing.

**Area is a filter (Stage 2 item 2.4), and it folds by case and whitespace
only.** `src/lib/area-filter.ts` is a leaf; `AreaSelect` is a native select
whose options are the area AS THE DOCUMENT FIRST WROTE IT, "No area given"
last; the search box on both screens matches area text, which is what makes
35 of them findable without a combobox. On the phase table and the chase
screen it narrows what is LISTED — the tiles, the tally reported to the header
and the Draft button's number never move — and `?area=` is in the URL through
`useUrlTab`, which never rewrites a pasted value while the rows are loading.

Asked for directly on 2026-09-17, on first sight of the screen with real data:
"this is completely ridiculous, 822 to quote — we can't be showing all of
these." One row per outstanding question is 823 rows under one contact's name,
and every one of them repeats the item it is about, so twenty questions about
one headboard read as twenty separate problems. A person works item by item.

So the unit on screen is the FURNITURE LINE, collapsed, as a table — the code,
what it is, how many specs are missing, how many finish options it has — and a
line's questions exist inside it. Its FINISH OPTIONS (0024's variants:
`S-301 A`, `B`, `C`, `D`) are a level in between, because the fabric is what
differs between them and the fabric is what the questions are about. `Finish
option` is the word on screen, settled with Max on the same day; `variant` and
`configuration` remain the words in the schema and on the drawings review.

Six things are load-bearing, and each is a trap rather than a preference:

- **A filter narrows what is LISTED, never what is ASKED.** The selection is
  the truth: hiding a question does not untick it, and the footer says in words
  how many ticked questions the filters are hiding. The old screen did the
  opposite — unticking *Include questions awaiting a reply* dropped those
  questions from `selectable`, so a question somebody had deliberately added
  left the draft when they changed a dropdown, silently. This is the finishes
  library's rule in a second place.
- **The two counts are the LINE'S OWN, whatever the filter says.** A filter
  appends `n shown` beside them and never rewrites them, or somebody narrows
  the screen until an item looks finished. And `n shown` appears only when the
  list was NARROWED — a search, a state, a tier. Readiness and awaiting-a-reply
  being hidden is the default VIEW, not a filter, and printing `n shown` on
  every row by default teaches people to ignore the one row where it means
  something.
- **`optionCount` is the true number of finish options**, including any with
  nothing outstanding — which therefore contribute no row. "2 finish options"
  beside a single visible option is a question about the data; "1" would be a
  claim that B does not exist. The line also says how many have nothing left.
- **A finish option reads its parent's ref and its parent's quantity, and the
  quantity is never apportioned.** `S-301 A` carries no client ref of its own
  and no qty, deliberately (`variant-create.ts`), so `loadOutstanding` reads
  both through `parent_id` — and the row says *quantity not allocated* rather
  than dividing 45 by the number of letters.
- **A finish option sorts with its bill line**, by `coalesce(parent.record_no,
  r.record_no)`. It is allocated the next free number in the project, so
  ordering on its own lands it pages from what it belongs to; ordering on
  `parent_id` puts the groups in uuid order, which is no order at all. Same
  rule, same reason, as `/api/records`.
- **The level cell is a LINK to the record, in a new tab.** Setting a level is
  a decision taken on the record, and `Button.tsx`'s rule cuts both ways: a
  link goes somewhere. The new tab is so a half-made selection survives it. The
  inline level PICKER stays on the blocker panel at the top, where the point is
  to set 59 levels without 59 visits.

Two things about the table itself, both found by building it. The wrapper must
NOT be `overflow-hidden`: it makes the wrapper the sticky scroll container, and
the column header then offsets down from the top of the table and covers a
furniture line — a row nobody would know to look for. And a spanning panel is
its own `<tr>`, never an extra `<td colSpan>` beside the data cells, which is
the same rule the drawings card learned.

`groupIntoLines` is pure and tested in the pure tier; the table's own behaviour
is tested in the component tier, which runs without a database.

### A chase asks only this project's questions, and only what the record asks

`src/lib/chase-drafts.ts` (`loadQuestionsByKey`, `CHASE_HEADING_PREDICATE`),
`src/app/api/drafts/**`, `tests/lib/chase-heading-predicate.test.ts`

`loadQuestionsByKey` read ANY record and paired every requirement with every
record (a cross join with no category clause), and neither the generate nor
the edit route compared the record's project with the draft's — so a crafted
or stale request could put another client's items, refs and values into this
project's chase email, which a person then sends (audit A3/F11, 2026-11-06).
It now takes the project and carries `loadOutstanding`'s scope clause for
clause, minus the answer-state filter: the project, the record's category's
questions, an active phase, not a split heading. A missing key is refused in
one sentence that names nothing of the other project. The split-heading clause
is `CHASE_HEADING_PREDICATE`; the driver cannot interpolate a fragment, so the
test reads the chase queries' SOURCES and fails on one without it or without
`run.status = 'active'` — it was missing from three.

### The infill screen fills in what we know, and it writes through the two routes that already exist

`src/app/dashboard/projects/[id]/infill/page.tsx`, `src/components/infill/*`,
`src/app/api/projects/[id]/infill/route.ts`, `src/lib/infill.ts`,
`src/lib/chase-drafts.ts` (`loadOutstanding`'s scope), `src/lib/chase-grouping.ts`
(`groupByQuestion`), `src/lib/manual-capture.ts` (`createAttribute`),
`tools/measure-outstanding.ts`, `docs/plans/make-it-work-2026-09-19.md` §5.3

Matthew's missing step (2026-09-18): the PM loads the pack, takes what is
outstanding to the CAM, and only then to the client — and in a handover call
the app is open in front of the client, "capturing as you go". Max's shape: the
chase screen with an edit box where the tick box is. Built 2026-09-20 (Stage 2
items 2.3 and 2.7). Two screens, one loader, one grouping — the chase screen
selects questions to ASK, this one ANSWERS them, and the two can never
disagree about what is outstanding because both read `loadOutstanding` and
`groupIntoLines`.

- **It ships lines, not questions.** Measured first (`npm run
  measure:outstanding`): the 300-line project is 19,582 outstanding questions,
  18,976 KB of JSON if sent whole, over a loader that answers in about a
  second. The chase screen ships that whole list because a tick box needs it;
  this route answers in three shapes over ONE loader — the collapsed lines with
  two counts each, one line's questions on open, one question's items for the
  by-question tab — through an optional SCOPE on `loadOutstanding` that is a
  WHERE clause on the same query, never a second loader. First paint 1.9 s on
  407 lines; the screen says its counts in words.
- **The route writes nothing.** Every edit row posts to `PATCH /api/answers/[id]`
  or `POST /api/attributes`, where the optimistic lock, the change set and the
  reason rule already live. A 409 is shown on the row, which reloads ITSELF
  with the live version; a 400 `reason_required` opens the reason box inline,
  keeping the typed value.
- **A dimension is written as an ATTRIBUTE, never as an answer.** `rowKind`
  reads `jsonId === 3` and the row becomes slot + figure + unit → `createAttribute`,
  because the Dimensions cell is a projection of the attributes and a typed
  answer there would be wiped by the next drawing confirm. The row then says
  *"Recorded as a width dimension"* and shows the composed cell. A palette
  question offers `AnswerValue`'s dropdown with Other…; everything else is a
  text box saving on blur as `source_kind = 'manual'`.
- **A change is offered in the header and never required.** `OpenChangeBar`
  sits in the header band; with one open, every edit attaches to it —
  including a typed dimension, because `createAttribute` now joins the actor's
  open change (it used to open its own every time, so a meeting's dimensions
  filed as separate occasions beside its answers). The first edit works with no
  change open. DoD on the demo project: one change, four gaps on two items in
  nine seconds, ONE change set, one version per record, `spec_records.version`
  untouched.
- **Reference beside the gap, never pre-filled.** Sister finish options'
  confirmed values and the library's description of a finish code print as
  text with no button that copies them — M8's rule that a value is never
  filled from a sister item.
- **By question keys on the FIELD, not on `requirements.id`.** `requirements`
  is per category, so "Dimensions" is 17 rows and keying on the id showed four
  Dimensions headings on the 300-line project, where clearing one read as done.
  `groupByQuestion` keys on BWS field → local key → folded prompt → id.
- **The shared table body was NOT extracted**, deliberately: the tick column is
  not the only difference (eight columns against seven, a selection model, a
  level `SuggestButton`, a spanning reason panel). What decides anything is
  shared — `groupIntoLines`, `countOutstanding`, `area-filter` — and forty
  lines of JSX behind a prop per caller is a copy with extra steps. Two tables
  sharing one grouping is acceptable; two groupings is not.

Found by building it, and FIXED the same day (`929a5b6`): **`snapshotRecords`
numbered a version with no lock**, so two edits to two questions of one record
could both claim the same number and the second reached the reviewer as a
500. It now locks the records it is about to version (`for update`, in id
order) before reading `max(snapshot_no)` — the baseline's own rule (0013), on
the record instead of the project. The db test that holds it polls
`pg_blocking_pids` until the second transaction is genuinely blocked; the
first version used a fixed pause and passed with the lock deleted, because
four round trips to London were slower than the race.

### An item's TGQ is its own questions; the project's are answered once

`src/lib/chase-grouping.ts` (`inItemTgq`, `inProjectWideTgq`, `inChaseAsk`,
`itemTgqCounts`, `readyToQuote`), `src/lib/project-summary.ts`,
`src/lib/project-wide.ts`, `src/app/api/projects/[id]/project-wide/route.ts`,
`src/components/projects/ProjectWideCard.tsx`, `src/lib/checklist-sections.ts`,
`docs/plans/catchup-2026-10-12.md`

The pilot walk of 2026-10-12 found TGQ meaning four different counts on one
project. One item read 44 on the phase table and 20 on the fill-in screen,
and Matthew quoted both. A stool said "2 missing" over an empty list, because
both questions were in the folded project-wide card. "Ready to quote 1" was
the one item with NO category. Max's ruling is the rule:

- **An item's TGQ = its outstanding questions whose tier is `to_quote`, of
  ANY kind (`spec_field` or `readiness`), MINUS the project-wide section.**
  `inItemTgq` is that sentence. Every TypeScript screen counts through it, and
  `project-summary.ts` says it again in SQL, held equal by
  `tests/db/project-summary.test.ts`. Do not count by `requirementKind`. That
  was the second rule, and on Matthew's matrix it drops readiness rows that
  ARE TGQ.
- **What a chase ASKS is a narrower set, and the screen says so.**
  `inChaseAsk` = the item's TGQ, `spec_field` only (decision 19). The record
  header sentence (`chase-counts.ts`) states each part.
- **A question's TIER is untouched.** `questionTier` and the tier stored on
  `email_draft_items` are what they were. This changes what is COUNTED, and
  re-tiering would stale every unsent draft (the `chased_at` trap).
- **Project-wide questions are answered ONCE, on the project** (Stage 2.8
  step 2). The overview's card lists each distinct question once, keyed the way
  `groupByQuestion` keys one. Saving writes the answer to EVERY active record
  that asks it.
  - **No project-level answers table.** It is still one `spec_answers` row
    per record, which is what the export, gates, chase coverage and history
    read.
  - **The route re-derives the set under the project lock**, row for row and
    version for version, and refuses WHOLE if it moved.
  - **Missing and TBC rows are written.** A settled answer with a DIFFERENT
    value is listed unticked, and replacing it needs a tick and a reason (or
    an open change).
  - **One change set, one version per record.** `spec_records.version` is
    untouched. A dimension is refused: it is per item, always.
- **They still block every quote.** `readyToQuote` = categorised AND the
  item's own TGQ is 0 AND no project-wide TGQ is open on it. The gate panel
  shows a project-wide field as "answered once on the project", and the
  verdict still waits for it.
- **A count opens onto its questions.** The checklist's TGQ filter lists the
  item's own questions. The project-wide ones sit on their own tile and line,
  one click away. The tab label says "n open" (it read "47 / 50", which looked
  like 47 done).

**Where Matthew wrote a matrix, the item's TGQ is the GATE's count** (Max,
2026-10-13: "it should show the 7"). `itemTgq` (`src/lib/item-tgq.ts`) is
the one function that returns the number AND the rows behind it. On a matrix
category it is the TGQ gate rows still to answer, the `summariseGateRows`
buckets chase + details + readiness + slot. That includes a dimension SLOT
the composed cell hides (the stool's `D460 x H450mm` answers its Dimensions
question while W and SH are open) and the record-column rows no checklist asks
(Designer reference, Spec notes). Project-wide rows stay apart and
`unanswerable` stays out, so the stool reads 6 + 1 project-wide. Elsewhere it
is `inItemTgq` over the checklist questions. The gate is never judged in SQL:
the overview's matrix half is totalled in TypeScript (`item-tgq-load.ts`),
and `tests/db/item-tgq-totals.test.ts` holds totals equal to lines.

**Every total counts every matrix record, not only those with a question**
(audit F7, 2026-11-06). A matrix item with every question answered and W and
SH empty has no row in `loadOutstanding`, so it counted on the overview, was
absent from the chase and fill-in totals, and had no line to open.
`totalItemTgq` (the chase header) and `countWithItemTgq(…, lineId)` (a chase
or fill-in line) count it; `MatrixItemTgq.lineId` says which line it is on;
`contacts-outstanding` counts by `itemTgq` too. Files: `src/lib/chase-grouping.ts`,
`src/lib/item-tgq-load.ts`, `src/lib/infill.ts`.

### TGQ is one name over two models, and which applies is per category

`src/lib/tgq.ts` (`questionTier`, `TgqMatrix`), `src/lib/gate-load.ts`
(`loadTgqMatrices`), `src/lib/chase-drafts.ts` (`loadOutstanding`),
`src/lib/project-summary.ts`, `docs/plans/matrix-assumptions.md`

Two models answered "does this block a quote" and nothing reconciled them, so
the same sofa read **48 needed to quote** in the spec table and **6 outstanding**
in its own TGQ gate panel. Found on 2026-09-18 while wiring the overview's
numbers; settled the same day.

- **`spec_field_gates` (0026) is what Matthew actually WROTE** — 35 fields
  across three gates for his nine seating categories. Where it covers a
  category **it is the answer**, because it is the only written gate model that
  exists.
- **`requirements.tgq_levels` (0019) is the placeholder that predates it**, per
  question and per level, still seeded with all three levels on all 728 rows. It
  stays as the **fallback** for every category his matrix does not reach — the
  eight cabinetry sheets, until he writes that half.
- **Both are called TGQ on screen.** They are the same question, and two names
  for it is how a reader comes to believe they are two measurements.

Five things are load-bearing.

- **Absence from the map is the discriminator, never an empty set.**
  `loadTgqMatrices` returns a `Map` keyed on our category id; a category missing
  from it means "he has not written this one, use the placeholder". A category
  he DID write that happens to carry nothing at TGQ is **present with an empty
  set**, because "nothing here blocks a quote" is a real answer and a different
  one. Defaulting an unmapped category to the empty set would report every
  cabinetry item quotable — not ready, unwritten — which is the
  confidently-wrong failure `gatesForRecord` already refuses by returning null.
- **A question reaches his matrix by BWS field OR by local key**, the two homes
  `spec_field_gates_field_or_local` allows. The readiness questions
  (`db/seed/0009`) are how the four id-less rows of his matrix are answerable at
  all, so leaving `local_key` out would silently drop them from TGQ.
- **A mapped category needs NO level.** His matrix has no level column, so
  `questionTierOrNull` answers for a level-less record there and a chase for it
  is not blocked: `groupByContact` blocks on `tier === null`, never
  `level === null` (audit F1, 2026-11-06 — it tested the level and blocked
  every seating record without one behind "no level on the record"), and the
  chase screen's level panel lists placeholder categories only. A blocked row
  carries a `kind` (`nobody_to_ask` | `no_tier`) and the screens match on it,
  never on the words. The fallback still refuses a null level, and the level
  still picks the BWS boilerplate — so the spec table's "No level" row says
  what it is needed FOR rather than claiming it is missing from the TGQ figure.
- **One implementation, and the SQL copy is the risk.** `loadOutstanding` calls
  `questionTier` once for the spec table, the chase screen, the generate and edit
  routes and the email; the record screen is handed the matrix as DATA
  (`tgqMatrix` on the record payload, null for an uncovered category) so it runs
  the same function rather than being told a verdict. `project-summary.ts`
  necessarily re-expresses the rule in SQL — the driver cannot share a fragment —
  which is the `loadExportScope` situation again and needs the same guard.
- **The join is `loadGateContext`'s, unchanged**: the union rule, where our
  sheet receives a field if ANY of his categories mapped to it carries it. Two
  copies of that join is how the TGQ column and the TGQ gate start disagreeing
  again, which is the defect this closes.

**Measured on the sandbox, 2026-09-18.** AP364c: 1,899 → **167** to quote, 39 of
39 categorised records on his matrix, so no caveat is shown. P17231: **230**,
with 47 on his matrix and **12 on the placeholder**, and the card says so in
words. The counts the two models produce are still not directly comparable —
the gate panel counts FIELDS and the checklist counts QUESTIONS, and a dimension
is settled by its attribute rather than by the composed answer — but they are
now the same model, in the same order of magnitude, and they move together.

**STILL OPEN, and unchanged by this:** the TGQ workbook has never been applied,
so the fallback half is still "everything blocks a quote". The cabinetry matrix
has not been written. And the nine-categories-to-seventeen-sheets mapping is
still Max standing in for Matthew — `docs/plans/matrix-assumptions.md`.

### A level is guessed at intake, and a guess is not a level

`db/migrations/0025_level_suggestion.sql`, `src/lib/level-guess.ts`,
`src/lib/confirm-boq.ts`, `src/lib/record-category.ts`,
`src/lib/variant-create.ts`

0019 gave a record a level and nothing to set it with but the record screen and
the drafts blocker, one at a time — so a 59-line bill arrived as 59 records
reading "Set level", and every chase stayed blocked. Asked for directly on
2026-09-17: guess it, per bill line, and always flag it.

**`spec_records.level` is untouched and still means a person's decision.** The
guess lives in `level_suggested` + `level_suggested_reason`, which every
existing reader ignores for free — `questionTier`, `chase-drafts`,
`/api/records`, `SpecTable`. No clause anybody forgets can let a guess satisfy
the quote gate. 0025 refuses a row holding both, and refuses a suggestion with
no reason.

- **The rules are this repo's judgement.** All 17 cheat sheets were searched on
  2026-09-17 and not one contains the words simple, complex or hero. The only
  written basis is the BWS boilerplate names — `Simple`, `with Metalwork`,
  `Hero` — so metalwork reads complex, the document's own word reads hero, and
  everything else is simple. It belongs on the list to confirm with Matthew,
  beside the question-to-BWS-field mapping. It never reads the AREA:
  *Signature Suites* is a floor.
- **The bill now, the drawings later.** `guessLevelFromAttributes` runs after a
  drawings confirm, where a brass leg first appears — and it never returns
  `simple`, because "this page named no metal" is not evidence that the item
  has none. It writes only where `level` is null.
- **The confirm writes one column or the other.** `chosen` in the review
  table's Level column fills `level`; anything else fills `level_suggested`. A
  revision fills a gap and never overrides a level that is already there.
- **A configuration inherits it**, decision as decision and suggestion as
  suggestion — `ensureVariant` copied neither, so a split hero item produced
  level-less children blocking a chase for a decision taken one row up. The
  quantity still does not come down: the bill says 45 and never says how many
  are fabric A.
- **Accepting is one click, and it can cover a run.** `acceptSuggestedLevels`
  writes every suggestion under ONE `level_set` change set, because 59 records
  must not mean 59 visits. It accepts only what is already suggested — a record
  with none is untouched.
- **A pre-filled select cannot be the accept control.** A select showing
  "Simple" fires no change event when somebody picks Simple, so agreeing would
  silently do nothing. Every accept is its own button.
- **A level can be set on the drawings card too** (2026-09-20, Stage 1b item
  1.15): the item card and the configuration card carry a LEVEL panel — the
  suggestion with its reason as a `SuggestButton`, and *Change…* opening three
  BUTTONS — writing `spec_records.level` through the existing levels route
  (which now also accepts `recordIds` + `level`), ONE `level_set` change set
  per click, one write per record of a fan-out ("sets the level on 3
  records"). The card's confirm request never carries a level, so the two
  writes cannot be confused, and a level never blocks a card.

**A suggestion does not move the record's version** (0051, audit D4,
2026-11-06). `spec_records_bump_version` has a WHEN clause and fires only when
a column other than `level_suggested`, `level_suggested_reason`, `updated_by`,
`updated_at` or `version` changes. The drawings confirm revising a suggestion
(a page that names brass) used to bump the version and stale every unsent
chase draft on the record, while this file said the version was untouched. An
update that changes nothing no longer bumps either; a new column bumps by
default.

**A bill line's CATEGORY follows the same rule as its level** (audit G8, Max
2026-11-06). The review's select was pre-filled with the suggestion and the
confirm wrote it whatever `categoryStatus` said: the level-picker trap, and a
guess nobody looked at became the record's category and created its checklist.
The staging's guess carries its evidence (`categoryReason`, from
`suggestCategory`) and renders as a `SuggestButton` in `BillCategoryCell`; the
select stays empty until a person picks; `categoryToWrite`
(`src/lib/bill-category.ts`) is the confirm's only reading, and a category is
written only where `categoryStatus = 'chosen'`. A guess nobody accepted
confirms with no category and no checklist, as an unsuggested line always has.
"Accept all suggested categories on this tab" is one press per tab. `qa:demo`
accepts its guesses before confirming.
