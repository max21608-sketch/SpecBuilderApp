# Screens and the design language

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

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

### Nothing on a screen is wider than its box

`src/lib/overflow.ts`, `src/components/ui/OverflowWatch.tsx`,
`tools/overflow-audit.mjs`, `src/app/globals.css`

Max, 2026-09-30: an app-wide rule to prevent overflows. The phase table on
the real Aman bill ran 256px past its 1358px body at 1920 AND 1440, so TG1 and
every row's actions sat off-screen inside a scrolling wrapper, and no check
could see it: jsdom has no widths and a screenshot of a cut-off table looks
like a table with fewer columns.

`findOverflows` is the ONE predicate: a box that clips or scrolls
horizontally (the page included) whose content is wider than it. Form
controls, an intentional ellipsis, a 1px `sr-only` box and anything inside
`[data-overflow-ok]` are excepted — that attribute is the reviewable
exception, and every use of it is a decision. `OverflowWatch`, in the shell
in development only, reports each as a console error (which the browser
walks already fail on) and exposes `window.__specBuilderOverflows`;
`tools/overflow-audit.mjs` walks the main screens at 1920 and 1440 through it
and exits 1 on any. Run it against a dev server after any screen change. The
body carries `overflow-wrap: break-word`, which never changes a table
column's minimum, so a code still never splits at its hyphens in a cell. In a
table, a ref is a no-wrap run per WORD (`ClientRefs`) and long text is cut
with `clampText`, never left to push a column wide.

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

**A 2xx that is not a JSON object is a failure, and a 401 says where to sign
in** (audit G4, G11, 2026-11-06). `apiFetch` used to resolve an empty or HTML
200 as `{ ok: true, data: {} }`, so screens crashed on `res.data.batches.find`
and `data.record.parent_id`; it is now `ok:false` with "The server answered
with something that is not data (status N)", and every route a screen calls
answers with an object. A 401 other than the login's own is "Your session has
expired. Sign in again." with `signIn`, announced on `window`
(`SESSION_EXPIRED_EVENT`) and shown once by `SessionExpiredNote` in the
dashboard layout. Every dashboard segment has an `error.tsx` rendering
`ScreenError`, so a render-time throw is a Note in the shell, never a white
page (there was no boundary anywhere, and CLAUDE.md itself records a staged
shape change that threw on every screen). Files: `src/lib/api-fetch.ts`,
`src/components/layout/ScreenError.tsx`, `SessionExpiredNote.tsx`,
`src/app/dashboard/**/error.tsx`.

### A refusal is screen text written on the server

`tests/lib/vocabulary-guard.test.ts`, `src/lib/intake-status.ts`
(`documentClosedSentence`, `reviewedWord`), `src/lib/draft-status.ts`

Every `DomainConflictError` message and every `json({ error })` body is
printed verbatim by a screen, and 29 of them printed a raw status ("This
import is parsing, not open for editing" is the CHECK talking), three said
"run" for a phase, and thirty accused "another tab" or "someone else" for a
version the sentence could only know had moved (audit G15, 2026-11-06). The
guard now reads the literals inside both under `src/lib` and `src/app/api` and
fails on "run", on "another tab" / "someone else" (the sentence says "changed
since this screen loaded. Reload"), and on a status printed raw: a status
reaches a sentence only through the helpers, which name the state and the
next step ("This bill has already been confirmed, so its columns can no
longer be changed. Open its phase to change anything on it"). A refusal that
names the writer from `updated_by` is the allowlisted exception. Codes never
change; screens switch on them. The guard parses `.ts` as TS: read as TSX, a
generic arrow silently ended a file's scan, which is how the screen scan had a
blind spot too. Two blind spots remain and are stated in its header: a message
built into a variable and passed by name, and a plain `Error` a route turns
into a sentence.

### A click's version is the version of its render

`src/lib/acked-versions.ts` (`VersionLedger`, `versionsWritten`),
`src/lib/observation-drafts.ts`, `DrawingsReview.tsx`,
`PackDrawingsReview.tsx`, `SpecDocumentReview.tsx`, the drawings PATCH

Confirm waited for the blur's save and then sent the row versions captured by
the click's render, from BEFORE that save, so typing a figure and pressing
Confirm within a second read "edited in another tab" with nobody else in the
document — at least eleven sites (audit G1, 2026-11-06). Every request on
these screens now reads the ledger when it is BUILT: the larger of what the
server acknowledged and what the row rendered with, so the reviewer's own saves
count and someone else's unseen edit is still refused. Never read
`observation.version` or `item.version` from a closure into a request body.
The drawings PATCH returns `versions` (`versionsWritten`), a swap's displaced
row included. A drawings draft ends with its save: dropped on success, and on
a refusal replaced after the reload by the server's value plus "Your '450' was
not saved: …" (G10) — before, the typed text stayed on the row and the next
blur re-sent it over the other edit.

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

### The record is four jobs, and a tab each (five since 2026-10-05)

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
  pure test holds it against the seed. **Step 2 is BUILT (2026-10-12, Max's
  ruling):** see *An item's TGQ is its own questions; the project's are
  answered once*. The card now links to the project, and its questions no
  longer count in the item's TGQ tile.
- **`RecordDetails` reads as a summary until Edit**, like the project's. Six
  inputs and two paragraphs of help above the tabs on every visit put the tabs
  themselves below the fold. The form inside is UNCHANGED, including the rule
  that matters most about it: it saves as ONE act rather than on blur, because
  typing the quote description, tabbing to Internal notes and typing there used
  to lose the second box.

**A fifth tab, Documents, lists only what a confirm LINKED**
(`src/lib/record-documents.ts`, `GET /api/records/[id]/documents`,
`RecordDocuments.tsx`, Max 2026-10-05: *"all the documents relating to that line
item"*). Five links, each read off the schema: the bill row (a configuration
reads its parent's through `parent_id`); `record_attributes.source_run_id`,
active and retired counted apart; `spec_answers.source_id`, which is the intake
run for both `document` and `email`, not counting `missing`;
`change_sets.evidence_attachment_id` on changes that made a version of this
record; and those changes' `source_intake_run_id`, the only path to a bill a
revision replaced, because `confirm-boq.ts` overwrites `source_import_id`. A
document whose proposals are still staged is not listed, and the screen says
so. **One row per stored FILE**, not per intake run: a bill's own specification
read reuses its attachment and an email's change carries the run's own `.eml`
as evidence. Every query is scoped to the record's project. **An email never
links to `/api/imports/[id]/source`**, which serves inline — it downloads
through the mime or evidence route, or offers no Open at all. The count is the
loaded list's length, null until the tab opens like Versions, so there is no
second count in the record route to drift from the table.

**No input is keyed on a page-wide reload counter** (audit G2, G3, G6, G9,
2026-11-06). Every checklist box was keyed on `answer_id:version:reloadKey`
and the page bumped `reloadKey` on every save, so typing in question A, tabbing
to B and typing lost B's text when A's reload landed — the details panel's own
trap, in the checklist. A box is keyed on its answer's version and its own
refused saves (`refusals`); `reloadKey` stays for the history and documents
tabs. `PendingReason` carries the qualifier, so a qualifier-only edit that
needs a reason is saved when the reason is given. The project's details form
is `ProjectDetailsCard`, which holds the form only while editing, so nothing
the page reloads can reach it (seven callers used to reset it). The record
view is keyed by id (`RecordForId`), so an open reason box never crosses to
the next record.

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

### A page split keeps state where it lived

`src/components/projects/{DocumentsTab,NotesCard,PhaseTabs,HistoryCard,LevelsBanner,SummaryRow}.tsx`,
`src/components/records/{use-attribute-actions.ts,record-payload.ts,ConfigurationPanel,ChecklistTab,SpecsTab,RecordHeader}.tsx`,
`src/components/imports/{use-boq-import.ts,BoqReview,BillLineRow,SheetHeader,RevisionPanel,StructureRead}.tsx`,
`tests/components/{project-page-sections,record-page-sections}.test.tsx`

Audit 5.3, 2026-11-07. The three giant pages (the import review 3,118 lines,
the project overview 1,826, the record 2,238) are composed from those files;
the pages keep the header, the URL tab and the data. Three rules were learned
by splitting them, and each is a trap:

- **A component rendered twice, or unmounted by a tab change, must NOT own
  its state.** The Documents and History cards render on the Overview AND on
  their own tab beside the hidden Overview; everything on the record's Specs
  tab unmounts when another tab is chosen. A hook the page calls holds the
  state, or two copies disagree and a half-typed rename or correction is lost
  on a visit to another tab — found when `ConfigurationPanel` lost a rename
  at its first cut, and held by `record-page-sections.test.tsx`.
- **The load stays where one GET serves several screens.** The import page
  calls `useBoqImport` itself because one GET serves all five review screens
  and the dispatch needs it; `useStructureRead` is called AFTER the next-step
  and pack effects, because effects run in declaration order and the
  automatic structure read must go out where it always did.
- **The proof is a settled-DOM snapshot per rendering test**, byte-identical
  before and after (83 for the import page, 84 for the other two), with the
  characterisation tests written FIRST where the pages had few — and no test
  file changed by the split itself.

The overview's documents poll asks `GET /api/projects/[id]?only=documents`
(audit G13): the same documents query and failed count answered alone, any
other slice a 400 in words; `tests/db/project-documents-only.test.ts` holds
it. The chase screen asks `GET /api/drafts?questions=once` and unpacks the
groups (`chase-inventory.ts`): each question shipped once, 62.9 MB → 21.3 MB
on a 440-record project; the page takes either shape, recognising the packed
one by its `questions` list, never assuming it.

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
