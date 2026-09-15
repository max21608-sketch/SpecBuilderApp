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
| `npm run create-user` · `npm run hash-password` | there is no self-signup |

Tests run in three tiers — pure / db-gated / route. The database tiers skip
without `DATABASE_URL`, which is the correct state for pure-library work.
Database scripts print the resolved host before acting; read that line.

## Hard approval gates

A human confirms each of these, and nothing else may write it:

- Confirming an extracted spec value into `spec_answers`. Extraction stages;
  only a human confirm writes.
- Confirming drawing specs into `record_attributes`, and preamble notes into
  `project_notes`. Same rule, two more staging shapes.
- Producing the BWS CSV export.
- Sending any chase email. Drafts only, sent by a human from their own Outlook.
  There is no send path in this app.
- Marking a gate (TG0/TG1/TG2) satisfied for a record.
- Accepting a VE alternative, which changes which version is live.

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
- **Suppliers by modelled Capsule ID**, never free-text name.
- **`project_materials` is project-scoped.** The same client material code
  (`MOR005`) means different things on different projects. Scope it or the data
  is silently wrong.
- **Client ref is the pre-sale primary key** (`SX11A`, `FU-209-15`) — a modelled
  field, not free text. One client ref can split into several BWS jobs.
- **A drawing dimension without a printed unit gets NO unit.** The AP364 pages
  mix centimetres and millimetres and state neither. A wrong unit reads as a
  real measurement and nothing downstream questions it, so `suggestUnit` offers
  one only when every figure on the page agrees, and a blank one blocks the
  card.

## The data model

Built by `0002`–`0006`. This table is the map; the migrations carry the
reasoning.

| Table | Notes |
|---|---|
| `projects` | BWS project (`P17231`), TOE key dates (nullable), shared inbox |
| `spec_runs` | A sub-quote, normally one BOQ tab. Name (editable), `source_sheet`, `boq_revision`/`boq_date` (**text**), `header_notes`. Retired, never deleted; two runs may share a name |
| `spec_records` | One per BOQ line. `run_id` **not null**. `record_no` is the human-facing identifier (`P17231-014`) and stays project-wide across runs; splits are `parent_id` + `depth` + `split_reason` **on this table**, capped at one level |
| `record_attributes` | What a document SAID about an item: group, label, value, `unit` (dimensions only), the client's own `material_code`, `spec_field_id`, `state` (`confirmed`/`tbc`), source run and page. Multi-valued, requirement-free |
| `project_notes` | The preamble, per requirement. NOT the chassis `notes` table, which is append-only by trigger and would make a mis-extracted note permanent |
| `intake_batches` | One delivery of documents. **No status column** — a batch's state is derived from its runs |
| `spec_record_refs` | Every ref an item carries, one row each: `boq_code`, `design_code`, `cos_code`, `compound`, `bws_job`. Unique **per record**, never per project |
| `spec_fields` | The BWS register: 56 fields, `json_id` as the key, `column_letter` positional and never joined on. **Owned externally** — see the `external-vocabulary-sync` skill |
| `item_categories` | The 17 cheat sheets, plus `requirements_authored` |
| `item_category_aliases` | The words a BOQ actually uses ("Sofa" → Armchairs/Benches/Stools/Sofas) |
| `requirements` | The cheat sheet as a checklist: `kind` (`spec_field`/`readiness`), `prompt`, `section`, `required_at_gate` (**null everywhere** until gates are authored) |
| `spec_answers` | Per record × requirement × `revision_no`: value, `value_raw`, state, source, confirmed_by/at |
| `intake_runs` | Staging for any document intake. Generic, not BOQ-shaped. `batch_id` groups a pack; `document_kind` selects the prompt, the tool AND the staged shape |
| audit / notes | `audit_log` + `status_history` + append-only notes, from the chassis |

**Not built, deliberately.** `bws_job_links` (a job number arrives as a
`bws_job` ref until something needs dates on it); `project_materials` (the
client's own `CH-01.1` codes are kept verbatim on the attribute until there is
a register worth resolving them against); `gates` / `gate_status` (nothing to
read until the assignments exist). An empty table is a promise the schema makes
that the code has not kept.

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
outstanding and some sent, tracking-eligible `email_draft_items` row still
matches it.

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

### An extraction attempt is owned by two identifiers

`src/lib/extraction-claim.ts`, `src/lib/extraction-run.ts`,
`src/app/api/imports/[id]/extract/route.ts`

`attempt_id` is a logical attempt; `claim_token` is one worker invocation inside
it. Both are needed: a hard-killed worker leaves a claim that expires, a later
delivery reclaims the same attempt with a NEW token, and if the "dead" worker
was only slow its writes must then match nothing. Every worker write is fenced
on `(runId, attemptId, claimToken)` plus the status it expects, and **zero rows
means ownership was lost** — stop; never escalate that into a terminal failure.

A live claim is a **busy** outcome and it THROWS. Acking a duplicate delivery
would spend the delivery that recovery depends on.

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

### The UI must survive a response that is not JSON

Client code must not assume every API response is JSON. Check the status and
the content type, handle a parse failure, and show a useful fallback. Reset
loading and disabled state in a `finally` path, so an HTML error page, a
network failure or an unexpected payload cannot leave the interface frozen.
Exercise the error path in browser verification, not only the success path.
When a symptom is ambiguous, read the actual network response and the hosted
runtime logs before guessing at causes such as invalid credentials.

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

**Outstanding — judgement, not code.**

- **Nobody has used any of this.** The four checks pass with the database tier
  running; human acceptance is outstanding on every screen.
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
notes into later model calls; a `project_materials` register for the client's
`CH-01.1` codes (kept verbatim on the attribute instead); gap and completeness
checking, and gates; a BWS *import* file carrying job numbers; PDF bills of
quantities; images and scanned documents; splitting an oversize drawing set. M5
inbox ingestion and M6 VE rounds. Any write to BWS. Automatic email sending.
SharePoint writes. BWS Messenger and Teams ingestion. The TOE calculator's own
logic. The post-order/production flow.

**Chase emails are hidden, not deleted.** `src/app/dashboard/drafts/page.tsx`
redirects and says how to bring it back; the routes, `chase-drafts.ts`,
`chase-template.ts`, `eml.ts` and their suites are untouched and still green.
The spec table's Waiting column and the derivation behind it in
`src/app/api/records/route.ts` were removed with it.

**Decisions awaiting the user:**

- **The gate model is unreconciled, and every requirement is seeded ungated.**
  TG0/TG1/TG2 in the handover, plus a proposed pre-sale **TGQ**.
  `requirements.required_at_gate` is null on all 728 rows and there is no
  `gates` table, so the completion view reports confirmed / TBC / missing and
  nothing per-gate.
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
  only — the pre-sale grid holds what the client provided.

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
