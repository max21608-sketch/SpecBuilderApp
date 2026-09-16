# Project Spec Builder — project instructions

A persistent, structured, auditable **specification record** that starts at
tender/BOQ stage and survives to delivery. It replaces re-keying the same facts
between BOQ → costing sheet → Word → the BWS quote freetext → BWS job spec
fields, where every hop loses provenance and invites divergence.

The primary user is the KAM / sales-support role who holds this knowledge in
their head and in spreadsheets today. Optimise for their vocabulary and their
ability to review consequential actions. Never silently replace a human
decision with automation.

Company-wide standards live in `house/`, copied in unchanged and **not restated
here**. Read `house/conventions.md` before your first change in a session.

## Keep the two instruction files identical

`CLAUDE.md` and `AGENTS.md` must be byte-for-byte identical. Apply every change
to both in the same task and run `cmp -s CLAUDE.md AGENTS.md` before reporting
completion. IMPORTANT: during parallel agent work, both files belong to exactly
one agent.

## Commands

| Command | Notes |
|---|---|
| `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` | the four checks |
| `npm run db:migrate` | applies every pending file in sorted order, ledger-backed |
| `npm run db:seed` | re-seeds the requirement matrix and vocabularies |
| `npm run db:backup` · `npm run db:restore` | backups write **outside** the repo by default |
| | every `db:*` script loads `.env.local` if present, prints the resolved host, and refuses production without `--yes-production`. Production names its own env file: `node --env-file=.env.production db/run-migrations.mjs --yes-production` |
| `npm run db:backfill-answers` | one-off: fills checklist answers from attributes confirmed before promotion existed. Dry run unless `--apply`; safe to re-run |
| `npm run db:backfill-snapshots` | one-off: gives every record that predates 0012 a version 1 under a `history_begins` change. Dry run unless `--apply`; safe to re-run |
| `npm run db:backfill-finishes` | one-off: builds each project's finishes library from the codes its drawings carry, and links them. Dry run unless `--apply`; safe to re-run. Leaves a code whose items disagree blank, and names it |
| `npm run db:qa-clean` | sweeps what a failed database-tier test run left behind. Refuses production outright |
| `npm run create-user` · `npm run hash-password` | there is no self-signup |

Tests run in three tiers — pure / db-gated / route. The database tiers skip
without `DATABASE_URL`, which is the correct state for pure-library work.
Database scripts print the resolved host before acting; read that line.

## Hard approval gates

A human confirms each of these, and nothing else may write it:

- Confirming an extracted spec value into `spec_answers`. Extraction stages;
  only a human confirm writes. **One confirm may write more than one row:**
  confirming a drawing card also fills the checklist answers its attributes
  answer (`src/lib/promote-answers.ts`). The gate is that no extracted value
  reaches an answer unseen, not that each row needs its own click — a reviewer
  who has just checked `W1900 x D790` against the page is transcribing, not
  deciding, when they retype it.
- Confirming drawing specs into `record_attributes`, and preamble notes into
  `project_notes`. Same rule, two more staging shapes.
- Producing the BWS CSV export.
- Sending any chase email. Drafts only, sent by a human from their own Outlook.
  There is no send path in this app.
- Marking a gate (TG0/TG1/TG2) satisfied for a record.
- Accepting a VE alternative, which changes which version is live.
- Retiring a spec, a record or a run, and editing a confirmed finish. Each
  destroys or overrides something a document said or a person decided, so each
  requires a REASON and none can happen automatically. Retiring is never
  deleting, and every one of them is reversible.
- Pairing a revised BOQ line with an existing record. The reviewer decides it
  at review time and the confirm writes only what they submitted — a code that
  is ambiguous pairs nothing.

## Hard invariants

Each of these is a trap, not a preference.

- **BWS is read/download only, forever.** The CSV export is a file a human
  uploads to BWS. Nothing in this app writes to BWS, including the AI mirror at
  `bws-next-ai.whistlercloud.com` — its changes being discarded nightly is not
  permission.
- **The BWS import is a replacement, not a merge.** The export route must
  always emit the **complete dataset** for the quote/job set, never a delta. A
  partial export silently wipes every field it omits. Enforce it in the route
  and state it in a test. This is the most dangerous operation in the product.
- **`TBC` is a real, distinct state** from missing and from N/A. At TG0 "Design
  to suggest" is an acceptable dimension answer and `TBC` is not — so gate rules
  read `spec_answers.state`, never the presence of a string. `NAME_DENYLIST` in
  `src/lib/matching.ts` also contains `"tbc"`; that is entity-name matching and
  a different meaning. Do not merge them.
- **A BOQ tab is a RUN, not a revision.** `MUR`, `MAIN RUN` and a
  value-engineered run quote the SAME codes at DIFFERENT quantities and can all
  be live at once, so they are `spec_runs` rows with their own records —
  never `spec_answers.revision_no`, which is for a VE alternative to one
  ANSWER (M6). `spec_records.run_id` is `not null`: a record on no run is on no
  tab and in no export scope.
- **The export is never filtered.** `/api/projects/[id]/export` accepts only
  `runId` and `format` and 400s on anything else, because a BWS import replaces
  rather than merges. It is also **not an import file**: it carries no `Id` and
  no `Job Number`, which this app has never known.
- **VE rounds preserve the original.** Original spec, VE alternative, client
  accept/reject with date; the accepted version becomes live.
- **Suppliers by modelled Capsule ID**, never free-text name. **STILL UNMET,
  and knowingly:** `project_finishes.supplier_raw` is free text, because there
  is no supplier register in this app and no Capsule data in this repo. The
  `_raw` suffix is the marker that it is what a document said rather than
  something resolved.
- **The finishes library is project-scoped.** The same client material code
  (`MOR005`) means different things on different projects. `project_finishes`
  (0018) is unique on `(project_id, code_norm)` for that reason; scope anything
  like it the same way or the data is silently wrong.
- **Client ref is the pre-sale primary key** (`SX11A`, `FU-209-15`) — a modelled
  field, not free text. One client ref can split into several BWS jobs.
- **A drawing dimension's unit is never inferred from ONE figure's size.** The
  AP364 pages mix centimetres and millimetres and state neither. A wrong unit
  reads as a real measurement and nothing downstream questions it, so the unit
  resolves in one fixed order and stops: **printed on the page** (the Panther
  spec sheets do print it), then **the page's own figures agreeing**
  (`suggestUnit`, which abstains on a mixed page), then **the OVERALL figures
  agreeing** once `applyViewGuesses` knows which they are — which overrides a
  project default and nothing else — then **`projects.default_dimension_unit`**,
  then nothing, and nothing still blocks the card. A project is not more
  authoritative about a page than the page is, which is why the default is last.
  The third step was added on 2026-09-16 and it closed a live defect: a shop
  drawing's figures are mostly COMPONENTS (S-200 prints 5, 50, 110 and 125
  beside 840 and 790), so `suggestUnit` abstained on every page of the real set
  and the project default — `cm`, because the specification SHEETS are in
  centimetres — stood in. An 840mm armchair composed as `W8400mm`, and nothing
  flagged it, because a project default is not a guess the screen apologises
  for. The overall figures are the ones that carry a page's scale.
- **A dimension is one of five slots — W, D, H, SH, Dia — and nothing else.**
  `0011` makes `attr_group = 'dimension'` *mean* that. Everything else a
  document measures (`ARM HEIGHT`, `WIDTH SEAT`, an unlabelled figure off a shop
  drawing) is kept as a **note**, with its label, figure and unit intact.
  `normaliseDimensionSlot` matches the whole folded label, **never a
  substring**: a substring rule maps `WIDTH SEAT` onto the real width and
  `ARM HEIGHT` onto the real height, and both labels are printed beside the
  values they would destroy.

## The data model

Built by `0002`–`0006`. This table is the map; the migrations carry the
reasoning.

| Table | Notes |
|---|---|
| `projects` | BWS project (`P17231`), TOE key dates (nullable), shared inbox |
| `spec_runs` | A sub-quote, normally one BOQ tab. Name (editable), `source_sheet`, `boq_revision`/`boq_date` (**text**), `header_notes`. Retired, never deleted; two runs may share a name |
| `spec_records` | One per BOQ line. `level` (`simple`/`complex`/`hero`, nullable, a person's decision beside the category — nothing infers it). `run_id` **not null**. `record_no` is the human-facing identifier (`P17231-014`) and stays project-wide across runs; splits are `parent_id` + `depth` + `split_reason` **on this table**, capped at one level |
| `record_attributes` | What a document SAID about an item: group, label, value, `unit` (dimensions only), the client's own `material_code`, `spec_field_id`, `state` (`confirmed`/`tbc`), source run and page. Multi-valued, requirement-free |
| `project_notes` | The preamble, per requirement. NOT the chassis `notes` table, which is append-only by trigger and would make a mis-extracted note permanent |
| `intake_batches` | One delivery of documents. **No status column** — a batch's state is derived from its runs |
| `spec_record_refs` | Every ref an item carries, one row each: `boq_code`, `design_code`, `cos_code`, `compound`, `bws_job`. Unique **per record**, never per project |
| `spec_fields` | The BWS register: 56 fields, `json_id` as the key, `column_letter` positional and never joined on. **Owned externally** — see the `external-vocabulary-sync` skill |
| `item_categories` | The 17 cheat sheets, plus `requirements_authored` |
| `item_category_aliases` | The words a BOQ actually uses ("Sofa" → Armchairs/Benches/Stools/Sofas) |
| `requirements` | The cheat sheet as a checklist: `kind` (`spec_field`/`readiness`), `prompt`, `section`, `required_at_gate` (**null everywhere** until TG0/TG1/TG2 are authored), `tgq_levels` (0019: the levels at which the question blocks a QUOTE; all three on every row until Matthew's workbook is re-seeded) |
| `spec_answers` | Per record × requirement × `revision_no`: value, `value_raw`, state, source, confirmed_by/at |
| `email_drafts` / `email_draft_items` | A chase and the questions it asked, each with the context snapshot it froze and its `tier` (0020) |
| `intake_runs` | Staging for any document intake. Generic, not BOQ-shaped. `batch_id` groups a pack; `document_kind` selects the prompt, the tool AND the staged shape |
| `change_sets` | One entry in the trail (0012): who, when, why, the kind, and a link to the document or the uploaded email that caused it. Append-only; `closed_at` is the only column that may be set later |
| `record_snapshots` | A VERSION of one record (0012): `snapshot_no` per record, the export's own atoms, and the composed cells as they were that day |
| `baseline_members` | A named point's exact membership (0013). Materialised under the project lock, because transaction start time does not order commits |
| `project_finishes` | The project's finishes library (0018), keyed by the client's own code. Project-scoped: `MOR005` means different things on different projects |
| audit / notes | `audit_log` + `status_history` + append-only notes, from the chassis. `audit_log.change_set_id` (0012) says which change each row belonged to |

**Not built, deliberately.** `bws_job_links` (a job number arrives as a
`bws_job` ref until something needs dates on it); `gates` / `gate_status`
(nothing to read until the assignments exist). An empty table is a promise the
schema makes that the code has not kept.

`project_materials` WAS on this list and is now built, as `project_finishes`
(0018). The condition `docs/stack.md` set — "resolving codes is deferred until
extraction is producing them" — has been met since M2, and the pilot's finishes
schedule being confirmed absent makes edit-once-and-propagate the only
correction mechanism there is. The project-scoping invariant carries over
unchanged.

The requirement matrix is **seed data, not code.** Which fields a category
requires, and at which gate, comes from the cheat sheets, and those will be
replaced with better ones. A re-seed plus a migration must be the whole change.
If category rules become `if` statements, every cheat-sheet revision becomes a
code release.

## Load-bearing workflows

Invariants that are not obvious from reading the code, and that a
reasonable-looking change breaks silently. **Read the named files before
changing the behaviour they govern.** Add to this section whenever you discover
a constraint the hard way — the entry is worth more than the fix.

### The field grid is a screen layout, never a file layout

`docs/bws-spec-grid.md`, `src/lib/dimensions.ts`, `src/lib/bws-export.ts`

Matthew's grid re-orders the 109 export columns into colour blocks and shows
only the fields one project needs. It governs how screens group fields, and it
is **not** a description of the file. Applying it to the export — reordering the
columns, or emitting only the 36 — produces an import that wipes the 73 it left
out: the same trap as a filtered export, on the most dangerous file in the
product. The blocks therefore never *filter*; a field outside the grid still
appears, because a field nobody can select is a spec value nobody can record.

The one thing the grid does govern is **how a value is written**, and the
dimension rule is the load-bearing one: `W*** x D*** x H***mm`, millimetres,
unit once at the end, `SH***` appended, `Dia.***` replacing `W x D` on a round
item. `composeDimensionCell` is the single implementation — the export, the
record screen and the drawings review all call it, because a second one is how a
screen starts promising what the file does not deliver.

It **refuses to emit a number it could not derive**. A figure with no unit, or a
value like "approx 720-740", renders verbatim outside the millimetre group in a
bracket saying why. A guessed conversion looks exactly like a real measurement.
The cell is a SUMMARY; the long-form sheet carries every original value, unit,
slot and page, which is what makes a converted `W1900` re-checkable against a
page that says 190.

`Dia.` beside a `W` or `D` is a **conflict**, caught as a computed blocker and
named on the cell — cross-row, so no check constraint can hold it and a trigger
would fire mid-fan-out naming a row the reviewer never saw.

An overall dimension printed as ONE line (`80 x 70 x 90 cm`) is read by
`parseCombinedDimensions`, and how far it infers is the load-bearing part. A
printed prefix is the page speaking and is taken exactly. **Three bare figures
are read as W x D x H in printed order** — the only inference here the page does
not state — flagged `slotSuggested` so the card badges it amber beside the
composed cell, which is what makes a transposed order obvious in a second.
Everything else gets NO slot and becomes a note: two bare figures could be
W x H, W x D or Dia x H, four or more has no convention, and a line mixing
prefixed with bare parts would let the positional half inherit the explicit
half's credibility.

### The export and its check sheet load ONE scope

`src/lib/export-scope.ts`, `src/lib/export-check-sheet.ts`,
`src/app/api/projects/[id]/export/check-sheet/route.ts`,
`docs/plans/export-verification.md`

"Judged flawless by a human, read line by line against the pack" had no
artefact behind it. The check sheet is one line per record × field, each naming
the document and page its value came from, with **Pack says / Verdict / Note**
left empty for the reviewer. An empty Verdict column is the point: a sheet that
arrived pre-answered would be the app agreeing with itself.

Three things about it are load-bearing:

- **It is never filtered, for the reason the export is not.** A sheet covering
  a subset gets signed off in exactly the same words as one covering the file.
  "Just the populated cells" is the tempting version and it removes the only
  lines that can find a value the pack states and the export lost — a blank
  cell is the failure most worth catching. The sole omission is the 27 job
  columns that are blank BY DESIGN because they hold BWS-owned vocabularies,
  and they go so that 27 unanswerable questions per record do not teach a
  reviewer to tick without reading.
- **Both files load `loadExportScope`.** A record the check sheet never asked
  about must not be a record the export shipped, or a signed-off sheet is
  worthless. One loader is what makes that true rather than intended.
- **Provenance comes from the composer, not from beside it.**
  `composeRowCells` returns each cell with where it came from and `composeRow`
  is that list mapped to strings — one set of precedence rules, two views. A
  second copy is how a check sheet starts vouching for a value the file does
  not hold, which is the `composeDimensionCell` rule again.

A filled sheet holds real values off real drawings and **never enters this
repo**. What comes back is the finding — a code fix, an alias seeded from
verified wording, or a dated line in `docs/plans/README.md`.

### The spec record and its client ref

The client ref is the key the client, the BOQ, the FF&E schedule and the emails
all use, and it exists long before a BWS job number does. It is the natural
identifier of the pre-sale record but **not its key**: the pilot BOQ contains
`SX11A` twice with different quantities. So records carry a surrogate id plus
`record_no`, and every ref lives in `spec_record_refs`. One ref legitimately
becomes several jobs (a fabric split, a configuration split), which is why
`spec_records` carries `parent_id` and `split_reason` **on the row itself** — a
satellite table would allow a child with no split reason, or two parents. This
tool is the definitive client ref ↔ job number mapping; nothing else in the
business holds it.

### Gate rules read state, not strings

A spec value is `confirmed`, `tbc`, `missing` or `na`, and those are four
different things. `TBC` means a human actively said "not yet decided" — an
answer, and it blocks a gate. `missing` means nobody has looked. `na` means the
field does not apply to this category. A rule testing for a non-empty string
treats the last three as satisfied and reports a record ready for TG1 when it
is not.

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
- **A level is REQUIRED before anything is tiered.** `questionTier` does not
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

### TOE dates are calendar days, and must never become a `Date`

`src/lib/project-programme.ts`, `src/app/api/projects/[id]/route.ts`,
`src/app/api/records/route.ts`

`projects.order_date` / `specs_agreed_by` / `delivery_date` are `date` columns.
Both drivers parse a `date` into **local midnight**, and `toISOString()` then
renders the day *before* it in British Summer Time. Because the project PATCH
writes every column on every save, a read-modify-write that changed only the
client name moved all three dates one day earlier — silently, every time.

Select them as `::text` on every query that reads them, and compare days as
`YYYY-MM-DD` strings. `project-programme.ts` takes `today` as an argument rather
than reading the clock, so the comparison is testable.

**Overdue is computed, never stored**, for the same reason Waiting is: a stored
flag would bump the version M2's snapshots are taken against. And a **null
`specs_agreed_by` means "no programme", not "not overdue"** — both the overview
and the spec table must say so in words, or an empty programme renders as a
healthy one.

### A staged proposal is addressed by UUID, never by position

`src/lib/spec-document.ts`, `src/app/api/imports/[id]/route.ts`,
`src/lib/confirm-spec-document.ts`

The BOQ's staged lines are a fixed positional list, so an index is a stable
address. **Extraction proposals are not.** Reviewing one changes the set the
screen is filtering, so "the proposal at index 4" means a different row before
and after an Ignore. Every operation locates by `elem.id` in the live, locked
JSON.

Reviewed proposals **stay in `lines`** with `reviewStatus` flipped. Keeping them
removes array compaction, a second reviewed array, an inverted restore guard,
and restore-by-reinsertion, all at once.

Each proposal carries **its own version**. The run's coarse version is bumped by
every autosave on every row, so predicating an edit on it would make two people
editing two different rows conflict for no reason.

**Blockers are computed, never stored.** A retarget clears an overwrite
acknowledgement, and a duplicate-target clash appears and disappears as other
proposals move — so a blocker frozen into the JSON at extraction time is stale
by the first edit, and the screen and the confirm route would then disagree
about whether a card can commit. `proposalBlockers()` is called by both.

### A BOQ has tabs, and each tab is a sub-quote

`src/lib/boq-import.ts`, `src/lib/confirm-boq.ts`,
`db/migrations/0007_intake_batches_runs_attributes.sql`

`parseBoqSheets` returned on the FIRST sheet with a header and dropped the rest
with no warning anywhere — so a three-tab bill imported as a clean third of
itself. Every sheet with a header is now staged, and each non-ignored one
becomes a `spec_runs` row at confirm.

The per-level columns (`L1`..`L6`) are deliberately absent from the header
synonyms. They are quantities, and a bill that read `L1` where `qty` belonged
would order 3 sofas instead of 14.

Rows above the header carry the revision, the date and the terms the run is
priced under. A client template writes `Revision:` in one cell and `0` in the
NEXT one, so the reader handles the split form as well as the inline one. Both
stay **strings**: parsing "14-Sep-26" into a `date` hits the TOE-dates trap for
a value nothing computes with.

### One drawing, several runs: the item card is the unit of commit

`src/lib/drawing-document.ts`, `src/lib/confirm-drawings.ts`

There is ONE drawing of `S-100`, and the mock-up, main and VE runs all quote it.
So a code matching one record **per run** is a FAN-OUT and the confirm writes to
all of them; the reviewer unticks a run whose spec genuinely differs. The same
code matching TWO records in ONE run is the `SX11A` case and stays **ambiguous**
— candidates offered, nothing chosen. A matcher that ignores runs cannot tell
those two apart, which is why grouping by run is the whole of the function.

The card the reviewer reads is therefore the ITEM, not the record, and that is
what commits atomically. This is the same rule as "the record is the unit of
commit", not an exception to it: never commit a card somebody did not see whole.
A page written to two of its three runs looks finished and is not.

`spec_records.version` is **not** touched by any of this. An attribute is its
own row; bumping the record would invalidate every extraction snapshot and chase
coverage row taken against it, for a reason that has nothing to do with them.

### Register-free kinds resolve at READ time, not in the worker

`src/lib/extraction-run.ts`, `src/app/api/imports/[id]/route.ts`

A spec-document proposal needs a target SNAPSHOT (the existing answer's id,
version and value) so the confirm can tell that somebody edited it underneath
the reviewer — which is why that pipeline resolves inside the worker.

A drawing observation and a preamble note both become NEW rows. There is no
prior value to snapshot and the model output depends on no register at all, so
resolution is a pure function both the GET route and the confirm route call, and
neither stores the result. Two consequences worth stating:

- **A drawing set may be extracted before its BOQ is confirmed.** That is a
  normal order of work, not an error. The raw output stays valid; confirming the
  bill and reloading resolves everything with no second model call.
- **A target that APPEARS between page load and confirm refuses the request**
  (`targets_changed`). The reviewer's ticked and unticked lists are both stored,
  so a record they never saw is distinguishable from one they deliberately
  dropped.

### An attribute carries through to the checklist automatically

`src/lib/promote-answers.ts`, `src/lib/confirm-drawings.ts`,
`src/app/api/answers/[id]/route.ts`

`record_attributes` is what a document SAID; `spec_answers` is the checklist.
Nothing connected them, so the Panther sofa showed `W1900 x D790 x H720 x
SH440mm` on screen while its Dimensions *question* sat empty — the summary is
computed for display and no answer was ever written. Confirming a drawing card
now fills the answers its attributes answer, in the same transaction.

Four rules, each a trap rather than a preference:

- **A `tbc` attribute becomes a `tbc` ANSWER, never confirmed**, and a cell
  carrying no digit is never confirmed whatever the attribute said. The sofa
  records four dimensions as TBC and a fabric code reading `TBC – Yarn
  Collective…`; promoted as confirmed, a gate reports satisfied over values
  nobody has decided.
- **A person's answer is never overwritten.** Only an answer still `missing`,
  or one a SHOP-DRAWINGS run wrote, is touched. `source_kind = 'document'` is
  not enough on its own — `confirm-spec-document.ts` writes that too, so
  matching it alone would let a shop drawing quietly beat an answer confirmed
  off an FF&E schedule. `/api/answers/[id]` marks an edited answer `'manual'`,
  which is what takes it out of reach for good.
- **The whole record is recomposed, not the card.** A card supplying only the
  height still recomposes the cell over the width and depth an earlier document
  confirmed, so the attributes are re-read from the table rather than taken
  from the confirmed set. Otherwise the answer says `H720mm` and the record
  says `W1900 x D790 x H720mm`.
- **`composeDimensionCell` is still the only composer.** A second
  implementation is how a screen starts promising what the file does not
  deliver.

A dimension does not reach its field by `spec_field_id` — it carries a SLOT,
and all five compose into BWS field 3 (`json_id`, never the column letter).
An uncategorised record has no questions, fills nothing, and that is not a
failure. Setting a category later creates the answer rows `missing`, and only
the next drawing confirm fills them — or `npm run db:backfill-answers`, which
runs these same functions over attributes already on record.

`source_id` records WHICH document a value came from, and for a composed cell
that is the last contributing slot: a cell built from three drawings has no
single source, and the newest is the one a reader would go and check.

### The record is the unit of commit, and a half-applied card is the failure

`src/lib/confirm-spec-document.ts`, `src/app/api/imports/[id]/confirm/route.ts`

One confirm request names ONE record and ALL of its currently pending assigned
proposals, with the versions the reviewer saw. The server checks that set
against the live grouping, so a proposal added or retargeted since the page
loaded refuses the request rather than committing a card the reviewer never saw
whole. Any failure rolls back everything: three finishes written and the fourth
refused looks finished, and the missing one is invisible until somebody notices
the answer is wrong.

`status = 'confirmed'` on an intake run means **no pending proposals remain** —
applied or explicitly ignored. Label it *Review complete*, never "complete":
settled answers are a different question. Restore accepts **ignored only**; an
applied proposal is immutable history, and undoing an answer is something a
person does on the record screen, on purpose.

### Registering a specification document SPENDS MONEY

`src/app/api/imports/route.ts`, `src/lib/extraction-dispatch.ts`,
`src/components/projects/IntakeBatchUpload.tsx`

It did not until 2026-09-15, and three file headers said so. Registration read
no body and cost nothing; pressing Read was a separate deliberate act, one
document at a time, with the charge on the button. A real pack broke that:
Panther is eleven documents and packs of thirty are expected, so the state
anybody actually wants — everything read — was reachable only by remembering to
click thirty times across eleven screens. Asking per document was ceremony, not
consent.

So an attempt is opened and published as each specification document registers.
**The upload screen states the count and the charge before anything uploads, and
that statement is where the human decision now lives.** A bill of quantities is
not part of it: a bill is parsed synchronously, by code, and no model has ever
touched one.

Three things about it are load-bearing:

- **`openAttempt` runs in the SAME transaction as the insert; the publish comes
  after the commit.** A run committed at `pending` with a message already
  published against it is a paid call against state that may not exist.
- **A registration returns 201 even when its dispatch fails.** The file is
  stored and the row exists either way, so the failure is recorded on the run —
  where the review screens already render it with a Retry — and reported as
  `autoRead` on the response. Failing the upload would tell somebody their file
  did not arrive when it did.
- **A replayed registration must not open a second attempt.** It returns the run
  it already made; publishing again spends one of only four deliveries.

`src/lib/extraction-dispatch.ts` holds commit-then-publish and the two publish
failure modes **once**, because the manual route and registration need the same
protocol and two copies would be two sets of rules about when a paid call may be
claimed twice. Nothing is retro-active: a document already at `pending` is read
by the pack screen's *Read all*, not by anything in registration.

There is still no rate limiting anywhere in the enqueue path — see the M8
outstanding notes.

### An extraction attempt is owned by two identifiers

`src/lib/extraction-claim.ts`, `src/lib/extraction-run.ts`,
`src/app/api/imports/[id]/extract/route.ts`, `src/lib/extraction-dispatch.ts`

`attempt_id` is a logical attempt; `claim_token` is one worker invocation inside
it. Both are needed: a hard-killed worker leaves a claim that expires, a later
delivery reclaims the same attempt with a NEW token, and if the "dead" worker
was only slow its writes must then match nothing. Every worker write is fenced
on `(runId, attemptId, claimToken)` plus the status it expects, and **zero rows
means ownership was lost** — stop; never escalate that into a terminal failure.

A live claim is a **busy** outcome and it THROWS. Acking a duplicate delivery
would spend the delivery that recovery depends on.

The extract route is **no longer the only way an attempt starts** — registration
dispatches one automatically. What remains manual is what automation cannot
cover: a document that FAILED, an attempt the queue never accepted, and an
attempt abandoned by a worker that died mid-run.

The timings are an inequality, not three knobs: model deadline < run abort <
`maxDuration`; claim expiry > `maxDuration`; visibility timeout > claim expiry.
`tests/lib/extraction-timing.test.ts` asserts each, against `vercel.json`. There
is **no exactly-once billing guarantee**; an ambiguous failure can cost a second
call, and the UI says so before a human restarts one.

### Never fetch a client-supplied URL with a store credential

`src/lib/blob-source.ts`, `src/app/api/uploads/token/route.ts`,
`src/app/api/imports/route.ts`

M1 took a `url` from the request body and fetched it with
`Bearer BLOB_READ_WRITE_TOKEN`. Being signed in did not make that safe — the
token is the store's, not the user's.

The fix is not a better URL check: it is never accepting a URL. A blob is
addressed by **pathname**, which the store resolves against its own host from
the token, so there is no host to influence and no redirect to follow.
Pathnames are scoped to `projects/<projectId>/`, and that scope is checked three
times — at token issue, at registration, and on every read — because a check in
only one of them is a check the other two skipped.

The import type is likewise **declared, never inferred**. A BOQ and an FF&E
schedule are both `.xlsx`; a file extension identifies bytes, not a workflow.

### A page the reviewer will dismiss must not cost what a page costs

`src/components/imports/DrawingItemCard.tsx`, `src/lib/drawing-document.ts`

Two shapes arrive on every specification sheet and neither is a fact anybody
has to decide.

**A page with no item code is still an item.** The model is told to record an
absent reference as null rather than guess whose page it is, so a second page
of views, a legend or a cover sheet stages as a card of its own — and that card
can never commit, because no code means no resolved runs. It is therefore
COLLAPSED on arrival, to a summary line, and carries one button that ignores
the whole page instead of one Ignore per row. It is never dropped: dismissing
it is a reviewer's decision, taken once. The `no_targets` blocker and the
review screen's banner both say the true reason — confirming the bill of
quantities will never match a page that carries nothing to match on.

**The lines a sheet prints under one heading are ONE row.** The Panther sheets
stamp each line of their general conditions with its field (`REMARKS:`,
`SUPPLIER:`, `REQUIRED SUBMITTALS:`), and fifteen REMARKS rows bury the four
facts on the page a reviewer actually has to rule on. `mergeNoteBlocks` joins
them: every line verbatim, in printed order, one per line inside the value, the
heading moved to the label. It runs at staging AND at read time — the block
takes the FIRST line's id and version, so the same staged JSON merges to the
same ids on every read, which is what lets the screen, the autosave and the
confirm route agree. Same discipline as `upgradeDimensionSlots`, for the same
reason: a pack read before this existed is reviewable without re-reading it.

The test is deliberately narrow — the staging label `Note`, no unit, no slot,
no BWS field, still pending. `ARM HEIGHT 520` is also a note, and merging a
measurement into a paragraph would destroy it. The merged state is the most
cautious of the lines it joins, so one unruled line leaves the block unruled
rather than inheriting a confidence none of them had.

A note is never ASKED for a unit: nothing blocks a unitless note, so an empty
amber select beside fifteen remarks reads as fifteen unanswered questions where
there are none. Where a note already carries one it stays editable, because a
wrong `mm` on `ARM HEIGHT` must be correctable without promoting the row to a
slot it does not belong in.

### A change is a change set; a version is composed, never copied

`db/migrations/0012_change_sets_and_snapshots.sql`, `src/lib/change-sets.ts`,
`src/lib/record-atoms.ts`, `src/lib/record-snapshot.ts`,
`src/lib/snapshot-diff.ts`

A record had no history anybody could read. `audit_log` has held whole-row
before/after since 0001 and `status_history` was written by six confirm paths,
and **nothing ever read either**.

A **change set** is who, when, why, and a link to the document or email that
caused it. A **record snapshot** is the composed state of one record after a
change, numbered per record — the user-facing "version". Both are side tables:
recording that something happened still never touches the row it happened to,
because `bump_version` would invalidate every extraction snapshot and chase
coverage row taken against it.

Five things here are load-bearing.

- **The link is a GUC, not a transaction id.** `openChangeSet` inserts the row
  and then `set_config('app.change_set_id', …, true)`; `write_audit()` reads it,
  so every audit row that follows carries its change without a call site
  remembering. `pg_current_xact_id()` was the obvious choice and is wrong:
  xid8 values do not survive `db:restore` into a fresh Neon project, so the
  join would start lying after a recovery. It only works inside
  `withTransaction`, which is why `PATCH /api/answers/[id]` moved onto it —
  one autocommitted statement cannot carry a GUC, and a person's edit would
  have been the one change with no version and no why.
- **Snapshots hold the EXPORT's own shapes.** `loadRecordAtoms` is the single
  loader for the export, the check sheet and a version, so `composeRowCells`
  runs over a snapshot unchanged. A history that described a record differently
  from the file would be worse than none, because it would be believed.
- **A diff runs over atoms, never over the stored cells.** The cells are kept
  for one question — "what did the file say on that date" — and
  `composeRowCells` changes, so a diff across two rule sets reports edits on
  records nobody touched. `diffSnapshots` recomposes both ends with today's
  rules instead. Everything is keyed by a stable id, so a value corrected in
  place is one changed line rather than a delete beside an add.
- **A baseline materialises its members** (`baseline_members`, 0013), written
  under the project row lock. "The newest version as at that date" is wrong:
  `created_at` is transaction START time, and two overlapping guarded
  transactions can commit in the opposite order, putting a version on the wrong
  side of a line somebody signed off.
- **A reason is asked for only when an edit OVERRIDES a settled answer.**
  `save()` fires on every blur, so a box beside every field asks twenty times
  and collects twenty rows reading "update". A reviewer instead OPENS a change
  ("Hayley's email of the 14th"), attaches the email, and every edit after that
  attaches to it — at most one open change per actor per project, by partial
  unique index.

**Append-only means refuse the rewrite, allow the cascade.** 0013, 0014 and
0015 each correct the same misreading: a version could not be deleted with its
record, a change set could not be deleted with its project, and — the one that
would have bitten a real database — a document that had caused a change could
never be deleted at all, because the FK's own `ON DELETE SET NULL` was refused
as a rewrite. Apply that rule to the next immutable table rather than
rediscovering it.

There is **no trigger refusing a write made outside a change set**, and that is
deliberate: every db-tier fixture and every hand fix with `psql` writes rows
directly, and a trigger refusing them turns a safety net into a wall across the
maintenance path. The guarantee is the coverage assertion in
`tests/db/change-history.test.ts`, which reads the WHOLE database: any change
set with spec-content audit rows and no version fails it. It has already earned
itself twice.

### A spec can be retired, and a revised drawing replaces one

`db/migrations/0016_attribute_supersession.sql`, `src/lib/attribute-retire.ts`,
`src/lib/confirm-drawings.ts`, `src/lib/promote-answers.ts`

`record_attributes` carried `status`, `retired_at` and `retired_by` from 0007
and nothing ever set them, while three blocker messages told a reviewer to
"retire the old value". A revised drawing therefore could not land: the partial
unique indexes refused the insert and the remedy did not exist.

- **Retiring recomposes the checklist.** This is the half that is easy to leave
  out and wrong to. Confirming a drawing writes the attribute AND the answer it
  fills; retiring only the attribute leaves the checklist reporting a confirmed
  fabric the record holds no statement for, and **the export still ships it** —
  a confirmed answer is exported whether or not an attribute backs it.
  `planAnswerRetractions` puts such an answer back to `missing`. A person's own
  answer is never touched, and the change records that it now stands on nothing.
- **The replace acknowledgement is per (observation, RECORD).** A card fans out
  one record per run, and the mock-up run's COM 1 may hold a different old value
  from the main run's — keyed on the observation alone, a confirm could retire a
  value the reviewer never saw on the VE record. The occupant's version is
  re-checked at confirm; one that changed since is refused, not replaced.
- **Retire before insert**, and the database decides that: both partial unique
  indexes are `where status = 'active'`, so the reverse order cannot commit.
- **Reversible**, per `house/data-safety.md`. A restore is refused when
  something else now holds the slot, or when a later drawing superseded it, and
  both refusals name what is in the way.

### A revised BOQ replaces the bill and keeps the drawings

`db/migrations/0017_boq_revision.sql`, `src/lib/boq-reconcile.ts`,
`src/lib/confirm-boq.ts`, `src/lib/run-retire.ts`

Confirming a revised bill used to create a SECOND run and a full second set of
records, stranding every drawing, spec, picture and answer on the first copy.
0007's header called retiring the old run "how it leaves the tabs", and nothing
could retire one.

A revision keeps the run's identity. A paired line writes the bill's own
columns over the existing record and touches nothing else, so it keeps its id
and everything hanging off it. A line with nothing to continue becomes a new
record. A record the revision no longer lists is **retired, never deleted**: a
record is the only place a client ref maps to a BWS job, and that job may
already exist.

- **The pairing is staged, and the confirm writes what the reviewer
  submitted.** Pairing a revised line to a record IS matching, which
  `house/data-safety.md` and `confirm-boq.ts` both forbid at confirm time. So
  `reconcileSheet` runs at review time, the reviewer edits it, 0017's v3 shape
  stores the decision, and the confirm re-checks the record is still on that
  run, active, and at the version shown.
- **One-to-one only.** A code on two records, or two lines carrying one code,
  pairs NOTHING — `SX11A` again. Candidates are offered; nothing is chosen.
- **A new line is in `carriedForward` too.** It is on the run from the moment
  it is inserted, and a retire step that subtracted only the PAIRED records
  inserted it and retired it in the same confirm. Caught by a db-tier test.
- **A record that would be retired names what it carries** — "14 specs, a
  picture" — because pairing it is usually what was meant, and a count does not
  say that.
- **`/api/records` filters to active**, with a toggle. It had no status
  predicate at all, so the moment anything was retired the spec table and the
  export described different sets — the disagreement the check sheet exists to
  prevent. `loadExportScope` also requires the RUN to be active.
- **Retiring a run asserts its own cascade.** `spec_records.status` does not
  follow `spec_runs.status` and no constraint can make it, so `retireRun`
  retires every record and then counts, before commit.

### The finishes library is the truth; the attribute is the evidence

`db/migrations/0018_project_finishes.sql`, `src/lib/finishes.ts`,
`src/lib/finish-edit.ts`, `db/backfill-finishes.ts`

`record_attributes.material_code` was a dead column: no index, no uniqueness,
no edit path at any stage, no way to ask which items carry a code. Ten items
sharing a fabric were ten unrelated strings. This is the register CLAUDE.md
excluded as `project_materials`; the condition `docs/stack.md` set for building
it — "until extraction is producing them" — has been met since M2, and the
pilot's finishes schedule being **confirmed absent** makes edit-once the only
correction mechanism there is.

`project_finishes` is project-scoped, because the same client code means
different things on different projects. The attribute keeps the drawing's exact
words so a value stays checkable against its page; the CELL renders the library.

- **`composeFinishCell` has three callers** — the export composer, the record
  screen, and `planAnswerFills`. If the export rendered the finish and the
  checklist kept the attribute's text, editing the library would change forty
  export cells while every visible row said something else. Same rule as
  `composeDimensionCell`, in a second place.
- **The state is the weaker of the two.** A `tbc` finish can never produce a
  confirmed answer, whatever the attribute said. The Panther sofa's drawing
  says `TBC – Yarn Collective Tessarae`: the library knowing what the code is
  does not make that item's fabric decided.
- **Normalisation is case and whitespace only.** `CH-01.1` and `CH-01-1` stay
  two finishes. A normaliser clever enough to merge them is clever enough to
  merge two codes a client meant to keep apart, and there is no way back.
- **`kind` is never inferred.** `classifyGroup` already guesses a group from
  words in a label; a second guess stacked on it produces a register full of
  confident mistakes.
- **A CONFLICT links nothing.** Where the library has committed to a
  description and a new drawing says something else, the attribute stays
  unlinked and shows on the finishes page as a code needing a person. Linking
  would make the item render the library's words while its own page said
  otherwise.
- **`supplier_raw` does NOT satisfy "suppliers by modelled Capsule ID".** There
  is no supplier register in this app and no Capsule data in this repo; the
  `_raw` suffix marks it as what a document said. That invariant remains unmet.
- **Swatches arrive by hand.** A person uploads one and must say which document
  and page it came from. Asking the model for swatch regions is a tool-schema
  change, which means re-reading and re-paying for every document already read.

### The UI must survive a response that is not JSON

Client code must not assume every API response is JSON. Check the status and
the content type, handle a parse failure, and show a useful fallback. Reset
loading and disabled state in a `finally` path, so an HTML error page, a
network failure or an unexpected payload cannot leave the interface frozen.
Exercise the error path in browser verification, not only the success path.
When a symptom is ambiguous, read the actual network response and the hosted
runtime logs before guessing at causes such as invalid credentials.

**A reload must not swallow the message that caused it.** A screen that
refreshes after every action clears its banner on a successful load, so
`setError(...)` followed by `await load()` showed a 409 for a few milliseconds
and then nothing at all — the card simply looked as though the click had not
registered. Reload first and report afterwards (`reloadThen` on both drawings
screens). The reload itself is still required: a refused request means the
screen is out of date.

### A page that labels its figures by VIEW can still be read

`src/lib/dimension-guess.ts`, `src/lib/drawing-document.ts`
(`applyViewGuesses`), `src/components/imports/PagePreview.tsx`

The real AP364 shop-drawing set labels its figures by the view they are drawn
on. S-200 carries twenty-four:

```
FRONT         110 100 460 125 240 420 520 720 50 5 840
SIDE          650 790
BACK          520 840
TOP           540 790 840
SIDE SECTION  540 720 300 460 650 790
```

`normaliseDimensionSlot` places none of them, correctly — "FRONT" is not a
width — so all twenty-four staged as notes and the item's Dimensions question
sat empty on a page that states its size four times over.

**The repetition across views is the evidence, and the magnitudes are not.** An
overall dimension is drawn on every view that shows it, which is a fact about
orthographic projection rather than about furniture: a WIDTH appears on the
front, the back and the plan (840), a DEPTH on the side, the section and the
plan (790), a HEIGHT on the front and the side and never on the plan (720). A
seat height is the largest remaining figure both elevations state, judged as a
FRACTION of the height — an absolute range would have to know whether the page
is in millimetres, which is the thing these pages do not say. Nothing here asks
whether a number is about right for an armchair; that is the reasoning that
turns an 8-metre sofa into a plausible one.

Four things are load-bearing:

- **It is a suggestion and it says so.** Every slot is `slotSuggested`, which
  the card already renders amber with the composed cell beside it — the same
  treatment `parseCombinedDimensions` gets for reading `80 x 70 x 90`
  positionally, and the reason the inference is allowed at all. The two must not
  claim the same reason: one is "this figure is drawn on three views", the other
  "these three were printed in order", and the card prints whichever applies.
- **All of them or none.** A page whose views share no figure, or that labels no
  view, or where the plan and the front disagree about the width, gets NO slots
  and a **key measurement dispute** — the message plus the page itself rendered
  on the card, because a question that is unreadable as a list of figures is
  answerable in two seconds off the drawing. Three slots filled and the fourth
  silently absent reads as a complete answer. A dispute is not a blocker: the
  card still commits, with the figures as notes.
- **It never second-guesses a placed row.** If any pending measured row on the
  item already carries a slot, the whole item is left alone. A guess that filled
  the gaps around somebody's decision would be a guess wearing their authority.
- **Read time, never written back**, like `upgradeDimensionSlots` and
  `mergeNoteBlocks` — which is what gave the eleven-document pack already staged
  in the sandbox all of this with no second model call and nothing charged
  again. Verified against that pack: S-200 `W840 x D790 x H720 x SH460mm`,
  S-201 `W660 x D685 x H680mm`, S-301 `W550 x D565 x H735mm`, the S-100
  specification sheet still in centimetres at `W1900 x D790 x H720mm`, and
  S-100's eight bare figures, UP-101 and S-400 left unplaced with a dispute.

### A link goes somewhere; a button does something

`src/components/ui/Button.tsx`

Underlined text is navigation — a project, a record, the source PDF a value came
from. Anything that CHANGES something is a button, whatever element carries it.
It had drifted: *Start a change*, which opens the trail every later edit on the
project attaches to, was grey underlined 14px text — fainter on the page than
the link beside it to a spreadsheet. Consequence is not emphasis, and a person
cannot tell an action from a link when both render identically.

`buttonClass` exists for the cases that must stay an `<a href>` — a download is
fetched by the browser — so they can look like the actions they are without
pretending to be a `<button>`. Four variants and no more: `primary` (one per
group), `secondary`, `danger` (destroys or overrides something a document said),
`quiet` (a per-row action in a dense table, bordered on hover, because forty
outlined buttons in a column is its own kind of unreadable).

**A panel that spans a table row is its own `<tr>`.** The drawings card's
replace-acknowledgement and blocker panels were extra `<td colSpan={7}>` cells
inside the SAME `<tr>` as the seven data cells, which makes that row 21 column
slots wide: the browser found room for the panels BESIDE the data and squeezed
the acknowledgement — the control that decides whether a confirmed spec is
destroyed — into a 100px ribbon of wrapped monospace. `divide-y` moved off the
tbody and onto the data row at the same time, or a divider draws between a value
and its own panel.

### A drawing shouts; the screen need not, and the file must not

`src/lib/shout.ts`, `src/components/records/SpecValue.tsx`

A specification sheet prints its general conditions in capitals and
`mergeNoteBlocks` puts a page of them in one row — the Panther bench's is about
1,800 characters. Rendered verbatim in a bare span its line breaks collapsed and
the row stood taller than the rest of the screen put together, with the
checklist and the history below it.

So a long value is CLAMPED and a shouted one is read back in sentence case.
Three things are load-bearing:

- **It is display only.** `softenShout` is never stored, exported, compared or
  sent to BWS. `record_attributes.value` keeps what the page said, the review
  screen's editable box keeps what the page said, and any screen that softens
  offers **As printed** beside it. Wiring this into `composeRowCells` or the
  check sheet would make the file disagree with the page it is checked against.
- **Only a SENTENCE is softened** — no lower-case letter in it, six words,
  thirty letters, and it ends in a full stop. Capitals are how a drawing writes
  a value, a name, a code or a list: `WOOD`, `TO BID`, `REFER TO JACQUES GRANGE
  DRAWINGS`, `FINISH SAMPLE, FABRIC CUTTING, STRIKE OFF`. That last one is long
  enough to pass a length test and is still a column of values, which is why the
  full stop carries the rule. `KEEP_AS_PRINTED` is an explicit list, not a rule
  about length: `TBC` and `ALL` are both three capitals and nothing cleverer
  than a list tells them apart. It cannot tell a proper noun from a common one,
  which is the known cost and the reason for the toggle.
- **The clamp cuts the STRING, not the CSS.** `line-clamp-4` needs
  `display: -webkit-box`, `whitespace-pre-line` needs a block box to honour the
  newlines, and the `block` utility written beside it wins — so the clamp
  computed onto a `display: block` element and did nothing at all, rendering
  full height and looking exactly like the bug it was fixing. Measured in the
  browser: 320px with the CSS clamp, 100px with `clampText`.

### A page that reported no picture proposes the page itself

`src/components/imports/ItemImagePicker.tsx`

The eleven-page Panther set came back with no view regions at all, the model
saying it could not fix exact crop boxes from what it had read. Those pages are
almost entirely picture — a reviewer drags a box over nearly the whole sheet —
so "no picture" was the one answer that was certainly wrong, and it was the
answer every card defaulted to.

A card with no reported view therefore proposes the WHOLE PAGE. That is not a
guess about what the item looks like: the page IS the drawing of it, the card
says "The whole page" in words, the crop renders in front of the reviewer before
anything is stored, and *Drag a box* and *No picture* are each one click — with
the whole page offered back afterwards, so *No picture* is not a one-way door.
It does not contradict the card's rule that nothing is pre-selected where the
answer is unknown: that rule is about spec VALUES, which get exported and quoted
against. A picture is an aid to recognising an item, and the reviewer is looking
straight at it.

## Load-bearing files

Read these before changing the behaviour they govern, and do not duplicate
their responsibilities elsewhere without a deliberate architecture decision.

- `src/lib/env.ts` — refuses to start when `APP_ENV` and `DATABASE_ENVIRONMENT`
  disagree. `db/script-env.mjs` is the same guard for command-line scripts.
- `src/middleware.ts` — the authorization boundary. `WRITER_ROLES` is an
  allowlist because the denylist version failed open on a mis-cased `"Viewer"`.
  Routes are default-protected with explicit public exceptions, so a forgotten
  new route fails closed.
- `src/lib/audit.ts` — the append-only audit trail and optimistic locking. Actor
  is passed as a column, never as connection session state: Neon's HTTP driver
  kills `SET LOCAL`, which is why `write_audit()` falls back to
  `to_jsonb(new)->>'updated_by'`.
- `src/lib/bws-export.ts` — the 109-column BWS layout as a static constant, and
  the composer. A test asserts its 56 spec ids equal the seeded `json_id`s,
  which is what catches a BWS column insertion: every letter after it shifts
  while the ids do not.
- `db/migrations/0001_foundation.sql` — users and role check,
  `schema_migrations`, `audit_log` + `write_audit()`, immutability triggers,
  `bump_version()`, polymorphic `attachments`, `pick_lists`, `status_history`.

## Stack

Next.js 15 (App Router), React 19, Tailwind 3 on Vercel (`spec-builder-app`,
functions pinned to `lhr1`); Neon Postgres in London, forward-only numbered SQL
in `db/migrations/` with a `schema_migrations` ledger; own users table with
scrypt hashes and a `jose` JWT in the `sb_session` cookie; Vercel Blob, private,
client-direct upload; Vitest.

**Active integrations:** Anthropic (M2 extraction) — a key is set in Vercel
staging and one verified call has been billed. Microsoft Graph read-only mailbox
ingestion (M5) is planned and disabled. The region pinning is deliberate: this
app handles NDA-covered client specification material, so keep any new service
in the UK.

## Read the focused document for the task

| For | Read |
|---|---|
| Company standards — non-negotiable, not app-specific | `house/conventions.md` |
| Trust boundaries, staged vs canonical, backups | `house/data-safety.md` |
| The six reporting terms and the release traps | `house/deployment.md` |
| How to write docs here | `house/writing-docs.md` |
| What runs where, and what this app deliberately lacks | `docs/stack.md` |
| Which deployment is which; the two naming traps | `docs/environments.md` |
| Incident triage, recovery, rollback | `docs/recovery.md` |
| External integrations: scope, setup, activation | `docs/integration.md` |
| The BWS field grid: blocks, order, and how each field is written | `docs/bws-spec-grid.md` |
| Accepting the export against the pack: the check sheet and its verdicts | `docs/plans/export-verification.md` |
| Releases, dated decisions, what is still open | `docs/plans/README.md` |
| Migrations, seeds, backups, restores | `db/README.md` |
| Chassis provenance and how to start another app | `docs/kit/` |

Task procedures live in `.claude/skills/`, mirrored to `.agents/skills/` — keep
the copies identical: `verify`, `new-migration`, `ship-to-staging`,
`queue-backed-job`, `extraction-pipeline`, `review-and-confirm`,
`email-draft-and-send-gate`, `external-vocabulary-sync`. If a skill goes stale,
fix it here and add a dated entry to `docs/kit/CHANGELOG.md` — a stale skill is
followed confidently, which is worse than an absent one.

## Reference material

`/Reference/` and `docs/docs for building/` are gitignored: real client
documents, read-only unless a task explicitly says otherwise. Real client
material — the BOQ, the BWS job export, the SharePoint cheat sheets — never
enters this repo, a fixture, or a seed. **The schema is what gets committed,
never a row.**

`docs/docs for building/P17231 SharePoint Index.md` maps the AP346 / Maybourne
Paris tree: where each source document is, which copies conflict, and what is
confirmed absent. Read it before assuming a document exists or that a given copy
is current. It is the survey that **deferred** that project — see the milestone
below.

The pilot pack is now **Project Panther**, curated by Matthew and read-only, at
`Enterprise/Shared Documents/Work Instructions/Projects/ap364-project-panther
p17726/Project Specs and BOQ`. Listed 2026-09-15: the seating BOQ
(`AP364 - Apx 2`, `.xlsx`), the shop-drawing set (`Apx 1a`) and nine
`SPEC-346` specification sheets (`S-100`/`S-101` sofa, `S-200`/`S-201`/`S-203`
armchair, `S-301` desk chair, `S-402` bench, `UP-100`/`UP-101` headboard). The
FF&E preamble (`Apx 1b`, Argenta) is part of the pack but was **not** in that
folder on that date. The point of a curated folder is that discovery is a
person's job, not the tool's: do not crawl the wider tree for Panther documents.

Never silently "clean up" an uncertain source value; retain or flag it.

## Current milestone and scope

A stale status section is worse than none, because agents and people both make
decisions from it. The full dated list is in `docs/plans/README.md`.

### M8 — the Panther pass. This is the milestone; everything else waits.

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

**Outstanding — judgement, not code.**

- **Nobody has used any of this.** The four checks pass with the database tier
  running; human acceptance is outstanding on every screen.
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
- **Nothing limits how many model calls a pack starts at once.** Registration
  dispatches a read per specification document, so an eleven-file pack is eleven
  concurrent workers and eleven concurrent model calls. There is no per-batch
  cap, no in-flight cap and nothing that sleeps: an Anthropic 429 is retryable
  but burns one of only four deliveries, so a rate-limited pack can reach
  `failed`. The client uploads and registers sequentially, which staggers
  dispatch by upload time — incidental, not a control. Watch the first real
  Panther delivery; a per-batch cap is the fix if it bites.
- **A combined line's W x D x H order is assumed, and a human has never checked
  one.** `parseCombinedDimensions` reads "80 x 70 x 90 cm" positionally — the
  only inference in the dimension model that the page does not state. It is
  badged amber on the card and the composed cell is shown beside it, which is
  the whole safeguard. Two bare figures, four or more, and a line mixing
  prefixed with bare parts all get no slot instead. Nothing has been through a
  real S-203 sheet yet.
- **No real drawing set has been through the model.** The prompts and schemas
  are written against the AP364 seating drawings but only synthetic fixtures
  have exercised them. One real extraction, compared against its pages by eye —
  expected vs extracted, misses, wrong values, wrong units — is what decides
  whether intake is usable. This is step 2 of M8, and the AP364 drawings it was
  written against are the pilot pack itself.
- **The export's job columns are this repo's judgement**: `Project Ref` is the
  project name, `Client` the client, `Name` the item description, `Item Count`
  the quantity, `Client Code` the BOQ refs. Confirm them against a real BWS
  import before anybody relies on the file.
- `requirement_aliases` is empty and attribute matching measured 1/7 on the M2
  sample; seed it only from verified pilot wording.

**Explicitly excluded, so they are not built speculatively:** feeding preamble
notes into later model calls; gap and completeness checking, and gates; a BWS *import* file carrying job numbers; PDF bills of
quantities; images and scanned documents; splitting an oversize drawing set. M5
inbox ingestion and M6 VE rounds. Any write to BWS. Automatic email sending.
SharePoint writes. BWS Messenger and Teams ingestion. The TOE calculator's own
logic. The post-order/production flow.

**Chase emails are back (2026-09-16), with a to-quote tier.** The screen is
restored with entry points on the projects list and the project overview, the
Waiting column and its derivation are back in `src/app/api/records/route.ts`
and `SpecTable`, and a **Needed to quote** column sits beside them. `GET
/api/drafts` now checks the session like every other draft route.

**Decisions awaiting the user:**

- **The gate model is unreconciled, and every requirement is seeded ungated.**
  TG0/TG1/TG2 in the handover, plus a proposed pre-sale **TGQ**.
  `requirements.required_at_gate` is null on all 728 rows and there is no
  `gates` table, so the completion view reports confirmed / TBC / missing and
  nothing per-gate.
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
  KAM / sales-support knowledge.
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

## Git

`staging` is the working branch and the deploy target. Commit and push completed
staging work without being asked, keeping commits scoped to the request — do not
sweep in unrelated untracked or uncommitted files, which belong to the user.
**Never create or push a production branch**, and never rewrite shared history
or run a destructive Git command without explicit approval. Production requires
authorization for that specific action, every time; see `house/deployment.md`.

## Before reporting completion

- Re-read the request; confirm every changed line serves it. Review `git diff`
  and `git status`, and leave unrelated user work untouched.
- Run the checks the change warrants, and do not claim one you did not run.
  Report human acceptance as outstanding until the intended user has done it.
- Confirm `cmp -s CLAUDE.md AGENTS.md` succeeds.
- State exactly what changed, what was verified, what was not, and the real
  deployment state in the six terms from `house/deployment.md`. A local commit
  is not a deployment.
