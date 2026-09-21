# Project Spec Builder — project instructions

A persistent, structured, auditable **specification record** that starts at
tender/BOQ stage and survives to delivery. It replaces re-keying the same facts
between BOQ → costing sheet → Word → the BWS quote freetext → BWS job spec
fields, where every hop loses provenance and invites divergence.

The users are **at least TWO roles, not one** (2026-09-18). The PROJECT
MANAGER loads the pack and reviews it, then takes the summary of what is
outstanding **to the CAM**, who fills in what they know, and only then does
anybody go to the client — a chase need not be external at all. Until that
day this file named one primary user, the KAM / sales-support role who holds
this knowledge in their head and in spreadsheets; that person is still the
one whose vocabulary the screens use and whose ability to review consequential
actions they are built for. A screen optimised for one person working alone is
optimised for the wrong thing. Never silently replace a human decision with
automation.

**Vocabulary: a sub-quote is a PHASE** (2026-09-19, Stage 1a — "Can we change
run to phase? Because that matches BWS"). On every screen and in every
document a BOQ tab is a *phase*. Three things keep the old word, deliberately:
the table `spec_runs` and its `run_id`; `runId` as the API word, the query
parameter and the `?tab=<runId>` link, because every link written before that
day points at one; and `intake_runs`, which is a DOCUMENT READ and was never a
phase — a screen describing one says *read* or *document*, never *phase*.
`tests/lib/vocabulary-guard.test.ts` reads the screen sources and fails on the
old word outside its allowlist. Where a load-bearing section below says "run"
it predates the rename and means phase, unless it says intake or document.

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
| `npm run checks` | all four in sequence with the DATABASE TIER REQUIRED (`REQUIRE_DB_TESTS=1`): a missing `DATABASE_URL` fails once, in words, instead of skipping 283 tests behind a green summary. Ends with `next build`, which clobbers a running dev server's `.next` — it says so first |
| `npm run db:migrate` | applies every pending file in sorted order, ledger-backed |
| `npm run db:seed` | re-seeds the requirement matrix and vocabularies |
| `npm run db:backup` · `npm run db:restore` | backups write **outside** the repo by default |
| | every `db:*` script loads `.env.local` if present, prints the resolved host, and refuses production without `--yes-production` and PILOT without `--yes-pilot` — the flags are separate on purpose. Each names its own env file: `node --env-file=.env.production db/run-migrations.mjs --yes-production`, `node --env-file=.env.pilot.local db/run-migrations.mjs --yes-pilot` |
| `npm run db:backfill-answers` | one-off: fills checklist answers from attributes confirmed before promotion existed. Dry run unless `--apply`; safe to re-run |
| `npm run db:backfill-snapshots` | one-off: gives every record that predates 0012 a version 1 under a `history_begins` change. Dry run unless `--apply`; safe to re-run |
| `npm run db:backfill-finishes` | one-off: builds each project's finishes library from the codes its drawings carry, and links them. Dry run unless `--apply`; safe to re-run. Leaves a code whose items disagree blank, and names it |
| `npm run db:qa-clean` | sweeps what a failed database-tier test run left behind. Refuses production outright |
| `npm run qa:fake-inbox` | invented correspondence for the inbox screen, recorded through the app's own `recordMessage` so the routing outcomes are real. Sandbox only, no production flag. Dry run unless `--apply`; `--clear --apply` sweeps it, keeping any message somebody has since assigned |
| `npm run qa:levels -- --project=<ref>` | makes up a level for every line item and a designer contact behind them, so the chase screen can be walked before anybody has decided either. Levels go through `setRecordLevel`; the designer code is a plain update, because nothing in the app edits what a BOQ said. Same guards, and `--clear --apply` puts it back |
| `npm run qa:demo` | a WHOLE invented project — bill, drawings, preamble, correspondence, finishes, pictures and a checklist worked up to ~83% — so the app can be walked through in front of somebody. Built through the app's OWN confirms, so what is on screen is what the app does; no model is called and nothing is charged. Sandbox only, no production flag. Dry run unless `--apply`; `--clear --apply` sweeps it (`like 'DEMO%'`). Takes ~15 minutes, nearly all of it the checklist. It also writes ONE document it does NOT load, to `demo-documents/`, so there is something to upload live |
| `npm run create-user` · `npm run hash-password` | there is no self-signup |
| `npm run dump:drawings -- --run=<id>` | read only: what a staged drawing run reduces to through the REAL read-time pipeline — measured rows, placed slots, folded rows, unit provenance, the composed BWS cell. Run it before and after a change to that pipeline; the diff is the change |
| `npm run vocab:gap` | read only: every label the staged documents carry, which route places it (slot / BWS field / question), what is left, and — the point — what a looser rule would have wrongly written instead. Run it before seeding `requirement_aliases`, and read the NEAR MISSES before adding one |

Tests run in FOUR tiers — pure / component / db-gated / route. The database
tiers skip without `DATABASE_URL`, which is the correct state for pure-library
work; the component tier (`tests/components/`, jsdom + React Testing Library)
runs always and is scoped by PATH in `vitest.config.ts`, never by a per-file
`@vitest-environment` docblock — a docblock is one line a new test file can
forget, and forgetting it fails with "document is not defined". Database scripts
print the resolved host before acting; read that line.

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
- Placing an INBOUND email on a project. It is what starts the charged read,
  and nothing is ever auto-assigned from an ambiguous routing outcome.
- Marking a gate (TG0/TG1/TG2) satisfied for a record.
- Accepting a VE alternative, which changes which version is live.
- Retiring a spec, a record or a run, and editing a confirmed finish. Each
  destroys or overrides something a document said or a person decided, so each
  requires a REASON and none can happen automatically. Retiring is never
  deleting, and every one of them is reversible.
- Pairing a revised BOQ line with an existing record. The reviewer decides it
  at review time and the confirm writes only what they submitted — a code that
  is ambiguous pairs nothing.
- Accepting a suggested item LEVEL. The app guesses one at intake and shows
  what it read; only a person's acceptance writes `spec_records.level`, which
  is the column the quote gate reads. One acceptance may cover a whole run —
  the levels and their readings are all on the screen — but nothing is
  accepted unseen.

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
- **A BOQ tab is a PHASE (a `spec_runs` row), not a revision.** `MUR`, `MAIN
  RUN` and a value-engineered phase quote the SAME codes at DIFFERENT
  quantities and can all be live at once, so they are `spec_runs` rows with
  their own records —
  never `spec_answers.revision_no`, which is for a VE alternative to one
  ANSWER (M6). `spec_records.run_id` is `not null`: a record on no run is on no
  tab and in no export scope.
- **The export is never filtered.** `/api/projects/[id]/export` accepts only
  `runId` and `format` and 400s on anything else, because a BWS import replaces
  rather than merges. It is also **not an import file**: it carries no `Id` and
  no `Job Number`, which this app has never known.
- **VE rounds preserve the original.** Original spec, VE alternative, client
  accept/reject with date; the accepted version becomes live.
- **Suppliers and people by modelled Capsule ID**, never free-text name. MET
  for contacts (`project_contacts.capsule_party_id`, 0022 — the link is
  optional and an unlinked contact is flagged, because a person Capsule has
  never heard of must still be chaseable). STILL UNMET for suppliers:
  `project_finishes.supplier_raw` is free text. Capsule is READ-ONLY here — one
  GET helper, no write verb, asserted by a test. **STILL UNMET,
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
  agreeing** — which since 2026-09-18 are the figures the MODEL placed, read at
  staging rather than guessed at read time, and which override a project default
  and nothing else — then **`projects.default_dimension_unit`**,
  then nothing, and nothing still blocks the card. A project is not more
  authoritative about a page than the page is, which is why the default is last.
  The third step was added on 2026-09-16 and it closed a live defect: a shop
  drawing's figures are mostly COMPONENTS (S-200 prints 5, 50, 110 and 125
  beside 840 and 790), so `suggestUnit` abstained on every page of the real set
  and the project default — `cm`, because the specification SHEETS are in
  centimetres — stood in. An 840mm armchair composed as `W8400mm`, and nothing
  flagged it, because a project default is not a guess the screen apologises
  for. The overall figures are the ones that carry a page's scale.
- **WHICH figure fills a slot is READ OFF THE PAGE, never sorted by size.** The
  model says, with the evidence it read it from, and a disagreement with the
  page's own printed label is flagged rather than settled. Sorting by magnitude
  recorded a sheet printing `80 x 70 x 90 cm` as a chair 900mm wide, and had
  decided 141 of 183 dimensions that way. See the load-bearing section.
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
| `spec_runs` | A PHASE: a sub-quote, normally one BOQ tab. "Phase" is the word on screen (2026-09-19); the table keeps its name. Name (editable), `source_sheet`, `boq_revision`/`boq_date` (**text**), `header_notes`. Retired, never deleted; two phases may share a name |
| `project_contacts` | Who to ask. `designer_code` joins `spec_records.designer`; `capsule_party_id` is the modelled person (0022), optional and flagged when absent |
| `spec_records` | One per BOQ line. `level` (`simple`/`complex`/`hero`, nullable, a person's decision beside the category — nothing infers it, and `level_suggested` (0025) is where a guess goes instead, where no gate can read it). `run_id` **not null**. `record_no` is the human-facing identifier (`P17231-014`) and stays project-wide across runs; splits are `parent_id` + `depth` + `split_reason` **on this table**, capped at one level |
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
| `spec_matrix_categories` / `spec_matrix_category_map` | Matthew's nine seating categories (0026) and which of our seventeen cheat sheets each one is. Many-to-many both ways; an unmapped sheet gets no gate view, which is a real answer |
| `spec_field_gates` | His decision matrix as a seeded overlay (0026): gate, capture, BWS field or `local_key`, `dimension_slot`, `applies_to`, palette, conditional. `matrix_row` is his own `#`, so a re-issued workbook diffs |
| `bws_boilerplates` | The 45 BWS product codes (0031), 18 of them mapped to one of Matthew's nine seating categories as a Simple/with-Metalwork pair. BW's own codes, not client material — the `spec_fields` precedent |
| `spec_palettes` / `spec_palette_options` | The closed lists a spec field offers (0030). Five are BWS-owned and seeded with ZERO options, which is the honest state |
| `spec_records.spec_description` / `.internal_notes` | 0028's two free-text columns. The first is quote-facing prose; the second never leaves this app. Neither reaches the 109-column grid |
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

**A person's ONE qualifier for the whole cell is a record column, composed by
the same composer** (`spec_records.dimension_note`, 0034, Stage 2 item 2.6,
2026-09-20). Matthew: *"1250 bracket L-shaped return"*. `composeDimensionCell`
takes it as its second argument and renders it LAST, `W1830 x D880 x H760 x
SH440mm (1250 L-shaped return)`, so the export, the quote's DIMS line, the
costing sheet's `Tags`, the record screen AND the checklist's Dimensions answer
(`planAnswerFills` reads the note; `editRecordDetails` recomposes when it
changes) all show one cell. It is NOT 0029's per-attribute placement — four
slots off three pages could carry four of those — and it is never an
attribute, because it has no page. One line, 200 characters, refused by the
route in words and by a CHECK; a note with no dimensions behind it is the
bracket alone with a `note_only` problem and writes NO answer, because a
sentence must not stand where a measurement goes; and `hasFigure` is read off
the figures WITHOUT the note, or "1250" in a note would confirm a TBC width.
The check sheet prints it in the Qualifier column, apart from the figures.

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

### The finishes library is set out from a list, not from a scan

`src/lib/finish-bulk.ts`, `src/app/api/projects/[id]/finishes/bulk/route.ts`

Matthew: "Project finishes I think are the way to go; set these out from the
outset, possibly loaded by scanning the finishes schedule." The first half is
built and the second is not, deliberately.

`finishes_schedule` has been a `document_kind` with its own prompt since 0007,
but the model's output shape (`RawProposal`) carries `attributeRaw` and
`valueRaw` and **no field for a finish code** — so pulling codes out of it means
parsing them from prose, which is the inference house/conventions §6 puts on
the far side of the fuzzy/exact line. Adding a code field to the tool schema is
the right eventual answer and **forces a re-read of every document already
read**: eleven billed calls for the Panther pack alone. A decision with a cost,
not an oversight.

So the half that needs no inference exists: a person pastes the codes, and
**preview always comes first** — which are new, which the project already
holds, and which repeat inside the paste. A box that silently created thirty
rows would be the opposite of the library's edit-once rule, where correcting
one code corrects every item carrying it. `kind` is still never inferred, so a
pasted code arrives filed as nothing.

### The quote file fills eight of twelve, and names the four it will not

`db/migrations/0031_bws_boilerplates.sql`, `db/seed/0010_bws_boilerplates.sql`,
`src/lib/quote-lines.ts`, `src/app/api/projects/[id]/export/quote/route.ts`

The second of Matthew's three outputs. It is **not** the BWS file: the
109-column export REPLACES a job's fields on import, which is why it refuses to
be filtered; this is a list of quotable lines with the specification written
out for a person to price. It shares `loadExportScope` and nothing else, so a
quote cannot cover a different set of records from the file.

- **Four columns stay blank and the screen says why.** There is no pricing
  anywhere in this app — no rate, no labour model, no material cost — and a
  generated number would be the first figure in the product nothing downstream
  could question. The UUID is BWS's; an item picture is a private blob BWS
  cannot fetch.
- **Nineteen of the real file's 57 lines cannot be generated at all** —
  interliner, stone, mattresses, delivery. The interliner line's quantity is
  the fabric METREAGE, and `composeFinishCell` deliberately does not hold it.
  Said in words on the screen rather than emitted as a row somebody prices off.
- **The Specification block uses the SAME composers as the export.**
  `composeDimensionCell` writes the DIMS line and `renderAttributeValue` the
  rest. A quote saying `W2860` where the BWS file said something else would be
  found by a client rather than by us. The labels are normalised: his own file
  writes `COM1`, `COM 1` and `COM` for one field.
- **An AMBIGUOUS product code derives nothing.** Matthew's rule is "MF1 or MF2
  populated → with-Metalwork, otherwise Simple", and the register is seeded
  from the 2026-09-14 capture — 18 of the 25 ids in his real quote match it
  exactly. But our `armchairs-benches-stools-sofas` is ONE sheet receiving
  three of his nine codes, so taking the first handed a **sofa the armchair
  boilerplate**. More than one code now derives nothing, the same rule as
  `findRecordsByRef` offering candidates and picking none. A blank is a visible
  gap; a wrong code prices the item against the wrong template.
- **"Populated" excludes a non-answer.** A metal finish recorded as `TBC` or
  `None` does not move an item onto the metalwork boilerplate and a different
  price. This repo's reading, and a question for Matthew.
- **None of the nine seating families has a Hero boilerplate**; six cabinetry
  families do. His rule says nothing about a hero sofa because there is no hero
  sofa code. Also a question for him.

### The costing sheet is TEN columns of eighty-three

`src/lib/costing-sheet.ts`, `src/app/api/projects/[id]/export/costing/route.ts`

The third of Matthew's three outputs, built 2026-09-18 against his skill.md,
its user guide and a REAL COMPLETED SHEET (Maybourne Paris seating, 69 items).

**The blocker this repo had recorded was the wrong one.** `matrix-assumptions.md`
said the costing sheet was blocked on the skill.md because "the app holds no
price of any kind and will not generate one". The skill generates no price
either: it adds page links, crops photos, converts imperial to metric and
deletes blank rows. Pricing was never what stood in the way.

`Estimating Sheet Template - with stone.xlsx` is 83 columns. A-J identify the
item; K rightwards is three identical estimator blocks whose median is taken,
then a stone block. **This export stops at J**, and that is the design rather
than a gap:

- **Emitting all 83 would produce a sheet that looks like the estimating sheet
  and prices nothing.** The template's value is its FORMULAS — exchange rate,
  multiples, GP targets, the median across three estimators — and this app
  holds none of the rates behind them. 73 empty columns where an estimator
  expects formulas is the plausible-looking wrong answer wearing a familiar
  layout. The BWS export's complete-or-nothing rule does NOT apply here: a BWS
  import replaces what it is given, and nothing imports the costing sheet — a
  person pastes into it.
- **A-J is contiguous, which is what makes the narrow file the useful one.** It
  pastes in as a block and columns K onwards keep their formulas. B is the
  template's own spacer and stays empty, or everything lands one column across.

**`Tags` carries the composed dimensions, and that is the point of the export.**
On the completed sheet that column holds a few real tags (`dining chair`) and,
on every other filled row, a measurement somebody pasted out of a drawing or a
designer's website: `Height: 91 cm\n- Width : 110 cm\n- Seat depth: 102cm`,
`H800mm x D635mm x W700mm SH480mm.`, `H 93 - L 47 - P 56 cm - seat H-53cm which
reduces by 3/4cm when seated`, `58 x 36 x 43cm`. Every trap the dimension model
exists for is in those four lines — cm and mm in one column with nothing saying
which a row is, `L`/`P` for longueur and profondeur, a qualifier welded to a
figure, and a bare triple whose order is an assumption. It is there because the
sheet had nowhere structured to put a size. `composeDimensionCell` is still the
single composer, so the figure an estimator prices against is the same one the
BWS file ships. **This is this repo's judgement, not Matthew's instruction, and
the file says so on its own second sheet.**

Four more things are load-bearing:

- **The links point at THIS APP'S copy, not SharePoint.** The app holds the
  document and `/api/imports/[id]/source` streams it inline with range support,
  so `#page=N` works. Where the file also sits in SharePoint this app has never
  been told, and composing a URL from a filename would resolve to a 404 or, far
  worse, to a different revision of the same drawing. The skill's own guide
  spends a page on getting that URL right, which is the cost of not holding the
  document.
- **NO PAGE MEANS NO LINK.** A hand-typed spec carries no source run and no
  page, deliberately. A link opening a document at page 1 to stand in would be
  a false provenance rather than a missing one.
- **Which page to link is COUNTED, not picked.** The (document, page) that
  accounts for most of the record's attributes goes first, ties breaking on the
  lower page so the order is stable between exports — an estimator who wrote
  down "Specs opens page 7" must not find it opening page 11 next week.
- **The quantity is never apportioned**, the 0024 rule in a fourth place, and
  the notes say how many rows it left blank.

The notes go IN the file, on an "About this file" sheet, not only on the screen
that produced the download: a caveat that lives on the screen is one nobody
reads at the moment it matters, which is when somebody opens the workbook next
week and wonders why column K is empty.

**Verified against the sandbox, 2026-09-18**, not fixtures: AP364c MAIN RUN
composed 19 rows with 11 carrying dimensions off the real shop drawings
(`S-100 W1900 x D790 x H720 x SH440mm`, `S-400 W570 x D493 x H473 x SH358mm`),
11 links into the real pack, 11 pictures, and `S-201 Armchair (A)` correctly
carrying a blank quantity. **`Specs 2` has never fired against real data** — no
record in the sandbox is yet specified across two pages — so it holds unit
coverage only.

**STILL OPEN:** what `Specs 2` should point at on the real sheet (a second
drawing set? the designer's own sheet?), and whether Matthew wants `Tags` to go
on receiving pasted prose once the app composes a real cell there.

### A palette this app does not hold is a row with no options

`db/migrations/0030_spec_palettes.sql`, `db/seed/0008_spec_palettes.sql`,
`db/seed/0009_requirements_local_keys.sql`, `src/lib/palettes.ts`,
`src/components/records/AnswerValue.tsx`

Eleven of Matthew's 35 fields carry a palette, and answering a spec question
had always been a bare `<input placeholder="Value">` — so "Indoor | Outdoor |
Humid indoor" was typed eleven ways and nothing could tell `Outdoor` from
`External`.

- **`pick_lists` stays dead.** It has existed since 0001 with no seed, query or
  UI, and its shape carries no spec-field link, no free-text flag, no default
  and no sync provenance. Reviving the wrong shape to save one `create table`
  is how a schema ends up with two overlapping registers.
- **Six palettes are ours and FIVE ARE NOT.** Timber finish, metal finish, seat
  build, back cushion and stud all say "From the BWS … palette" and **this app
  holds none of them**. They are seeded as rows with **zero options** and a null
  `synced_at`, the field stays free text, and the screen says so in a sentence.
  That row is the honest representation — "this vocabulary exists, BWS owns it,
  we have never had it" is a question somebody can answer, where five invented
  finish lists is the one kind of wrong answer nothing downstream questions.
  A db-tier test asserts they are still empty.
- **`normalisePaletteValue` returns null rather than the nearest option.** The
  exact step, separate from the fuzzy one (house §6). It folds case,
  whitespace and the degree sign, and **does not fold a dash into a space** —
  the `normaliseFinishCode` rule: a normaliser clever enough to merge two
  spellings is clever enough to merge two things somebody kept apart.
- **Every offered list carries "Other…"**, even where Matthew's is closed. A
  list with no way out makes somebody pick the nearest wrong option, which is
  §5's plausible-looking wrong answer wearing a dropdown. A value already off
  the palette stays editable as itself and is flagged, never snapped on.
- **A default preselects a control and writes no answer.** His sheet says
  Assembly guide is "No (default)"; `missing` means nobody has looked, and a
  gate passed by a default is a gate passed by nobody. The select does not even
  show it preselected — a select already reading "No" fires no change event
  when somebody chooses No, so the one action recording their agreement would
  do nothing, which is the level picker's trap. It is a hint beside the control.
- **`requirements.local_key` is where the six id-less questions live.**
  `kind = 'readiness'` has meant "must be known, BWS has no column" since 0002,
  so Headboard fitted, Fitted banquette and the four conditionals they reveal
  are readiness rows tied to their gate row by key. That buys answers, states,
  versions, change sets and chase coverage for nothing. Before it, a fitted
  headboard could never satisfy TG0 — there was nowhere to say it was fitted.
- **The product code carries NO palette key.** His "Palette Options" cell there
  describes where the value comes from — "derived automatically: if MF1 or MF2
  is populated" — not a list the app offers. Caught by the assertion that every
  gate's palette key resolves to a palette.

### A spec value has a second line, and the file gets one line

`db/migrations/0029_spec_qualifier.sql`, `src/lib/bws-export.ts`
(`EXPORT_QUALIFIER_MODE`, `joinQualifier`, `renderAnswerValue`),
`src/lib/promote-answers.ts`, `src/lib/export-check-sheet.ts`

Matthew, 2026-09-17: "the spec fields are structured with the top line as the
spec and the return line as the qualifier. So COM 1 might be 14m of T&G Pink
velvet, then the returned line will be the placement 'Main & Self Pipe'." His
matrix says it eight times — rows 15-22 are all "<field> + location".

- **A column, not a row.** `record_attributes_field_slot_key` already says one
  BWS field, one value per record. A qualifier is not a second statement; it is
  the second line of the same one, and a satellite row re-opens "which line
  wins" — the question that index closed.
- **Never folded into `value`.** That is the `TBC TBC` bug in a new place:
  `renderAttributeValue` is shaped the way it is because a marker composed into
  a string that may already hold it is not idempotent. Holding the placement
  apart means the composer always composes from atoms and never parses back.
- **The export writes ONE LINE, today.** `EXPORT_QUALIFIER_MODE` is `inline`
  and emits `<value> - <placement>`, which is the shape Matthew's own quote
  sheet already uses. A TypeScript constant, not an env var and not a toggle:
  a newline inside a BWS cell is a file-format change to the file that
  overwrites rather than fails, so flipping it is a deliberate commit — and a
  test asserts no exported cell contains a newline, so the flip means watching
  that test fail on purpose and running a fresh check sheet. His own file mixes
  a hyphen and an en dash; we emit one and parse neither.
- **It goes on AFTER the TBC marker.** A placement can never carry the client's
  not-decided marker, so folding it in first would let "Main body and self
  pipe" suppress a TBC that belongs on the value.
- **`renderAnswerValue` exists so an answer cannot be the exception.**
  `composeRowCells` used to put `answer.value.trim()` straight into the cell — a
  bare string with no composer behind it — which the moment an answer could
  carry a placement became a way for one typed on the record screen to vanish
  from the file while the screen went on showing it.
- **The composed DIMENSIONS cell carries none.** Four slots off three pages
  could carry four placements; picking one would invent a fact.
- **The check sheet shows it apart from the value**, because the exported cell
  joins them and a reviewer checking against a page has to be able to tell
  which half the document said.
- **Extraction is not retro-active and was not changed.** The tool schema has no
  placement field; adding one means re-reading and re-paying for every document
  already read. The `fabric_schedule` prompt already folds a position into the
  value, so today's placements are in prose — the hand-typed field is the
  recovery path, and a read-time splitter on " - " would halve a finish
  description that legitimately contains one.

### A person can add a record, a spec and a note, and none of it has a page

`db/migrations/0028_manual_capture.sql`, `src/lib/manual-capture.ts`,
`src/app/api/attributes/route.ts`, `src/app/api/projects/[id]/runs/route.ts`

Matthew's workflow of 2026-09-17 — "specs checked and added to manually and
developed with Q&A with client through your app tools" — needed three verbs the
app did not have. `find src/app/api -name route.ts` had **no POST** for records,
runs, attributes or answers: a record could only be created by confirming a
bill, a spec value only by confirming a document, and a bill line's own words
could not be corrected at all.

- **A typed value carries NO source run and NO page**, and that is the honest
  shape rather than a gap: a spec somebody typed IS a spec with no page to turn
  to. Every screen that prints provenance already handles the blank, and
  inventing a source would be worse than it.
- **`applyAnswerFills` had to learn one more predicate.** Its rule is "only an
  answer still `missing`, or one a SHOP-DRAWINGS run wrote". A hand-typed
  attribute wrote the answer once and could then never update it — the first
  typed dimension composed `W1900mm` and the next two could not reach the cell,
  so the record showed W, D and H while its Dimensions answer said `W1900mm`.
  `document` with a **null** `source_id` is the discriminator, and a precise
  one: every document path writes a run id, so nothing else can be there.
  `manual` and `email` stay out of reach, so a person's own checklist answer is
  still never overwritten.
- **Two free-text columns, not one.** `spec_description` is quote-facing and
  becomes the prose at the top of the quote's Specification block;
  `internal_notes` never leaves this app except as the quote CSV's own
  `Internal notes` column. The real quote example carries both, and one of its
  internal notes is a previous price — exactly what must not reach a client.
  Neither enters the 109-column grid: his matrix says Spec notes has no BWS
  mapping. Whether he meant one field or two is Still open.
- **The details panel saves as ONE act, not on blur.** Found in the browser:
  typing the quote description, tabbing to Internal notes and typing there LOST
  the second box, because the first blur saved, the screen reloaded and the
  reload re-keyed every input to what the server held. It was also four change
  sets and four versions for one correction. The checklist answers still save
  on blur and should — each of those is its own decision.
- **`label` is baseline-only.** 0012: "a baseline is named, and nothing else
  is". Descriptive text on any other change set goes in `reason`, or the insert
  is refused by a constraint whose message names nothing useful.
- **A change set cannot be deleted, only cascaded.** 0014 refuses the direct
  delete outright, so a test teardown that tries one throws and leaves its
  fixture behind. Delete the project; the changes go with it. Same for
  `record_snapshots` and its record.

### A confirmed spec can be CORRECTED, and the correction keeps the page

`db/migrations/0033_attribute_correct.sql`, `src/lib/attribute-correct.ts`,
`src/app/api/attributes/[id]/correct/route.ts`, the record's Specs tab,
`docs/plans/make-it-work-2026-09-19.md` §5.2

Matthew went looking for confirm-or-update on a confirmed record on
2026-09-18 and neither he nor Max could find it, because there was nothing to
find: a confirmed `record_attributes` row could be RETIRED (reason required)
or a new one TYPED by hand (no page), and correcting `W1900` to `W1090` off
the same page was two acts, two change sets, and a replacement that had lost
the page it was read from. Built 2026-09-20 (Stage 1a item 1.13).

A correction is a **supersession by a person**, and six things about it are
traps rather than preferences:

- **Never an edit in place.** `record_attributes` is what a DOCUMENT said. An
  in-place edit makes the row say something the page does not while still
  citing the page — a false provenance — and the history can no longer answer
  "what did the card say before Max fixed it". The old row is retired with
  `superseded_by_id` pointing at the new one, and stays visible under *show
  retired*, naming the value that replaced it.
- **The new row KEEPS the source run and page.** The page is still the right
  place to check the corrected figure; a correction that dropped it would be
  indistinguishable from a number somebody made up. A hand-typed row has no
  page and its correction keeps none — nothing is invented.
- **Retire before insert, then point.** Both partial unique indexes are
  `where status = 'active'`, so the old row is retired (version-checked) before
  the new one is inserted, and `superseded_by_id` is set on the retired row
  afterwards — the only order 0016's check (`superseded_by_id is null or
  status = 'retired'`) allows. A row already superseded is REFUSED, naming the
  newer value; a stale version is a 409 and nothing is written.
- **A reason is required, as for retire**: `attribute_correct` is in
  `REASON_REQUIRED_KINDS` AND in the database CHECK (0033 re-lists both CHECKs
  from the LIVE constraint text, the 0032 lesson). An open change satisfies
  it, as everywhere. The reason box is always shown on the record screen,
  because that screen has no notion of an open change and a control that
  sometimes asks is worse than one that always does.
- **It never writes the answer and never touches `spec_records.version`.**
  The checklist is recomposed through `recomposeAnswers` — the composed cell
  is a projection of the attributes, so the next drawing confirm would wipe a
  directly written answer — and one `snapshotRecords` gives the record its
  v(n+1). The DoD on the demo sofa: two clicks, `W1820` → `W1830`, "1 changed ·
  1 added · 1 removed · 60 unchanged".
- **A corrected FINISH asks the library row's own code, not the attribute's.**
  WHICH finish an attribute is was settled at confirm time and a correction
  never moves it; the only question left is whether the corrected WORDS still
  match the library's description, and a disagreement leaves the new row
  UNLINKED (the CONFLICT rule) with the library untouched. The first version
  passed the attribute's `material_code`, and a test fixture that hand-wrote
  `code_norm` without `normaliseFinishCode` made both finish tests pass with
  the branch deleted — a fixture that invents a normalisation is that
  function's own warning, one layer out.

Where it appears: beside every active spec on the record's Specs tab; on a
drawings card only before confirm (the editable value box is already that);
never on an applied proposal, which stays immutable history. Found on the way
and fixed the same day: a checklist question with NO answer row came through
`/api/records/[id]`'s LEFT JOIN as `state: null`, which every filtered view
dropped and the `#q-` deep link rendered — the route now coalesces to
`missing` and the tone lookup falls back to plain (`found-in-use.md`,
2026-09-20).

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

### An email is a specification document whose page is a sentence

`src/lib/email-envelope.ts`, `src/lib/email-routing.ts`,
`src/lib/email-registration.ts`, `src/lib/confirm-spec-document.ts`,
`db/migrations/0021_email_intake.sql`

Specification information arrives by email constantly, and until now none of it
reached a record except by somebody reading the message and retyping the value —
after which the record held a value and said nothing about where it came from.

An email is therefore a `document_kind`, not a pipeline: it is staged as the
same `StagedSpecDocument` proposals, reviewed on the same screen, and confirmed
through the same route, so the review gate, the blockers, the per-proposal
versions and the change set are inherited rather than rebuilt. 0007's rule
holds — the kind goes under `source_kind = 'spec_document'`, never beside it.

Five things are load-bearing:

- **Assignment is the spend point.** An unassigned email is never read: there
  are no registers to resolve it against. `assignMessage` is the ONLY thing that
  puts a message on a project, because it is also what opens the attempt and
  dispatches the charged read, and two places doing that is two places to forget
  one half. `registration_request_id` is `email:<messageId>`, so a replay
  returns the run it already made.
- **Routing never breaks its own tie.** Signals run in order — a project inbox
  in the forwarding headers, then in To/Cc, then a project number or code in the
  subject, then the sender being a contact on exactly one project — and the
  FIRST signal naming any project decides. Two projects at that strength is
  `ambiguous` and is HELD for a person; a weaker signal is never allowed to
  arbitrate, because a confident wrong answer is worse than an unplaced one.
  Both Exchange forwarding shapes are covered: a redirect keeps the original
  sender and stamps the loop headers, a rule-forward replaces the sender and is
  trusted only alongside `X-MS-Exchange-Organization-AutoForwarded`.
- **Confirmed is not a hard closure.** `proposalBlockers` already refuses a
  proposal over a `confirmed` or `na` answer until the reviewer acknowledges it,
  whatever the new state is — so confirmed → a different value AND confirmed →
  TBC both require the acknowledgement, tied to the version that was shown. That
  blocker is what makes "they confirmed it in March and changed their mind in
  September" safe rather than silent. `changeIntent: "withdraws_to_tbc"` is the
  one reading the wording alone cannot produce, because the value being
  withdrawn carries no TBC token.
- **The change carries the email.** A confirm off an email opens an
  `email_confirm` change whose reason names the sender, the date and the
  subject, and whose `evidence_attachment_id` is the `.eml` itself. "The client
  says they never asked for this" is answered by opening the message. Nothing
  renders it: an `.eml` body is untrusted HTML a stranger wrote, so both routes
  that serve one set `content-disposition: attachment` and `nosniff`.
- **A message arrives before it has a project, so it is COPIED when it gets
  one.** `mailboxStoragePath` stores an arriving `.eml` under `mailbox/`,
  because no project is known yet, and every read in `blob-source.ts` is scoped
  to `projects/<id>/`. Assignment attached the arrival path verbatim, so the
  run it started could never be read — "That file does not belong to this
  project", the worker refusing a mailbox path under a project scope. The
  comment beside the attachment insert already said "under the project's own
  prefix": it described the UPLOAD path, where the browser had already put the
  file there, and nothing had ever walked the mailbox path. `planMimeLocation`
  decides (pure, so it is provable without a store) and `assignMessage` runs
  the store's own server-side `copy` OUTSIDE the transaction, because blob I/O
  inside one holds a row lock across a network call. Copied, never moved: the
  mailbox path is the arrival record and `unassignMessage` must leave the
  message something to have come from. Found 2026-09-17 by fake mail staged
  through the real Graph path; it would have been the first real message.
- **`spec_answers.source_kind = 'email'`** has been allowed by 0002's CHECK
  since the beginning and had never been written. It puts the answer out of
  reach of `applyAnswerFills` and `applyAnswerRetractions`, exactly like
  `'manual'` — a person confirming a value off a message, with the message
  attached, is a decision and not a document's reading.

`quotedText` replaces the page number: an email has no page to turn to, so the
sentence the value was read from is what makes the proposal checkable. Quoted
history is kept and MARKED, never stripped — a reply quotes the question it
answers — and the prompt tells the model to record from it only where the new
text does not restate the value.

### One email, one code, three runs — and one row per spec

`src/lib/spec-document.ts` (`resolveProposals`, `rematchProposals`),
`src/lib/spec-review-rows.ts`, `src/lib/spec-change.ts`,
`src/app/api/imports/[id]/rematch/route.ts`

The first real email review was a wall: seven specification values, every one
reading **ambiguous match** against three identical candidates, each with a
paragraph of the model's own reasoning under it and two dropdowns to fill in by
hand. Nothing about the email was ambiguous. `S-201` is on the mock-up run, the
main run and the VE run, and `resolveProposals` counted three matches and gave
up — `matchedRecords.length === 1 ? … : null`.

`resolveDrawingTargets` has had the right rule since 0007 and says so in its own
header: **one record per RUN is a fan-out; two records in ONE run is the
`SX11A` case and stays ambiguous.** The two pipelines matching a code
differently was the whole defect, and the fix is that rule in a second place —
not new thinking.

Six things are load-bearing:

- **The fan-out is N PROPOSALS, not one proposal with N targets.** A proposal
  carries a target SNAPSHOT the confirm checks for edits underneath the
  reviewer, so a multi-target proposal would need N snapshots, N overwrite
  acknowledgements and N version checks inside one row. One proposal per record
  keeps `proposalBlockers`, the per-record confirm and the `duplicate_target`
  clash working unchanged, and **the record stays the unit of commit**.
- **`sourceOrdinal` is no longer unique, and that is its job.** The fan-out
  members share the ordinal of the observation they came from, which is the key
  `groupIntoSpecRows` groups a screen row by. Seven specs over three runs is
  seven rows, not twenty-one.
- **A run that collides is the only run the reviewer is asked about.** A code on
  two lines of the VE bill leaves the main run resolved and asks about VE alone,
  and the candidates offered are THAT RUN'S — offering the main run's record
  there would let somebody resolve the collision onto a record another proposal
  is already writing.
- **Re-matching is FREE and it never overwrites a decision.** A spec document
  resolves in the worker, not at read time, so a corrected rule is not
  retro-active and the pilot email would otherwise need a billed re-read to fix
  an app defect. Every staged proposal carries its own `raw`, so
  `rematchProposals` re-resolves from what is already on record — touching only
  what is still `pending`, still at `version === 1` and still unresolved, and
  returning the ORIGINAL row unchanged when nothing resolves differently, so
  running it twice is a no-op. The button says it costs nothing, because every
  other button on that screen that touches extraction spends money.
- **The verb comes from the RECORD, never from the wording.** `describeChange`
  reads the target snapshot — provides / confirms / changes / repeats / puts
  back to TBC — so an email the model read as `confirms_tbc` over a value the
  record already holds is reported as a CHANGE, which is what is about to
  happen. `changeIntent` is kept for the one case wording alone cannot carry, a
  settled value being withdrawn, and that already reaches the state through
  `emailAwareState`. The label never stands in for a blocker: `changes` still
  requires the overwrite acknowledgement.
- **"Item not found" and "question not matched" are different jobs.**
  Collapsing them produced a row that contradicted itself — *3 runs* in the
  Applies to column beside *Not yet placed*. Once the fan-out lands, the item is
  the half that resolves and the question is the half that does not, because
  `requirement_aliases` is empty and "Seat height" scores nothing against a
  category that asks "Dimensions". The blocker names the half that is missing.

**The row is a summary and every control is still one click inside it.** The
question picker, the value box, the state select and the overwrite
acknowledgement are unchanged in `ProposalRow`, per run. A table that could only
confirm or ignore would make correcting a misread value impossible, which is the
reviewer's whole job. Blockers render ON the row, not only on the disabled
button at the bottom — a 400 in a banner at the top of the page is nowhere near
the row it is about. And the per-run panel is a `<div>` holding a `<ul>`, because
`ProposalRow` renders its own `<li>` and nesting one in another is a hydration
error.

**A configuration is DETECTED and never resolved.** `detectConfiguration` reads
the `A` out of "Fabric (A configuration)" and the row badges it yellow. It
refuses a bare letter — "Fabric A" is a grade far more often than one of 0024's
configurations — and nothing is written from it, because a configuration carries
no client ref, may not exist, and `ensureVariant` refuses a bill line that
already holds confirmed specs. **STILL OPEN:** the pilot email states fabrics for
configurations A and B of `S-201`, which has none, and what should happen then —
flag it, offer to create them, or something else — is Max's decision and has not
been taken.

### A spec reaches its BWS field by slot or by field, never by matching a question

`src/lib/spec-dimensions.ts`, `src/lib/spec-finishes.ts`,
`src/lib/spec-document.ts` (`resolveProposals`, `seedTakenFields`),
`src/lib/confirm-spec-document.ts`, `src/lib/promote-answers.ts`

Once the run fan-out landed, the item resolved and the QUESTION did not: all
seven of the pilot email's values read *Question not matched*, because
`requirement_aliases` is empty and "Seat height" scores nothing against a
category that asks "Dimensions". The obvious fix was to seed the aliases. It is
the wrong fix, and finding out why is the whole of this section.

**"Seat height" and "Overall" are the SAME question.** There is one Dimensions
question and all five slots compose into it, so aliasing both onto it puts two
proposals on one answer and hits `duplicate_target` — the screen refuses them,
correctly. **A finish is worse**: COM 1 / COM 2 / Main timber finish is decided
by what the record already holds, so an alias would have to name one slot up
front and the next item contradicts it.

So an email's dimension or finish becomes a `record_attributes` row, exactly
like a drawing's, and the checklist answer follows from `promote-answers.ts`.
That is not a workaround — it is the architecture already in the building:
`record_attributes` is what a DOCUMENT said, an email is a document, and
`composeDimensionCell` stays the single composer. Writing the answer directly
would leave a Dimensions cell no attribute backs, and the next drawing confirm
recomposes from the attributes alone and silently wipes what the email gave.

Nine things are load-bearing:

- **An email writes prose; `parseDimensionFigure` is strict.** "445mm (measured
  to top of cushion, compressed)" is not one bare figure, so `readDimension`
  splits the leading figure, the unit and the QUALIFIER — and the qualifier is
  kept as a note attribute, because "445" alone does not say what it measures.
- **The unit comes from the wording or from nowhere.** There is no magnitude
  fallback anywhere in the dimension model and there is none here. A missing
  unit is amber and asked for on screen, and it is NOT a blocker:
  `composeDimensionCell` renders an underived figure verbatim in a bracket
  saying why, which is a truthful cell.
- **ONE PART PER PROPOSAL.** "Overall — W660 x D685 x H680mm" is three slots
  and therefore three proposals, sharing a `sourceOrdinal` so the screen shows
  one row. Two slots behind one version would mean two writes behind one
  acknowledgement.
- **A finish fires only on the document's own CODE.** `classifyCallout` reads
  words too, which is right for a drawing's short caption and wrong for prose:
  "seat upholstery build — loose or fixed?" would read as a fabric on one word
  and land a build instruction in COM 1. `readFinish` refuses anything with no
  `UPH-07`-shaped code, the one exception being a material label whose value is
  TBC, which carries no substance to misread.
- **The BWS slots are claimed across a WHOLE document, and `taken` is
  therefore a parameter.** `rematchProposals` re-resolves one observation at a
  time, so a fresh map per call gave all three of the pilot email's fabrics
  COM 1 — which the confirm would then refuse on 0007's unique index. Seeded
  once by the caller, from the record's existing attributes AND from every
  proposal the pass is not re-resolving.
- **`targetKey` names all four coordinates** — record, question, dimension
  slot, BWS field. It left the field out, so an observation that used to be a
  checklist answer and now reads as a fabric keyed identically both ways, and
  re-matching silently handed back the originals. Four of the pilot email's
  five finishes refused to re-match, and nothing said so.
- **Retire before insert, version-checked.** Both partial unique indexes are
  `where status = 'active'`, so the database decides that order. The occupant's
  version is re-checked at confirm and one that moved since is REFUSED, because
  the value a reviewer agreed to drop is not the value that is there.
- **A COMPOSED cell may be recomposed by any document.**
  `applyAnswerFills`' guard let only a shop-drawings run rewrite a cell, so an
  email giving W/D/H and a second email giving SH left the record holding four
  slots and its answer showing three. The `jsonId` branch IS the composed
  dimensions cell and nothing else, and a composed cell is a PROJECTION of the
  attributes rather than an answer anybody authored — so it must always equal
  their composition. `manual` and `email` stay out of reach, so a person's own
  checklist answer is still never overwritten.
- **Not everything is a slot, and that is correct.** `ARM HEIGHT` is named in
  the dimension invariant as the case a substring rule destroys; it has no
  slot, no finish code and no checklist question, so it stays unplaced. That is
  a true statement about the requirement matrix, not a failure to read.

**Import cycles were the cost.** `spec-dimensions` and `spec-finishes` need
`TBC_TOKENS`, `containsPhrase`, `deferredToSomebody` (now in `spec-vocab`) and
`classifyCallout` (in `drawing-document`), while `drawing-document` needed
`findRecordsByRef`, `normaliseRef` and `RecordEntry` from `spec-document`. Those
three moved to the leaf `src/lib/record-refs.ts` and everything is re-exported
from its old home, so no caller changed. A cycle between two of these works
right up until one is read at import time by the other, and then fails
somewhere unrelated.

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

**A pack reads THREE documents at a time, and the rest wait for a slot**
(`src/lib/extraction-slots.ts`, `MAX_IN_FLIGHT_READS_PER_PACK` in
`extraction-claim.ts`, Stage 2 item 2.10.f, 2026-09-21). Registration still
returns 201 and still stores the file; at the cap the run is DEFERRED rather
than refused — a refused registration tells somebody their file did not
arrive, and thirty files would mean twenty-seven Read presses. A deferred run
is marked by `attempt_deadline_at` set with `attempt_id` NULL, a pair nothing
else writes, so no migration was needed and no status was added; the screens
read it as *Waiting for a slot*. The slot is taken under a
`pg_advisory_xact_lock` on the pack (the project, for a batch-less email), not
the project row, so a registration never queues behind a bill confirm. The
hand-off runs where an attempt SETTLES — parsed, `fail()`, and
`recordExtractionFailure`, which gained a `returning` so only the invocation
that wrote the failure hands on — through the same `openAttempt` +
`publishAttempt` protocol, commit then publish; `releaseAndThrow` keeps its
slot because that attempt is alive and will be redelivered. `inFlight` counts
only attempts inside their deadline, or one stuck document would shrink a
pack's capacity for good and stop the *Read all* that is the way out. Two
holes stand and are logged: nothing settles an attempt that passes its 24-hour
deadline, so nothing hands its slot on at that moment; and *Read all* in the
drawings review started reads without a slot (briefed the same day).

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
- **`kind` is SUGGESTED and never written.** The rule was "never inferred", on
  the grounds that `classifyGroup` already guesses a group from words in a
  label and a second guess stacked silently on it produces a register full of
  confident mistakes. That reasoning stands and nothing writes a kind on its
  own. What changed on 2026-09-18 is WHO DECIDES: `suggestFinishKind`
  (`src/lib/finish-kind-guess.ts`) reads the client's own code prefix and then
  the description's material words, the row prints the kind as a dashed blue
  button with its evidence beside it, and a person's click files it. The
  `level_suggested` rule (0025) in a second place — the register cannot fill
  with mistakes, because every entry in it was agreed to by somebody looking at
  the row.
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
- **It is a TAB on the project, beside the runs** (2026-09-17). It was a grey
  line on the Overview tab, so it disappeared the moment anybody clicked a run.
  `/dashboard/projects/[id]/finishes` still exists and REDIRECTS to
  `?tab=finishes`, because every link written before that date points at it.
- **A filter narrows what is LISTED, never what an edit touches.** Search, kind
  and run are client-side over the payload already loaded. The run one is the
  trap: a finish is project-scoped, so correcting one while looking at MUR still
  corrects it on the main run and the VE. The used-on count therefore stays the
  TOTAL with "n on <run>" beside it, the expansion lists every use including the
  runs the filter is hiding, and the edit panel goes on quoting the total.
  Showing the filtered number as the blast radius is how somebody changes a
  confirmed fabric believing it reaches one item when it reaches eleven.
- **`editFinish` REPLACES the row; an omitted field is written as null.** So the
  one-click kind picker on each row sends every field the finish already holds,
  not just the kind — a partial patch there silently deletes the description,
  supplier and reference. Anything else that patches a finish must do the same,
  or merge `undefined` in `editFinish` deliberately.
- **The kind is suggested, filed one click at a time, and the banner counts
  what the button files.** All eleven finishes on the sandbox Panther project
  had none, which made the kind filter dead. Six things about it:
  - **The word lists are shared and the callout half is FROZEN.**
    `src/lib/material-words.ts` is a leaf holding both, so the drawings path and
    the library cannot drift apart about whether `WD-05` is a timber. Everything
    named `*_CALLOUT_WORDS` is exactly what `classifyCallout` matched on before
    the move: `upgradeCalloutGuesses` runs at READ time, so widening those would
    silently re-classify rows on every pack already read. The library's extra
    vocabulary is additive and used by nothing else.
  - **A material word is not a part word.** The timber list has always carried
    `feet`, `leg`, `legs`, `frame`, which is right for a caption whose LABEL is
    the part and wrong for a description, where "for the legs" says where the
    finish goes. The library reads `TIMBER_MATERIAL_WORDS` only.
  - **Leather is read before fabric**, because `FABRIC_CALLOUT_WORDS` contains
    `leather`, `hide` and `suede` — the drawings path cannot tell them apart and
    does not need to, and `FinishKind` can.
  - **The route re-derives every kind from the live row** and the client sends
    ids and versions only, so the button can only file what the screen offered.
    The `questionTier` rule: a request that tries to SET one is not honoured.
  - **One click is ONE change set**, not N. `editFinish` now takes an optional
    `changeSetId` to attach to, because it otherwise calls `changeSetForEdit`
    per finish and eleven codes filed in one press become eleven entries in the
    trail. `finish_edit` is in `REASON_REQUIRED_KINDS` AND has a database
    constraint behind it, so the bulk route must supply a reason — found by
    pressing the button, which reported "A finish edited has to say why" and
    correctly wrote nothing.
  - **The picker is offered inline only on a TBC finish** — the route's own
    rule: a confirmed finish is a decision and changing it needs a reason, which
    the Edit panel collects. So the banner counts the TBC-and-suggested rows,
    not every suggestion, or the number on the button would not match what it
    does. Where nothing can be suggested the row keeps the empty picker and the
    screen says why.

### A CHECK is re-listed in full, so copying a stale list DELETES values

`db/migrations/0032_restore_email_confirm.sql`, `tests/db/vocabulary-sync.test.ts`

A Postgres `check (x in (...))` cannot be extended: adding a value means
dropping the constraint and recreating it with the whole list. The whole list
then gets copied from whichever migration most recently re-listed it — and that
copy is stale the moment any migration since added a value.

**0028 copied 0019's list of change-set kinds and silently deleted
`email_confirm`, which 0021 had added in between.** Every email confirm began
failing with a constraint violation that reached the reviewer as a 500 and
"Nothing was written", and four db-tier tests went red for a value nobody had
typed.

Two things are worth more than the fix:

- **The misdiagnosis.** It was first blamed on another agent's commit, on the
  evidence that it still failed with the TypeScript changes stashed. It failed
  because **the constraint lives in the database**: a migration already applied
  to the sandbox is not undone by stashing a `.ts` file. When a db-tier test
  fails, the thing to revert is the SCHEMA, not the source — and the way to
  check a clean baseline is `git worktree add --detach <dir> HEAD`, which leaves
  the working tree alone.
- **The guard.** `tests/db/vocabulary-sync.test.ts` asserts all twelve
  controlled vocabularies in `spec-vocab.ts`, `change-sets.ts` and `finishes.ts`
  against their own CHECK, and reports drift the other way. It fails in a second
  on the next drop-and-recreate that loses a value, which is the only version of
  this that scales. Read the LIVE constraint when re-listing one, never a
  migration.

### A backtick inside a `sql` template closes it

Twice on 2026-09-17, in `promote-answers.ts` and in the quote route: a SQL
comment written in this repo's usual prose style — naming a column in
backticks — ends the tagged template literal, and esbuild reports a syntax
error thirty lines away pointing at a word in the comment. The queries are
tagged templates, so **no backtick may appear inside one**, including in a
`--` comment. Name the column in plain words there.

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

### The model says which figure is the width; nothing sorts them by size

`src/lib/extraction-schema.ts` (`DRAWINGS_TOOL`, `slotFromModel`, `RawCodeGroup`),
`src/lib/anthropic.ts` (`PROMPTS.shop_drawings`),
`src/lib/drawing-document.ts` (`stageDrawings`, `assertStagedDrawings`,
`canonicalCode`, `variantLettersByItem`, `foldableRow`, `wasReadByModel`),
`src/lib/dimension-guess.ts`, `tools/measure-drawing-reading.ts`

Three defects reported on one pack in one sitting, 2026-09-18 — a transposed
dimension cell, a card nobody could read, one armchair about to become two BWS
jobs — were three faces of one thing: **code was inferring what the model could
have been asked to read off the page**, and every rule doing the inferring had
been tuned against this one pack. Max: *"it's not always as simple as one item
per page … we need a total overhaul here, because it seems that this issue keeps
occurring."*

`house/conventions.md` §6 was rewritten to allow it, and the reason is measured
rather than argued: forbidding the model to say which figure was the width did
not remove the decision, it moved it into code, which cannot see the page.

**MEASURE FIRST. `npm run measure:drawings` is read only and calls
`assertStagedDrawings`, the same function the screens call.** Before: 18 staged
runs, 70 items, **141 of 183 placed dimensions were guesses (77%)**, 19 items
slotted BY SIZE, 45 raising a dispute, 38 items lettered as configurations. Run
it before and after; a sentence in a document cannot be re-run.

**A staged run is `schemaVersion: 2`** when the model was asked. Version 1 keeps
the old guessing pipeline, FROZEN, until it is re-read — nothing is upgraded in
place, because inventing the fields an old run never carried would be one more
inference layer.

Seven things are load-bearing.

- **TWO READINGS OF A SLOT, and a disagreement is never settled silently.** The
  model says which figure fills which slot and why; `normaliseDimensionSlot` is
  now a VALIDATOR over the page's own label, keeping its whole-label rule
  (`WIDTH SEAT` is not a width). Agreeing is unflagged. The model alone is
  flagged, with its own evidence as the reason. **A conflict gives the slot to
  the page's printed word and names the disagreement on the row** — that is the
  S-203 signature, `"Width" = 80` landing in the depth slot.
- **A COMBINED LINE NO LONGER INVENTS SLOTS FROM PRINT ORDER.** A printed prefix
  (`W1520`, `Dia.460`) is the page speaking and is kept; three bare figures get
  none, and the model reports the same figures with the evidence for each. Two
  inferences on one line meant the weaker winning silently: `80 x 70 x 90 cm`
  shipped as `W900 x D800 x H700mm`.
- **A PAGE COUNT IS NOT EVIDENCE OF A SPLIT.** `variantLettersByItem` reads the
  model's `one_item` / `configurations` / `unclear`, and only `configurations`
  letters anything — because lettering takes the bill line out of
  `loadExportScope` and ships each letter to BWS as its own job. **No string
  rule can do this instead, and that was measured.** S-200 states `Tibor Blob
  Amber Fern` on one page and `CLO003 A = Tibor Blob Amber Fern` on the other;
  comparing codes calls it a split, and comparing descriptions calls it a split
  too, because one page adds "as per approved sample".
- **IT IS NOT ONE ITEM PER PAGE, IN EITHER DIRECTION**, and the pages may TITLE
  one item differently. S-200 is headed `S-200` on its specification sheet and
  `MUR.2 ARMCHAIR` in the shop drawing's title block. `codeGroups.itemCodes` is
  a LIST with the bill's code first, and `canonicalCode` is what grouping AND
  resolution key on — without it the shop drawing is an item no record carries.
- **THE FOLD ASKS WHETHER A FIGURE IS OVERALL**, not whether the value is a
  number. `isOverall` is the model's answer; `foldableRow` lives in
  `drawing-document.ts` so the card and anything measuring the card ask one
  function. S-201's five blank `TBC` sub-dimensions state no figure, so the old
  test could never fold them and they printed inline between the four that
  matter and the fabrics. Slots also sort W/D/H/SH/Dia to match the composed
  cell above them, and the rest group by kind.
- **ONE DIMENSION STATED ON FOUR VIEWS IS ONE DIMENSION.** Cross-view duplicates
  used to be kept deliberately — that repetition was the evidence the magnitude
  guess read — and there is no guess left to feed. Same slot and same figure
  collapses; same slot and a DIFFERENT figure never does, because that is two
  views disagreeing about the chair.
- **A CARD THE MODEL READ DOES NOT ALSO GUESS.** Both cards re-run
  `guessSlotsFromViews` at render time, and on a version 2 item that printed a
  dispute banner describing a sort the app no longer does, directly above rows
  saying something else. `wasReadByModel` reads it off the item, because
  `isOverall` is set on every version 2 dimension row and on none before.

**THE UNIT VOTE IS DELIBERATELY KEPT.** `suggestUnit` still reads cm or mm from
magnitude where the page prints nothing — the same KIND of inference, and not
the same situation: a page that prints `80 x 70 x 90 cm` beside the word Width
HAS stated which figure is the width, where the AP364 shop drawings state no
unit anywhere. It is flagged on every row it touches, one click corrects a whole
page, and removing it left every card blocked by `unit_missing` with no control
able to unblock it. What moved is the NARROWING to the overall figures, which
used to live inside `applyViewGuesses` and now runs at staging off the model's
own answer.

**NEVER FAIL A PAID RUN OVER A HINT.** `itemCodes` came back as a bare string on
one document and `z.array()` refused it, so a read that had already been charged
for went terminal with "Expected array, received string". A string is read as a
one-entry list, and a group that still makes no sense is dropped —
`codeGroupsOf` — which leaves the item whole and asks a person. The same rule
put `evidence` at `MAX_NOTE`: the model wrote 480 useful characters explaining a
grouping and a 300-character bound silently nulled them.

**STAGED JSON IS DATA FROM THE PAST.** `assertStagedDrawings` casts rather than
validates, and this shape changed twice in one afternoon — so every screen
reading the first version 2 run threw `Cannot read properties of undefined`.
Read a staged field defensively or a schema iteration is an outage.

**Verified on the sandbox by re-reading the Panther-d pack, ten charged calls.**
Every guess gone: items slotted by size 10 → **0**, disputes 14 → **0**, rows
whose label disagrees 3 → **0**, items lettered 4 → **0**, inline rows with no
figure 25 → **3**. S-203 `W900 x D800 x H700mm` → **`W800 x D700 x H900mm`**;
S-200 one item on two pages, both `W840 x D790 x H720 x SH460mm`; S-100's
previously CODELESS second page now groups with S-100 through its title block.
S-201's reason followed the page: *"page 1 explicitly instructs 'ITEM: REFER TO
JACQUES GRANGE DRAWINGS' … tying the two pages to the same armchair."*

### The upload works out what each file is

`src/lib/document-classify.ts`, `src/app/api/imports/classify/route.ts`,
`src/components/projects/IntakeBatchUpload.tsx`

The same thesis at the other end. Eleven dropdowns stood between a pack and the
app because "a BOQ and an FF&E schedule are both .xlsx", and a filename hint sat
beside each row as grey text the screen refused to act on. One press now stores
each file, asks what it is, fills the box in and reads it.

- **The model answers in TRADE terms and code files it.** `DOCUMENT_GENRES` is
  what somebody in furniture manufacturing would call the document;
  `KIND_FROM_GENRE` maps it onto `importType` and `DocumentKind`. The model is
  never shown `ffe_schedule` — the exact step, unchanged by the §6 revision.
- **Unsure fills nothing in.** `unclear`, and anything the model is not certain
  of, produces no decision: the file is uploaded, held on the screen, and NOT
  read. The prompt says outright that a spreadsheet which could be a bill or a
  schedule must come back unclear, because the cost is not symmetric.
- **Every answer is flagged with its evidence**, and a person's choice always
  beats the suggestion.
- **The kind still arrives DECLARED** at `/api/imports`, which is untouched. The
  classify route creates no run, opens no attempt and stages nothing.
- A `.eml` costs nothing — it is unambiguously an email. Haiku, not the
  extraction model. The blob is addressed by PATHNAME and scoped to the project
  before a byte is read.

### One bill line, two things to make

`db/migrations/0024_record_variants.sql`, `src/lib/record-variants.ts`,
`src/lib/export-scope.ts`

The AP364 set draws S-201 twice, S-200 twice and S-301 **four times** —
identical geometry, different fabric and timber callouts, one bill line at 45
off. Both cards resolved to the same record, so `duplicateTargets` read them as
two documents fighting over one row and confirming the second offered to RETIRE
the first's fabric. The second fabric is not a correction of the first; they are
both true, and they are two different chairs to build.

0002 anticipated this and stopped one step short: `parent_id`, `depth` (capped
at 1) and `split_reason in ('fabric','configuration')` have existed since the
foundation, with the comment that "one ref legitimately becomes several jobs (a
fabric split, a configuration split)". **Nothing has ever written any of the
three** — a column is the same promise an empty table makes. What was missing
was a NAME: a split with only its own `record_no` reads as an unrelated line,
and what a person says out loud is "S-201 A".

Settled with Max on 2026-09-16, and each half is a trap:

- **The variants export; the parent does not.** A bill line with a live variant
  is a heading and its variants are the jobs. Three rows for one line, in a
  file that replaces rather than merges, reads as three items to make — the
  same class of error as a filtered export. The predicate is a correlated
  `not exists` on an ACTIVE variant, never a stored "has been split" flag:
  retire both variants and the parent is an item again, still 45 off on the
  bill, and a file that omitted it would wipe every BWS field it holds.
- **No quantity is apportioned.** The bill says 45 and never says how many are
  fabric A. Variants are created with `qty = null` and the screens say the 45
  is unallocated. `unallocatedQty` does NOT clamp a negative: variants adding
  up to more than the bill line is a real mistake, and hiding it behind a
  `Math.max` is how it reaches a quotation.
- **The client ref is unchanged.** `S-201` stays the ref, because a ref is the
  client's key and the letter is ours. One ref, several BWS jobs — what the
  pre-sale key model has always said.
- **A letter is never reused**, including a retired variant's: somebody quoted
  "S-201 C" in an email and it has to keep meaning that. Past Z,
  `nextVariantLabel` returns null rather than inventing `AA`.
- **`parent_id` is now `on delete cascade`.** It was `restrict` since 0002,
  which would have refused a project delete the moment anything was split —
  the lesson 0013, 0014 and 0015 each learned separately, found across a
  maintenance path for the third time.

**BUILT SO FAR: the migration, the library, the export rule and its db-tier
test — and all of it is INERT until something creates a variant.** No variant
exists, so the `not exists` clause matches nothing and the export behaves
exactly as before.

**The letter is DERIVED, never stored and never sent by the client.**
`variantLettersByItem` is a pure function of the staged document, so the review
screen and the confirm route reach the same answer without either telling the
other — the `proposalBlockers()` rule, and the reason a letter on the request
would be a client naming the record its data belongs to. Order is PAGE order
and it ignores review state: if dismissing page 5 turned page 6 from B into A,
every letter anybody had written down would mean something else. It folds codes
with `spec-document`'s `normaliseRef` — the one `findRecordsByRef` matches by,
NOT `boq-import`'s looser one — or cards would group as one code and resolve to
different records.

**`ensureVariant` find-or-creates one variant per (parent, letter)**, takes the
project row lock before allocating a `record_no` (the `boq-concurrency`
defect), copies the parent's identity, leaves `qty` null, creates the checklist
rows, refuses to un-retire a variant somebody retired with a reason — and
carries THE GUARD: a parent that already holds active `record_attributes`
cannot be split, because those specs would stay on a record the export has
stopped shipping and a confirmed fabric would vanish from the file. Thirteen
records in the sandbox already carry specs; S-200, S-201 and S-301 did not,
which is why the case in hand was clean.

**The confirm keeps TWO LISTS and they are not interchangeable.** `ordered` is
what the reviewer TICKED — the bill's own records, echoed back into the staged
item and compared against the live resolution on the next read, so writing
variant ids there would make every later confirm fail `targets_changed`.
`writeIds` is where the specs land. The write loop carries both per iteration,
because the replace acknowledgements are keyed on the record the reviewer SAW.
Snapshots are taken of the records that changed — a version of the bill line
would describe a heading nothing was written to.

**`occupancyThrough` re-keys rather than re-points.** The occupancy of the
record being WRITTEN, returned under the key of the record the reviewer ticked,
so `drawingItemBlockers` and `occupantsFor` work unchanged and go on naming what
is on the card. Two things come out right for free: a variant that does not
exist yet shows no occupants, because there is nothing there to replace; and
re-confirming over an existing variant shows that variant's values rather than
the bill record's, which is empty because a split parent is a heading. The same
function serves the confirm and `resolveStagedRun`, so the screen and the
confirm cannot disagree about whether a card can commit.

**A variant reads its PARENT'S `boq_code`.** `loadRecordAtoms` follows
`coalesce(r.parent_id, r.id)` for that ref system only — without it every split
item shipped a blank Client Code, since a variant deliberately carries no client
ref. A `bws_job` ref still belongs to the variant that earned it. The `Name`
column appends the letter (`Armchair (A)`), which is THIS REPO'S JUDGEMENT like
the rest of the job columns: two variants otherwise show BWS two identical jobs
against one client code. Confirm it against a real BWS import.

**The screens read it from both ends.** A configuration is sorted under its bill
line by `/api/records` — ordered on the PARENT'S `record_no`, because a variant
is allocated the next free number in the project and would otherwise land pages
away from what it belongs to (ordering on the parent id puts the groups in uuid
order, which is no order at all). It is indented there and named `S-201 A`, its
client ref read through the parent. The bill line says in words that its
configurations are what the export carries, or it reads as an item nobody has
specced. The record screen shows the family in whichever direction the record
sits in it: a bill line lists its configurations with what each has captured, a
configuration names the bill line it came from and links back.

**The unapportioned quantity is stated, never divided**, on both screens. The
bill says 45 and never says how many are fabric A.

**And the REVIEW screen is one card per CODE** (`src/lib/configuration-cards.ts`,
`src/components/imports/ConfigurationCard.tsx`, 2026-09-17). Four pages of
S-301 were four cards carrying a grey chip and a sentence, so the same four
dimensions were checked four times and the fabric — the only thing that
actually differs — was what got scrolled past. Now: one card, a chip per
configuration coloured by LETTER (A is always sky, so the chip finds its own
section), the geometry ONCE, each configuration's own finishes below it in its
own band, and a reviewed configuration collapsed to a line.

Five things about it are load-bearing:

- **What is shared on screen is still written per page.** An edit to the shared
  geometry table fans out to the MATCHING row on every configuration's page
  (`byMember`, keyed by `measuredKey`), each with its own version, in one
  batched save. That is the data model, not a shortcut around it:
  `record_attributes` holds what a PAGE said, so B's width comes from page 6 and
  carries page 6 as its source. Writing A's row to B would fabricate a source
  page or lie about one.
- **The confirm route is untouched.** One request still names ONE staged item
  and its whole pending set; the card issues several in letter order. A refusal
  on B leaves A applied — correct, and what the reloaded card shows — and the
  banner names what was written, what was refused and what was never attempted.
  Copying rows at confirm time instead would make B's atomicity depend on A.
- **One APPLIES TO for the card.** Ticking a run is a statement about the CODE.
  Per-page targets would let A apply to the VE run and B not, producing
  `S-201 A` under a bill line with no B. Where they currently disagree the tick
  is indeterminate and says so.
- **The pages may DISAGREE about the size, and that is never averaged.**
  `compareGeometry` compares SLOT signatures — not every measured row, because
  two pages of one chair routinely differ by a radius and failing the card over
  a 5mm reveal would put four tables back on screen. A difference is an amber
  notice naming each letter's figure, each configuration keeps its own, and it
  is NOT a blocker: it is either a configuration split or a misread, and both
  are a person's call.
- **`groupItemsByCode` is the one grouping.** `configurationGroup` compared
  `itemCodeRaw` RAW while `variantLettersByItem` folded it with `normaliseRef`,
  so `S-201` and `s 201` were lettered A and B and then printed under two
  separate headings. Both now call the same function. Grouping never crosses
  runs: letters are per staged run, so a code drawn once in each of two files is
  letter A in both and writes to the same variant — the pack's
  `duplicateTargets` banner is what reports that case.

**STILL OUTSTANDING:** nothing lets a person SET a configuration's quantity — the
gap is reported and there is no field to close it. And a record that already
carries confirmed specs cannot be split at all (`ensureVariant`'s guard), so the
thirteen records in the sandbox that hold specs would need those moved onto a
configuration first, which is a path that does not exist.

### A drawing dimensions everything, and four of them matter

`src/lib/drawing-document.ts` (`dedupeMeasured`, `foldableRow`),
`src/components/imports/ObservationRows.tsx` (`orderRows`)

The real S-201 armchair card carried **forty-three** measured rows. A figure
repeated on ONE view is one measurement — a front elevation prints 5, 5, 27, 27
because the chair is symmetrical — and `dedupeMeasured` collapses those, keyed
on the view label, the figure and the unit, keeping the FIRST so ids are stable
across reads. An unlabelled figure is keyed WITHOUT its label: `Dimension 37`
and `Dimension 42` are positions this app invented, not names the page gave.

**The ones that matter go first and the rest fold away.** Four of thirty-six
rows compose BWS field 3; the others are arm heights, gaps and radii. Inline
they bury the four. They are FOLDED, never dropped — what the document said is
the point of `record_attributes`, and a figure nobody can see is one nobody can
correct — with the count on the toggle so the card never implies the page says
less than it does.

**Which rows fold is the section above**: `isOverall`, as the model read it, not
"does the value state a figure". That older test is why a page whose
sub-dimensions were all `TBC` printed five rows of nothing inline.

### A swatch is cropped off the page it is printed on

`src/components/imports/SwatchPicker.tsx`,
`src/components/imports/PageCropper.tsx`, `src/lib/confirm-drawings.ts`

`project_finishes` has taken a swatch since 0018 and nobody ever added one. The
feature was not the problem; the flow was. A person had to find the finish, find
the PDF, find the page, screenshot a chip, save a file, upload it and then TYPE
which document and page it came from — which the swatch route requires,
correctly, because a picture nobody can trace to a page is a picture nobody can
check. A reviewer on a drawings card already has all of it: the page is open,
the document and page are known, and the chips are printed in the materials
panel.

- **`PageCropper` is one implementation**, shared by the item picture and the
  swatch. A second copy is how the two start disagreeing about what a click
  means — the 2% minimum is the difference between "no crop" and a one-pixel
  smear somebody has to notice and undo.
- **A swatch belongs to the CODE, not to the item.** `project_finishes` is
  unique on `(project_id, code_norm)` and `WD-05` is on three pages of the real
  set, so cropping it once crops it for every item carrying the code. That is
  the library's edit-once rule; the card says so, or somebody crops the same
  chip five times and wonders why the fifth won.
- **Nothing is uploaded until the card is confirmed**, like the item picture: a
  card nobody commits leaves no bytes in the store, and the finish the swatch
  attaches to does not exist until the confirm creates it.
- **Keyed by OBSERVATION; the finish is resolved server-side** from that row's
  own code. The client does not get to say which library row a picture belongs
  to — the `blob-source.ts` discipline, applied to the choice of target as well
  as to the pathname.
- **Refused, never dropped.** A row whose code does not resolve to one finish
  (a conflict with the library links nothing, by design) fails the confirm with
  that reason. Silently discarding a crop is how somebody comes to believe it is
  stored. **Supersede, never delete**, as the swatch route already does.

### One crop at a time, and never one nobody asked for

`src/lib/pdf-crop.ts`, `src/components/imports/ItemImagePicker.tsx`,
`src/components/imports/PagePreview.tsx`

Rasterising an A3 drawing is the most expensive thing the review screen does,
and three things were making it happen far more often than anybody asked:

- **The callback was in the effect's dependencies.** A card passes
  `onCropped={(image) => onImage(item.id, image)}` — a new function on every
  render — so every re-render of the card started a fresh crop. Measured on the
  real pack: **33 rasterisations for 12 picture panels.** `onCropped` now lives
  in a ref, so a crop depends on WHAT is being cropped and never on the
  identity of the function that receives it. A caller passing a lambda is
  ordinary React; the guarantee belongs in the component.
- **Nothing cancelled a superseded render.** `cropPdfRegion` takes a `signal`
  and cancels the pdfjs render task; the picker aborts the previous crop and
  its own on unmount, and treats a cancellation as "superseded" rather than
  showing *Could not render*. `tests/components/item-image-picker.test.tsx`
  holds all of it.
- **They all ran at once.** Crops are now serialised through one queue, so the
  first picture appears in a second instead of all of them appearing
  eventually, and two renders of the same page can never overlap — which is
  the one thing pdfjs asks a caller not to do.

And the document is fetched **in one request**: pdfjs's default keeps a
background download open and issues 64KB range requests on top, each going
through this app's route to a blob store in another region — 123 requests for
one visit, against a browser limit of six connections that the screen's own API
calls also need. `disableRange` and `disableStream` make it 1.

**A hidden tab renders nothing, and that is not a bug.** pdfjs drives canvas
rendering from `requestAnimationFrame`, which a background tab does not fire,
so every crop sits unfinished until the tab is looked at. Anybody verifying
this screen in a headless or hidden browser pane will see "Rendering…" for ever
and should not go hunting for a deadlock — check `document.visibilityState`
first.

### A fabric is a fabric, whatever the drawing calls the part

`src/lib/drawing-document.ts` (`classifyCallout`, `upgradeCalloutGuesses`),
`src/components/imports/ObservationRows.tsx`

The real S-100 sheet captions its upholstery `SOFA / Yarn Tessarae YC04158 -
01` — the PART in the label, as the prompt asks for, the CLOTH in the value —
and it staged as group *Other* with no BWS field, while its sibling `SOFA FEET
/ Dark tinted wood` landed correctly on "feet" and "wood". `classifyGroup` and
`suggestSpecField` each ran the same word lists over the same text
INDEPENDENTLY, so the row lost its group and its field in one go, and a
widened list could have fixed one and left the other.

`classifyCallout` is now the single reading and both call it — the
`composeDimensionCell` rule, in a third place. Its evidence stops at the first
thing that decides:

1. **The words**, widened to the vocabulary a swatch caption actually uses
   (`yarn`, `boucle`, `linen`, `mohair`, `chenille`, …). A fabric is named by
   its cloth, not by the word "fabric".
2. **The client's own finish code** — `UPH`/`FAB`/`COM` fabric, `WD`/`TIM`
   timber, `MT`/`MTL` metal. That is the page speaking. **`CH` is deliberately
   unmapped**: the real set prints `CH-01.2` and no page says what CH means.
3. **The caption names the item itself** (`SOFA` on a sofa page) and names no
   timber, metal or hardware → its upholstery. The ONLY inference here, so it
   is flagged `groupSuggested` and the card renders it yellow with its reason
   — the same treatment a guessed dimension slot gets. It requires the value to
   carry real text, so `PIPING / TBC` still classifies as nothing.

**`upgradeCalloutGuesses` runs at READ time**, like `upgradeDimensionSlots` and
`mergeNoteBlocks`, so a pack already read gains the corrected reading with no
second model call. It touches a row only when it is still `pending`, at
`version === 1` (nobody has patched it), holds no field, and is not a dimension
or a note — so a reviewer's decision is never second-guessed, and a merged note
block is never promoted to a fabric. It re-seeds `taken` from the rows that
already hold fields, so it cannot hand COM 1 to two rows.

**The register has to reach every reader.** `assertStagedDrawings` takes the
spec fields, and the review GET, its autosave PATCH, the pack screen and
`confirm-drawings` all pass them. A confirm that resolved the field differently
from the screen would be a cell the file does not deliver.

A fabric lands in the group **Materials and fabrics**, not *Finishes*: `finish`
is this app's word for timber and metal. The BWS field is the part that
matters.

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
  is no longer blocked for a reason that does not apply to it. The fallback still
  refuses a null level, and the level still picks the BWS boilerplate — so the
  spec table's "No level" row says what it is needed FOR rather than claiming it
  is missing from the TGQ figure.
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

### The overview's numbers are a second question

`src/lib/project-summary.ts`, `src/components/ui/StatTile.tsx`,
`src/components/ui/Tip.tsx`, `src/app/dashboard/projects/[id]/page.tsx`

"45 records in this project's export scope. 1,899 questions still missing or
TBC, and 6 records with no category" was one sentence answering neither
question a KAM has — **can I quote this**, and **what is stopping me**. The
overview is now a strip of pressable tiles and a table where every count sits
beside the control that acts on it.

- **`loadProjectSummary` is NOT `loadProjectCompletion` with more columns.**
  Completion answers one question, drives the pill on two screens, and has its
  clauses pinned to `loadExportScope` by a db-tier test. The summary answers a
  different one. They share the SCOPE and nothing else, and the predicate is
  duplicated for the reason completion duplicates it — the driver cannot share
  a SQL fragment. A summary describing a different set of records from the file
  is the check sheet's failure mode worn as a badge.
- **TGQ IS HIS MATRIX WHERE HE WROTE ONE, AND THE PLACEHOLDER WHERE HE DID
  NOT.** See the section below; the summary computes the identical rule in SQL
  and `tests/db/project-summary.test.ts` is where that has to be held true.
- **A tile is a filter and a link.** `StatTile` takes `href | null` — a tile
  with nothing to link to renders as a plain box, because a link that goes
  nowhere is worse than text. Every link off this page lands on the FIRST live
  run's tab, because `SpecTable` requires a `runId`; the merged view was deleted
  for listing three sub-quotes in one flat list.
- **`Tip` replaces a caption, but only where absence is harmless.** The test is
  whether a reader who never hovers would be MISLED. "No programme recorded —
  nothing can be flagged overdue" stays printed, because a project with no dates
  and a project on time otherwise render identically. If hiding it could mislead,
  it is not a tip.
- **A baseline is a green bar across the trail, and a key date is a violet one.**
  Everything in the history rendered identically, so a named point — the only row
  anybody reads deliberately — was grey text among forty. `label` is
  baseline-only by constraint (0012), so the kind and the name are the same fact.
  The key date is passed in as a `YYYY-MM-DD` STRING and compared with
  `daysUntilSpecsAgreed`: a component taking a `Date` here is where the TOE-dates
  trap would come back.
- **The details form is unchanged and hidden.** It opens on Edit and closes on
  save, with its validation, its date rules and its unsaved-changes warning
  untouched. It was the first and largest thing on the screen and is filled in
  once.

### Completed is computed, and there is no button

`src/lib/project-completion.ts`, `src/app/api/projects/route.ts`,
`src/app/api/projects/[id]/route.ts`

Asked for directly on 2026-09-17: a project becomes COMPLETED when every spec
that could be needed is in, rather than when somebody remembers to mark it.
So it is DERIVED on every read, for the reason Overdue and Waiting are: a
stored flag would be written when an answer changed, and writing it bumps the
version M2's snapshots and the chase coverage rows are taken against.

Four clauses, each a trap on its own:

- **It counts the EXPORT's scope** — active records on active runs, a split
  bill line counted through its configurations. The predicate is duplicated
  from `loadExportScope` because the driver cannot share a SQL fragment, so
  `tests/db/project-completion.test.ts` asserts the two agree on a real
  project. A pill reading COMPLETED over a different set of records from the
  file is the check sheet's own failure mode, worn as a badge.
- **TBC blocks it**, because TBC is an answer and not a settled one.
- **An uncategorised record blocks it.** It has NO questions, so it scores zero
  outstanding and would otherwise drag a project to COMPLETED by having been
  ignored.
- **Zero records is not complete.** An empty project is one nobody has started,
  and 0/0 rendering green is the empty-programme error again.

Archived wins the pill, because a project put away is put away whether or not
its specifications were ever finished. Both screens say what is outstanding in
words, so ACTIVE explains itself and COMPLETED is never a mystery.

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

### The record is four jobs, and a tab each

`src/app/dashboard/records/[id]/page.tsx`, `src/components/records/RecordDetails.tsx`

The record screen was one page of four stacked sections — the specs, the
checklist, the gates and the history — and the checklist alone is 43 questions.
So the history sat under about four screens of scrolling, and the fix applied at
the time was to collapse it behind a toggle. That is the wrong fix: a thing you
have to expand every visit is a thing people stop opening, and both the
checklist and the history were behind one.

They are four different jobs done at four different moments, so they are four
tabs. Five things about it.

- **The identity stays on every tab.** The picture, the description, the
  category and the level are what tell you which item you are looking at, so
  they are above the tab bar and not in any of them.
- **Category and level are above the tabs too, because they govern two of
  them.** The category is what creates the questions at all, and the level
  decides which block a quote under the fallback half of TGQ and which BWS
  boilerplate the item is priced against. Inside the checklist tab they would
  hide the reason the gates tab is empty.
- **Every tab carries its count**, so you can see where the work is before
  clicking — the project's run tabs' rule. The gates count is `n of 3` and
  **null where Matthew's matrix does not cover the category**: `0 of 3` there
  would say the record fails three gates, when it has none.
- **Versions is no longer collapsed.** It was behind a toggle because it sat
  under the checklist; on its own tab it can simply be the page. It still loads
  only when opened, which is why its tab carries no count — a number there would
  either be wrong or force a query nobody asked for.
- **The project-wide section folds LAST and CLOSED** (Stage 2 item 2.8 step
  1, 2026-09-20): `requirements.section = 'Project / commercial'` — TOE
  agreement, sales folder, the access and assembly-guide questions, identical
  on all seventeen sheets — renders as one collapsed card titled *"Project-wide
  — the same answer applies to every item"*, its outstanding count on the
  toggle, and a `#q-` deep link into it opens it. Nothing about the data
  changed; the constant lives in the leaf `src/lib/checklist-sections.ts` and a
  pure test holds it against the seed. Step 2 — answering once per project and
  fanning out — is built only if Matthew asks again after seeing this.
- **`RecordDetails` reads as a summary until Edit**, like the project's. Six
  inputs and two paragraphs of help above the tabs on every visit put the tabs
  themselves below the fold. The form inside is UNCHANGED, including the rule
  that matters most about it: it saves as ONE act rather than on blur, because
  typing the quote description, tabbing to Internal notes and typing there used
  to lose the second box.

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

### Every screen is three bands, and the primitives are the language

`docs/design-language.md`, `docs/design/spec-builder-mockups.html`,
`src/components/ui/` (`tone.ts`, `PageHeader`, `PageBody`, `Tabs`, `Card`,
`Table`, `Chip`, `Pill`, `Note`, `SuggestButton`), `src/lib/use-url-tab.ts`,
`/dashboard/design`, the `new-screen` skill

Max drew sixteen mock-ups on 2026-09-18 and signed them off, and the first
attempt at building them treated the file as a direction: tiles were
substituted wherever the approved one needed data that was not already loaded,
and the two were not like for like when he put them side by side (`17ff4e0`).
Every screen was then rebuilt to the file, and the rules it carries were
written down so the next screen does not have to rediscover them.

- **The mock-up file wins.** It is committed at `docs/design/` and is the
  acceptance artefact; `docs/design-language.md` says why each rule exists and
  `/dashboard/design` renders the primitives with the rule beside each. Where
  a built screen and the file disagree, the screen is wrong — the named
  deviations (TGQ for "Needed to quote", two widths, the three outputs in the
  header, the code's letter palette, no Columns chooser) are listed in the doc.
- **Colour is a meaning and lives in ONE file.** `tone.ts` holds eight tones
  as COMPLETE literal class strings — Tailwind's JIT purges anything it cannot
  read in source, so `bg-${tone}-700` renders unstyled with no error, and
  `tests/lib/tone.test.ts` guards it. Green is settled EVERYWHERE, which is
  why it belongs to COMPLETED and not ACTIVE: two screens had that inverted
  under a comment claiming they matched, and `PROJECT_STATE_TONE` beside the
  label is what stopped a screen picking its own. Yellow (a guess, a whole
  row) and amber (needs a person) are different and a row can be both; slate
  dashed (nowhere to record it) is deliberately never red.
- **Three bands, two widths.** `PageHeader` is the one `h1`, ALWAYS 1100px
  wide; `PageBody` is `std` or `wide`. The header row wraps and the title has
  a floor (`min-w-[18rem]`): with `shrink-0` on the actions the project name
  became an 80px column beside the export cluster.
- **A tab strip anything links INTO lives in the URL** (`useUrlTab`); one
  nested in a review component keeps `useState`. The hook never writes on
  read — while runs are loading the fallback renders and `?tab=<runId>` is
  left alone, or the record screen's back link would be destroyed by the page
  it points at.
- **A suggestion is a component with a REQUIRED evidence prop, not a fifth
  `Button` variant.** The four variants grade an action's consequence; a
  `SuggestButton` could otherwise be used with no evidence beside it, which is
  a guess accepted blind.
- **Every number the mock-up shows comes from the loader that already computes
  it.** `loadOutstanding` + `groupByContact` for Owes us, `waitingByQuestion`
  for "chased 15 Sept", `describeChange` for the inbox's "n change a confirmed
  value", `gatesForRecord` for the matrix table — never a SQL re-expression,
  which is how two screens came to disagree about TGQ. Where the data does not
  exist the element is omitted and the gap is written down, never replaced
  with a number that happened to be free.
- **The environment marker is a chip, not a banner**, at Max's decision, and
  `house/conventions.md` §2 was changed to say so rather than departed from.
  `EnvironmentChip` is a server component passed INTO `NavShell`, because a
  client fetch fails toward hiding it on exactly the deployment that matters.

The DOM rules a restyle breaks silently are collected in the doc: a spanning
panel is its own `<tr>`, no `overflow-hidden` on a sticky-header table
wrapper, `clampText` not CSS `line-clamp`, `onCropped` in a ref, the record
picture a grid track. **Human acceptance is outstanding on every screen** until
Max has put each beside its mock-up tab.

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

Next.js 15 (App Router), React 19, Tailwind 3 on Vercel, functions pinned to
`lhr1`; Neon Postgres in London, forward-only numbered SQL in `db/migrations/`
with a `schema_migrations` ledger; own users table with scrypt hashes and a
`jose` JWT in the `sb_session` cookie; Vercel Blob, private, client-direct
upload; Vitest.

**Three environments, physically separate** (`docs/environments.md`):
**staging** — Vercel `spec-builder-app`, the sandbox Neon project, deployed
from the `staging` branch on every push; **pilot** — Vercel
`spec-builder-pilot`, its own Neon project `SpecBuilder Pilot` and its own
blob store, `APP_ENV=pilot`, deployed from the `pilot` branch which only ever
fast-forwards to a commit already on `staging`, by Max, through the promotion
checklist — Matthew's stable build and NOT production; **production** — does
not exist yet. Local development points at the sandbox and never at either of
the others.

**Active integrations:** Anthropic (M2 extraction) — a key is set in Vercel
staging and verified calls have been billed, including one against an email.
Capsule CRM (contacts) — read-only, built 2026-09-16, no token set yet. Microsoft Graph read-only mailbox
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
| The design language: the eight rules, the tones, the primitives, the DOM traps | `docs/design-language.md` (and `/dashboard/design`) |
| Accepting the export against the pack: the check sheet and its verdicts | `docs/plans/export-verification.md` |
| Accepting the DRAWINGS REVIEW against the pack: the per-card checklist | `docs/plans/intake-review-verification.md` |
| Releases, dated decisions, what is still open | `docs/plans/README.md` |
| Things seen wrong in use and not yet fixed, dated | `docs/plans/found-in-use.md` |
| The stabilisation plan after the catchup: stages, the editing model, the variance matrix, the definition of done | `docs/plans/make-it-work-2026-09-19.md` |
| Migrations, seeds, backups, restores | `db/README.md` |
| Chassis provenance and how to start another app | `docs/kit/` |

Task procedures live in `.claude/skills/`, mirrored to `.agents/skills/` — keep
the copies identical: `verify`, `new-migration`, `ship-to-staging`,
`queue-backed-job`, `extraction-pipeline`, `review-and-confirm`,
`email-draft-and-send-gate`, `external-vocabulary-sync`, `new-screen`,
`meeting-recap`. If a skill goes stale,
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

**SharePoint is an authorised source of real test data (Max, 2026-09-19):**
*"whatever's on SharePoint, you can use — to tune extraction or to populate
the database"*, fetched through the Microsoft connector without asking, READ
ONLY, and never for the repo: a real document goes into the SANDBOX as a
staged run inside a test project, and the fixture that holds the rule it
exposed is written synthetic afterwards. A real pack is read ONCE — each
specification document is a charged call — and reused as `__QA` copies and
through the read-only dump/measure tools. Two prefixes, two fates:
`__QA ` projects are swept by the cleanup scripts; **`TEST` projects stay**,
named for what they exercised and when (`TEST: intake, 300-line bill
(2026-09-24)`), left in a state worth demonstrating, and never matched by a
sweep. Not excessively many. The Panther pilot stays curated regardless.
`docs/plans/make-it-work-2026-09-19.md` §2.7 carries the reasoning.


## Current milestone and scope

A stale status section is worse than none, because agents and people both make
decisions from it. The full dated list is in `docs/plans/README.md`.

### M8 — the Panther pass. Still the milestone; the ORDER changed on 2026-09-18.

**Read `docs/plans/catchup-2026-09-18.md` before planning against this
section.** M8's four steps are unchanged and step 4 is still what "done" means.
What changed is what comes first: Matthew is now using the app himself (D4), and
he and Max agreed to stabilise rather than build (D5). Work that lets him get
through a first session beats work that adds anything.

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
closed on staging**. Remaining and Max's: 0033 onto pilot, the promotion, the
script on pilot, the hand-over message. **Stage 1b is built and
deployed at `da863b7`**, at Max's instruction of 2026-09-20: packaging lines
suggested for ignoring, one summary line on the pack, a document's state as a
pending count, the swatch reaching page 2, a level set on the drawings card,
and the crop investigation concluding that the prompt is the fix (deferred to
the finishes-schedule re-read). Not accepted by anybody. The whole of Stage 1
is therefore on staging; the pilot promotion (0033 first), the script on
pilot and the hand-over message are Max's.

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
slot*) and **2.10.g** (the failure sweep: every `catch` and every fetch under
the dashboard reaches a rendered sentence, three fixed) at `d1e56b3`: the demo sofa reads `W1830 x D880 x H760 x SH440mm (1250 L-shaped
return)` on its Specs tab, its checklist and the BWS export after one Save,
one change set and one version. Not accepted by anybody. **Blocked
and saying so:** 2.1/2.2 (no BWS account for Max), 2.9 (a proposal for
Matthew), 2.11 (the rate cap first, then Max's own amendment of the inbound-
email gate above), 2.12 (another session's plan). Nothing promotes to pilot
until Max has driven 2.3 and 2.5 as the roles they are for (§7.5).

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
  the registration section). What is NOT capped yet: *Read all* on the
  drawings review (briefed), and an attempt that passes its 24-hour deadline
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
notes into later model calls; a BWS *import* file carrying job numbers; PDF bills of
quantities; images and scanned documents; splitting an oversize drawing set. M6
VE rounds. Any write to BWS. Automatic email sending.
SharePoint writes (and SharePoint READS as an intake source, which Matthew asked
about on 2026-09-18 without requesting). BWS Messenger and Teams ingestion. The
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
delta semantics and the message shape Graph really sends are NOT. Turning it on is five environment
variables and a redeploy, and the first real message is the test that matters:
`docs/integration.md` carries the checklist, including the access-policy check
that must pass in BOTH directions.

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
