# Plans

## Releases

| Release | Document | Depends on | State |
|---|---|---|---|
| Scaffold | `bw-app-kit` Part 2 plan | — | Built 2026-09-12 |
| M1 — spec table and completion view | `part-2/` plan + this log | — | **Shipped to staging 2026-09-13** |
| M2 — AI extraction of richer documents | `part-3/m4-chase-emails-and-m2-extraction.md` | M1; an Anthropic key + account owner | **Built and deployed 2026-09-13.** API verified with one approved synthetic document. A real pilot schedule has not been read, and no human has used the review screen |
| M3 — BWS-layout export (complete dataset) | this log, 2026-09-14 | M1 | **Built 2026-09-14** as a REVIEW file (no Id, no Job Number). Not verified against a real BWS import |
| M4 — draft chase emails | `part-3/m4-chase-emails-and-m2-extraction.md` | M1 | **HIDDEN 2026-09-14.** Code, routes and tests intact; entry points removed |
| M7 — the intake rebuild | this log, 2026-09-14 | M1, M2 | **Built 2026-09-14** (`0007`). Packs, runs, drawing attributes, preamble notes, export. No human acceptance; no real drawing set extracted |
| **M8 — the Panther pass** | this log, 2026-09-15 | M7 | **In progress from 2026-09-15.** The pilot pack in, transposed not inferred, and a BWS-layout export a human calls correct. THE milestone |
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

## Step D evidence — the first real model call, 2026-09-13

One approved synthetic document. Invented refs and finishes, a throwaway
project, deleted afterwards; no client material was sent. Repeatable with
`VERIFY_MODEL=1` and `tests/manual/verify-model.test.ts`, which is gated off by
default because it spends money.

**API compatibility confirmed** against `@anthropic-ai/sdk` 0.110.0 and
`claude-sonnet-5`: `thinking: { type: "adaptive" }` + `output_config: { effort:
"high" }` + a forced `tool_choice` + a NON-strict tool schema using `anyOf` for
nullable enums, streamed and awaited with `finalMessage()`. All accepted.

| Measure | Value |
|---|---|
| Source | 7-row CSV FF&E schedule, 380 bytes |
| Input / output tokens | 2,146 / 1,013 |
| Model elapsed | 8.4s |
| Wall clock incl. blob + registers | 9.6s |
| Requests billed | **1** (`maxRetries: 0` holds) |
| Proposals returned | 7, one per source row |

**Every safety rule held against real model output**, not a fixture: a literal
`TBC` became `tbc` and not `confirmed`; `N/A` became `na` with no value;
"Walnut veneer satin lacquer TBC" got NO state and a blocker asking which it
is; the two conflicting `Leg finish` rows were BOTH kept rather than one
winning; and `QA-999`, a ref in no bill of quantities, resolved to no record
rather than a plausible neighbour. The model's own `documentNotes` named the
conflict and the unknown ref unprompted.

**One defect found and fixed by this run.** `requestId` came back null for a
perfectly good extraction: `stream.finalMessage()` resolves to an assembled
Message, and the non-enumerable `_request_id` that a plain response carries is
not on it. The id is the only handle anyone has when asking the provider about
a bad extraction. It is now read from `stream.request_id`.

**The finding that decides the next step: 1 of 7 attributes matched a
requirement.** Only "Main timber finish" resolved, because it is a cheat-sheet
question verbatim. "Leg finish", "Seat fabric" and "Piping" matched nothing and
produced no candidates — the register simply has no question phrased that way.
Record resolution, by contrast, was 6/6.

That is exactly the shape of decision 10, where BOQ category matching went from
5/59 to 56/59 on seeded aliases while a lower cutoff would have turned "no
match" into "confidently wrong". `requirement_aliases` exists and is empty.
**It cannot be seeded from here**: the rule is verified pilot wording only, and
inventing aliases would be a confident wrong match wearing a seed file's
authority. Seeding it needs the real FF&E schedules and cheat sheets.

## The SharePoint survey, 2026-09-14

A read-only traversal of the P17231 tree. Nothing was modified. The index is
`docs/docs for building/P17231 SharePoint Index.md` — gitignored, because it
carries real client filenames, revision dates and drive item IDs.

**Resolved from the handover's "Still Required" list:**

- **The TA FF&E schedules exist — nine of them, not one.** The handover lists
  only the 211 schedule. The set covers every TA suite except prototypes 218
  and 314, which have layouts but no schedule. That is a **spec gap, not a
  filing gap**: nobody has drawn them, so no amount of searching will produce
  one.
- **The TOE was located** (`Terms of Engagement V5 ML.xlsx`) and is confirmed
  stale. It is a spreadsheet date-calculator, not a signed contract.
- **The finishes schedule is confirmed absent** — see open item 5 below.

**Findings that change what gets built:**

1. **The spec table spans TWO BOQs, not one.** An LCS BOQ exists
   (`…BOQ Furniture & Seating LCS (3).xlsx`) alongside the TA BOQ every project
   doc describes. Every doc characterises the BOQ as a single document, and M1
   was verified against the TA one alone. M3's "complete dataset" rule makes
   this load-bearing: an export built from one BOQ is a partial export, which
   is the erasing case.
2. **Client mark-up documents exist** — MHG comments on the Room Harmonies and
   the R+1 bible, Gleeds/MHG comments on the material boards. This is the
   client's written approval trail, i.e. exactly the provenance content the
   tool exists to capture. It should be a first-class input, not an attachment.
3. **Room-number keying is zone-prefixed** (`3SG-209`, `5AR-501`, `4SO-324`),
   and the Room Mix uses a fuller form again (`3SG_P00_01_001`). Any room-based
   join must normalise these first.
4. **Parse the cheat sheets' two `TEMPLATE.xlsx` masters, not the 19 PDFs.**
   The PDFs are Excel exports. The pack exists three times (project root, GR,
   Common Areas) with byte-identical PDFs; **the GR copy is canonical**,
   because its masters are larger and therefore later.
5. **~2.3 GB of the 3.81 GB tree is CGI renders**, concentrated in one folder.
   Any bulk-ingest routine must exclude it explicitly.
6. **The BW Quote & Proforma folder is empty** although a live pro-forma exists
   (PF/36731-BW, BENO-19885). The commercial output is not being filed back to
   the project folder at all — which is the step the design requirement to
   *generate* quote text from spec data replaces.
7. **The folder template is consistent** across GR and Common Areas, which
   matters if the tool is ever to read project folders generically.

## Decisions taken 2026-09-14 (the intake rebuild, migration 0007)

The user redirected the build on 2026-09-14: nail down the INTAKE stage and
park everything after it. Documents arrive as a pack, a BOQ has tabs, drawings
carry the real specification content, and the output is an Excel file in the
BWS job-spec layout. Chasing what is missing is a later stage.

41. **A BOQ tab is a RUN, not a revision and not a project.** `MUR`, `MAIN RUN`
    and a VE run quote the SAME codes at DIFFERENT quantities, and all three can
    be live, quoted and ordered at once. They cannot be `spec_answers.
    revision_no` (that is a VE alternative to one ANSWER, M6) and cannot be
    separate projects (they share a client, a programme and a document set).
    `spec_runs` it is, one tab each on the project screen.
42. **`spec_records.run_id` is NOT NULL, backfilled one run per confirmed
    import.** Not one per project: the SharePoint survey found two BOQs on the
    pilot, and merging them would produce an export that claims to be one
    complete dataset while being two half ones. A record on no run is on no tab
    and in no export scope — invisible in exactly the way the `unclassified`
    proposal diagnostic exists to prevent.
43. **`parseBoqSheets` stages EVERY sheet with a header.** It used to return on
    the first and drop the rest silently, so a three-tab bill imported as a
    clean third of itself. `L1`..`L6` are deliberately absent from the header
    synonyms: they are per-level quantities, and reading one as the total would
    order 3 sofas instead of 14.
44. **Drawing specs are `record_attributes`, not `spec_answers`.** A page gives
    S-100 four dimensions, a fabric and a wood finish. `spec_answers` is one row
    per (record, requirement, revision), the requirement must belong to the
    record's category, and an uncategorised record has no questions at all — so
    two fabrics on one page would collide on the unique key, and a dimension's
    UNIT has no column to live in. The new table is multi-valued,
    requirement-free and points straight at a BWS field.
45. **The COM slot IS the BWS field.** Fabric 1 → `COM 1`, fabric 2 → `COM 2`;
    wood 1 → `Main timber finish`, wood 2 → `Timber Finish 2`. A partial unique
    index on `(record_id, spec_field_id)` where the row is active and not a
    dimension stops two values quietly sharing a slot, which is how an export
    loses one of them with no error anywhere. Dimensions are exempt: many of
    them compose into the single `Dimensions` field by design.
46. **A dimension with no printed unit gets NO unit and a blocker.** The AP364
    pages mix centimetres (190/79/72, a sofa) and millimetres (550/735, a desk
    chair) and print neither. `suggestUnit` offers one only when every figure on
    the page agrees; a mixed page gets nothing. A wrong unit reads as a real
    measurement and nothing downstream questions it.
47. **The register-free kinds resolve at READ time, not in the worker.** A
    spec-document proposal needs a target snapshot to detect a concurrent edit;
    a drawing observation is an INSERT with no prior value, so its model output
    depends on no register. Consequence, and it is a feature: a drawing set can
    be extracted before its BOQ is confirmed, and confirming the bill later
    resolves everything with no second model call. Refusing to queue would have
    forced an order the post does not arrive in; re-extracting would have cost a
    second call for identical output.
48. **The unit of commit for drawings is the ITEM CARD, not the record.** One
    drawing of S-100 belongs to three runs at once. The card the reviewer reads
    is the page, so that is what commits atomically. Same purpose as "the record
    is the unit of commit": never commit a card somebody did not see whole.
49. **A code in several runs is a FAN-OUT; the same code twice in ONE run stays
    ambiguous.** The first is one drawing of one item quoted three ways; the
    second is the `SX11A` case, two different items sharing a code. A matcher
    that ignores runs cannot tell them apart, so grouping by run is the whole of
    `resolveDrawingTargets`.
50. **Confirming an attribute does not touch `spec_records.version`.** The same
    reasoning as decision 15: a bump would invalidate every extraction snapshot
    and chase coverage row taken against the record for a reason unrelated to
    them.
51. **Category no longer blocks BOQ confirm, reversing a rule 0002 states.**
    Intake must not stall behind a classification decision that belongs to a
    later stage. This opened a gap — a record with no category could never
    acquire one — which `PATCH /api/records/[id]` closes, creating the answer
    rows in the same transaction. A category with no answers scores 0/0 and
    reads as complete, the same error class as an empty programme reading as a
    healthy one. Changing a category is still refused once anybody has answered
    under the old one.
52. **The export is never filtered, and the route enforces it.** Any query
    parameter other than `runId` and `format` is a 400. A BWS import replaces
    rather than merges, so "export only what changed" is the erasing case, and a
    rule that lives only in a comment is one the next caller has already broken.
53. **The export is a REVIEW file, not an import file.** No `Id`, no `Job
    Number`: this app has never had BWS access and does not know them. BWS-owned
    vocabularies (Category, Status, Lifecycle State, KAM, Routing) are left
    BLANK rather than guessed — a guessed enum is either rejected on import or
    accepted as a wrong classification. The second sheet lists every attribute
    long-form, because flattening 56 columns loses the client's material code,
    the source page, and the second and third dimensions of a slot.
54. **The 109 export columns are a static constant, not a query.** Only the 56
    spec fields and the 22 website/style columns carry json ids, so the list
    cannot be derived from `spec_fields`; `Client Code` (136) is one of the
    website ids. A test asserts its 56 spec ids equal the seeded ones, which is
    what catches a BWS column insertion — every letter after it shifts while the
    ids do not.
55. **Preamble notes go to a NEW `project_notes` table.** The chassis `notes`
    table is append-only by trigger, so a model that cut a nineteen-page
    document in the wrong place would leave an uncorrectable note on the project
    overview. These are retired, never deleted.
56. **Two new document kinds under `source_kind = 'spec_document'`, not beside
    it.** The whole claim protocol — the fenced worker UPDATE,
    `intake_runs_attempt_shape_check`, the extract route — is keyed on that
    value. A new source kind would have opted drawings out of every one of those
    guards silently.
57. **`.catch([])` removed from the drawing arrays.** It turned an over-long or
    malformed array into an EMPTY one, so a page with 41 dimensions would stage
    as a page with none and nothing anywhere would say so. `.default([])` still
    covers a key the model omitted; a schema failure is terminal and reported.
58. **Chase emails are hidden, not deleted.** M4 was finished and never
    accepted; deleting it would throw away working, tested code. The screen
    redirects and documents how to bring it back.
59. **`exceljs` adds one new advisory chain** (`uuid`, moderate: a missing
    buffer bounds check in v3/v5/v6 when a caller passes `buf`). exceljs does
    not expose that argument, and the `npm audit fix` downgrades exceljs two
    major versions. Accepted and recorded rather than silently carried; the
    other eight findings are the pre-existing dev toolchain.

## Decisions taken 2026-09-15 (the Panther pilot)

From the review of 2026-09-14, circulated by Steve, and confirmed by the user on
2026-09-15. The scope statement lives in `CLAUDE.md`; the reasoning lives here.

60. **Project Panther (`AP364`, BWS `P17726`) is the pilot; Maybourne Paris is
    deferred.** The SharePoint survey (2026-09-14) found the same content at
    several revisions with no machine-readable ordering, and nobody can yet say
    which copy is current — Hayley confirms that before AP346 is used again.
    Panther's set is small enough for Matthew to curate by hand, which removes
    the one variable that would otherwise be blamed for every bad extraction.
61. **The pilot reads a curated folder and a named mailbox, not the raw tree.**
    Our project folders are hand-made and inconsistent, so automated discovery
    is unreliable; Tim's BWS workflow will generate the reference, inbox and
    folder set at quote creation, and the pipeline should be proved on a clean
    input first. Consequence for anyone working here: do not build discovery,
    and do not crawl outside the curated folder.
62. **The first pass transposes and does not infer.** Gaps are `TBC`, which is
    already a distinct state in `spec_answers`, not a blank to be helpfully
    filled. A grid that quietly completes itself is worse than one with holes,
    because the holes are what the quote needs to price and chase. This is also
    why `record_attributes` is requirement-free: a statement with no matching
    question is retained, not discarded for failing to fit a template — BWS
    category boilerplates are a best guess at the fields per product code, and a
    complex item on a simple template will be short of them.
63. **"Flawless export" is a human acceptance test.** The four checks are the
    floor. The milestone completes when a person reads the exported workbook
    against the pack line by line and says it is right — which is also the first
    real check of the export's job columns, this repo's judgement since
    2026-09-14.
64. **"Trained on the Panther BOQ" means tuned against it, not fine-tuned.** The
    levers are prompts, `item_category_aliases`, `requirement_aliases` and unit
    handling, seeded only from verified Panther wording. Recording this because
    the phrase recurs in meeting notes and would otherwise be read as a model
    training plan that does not exist and is not wanted.
65. **TGQ — the minimum specification needed to issue a quote — is the gate the
    tool is aiming at**, ahead of TG0 and TG1, because pre-sale is where the
    least structure exists today. It stays unauthored while M8 runs: all 728
    requirements remain ungated and there is no `gates` table. A gate over a
    grid that is not yet right would only certify the wrong thing.
66. **The BWS boilerplates were captured and mapped, and the feature stays
    deferred.** `docs/plans/boilerplate-grouping.md`. All 47 product codes in
    the `** BOILERPLATES **` grouping were read on 2026-09-14 and compared
    against the seeded registers on 2026-09-15: 29 of 34 field labels match a
    `spec_fields.name_norm` exactly, 2 are judgement renames, 3 do not map.
    Captured now because the read is cheap and repeatable (one GET per code of
    `/product_codes/<id>/specifications`) and because the comparison answers a
    question already open — **24 of the 56 fields are reached by both a
    cheat-sheet question and a BWS boilerplate, and 21 by neither**, the 21
    being BOM, Blue Label, finishing detail and purchasing. That is independent
    support for "several BWS columns are post-sale only", and it is what lets a
    human reading the export tell a blank that belongs from a blank that is a
    miss. Deferred rather than built because M8 owns everything and because the
    data disproves the obvious use: Bar Stools *with Metalwork* carries no metal
    fields, and three Hero variants equal their plain twin, so a boilerplate
    cannot state what an item needs. Use it to explain a blank, never to forbid
    a value. Raw rows stay in `docs/docs for building/` — the repo commits
    schema, never rows.

## Decisions taken 2026-09-15 (Matthew's spec grid, migration 0011)

Matthew circulated a tidied field grid with worked example rows on 2026-09-15,
alongside the Panther pack. The blocks and formatting rules are in
`docs/bws-spec-grid.md`; the reasoning for what changed in the app is here.

67. **A dimension is one of five named slots — W, D, H, SH, Dia — and nothing
    else.** It used to carry whatever label a document printed. That is not a
    worry, it is a measured output: one AP364 armchair page returned 44 figures,
    and the Panther specification sheets label five more of them WIDTH SEAT,
    DEPTH SEAT, WIDTH BACK, DEPTH BACK and ARM HEIGHT. Composed into BWS field 3
    that produced a cell nobody could read and nobody could check against a
    page. The user's words on being shown it: "we don't need endless dimensions."
68. **`normaliseDimensionSlot` matches the WHOLE folded label, never a
    substring, and that is the load-bearing line in the change.** A substring
    rule reads `WIDTH SEAT` as a width and overwrites the item's real width with
    a seat measurement; it reads `ARM HEIGHT` as a height and overwrites the
    real height with 520. Both are printed on the S-100 sheet beside the values
    they would destroy. The asymmetry that follows looks like a bug and is not:
    `HEIGHT SEAT` maps to `SH` because that is where the template prints the
    seat height, while `WIDTH SEAT` maps to nothing because a seat-only width
    has no slot. The sandbox's own QA rows made the same point independently —
    they were labelled `Front view width` and `Side view width`, and in a side
    elevation the horizontal dimension is the DEPTH.
69. **Every other measurement is kept as a NOTE, intact — which is why
    `record_attributes_unit_is_dimension` had to be replaced.** `ARM HEIGHT
    520mm` keeps its label, figure, unit, source run and page, and still prints
    on the export's long-form sheet; it has only stopped claiming a BWS
    dimension. The old constraint forbade a unit on a note, so the alternative
    was folding "520" and "mm" into one string — the exact thing
    `src/lib/anthropic.ts` tells the MODEL never to do. `0011` replaces it with
    `record_attributes_unit_is_measurement`; a material still cannot carry one.
    Found the hard way: the first run of `0011` failed on a real QA row because
    it demoted the rows before swapping the constraint. The `begin; … commit;`
    wrapper rolled the whole file back, which is what that wrapper is for.
70. **Round is inferred from the `Dia` slot being filled; there is no shape
    flag.** A flag is a second source of truth that can disagree with the data,
    and it is another decision per record. `Dia.` together with a `W` or `D` is
    a CONFLICT — cross-row, so no check constraint can express it and a trigger
    would fire mid-fan-out naming a row the reviewer never saw. It is a computed
    blocker and a named problem on the cell, like every other blocker here.
71. **The composer refuses to emit a number it could not derive.** A figure with
    no unit, or a value like "approx 720-740", is rendered verbatim outside the
    millimetre group in a bracket saying why. A guessed conversion looks exactly
    like a real measurement, and nothing downstream would ever question it. Loud
    beats tidy. The cell is a SUMMARY; the long-form sheet still carries every
    original value, unit and page — and now the slot too, which is what makes a
    converted `W1900` re-checkable against a page that says 190.
72. **`0011` half-lifts `0007`'s slot-uniqueness exemption.**
    `record_attributes_field_slot_key` exempted dimensions because many compose
    into one field — still true, five of them still do. But with a fixed slot
    set, "one active W per record" is enforceable, and a second drawing page
    adding a second W is precisely the silent overwrite that index exists to
    prevent. The field index is untouched; a slot index sits beside it.
    **Known risk, recorded rather than discovered later:** a nest of three
    tables, or a pair of bedsides, quoted as ONE BOQ line has three widths. The
    index refuses that and the extras land as notes — Still open 21.
73. **The grid's 36-field subset is presentation, not schema.** Applying it to
    the export file would be the erasing case decision 52 exists to prevent: a
    BWS import replaces rather than merges, so a 36-column file wipes the other
    73. It drives how the app's own screens group and order fields, and every
    seeded field stays available everywhere — a field that cannot be selected is
    a spec value that cannot be recorded, and nothing anywhere would say so.

## Decisions taken 2026-09-16 (an overall dimension printed as one line)

74. **A combined line is reported verbatim and split in code, not by the
    model.** The Panther pack carries two specification-sheet templates: one
    labels its figures, the other prints `80 x 70 x 90 cm` and nothing else.
    Both arrive in the same delivery, so the second is not malformed input.
    `dimensionsCombinedRaw` asks for the line as printed and forbids the model
    splitting it, because which number is the width is carried by ORDER — a
    reading, not a fact on the page, and this app's rule about what an order
    means does not belong in a prompt where nothing can test it.
75. **Three bare figures are read as W x D x H; everything else gets no slot.**
    This is the ONLY inference in the dimension model that the page does not
    state, so its boundaries are the decision. Two bare figures could be W x H,
    W x D or Dia x H — a 60/40 guess there writes a height into the depth and
    nothing questions it. Four or more has no convention. A line MIXING a
    prefixed part with bare ones resolves only the prefixed, because mixing an
    explicit reading with a positional one is how the positional half inherits
    the explicit half's credibility. The three-bare case is inferred rather than
    refused only because the card badges it amber AND shows the composed cell
    beside it: a transposed order is obvious there in a second, where refusing
    would mean hand-assigning three slots per item across a pack — the volume at
    which a question stops being read (the same reasoning as `0008`'s project
    default unit).
76. **`suggestUnit` now counts only values that are one figure.** It stripped
    every non-digit, so `80 x 70 x 90` read as 807090 — one value, far over the
    300 threshold, enough to carry a whole page's vote to millimetres and record
    an 80cm armchair as 8 metres. Nothing could reach it while dimensions
    arrived only as separate figures; decision 74 made it reachable, so it was
    fixed in the same change rather than left one feature away. It shares
    `parseDimensionFigure` with the composer, so the magnitude vote and the
    conversion can never disagree about what counts as a number.
77. **A combined part's TBC does not go through `suggestAttributeState`.** That
    function refuses to choose when a value both states something and says TBC —
    right for `Dark tinted wood TBC`, where nobody can tell whether the wood is
    settled. A dimension has no such ambiguity: `W1520 TBC` is a figure of 1520
    the client has not signed off, and it is Matthew's own worked example.
    Routing it through the general rule produced a `no_state` blocker on a value
    the parser had already read correctly.

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
3b. **`requirement_aliases` is empty, and attribute matching is weak without
   it.** Measured at 1/7 on the synthetic sample above. Needs the real FF&E
   schedules and cheat sheets so aliases can be seeded from wording somebody has
   actually verified. Until then a reviewer places most attributes by hand from
   the question dropdown, which works but is the slow path.
4. **TOE dates for P17231 are stale, and `specs_agreed_by` has never had a
   value.** The overview screen (2026-09-13) is now the way to enter them, and
   the order and delivery dates from the project context (17/02/2026,
   17/06/2026) have been entered in sandbox. **`specs_agreed_by` is
   deliberately left null**: no source document names it, and inventing a date
   for the field that drives Overdue would make every red flag on the spec
   table a fiction. It needs the real programme date from the user.
5. **The finishes schedule for P17231 does not exist.** Upgraded from "not
   found" to **confirmed absent, 2026-09-14**: the three folders that should
   hold it (`COM & Finishes Schedule`, `GR/…/Finishes Schedule`, and the
   Common Areas equivalent) are all empty. The nearest substitutes are the Room
   Harmonies, the Gleeds/MHG commented material boards and the zoning colour
   schemes — none of which is a finishes schedule. Stop looking; decide what
   the tool does without one.
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
10. **M4 has had no human acceptance, and is now hidden.** Automated checks
    pass; nobody has used it, and no generated `.eml` has been opened in the
    real Outlook client. It was hidden on 2026-09-14 rather than deleted (see
    decision 58), so that remains true and unresolved.
10b. **The intake rebuild has had no human acceptance either.** Observed
    2026-09-14. Four checks pass with the database tier running, and the browser
    walkthrough exercised the screens; nobody who does this job has used it.
    Critically, **no real drawing set has been through the model** — the prompts
    and schemas are written against the AP364 pages but only synthetic fixtures
    have exercised them. One real extraction judged by eye against its pages is
    what decides whether intake is usable.
10c. **The export has never been checked against a real BWS import.** Observed
    2026-09-14. The 109 columns and the 56 spec ids are verified against the
    reference export; which job columns BWS actually wants, and in what form, is
    this repo's judgement.
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
    cheat-sheet question at all. Review before M3 depends on it. The boilerplate
    comparison of 2026-09-15 narrows what to review first: 24 of those 28 are
    corroborated by a BWS boilerplate, 4 are not, and 7 fields a boilerplate
    carries have no question at all — including `Timber Finish 2` (on 32 of 45
    boilerplates) and `Metal Finish 2` (29). See
    `docs/plans/boilerplate-grouping.md`. **Written up for Matthew as four
    answerable questions on 2026-09-16** —
    `docs/plans/questions-for-matthew.md`, which adds the export's five job
    columns to the same ask. Awaiting his answers.
13. **Source-document version precedence is undefined, and it is the biggest
    structural risk the survey found.** Observed 2026-09-14. The same content
    exists at multiple revisions with no machine-readable ordering across six
    conventions: French *indice* letter (Ind A → Ind B), REV number, ISO date
    prefix (`20251105_`), three different date *suffix* formats in two orders
    (`28052026`, `25.10.16`, `ACOS_26.03.10`), bare "Copy 2", and parenthetical
    `(3)` / `(002)`. The BOQ and COM files are duplicated across GR root and
    Submitted Tender Documents **at differing sizes**, so which is current is
    not determinable from the names. Compounding it, the LCS drawings are
    Indice 00/B dated **2024** while the bibles are Indice A–E dated **2026**.
    Two consequences: no bulk ingest until a precedence rule exists, and every
    spec value must carry the document *and revision* it came from — a value
    whose source cannot be named is a value nobody can re-check.
    **First hard evidence, 2026-09-15:** the Panther specification sheets state
    a precedence rule in their own body text — the signed shop drawings and the
    approved samples take precedence over the spec sheets. That is one pack's
    rule, printed on the pack, not a general one; it is a starting point for the
    rule this item asks for rather than the rule itself.

Observed 2026-09-15, from Matthew's spec grid. See `docs/bws-spec-grid.md`.

14. **`job_client_item_reference` — does it exist in BWS, and where?** Matthew
    added the column to his grid at position B and says it already exists in
    BWS, to be used for the client item code. It appears nowhere in our captured
    109 columns nor in `docs/docs for building/BWS Job Spec Fields.csv`. Its
    snake_case spelling matches `export_to_public_website` and
    `name_for_public_website`, the only other snake_case names in the layout and
    both id-less job columns — so "BWS has it and our header capture is stale"
    is at least as likely as "it is his own name for something". **No 110th
    column was added**: his sheet is his own re-ordering, so a position in it is
    not evidence of a position in BWS, and a header BWS does not recognise
    either fails the import or is silently ignored — the silent case being
    worse, because we would believe we had sent the client's code. The client
    item reference is already modelled as a `spec_record_refs` row with
    `ref_system = 'boq_code'` and reaches the export as `Client Code` (136).
    Needs from Matthew: the exact header and position in a fresh export, whether
    it carries a json id, and whether the client's item code belongs there
    rather than in `Client Code` — **his job block omits `Client Code`
    entirely**, which is a hint it might.
15. **Does column A `Id` mean the export should ever become an import file?**
    Matthew's grid keeps `Id` and `Job Number` and he notes `Id` is "important
    for BWS to know where to put the info when we upload it, post sale".
    `CLAUDE.md` lists a BWS *import* file carrying job numbers as explicitly
    excluded, and the export is deliberately a REVIEW file with neither value,
    because this app has never had BWS access and does not know them. **This is
    not a small question**: an importable file is one step from a code path that
    writes to BWS, which is a hard invariant. Keeping `Id` in a tidy-up
    spreadsheet is not a request to build one. Confirm the intent before
    anything reads it as one.
16. **"We also need a field for free text" — which field?** From Matthew's
    email. `Upholstery free text` (267) is in his grid and is upholstery-only;
    `Purchasing Notes` (24) is in the register and not in his grid; `Hidden
    Notes` (234) is in CJ–DE, not seeded, and reads as internal. His cabinetry
    block has twelve structured fields and no prose field at all, so "a
    cabinetry equivalent of 267" is the likeliest reading. Nothing was invented:
    a `note`-group attribute with no `spec_field_id` already is free text
    against an item with its source page, and it reaches the record screen and
    the export's second sheet but **not** the 109-column jobs sheet. Needs one
    sentence from him naming the BWS column.
17. **Two columns in the grid's upholstery-build block have a colour, a
    position, no header and no id.** They were kept and colour-blocked
    deliberately, so they mean something. Nothing in the app can act on them
    until they are named. They may be the answer to item 16.
18. **`Timber Finish 1` / `Metal Finish 1` vs `Main timber finish` / `Main metal
    finish`.** Our export constant and seed both carry the `Main …` spellings,
    verbatim from the export header. `docs/docs for building/BWS-spec-system-reference.md`
    independently records the BWS *screen* showing `Timber Finish 1`, and the
    boilerplate capture of 2026-09-15 calls the same pair a judgement rename —
    so this reads as a UI-label vs export-header difference, not a rename. The
    ids match, which is the only key that matters. **Do not "fix" the names:** a
    tidied header is a column BWS will not recognise on import. Confirm, then
    decide whether the app should show the screen label beside the export name.
19. **Multi-COM overflow past COM 3.** Matthew raised it himself: "We have one
    for required, but only one so multi COM items would need more fields."
    `FABRIC_SLOTS` is exactly three and `record_attributes` is unique on
    `(record_id, spec_field_id)`, so a fourth fabric on one item has nowhere to
    go and the reviewer gets a duplicate-slot blocker with no resolution. **What
    BWS does with a fourth COM is unknown** — a free-text field, a split job, or
    nothing. Do not invent slots 4 and 5. Blocking, and saying why, is the right
    failure while it is unknown.
20. **Nothing re-pulls the BWS export header row, and item 14 is the first
    concrete symptom.** The guard test compares `BWS_EXPORT_COLUMNS` against
    `db/seed/0001_spec_fields.sql`; both are this repo's copies and can be stale
    together. `spec_fields.synced_at` is written by the seed and read by
    nothing. The `external-vocabulary-sync` skill's re-sync loop — import the
    current list, produce an added/removed/renamed diff, a human reviews it,
    apply as a migration — has never been run, because nobody can log into BWS
    (item 6). This is item 3's *how* becoming urgent.
21. **One active W per record may be too strict.** Observed 2026-09-15 while
    writing `0011`. A nest of three tables, or a pair of bedsides, quoted as ONE
    BOQ line legitimately has three widths; the new unique index refuses that
    and the extras land as notes. Nothing in the Panther pack exercises it —
    every line there is a single item — so this is untested either way. **The
    highest-risk assumption in the dimension model.** Ask whether a
    multiple-item BOQ line is real here before the pilot meets one.
22. **Two details of Matthew's dimension ruling he has not shown.** The `mm`
    spacing — his rule says `H***mm` and his own worked example says `H1005 mm`;
    pinned to no space. And a slot marked TBC with no figure at all, pinned as
    `W TBC x D560 x H1005mm`; he has only shown the inline form `W1520 TBC`.
    Both settle in a word and neither blocks anything.

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
