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
| `npm run db:backfill-answer-provenance` | one-off after 0050 (2026-11-06): marks every answer composed from a record's specs as `source_kind = 'attribute'`, recomposes the ones that had stopped following them (a retired spec's answer goes back to missing), leaves a reviewer's own schedule answer alone, and prints what it cannot decide. Dry run unless `--apply`; safe to re-run; `--yes-pilot` / `--yes-production`; `:local` for the local stack. The decision table is `src/lib/answer-provenance-backfill.ts`. `db:backfill-answers` is RETIRED: it predated qualifiers, the library and BW standards and would have corrupted answers |
| `npm run db:backfill-snapshots` | one-off: gives every record that predates 0012 a version 1 under a `history_begins` change. Dry run unless `--apply`; safe to re-run |
| `npm run db:backfill-bill-swatches` | one-off: for bills confirmed before 2026-10-05, gives each fabric code the picture its bill lines printed as its swatch, and files uncoded real fabrics as in-house finishes — the same rule the bill confirm now runs (`src/lib/bill-fabric-filing.ts`). Dry run unless `--apply`; safe to re-run; `--yes-pilot` / `--yes-production` |
| `npm run db:backfill-finish-twins` | one-off: merges library rows that are one finish under two codes (a bare code and its zone twin, `MTL-01` / `GR-MTL-01`; and `fabricOwnCode` twins, `GR-FAB-13 PL-FUR-04`) into the canonical row, re-links their specs, recomposes answers, one version per record, one change set per project. A twin holding a different description, swatch or BW standard is skipped and named; an emptied twin is retired, never deleted. Dry run unless `--apply`; safe to re-run; `--yes-pilot` / `--yes-production` |
| `npm run db:backfill-finishes` | HISTORICAL (audit B9, 2026-11-06): kept only because the finishes page names it as the way to link unlinked codes. It predates the zone-twin lookup (run `db:backfill-finish-twins` after it) and recomposes no checklist answer; its header says so and it warns when run |
| `npm run db:delete-project -- --project=<id or number>` | deletes ONE project by SCRIPT, never from the app (Max, 2026-11-06): the dry run lists every table's rows, every file under `projects/<id>/` and the mail that survives unassigned; `--apply` deletes the rows in one transaction, re-counts before commit, then the files. `--yes-pilot` / `--yes-production`; a `TEST` project also needs `--yes-test`; `:local` for the local stack. `audit_log` is left alone |
| `npm run db:qa-clean` | sweeps what a failed database-tier test run left behind, through `db/project-delete.mjs` (rows only; matches `left(name,5) = '__QA '`, never `like`, where `_` is a wildcard). Refuses production outright. Never while another run is in progress |
| `npm run qa:fake-inbox` | invented correspondence for the inbox screen, recorded through the app's own `recordMessage` so the routing outcomes are real. Sandbox only, no production flag. Dry run unless `--apply`; `--clear --apply` sweeps it, keeping any message somebody has since assigned |
| `npm run qa:levels -- --project=<ref>` | makes up a level for every line item and a designer contact behind them, so the chase screen can be walked before anybody has decided either. Levels go through `setRecordLevel`; the designer code is a plain update, because nothing in the app edits what a BOQ said. Same guards, and `--clear --apply` puts it back |
| `npm run qa:demo` | a WHOLE invented project — bill, drawings, preamble, correspondence, finishes, pictures and a checklist worked up to ~83% — so the app can be walked through in front of somebody. Built through the app's OWN confirms, so what is on screen is what the app does; no model is called and nothing is charged. Sandbox only, no production flag. Dry run unless `--apply`; `--clear --apply` sweeps it (`like 'DEMO%'`). Takes ~15 minutes, nearly all of it the checklist. It also writes ONE document it does NOT load, to `demo-documents/`, so there is something to upload live |
| `npm run dev:local` · `npm run checks:local` · `npm run db:migrate:local` · `npm run db:seed:local` | THE LOCAL STACK (2026-09-23): the whole app on this Mac against a local Postgres, a local fake Blob server and in-process reads, with `.env.localstack.local` and NEVER `.env.local`. It is where Claude verifies in a browser and runs the database tier, because the sandbox is company data and read-only for Claude by organisation policy. `docs/environments.md`, "The local stack". Every other `db:*`, `qa:*` and `checks` script reads `.env.local`, which is the SANDBOX: run the `:local` ones, in a worktree with no `.env.local` |
| `npm run create-user` · `npm run hash-password` | there is no self-signup |
| `npm run dump:drawings -- --run=<id>` | read only: what a staged drawing run reduces to through the REAL read-time pipeline — measured rows, placed slots, folded rows, unit provenance, the composed BWS cell. Run it before and after a change to that pipeline; the diff is the change |
| `npm run vocab:gap` | read only: every label the staged documents carry, which route places it (slot / BWS field / question), what is left, and — the point — what a looser rule would have wrongly written instead. Run it before seeding `requirement_aliases`, and read the NEAR MISSES before adding one |
| `npm run boq:gap -- <folder> [--golden <dir>] [--categories]` | read only, no database: what every bill in a folder reduces to through the real reader — how the header was found, the column map, lines, lines with no code or qty, row kinds, qty sum, finish lines written to more than one item — and, with `--golden`, line/code/quantity/fabric-parent accuracy against hand-checked expectations kept OUTSIDE the repo; `--categories` gives each line's suggested category off the seed files. It is how "the reader nails this specifier" becomes a number |
| `npm run db:backfill-standards` | one-off: where a palette pick at intake OVERWROTE the drawing's words (before 0041), puts the words back into `value` and the pick into `standard_*` as `proposed`, read from the staged run. Dry run unless `--apply`; safe to re-run; ambiguous rows are reported, never guessed |
| `npm run spec:gap -- <runId>` | read only, local stack: a specification-document run's proposals by outcome (placed / record only / ambiguous / nothing) as STAGED and as a free re-match would leave them, and the top unplaced labels. Run it before and after any change to `spec-reading-vocab.ts` |
| `npm run palette:gap` | read only: every callout that lands on a palette-backed BWS field, how many match an option exactly, and — the point — what a SUBSTRING step would have written instead. Run it before widening the match past the exact step. On 2026-09-22 it read 98 callouts over 47 staged runs, **0 matching and 0 near misses**, which is the evidence §6.2 asked for |
| `npm run bill:descriptions -- <bill.xlsx> [--layouts f.json] [--kinds golden.json] [--out file]` | read only: per item line, the name, the composed dimension cell, each finish with its field and each note — exactly what the confirm will write from the description cells. Output goes OUTSIDE the repo. Run it before and after changing the reader. On the real Aman bill, 2026-09-30: 67 of 67 read, 61 with dimensions (164 slots), 70 finishes (64 in a BWS field) |
| `npm run pdf:schedule -- <out.xlsx> <schedule.pdf> [...]` | read only: a schedule that arrived only as a PDF PRINTED FROM EXCEL (the Ronnie Scott's procurement schedules, 2026-10-15) put back into a workbook, one sheet per file, by the PDF's own text layer — columns by the header's label positions, rows anchored on ORDER QTY, no model. Pictures are not carried. Output OUTSIDE the repo; read the rows it prints against the PDF before uploading. Ask the specifier for the native workbook first |
| `npm run db:backfill-ref-norm` | one-off (5.4): re-folds `spec_record_refs.ref_value_norm` with the one `normaliseRef`; dry run unless `--apply`; reports a pair that now collides and never merges it; `--yes-pilot` / `--yes-production`; `:local` |
| `npx tsx --env-file=<env> tools/orphan-blobs.ts` | read only: every stored file under `projects/` and `mailbox/` that no `attachments`, `email_messages` or staged `intake_runs.parsed` row names. Lists, never deletes |
| `node tools/localstack/ci.mjs` | what the CI `db-tier` job runs after `db/run-migrations.mjs` and `db/run-seed.mjs`: the whole suite with the database tier REQUIRED, on a throwaway Postgres 17, through the stack server and preload. Reads no env file; rehearse it with `env -i` and the four declarations on a fresh `createdb` and a free `LOCAL_STACK_PORT` (its header). A port in use is refused, never taken over |
| `node tools/overflow-audit.mjs` | read only, against a DEV server (`PLAYWRIGHT_DIR`, `QA_EMAIL`, `QA_PASSWORD`, `BASE` as for `first-session.mjs`): walks the projects list, a project's tabs, two records' four tabs, fill-in, the inbox and the document reviews at 1920 and 1440, and exits 1 on any box wider than itself. Run it after any screen change |

Tests run in FOUR tiers — pure / component / db-gated / route. **A db-tier
fixture never chooses a row by uuid order** (`order by id limit 1`): uuids
differ per database, and CI's first fresh database picked a category on
Matthew's matrix where the shared one had picked an unmapped one
(`intake-routes.test.ts`, 2026-11-06). Choose by slug or key. **A db-tier
fixture asks for its project number** — `qaNumber("P90010")` from
`tests/db/db-tier.ts`, which appends a per-process suffix after the `__QA `
prefix the sweep matches on — because two agents running the tier at once is
the plan's normal state and a literal `'__QA P90010'` in two runs collides on
`projects_bws_project_number_key`, failing the loser in `beforeAll` and then
again in `afterAll` with an empty uuid (2026-09-21, found three times in one
day). The same goes for any other shared key a fixture writes — a mailbox, a
subscription id, a scratch table, a `shared_inbox`. Two things it does NOT
cover, both logged: the COMPONENT tier times out under machine
saturation (two unbounded runs are sixteen forks on eight CPUs), so a second
concurrent `checks` runs as **`npm run checks:shared`** (`VITEST_MAX_FORKS=4`,
read by `vitest.config.ts`). **`--maxWorkers=4` on its own does NOT work here**
and never did: vitest leaves `minWorkers` at the CPU count, tinypool throws
`options.minThreads and options.maxThreads must not conflict`, and ZERO tests
run behind a non-zero exit — advice that could not be followed, corrected
2026-09-22. `chase-drafts.test.ts` no longer mutates the seeded
`requirements.tgq_levels`; it inserts its own category and requirement rows,
so a concurrent run cannot read `later` where it expects `to_quote`. The database
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
- Placing an INBOUND email on a project starts the charged read. The app
  assigns one automatically ONLY where routing decided on the two strongest
  signals — the project inbox in the forwarding headers, or in To/Cc — and
  the inbox says so in words with Unassign beside it, under the actor
  `system:router`. A subject reference or a known sender is HELD for a
  person; an ambiguous outcome is always held; nothing is ever auto-assigned
  from one. Every automatic read counts against a per-project DAILY cap:
  runs a `system:` actor created on the project since midnight UTC, at most
  `AUTO_READ_DAILY_CAP` (default **20**, Max 2026-11-06); over it the message
  is HELD with "The automatic-read cap for this project (20 a day) is
  reached; a person starts this read", never refused or dropped, and a
  person's Assign is never capped (`src/lib/auto-read-cap.ts`, audit A5 —
  until then the only cap was three reads IN FLIGHT, and this sentence
  described a cap that did not exist). **Only STAMPED evidence auto-assigns**
  (audit A8): a forward needs `X-MS-Exchange-Organization-AutoForwarded:
  true`, and a recipient must be among the `toRecipients`/`ccRecipients`
  Graph REPORTS with no `X-MS-Exchange-Organization-Recipient-P2-Type: Bcc`
  stamp; `Resent-*`, `X-Original-To`, `Delivered-To`, `X-Forwarded-To` and the
  MIME's own To/Cc are headers any outside sender can write, so a message
  naming a project inbox only through them is HELD with the project named.
  Whether Exchange stamps these on this organisation's real shapes is
  UNKNOWN: `docs/integration.md` "The spend guards" measures it on the first
  real messages, and absent stamps hold mail, which is the safe direction.
  (Amended by Max, 2026-09-21 — "yes, amend" — Stage 2 item 2.11.)
  **An automatic assignment opens NO `change_sets` row, and that is decided,
  not overlooked** (3c.4, 2026-09-22; the reasoning in full at the head of
  `src/lib/email-registration.ts`). A change set is a change to specification
  CONTENT and `record_snapshots` is its output — assignment writes neither, and
  the whole-database coverage assertion rests on a change and a version being
  the same fact. The email's EFFECT already opens one (`email_confirm`, with
  the `.eml` as evidence), most assigned mail records nothing at all, and what
  the gate asks — that a charged read be ACCOUNTED FOR — is answered more fully
  on the screen for mail: the row says "assigned automatically" with the signal
  that decided it and Unassign beside it, `audit_log` carries every write under
  `system:router`, and the inbox counts the reads that FAILED, which is the
  half nobody could see. If it is ever overruled, that file states the exact
  shape and its cost: a migration re-listing the whole CHECK from the LIVE
  constraint, and a re-reading of the coverage test, because such a change set
  would carry no version by design.
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
| `projects` | BWS project (`P17231`), TOE key dates (nullable), shared inbox, `finish_code_prefix` (0044: the `AMB` in `BW-AMB-001`) |
| `spec_runs` | A PHASE: a sub-quote, normally one BOQ tab. "Phase" is the word on screen (2026-09-19); the table keeps its name. Name (editable), `source_sheet`, `boq_revision`/`boq_date` (**text**), `header_notes`. Retired, never deleted; two phases may share a name |
| `project_contacts` | Who to ask. `designer_code` joins `spec_records.designer`; `capsule_party_id` is the modelled person (0022), optional and flagged when absent |
| `spec_records` | One per BOQ line. `level` (`simple`/`complex`/`hero`, nullable, a person's decision beside the category — nothing infers it, and `level_suggested` (0025) is where a guess goes instead, where no gate can read it). `run_id` **not null**. `record_no` is the human-facing identifier (`P17231-014`) and stays project-wide across runs; splits are `parent_id` + `depth` + `split_reason` **on this table**, capped at one level. `variant_ordinal` (0039) is a configuration's number under its line — the 3 in `12.3` — allocated by the `assign_variant_ordinal` insert trigger (max + 1 over every sibling, retired included, never reused); the label is `src/lib/record-label.ts` and nothing else. `qty_unit` (0040) is the bill's own unit, verbatim. `qty_raw` (0059) is the bill's quantity cell as printed where it gave no count (`TBC`, `1,200`); screens print `quantityNotGiven(qty_raw)` |
| `record_attributes` | What a document SAID about an item: group, label, value, `unit` (dimensions only), the client's own `material_code`, `spec_field_id`, `state` (`confirmed`/`tbc`), source run and page. Multi-valued, requirement-free. `standard_*` (0041) is the BW standard BESIDE what the document said — `value` is always the document's words |
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
| `boq_column_aliases` / `boq_layouts` | 0040: which bill heading means which column role (whole-heading match, seeded with the reader's original list — an EMPTY table fails every bill registration, so seed wherever 0040 is applied), and a person's saved column mapping for one specifier's layout. Layouts are GLOBAL, which is why db-tier fixtures use a per-run heading |
| `project_finishes` | The project's finishes library (0018), keyed by the client's own code. Project-scoped: `MOR005` means different things on different projects. Carries BW's own finish for the code (0045, the six `standard_*` columns 0041 put on attributes) |
| `spec_matrix_categories` / `spec_matrix_category_map` | Matthew's nine seating categories (0026) and which of our seventeen cheat sheets each one is. Many-to-many both ways; an unmapped sheet gets no gate view, which is a real answer |
| `spec_field_gates` | His decision matrix as a seeded overlay (0026): gate, capture, BWS field or `local_key`, `dimension_slot`, `applies_to`, palette, conditional. `matrix_row` is his own `#`, so a re-issued workbook diffs |
| `bws_boilerplates` | The 45 BWS product codes (0031), 18 of them mapped to one of Matthew's nine seating categories as a Simple/with-Metalwork pair. BW's own codes, not client material — the `spec_fields` precedent |
| `spec_palettes` / `spec_palette_options` | The closed lists a spec field offers (0030), `option.code` since 0035. Eleven palettes; the five BWS-owned ones held ZERO options until they were READ from BWS on 2026-09-22 and seeded by `db/seed/0011` (96 options). The empty state was the honest one while it lasted, and `isOfferable`/`unheldPaletteNote` stay live for the next unheld list |
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

**Since 2026-11-07 the sections live in `docs/load-bearing/`, one file per
area, moved from this file unchanged (audit Stage 5.5: at 5,900 lines this file
was past what anybody reads, and a rule nobody reads is a rule nobody keeps).
This index is the map: read the file your change touches BEFORE the change,
and read the heading list below the way the old file was read, as the list of
traps. A new section goes in its area's file and gets one line here.**

**Bills of quantities** — `docs/load-bearing/bills.md`
- [A printed number is read once, and a comma is refused, not guessed](docs/load-bearing/bills.md#a-printed-number-is-read-once-and-a-comma-is-refused-not-guessed)
- [A BOQ has tabs, and each tab is a sub-quote](docs/load-bearing/bills.md#a-boq-has-tabs-and-each-tab-is-a-sub-quote)
- [A bill line's description cell is a name and its specifications](docs/load-bearing/bills.md#a-bill-line-s-description-cell-is-a-name-and-its-specifications)
- [A seeded bill layout reads like a known heading, and may carry a row rule](docs/load-bearing/bills.md#a-seeded-bill-layout-reads-like-a-known-heading-and-may-carry-a-row-rule)
- [A revised BOQ replaces the bill and keeps the drawings](docs/load-bearing/bills.md#a-revised-boq-replaces-the-bill-and-keeps-the-drawings)
- [A bill is never refused; it is mapped](docs/load-bearing/bills.md#a-bill-is-never-refused-it-is-mapped)
- [Four new bills: what a specifier's own layout broke, and the rules that hold it](docs/load-bearing/bills.md#four-new-bills-what-a-specifier-s-own-layout-broke-and-the-rules-that-hold-it)
- [A procurement schedule is a bill: the model reads its columns, and a Dims cell is read line by line](docs/load-bearing/bills.md#a-procurement-schedule-is-a-bill-the-model-reads-its-columns-and-a-dims-cell-is-read-line-by-line)
- [A PDF bill is read by its text, and the workbook it makes is the bill](docs/load-bearing/bills.md#a-pdf-bill-is-read-by-its-text-and-the-workbook-it-makes-is-the-bill)
- [A PDF bill code cannot read is transcribed, and every line says so](docs/load-bearing/bills.md#a-pdf-bill-code-cannot-read-is-transcribed-and-every-line-says-so)
- [A bill's own specification read resolves by ROW, and a long sheet is read in windows](docs/load-bearing/bills.md#a-bill-s-own-specification-read-resolves-by-row-and-a-long-sheet-is-read-in-windows)
- [The bill fills the finishes library, and BW's finish is set once per code](docs/load-bearing/bills.md#the-bill-fills-the-finishes-library-and-bw-s-finish-is-set-once-per-code)

**Drawings and the model read of them** — `docs/load-bearing/drawings.md`
- [A page code that is the END of a bill code, and a tag drawn as boxes](docs/load-bearing/drawings.md#a-page-code-that-is-the-end-of-a-bill-code-and-a-tag-drawn-as-boxes)
- [One drawing, several runs: the item card is the unit of commit](docs/load-bearing/drawings.md#one-drawing-several-runs-the-item-card-is-the-unit-of-commit)
- [Register-free kinds resolve at READ time, not in the worker](docs/load-bearing/drawings.md#register-free-kinds-resolve-at-read-time-not-in-the-worker)
- [A page the reviewer will dismiss must not cost what a page costs](docs/load-bearing/drawings.md#a-page-the-reviewer-will-dismiss-must-not-cost-what-a-page-costs)
- [The drawing read asks for ITEMS, not pages (staged schemaVersion 4)](docs/load-bearing/drawings.md#the-drawing-read-asks-for-items-not-pages-staged-schemaversion-4)
- [The model says which figure is the width; nothing sorts them by size](docs/load-bearing/drawings.md#the-model-says-which-figure-is-the-width-nothing-sorts-them-by-size)
- [One finish stated on two pages is one finish](docs/load-bearing/drawings.md#one-finish-stated-on-two-pages-is-one-finish)
- [One bill line, two things to make](docs/load-bearing/drawings.md#one-bill-line-two-things-to-make)
- [A configuration is what the document TELLS APART, named as the document names it](docs/load-bearing/drawings.md#a-configuration-is-what-the-document-tells-apart-named-as-the-document-names-it)
- [A person can add, rename and retire a configuration](docs/load-bearing/drawings.md#a-person-can-add-rename-and-retire-a-configuration)
- [A drawing dimensions everything, and four of them matter](docs/load-bearing/drawings.md#a-drawing-dimensions-everything-and-four-of-them-matter)
- [A swatch is cropped off the page it is printed on](docs/load-bearing/drawings.md#a-swatch-is-cropped-off-the-page-it-is-printed-on)
- [One crop at a time, and never one nobody asked for](docs/load-bearing/drawings.md#one-crop-at-a-time-and-never-one-nobody-asked-for)
- [A fabric is a fabric, whatever the drawing calls the part](docs/load-bearing/drawings.md#a-fabric-is-a-fabric-whatever-the-drawing-calls-the-part)
- [A page that reported no picture proposes the page itself](docs/load-bearing/drawings.md#a-page-that-reported-no-picture-proposes-the-page-itself)

**Specs, answers, corrections and the finishes library** — `docs/load-bearing/specs-and-finishes.md`
- [The spec record and its client ref](docs/load-bearing/specs-and-finishes.md#the-spec-record-and-its-client-ref)
- [A staged proposal is addressed by UUID, never by position](docs/load-bearing/specs-and-finishes.md#a-staged-proposal-is-addressed-by-uuid-never-by-position)
- [The finishes library is set out from a list, not from a scan](docs/load-bearing/specs-and-finishes.md#the-finishes-library-is-set-out-from-a-list-not-from-a-scan)
- [A palette BWS owns is READ from BWS, and never invented](docs/load-bearing/specs-and-finishes.md#a-palette-bws-owns-is-read-from-bws-and-never-invented)
- [A spec value has a second line, and the file gets one line](docs/load-bearing/specs-and-finishes.md#a-spec-value-has-a-second-line-and-the-file-gets-one-line)
- [A person can add a record, a spec and a note, and none of it has a page](docs/load-bearing/specs-and-finishes.md#a-person-can-add-a-record-a-spec-and-a-note-and-none-of-it-has-a-page)
- [A confirmed spec can be CORRECTED, and the correction keeps the page](docs/load-bearing/specs-and-finishes.md#a-confirmed-spec-can-be-corrected-and-the-correction-keeps-the-page)
- [A second document never silently beats the bill: it is kept beside it, in red](docs/load-bearing/specs-and-finishes.md#a-second-document-never-silently-beats-the-bill-it-is-kept-beside-it-in-red)
- [An attribute carries through to the checklist automatically](docs/load-bearing/specs-and-finishes.md#an-attribute-carries-through-to-the-checklist-automatically)
- [A spec reaches its BWS field by slot or by field, never by matching a question](docs/load-bearing/specs-and-finishes.md#a-spec-reaches-its-bws-field-by-slot-or-by-field-never-by-matching-a-question)
- [The record is the unit of commit, and a half-applied card is the failure](docs/load-bearing/specs-and-finishes.md#the-record-is-the-unit-of-commit-and-a-half-applied-card-is-the-failure)
- [A spec can be retired, and a revised drawing replaces one](docs/load-bearing/specs-and-finishes.md#a-spec-can-be-retired-and-a-revised-drawing-replaces-one)
- [The finishes library is the truth; the attribute is the evidence](docs/load-bearing/specs-and-finishes.md#the-finishes-library-is-the-truth-the-attribute-is-the-evidence)
- [A line's common specs are a reading, and an edit to one fans out](docs/load-bearing/specs-and-finishes.md#a-line-s-common-specs-are-a-reading-and-an-edit-to-one-fans-out)
- [A BW standard sits beside the client's words, and one function decides which ships](docs/load-bearing/specs-and-finishes.md#a-bw-standard-sits-beside-the-client-s-words-and-one-function-decides-which-ships)

**Email, the inbox and the upload** — `docs/load-bearing/email-and-inbox.md`
- [An email is a specification document whose page is a sentence](docs/load-bearing/email-and-inbox.md#an-email-is-a-specification-document-whose-page-is-a-sentence)
- [One email, one code, three runs — and one row per spec](docs/load-bearing/email-and-inbox.md#one-email-one-code-three-runs-and-one-row-per-spec)
- [The upload works out what each file is](docs/load-bearing/email-and-inbox.md#the-upload-works-out-what-each-file-is)

**Extraction attempts, slots and the queue** — `docs/load-bearing/extraction-and-model.md`
- [Registering a specification document SPENDS MONEY](docs/load-bearing/extraction-and-model.md#registering-a-specification-document-spends-money)
- [An extraction attempt is owned by two identifiers](docs/load-bearing/extraction-and-model.md#an-extraction-attempt-is-owned-by-two-identifiers)
- [A failure names its reason on the row, and the panel stays open](docs/load-bearing/extraction-and-model.md#a-failure-names-its-reason-on-the-row-and-the-panel-stays-open)

**Gates, TGQ, the chase and the fill-in** — `docs/load-bearing/chase-gates-tgq.md`
- [A gate slot is settled by a figure, and a Dia stands for W and D (provisional)](docs/load-bearing/chase-gates-tgq.md#a-gate-slot-is-settled-by-a-figure-and-a-dia-stands-for-w-and-d-provisional)
- [Gate rules read state, not strings](docs/load-bearing/chase-gates-tgq.md#gate-rules-read-state-not-strings)
- [A gate belongs to a FIELD, and the same field sits at two gates](docs/load-bearing/chase-gates-tgq.md#a-gate-belongs-to-a-field-and-the-same-field-sits-at-two-gates)
- [The gates BUILD ON EACH OTHER, and only the chained reading is called satisfied](docs/load-bearing/chase-gates-tgq.md#the-gates-build-on-each-other-and-only-the-chained-reading-is-called-satisfied)
- [A chase records that a question was asked, and writes no answer](docs/load-bearing/chase-gates-tgq.md#a-chase-records-that-a-question-was-asked-and-writes-no-answer)
- [A quote is blocked by SOME of the questions, and the email says which](docs/load-bearing/chase-gates-tgq.md#a-quote-is-blocked-by-some-of-the-questions-and-the-email-says-which)
- [The chase SCREEN is a list of ITEMS; the chase EMAIL is a list of QUESTIONS](docs/load-bearing/chase-gates-tgq.md#the-chase-screen-is-a-list-of-items-the-chase-email-is-a-list-of-questions)
- [A chase asks only this project's questions, and only what the record asks](docs/load-bearing/chase-gates-tgq.md#a-chase-asks-only-this-project-s-questions-and-only-what-the-record-asks)
- [The infill screen fills in what we know, and it writes through the two routes that already exist](docs/load-bearing/chase-gates-tgq.md#the-infill-screen-fills-in-what-we-know-and-it-writes-through-the-two-routes-that-already-exist)
- [An item's TGQ is its own questions; the project's are answered once](docs/load-bearing/chase-gates-tgq.md#an-item-s-tgq-is-its-own-questions-the-project-s-are-answered-once)
- [TGQ is one name over two models, and which applies is per category](docs/load-bearing/chase-gates-tgq.md#tgq-is-one-name-over-two-models-and-which-applies-is-per-category)
- [A level is guessed at intake, and a guess is not a level](docs/load-bearing/chase-gates-tgq.md#a-level-is-guessed-at-intake-and-a-guess-is-not-a-level)

**The four outputs** — `docs/load-bearing/exports.md`
- [The field grid is a screen layout, never a file layout](docs/load-bearing/exports.md#the-field-grid-is-a-screen-layout-never-a-file-layout)
- [One line per cell, and formulas inert in the CSVs a person opens](docs/load-bearing/exports.md#one-line-per-cell-and-formulas-inert-in-the-csvs-a-person-opens)
- [The export and its check sheet load ONE scope](docs/load-bearing/exports.md#the-export-and-its-check-sheet-load-one-scope)
- [The quote file fills eight of twelve, and names the four it will not](docs/load-bearing/exports.md#the-quote-file-fills-eight-of-twelve-and-names-the-four-it-will-not)
- [The costing sheet is TEN columns of eighty-three](docs/load-bearing/exports.md#the-costing-sheet-is-ten-columns-of-eighty-three)

**Screens and the design language** — `docs/load-bearing/screens.md`
- [TOE dates are calendar days, and must never become a `Date`](docs/load-bearing/screens.md#toe-dates-are-calendar-days-and-must-never-become-a-date)
- [Nothing on a screen is wider than its box](docs/load-bearing/screens.md#nothing-on-a-screen-is-wider-than-its-box)
- [The UI must survive a response that is not JSON](docs/load-bearing/screens.md#the-ui-must-survive-a-response-that-is-not-json)
- [A refusal is screen text written on the server](docs/load-bearing/screens.md#a-refusal-is-screen-text-written-on-the-server)
- [A click's version is the version of its render](docs/load-bearing/screens.md#a-click-s-version-is-the-version-of-its-render)
- [The overview's numbers are a second question](docs/load-bearing/screens.md#the-overview-s-numbers-are-a-second-question)
- [Completed is computed, and there is no button](docs/load-bearing/screens.md#completed-is-computed-and-there-is-no-button)
- [The record is four jobs, and a tab each (five since 2026-10-05)](docs/load-bearing/screens.md#the-record-is-four-jobs-and-a-tab-each-five-since-2026-10-05)
- [A link goes somewhere; a button does something](docs/load-bearing/screens.md#a-link-goes-somewhere-a-button-does-something)
- [A drawing shouts; the screen need not, and the file must not](docs/load-bearing/screens.md#a-drawing-shouts-the-screen-need-not-and-the-file-must-not)
- [Every screen is three bands, and the primitives are the language](docs/load-bearing/screens.md#every-screen-is-three-bands-and-the-primitives-are-the-language)

**The database, the change trail and migrations** — `docs/load-bearing/database-and-trail.md`
- [A change is a change set; a version is composed, never copied](docs/load-bearing/database-and-trail.md#a-change-is-a-change-set-a-version-is-composed-never-copied)
- [A single-row edit locks its record first](docs/load-bearing/database-and-trail.md#a-single-row-edit-locks-its-record-first)
- [A CHECK is re-listed in full, so copying a stale list DELETES values](docs/load-bearing/database-and-trail.md#a-check-is-re-listed-in-full-so-copying-a-stale-list-deletes-values)
- [A project is deleted by one statement and one script, and the trail keeps only what it should](docs/load-bearing/database-and-trail.md#a-project-is-deleted-by-one-statement-and-one-script-and-the-trail-keeps-only-what-it-should)
- [The requirement seeds match on a key, and an answered question keeps its meaning](docs/load-bearing/database-and-trail.md#the-requirement-seeds-match-on-a-key-and-an-answered-question-keeps-its-meaning)
- [The migration ledger is written by the file's own transaction](docs/load-bearing/database-and-trail.md#the-migration-ledger-is-written-by-the-file-s-own-transaction)
- [A backtick inside a `sql` template closes it](docs/load-bearing/database-and-trail.md#a-backtick-inside-a-sql-template-closes-it)

**The trust boundary** — `docs/load-bearing/boundary-and-ops.md`
- [Never fetch a client-supplied URL with a store credential](docs/load-bearing/boundary-and-ops.md#never-fetch-a-client-supplied-url-with-a-store-credential)
- [The write boundary is in every handler, and every byte goes out under one header](docs/load-bearing/boundary-and-ops.md#the-write-boundary-is-in-every-handler-and-every-byte-goes-out-under-one-header)

## Load-bearing files

Read these before changing the behaviour they govern, and do not duplicate
their responsibilities elsewhere without a deliberate architecture decision.

- `src/lib/env.ts` — refuses to start when `APP_ENV` and `DATABASE_ENVIRONMENT`
  disagree. `db/script-env.mjs` is the same guard for command-line scripts.
- `src/middleware.ts` — the authorization boundary. `WRITER_ROLES` is an
  allowlist because the denylist version failed open on a mis-cased `"Viewer"`.
  Routes are default-protected with explicit public exceptions, so a forgotten
  new route fails closed. Since 2026-11-06 `WRITER_ROLES` lives in
  `src/lib/roles.ts`, every write handler re-checks it with `requireWriter`
  (the matcher was the ONLY check), and every public exception is anchored
  (`$` for one route, `/` for a family) and tested through Next's own matcher
  compiler — they were prefixes, so a future `/api/cronjobs` would have been
  public.
- `src/lib/audit.ts` — the append-only audit trail and optimistic locking. Actor
  is passed as a column, never as connection session state: Neon's HTTP driver
  kills `SET LOCAL`, which is why `write_audit()` falls back to
  `to_jsonb(new)->>'updated_by'`.
- `src/lib/auth.ts`, `src/lib/session.ts` — a session can be ENDED (0053,
  audit A4, 2026-11-06). Role and `active` lived in a 7-day JWT read by nothing
  but the matcher, so a demotion or a deactivation took effect a week later and
  a stolen cookie survived logout. A token carries `aud = APP_ENV` (a staging
  token is refused on pilot), `iss = "spec-builder"` and `tv =
  users.token_version`, lives 24 h and is renewed past half-life or when the
  row's role, name or email disagrees. `getSessionUser` reads the user's row on
  EVERY request, uncached on purpose (a cache is the seven-day window again),
  refuses an inactive user or a moved version, and returns the ROW's role, so
  a demotion is the next request through `requireWriter`. The middleware reads
  the token's role only, as a first line, because the edge cannot reach the
  database. Signing out increments `token_version`, ending every session the
  user holds; `tools/create-user.mjs` re-run for an existing email does the
  same. **Deploying this code signs every user out once**, because older
  tokens carry no version or audience, and against a database without 0053 it
  fails every session read. `tests/lib/session-boundary.test.ts` drives the
  real middleware with real tokens for `viewer`, `Viewer` and `editor`.
- `src/lib/bws-export.ts` — the 109-column BWS layout as a static constant, and
  the composer. A test asserts its 56 spec ids equal the seeded `json_id`s,
  which is what catches a BWS column insertion: every letter after it shifts
  while the ids do not.
- `db/migrations/0001_foundation.sql` — users and role check,
  `schema_migrations`, `audit_log` + `write_audit()`, immutability triggers,
  `bump_version()`, polymorphic `attachments`, `pick_lists`, `status_history`.
- `db/migrations/0050_answer_provenance.sql` and
  `src/lib/answer-provenance-backfill.ts` — an answer RECORDS that it is a
  projection of the record's specs (`source_kind = 'attribute'`); the backfill's
  five-rule decision table is the only thing that may relabel a pre-0050 row.
- `src/lib/project-summary-shape.ts` and `src/lib/upload-paths.ts` — what a
  SCREEN may import. The browser never imports `db.ts` or `blob-source.ts`:
  two pages and seven upload components did, through value imports that
  dragged `@neondatabase/serverless` and `@vercel/blob` into the bundle with
  only lazy initialisation keeping it from crashing (audit G5). Neither may
  carry `import "server-only"`: the package resolves only inside Next's
  bundler, tsx scripts under db/ and tools/ import both, and when
  `blob-source.ts` carried it for one evening four backfills failed with
  ERR_MODULE_NOT_FOUND. `tests/lib/client-server-boundary.test.ts` walks
  every "use client" file's runtime imports and fails on a path to either.
- `src/lib/printed-number.ts` — the one reader of a printed number; a
  thousands-or-decimal group is refused, never guessed.

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
**Extraction reads with `claude-opus-5-5` at effort `high` since 2026-10-04**
(Max: accuracy over API cost and read time), asked for as STRUCTURED OUTPUT
(`output_config.format`) rather than a forced tool, which 5.5 refuses — one
implementation, `src/lib/model-request.ts`, chosen by model id; the refusal
fallback (`fallbacks: "default"`) is on. Measured on the Aman pack the same day:
Opus 5 with the forced tool FAILED 12 of 30 drawings outright (the inch mark in
`5'-5"` broke the tool's JSON); Opus 5.5 failed none. Opus 5 at effort `high`
was the model from 2026-09-23. The timing inequality
moved with it: model 740 s < abort 770 s < `maxDuration` 800 s (Pro's GA
maximum; the project default was raised to match) < claim 900 s < queue
visibility 1200 s. Measured on the merged 44-page Panther pack: 358 s and 43,095
output tokens, so TIME binds first, at about 90 pages.
Capsule CRM (contacts) — read-only, built 2026-09-16, no token set yet. Microsoft Graph read-only mailbox
ingestion (M5) is planned and disabled. The region pinning is deliberate: this
app handles NDA-covered client specification material, so keep any new service
in the UK.

## Read the focused document for the task

| For | Read |
|---|---|
| Company standards — non-negotiable, not app-specific | `house/conventions.md` |
| The load-bearing workflows, by area (the traps; read before a change) | `docs/load-bearing/*.md` — the index is in this file's "Load-bearing workflows" |
| The milestone history since M1, dated | `docs/plans/milestone-diary.md` |
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
decisions from it. The history behind this one — every dated "Built …" and
"Verified …" paragraph since M1, what was excluded and why — is
`docs/plans/milestone-diary.md` (moved out of this file on 2026-11-07, audit
Stage 5.5); the dated decision log is `docs/plans/README.md`.

**The milestone is still M8, the pass that puts one real pack in and gets a
BWS-layout export out that a human calls flawless, read line by line against
the pack.** Done means all four, in order: the pack goes in as one delivery;
every bill line becomes a record keyed by its client ref and every drawing
spec lands on the right record in the right phase; the first pass TRANSPOSES
and does not complete (what the documents do not say is TBC or missing, never
inferred from a sister item or a template); the export is judged flawless by a
human. No model is fine-tuned and none will be; "flawless" is a human
acceptance test, not a passing suite.

**Where it stands (2026-11-07).** The pilot (Matthew, Claudia) works real
enquiries on `spec-builder-pilot`, at v1.13 from `261d730`; the Ronnie Scott's
tender (P16717) went in on pilot on 2026-10-15 with Matthew watching, and he
and Claudia now review its drawings there themselves. Matthew called intake
mostly done on 2026-10-12; the next phase is a screen for reviewing specs item
by item (confirm / TGQ / TG0 / fill in / raise a question) which he and Claudia
design themselves — **do not build it ahead of their design**. Max's direction
of 2026-10-15 governs every screen: a blocker is HIGHLIGHTED where it is and
says the next step in a few words; the full explanation stays one click away.

**The audit build (2026-11-06/07).** Max asked for every area read
meticulously and a plan to green-light (`docs/plans/audit-2026-11-06.md`:
twelve confirmed defects in its short version, five stages), then "run all the
stages… use your best judgment… go with the proposed". The build ran on
`audit-int` with Opus coders in worktrees, every landing checked on the local
stack with the database tier required. Stages 1–4 are landed and Stage 5 is
in progress (the dated entries in `docs/plans/README.md` list each item, its
findings and the pilot order): answer provenance (0050); the one number
reader; the gate slot rule; configurations follow their line; the finish
planner; the replace tick follows its row; the click's version; the checklist
keeps what is typed; an error boundary; the chase respects the matrix (0051);
reads that cost what they should; refusals written for people; the category
as a suggestion; re-assignment, a daily cap on automatic reads, stamped
evidence only, one row per email; the write boundary in every handler; locks
before occupancy; a deletable project and a trail without documents (0054,
0055, 0058); the requirement seed key (0057); the migration ledger (0056);
one version per transaction and the diff pairing supersessions (0052);
sessions that can be ended (0053); CI running the database tier on a fresh
Postgres; the route contracts. Still landing: the three giant pages split, the
one-of-each follow-ups (0059), twin lines (0060,
`docs/plans/twin-lines-2026-11-06.md`). **Pilot needs the migrations in
order, the provenance backfill, a re-seed after 0057, and knows that deploying
the code signs everyone out once** — the README's entries carry the exact
order. Human acceptance is outstanding on every screen the build touched
until Max has walked it.

**Explicitly excluded, so it is not built speculatively:** feeding preamble
notes into later model calls; a BWS *import* file carrying job numbers; images
and scanned documents other than a bill; splitting an oversize drawing set; M6
VE rounds; any write to BWS; automatic email sending; SharePoint writes
(SharePoint READS from BWS's P-number folder are an INVESTIGATION Matthew asked
for on 2026-10-12, not a build: `docs/plans/catchup-2026-10-12.md` P5 and P6);
BWS Messenger and Teams ingestion; the post-order/production flow; the TOE
calculator (Matthew's next-phase picture, not this one).

**Decisions awaiting somebody** (the person is named; the detail is in the
diary and the README):
- **Matthew:** Dia satisfying W and D at TGQ (shipped provisionally); whether
  TG1's re-check rows need their own recorded act; the item-review screen
  design; the gate model's assumptions (`docs/plans/matrix-assumptions.md`,
  Max standing in for him since 2026-09-17); the level guess rules; the
  question-to-BWS-field mapping; Q4/Q6/Q7/Q8 from the Ronnie Scott's plan.
- **Max:** `origin/production` (delete or record); whether to enforce the full
  CSP after the browser walk; reclaiming pilot's audit-log space; a chased
  record changing category (a migration); whether the bill's Confirm names
  unaccepted category suggestions; the phase-control decisions P1–P4; the
  spec-change "Fix" questions F1–F6; the TGQ workbook (parked 2026-09-19;
  Matthew named an in-app route on 2026-10-12); source-document version
  precedence; the Panther mailbox.
- **Tim:** the new BWS importer's column contract, before the BWS CSV is
  touched (the `'` prefix is on the three human CSVs only).
- **Who owns the requirement matrix** is undecided; Claudia wrote the cheat
  sheets and she and Matthew qualify it on real projects.

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
