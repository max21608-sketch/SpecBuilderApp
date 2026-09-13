# Plans

## Releases

| Release | Document | Depends on | State |
|---|---|---|---|
| Scaffold | `bw-app-kit` Part 2 plan | — | Built 2026-09-12 |
| M1 — spec table and completion view | `part-2/` plan + this log | — | **Shipped to staging 2026-09-13** |
| M2 — AI extraction of richer documents | `part-3/m4-chase-emails-and-m2-extraction.md` | M1; an Anthropic key + account owner | **Step C complete 2026-09-13**, no model ever called. Step D (first real document) not started |
| M3 — BWS CSV export (complete dataset) | — | M1; a way to test an import | Named only |
| M4 — draft chase emails | `part-3/m4-chase-emails-and-m2-extraction.md` | M1 | **Pushed to `staging` 2026-09-13** (`2eb58b3`). No human acceptance; no `.eml` opened in Outlook |
| M5 — shared-inbox ingestion | `docs/integration.md` | Entra app + scoped mailbox | Named only |
| M6 — VE rounds, TG0 A/B/C sign-off | — | a settled gate model | Named only |

M3, M5 and M6 are named so they are not built speculatively. M1 is shipped;
M4 is pushed and awaiting human acceptance; M2's whole pipeline is built and
tested without a single model call. What remains is step D — deploy the schema
and consumer before enabling the producer, then one approved small document,
then a representative pilot schedule judged by hand. That still needs a named
Anthropic Console owner.

## Decisions taken 2026-09-12

Record the reasoning, not just the outcome — the reason is what tells a future
reader whether the decision still applies.

1. **Fork the kit rather than share a package.** A shared `@benwhistler/core`
   would force premature abstraction on ~25 files that are mostly 20–100 lines
   and couple two apps' releases while both move fast. Copying is cheap;
   `chassis/PROVENANCE.md` in the kit records origin so an upstream fix is
   ported deliberately. The cost — fixes do not propagate on their own — is
   accepted and paid with a CHANGELOG line.
2. **One Neon project per environment, not one project with two branches.**
   Production gets a completely separate Neon project. Stronger isolation:
   separate credentials, and no console action can promote or reset across the
   boundary. The cost is losing the ability to branch production data into a
   sandbox for debugging; the replacement is a restore from `db/backup.mjs`.
3. **The Neon default branch is named `root`.** Renamed from `production`
   because a branch by that name inside the non-production project would make
   `DATABASE_ENVIRONMENT=production --yes-production` succeed against the wrong
   database while every guard reported exactly what it was designed to report.
   Only the name could close that gap.
4. **Vercel's Production Branch is `staging`, and there is no `main` branch.**
   Vercel's "production deployment" is a deployment class, not our environment:
   it decides which branch claims the stable alias and receives the project's
   variables, and those variables declare `APP_ENV=staging`. Left at `main`,
   every push takes the Preview path — new hostname per deploy so session
   cookies do not carry, no project env vars so the app throws on `APP_ENV`,
   and Vercel Authentication in front of the URL that reads as our own sign-in
   being broken.
5. **Functions pinned to `lhr1` in `vercel.json`, not in the dashboard.** The
   default was `iad1`, which put every query across the Atlantic from a London
   database and processed NDA material in the US. A committed declaration
   survives the project being recreated; a dashboard setting does not. Ported
   back to the kit's chassis.
6. **A `/dashboard` page exists before any feature does.** `/api/auth/login`
   redirects there, so without it a successful sign-in answers 404 —
   indistinguishable from a broken sign-in at exactly the moment someone is
   proving a deployment works. It states who is signed in, the app environment,
   and which database. Ported back to the kit's chassis.
7. **Model gates as data, not an enum in code** — because the gate model is not
   settled. See below.

## Decisions taken 2026-09-13 (M1)

8. **Records are keyed by a surrogate id plus `record_no`, not by client ref.**
   The pilot BOQ contains `SX11A` twice with different quantities, and the same
   item carries four different refs across four documents. Refs live in
   `spec_record_refs`, unique per record rather than per project. `record_no`
   exists so a reviewer can tell two `SX11A`s apart and the M3 export has a
   stable sort.
9. **Answers are keyed on the cheat-sheet question, not the BWS field.** A
   person answers a question; the field is where the answer goes afterwards.
   The 408 readiness questions have no field, so they are structurally
   incapable of reaching a BWS export.
10. **Category matching got a seeded vocabulary, not a lower cutoff.** Matching
    BOQ words against sheet names scored 5 of 59 — a BOQ says "Sofa", the sheet
    is "Armchairs, Benches, Stools, Sofas". `item_category_aliases` takes it to
    56 of 59. Lowering the confidence cutoff would have turned "no match" into
    "confidently wrong", and a wrong category measures a record against the
    wrong checklist: complete-looking while asking none of the right questions.
11. **Requirements ship ungated.** No cheat sheet mentions a gate anywhere, so
    assigning one would be inventing data and attributing it to its owner.
12. **Cabinetry requirements were authored after all.** The brief said to leave
    them empty so they read as not-yet-defined; that predated having the
    sheets, which turned out near-identical to the upholstery ones.
    `requirements_authored` remains for a category added later without one.
13. **The source document is kept, in a PRIVATE blob store.** A public blob URL
    is access for anyone holding it, and these are NDA-covered client
    documents. Where no store is configured the import still works but records
    that the original was not kept, rather than pretending it was.
14. **`revision_no` ships at 0 on every answer.** One column now, instead of a
    primary-key migration on the busiest table when M6 needs the original spec
    and a VE alternative side by side.

## Decisions taken 2026-09-13 (M4, and the kit)

15. **Recording a chase does not write to `spec_answers`.** The obvious design
    is a `chased_at` column. It fires `bump_version`, which invalidates every
    M2 extraction snapshot taken against that answer for a reason unrelated to
    the answer — and writes a communication event into a business record.
    "Waiting for a reply" is derived instead, by matching sent coverage rows
    against live questions. The cost is a join on every completion read; the
    alternative was silently coupling two milestones together.
16. **Undo therefore does not check `version = snapshot + 1`.** That rule in
    the `email-draft-and-send-gate` skill exists because the fabric app's
    confirm mutates the covered rows, so exactly one bump proves nothing else
    touched them. Nothing is mutated here. Importing the rule without its
    premise would have blocked the most useful case: noticing the mistake
    precisely *because* someone has since edited an answer.
17. **Staleness compares a stored context snapshot, not just versions.**
    `requirements` and `spec_record_refs` carry no version, so an edited prompt
    or a corrected client ref would be invisible to a version-only check.
    Compared with a canonical stringification — `jsonb` does not preserve key
    order, and a plain `JSON.stringify` comparison made every draft read as
    stale the instant it was generated.
18. **Only the opening and closing are editable, as plain text.** The question
    table is generated from the coverage rows, so the body and the coverage are
    provably the same set — which is the guarantee the send gate rests on. A
    whole-body HTML editor would let them drift, and `sanitizeEmailHtml`
    describes itself as defence-in-depth rather than a sanitiser.
19. **Readiness questions are never selected by default.** 408 of the 728
    seeded requirements are readiness questions, including deposit status, COM
    payment plan and BWS folder setup — Ben Whistler's own commercial
    checklist. They are selectable, in a separate group, but not by accident.
20. **Non-production `.eml` exports address the signed-in user in both To and
    Cc.** A `[STAGING]` subject prefix does not stop anything: the file still
    carries the designer's real address and the project inbox, and one QA click
    in Outlook sends it. The intended production recipients are reported
    separately so the Cc path stays testable.
21. **A second database driver, for guarded writes only.** The Neon HTTP
    driver's `transaction([...])` takes a pre-built array and cannot evaluate a
    guard and abort, so every check ran before the transaction opened, under
    read-committed. `src/lib/db-transaction.ts` adds short interactive
    transactions on a real `pg` client for the new routes only; ordinary reads
    and single-statement updates stay on the HTTP driver.
22. **The kit is folded into `docs/kit/` and this repo is the only one worked
    in.** Two folders for one piece of work caused real confusion and bought
    nothing — the app already contained everything the kit had, verified file
    by file, apart from four kit-only artifacts. The kit also had no git
    remote and lived in one iCloud folder. The cost is that a third app forks
    from this one and strips the domain out; see `docs/kit/README.md`.

## Decisions taken 2026-09-13 (M2 step C, the project overview)

23. **`bws_project_number` is read-only after creation, and the route refuses
    it by name.** It is the BWS key, every `record_no` label is built from it,
    and M4 snapshots it into stored chase coverage. An edit would silently
    re-label history. Ignoring the field would have been the quiet option;
    refusing it with a reason is the one that teaches. Renaming a project
    number is a data migration.
24. **Overdue is computed on read, never stored** — the same reasoning as
    Waiting (15). A stored flag would have to be written onto `spec_answers`,
    bumping the version M2's extraction snapshots are taken against for a
    reason that has nothing to do with the answer. It is a date comparison in
    `src/lib/project-programme.ts`.
25. **A null `specs_agreed_by` reads as "no programme", not as "on time".**
    Both the overview and the spec table say so in words. Rendering an empty
    programme as healthy is the same class of error as a category with no
    requirements scoring 0/0 and reading as complete.
26. **The TOE dates are validated as an ordered set, merged over what is
    stored.** A request that changes one date is checked against the two it did
    not send, because a single-field edit can still produce an out-of-order
    programme. That merge lives in the route and is covered by a db-tier test.
27. **`date` columns are selected as `::text`, never as a driver `Date`.** Both
    drivers parse a `date` into LOCAL midnight, and `toISOString()` then renders
    the day before it in British Summer Time. Because the PATCH writes every
    column on every save, a read-modify-write that only changed the client name
    moved all three dates a day earlier — every time. Found by the db tier, and
    the first version of that test had the same bug in its own assertion
    helper. Keep the cast on every query that reads these columns.
28. **`ContactsPanel` is one component mounted in two places** — the project
    overview (its canonical home) and the chase screen (the bootstrap case: a
    fresh project has nobody to chase and no draft to hang a contact off). Two
    forms would drift, and the one that drifted would be the one used less.

## Decisions taken 2026-09-13 (M2 step C, the extraction pipeline)

29. **One staging table, not two.** M2 extends `intake_runs` rather than adding
    `document_extractions` beside it, and migration 0006 says why: two staging
    tables mean two confirm routes, and the second one is always the one that
    forgets a guard. The kit's `extraction-run.ts` comments told an app to
    CREATE that second table; that advice is now recorded as wrong in
    `docs/kit/CHANGELOG.md`.
30. **One new intake status.** `queued` only. `parsing` was already the
    in-flight value and `parsed` the staged one; adding `processing`/`extracted`
    alongside them would give one table two vocabularies for one lifecycle.
31. **`attempt_id` AND `claim_token`.** They look redundant. The first is a
    logical attempt and fences a superseded delivery; the second is one worker
    invocation, so a hard-killed worker whose request is still in flight writes
    zero rows after a later delivery reclaims. Neither alone does both jobs.
32. **A live claim is `busy` and the worker THROWS.** Acking a duplicate
    delivery spends the delivery that recovery depends on: by the next one,
    either the work is done and that delivery skips cheaply, or the claim has
    expired and that delivery is the recovery.
33. **No URL is ever accepted from a client.** M1 fetched a request-body `url`
    with `Bearer BLOB_READ_WRITE_TOKEN`. The fix is not a better URL check but
    never taking a URL: a blob is addressed by pathname, resolved by the store
    against its own host, scoped to `projects/<id>/` and checked at token issue,
    at registration and on every read.
34. **The import type is declared, never inferred.** A BOQ and an FF&E schedule
    are both `.xlsx`. Inferring would eventually feed a schedule to the BOQ
    parser and create a project's worth of wrong records from a document that
    was never a bill.
35. **The model returns observations only** — no record id, no requirement id,
    no answer state. Resolving `SX11A` is not a language problem: it appears
    twice in the pilot BOQ, and a model asked to choose will choose confidently
    and be right half the time. `confirmed` versus `tbc` is likewise an
    operational decision that belongs in tested code, not a prompt.
36. **Prompts are static literals, one per document kind.** Nothing is
    interpolated — no registers, no vocabulary. A prompt built from seed data
    cannot be unit-tested and drifts silently the moment the seed changes.
37. **`maxRetries: 0` on the SDK.** The queue owns retries. The SDK retries
    twice by default, and ×4 deliveries is up to 12 paid calls where at most 4
    are intended.
38. **Proposals are keyed by server-generated UUID; reviewed rows stay in
    `lines`.** Reviewing one changes the set the screen filters, so a position
    is not an address. Keeping reviewed rows removes compaction, a second array,
    an inverted restore guard and restore-by-reinsertion at once.
39. **Blockers are computed on every read, never stored.** A retarget clears an
    acknowledgement and a duplicate-target clash comes and goes as other rows
    move; a stored blocker would be stale by the first edit, and the screen and
    the confirm route would disagree about whether a card can commit.
40. **`matchName`'s exact-name path returned the FIRST candidate.** Found by a
    test on 2026-09-13. Two requirements legitimately share a prompt ("Other
    notes"), so `find` silently broke a real tie — the exact failure that
    module's own header forbids. It now returns every exact match.

## Still open

Observed 2026-09-12. These are the brief's own gaps; none is a decision taken.

1. **The gate model is unreconciled.** The handover and the design requirements
   use TG0 / TG1 / TG2. On 2026-09-12 Matthew separately proposed a pre-sale
   gate **TGQ** ("enough info to quote"). Until Matthew reconciles them, gates
   are data and TGQ is recorded as proposed.
2. **Who owns the requirement matrix after M1 seeds it is undecided.** The
   cheat sheets are XLSX/PDF per category in SharePoint (~19 across Upholstery
   and Cabinetry). The workflow diagram flags this as the real institutional
   gap: it currently relies on KAM / sales-support knowledge. Waiting on
   Matthew.
3. **Keeping `spec_fields` in sync with BWS** — mechanism and cadence
   undecided. The `external-vocabulary-sync` skill covers the *how*; the *who*
   and *when* do not exist. Waiting on Matthew.
4. **TOE dates for P17231 are stale, and `specs_agreed_by` has never had a
   value.** The overview screen (2026-09-13) is now the way to enter them, and
   the order and delivery dates from the project context (17/02/2026,
   17/06/2026) have been entered in sandbox. **`specs_agreed_by` is
   deliberately left null**: no source document names it, and inventing a date
   for the field that drives Overdue would make every red flag on the spec
   table a fiction. It needs the real programme date from the user.
5. **The finishes schedule for P17231 was not found.**
6. **BWS access.** The user could not log in as of 2026-09-12. The AI mirror
   (`bws-next-ai.whistlercloud.com`) is refreshed daily, discards changes, and
   its import/export does not work — a read/reference surface, not an
   integration target, and it cannot be used to test the M3 CSV export.
7. ~~**Anthropic zero-data-retention.**~~ **Cleared 2026-09-13** by the user.
   Client specification documents may go to the model; M2 is unblocked. Who
   owns the Anthropic Console account is still unnamed.
8. **Account ownership.** The GitHub repo (`max21608-sketch`) and the Neon org
   (`max21608@gmail.com`) are personal accounts holding NDA-covered client
   material under a Ben Whistler contract. Noted, not decided.
9. **Blob retention.** Nothing in the application deletes an uploaded
   document, ever. M1 is the first real consumer of that store, so the gap is
   now live rather than theoretical. See `db/README.md`.
10. **M4 has had no human acceptance.** Automated checks pass; nobody has used
    it, and no generated `.eml` has been opened in the real Outlook client.
    Until that happens, the claim that a human can send one of these is
    untested.
11. **Nobody owns the Anthropic Console account.** `ANTHROPIC_API_KEY` is set
    locally AND in Vercel staging as of 2026-09-13 (verified in the project's
    environment variables), so the key is no longer the blocker. The named
    Console owner still is: account-level retention settings live there, not in
    this app, and a Vercel region setting does not establish them. Confirm the
    intended account and model path match the ZDR clearance before a real client
    document is sent.
12. **The question-to-BWS-field mapping is unreviewed.** 320 of the 728 seeded
    requirements point at a BWS field, and that mapping is this repo's
    judgement, not Matthew's. Only 28 of the 56 fields are reachable from a
    cheat-sheet question at all. Review before M3 depends on it.

## Running agents in parallel

- One `git worktree` per agent.
- **Exactly one agent owns `db:migrate` and the sandbox.** The runner applies
  every not-yet-applied file in sorted order, so a second agent's half-written
  migration would be applied by the first.
- Give a pure-library agent no `DATABASE_URL`; database suites skip without it,
  which is correct for that work.
- Exactly one agent pushes the branch.
- `CLAUDE.md` / `AGENTS.md` belong to exactly one agent, or they diverge.
- Two agents works. Three does not, and would likely be slower than two.
