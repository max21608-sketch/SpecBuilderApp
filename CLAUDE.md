# Project Spec Builder — project instructions

> Forked from `bw-app-kit` on 2026-09-12; the kit was folded into this repo on
> 2026-09-13 and there is no longer a sibling kit repository to work from. See
> `docs/kit/README.md`. Company-wide standards live in `house/` and are copied
> in unchanged — do not restate them here, point at them.

## Project purpose

A persistent, structured, auditable **specification record** that starts at
tender/BOQ stage and survives to delivery. It replaces repeated manual
transcription of the same facts between BOQ → costing sheet → Word → the BWS
quote freetext → BWS job spec fields, where each hop loses provenance and
invites divergence. Source and reference material: Matthew Lewis's handover
(`spec-builder-handover-for-max.md`), the 2026-09-10 design requirements,
`AP346-P17231-project-context.md`, `BWS-spec-system-reference.md`, and the
"Enquiry to TG1" workflow diagram.

The primary user is the KAM / sales-support role that today holds this
knowledge in their head and in spreadsheets. Optimize for their real workflow,
vocabulary, and ability to review consequential actions. Do not silently
replace a human decision with automation.

**The reference implementation is the fabric-ordering app (`autofab`).** Its
machinery is, step for step, what this app needs: document intake, staged
review, a human confirm boundary, email drafts, an audit trail. Add it as a
read-only reference directory (`/add-dir`) and read the real implementation
before reinventing a chassis stub.

## Keep agent instructions synchronized

- If the repository supports both Claude and Codex/GPT, keep `CLAUDE.md` and
  `AGENTS.md` byte-for-byte identical.
- Any change to either instruction file must be applied to both in the same
  task. Before finishing, run `cmp -s CLAUDE.md AGENTS.md` and do not report
  completion unless it succeeds.
- If this repository uses only one instruction file, remove this section.

## Non-negotiable product principles

These override convenience and speed in every design decision:

- **The user stays in control.** Anything that communicates externally,
  commits money, changes a legal or commercial state, imports uncertain data,
  or affects production requires a visible review-and-confirm step.
- **Drafts, never auto-send.** Communication integrations create drafts for a
  human to review and send. Do not add automatic sending without explicit
  product-owner approval and a new, documented safety design.
- **Authoritative external systems are read-only by default.** Downloading or
  reading is allowed where configured; writing back requires separate,
  explicit approval. Never risk corrupting the source of truth for convenience.
- **Suggestions are not decisions.** Fuzzy matches, AI extraction, and inferred
  relationships may be presented as suggestions but must not become canonical
  data until a human confirms them.
- **Data safety over speed.** Prefer durable storage, auditable changes,
  conflict detection, backups, and recoverable operations over shortcuts.
- **Production is protected.** Development and staging must not share a
  database, storage bucket, credentials, or outbound communication channel with
  production.

### This app's hard approval gates

- **Confirming an extracted spec value into `spec_answers`.** Extraction stages;
  only a human confirm writes.
- **Producing the BWS CSV export.** See the replacement-not-merge invariant
  below — this is the most dangerous operation in the product.
- **Sending any chase email.** Drafts only, sent by a human from their own
  Outlook. There is no send path in this app.
- **Marking a gate (TG0/TG1/TG2) satisfied for a record.**
- **Accepting a VE alternative**, which changes which version is live.

### Hard invariants

Each of these is a trap, not a preference:

- **BWS is read/download only, forever.** The CSV export is a file a human
  uploads to BWS. Nothing in this app writes to BWS, including the AI mirror
  at `bws-next-ai.whistlercloud.com` — its changes being discarded nightly is
  not permission.
- **The BWS import is a replacement, not a merge.** The export route must
  always emit the **complete dataset** for the quote/job set, never a delta. A
  partial export silently wipes fields in BWS. Enforce it in the route and
  state it in a test.
- **`TBC` is a real, distinct state** from missing and from N/A. At TG0
  "Design to suggest" is an acceptable dimension answer and `TBC` is not — so
  gate rules read `spec_answers.state`, never the presence of a string. Note
  that `NAME_DENYLIST` in `src/lib/matching.ts` also contains `"tbc"`; that is
  about entity-name matching and is a different meaning. Do not merge them.
- **VE rounds preserve the original.** Original spec, VE alternative, client
  accept/reject with date; the accepted version becomes live. This is
  autofab's revisions model — reuse it rather than inventing versioning.
- **Suppliers by modelled Capsule ID**, never free-text name.
- **`project_materials` is project-scoped.** Unlike autofab's global registers,
  the same client material code (`MOR005`) means different things on different
  projects. Scope it or the data is silently wrong.
- **Client ref is the pre-sale primary key** (`SX11A`, `FU-209-15`) — a
  modelled field, not free text. One client ref can split into several BWS
  jobs.

### The data model

| Table | Notes |
|---|---|
Built by `0002`–`0004`. This table describes what exists; the migrations carry
the reasoning.

| Table | Notes |
|---|---|
| `projects` | BWS project (`P17231`), TOE key dates (nullable), shared inbox |
| `spec_records` | One per BOQ line. `record_no` is the human-facing identifier (`P17231-014`); splits are `parent_id` + `depth` + `split_reason` **on this table**, capped at one level |
| `spec_record_refs` | Every ref an item carries, one row each: `boq_code`, `design_code`, `cos_code`, `compound`, `bws_job`. Unique **per record**, never per project |
| `spec_fields` | The BWS register: 56 fields, `json_id` as the key, `column_letter` positional and never joined on. **Owned externally** — see `external-vocabulary-sync` |
| `item_categories` | The 17 cheat sheets, plus `requirements_authored` |
| `item_category_aliases` | The words a BOQ actually uses ("Sofa" → Armchairs/Benches/Stools/Sofas) |
| `requirements` | The cheat sheet as a checklist: `kind` (`spec_field`/`readiness`), `prompt`, `section`, `required_at_gate` (**null everywhere** until gates are authored) |
| `spec_answers` | Per record × requirement × `revision_no`: value, `value_raw`, state, source, confirmed_by/at |
| `intake_runs` | Staging for any document intake. Generic, not BOQ-shaped |
| audit / notes | `audit_log` + `status_history` + append-only notes, from the chassis |

**Not built, deliberately.** `bws_job_links` (a job number arrives as a
`bws_job` ref until M3 needs dates on it); `project_materials` (M2, when
extraction starts producing codes that need resolving); `gates` / `gate_status`
(nothing to read until the assignments exist). An empty table is a promise the
schema makes that the code has not kept.

## How to work

These guidelines reduce common coding-agent mistakes. They bias toward caution
over speed; use judgment for trivial tasks.

1. **Think before coding.** Do not assume or hide confusion. State material
   assumptions, surface tradeoffs, and ask before implementation when multiple
   interpretations would produce meaningfully different results. If a simpler
   solution exists, say so. Push back when a request would compromise a stated
   safety boundary.
2. **Simplicity first.** Write the minimum code that solves the verified need.
   Do not add speculative features, single-use abstractions, unrequested
   configurability, or handling for impossible cases. If a short, direct
   implementation works, prefer it.
3. **Make surgical changes.** Touch only what the request requires and match
   the surrounding style. Do not refactor adjacent code, reformat unrelated
   files, or delete pre-existing dead code. Remove only the imports, variables,
   and helpers made obsolete by your own change. Every changed line should be
   traceable to the request.
4. **Work toward verifiable outcomes.** Translate a request into a concrete
   success condition. For a bug, reproduce it first when practical, then make
   the reproducer pass. For multi-step work, state a short plan with a
   verification step.
5. **Inspect before changing.** Read the relevant implementation, tests,
   schema, and local instructions before editing. Search for existing patterns
   and reuse them rather than inventing a parallel approach.
6. **Preserve user work.** Treat uncommitted and untracked files as belonging
   to the user. Do not discard, overwrite, clean, or include unrelated changes.
   If required work overlaps with them, stop and explain the conflict.
7. **Do not broaden authority.** A request to diagnose does not authorize a
   fix; a request to edit locally does not authorize a deployment; permission
   to deploy staging does not authorize production.

Working well means small diffs, few rewrites, explicit trust boundaries, and
questions asked before—not after—an avoidable wrong implementation.

## Stack and architecture

- Frontend/application: Next.js 15 (App Router), React 19, Tailwind 3.
- Database and migrations: Neon Postgres; forward-only numbered SQL in
  `db/migrations/`, applied by `db/run-migrations.mjs` with a
  `schema_migrations` ledger.
- Authentication: own users table, scrypt hashes, a `jose` JWT in the
  `sb_session` cookie, enforced in `src/middleware.ts`.
- File/object storage: Vercel Blob, private, client-direct upload. Not yet
  provisioned — first needed at M1.
- External integrations: none active. Anthropic (M2) and Microsoft Graph
  read-only mailbox ingestion (M5) are both planned and both disabled.
- Hosting and deployment: Vercel project `spec-builder-app`, functions pinned
  to `lhr1` in `vercel.json` to match the London database.
- Test tooling: Vitest, three tiers — pure / db-gated / route.

Document the few load-bearing files here. Read them before changing the
behavior they govern:

- `db/migrations/0001_foundation.sql` — users and role check,
  `schema_migrations`, `audit_log` + `write_audit()`, immutability triggers,
  `bump_version()`, polymorphic `attachments`, `pick_lists`, `status_history`.
- `src/lib/audit.ts` — the append-only audit trail and optimistic locking.
  Actor is passed as a column, never as connection session state: Neon's HTTP
  driver kills `SET LOCAL`, which is why `write_audit()` falls back to
  `to_jsonb(new)->>'updated_by'`.
- `src/middleware.ts` — the authorization boundary. `WRITER_ROLES` is an
  allowlist because the denylist version failed open on a mis-cased `"Viewer"`.
  Routes are default-protected with explicit public exceptions, so a forgotten
  new route fails closed.
- `src/lib/extraction-run.ts` / `extraction-claim.ts` — the claim-by-`returning`
  protocol that stops a queue retry double-billing a model call. M2.
- `src/lib/env.ts` — refuses to start when `APP_ENV` and
  `DATABASE_ENVIRONMENT` disagree. `db/script-env.mjs` is the same guard for
  the command-line scripts.

Do not duplicate these responsibilities elsewhere without a deliberate
architecture decision.

### Read the focused document for the task

- `house/conventions.md` — company standards. Not app-specific, not optional.
- `house/deployment.md` — the six-term reporting vocabulary and release traps.
- `house/data-safety.md` — trust boundaries and staged-vs-canonical.
- `docs/stack.md` — what runs where, and what this app deliberately lacks.
- `docs/environments.md` — sandbox/staging vs production; releases.
- `docs/recovery.md` — incident triage, recovery, rollback.
- `docs/integration.md` — external integrations: scope, setup, activation.
- `docs/plans/README.md` — releases, dated decisions, what is still open.
- `docs/kit/` — the folded-in app kit: chassis provenance, its changelog, and
  the procedure for starting another app from this one.
- `db/README.md` — migrations, seeds, backups, restores.

## Load-bearing workflows

The workflows below have invariants that are not obvious from reading the code
and that a reasonable-looking change will break silently. **Read the named
files before changing the behaviour they govern.** Each entry names the files,
then states the invariant and what breaks if it is weakened.

This section is the most valuable part of this document. Add to it whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### The spec record and its client ref

- `db/migrations/` (the M1 schema)

The client ref is the key the client, the BOQ, the FF&E schedule and the
emails all use, and it exists long before a BWS job number does. It is
therefore the natural identifier of the pre-sale record — but NOT its key: the
pilot BOQ contains `SX11A` twice, with different quantities, so records carry a
surrogate id plus `record_no`, and every ref lives in `spec_record_refs`. A job
number is a `bws_job` ref until M3 needs dates on it, and that is what maps it to job numbers once BWQ converts to BENO. One ref legitimately becomes
several jobs (a fabric split, a configuration split), which is why
`spec_records` carries `parent_id` and `split_reason` on the row itself — a
satellite table would let a child exist with no split reason, or two parents. This tool is the definitive client ref ↔ job
number mapping; nothing else in the business holds it.

### Gate rules read state, not strings

- `db/migrations/` (`spec_answers.state`, `requirements`)

A spec value is `confirmed`, `tbc`, `missing`, or `na`, and those are four
different things. `TBC` means a human has actively said "not yet decided" —
it is an answer, and it blocks a gate. `missing` means nobody has looked.
`na` means the field does not apply to this category. A gate rule that tests
for a non-empty string treats all three of the last as satisfied and reports a
record ready for TG1 when it is not. Read the state column.

### The requirement matrix is seed data, not code

- `db/migrations/` (`item_categories`, `requirements`, `db/seed/`)

Which fields a category requires, and at which gate, comes from the cheat
sheets — XLSX/PDF per category in SharePoint, ~19 across Upholstery and
Cabinetry. Those will be replaced with better ones. Model them as seeded rows
so a re-seed and a migration is the whole change, touching no application
logic. If category rules end up as `if` statements, every cheat-sheet revision
becomes a code release.

### A chase records that a question was asked, and writes no answer

- `db/migrations/0005_chase_drafts.sql`, `src/lib/chase-drafts.ts`,
  `src/app/api/drafts/[id]/confirm-sent/route.ts`

Recording a send must NOT write to `spec_answers`. The obvious design is a
`chased_at` column; it fires `bump_version`, which invalidates every M2
extraction snapshot taken against that answer for a reason that has nothing to
do with the answer — and it writes a communication event into a business
record. "Waiting for a reply" is therefore DERIVED: a question is waiting when
it is still outstanding and some sent, tracking-eligible `email_draft_items`
row still matches it.

Two consequences that look like omissions and are not:

- **Undo does not check `version = snapshot + 1`.** The
  `email-draft-and-send-gate` skill requires it because in the fabric app
  confirming a send mutates the covered lines, so one bump proves nothing else
  touched them. Nothing is mutated here, so there is no bump to count.
- **Staleness compares a context snapshot, not just versions.** `requirements`
  and `spec_record_refs` carry no version, so an edited prompt or a corrected
  client ref would otherwise be invisible. Compare with `canonicalJson` — plain
  `JSON.stringify` fails, because `jsonb` does not preserve key order and every
  draft then reads as stale the instant it is generated.

Only `intro_text` and `closing_text` are author-edited, as plain text; the
question table is generated from the coverage rows. That is what makes the body
and the coverage provably the same set, which is the guarantee the gate rests
on. Do not add a whole-body HTML editor.

### TOE dates are calendar days, and must never become a `Date`

- `src/lib/project-programme.ts`, `src/app/api/projects/[id]/route.ts`,
  `src/app/api/records/route.ts`

`projects.order_date` / `specs_agreed_by` / `delivery_date` are `date` columns.
Both drivers parse a `date` into **local midnight**, and `toISOString()` then
renders the day *before* it in British Summer Time. Because the project PATCH
writes every column on every save, a read-modify-write that changed only the
client name moved all three dates one day earlier — silently, every time.

Select them as `::text` on every query that reads them, and compare days as
`YYYY-MM-DD` strings. `project-programme.ts` takes `today` as an argument rather
than reading the clock, so the comparison is testable and does not depend on
where the process runs.

**Overdue is computed, never stored**, for the same reason Waiting is: a stored
flag would have to be written onto `spec_answers` and would bump the version
M2's extraction snapshots are taken against. And a **null `specs_agreed_by`
means "no programme", not "not overdue"** — both the overview and the spec table
have to say so in words, or an empty programme renders as a healthy one.

### A staged proposal is addressed by UUID, never by position

- `src/lib/spec-document.ts`, `src/app/api/imports/[id]/route.ts`,
  `src/lib/confirm-spec-document.ts`

The BOQ's staged lines are a fixed positional list — nothing is added or
removed, so an index is a stable address. **Extraction proposals are not.**
Reviewing one changes the set the screen is filtering, so "the proposal at index
4" means a different row before and after an Ignore. Every operation locates by
`elem.id` in the live, locked JSON.

Reviewed proposals **stay in `lines`** with `reviewStatus` flipped. Keeping them
is what removes array compaction, a second reviewed array, an inverted restore
guard, and restore-by-reinsertion — all at once.

Each proposal carries **its own version**. The run's coarse version is bumped by
every autosave on every row, so predicating an edit on it would make two people
editing two different rows conflict for no reason.

**Blockers are computed, never stored.** A retarget clears an overwrite
acknowledgement and a duplicate-target clash appears and disappears as other
proposals move, so a blocker frozen into the JSON at extraction time is stale by
the first edit — and the screen and the confirm route would then disagree about
whether a card can commit. `proposalBlockers()` is called by both.

### The record is the unit of commit, and a half-applied card is the failure

- `src/lib/confirm-spec-document.ts`, `src/app/api/imports/[id]/confirm/route.ts`

One confirm request names ONE record and ALL of its currently pending assigned
proposals with the versions the reviewer saw. The server checks that set against
the live grouping, so a proposal added or retargeted into the record since the
page loaded refuses the request rather than letting it commit a card the reviewer
never saw whole.

Any failure rolls back everything. Three finishes written and the fourth refused
looks finished, and the missing one is invisible until somebody notices the
answer is wrong.

`status = 'confirmed'` on an intake run means **no pending proposals remain** —
applied or explicitly ignored. Label it *Review complete*, never "complete":
settled answers are a different question. Restore accepts **ignored only**; an
applied proposal is immutable history, and undoing an answer is something a
person does on the record screen, on purpose.

### An extraction attempt is owned by two identifiers

- `src/lib/extraction-claim.ts`, `src/lib/extraction-run.ts`,
  `src/app/api/imports/[id]/extract/route.ts`

`attempt_id` is a logical attempt; `claim_token` is one worker invocation inside
it. Both are needed: a hard-killed worker leaves a claim that expires, a later
delivery reclaims the same attempt with a NEW token, and if the "dead" worker was
only slow its writes must then match nothing. Every worker write is fenced on
`(runId, attemptId, claimToken)` plus the status it expects, and **zero rows
means ownership was lost** — stop; never escalate that into a terminal failure.

A live claim is a **busy** outcome and it THROWS. Acking a duplicate delivery
would spend the delivery that recovery depends on.

The timings are an inequality, not three knobs: model deadline < run abort <
`maxDuration`; claim expiry > `maxDuration`; visibility timeout > claim expiry.
`tests/lib/extraction-timing.test.ts` asserts each, and asserts them against
`vercel.json`. There is **no exactly-once billing guarantee**; an ambiguous
failure can cost a second call, and the UI says so before a human restarts one.

### Never fetch a client-supplied URL with a store credential

- `src/lib/blob-source.ts`, `src/app/api/uploads/token/route.ts`,
  `src/app/api/imports/route.ts`

M1 took a `url` from the request body and fetched it with
`Bearer BLOB_READ_WRITE_TOKEN`. Being signed in did not make that safe — the
token is the store's, not the user's.

The fix is not a better URL check: it is never accepting a URL. A blob is
addressed by **pathname**, which the store resolves against its own host from the
token, so there is no host to influence and no redirect to follow. Pathnames are
scoped to `projects/<projectId>/`, and that scope is checked three times — at
token issue, at registration, and on every read — because a check in only one of
them is a check the other two skipped.

The import type is likewise **declared, never inferred**. A BOQ and an FF&E
schedule are both `.xlsx`; a file extension identifies bytes, not a workflow.

### The BWS export is a replacement

- the export route (M3)

BWS's import replaces the dataset it receives for the quote/job set. An export
that emits only changed lines therefore **erases** every field it omitted. The
route must always emit the complete dataset, and a test must assert it. This
is the single most dangerous rule in the brief.

## Agent harness (`.claude/`)

- `.claude/skills/` — task procedures. Mirrored to `.agents/skills/` for
  non-Claude runners; keep the copies identical.
- `.claude/launch.json` — how the dev server starts.
- `.codex/config.toml` — `project_doc_fallback_filenames = ["CLAUDE.md"]`.

Skills carried from the kit: `verify`, `new-migration`,
`ship-to-staging`, `queue-backed-job`, `extraction-pipeline`,
`review-and-confirm`, `email-draft-and-send-gate`,
`external-vocabulary-sync`. If a skill goes stale, fix it here and add a dated
entry to `docs/kit/CHANGELOG.md` — a stale skill is followed confidently,
which is worse than an absent one. There is no upstream kit to port to any
more; that changelog is where the reasoning is kept for whoever starts app #3.

## Trust boundaries and data mutation

- Treat uploaded files, external API responses, email, scraped content, and AI
  output as untrusted input.
- Validate untrusted structured data against an explicit runtime schema after
  extraction or parsing. TypeScript types alone are not runtime validation.
- Keep staging/extraction records separate from canonical business records.
  Only the confirmation path may promote reviewed data into canonical tables.
- Never silently resolve an ambiguous match. Show the candidates and preserve
  the original source value so a human can decide.
- Preserve the original source artifact where policy permits, so transformed
  data remains traceable and can be re-checked.
- Enforce important gates on the server, not only by hiding or disabling UI.
- For every mutation, verify authentication, authorization, input validation,
  ownership/scope, and concurrency behavior.

## Database integrity

- Use a real transactional database for canonical business data.
- Keep an append-only audit trail for consequential changes, including actor,
  timestamp, entity, operation, and enough before/after context to investigate.
- Use optimistic locking or an equivalent conflict check for user-editable
  records. Return a visible conflict rather than silently overwriting a newer
  change.
- Pass actor identity explicitly through mutations; do not rely on connection
  session state unless the database driver guarantees it.
- Make multi-record confirmation/import operations transactional: all intended
  records commit together, or none do.
- Prefer constraints and foreign keys for invariants that must always hold.

### Migrations

- Add migrations as new, ordered, forward-only files. Never edit a migration
  after it has been applied to any shared environment.
- Wrap schema changes in a transaction where the platform supports it.
- Back up real data before a material or destructive schema/data change.
- Apply and verify the migration in sandbox/staging before production.
- Apply the same reviewed migration file to each environment; do not hand-edit
  production into a different schema.
- Know whether the migration runner records applied migrations. If it does not,
  never blindly rerun the full directory against an existing database.

### Seed and reference data

- Distinguish reference data from transactional/user data. Never seed test
  transactions into production.
- Make seed files idempotent only when that guarantee is real and tested.
  Renames can invalidate name-based conflict keys and recreate duplicates.
- Do not rerun initial seed suites after users have manually edited the same
  records unless the refresh/reconciliation behavior is explicitly designed.
- Migrate uncertain live data with a validated importer and reconciliation
  report, not a blind bulk insert.

## Authentication, secrets, and privacy

- Never commit `.env.local`, credentials, tokens, private source documents, or
  database backups. Keep `.env.example` limited to variable names and safe
  placeholders.
- Use distinct secrets and service resources per environment.
- Grant integrations the smallest practical permission and scope. Prefer
  read-only and mailbox/folder/project-specific access.
- Keep production integrations disabled by default until credentials, scope,
  behavior, and rollback have been explicitly approved.
- Store private blobs as private. Server-side downloads must authenticate; do
  not assume possession of a blob URL grants access.
- Keep sensitive production data in the approved region and services.
  This app handles NDA-covered client specification material. The database is
  region-pinned to London (`aws-eu-west-2`) and Vercel functions to `lhr1`
  (`vercel.json`) so processing stays in the UK. Keep it that way when adding
  any new service. Whether Anthropic zero-data-retention is required before
  client specification documents reach a model is **open and unanswered** —
  see `docs/plans/README.md`.

## Environments

Use physically separate resources, not merely different labels:

| Environment | Git branch | App/hosting project | Database | Storage | Purpose |
|---|---|---|---|---|---|
| Local | `staging` | Local process | Neon `SpecBuilder` / `sandbox` | Sandbox only | Development |
| Staging | `staging` | Vercel `spec-builder-app` | Neon `SpecBuilder` / `sandbox` | (none yet) | Testing |
| Production | not created | not created | a **separate Neon project** | not created | Real work |

**Production does not exist and is not authorized.** When it is created it gets
its own Neon project, not a branch of this one — separate credentials, and no
console action can promote or reset across the boundary.

Two naming traps in the table above:

- Vercel's **Production Branch setting is `staging`**, deliberately. "Production
  deployment" is a Vercel deployment *class*, not our environment: it is what
  makes a branch claim the stable alias and receive the project's environment
  variables. Those variables declare `APP_ENV=staging`. Do not "fix" this to
  `main`; there is no `main` branch.
- The Neon project's default branch is named `root`, not `production`, because
  a branch called `production` inside the non-production project would make
  `DATABASE_ENVIRONMENT=production --yes-production` succeed against the wrong
  database with every guard reporting exactly what it was designed to report.

- Local development must never point at the production database.
- Make non-production visually unmistakable with a persistent banner and page
  title marker.
- Add a runtime guard that refuses to start when the declared app environment
  and connected database environment do not match.
- Expose a safe environment identity check so operators can verify what a
  deployment is connected to before testing or entering data.
- Never copy sandbox data wholesale into production. Move only explicitly
  reviewed reference data or individually approved records.

## Testing and verification

Run verification proportionate to risk. Do not claim a check you did not run.

For a normal code change, use the relevant subset of:

1. Focused tests for the changed behavior.
2. Full automated test suite: `npm test`.
3. Type check: `npm run typecheck`.
4. Lint: `npm run lint`.
5. Production build: `npm run build`.
6. Database migration against sandbox, when relevant.
7. End-to-end browser test through the real UI for user-facing workflows.

For critical workflows, test the complete path—not only the underlying API.
Include realistic source files and at least one stress/edge case. Check browser
console errors, network failures, database results, audit rows, conflict
behavior, and cleanup of temporary QA data and stored files.

Automated checks do not replace user acceptance. Report human testing as
outstanding until the intended user has actually completed it.

### UI and API failure handling

- Client code must not assume every API response is JSON. Check the status and
  content type, handle parse failures, and show a useful fallback error.
- Reset loading and disabled states in a `finally` path so an HTML error page,
  network failure, or unexpected payload cannot leave the interface frozen.
- When the UI symptom is ambiguous, inspect the actual network response and
  hosted runtime logs before guessing at causes such as invalid credentials.
- Exercise error paths in browser verification, not only successful responses.

## Git and change management

- Check `git status` before and after work. Preserve unrelated changes.
- Keep commits scoped to the requested change; do not sweep in existing
  untracked files.
- Never commit secrets or generated private data.
- Land fixes in staging first. Do not commit a fix directly to the production
  branch unless the documented emergency process explicitly permits it.
- Do not rewrite shared history or use destructive Git commands without
  explicit approval.
- Commit and push completed staging work without being asked; `staging` is the
  working branch and the deploy target. Never create or push a production
  branch.

## Deployment and release policy

- **A local commit is not a deployment.** Never say a hosted change is
  available merely because it was committed or pushed.
- **Production always requires explicit authorization.** Do not merge or push
  the production branch, deploy production, migrate the production database,
  copy production data, or change production configuration without approval
  for that specific action.
- A staging handoff is complete only when the documented policy permits the
  push, the exact commit SHA appears in the hosting provider, the deployment
  reaches its ready state, and the changed workflow is verified in the
  signed-in staging app when a session is available.
- In the final report, distinguish precisely among `changed locally`,
  `committed locally`, `pushed`, `deploying`, `deployed`, and `verified in the
  app`.
- Record the deployed commit SHA and environment. Never infer deployment state
  from a branch push alone.
- Use a written rollout and rollback plan for domain changes, destructive data
  operations, new outbound integrations, or first use with real data.

### Environment-variable and hosted-resource changes

- When code starts requiring a new environment variable, update
  `.env.example` and configure it in every existing hosted environment that
  will run the code before deployment.
- Environment-setting, branch, and storage changes do not alter deployments
  that were already built. Trigger a new deployment after configuration
  changes and verify the new build uses them.
- A newly created hosting project may deploy an older tip from its configured
  branch. Verify its source commit SHA before treating it as current.
- If a push does not trigger a deployment, search all deployment statuses for
  the exact commit SHA. A provider's “redeploy” action may rebuild the old
  commit rather than the current branch tip; use the documented trigger method.
- Do not rapidly poll live deployments. Space automated checks generously to
  avoid bot protection and unnecessary load.

## External communication and integrations

- Outbound email/message integrations create drafts only unless a separately
  approved product requirement says otherwise.
- Staging must never send to real recipients. Use disabled modes, test
  recipients, or local downloadable drafts.
- Inbound integrations should stage source content and proposed links without
  mutating canonical records.
- Keep integration enablement controlled by deployment configuration, not an
  accidental in-app toggle, when turning it on has security or business impact.
- Document required permissions, credential ownership, enable/disable steps,
  failure handling, and rollback before enabling an integration.

## Reference and legacy material

- `/Reference/` (gitignored) and the fabric-ordering app added via `/add-dir`
  contain source data and the reference implementation. Read-only unless a
  task explicitly says otherwise. Real client material — the BOQ, the BWS job
  export, SharePoint cheat sheets — never enters this repo, a fixture, or a
  seed: the schema is what gets committed, never a row.
- Build new work in the current application structure. Do not extend a legacy
  prototype merely because it already has similar code.
- Preserve source artifacts and document intentional deviations. Never silently
  “clean up” uncertain source values; retain or flag them for review.

## Current milestone and scope

**Current milestone:** M1 — the spec table and completion view. **Shipped to
staging 2026-09-13.** A user can import a BOQ, see every line as a spec record,
edit its values, and read at a glance what is confirmed, what is `TBC` and what
nobody has looked at yet.

**Done:**

- Scaffold: chassis forked from `bw-app-kit`, signed-in staging deployment
  proven end to end.
- M1. `0002`–`0004` and four seed files: the 56 BWS spec fields, the 17
  categories, 728 requirements (320 spec-field, 408 readiness), and the BOQ
  alias vocabulary. BOQ upload → parse → review → one atomic confirm route →
  record screen under optimistic locking → completion view. Verified against
  the real pilot BOQ: 59 lines in, 59 records out, `SX11A` landing as two
  records with different quantities.

**In progress / next:**

- **M4 — draft chase emails. Pushed to `staging` (`2eb58b3`).**
  `0005_chase_drafts.sql` applied to sandbox. Contacts, an outstanding-question
  inventory grouped by designer, generate / edit / download `.eml` /
  confirm-sent / undo-confirm, and a derived Waiting state on the spec table.
  Outstanding: human acceptance, and opening a generated `.eml` in the real
  Outlook client.
- **M2 step C — complete 2026-09-13, never having called a model.** The project
  overview screen; migration `0006` (spec-document intake, attempt ownership,
  `requirement_aliases`); the blob trust boundary; the model wrapper and its
  tool/Zod schemas; the proposal resolver; the queue producer, claim protocol
  and fenced worker; the BOQ `record_no` race fix; the stable-id autosave; the
  review screen; and the single confirm boundary. 265 tests pass with 0 skipped.
- **M2 step D — API verified 2026-09-13 with ONE approved synthetic document.**
  `claude-sonnet-5` accepted the exact parameter combination; every safety rule
  held against real model output; one request billed. Evidence and token counts
  are in `docs/plans/README.md`. `tests/manual/verify-model.test.ts` repeats it,
  gated on `VERIFY_MODEL=1` because it spends money.

  **What remains is judgement, not code.** A representative pilot schedule read
  and compared against its source pages by hand — expected vs extracted, misses,
  wrong values, unresolved matches. A successful API response is not extraction
  quality, and the KAM has to find the review useful before more documents
  follow. `requirement_aliases` is empty and attribute matching measured 1/7 on
  the sample; seed it only from verified pilot wording.

**Deferred, with the reason recorded:**

- **`project_materials`.** M2 preserves a material reference on the answer as
  the document wrote it. The register is not built, because the same client code
  (`MOR005`) means different things on different projects and one guessed from
  extraction output would be confidently wrong. Build it when extraction is
  actually producing codes that need resolving.

**Explicitly excluded for now:**

- Any write to BWS. Automatic email sending. SharePoint writes. BWS Messenger
  and Teams ingestion. The TOE calculator's own logic. Tony's knowledge-base
  integration. The post-order/production flow.
- M3 CSV export, M4 chase emails, M5 inbox ingestion, M6 VE rounds and TG0
  sign-off. Named so they are not built speculatively.

**Known gaps or decisions awaiting the user:**

The full dated list is in `docs/plans/README.md`. The ones that change how code
gets written:

- **The gate model is unreconciled, and every requirement is seeded ungated.**
  TG0/TG1/TG2 in the handover, plus a proposed pre-sale **TGQ** from
  2026-09-12. `requirements.required_at_gate` is null on all 728 rows and there
  is no `gates` table, so the completion view reports confirmed / TBC / missing
  and nothing per-gate. When Matthew authors the assignments it is a migration
  and a re-seed, touching no application logic — which is the whole reason the
  matrix is seed data rather than code.
- **Who owns the requirement matrix is undecided.** The workflow diagram flags
  this as the real institutional gap: it currently relies on KAM /
  sales-support knowledge.
- **The question-to-BWS-field mapping is this repo's judgement, not Matthew's.**
  Only 28 of the 56 BWS fields are reachable from a cheat-sheet question; the
  other 28 have no route into the tool. Review it before M3 relies on it.

**Resolved 2026-09-13:** Anthropic zero-data-retention, which was blocking M2,
has been cleared by the user. Client specification documents may go to the
model. M2 is unblocked.

Keep this section current. A stale status section is worse than no status
section because agents will make decisions from it.

## Before reporting completion

- Re-read the request and confirm every changed line serves it.
- Review `git diff` and `git status`; leave unrelated user work untouched.
- Run the relevant tests, type check, lint, build, and end-to-end checks.
- Verify security, permissions, human approval gates, audit behavior, and
  concurrency behavior where the change touches them.
- If instructions are mirrored, confirm `CLAUDE.md` and `AGENTS.md` are
  byte-for-byte identical.
- State exactly what changed, what was verified, what was not verified, and
  the real deployment state.
- Do not report completion if a required check failed or the deployed commit
  is not the intended commit.
