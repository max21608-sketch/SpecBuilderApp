# Project Spec Builder — project instructions

> Forked from `bw-app-kit` on 2026-09-12. Company-wide standards live in
> `house/` and are copied in unchanged — do not restate them here, point at
> them.

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

- **Confirming an extracted spec value into `spec_values`.** Extraction stages;
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
  gate rules read `spec_values.state`, never the presence of a string. Note
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
| `projects` | BWS project (`P17231`), TOE key dates, shared inbox, Teams channel |
| `spec_records` | One per client ref, or per split. Client ref is the pre-sale primary key. |
| `spec_record_splits` | Parent record + `split_reason` (fabric split, configuration split). One client ref → many BWS jobs. |
| `bws_job_links` | Job number(s), populated post-order when BWQ converts to BENO |
| `project_materials` | **Project-scoped** dictionary: client material code → BWS field value |
| `spec_fields` | The BWS field register: JSON id, column letter, field name, category. Seeded from a BWS CSV export; **owned externally** — see the `external-vocabulary-sync` skill. |
| `spec_values` | Per record × field: value, state (`confirmed`/`tbc`/`missing`/`na`), source (email/document/manual), confirmed_by, confirmed_at |
| `item_categories`, `category_required_fields` | The cheat sheets as a requirement matrix, each requirement tagged with the gate that needs it |
| `gate_status` | Per record per gate |
| audit / notes | `audit_log` + `status_history` + append-only notes, from the chassis |

None of these exist yet; M1 creates the subset it needs.

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
therefore the primary key of the pre-sale record, and `bws_job_links` is what
maps it to job numbers once BWQ converts to BENO. One ref legitimately becomes
several jobs (a fabric split, a configuration split), which is why
`spec_record_splits` carries a parent and a `split_reason` rather than the ref
being mangled into uniqueness. This tool is the definitive client ref ↔ job
number mapping; nothing else in the business holds it.

### Gate rules read state, not strings

- `db/migrations/` (`spec_values.state`, `category_required_fields`,
  `gate_status`)

A spec value is `confirmed`, `tbc`, `missing`, or `na`, and those are four
different things. `TBC` means a human has actively said "not yet decided" —
it is an answer, and it blocks a gate. `missing` means nobody has looked.
`na` means the field does not apply to this category. A gate rule that tests
for a non-empty string treats all three of the last as satisfied and reports a
record ready for TG1 when it is not. Read the state column.

### The requirement matrix is seed data, not code

- `db/migrations/` (`item_categories`, `category_required_fields`)

Which fields a category requires, and at which gate, comes from the cheat
sheets — XLSX/PDF per category in SharePoint, ~19 across Upholstery and
Cabinetry. Those will be replaced with better ones. Model them as seeded rows
so a re-seed and a migration is the whole change, touching no application
logic. If category rules end up as `if` statements, every cheat-sheet revision
becomes a code release.

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

Skills carried from `bw-app-kit`: `verify`, `new-migration`,
`ship-to-staging`, `queue-backed-job`, `extraction-pipeline`,
`review-and-confirm`, `email-draft-and-send-gate`,
`external-vocabulary-sync`. If a skill goes stale, fix it in the app AND in
the kit — a stale skill is followed confidently, which is worse than an absent
one.

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

**Current milestone:** M1 — the spec table and completion view. A user can
import a BOQ, see every client ref as a spec record, edit its values, and read
at a glance which records are complete, which are waiting on a `TBC`, and which
are missing required fields for the gate ahead. This exists nowhere today.

**Done:**

- Scaffold: chassis forked from `bw-app-kit`, signed-in staging deployment
  proven end to end. See `docs/plans/README.md` for what was verified.

**In progress / next (M1):**

- Seed `spec_fields` with the 56 BWS spec fields (columns AF–CI of the BWS job
  export; CJ–DE are website/style fields and are excluded; A–AE are metadata).
- Seed `item_categories` and `category_required_fields` for Upholstery. Create
  the Cabinetry categories with an **empty** requirement set so they read as
  not-yet-defined rather than silently complete.
- Import a BOQ XLSX through `src/lib/intake-source.ts` — deterministic, no AI —
  into `spec_records` keyed by client ref.
- Edit spec values under optimistic locking; completion and gate status per
  record.

**Explicitly excluded for now:**

- Any write to BWS. Automatic email sending. SharePoint writes. BWS Messenger
  and Teams ingestion. The TOE calculator's own logic. Tony's knowledge-base
  integration. The post-order/production flow.
- M2 AI extraction, M3 CSV export, M4 chase emails, M5 inbox ingestion, M6 VE
  rounds and TG0 sign-off. Named so they are not built speculatively.

**Known gaps or decisions awaiting the user:**

These are the brief's own open questions, not settled matters. The full dated
list is in `docs/plans/README.md`; the two that change how code is written:

- **The gate model is unreconciled.** TG0/TG1/TG2 in the handover, plus a
  proposed pre-sale **TGQ** ("enough info to quote") from 2026-09-12. So model
  gates as **data, not an enum in code**, and record TGQ as proposed.
- **Who owns the requirement matrix after M1 seeds it is undecided.** The
  workflow diagram flags this as the real institutional gap — it currently
  relies on KAM / sales-support knowledge.

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
