# Plans

## Releases

| Release | Document | Depends on | State |
|---|---|---|---|
| Scaffold | `bw-app-kit` Part 2 plan | — | Built 2026-09-12 |
| M1 — spec table and completion view | `part-2/` plan + this log | — | **Shipped to staging 2026-09-13** |
| M2 — AI extraction of richer documents | `part-3/m4-chase-emails-and-m2-extraction.md` | M1; an Anthropic key + account owner | **Built and deployed 2026-09-13.** API verified with one approved synthetic document. A real pilot schedule has not been read, and no human has used the review screen |
| M3 — BWS-layout export (complete dataset) | this log, 2026-09-14 | M1 | **Built 2026-09-14** as a REVIEW file (no Id, no Job Number). Not verified against a real BWS import |
| M4 — draft chase emails | `part-3/m4-chase-emails-and-m2-extraction.md` | M1 | **RESTORED 2026-09-16**, with a to-quote tier. Entry points back; no human acceptance and no `.eml` opened in real Outlook |
| M7 — the intake rebuild | this log, 2026-09-14 | M1, M2 | **Built 2026-09-14** (`0007`). Packs, runs, drawing attributes, preamble notes, export. No human acceptance; no real drawing set extracted |
| **M8 — the Panther pass** | this log, 2026-09-15 | M7 | **In progress from 2026-09-15.** The pilot pack in, transposed not inferred, and a BWS-layout export a human calls correct. THE milestone |
| M5 — shared-inbox ingestion | `docs/integration.md` | Entra app + scoped mailbox | **Built 2026-09-16, DISABLED.** The pipeline is verified by uploading a saved `.eml`, including one real model call. The Graph half has never talked to Graph |
| M6 — VE rounds, TG0 A/B/C sign-off | — | a settled gate model | Named only |

M3, M5 and M6 are named so they are not built speculatively. M1 is shipped;
M4 is pushed and awaiting human acceptance; M2's whole pipeline is built and
tested without a single model call. What remains is step D — deploy the schema
and consumer before enabling the producer, then one approved small document,
then a representative pilot schedule judged by hand. That still needs a named
Anthropic Console owner.

## 2026-09-20 — Stage 2 opens: area is a filter, and the email asks each question once

Stage 2 of `make-it-work-2026-09-19.md` opened the same day Stage 1 closed on
staging, at Max's instruction ("lets build stage 2"). Its stage brief is
appended to the plan. Two Opus coders in worktrees OUTSIDE iCloud, the same
discipline as Stage 1. Each item's §7.1 evidence, as facts:

| Item | Commit | Built · Tested | Verified in the app | Deployed |
|---|---|---|---|---|
| **2.4** area as a filter | `17b733c` | `area-filter.ts` leaf (fold = case + whitespace, label as first written, no-area last) + `AreaSelect`; 11 pure, 8 + 7 component tests; `?area=` via `useUrlTab` | DEMO-300 MAIN RUN: 36 options, choosing "Bedroom, Level 4 (18)" lists 18 of 300 and the TGQ tile stays 5,829; chase screen: 222 → 15 lines, Draft the email still 2771, footer "2558 ticked questions are hidden by your filters — they will still be asked"; screenshotted at 1920×1080 | `3f8511d` deployed on `spec-builder-app-rho.vercel.app`, read back from `/api/auth/me`; the pasted `?area=bedroom, level 4` link on the deployed 300-line phase renders "Bedroom, Level 4 (18)", `18 of 300 shown`, TGQ tile 5,829 |
| **2.5** the chase EMAIL by question × area; a colleague as recipient | `ee5e441` | `groupByQuestionAndArea` in `chase-template.ts`, `TEMPLATE_VERSION` 3, `data-record`/`data-requirement` per item row; `groupByContact` gives an internal contact every levelled question; 42 template tests (+11), 42 chase-drafts tests (+5), 4 picker tests; full suite 1,501 green with the database tier REQUIRED | DEMO-TEST-01, Priya Raman: a 69-question draft whose body holds exactly the 69 coverage pairs, 8 question tables, 28 area rows, "We need from you" once; a `QA Colleague` (internal) contact: 70 questions, intro "We still need … or say who to ask?", no "your"; the contact and its draft then removed; chase screen at 1440×900 shows the Colleague chip on the tab | `3f8511d` deployed, read back from `/api/auth/me` |
| **2.3** the infill screen | `98d4d30` (+ merge `45ff5bc`) | `measure:outstanding` (tool + `outstanding-measure.ts`); `GET /api/projects/[id]/infill` in three shapes over ONE `loadOutstanding` with a WHERE-clause scope; `InfillRow` with four row kinds, the dimension writer, the inline reason box, the 409 self-reload; `createAttribute` joins the actor's open change; 22 pure + 34 component + 6 db + 6 route tests; full suite 1,569 green with the database tier REQUIRED on the merged branch | Coder B's DoD on the sandbox production build: change "Handover call with Hayley, 2026-09-22" opened, four gaps on two items (a dimension composing `W845mm`, a palette) in 9 s, closed — ONE change set, one version per record (v12, v7), every answer `manual`, `spec_records.version` untouched. Fable's walk on the dev server: DEMO-TEST-01 infill renders three bands, one primary (*Chase what is left*), the uncategorised block with its picker, 29 lines; a line opens to its edit rows (Assembly guide as No/Yes/TBC); screenshotted at 1920×1080 and 1440×900. Measured: DEMO-300 first paint 1.84–1.87 s, settled 2.09–2.38 s, 19,582 questions / 18,976 KB if shipped whole | `f288ea9` deployed on `spec-builder-app-rho.vercel.app`, read back from `/api/auth/me`; the by-question tab on the deployed DEMO-TEST-01 renders "12 of 12 questions shown" |
| **2.7** outstanding by question | `ed2f543` | `groupByQuestion` keyed on field → local key → folded prompt → id (keying on `requirements.id` gave four "Dimensions" headings); the `by-question` tab; a "by question" link under the phase table's TGQ header; +7 pure, 8 component tests | DEMO-300: "Dimensions" opens 401 rows in 831 ms, one area click → 27 rows; DEMO-TEST-01 by-question tab at 1440×900: 12 questions, "TGQ on 10 of 17" chips, area select "All areas (221)" | `f288ea9` deployed, read back |
| **2.6** the dimension note | `f460dc9` + `fd0d7f3` (cherry-picked from Coder A's `604f02d`, `0bbb9d1`); migration `0034` applied to the sandbox 2026-09-20 after `db:backup` | `composeDimensionCell(rows, note)`, a record atom (schema 5), the `Qualifier` column on the check sheet, `PATCH /api/records/[id]` details with a 200-char no-newline rule, one input in `RecordDetails`; `planAnswerFills` composes the checklist answer WITH the note and `editRecordDetails` recomposes on change; `hasFigure` reads the figures without the note; a snapshot no longer drops a configuration's letter; 8 db + 20 pure + 2 component tests; full suite 1,611 green with the database tier REQUIRED at `9715b0f` | demo sofa DEMO-TEST-01-003: Edit → "1250 L-shaped return" → Save: Specs tab cell `W1830 x D880 x H760 x SH440mm (1250 L-shaped return)`, version 2 → 3 under ONE `manual_edit` change ("Edited dimension_note"), snapshot 11, the Dimensions answer reads the same cell, the MOCK-UP BWS export row carries it | `9715b0f` deployed on `spec-builder-app-rho.vercel.app`, read back from `/api/auth/me`; the demo sofa's Specs tab on the deployment reads `W1830 x D880 x H760 x SH440mm (1250 L-shaped return)` |
| race fix: a version numbered under the record's lock | `929a5b6` (from Coder B's `ad72acf`) | `snapshotRecords` locks its records `for update` in id order before reading `max(snapshot_no)`; the db test polls `pg_blocking_pids` until the second transaction is blocked, and fails with the reported duplicate-key error when the lock is removed | proved at the database, deterministically, rather than raced in a browser | `9715b0f` deployed, read back |
| **2.8 step 1** the project-wide fold | `9715b0f` (from Coder B's `0484bf6`) | `checklist-sections.ts` leaf + a pure test against the seed; the card sorts last, renders closed with its count, opens on a `#q-` anchor; 6 component tests. Step 2 NOT built | demo sofa → Checklist: six cards, "PROJECT-WIDE — THE SAME ANSWER APPLIES TO EVERY ITEM · 1 outstanding · 1 of 19 here · show" last and closed, at 1440×900 | `9715b0f` deployed, read back |
| **2.10.f** three reads at a time per pack | `fb03d07` (from Coder B's `ae498a4`) | `extraction-slots.ts` leaf (advisory lock, `takeReadSlot`/`deferRead`/`dispatchNextWaiting`), `MAX_IN_FLIGHT_READS_PER_PACK = 3` beside the other bounds with the ceil(N/3) × 300 s arithmetic; a deferred run is `attempt_deadline_at` with `attempt_id` null (no migration); hand-off at parsed, `fail()` and `recordExtractionFailure`; the pack screen and upload rows say *Waiting for a slot* in info blue; 10 db tests with publisher, model and blob stubbed, +2 timing, +4 pack tests; full suite 1,633 green with the database tier REQUIRED on the coder's branch | eleven documents → 3 queued, 8 marked, 3 publishes; all-fail packs hand on; two packs independent; a replay opens nothing. **Not driven against the real queue** — a charged read per document — so the first real pack is the test | `237e1ba` deployed on `spec-builder-app-rho.vercel.app`, read back from `/api/auth/me` (the cap's own screens cannot be shown without a deferred read, and a real registration is a charged call — the db tests are the evidence) |
| **2.10.g** the failure-surface sweep | `d1e56b3` (from `2750d3d`) | audit of every `catch` and fetch under `src/app/dashboard` and `src/components`: all 83 call sites already go through `apiFetch`; three fixes — `PreambleReview` and the pack page lost a refusal behind the reload they triggered (`reloadThen`), `PagePreview` rendered nothing on a failed thumbnail and lost the page link; `failure-surfaces.test.tsx` (6, verified to fail with the fixes reverted) | — | `237e1ba` deployed, read back |
| 2.10.f follow-up: *Read all* honours the cap | `73cf827` (from Coder B's `d715b4b`) | the extract route's `start` takes a slot or defers (202, `waiting`); `retry-dispatch`/`restart-expired` uncapped with reasons; advisory lock before row lock (a deadlock otherwise); a deferred `failed` run reset to `pending`; `ResolvedRun.waitingForSlot`; the review's *Read all* reports "3 reading · 8 waiting for a slot" and excludes promised reads; +7 db, 4 component tests; full suite 1,644 green with the database tier on the coder's branch | driven through the real route against the sandbox with the publisher stubbed (3 queued / 2 waiting, chips agreeing) — a browser press would publish real charged reads, so none was made | `73cf827` pushed to staging; deployment to be read back |

**Three decisions taken by Coder A that Max should overrule if wrong:**

- **No quantity on the email's item line.** The coverage snapshot has never
  carried one and is compared with `canonicalJson`; adding it would make every
  unsent draft stale. The line is `record · refs · description`.
- **No "Colleagues" group header in the contact strip** — `Tabs` has no
  grouping primitive; a colleague sorts last and carries a `Colleague` chip.
- **The category name is gone from the email**; it was in the old per-record
  heading and has no place in a per-question one.

**The first-session script walks Stage 2 (`023dbc4`, the verifier's
`bc48210`).** Eleven new assertions over 2.3, 2.4, 2.5, 2.6, 2.7 and 2.8 and a
new step 10 (the infill screen), never calling the model. Run against the
`bc1857a` deployment: **PASS 40 · FAIL 0 · SKIP 2** (the two clone-has-no-
preview skips), e.g. `2.5 — 492 coverage rows · 49 question tables · 167 area
rows · "from you"` and `2.6 — "W1234 x D790 x H720 x SH440mm (1250 L-shaped
return)" · in the checklist answer · in the csv`. Against the local dev server:
37 · 3 · 2, all three downstream of one finding (an infill save refused as
retryable, local only) logged in `found-in-use.md`. Found on the way and fixed
by Fable in one line: two literal NUL bytes in `chase-template.ts`.

**Two departures by Coder B that Max should know:** the shared table body
between the chase and infill screens was NOT extracted (eight columns against
seven, a selection model, a level `SuggestButton` — the grouping is shared, the
JSX is not); and `groupByQuestion` keys on the FIELD rather than
`requirements.id`, because "Dimensions" is seventeen requirement rows.

**Found by building 2.3, logged in `found-in-use.md`:** `snapshotRecords`
numbers a version with no lock, so two edits to two questions of one record
can both claim the same number and the second reaches the reviewer as a 500;
briefed to Coder B's round 2 as the first fix. And the DoD walk left `__QA`
answers and two `__QA` change sets on DEMO-TEST-01, which `qa:demo --clear
--apply` rebuilds if the litter matters before a call.

**Measured before briefing 2.3:** `loadOutstanding` on DEMO-300 returns
19,582 outstanding questions in 845–1,263 ms. The loader is not the weight
behind the 10.4-second overview; shipping that many rows to a browser is, and
the infill brief is built around it.

**Blocked, and saying so:** 2.1/2.2 (Max has no BWS account), 2.9 (proposal
for Matthew — drafted in the plan's Stage 2 brief), 2.11 (the rate cap, then
Max's own gate amendment), 2.12 (another session's). Human acceptance
outstanding on both items.

## 2026-09-20 — Stage 1a, the first six items land

Stage 1a of `make-it-work-2026-09-19.md` opened on 2026-09-19 (its stage brief
is appended to that file). Two Opus coders in worktrees, Fable reviewing each
diff against §2.3, running the four checks with the database tier REQUIRED,
cherry-picking onto `staging`, and driving the result in a browser before
pushing. Each item's §7.1 evidence, as facts:

| Item | Commit | Built · Tested | Verified in the app | Deployed |
|---|---|---|---|---|
| **1.1** run → phase, every screen and doc | `e8e2a47` + `d721102` (the sheet headings and the `src/lib` messages the guard cannot see) | lexical guard `tests/lib/vocabulary-guard.test.ts` parses the screen sources with the TypeScript parser; 1,285 → 1,309 green | every dashboard screen walked at 1920×1080: the only "run" left on screen is the client's own tab name `MAIN RUN` | `94e9e4b` on staging, chip STAGING, "Add a phase" on the deployed overview |
| **1.8** `TBC – <fabric>` is a state | `d853976` | 17 pure tests + 1 export test; a colon binds a LEADING marker only (found by `SUPPLIER: TO BID`) | the staged S-100 card reads `Yarn Collective Tessarae YC04158 - 01` with state TBC and "drawing said: TBC – …" beneath — no re-read, nothing charged | `94e9e4b` |
| **1.14** chase preselects the TGQ set | `1fcc506` | `chase-selection.ts`, 11 pure + 4 component tests | demo project, Priya Raman: Draft the email · 70, footer "70 to-quote questions preselected · 113 also outstanding"; the one to-quote question not ticked is awaiting a reply (observation in `found-in-use.md`) | `94e9e4b` |
| **1.2** the header-row sentence | `cbfd614` | `describeHeader`, 5 pure tests; items-start row read off the first parsed line, never header + 1 | the real Panther bill: "Header on row 6. Items start on row 7. 5 rows above the header were read as the phase's notes" | `84e9e17` on staging, the sentence read back from the deployed BOQ review |
| **1.3** the ordinal off the screen | `9cd7105` | 4 component tests; the gate board's `BWS id` column is a recorded mock-up deviation | the record that showed `1 · COM 1` shows the name only, id on the title | `84e9e17` on staging, read back from the deployed record |
| **1.4** each count says what it counts | `7d569c3` (+ `019ad47`, the last "run" strings in `src/lib`) | `chase-counts.ts`, 16 pure + 2 component tests; the plan's hypothesis was WRONG and the coder stopped to say so — the buckets are derived from the gate rows | sofa record: "Chase the 4" · "6 to answer at TGQ · 4 to chase · 2 you record on this item's details", rows labelled "on the details", panel buttons "Chase these" | `7d569c3` on staging, the sentence read back from the deployed record |
| **1.11** one function decides the next step | `e0254fb` (+ `00e0ccd`: the export cluster yields its emphasis while a step shows) | `next-step.ts`, 9 kinds; pure precedence tests + component tests for the three primaries | AP364e primary "Review 9 documents"; AP364c "Categorise 6 items"; projects list → project → primary → item → Checklist = 4 presses | `77895e4` on staging, read back |
| **1.12** the count opens onto what is missing | `77895e4` | 5 component tests; list from the SAME loop as the count | AP364c headboard: 5 → Access, Dimensions, Outdoor, Assy guide required, Headboard fitted?, each linking to `#q-<id>` | `77895e4` on staging, read back |
| **1.13** the correction verb | `51f7bb8`, migration `0033` applied to sandbox 2026-09-20 after `db:backup`; fixes `00e0ccd`, `694a162`, `be8539d` | 9 db-tier + 7 component tests, all green on the sandbox after two rounds: the disagreeing-finish fixture had invented a normalisation (and the branch now asks the library row's own code); a `#q-` deep link crashed on a null answer state (route coalesces, tone falls back) | demo sofa: Correct → Save the correction, `W1820` → `W1830`, v10 "1 changed · 1 added · 1 removed", "Spec corrected"; Specs tab prints no ordinal | `3b6d9db` on staging: `W1830…`, 11 Correct controls, no ordinal, the deep link renders, read back from the deployment |
| `/api/auth/me` names its commit | `94e9e4b` | — | `commit: 94e9e4b…` read back from staging | the one orchestrator one-liner, so a deployment can be confirmed for a SHA without the Vercel console |

**Two decisions taken by Fable that Max should overrule if wrong:**

- **1.8's TBC state is not painted amber on the drawings card.** The plan's DoD
  said "amber TBC beside it"; on that screen amber means *needs a person*, and
  a recorded TBC is decided. The state select reads TBC in the neutral tone.
- **1.4 will count CHASEABLE questions on the header button.** Coder A stopped
  1.4 with a finding: the plan's hypothesis (Spec notes causes the ±1) is
  wrong — `spec_notes` has no requirement row at all, readiness questions are
  in BOTH numbers today, and the real gap is fields vs questions (four
  dimension slots against one Dimensions question). Ruling: the two numbers
  stay two numbers, each labelled by what it counts; the header button gains
  `toChase` (to-quote spec-field questions, what the chase screen will tick
  since 1.14) beside the unchanged `toQuote`; the gate panel's own button loses
  its number. In progress.

**Stage 1b, opened the same day at Max's instruction ("keep going until you
have completed the whole of stage 1"), so far:**

| Item | Commit | Built · Tested | Verified in the app | Deployed |
|---|---|---|---|---|
| **1.10** the swatch reaches page 2 | `36dbed5` | 4 component + 4 pure tests; the crop payload carries the page cropped from | S-100 card: "Crop from: page 1 · page 2" | `b76cfb0` on staging, read back |
| **1.15** a level on the drawings card | `941573d` | 4 component + 2 db tests (one db fixture red on first run — `retired_by` missing — back with the coder) | S-100 card: LEVEL panel, "Simple · decided on 3 of 3 records", Change… as buttons | `b76cfb0` on staging, read back; the red fixture fixed in `f888e1e`, 1,412 green |
| 1.11 follow-up: the step only in *Review complete* | `9b626eb` | 1 component test | S-100 review while open: no "Review 9 documents" beside Confirm | `b76cfb0` on staging, read back |
| **1.5** packaging lines are suggested for ignoring | `1c2fe43` | `non-furniture-guess.ts` leaf (code prefix → description words → category as support only), `linesToIgnore`; pure tests + a db case for ignore/restore at confirm; the level guess skips a suggested line | AP364e's confirmed bill shows no suggestion (nothing left to ignore, correct); the fresh-bill DoD is the first-session script's 1.5 check, being turned on | `da863b7` on staging |
| **1.6** one summary line on the pack | `38e6f65` | `PackSummary`, `packTally`; component tests over eleven mixed runs | AP364e pack: "11 documents · 2 reviewed · 9 waiting for you", one primary on the screen | `da863b7` on staging, read back |
| **1.7** a document says how much is left | `26ea895` | two derivable states + a SQL count over the staged JSON's three named shapes; 8 component tests + 1 db test over all three shapes | AP364e pack: "Review complete" on the preamble and bill, "29 to review" … on each drawing; no tick beside pending proposals | `da863b7` on staging, read back; its db test reused another test's item code and was fixed (`da863b7`) |
| **1.9** step one: measure | `7b9ee6e` | 12 pure tests; `measure:drawings` gains the item-pictures block | sandbox: 100 items, **58 report a region, 42 none, 162 regions all in bounds, 0 faulty**. Conclusion: the crop is exonerated; the same file read twice gives opposite answers and two SPEC-346 sheets never report a region, so the fix is the PROMPT and it lands with the finishes-schedule re-read. No code changed; the whole-page proposal stands (`found-in-use.md`, finding 6) | `b76cfb0` |

**Stage 1a CLOSED on staging, 2026-09-20.** The first-session script
(`.claude/skills/verify/files/first-session.mjs`, the verifier's `7af4e56` +
`4bbcbae`) ran against the `b76cfb0` deployment: **PASS 20 · FAIL 0 · SKIP 8**,
the skips being 1.13 (written, to turn on), 1.15 (on staging, skip stale), the
1b items, the two clone-has-no-preview checks and the 409 row-unfreeze half.
The `__QA` project it made was swept from its own manifest. Remaining and
Max's: apply 0033 to pilot, promote by the checklist, run the script on pilot,
send the 0.6 message. The close's per-row evidence is in the plan's stage
brief.

**The gate with every check on, 2026-09-20 14:35.** The verifier's `2be632b`
turned the skips for 1.5, 1.6, 1.7, 1.13, 1.15 and the 409 row-unfreeze into
live checks; one of them read the wrong page (`c46fe95`, the walk returns to
the phase tab first). Run against the `da863b7` deployment: **PASS 29 · FAIL 0
· SKIP 2** — the two skips are the item picture and the swatch, which a clone
cannot render because the PDF stays under the source project's blob prefix.
Stage 1b's release gate is therefore the script, not only the browser walks.

**Promoted to pilot, 2026-09-20 13:15, at Max's instruction ("apply to
pilot").** Steps 1–3 of `docs/environments.md`'s checklist, done by Fable:
pilot backed up (`spec-builder-pilot-2026-09-20T13-11-40-147Z.sql`, outside
the repo), `0033_attribute_correct.sql` applied to the pilot host
(`ep-long-recipe…`, "Applied 1 migration(s); 32 already present"; the ledger
reads 33), and `pilot` fast-forwarded `ded4dcf` → `da863b7`, the SHA verified
on the staging deployment. Steps 4–8 — a deployment for that SHA, Ready,
`/api/auth/me` reporting `pilot`/`pilot` and `commit: da863b7…`, the PILOT
chip, the first-session script on pilot — are Max's, at his request not
probed from here. The pilot database holds seeds and two logins, no projects.

**Still outstanding in 1a (Max's):** the first-session script and the 300-line fixture (the verifier, in
progress), the pilot's console half (Max), the hand-over message (Max). Human
acceptance outstanding on every item.

## 2026-09-18 — the catchup, and the first time anybody else watched it run

Max demonstrated the whole app end to end to Matthew, Sebastian, Steve and Tony
over 2h18m. **Everything said, with timestamps, and the plan that follows from
it, is in `docs/plans/catchup-2026-09-18.md`.** Read that rather than this
summary before acting on any of it.

Five decisions were taken in the room:

- **"Run" becomes "phase"**, because that is the BWS word (Matthew, 12:23).
- **Versioning is two-part** — internal minor, client-facing major. V1.1, 1.2,
  1.3 internally; issuing to the client makes it V2, then 2.1, 2.2; reissue
  makes it V3. Sebastian proposed it, Tony endorsed it as the software
  convention, Matthew agreed (1:17:19–1:20:28). **Three details were left
  unsettled** and are in the catchup document: whether the client-facing number
  belongs to the project or the record, whether a client *sign-off* bumps the
  major as well as *issuing*, and whether the first issue is V0 or V1.
- **Chasing at tender covers the TGQ set only** — *"we wouldn't have time to
  nail it down that far before we got the quote out"* (Matthew, 1:20:55).
- **Matthew runs a real intake himself**, on one of the new projects, not the
  300-line one first. Max sends a login; Matthew sends back screenshots plus a
  written explanation (1:34:22, 2:15:37).
- **Stop adding features; make what exists work.** Max proposed it and Matthew
  accepted it outright — *"don't feel like you need to get it all polished…
  some of what I briefed you to do is probably not quite on the money"*
  (1:41:25–1:43:15).

The last one governs the order of everything else. **The feature list from this
meeting is long and Matthew explicitly does not want it built yet.**

Four things changed what is written down here, and they are argued out in the
catchup document rather than repeated:

- **The five BWS-owned palettes are now obtainable.** Matthew navigated to
  `bws.whistlercloud.com/standard_specification_fields/<id>/edit` and showed the
  **Palette options** box, per field where `Field type` is `palette` — timber
  finish, stud spec and the rest, with their BWE codes. There is no export
  (*"I don't know how to get all of the options out on a download"*), so this is
  a **scrape**, the way the BWS boilerplates were taken. **The trap he drew
  himself**: a field's *Values* page is what people have typed (`self-piped`,
  thirteen times), not the palette — and somebody on the call had already been
  caught by it, having previously looked at the stud field and concluded the
  label was wrong. Seeding from Values would fill a controlled vocabulary with
  other people's free text. Blocked on Max having a real BWS account, which
  blocked him live in the meeting.
- **Tim is building a new BWS spec importer** — *"specs plus free text and a
  couple of other bits"*, CSV as the interchange, images referenced by public
  URL. The complete-dataset rule exists because the current importer replaces;
  whether the new one does is unknown. **The export must not move until Tim's
  column contract is in writing**, and item pictures on a public URL is a
  decision about NDA-covered material, not a configuration change.
- **Levels must never constrain which specification fields are offered.**
  Matthew: *"if it's not right, if it means you're not gonna get offered the
  specification field, then maybe that's not particularly useful to have."*
  Sebastian's shape — show everything, demote and grey what the level says is
  unlikely — was adopted. `spec_records.level` stays: it picks the BWS
  boilerplate and it is still a person's decision.
- **Substrate is a new concept nothing models.** A client says "oak" without a
  colour; BWS free-texts `oak substrate` so the item can be priced and
  progressed before the finish is agreed. Matthew: *"it'd be good to be able to
  have that as an option for finishes."* Three questions have to be answered
  before it can be designed, and they are in the catchup document.

- **The app serves at least two roles, not one.** Matthew described the
  **project manager** loading the pack and reviewing it, then taking the summary
  of what is outstanding **to the CAM**, and only then going to the client. A
  chase need not be external either — *"you can send it to the CAM or to sales
  or to production; it doesn't have to be an external e-mail."* `CLAUDE.md` says
  the primary user is the KAM / sales-support role, and that is now half the
  picture.

Two endorsements worth recording, because they settle arguments this repo has
had with itself:

- **Structured dimensions are right** — *"I think it's much more powerful having
  it as numbers. Absolutely."* BWS itself fell back to free text only because of
  L-shaped and off-centre-U sofas, and what Matthew wants beside the five slots
  is a **qualifier a person types** (`1250 (L-shaped return)`), not the slots
  removed.
- **The project finishes library is exactly what he asked for**, and he named
  the document that should fill it: a Finishes Schedule table, `WD01` = oak,
  stain brown, open grain. Loading it costs a tool-schema change and therefore a
  re-read of every document already read — a decision with a number attached.

And one explanation for something that has been stuck: **the TGQ tick-box
workbook is not how Matthew thinks.** Unprompted, at 2:16:13 — *"I found it
quite hard to go through it and do like a tick box thing. I ended up basically
typing sentences."* That is why it has never come back, and the next attempt
should be a conversation transcribed into the matrix, not another workbook.

## 2026-09-18 — the costing sheet, and a blocker that was never real

Matthew sent the `skill.md` and its user guide (after an email saying he had
"moved them to the Project spec builder project — in the outputs area", which
matched nothing in SharePoint, OneDrive or this repo — Max supplied them
directly). Max also supplied a REAL COMPLETED costing sheet: Maybourne Paris
seating, 69 items.

**The recorded blocker was wrong.** `matrix-assumptions.md` said the costing
sheet was blocked on the skill.md because "the app holds no price of any kind".
The skill generates no price either — it adds page links, crops photos,
converts imperial to metric and deletes blank rows. Both entries are corrected
there.

**What the completed sheet showed, which the blank template could not.**
83 columns: A-J identify the item, K rightwards is three identical estimator
blocks and a stone block. Only 26 of 69 rows were priced and only the first of
the three blocks was used. Two link columns, not one — `Specs` (65/69) and
`Specs 2` (36/69) — so the skill's single `SP_URL` could not populate it.

And `Tags` was holding measurements pasted by hand: `Height: 91 cm\n- Width :
110 cm\n- Seat depth: 102cm`, `H800mm x D635mm x W700mm SH480mm.`, `H 93 - L 47
- P 56 cm - seat H-53cm which reduces by 3/4cm when seated`, `58 x 36 x 43cm`.
Mixed units with nothing saying which a row is, French `L`/`P`, a qualifier
welded to a figure, a bare triple whose order is an assumption. Every trap the
dimension model exists for, in one column, because the sheet had nowhere
structured to put a size.

**Built:** `/api/projects/[id]/export/costing`, columns A-J, xlsx with
hyperlinks and embedded pictures or csv, sharing `loadExportScope`. `Tags`
carries the composed dimension cell from the single composer. The reasoning is
in `CLAUDE.md`.

**Verified** against the sandbox, not fixtures (AP364c MAIN RUN: 19 rows, 11
with dimensions off the real shop drawings, 11 links, 11 pictures, a
configuration with a blank quantity) and by 22 pure-tier tests. `Specs 2` has
unit coverage only — no record in the sandbox is yet specified across two
pages. Nobody has pasted one into the real template.

**Still open for Matthew:** what `Specs 2` points at, and whether `Tags` should
go on receiving pasted prose now that the app composes a real cell there.

## Observations 2026-09-17 — the first run-through

Max drove the app end to end and reported six things. All six are built; none
has been accepted by him yet.

1. **A fabric staged as "Other" with no BWS field.** The real S-100 caption
   puts the PART in the label (`SOFA`) and the CLOTH in the value, and the
   word lists held neither. The group and the field are now ONE reading
   (`classifyCallout`), the lists carry a swatch caption's vocabulary, the
   client's own finish code is read as evidence, and a caption naming the item
   itself is taken as its upholstery — flagged yellow, because that step is an
   inference. It is applied at READ time, so the packs already read in the
   sandbox gained it with no second model call and nothing charged again.
2. **A finished review now says so**, on both drawings screens, and offers the
   way back to the project from the bottom of the page.
3. **The projects list is a table** — search, a status pill, no duplicate
   Overview button, Spec table and Chase kept.
4. **COMPLETED is derived, and there is no button.** Every question on every
   record in the export's scope confirmed or N/A, an uncategorised record or a
   single TBC keeping it ACTIVE. Never stored, for the reason Overdue is not.
5. **The project page reads as cards**, with versions, baselines and the change
   trail on the page rather than behind a tab.
6. **A level is guessed at intake** (`0025`), per bill line, flagged, inherited
   by a line's configurations, and accepted a run at a time under one change
   set. `spec_records.level` still means a person's decision: the guess lives
   in `level_suggested`, where no gate can read it.

**Still open.** The level rules are this repo's judgement — nothing in the 17
cheat sheets defines simple / complex / hero, and the only written basis is the
BWS boilerplate split. They go in front of Matthew with the TGQ workbook. And
no real bill has been parsed with a Level column yet: the path is covered by a
route test, and every staged BOQ in the sandbox predates the feature.

## Observations 2026-09-16

1. **The export gets a check sheet, and the export route gets a shared scope
   loader.** M8 step 4 says the export must be judged flawless line by line
   against the pack; that sentence had no artefact. See
   `export-verification.md` for the procedure, the verdict vocabulary and the
   known limits. The reason the two routes share `loadExportScope` is that a
   record the check sheet never asked about must not be a record the export
   shipped — otherwise a signed-off sheet proves nothing.
2. **KNOWN GAP (observed 2026-09-16): `entity_type` is written two ways.** The
   sandbox's polymorphic tables — `attachments`, `status_history`, `messages` —
   hold both `spec_record` and `spec_records`, and both `intake_run` and
   `intake_runs`. Anything that filters on one spelling silently misses rows
   written under the other. Nothing was changed for it: the writing values are
   spread across several call sites and a rename without a migration would
   strand the existing rows. Not yet triaged.

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

## 2026-09-17 — the gate model, from Matthew's decision matrix

Matthew sent `BWS_Spec_Decision_Matrix_for_Max.xlsx` and a quote-output example
with an email naming five asks and a nudge to use the app on live projects.
The matrix is the first written gate model this project has had: **Still open 1
has been open since 2026-09-12** and `requirements.required_at_gate` was null on
all 728 rows with no writer anywhere in the repo.

Max answered the blocking questions on Matthew's behalf so the work could start.
**Every one of those answers is a stand-in** —
`docs/plans/matrix-assumptions.md` lists each, what it changed, and how to
reverse it. Read it before treating any of this as settled.

96. **A gate belongs to a FIELD, not to a question, and the same field sits at
    two gates.** Assembly guide (191) is TGQ *and* TG1; Dimensions (3) is TGQ
    (four slots) *and* TG1 (the whole cell re-checked). `required_at_gate` is
    one text column and cannot hold two — which is 0019's argument for
    `tgq_levels text[]` arriving from the other end. So the gate is a seeded
    overlay (`0026`) keyed on `spec_fields.json_id`, `required_at_gate` stays
    null and is never written, and it goes in a destructive migration.
97. **Keying on the field is what unblocked it.** Every BWS id in his matrix
    matches `db/seed/0001_spec_fields.sql` exactly, so the field half needed no
    translation at all. His nine CATEGORIES do not match our seventeen cheat
    sheets, and keying on the field let the model be seeded, read and rendered
    while that mapping was still a judgement call.
98. **The category mapping widens exactly two rows, and both are asserted.**
    Our `armchairs-benches-stools-sofas` is one sheet receiving his S, A and B,
    so **swivel** is now asked of benches and sofas; our `sofas-bed-daybeds`
    receives his S and D, so **seat height** is now asked of daybeds. Union is
    right on the repo's own rule — a field nobody can select is a spec value
    nobody can record — and it is still a decision, so
    `tests/db/spec-field-gates.test.ts` fails if the mapping changes.
99. **An unmapped category gets `null`, never an empty gate.** The eight
    cabinetry sheets are not in his matrix. An empty field list computes as
    "nothing outstanding", and a cabinetry record reported TG0-ready because
    nobody has written its rules is the confidently-wrong failure the model
    exists to prevent.
100. **Five outcomes, because three would lie.** `unknown` is a conditional
    whose controller is unanswered; `unanswerable` is a field the matrix wants
    and the checklist cannot ask. Both count against the gate and neither is
    the reviewer's fault, so neither is printed red.
101. **Sixty new checklist questions** (`db/seed/0007`), 728 → 788. Six BWS
    fields his matrix gates were asked by no question anywhere — Assembly guide,
    Timber Finish 2 and 3, Metal Finish 2, Back Cushion Build, Purchasing
    Notes. Three of those were already flagged as a gap in
    `questions-for-matthew.md` Q2; his matrix answers it. Reused prompts are
    byte-identical, so 788 rows are still only 68 distinct questions.
102. **`tgq_levels` was deliberately NOT re-tiered.** Read literally his TGQ
    set would strike ~48 of the 62 distinct questions out of the to-quote tier.
    That is what the workbook sent on 2026-09-16 was built to ask, and it has
    not come back. Untouched until Matthew says the matrix answers it.
103. **write_audit() needs an `id` column on every audited table**, which was
    invisible until a table chose a natural key. 0026 gave
    `spec_matrix_categories` a `code` primary key and the first insert failed
    `42703: record "new" has no field "id"`. Fixed additively in `0027` rather
    than by editing an applied migration, and by giving the tables an `id`
    rather than by rewriting a function attached to eighteen others.

### Verified 2026-09-17, in the browser against the sandbox Panther data

- 35 gate rows seeded, split TGQ 14 / TG0 17 / TG1 4.
- A real S-201 configuration reports TGQ 6 outstanding, TG0 12, TG1 3. Its W,
  D, H and SH read Settled off the shop drawings; its timber finish reads
  Settled as "Natural oak"; Product code and Spec notes read "Nowhere to record
  it".
- Configurations A and B of the same bill line report different TG0 numbers
  (12 and 13), because B carries a fabric A does not.
- Uncategorised records print "—" in the TG0 and TG1 columns, and a cabinetry
  record returns null rather than a satisfied gate.
- No console errors.

### Still open, added 2026-09-17

- **Nobody has confirmed any of it with Matthew.** Seven stand-in answers, in
  `docs/plans/matrix-assumptions.md`. The two that cost most if wrong are the
  category mapping and whether his TGQ set re-tiers the quote questions.
- **The cabinetry matrix does not exist**, so eight of the seventeen cheat
  sheets have no gate view. His workbook says it is "in progress".
- **Five palettes he names are BWS-owned and this app holds none of them** —
  timber finish, metal finish, seat build, back cushion, stud. Recorded by key,
  rendered as free text with the gap stated in words.
- **TG2 is still unmodelled.** His matrix stops at TG1.
- **A default does not satisfy a gate**, which is this repo's position and not
  his stated one. See assumption 5.
- **Ten of his 35 rows have no BWS field and eight of them have no home in this
  app**, so they report `unanswerable`. The free-text field and the product-code
  derivation are the next two stages.

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

---

## 2026-09-16 — versioning, change history and the finishes library

Migrations `0012`–`0018`. The reasoning lives in CLAUDE.md's load-bearing
sections; these are the decisions that could reasonably have gone the other
way, and why they did not.

56. **A change set is linked by a GUC, not by a transaction id.**
    `pg_current_xact_id()` is available and stable inside `withTransaction`,
    and it is still wrong: xid8 values do not survive `db:restore` into a fresh
    Neon project, so the join would silently start matching the wrong rows
    after a recovery. `write_audit()` already read one GUC; it now reads two.
57. **`PATCH /api/answers/[id]` moved onto `withTransaction`.** Its single
    version-predicated UPDATE was correct on the HTTP driver, and
    `db-transaction.ts` named it as the example of something that did not need
    a second driver. That stopped being true when every write joined a change
    set: one autocommitted statement cannot carry the GUC, and a person's edit
    would have been the only change with no version and no why. Both texts
    were updated rather than left contradicting the code.
58. **Snapshots, not a replay of `audit_log`.** A record's state spans four
    tables and `row_id` is text with no `record_id`, so replaying means
    inferring an order across tables the log does not record. A reconstructed
    history that is subtly wrong is worse than one that starts today — which
    is what `db/backfill-snapshots.ts` writes, under a change called
    `history_begins` whose reason says exactly that.
59. **A diff runs over atoms; the stored cells are never diffed.** The cells
    answer "what did the file say that day". `composeRowCells` changes — open
    item 18 is a live example — so a diff across two rule sets would report
    edits on records nobody touched.
60. **A baseline materialises its members.** `created_at` is transaction START
    time, so two overlapping guarded transactions can commit in the opposite
    order to their timestamps. "Newest version as at that date" would put a
    version on the wrong side of a line somebody had signed off.
61. **A reason is required only when an edit overrides a settled answer.**
    `save()` fires on every blur; a box beside every field asks twenty times
    for twenty answers and collects twenty rows reading "update". A reviewer
    opens ONE change with the email attached, and every edit joins it.
62. **Append-only means refuse the rewrite, allow the cascade.** Three
    migrations in a row (`0013`, `0014`, `0015`) corrected the same misreading.
    The third would have bitten a real database: a document that had caused a
    change could never be deleted, because the FK's own `ON DELETE SET NULL`
    was refused as a rewrite.
63. **No trigger refuses a write made outside a change set.** It was planned
    for `0013` and dropped: every db-tier fixture and every `psql` fix writes
    rows directly, and refusing them turns a safety net into a wall across the
    maintenance path. The whole-database coverage assertion in
    `tests/db/change-history.test.ts` is the guarantee instead, and it has
    already caught two real gaps.
64. **Retiring a spec recomposes the checklist.** Leaving the answer behind
    means the export goes on shipping a value the record holds no statement
    for — a confirmed answer is exported whether or not an attribute backs it.
65. **The replace acknowledgement is per (observation, record).** A card fans
    out one record per run; keyed on the observation alone, a confirm could
    retire a value the reviewer never saw on another run's record.
66. **A revised BOQ's pairing is staged, never re-matched at confirm.** Same
    rule as every other confirm, applied to the one kind of matching that had
    not existed before. One-to-one only: `SX11A` pairs nothing.
67. **A record retired by a revision is named, not counted.** "Carries 14
    specs and a picture" is what tells a reviewer that pairing it was probably
    what they meant.
68. **`project_materials` is built, as `project_finishes`.** The condition
    `docs/stack.md` set for it was "until extraction is producing them", and it
    has been since M2. The pilot's finishes schedule being confirmed absent
    (open item 5) makes edit-once the only correction mechanism available.
69. **The library is the truth and the attribute is the evidence.** The
    attribute keeps the drawing's exact words; the cell renders the library,
    through `composeFinishCell`, which the export, the record screen and
    `planAnswerFills` all call. Two of them rendering differently is how a
    screen starts promising what the file does not deliver.
70. **A finish's state is the weaker of the two.** The Panther fabric's drawing
    says `TBC – Yarn Collective Tessarae`: the library knowing what the code is
    does not make that item's fabric decided.
71. **A conflicting code links nothing.** Where the library has committed and a
    new drawing disagrees, the attribute stays unlinked and is named on the
    finishes page. Linking would render the library's words on an item whose
    page said otherwise.
72. **`supplier_raw` does not satisfy the Capsule-ID invariant, and says so.**
    No supplier register exists in this app and no Capsule data is in this
    repo. Recorded as unmet rather than quietly considered done.
73. **Swatches arrive by hand, and must name their source.** Asking the model
    for swatch regions is a tool-schema change, which re-reads and re-pays for
    every document already read.

---

## 2026-09-16 — the to-quote tier, email intake, and Capsule contacts

78. **A level is REQUIRED before any question is tiered.** `questionTier` does
    not accept a null level and `questionTierOrNull` returns null rather than
    choosing a reading: "needed at any level" makes a level-less record look
    urgent, "needed at none" makes it look quotable, and both are the app
    answering a question only a person can. Confirmed with Max. The cost is 59
    level decisions on Panther, which is why the drafts screen blocks such a
    record with an inline level picker rather than sending somebody to 59
    record screens.
79. **`requirements.tgq_levels text[]`, not `required_at_gate`.** Matthew
    answers per question AND per level, so "needed for a hero sofa, not a
    simple one" is the normal case and a single-valued column cannot hold it.
    `required_at_gate` stays null and reserved for TG0/TG1/TG2. The seed writes
    all three levels on all 728 rows — today's position — so applying the
    workbook only ever REMOVES entries, and it is a re-seed with no code change.
80. **The tier is a column on `email_draft_items`, never part of
    `context_snapshot`.** The snapshot decides whether a sent draft still
    describes reality, and a tier is a reading of the gate model: applying the
    workbook re-tiers hundreds of questions at once, which inside the snapshot
    would 409 every unsent draft and empty Waiting for a reason unrelated to any
    answer. That is decision 15's `chased_at` trap in a new place. A question
    changing halves is an amber advisory on the card instead.
81. **The server reads the tier off the live row; a request carrying one is a
    400.** The tier decides what the email CLAIMS is blocking a quote. The
    client chooses which questions to ask, never which half they land in —
    conventions §9, a gate is enforced on the server.
82. **`tracking_eligible` is retired from the Waiting predicate.** Nothing ever
    wrote it false, and the case it described — recording a send whose coverage
    was already stale — is refused outright by the gate. The column goes in a
    destructive migration once the screen has been accepted.
83. **An email is a `document_kind`, not a second pipeline.** Same staged
    proposals, same review screen, same confirm route, so the review gate, the
    blockers, the per-proposal versions and the change set are inherited rather
    than rebuilt. 0007's rule holds: under `source_kind = 'spec_document'`,
    never beside it.
84. **`email_messages` is a new table and 0001's `messages` stays unused.** Its
    `entity_id` is NOT NULL and an email that has just arrived belongs to
    nothing — which project it concerns is the first thing to work out and
    sometimes cannot be. It also has no routing state, no fetch state and no
    pointer to the stored MIME.
85. **Assignment is the spend point.** An unassigned email is never read: there
    are no registers to resolve it against. `assignMessage` is the only thing
    that puts a message on a project, because it is also what dispatches the
    charged read, and two places doing that is two places to forget one half.
86. **Routing never breaks its own tie.** The first signal naming any project
    decides; two at that strength is held for a person, and a weaker signal is
    never allowed to arbitrate. A confident wrong answer writes one client's
    fabric onto another's sofa, and the review screen that would catch it is
    the review screen for the wrong project.
87. **Confirmed is not a hard closure, and no new mechanism was needed.**
    `proposalBlockers` already refuses to overwrite a settled answer without an
    acknowledgement tied to the version shown, whatever the new state is — so
    confirmed → a different value and confirmed → TBC both go through it.
    `changeIntent: "withdraws_to_tbc"` exists only because the value being
    withdrawn carries no TBC token, so the wording alone could not produce one.
88. **An `'email'` answer is out of reach of `promote-answers`, like
    `'manual'`.** A person confirming a value off a message, with the message
    attached as evidence, is a decision — not a document's reading that a later
    drawing may recompose.
89. **Capsule is read-only by construction.** One HTTP helper, hard-coded GET,
    no write verb, and a test asserting the module's export surface so adding
    one fails a test rather than a code review. "We only ever call GET" is a
    habit; an absent function is a fact.
90. **A contact with no Capsule party is flagged, not refused.** A designer
    whose practice Capsule has never heard of still has to be chaseable today,
    and refusing to record them only moves the record into somebody's head.
    Equally, Capsule is not a runtime dependency of chasing: name, email and
    organisation stay cached, so an outage stops LINKING and never stops
    sending.
91. **A refresh never clears an email Capsule no longer lists.** It reports it.
    Somebody may have corrected the address here on purpose after a bounce, and
    silently blanking the only way to reach a designer is the worst outcome
    available.
92. **The Graph webhook is the one public route, and believes only an id.**
    `clientState` compared in constant time against a stored HASH, a
    subscription id that must match a row we created, one bad entry failing the
    whole batch, and then the message fetched BY its id rather than described
    by the payload. The middleware exclusion names that exact path, not a
    prefix.
93. **A webhook is the speed; the delta poll is the guarantee.** Graph drops
    notifications, subscriptions expire in under three days, and both fail
    silently — mail simply stops arriving. The quarter-hourly delta asks what
    actually changed since the last token. Not redundant, and the cheap half.
94. **Graph ingestion is built and has never talked to Graph, and the docs say
    so.** Its own guards are tested; the subscription lifecycle, the delta
    semantics and the message shape are not. Reporting it as "built" without
    that sentence would be the dishonest version.

### Still open, added 2026-09-16

- **Nothing deletes ingested email.** MIME is written under `mailbox/` and
  copied under a project prefix on assignment, and NDA-covered correspondence
  accumulating indefinitely is a decision nobody has taken. Same gap as
  uploads, now with a second source.
- **Workbook N/A answers need a requirement-retire mechanism that does not
  exist.** The seed never deletes and `spec_answers` references requirements
  with `on delete restrict`, so "this question does not apply to this category"
  has nowhere to go yet. Decide when the workbook returns.
- **An item's level is set by hand, one record at a time.** The drafts screen
  offers an inline picker on each blocked record; there is no bulk action on a
  run. If 59 records proves tedious in practice, that is the fix.
- **No `.eml` has been opened in real Outlook**, and that is unchanged by the
  tier work — the red banner is a one-cell table precisely because Word's
  renderer drops borders on a paragraph, and nobody has watched it render.

## 2026-09-17 — the intake review: one card per code, and a tier that can see it

Max walked the drawings review on the sandbox Panther pack and reported three
things: some cards still arriving in the old shape, configurations presented as
separate cards, and — the one that matters most — "we keep coming back to this".

95. **A figure is a measurement whether or not it has a unit.** Four separate
    places each decided "is this a measured row" for themselves and all four
    demanded a unit: the view guess, the de-duplicator, the card's fold and the
    bulk-unit PATCH. `suggestUnit` abstains on a page whose figures disagree
    about magnitude, which a shop drawing always does — S-201 prints 5, 27 and
    42 beside 640 and 680, because most figures on a shop drawing are
    COMPONENTS — so on a project with NO `default_dimension_unit`, the normal
    state of a new project, every figure staged unitless and `unit: null` was
    self-sealing: nothing guessed, nothing de-duplicated, nothing folded, and
    not one control on the card could supply the unit that would have unlocked
    all of it. `isMeasuredRow` is now the single definition and asks only
    whether the value is a figure.
96. **The unit is the NEXT question, and the overall figures answer it.** The
    resolution order in CLAUDE.md always said "the OVERALL figures agreeing,
    once `applyViewGuesses` knows which they are", and that step could only ever
    REPLACE a weak unit, never supply one — so it could not reach the rows that
    needed it. It supplies one now. Where the placed figures do not share a
    scale the slots are still placed and the unit stays blank and amber, which
    is the honest answer and the existing treatment.
97. **Two views agreeing that a figure is REAL is not evidence that it is
    OVERALL.** S-201's plan and side elevation share exactly one figure, a 42mm
    reveal, so "a depth appears on the side, the section and the plan" returned
    42 as the depth of a 680mm chair — and because 42 and 680 cannot be in one
    unit, the placed set then failed `suggestUnit`, every row came back unitless
    and the card carried four `unit_missing` blockers and could not commit at
    all. A confirmed candidate must now share a scale with the height
    (`sharesAScale`, one boundary, one rule, the same test `suggestUnit`
    applies to the page). It says nothing about whether a number is about right
    for an armchair, which is the reasoning that turns an 8-metre sofa into a
    plausible one.
98. **One card per CODE.** A code drawn on several pages is one item in several
    configurations. One chip per configuration coloured by LETTER (A is always
    sky, so a chip finds its own section), the geometry once, each
    configuration's finishes below it in its own band, one Confirm.
99. **What is shared on screen is still written per page.** An edit to the
    shared geometry reaches the MATCHING row on every configuration's page, each
    with its own version, in one batched save. That is the data model:
    `record_attributes` holds what a PAGE said, so B's width comes from page 6
    and carries page 6 as its source. Writing A's row to B would fabricate a
    source page or lie about one — and copying rows at confirm time instead
    would make B's atomicity depend on A's state.
100. **One Confirm, N atomic confirms.** The confirm route is untouched: one
     request still names ONE staged item and its whole pending set. A refusal on
     B leaves A applied, which is the correct state, and the banner names what
     was written, what was refused and what was not attempted. The button is
     enabled only when EVERY configuration can commit — one that skipped a
     blocked configuration would read as done.
101. **Pages that disagree about the size are never averaged.** Compared on SLOT
     signatures, not on every measured row: two pages of one chair routinely
     differ by a radius, and failing the card over a 5mm reveal would put four
     tables back on screen. A difference is an amber notice naming each letter's
     figure; each configuration keeps its own; it is not a blocker, because it is
     either a configuration split or a misread and both are a person's call.
102. **A corrected figure keeps the slot it was corrected in.** The view guess
     is recomputed on every read while its slots are still suggested, which is
     what makes a guess improvable rather than sticky — but the guess reads the
     FIGURES, so correcting one changes its own input. Correcting S-201's width
     from 640 to 660 handed 640 straight back on the next read, because 640 was
     still printed on the back elevation. The correction survived in the row and
     vanished from the slot, which is the worst shape a correction can take: it
     looks applied and is not. A value landing on a row that already carries a
     slot now clears `slotSuggested`.
103. **A component tier, because the screen was the part nothing could see.**
     The pure tier covers the functions the card calls and the route tier covers
     what the confirm writes; between them sat 952 lines of rendering with no
     coverage of any kind, and every defect above lived in that gap. jsdom and
     React Testing Library, scoped by PATH rather than a per-file docblock. The
     first eleven tests found a twelfth defect nobody had reported: with nothing
     placed, every measured row is an "other dimension" and the fold hid the
     entire page.
104. **`tools/dump-drawing-run.ts`, read only.** "Verified against the real
     pack" was prose in CLAUDE.md — S-200 `W840 x D790 x H720 x SH460mm` and so
     on, written down by hand after somebody read eleven cards. A sentence
     cannot be re-run and goes stale exactly when it is worth something. The
     tool calls `assertStagedDrawings` and prints what it returns, reimplementing
     nothing. Run before and after: the diff is the change.
105. **`groupItemsByCode` is the one grouping.** `configurationGroup` compared
     `itemCodeRaw` RAW while `variantLettersByItem` folded it with
     `normaliseRef`, so `S-201` and `s 201` were lettered A and B and then
     printed under two separate headings. Grouping never crosses runs: letters
     are per staged run, so a code drawn once in each of two files is letter A
     in both and writes to the same variant.

### Verified 2026-09-17

Against the sandbox Panther pack and a `__QA` copy of it, in the browser:

- Eleven pages render as six cards; S-301's four pages are one card with four
  colour-banded configurations, S-201's and S-200's two each.
- All eleven pages now place four slots in a known unit. The run that was
  already reading correctly is unchanged figure for figure — S-200
  `W840 x D790 x H720 x SH460mm`, S-301 `W550 x D565 x H735 x SH430mm`.
- One shared width edit wrote 660 to both S-201 pages, the composed cell went to
  the verified `W660 x D685 x H680 x SH445mm`, the corrected row lost its yellow
  and the other three kept theirs.
- Confirming that card created configurations A and B on all three runs, 40
  specs each; the three bill lines dropped out of `loadExportScope` and the six
  variants appeared in it.
- A configuration with no matching record disables the Confirm and names itself
  and its reason in the footer.

### Still open, added 2026-09-17

- **Nobody has filled in an intake review sheet.**
  `docs/plans/intake-review-verification.md` exists and its twelve checks are a
  guess at what makes the reading possible. The first real pass tests the sheet
  as much as the screen.
- **A configuration card's per-page confirm is not offered.** One Confirm rules
  on the whole item, so a blocked configuration holds up a ready one. Deliberate
  — a confirm-all that skipped the blocked one would read as done — but if it
  becomes a nuisance in use, a Confirm inside each section is a small addition.
- **`ensureVariant` hard-codes `split_reason = 'fabric'`.** A `disagree` result
  from `compareGeometry` is exactly a configuration split. Deriving the reason
  from the same pure function both sides call is the principled extension; not
  needed for one box.
- **A code drawn once in each of two files of a pack gets no letter**, because
  letters are per staged run and the confirm derives them the same way. The
  pack's `duplicateTargets` banner reports the pair. Whether those should be
  configurations is a real question nobody has answered.
- **The S-201 width is still read as 640 from the plan on one extraction and 660
  on another.** Both are model reads of the same PDF. The card badges it and
  shows the page, which is the safeguard; it is not a code defect and it is why
  the yellow exists.

## The chase screen is grouped by furniture line — 2026-09-17

Max opened the chase screen with real data on it — demo correspondence and a
contact loaded by another pass — and stopped at the header: **1,921 needed to
quote, 823 of them selectable, in one flat list under one contact's name.**
"This is completely ridiculous. We can't be showing all of these."

Built to two mock-ups, cards and a table; the table was chosen, and the word on
screen is **finish option** rather than configuration or variant.

- **One row per BOQ item**, collapsed: code, item, record, qty, run, level,
  who to ask, and then the numbers in their own columns — to quote, also
  outstanding, finish options, awaiting a reply.
- **Finish options nest under their bill line**, coloured by letter as the
  drawings review colours them, each with its own counts in the same columns.
  The bill line says in words that it is a heading, and its quantity is stated,
  never divided.
- **Search and filters**: free text over code, item, question and BWS field;
  tier; contact; run; level, including *No level set*; answer state; and the two
  existing toggles for readiness and awaiting-a-reply. Everything is the
  default tier, on Max's instruction, with the control first.
- **The screen is full width.** Asked for app-wide; done here only.

What was DELIBERATELY changed while doing it: a filter no longer decides what
gets asked. The old screen dropped awaiting-a-reply questions from `selectable`
as well as from the list, so unticking a box silently removed a question
somebody had chosen. The selection is now the truth and the footer names what
the filters are hiding.

**Not accepted by Max.** The four checks pass and there are 20 new tests across
the pure and component tiers, but nobody has opened the real screen: this
session had no signed-in browser to drive.

### Still open

- **Every other dashboard screen is still `max-w-5xl mx-auto`.** Max asked for
  full width app-wide; only the chase screen has it. The record screen and the
  drawings review were laid out against a readable measure and want looking at
  rather than a blanket edit.
- **Sorting a column** — click *To quote* to bring the worst-specced items up —
  is the obvious next step and is not built.
- **No finish option exists in the sandbox**, so the nested level has been
  exercised by tests and by a mock-up, never against real data.

## 2026-09-18 — the app is what was signed off: the design language

Max drew sixteen mock-ups of the app (`docs/design/spec-builder-mockups.html`,
committed the same day so the acceptance artefact outlives a scratchpad) and
asked for them to be built, the rest of the app brought onto the same
language, and the language recorded. Three earlier commits that day
(`17ff4e0`, `2f8ab4a`, `1d5cb0c`) had rebuilt eight of the screens' CONTENT
against the same file and touched no shared chrome; none of them was recorded
here, so this entry covers them too.

**Decisions taken by Max in the planning session:** the environment banner
becomes a chip in the top bar, as drawn, and `house/conventions.md` §2 is
changed rather than departed from (the fabric-ordering app still carries the
banner and is NOT reached by this); every data-backed element in the mock-ups
is built with its loader rather than omitted or substituted; the language is
recorded three ways — `docs/design-language.md`, the `new-screen` skill, and a
live `/dashboard/design` page rendering the real primitives.

**Built, one commit per piece, the four checks green at each:**

- The shell: a dark top bar with the brand, the `EnvironmentChip` (a server
  component passed INTO `NavShell`, so it fails toward showing), the two nav
  items with a red bubble of unplaced mail (`GET /api/email-messages/count`),
  Log out; `<main>` owns no width. Sign-in is a centred card with the chip
  under it.
- The primitives in `src/components/ui/`: `tone.ts` (eight tones as literal
  class strings, purge-guarded by `tests/lib/tone.test.ts`), `Chip`, `Pill`,
  `Note`, `PageHeader`, `PageBody` (1100 / 1400), `Tabs` + `useUrlTab`,
  `Card`, `Table`, `SuggestButton`; `StatTile` rewired onto the tones;
  `formatDay` shared; 14px body and four named sizes set once. The two
  inverted `STATE_PILL` maps are gone — `PROJECT_STATE_TONE` sits beside the
  label.
- Every screen in the file, to its tab: projects list, project overview (details
  grid, five tiles, the Specifications table with Unresolved finish codes and
  Documents that failed to read, Source documents as pack + files, Contacts with
  Owes us, History with baseline and key-date bars), spec table (`wide`, per-run
  subtitle and actions, inline `SuggestButton` levels), the record's four tabs
  (sticky picture and Quote readiness sidebar; a checklist opening on the TGQ
  filter with a Source column that is the next action; three gate boards
  splitting "n to answer" from "n nowhere to record"; versions chosen by
  clicking two rows with baseline bars between them and the stored cells
  beside the atom diff), finishes library as a table, chase with contact tabs
  and `?contactId=`, inbox as tabs and tables with "what it found", intake pack,
  BOQ review, email review as a four-column grid, drawings review with a sticky
  sidebar. `/dashboard` redirects to the projects list.
- Five loaders, each calling the single implementation that already existed:
  `waiting` / `designerContact` / `quoteReadiness` / `matrixFields` on the
  record payload; `contactsOutstanding` (three buckets — a record with a
  contact but no level is its own column) / `unlinkedFinishCodes` /
  `failedDocuments` on the project payload; `found` / `chaseReply` /
  `arrivedToday` / `ruledThisWeek` on the inbox; `baselines` on the record
  history. Db-tier tests for each.
- The record: `docs/design-language.md`, a load-bearing section in CLAUDE.md,
  the `new-screen` skill (mirrored), the `verify` skill corrected from banner
  to chip, `/dashboard/design`, and this entry.

**Found on the way and fixed:** the title squeezed to an 80px column by the
export cluster; a held inbox row printing "specs" with no number; "n days ago"
counting hours; a filename wrapping a row to six lines; the email review
labelling a fabric "Dimensions · COM 3"; a drawings card with only row-level
blockers showing an empty sentence; both open `found-in-use.md` entries on the
record screen.

**Deliberately not built, each with its reason in `docs/design-language.md`:**
the Columns chooser, per-spec ticks on the email review, "Bring them in" on the
finishes page, a chase email preview, a configuration's quantity.

### Verified

By the agent that built each screen, in a browser against the sandbox
DEMO-TEST-01 (read only, nothing confirmed or written), and by a second walk of
the sign-in page, projects list, overview, a run tab and all four record tabs.
`960 passed | 283 skipped` at the last full run; lint, typecheck and build
green in an isolated worktree — a `next build` in the working directory
clobbers the `.next` a dev server is using, and did, three times.

### Still open

- **Not accepted by Max on any screen.** Acceptance is each screen beside its
  mock-up tab.
- Seven db-tier tests fail on the sandbox for reasons that predate this work
  (`chase-drafts` ×3, `intake-routes` ×3, `project-overview` ×1 — confirmed
  failing at `b3a5f95`); they need re-reading against the TGQ-matrix change of
  18 Sept, not against this.
- `spec_description` / `internal_notes` are not record atoms, so a hand edit
  of either is a version with an empty diff.
- The fabric-ordering app still carries the banner this app dropped.
