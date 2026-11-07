# Bills of quantities

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### A printed number is read once, and a comma is refused, not guessed

`src/lib/printed-number.ts` (`readPrintedNumber`, `readQuantity`,
`quantityNotGiven`), `src/lib/dimensions.ts` (`parseDimensionFigure`,
`FIGURE_TOKEN`, `ambiguousSpellings`), `src/lib/boq-import.ts` (`quantity`,
`qtyRaw`), `src/lib/pdf-bill.ts` (`pdfBillWorkbook`), `src/lib/drawing-items.ts`
(`rejoinFeetMark`)

Six readers had six rules, and each was the plausible wrong answer somewhere
(audit C3/C4/D10, 2026-11-06). `Number("")` is 0, so `TBC` and `N/A` in a
quantity cell were a quantity of NOTHING rather than no quantity, and the
tab's "the bill gave none" sentence could never fire; stripping non-digits
joined `2 x 3` into 23 and `12 (6+6)` into 1266; `1.5` and anything past int4
reached `spec_records.qty integer` and the confirm refused the WHOLE bill with
"Nothing was written"; and every comma was a decimal point, so `W1,200`
composed as `W1mm` in BWS field 3 with nothing to flag it, and on an unmarked
drawing `1,800` voted the page into centimetres.

One reader returns a NAMED outcome — `whole`, `decimal`, `ambiguous_comma`,
`words`, `none` — because the caller's sentence depends on WHICH refusal it
is. **`1,200` / `1.200` is ambiguous and refused everywhere (Max, 2026-11-06):**
it composes as `[W "1,200" — thousands or decimal, not read]` with the two
spellings offered, it never votes a page's unit, a gate slot blocks on it, and
a quantity reads "not given". What IS unambiguous is read: a decimal comma
with one or two digits (`1,5`), a leading zero (`0,750`), two groups
(`1,200,000`), a group followed by the other separator (`1.200,5`). A refused
bill quantity stages `qty: null` with `qtyRaw` (absent on a count and on a
blank, so every bill staged before this stages byte for byte), and the review
prints `quantityNotGiven(qtyRaw)` — "quantity not given (the bill says
“TBC”)" — a reason computed from the text and never stored. A Date or boolean
cell is words, never a number. `Ø`, `ø` and `⌀` reach `normaliseDimensionSlot`
from a combined line, and a v4 drawing figure printed with `ft` or a feet mark
rejoins its mark before the split, so it reads as inches or is refused whole
rather than voting as 8 cm. Do not add a seventh reader; the PDF row ANCHOR
regex is geometry, not value, and stays separate. Not yet moved onto it:
`pdf-bill-checks.ts`'s `printedNumber`, and `DIAM` is still unknown to the slot
normaliser.

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

**The variance matrix's bills rows (plan §6.10.a) were driven through this
reader on 2026-09-21**, nine rows, each a synthetic fixture built by
`tests/fixtures/build-boq.ts` (real `.xlsx` bytes in memory — no spreadsheet
is committed, because `.gitignore` refuses `*BOQ*.xlsx` as the NDA guard and a
fixture named to slip past it would hollow out the rule). Four of them changed
the code, and each is a trap: **a bill whose headings the reader does not
know is refused by quoting the bill's own headings back**, naming the closest
row and the required column it lacked, ON THE REVIEW SCREEN — the sentence
used to be a 422 the upload screen alone saw, and `intake_runs.error` had
never been rendered for a bill; **a header split over two rows is read as one
header**, only where the second row COMPLETES a row that already matched;
**one fold everywhere a code is matched** — `boq-reconcile.ts` used
`boq-import`'s looser fold while every other matcher used `record-refs`'
`normaliseRef`, so `S.201` against `S-201` read as a new line beside a
retired one, and confirming that revision would have retired a record with
its drawings, specs and picture over a dot; and **`.xls`, `.xlsb`, `.xlsm`,
`.ods` and `.numbers` are refused in the browser before a byte is stored**,
with *save as .xlsx* as the way out, while `.csv`/`.tsv` proceed and the drop
zone says so. A bill with no quantity column proceeds with `qty` null and BOTH
screens now say *quantity not given* — never 1. A bill inside a PDF was
refused at classify time until 2026-10-15. **Since then it is read by its
text, or else transcribed:** see *A PDF bill is read by its text* below. Two
bills in one pack both stage and the
pack screen says nothing is paired. Recorded and NOT fixed: a subtotal or
section row that carries a description becomes a spec record with the
subtotal's figure as its quantity — since 2026-09-23 a `section` or
`subtotal` row KIND exists and defaults to Ignore, but only the model or a
person sets one (see *A bill is never refused*). The header synonym list is
SEED DATA since 2026-09-23 (`boq_column_aliases`, 0040).

Rows above the header carry the revision, the date and the terms the run is
priced under. A client template writes `Revision:` in one cell and `0` in the
NEXT one, so the reader handles the split form as well as the inline one. Both
stay **strings**: parsing "14-Sep-26" into a `date` hits the TOE-dates trap for
a value nothing computes with.

### A bill line's description cell is a name and its specifications

`src/lib/bill-description.ts`, `src/lib/bill-description-load.ts`,
`src/lib/confirm-boq.ts`, `src/components/imports/BillDescription.tsx`,
`tools/bill-description-read.ts` (`npm run bill:descriptions`)

The Aman Miami Beach bill (P18181, 2026-09-30) writes each item's size, model
and finishes into its description cell, one statement per line — `Drawers` /
`Spec size: D380 x W965 x H860 mm` / `Finish: STN-02, MTL-01, TIM-03`. The
reader collapsed the line breaks, so every record was NAMED with the whole
cell and nothing it said reached a slot or a field; the charged "Read the
specifications in this bill" was a second step nobody had pressed. Max: "the
name is including all of the finishes and like dimensions".

A multi-line cell is staged verbatim as `itemDescriptionRaw` (only when it
has more than one line, so every single-line bill stages byte for byte as
before). The first line is the record's name; every later line becomes a
`record_attributes` row sourced to the bill run with no page, through
`readDimension` / `readFinishes` — there is no second parser. The review GET
and the confirm both call `planSheetDescriptions` over the staged JSON with
one loader, so the BOQ review IS the approval gate for these values: each
line shows the composed cell, each code and its field, and every statement
verbatim behind a toggle. Traps:

- **One metric size line fills the slots.** The imperial twin and a second
  size line are notes; plain inches or complete feet-and-inches convert only
  when there is no metric line. Never two attributes on one slot.
- **Not overall is not a slot:** `Fully reclined`, `SEAT`, `x Base:`, a
  clearance, an undertable, a garbled figure (`D 51 0`) stay notes. `D` with
  no `W` is placed as printed and flagged, never read as a diameter. `OAH`
  is H by a vocab entry citing this bill; `L` is not a slot.
- **A description fabric claims no COM when the item has a fabric line**, and
  `Fabric: COM` never claims one: a second COM would ship a cloth that does
  not exist. Both are notes.
- **An unlabelled line that starts with a code continues the label above it**
  (`Finish:` / `GR-TIM-10 …` / `GR-MTL-01 …`); a value listing codes is one
  statement per code, each keeping its own words.
- **A revision writes nothing onto a carried record** that already holds a
  bill's description specs or whose slot/field is occupied, and says so.
- **A bill whose confirm read its descriptions refuses the charged read** on
  the server (409), because it would propose everything again.

### A seeded bill layout reads like a known heading, and may carry a row rule

`db/seed/0013_boq_layouts.sql`, `db/migrations/0042_boq_layout_row_rules.sql`,
`src/lib/boq-roles.ts` (`columnsAwaitingALook`, `SEED_ACTOR`),
`src/lib/boq-stage.ts`, `src/lib/boq-import.ts` (`readSheet`),
`src/lib/boq-row-kinds.ts` (`applyCategoryFinishRule`)

A person-saved layout lives in ONE database, which is how pilot came to read
the Aman bill with a charged model call and wait for "Columns checked" while
the local stack knew the layout. So a layout this repo has verified against a
real bill is SEED DATA (`created_by = 'seed'`): it stages
`layoutOrigin: "seed"` and waits for no columns check; a person's layout and a
model reading keep theirs. The guard against a seeded layout reading another
specifier's bill is the unchanged exact-heading match (`layoutAt`), never the
origin. Re-seeding restores it, including over a retired row of that name.

A seeded layout may carry `row_rules` (0042). Aman's is
`{"finishForCategoryPrefix": "FBX-"}`: a line whose own Category Code begins
`FBX-` is fabric for the nearest item line above it — the bill's own column
speaking, verified on both real copies (34 of 34 sit under their item). Per
layout, never global. The bracket rule still wins; a bracket naming another
line, or naming a ref no line carries, is flagged amber naming both; an FBX
line with no item above gets no parent and a flag, never a silent record.
**A bracket that is a ZONE LIST (`GR / MUR-FUR--04`) may only CONFIRM the
item above, never choose one** (2026-10-12): the real bill copies that same
bracket onto a fabric line under `PL-FUR-04`, so letting it pick would put the
PL chair's fabric on the GR chair. Read with `expandZoneList`: the item above
is a member → no flag; members are on the sheet and the item above is not →
the flag names both.
Without the rule the same bill staged 96 records and 5 fabric specs; with it,
67 and 34. Only seeds write the column.

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
  prevent. `loadExportScope` also requires the RUN to be active — and since
  2026-09-21 (variance row d5) **an export asked for a retired phase is
  REFUSED with a 409 in words**, never a file: it used to compose an empty
  workbook named after the phase, which uploaded to BWS would wipe the job
  set. Reachable only by a stale link or a pasted `runId`; a downloaded 409
  renders as raw JSON, as the 404 always has.
- **Retiring a run asserts its own cascade.** `spec_records.status` does not
  follow `spec_runs.status` and no constraint can make it, so `retireRun`
  retires every record and then counts, before commit.
- **A configuration follows its line** (audit C1, 2026-11-06, found by two
  auditors from opposite ends). It carries no bill code, so no line can pair
  with it, and the retire step swept every configuration on the phase: revise
  a phase holding S-301 TYPE 1–5 and the five jobs left the export, the bare
  parent shipping in their place. The reconcile loader reads bill lines only
  (`parent_id is null`) and names each line's live configurations beside it
  ("12.1–12.5 follow it"); the confirm carries the configurations of every
  line it keeps AND sweeps bill lines only, each holding alone so one can
  change without the other; a dropped line's configurations are retired with
  it, at the same moment, in the same change; a pairing naming a configuration
  is refused.
- **One tab revises a phase** (C2). Two tabs naming one `replacesRunId` meant
  the second tab's retire step swept the first tab's new records. It is
  refused at the sheet PATCH, naming the other tab and inside the update's own
  WHERE so two presses cannot race, and again at confirm
  (`phase_revised_twice`).
- **A SUGGESTION IS NOT A PAIRING.** Found while building C1 and present since
  `cab35f9`: the pairing select showed the reconcile's suggestion as its
  chosen value, nothing stored it, the confirm writes only stored `replaces`,
  and a select already showing the record fires no change when somebody
  "agrees" — so every untouched suggested line confirmed as a NEW record and
  the record the screen said it continued was retired with its drawings and
  specs, while the screen read "0 no longer listed". The select shows the
  stored decision only; a suggestion is a `SuggestButton` ("Pair with …") with
  "Pair the n suggested" per tab; reconcile reports `accepted` and lists a
  suggested-only record in `missing` with `suggestedFor`. The level-picker
  trap, in a third place.
- **A retired line can come back** (C14). A retired bill line of the phase
  whose code is on the bill again is offered as a `restoreCandidate`, never
  chosen (two retired on one code: both offered, SX11A); the choice is
  `replaces.restore`, and the confirm un-retires it from `retired` at the
  version shown, with the configurations that were retired at the same
  moment. Before this the line became a NEW record and the old one kept its
  drawings, retired. Files: `src/lib/boq-reconcile.ts`, `src/lib/confirm-boq.ts`,
  `src/app/api/imports/[id]/route.ts`, `src/app/dashboard/imports/[id]/page.tsx`.

### A bill is never refused; it is mapped

`src/lib/boq-import.ts`, `src/lib/boq-roles.ts`, `src/lib/boq-stage.ts`,
`src/lib/boq-row-kinds.ts`, `src/lib/boq-structure.ts`, `src/lib/confirm-boq.ts`
(`writeFabricLine`), `src/app/api/imports/[id]/columns/route.ts`,
`src/app/api/imports/[id]/suggest-columns/route.ts`, `src/app/api/boq-layouts/route.ts`,
`src/components/imports/BoqColumnsPanel.tsx`, `tools/boq-gap.ts`,
`db/migrations/0040_boq_columns_and_layouts.sql`, `docs/plans/any-bill-2026-09-23.md`

Found 2026-09-23 on the Miami Beach pack (Aman Interiors): a real bill headed
its code column "Spec Code", no row read as a header, the run went `failed`,
and **Try again** posted to `/extract`, which refuses a bill. A bill whose
columns are plainly there was a dead end because of the words above them. Max:
*"we should never get to the stage where it's like, I just can't move on."*

- **The order is layout → synonyms → the model's reading → a person.** A
  synonym is seed data (`boq_column_aliases`), a WHOLE heading after folding
  case and whitespace, never a substring — a substring makes "Category Code"
  the code and "Unit Price" the unit. A layout applies only when EVERY heading
  it maps is present exactly, and a sheet a layout read keeps its Columns panel
  open until a person closes it once: a remembered layout never applies unseen.
- **Nothing is refused.** A sheet nothing could read is staged `needsColumns`
  with a preview of its rows; the review opens on the Columns panel; the
  confirm refuses a live one BY NAME. Re-reading with a mapping is free: the
  stored source is parsed again by code, fenced on the run's version.
- **The model reads the STRUCTURE and code reads every cell** (Max, 2026-09-23).
  The structure read (Opus 5, effort medium, one call per sheet up to 1,000
  rows) proposes the header, a role per column from the CLOSED list with its
  evidence, which sheets are not bills, and each row's kind. Code validates
  every part and drops what fails, and the confirm waits for "The columns are
  right". A model transcribing 300 quantities would be 300 chances to mis-copy
  one that nothing downstream questions. The replay guard is a version claim
  taken BEFORE the call.
- **A fabric line is a spec on its item, never a record** (Max, 2026-09-23).
  The AMB bill puts each item's fabric on its own line — `GR-FAB-13
  (GR-FUR-10)`, unit `m`, no quantity. The bracket names the item, so an exact
  bracket match is applied at parse unflagged; two lines carrying the code →
  the nearer one ABOVE, flagged; otherwise only the model or a person places
  it. **The bracket alone placed 5 of 34** on the real bill (brackets such as
  `GR / MUR-FUR--04` name no item code); the model's reading placed all 34.
  The confirm writes the description verbatim into the next free slot OF ITS
  KIND on that record (since 2026-10-06 — see the next section; it was "the
  next free COM slot" for every line), files the code through
  `resolveFinishCode` (CONFLICT rule), and refuses a REVISION that no longer
  states a finish the record held from the bill (the one planner, below).
- **Measured on the real bill, local stack:** 101 lines, 67 items, 34 fabric
  lines, quantity total 1,241 — `boq:gap --golden` 100% on lines, codes,
  quantities and fabric parents; the structure read took 25 s; a layout saved
  from one copy read the other copy (header on row 8 instead of row 1) with no
  human step.
- **A formula cell with no cached result reads as blank**, never
  `[object Object]` — one real copy saved its `Line` column that way.

**Read the specifications in this bill** registers the SAME stored file as an
`ffe_schedule` document (`src/lib/bill-specifications.ts`, idempotent on
`registration_request_id = 'boq-specs:<runId>'`). Measured on the real bill:
559 proposals, **65,057 output tokens and 499 s for 101 lines** — half the
128K ceiling and two thirds of the model deadline — so a longer bill is read
in ROW WINDOWS, which is not the excluded "splitting an oversize drawing set":
a spreadsheet has rows, and a row window loses nothing a page split would.

**The review page is a dispatcher; the bill review is `BoqReview`** (audit
5.3 cut A, 2026-11-07). `src/app/dashboard/imports/[id]/page.tsx` went from
3,118 lines to 144: it loads the import with `useBoqImport`
(`src/components/imports/use-boq-import.ts`, the GET plus every bill verb,
each the same request with the same reload-then-report order), because ONE
GET serves all five review screens and the dispatch needs it — do not move
the load into `BoqReview`, which would be a second GET. It calls
`useStructureRead` AFTER its next-step and pack effects (effects run in
declaration order, so the automatic structure read goes out where it always
did) and hands a bill to `BoqReview.tsx` with the hook's result. The pieces:
`BillLineRow.tsx` (one line and its panels; `billLineId` lives here),
`SheetHeader.tsx`, `RevisionPanel.tsx` (the summary and `PairingCell`),
`StructureRead.tsx` (`useStructureRead`, `StructureReadNotes`, `SheetColumns`
with the `sheetColumnsId` anchor). Every `id`, `data-*` attribute and
`goToAndFlash` target was kept; the proof was 83 page snapshots, one per
rendering test with pending requests settled, byte-identical before and
after, and no test file changed.

### Four new bills: what a specifier's own layout broke, and the rules that hold it

`src/lib/boq-structure.ts` (`STRUCTURE_TOOL`), `src/lib/model-request.ts`,
`src/lib/bill-finish-kind.ts`, `src/lib/confirm-boq.ts` (`writeFabricLine`),
`src/lib/bill-description.ts` (Dims / Finish columns, `unitOverride`),
`src/lib/gates.ts` (a slot's unit), `src/lib/bill-cell-pictures.ts`,
`src/lib/document-classify.ts` (`PROMPT`), `src/lib/boq-import.ts`
(`proposePhaseNames`), `db/migrations/0047_boq_dimensions_finish_roles.sql`,
`docs/plans/README.md` 2026-10-06

Matthew sent four bills on 2026-10-06 — Annabel's NY (MBDS), two Butler Arms
RFQs (Creation Luxury) and Panther. The model's structure read scored 100%
against hand-written goldens on all three new layouts. Everything that broke
was AROUND it, and each is a trap:

- **A nullable enum in a model schema is `anyOf`, never `type: [T, "null"]`
  beside an `enum`.** Structured output (every Opus 5.5 read) refuses the
  second with a 400, and for two days every bill in an unknown layout failed
  its column read while every test was green. `tests/lib/model-request.test.ts`
  now walks every tool for it. `extraction-schema.ts` had always said so.
- **A bill's finish line is filed by KIND, and many never refuse the bill.**
  `billFinishLineKind` reads the bill's own code (`F-FA` fabric, `F-MT` metal,
  `F-WD` timber, `F-TR` trim — bills only; the drawings path still reads those
  as nothing, so packs already staged do not move), then `classifyCallout`'s
  words, never the item's name. Fabric → COM 1–3, timber → the three timber
  finishes, metal → the two metal finishes; a trim, hardware, an unreadable
  line, or a kind whose fields are full is WRITTEN with no BWS field — what
  the document said is kept. The confirm and the review GET call one
  decision (`decideBillFinishSlot`), so the arrow on the row is the write.
- **A bill's own Dims and Finish COLUMNS are read by the description reader**
  — the one that reads "Sizes (mm): …" inside a description — never a second
  parser. The unit is printed in the cell, in the column's heading, or set by
  a person on the review (`unitOverride`, per line or "set them all"), and
  NEVER from the figures: the Butler public-areas sheet prints `W47.2 x D27.5`
  (inches) one row above `W2000 x D1000` (mm), neither marked. A size with no
  unit is placed in its slots UNCONVERTED and bracketed, and **a slot with no
  unit does not satisfy a gate** (`gateStatus`). A finish cell is one
  attribute, classified whole; two kinds in one cell is a note.
- **What decides bill against FF&E schedule is PRICING, not the title.** Both
  Butler RFQs call themselves "FF&E SCHEDULE … ITEM LIST / RFQ" and were filed
  as schedules — a full charged read, no records. A quantity and a price per
  line, or "RFQ", is a bill. Re-checked on the Aman bill, its OMS tracker,
  Panther's preamble, a spec sheet and a shop drawing before it shipped.
- **Max's decisions on these bills:** a "Prototype Quantity" column
  (`mockupQty`) also puts its items on the Mock-up phase through
  `addToMockupPhase`, with the bill's figure as the quantity (text → none,
  with a note); `keep` is the ONE role several columns may share, each cell
  into the new record's notes under its heading, and never a price; a sheet
  with no codes says on the review and on its phase that a coded revision
  must be paired by hand. NO seeded layout per specifier yet — a model read
  and a person's tick, until a specifier sends two bills in one layout (and
  Creation Luxury's fabric rows cannot be a code rule: a `CGF` MATTRESS line
  is an item).
- **A picture placed IN a cell is the row's picture** (`bill-cell-pictures.ts`,
  every rich-value hop resolved through its relationship; malformed → none,
  with a sentence, never a failed bill).
- **A tab still called "Sheet1" proposes the file's name** as its phase name,
  or two single-tab bills make two phases nobody can tell apart.

### A procurement schedule is a bill: the model reads its columns, and a Dims cell is read line by line

`src/lib/boq-structure-wanted.ts`, `src/lib/bill-description.ts` (`columnStatements`),
`src/lib/document-classify.ts`, `tools/pdf-schedule-to-xlsx.ts`

Found 2026-10-15 on the Ronnie Scott's tender (LBPCo, P16717), whose only
bill is a "Procurement Schedule" — line items, ORDER QTY, and each item's COM
lines beneath it — sent as PDFs printed from Excel. Four things, each a trap:

- **A sheet the known headings mapped with NO quantity column is read by the
  model automatically**, once (`sheetWantsStructureRead`, shared by the page
  and the route). "FF&E CODE", "DESCRIPTION" and "UOM" are synonyms, "ORDER
  QTY" is not, so the sheet read as mapped: every line "quantity not given",
  every COM line an item, and the model read that got all of it right sat
  behind a button in a closed panel. A person's, a layout's or a model's
  mapping is never second-guessed.
- **A Dims cell of several lines is read LINE BY LINE.** Folded into one
  value, "REFER TO DRAWING 740 X 740 X 720MM SH: 420MM" read as D740 — the D
  of DRAWING — and a sofa's 1700mm width landed in D. A line with no figure is
  a note; the first size line is placed (`placedSizeOf`); a one-line cell
  reads exactly as before. **A later line that gives ONLY slots the placed
  line left empty fills them** (`sizeSupplements`, `dfed295`): `SH: 420MM`
  under `720 X 1400 X 720MM` is the seat height. That needs every part
  lettered, a unit printed, nothing left over, no slot already held, no inches
  under a metric line, and no Dia beside W/D. Every other later size line stays
  a note, and there are never two values on one slot. Until 2026-10-15 this
  line was noted as "the same size again", and the seat height was lost on
  pilot. **`700 DIA X 710MM` still gives the bare 710 no slot** (the
  mixed-line rule is unchanged). The note now says the line gives it no
  letter, and since workstream E (`be090a6`) the review offers a slot for
  EVERY figure on every size line. Nothing picks one.
- **Bare figures placed in printed order now say so**, and name the column
  heading's own order where it prints one: this schedule heads it "L X W X H"
  and prints a sofa as `800 X 1700 X 780MM`. `L` is still not a slot; the
  reviewer sets the slots.
- **A COM list is a finishes schedule**, not a fabric schedule: one row per
  code (`FB_01`, `TR_01`) saying what the code IS, naming no item.

**A COM line is filed by its COM CODE** (`finishCode`, 0048, seeded synonym
"com code"; `fabricFilingCode`, `fabricLineWrite`, `decideFabricFiling` in
`bill-fabric-filing.ts`). Its FF&E code is a POSITION (`FB-CH-02A` is two
cloths on two floors), so it is not the key. Where a line has a COM code it
writes its FINISH column's cloth as its value, with the description's
placement ("POUFFE DEPTH") as the 0029 qualifier. It is filed under the COM
code. The bill's copy of the cloth is never compared with the library and is
never written as its description. The two layouts disagree in formatting
alone, so either order would have conflicted, and the finishes schedule
describes the code. Bill first, the schedule then "fills" every code. An item
line's COM cell goes to its notes. NOT `productReference`: the model puts a
cloth name there on the Butler Arms bill. Lines without the column write
exactly as before (`boq:gap` on Aman and bills-1006 unchanged). Verified on
the local stack (TEST T16718): 17 lines on 14 codes, `FB_04` on three items,
`FB_12` on two, and the COM list filled all 14. Two lines quoting one COM code
with different cloth link without a question, and that is what the code
means. **0048 must be on a database before its seed is run.** Still open: the
converted workbook's leather rows carry their name in the notes column
(`DIABLO WALNUT` in FINISH), a PDF-conversion shift.

**A COM line naming a code that is on two lines of a phase goes on each line
that has no finish line of its own** (`finishLineTargets` in
`boq-row-kinds.ts`; Max, 2026-10-15: "apply it to both, no tick boxes").
Naming means the line's bracket, or its own code ending in the item's code
(`FB-CH-03` → `CH-03`). Where the line SITS (the model's reading, a person's,
a layout's category rule) names nothing. A twin with its own finish lines
keeps only its own: otherwise the salon CH-02's cloths would land on the
members-bar CH-02 beside its own. Each record gets its own attribute in the
next free slot of its kind, and the finish is filed once. The confirm, the
review's arrow and the description reader call the one function. An ITEM line
on two lines is still SX11A. Measured over 391 staged finish lines: only
FB-CH-03 moves. **Still open:** the bill's own charged specification read
(`bill-rows.ts`) maps a fabric line's row to ONE record.

**A bill line's category is matched on the item, before any ` @ `**
(`suggestCategory`, `boq-stage.ts`, 2026-10-15). "Side Table @ Lounge" is a
side table; without this rule, the term "Lounge table" tied nine Aman lines.
`npm run boq:gap -- <folder> --categories` reads the seed through the same
function, so diff it before and after any change to seed 0004.

**"Timber finish 1" and "Metal finish 1" are screen names, never BWS's**
(`fieldDisplayName`, `src/lib/spec-field-label.ts`; Matthew and Max,
2026-10-15). They cover json_id 4 and 5. `spec_fields.name` and `name_norm`
(which document matching uses), the export headers, the quote, the costing
sheet and the chase EMAIL all keep BWS's names. The check sheet prints both:
`Metal finish 1 (BWS: Main metal finish)`. Any screen that prints a field name
calls `fieldDisplayName`, and a test holds the map against seed 0001. The 17
checklist questions worded "Main timber finish" DISPLAY the new name and keep
their seeded wording, because rewording them would make every unsent chase
draft stale.

### A PDF bill is read by its text, and the workbook it makes is the bill

`src/lib/pdf-bill.ts`, `src/lib/pdf-bill-source.ts`, `src/app/api/imports/route.ts`
(`registerPdfBoq`), `src/app/api/imports/classify/route.ts`,
`tools/pdf-schedule-to-xlsx.ts` (now a thin wrapper). Built 2026-10-15 (C1,
`7654fdf`) from the Ronnie Scott's procurement schedules, which exist only as
PDFs printed from Excel.

- **A PDF printed from a spreadsheet is put back into cells by POSITION, by
  code.** The header is found by its quantity heading, and rows anchor on the
  quantity. No model reads a cell.
- **The workbook is stored BESIDE the PDF and is the run's source.** So the
  Columns panel, the structure read, a person's columns and the confirm are
  all unchanged. The PDF is a second attachment (`boq_pdf`). Each line knows
  its page through `parsed.pdfSource`, which is kept on the DOCUMENT, never on
  the line, so that resetting columns cannot lose it. The review links each
  line to its page.
- **A header needs TWO MORE headings that the registers know whole, and no
  prose in its band.** Before that rule, a spec sheet's "QUANTITY : 2" and a
  preamble's "quantities and dimensions supplied by…" each read as a bill.
- **The classifier files the Ronnie Scott's schedules as FF&E schedules**,
  with certainty, and a prompt line did not move it (measured, then
  reverted). So where the model names a schedule and the text reads as a
  bill's table, the row is HELD with the next step in one sentence. Neither
  reading wins.
- Refused in ONE sentence (`pdfBillRefusal`), with the detail behind "Why".
  Pictures are not carried.
- Measured on the three real PDFs: 575 of 575 staged fields equal to the
  hand-converted workbook. 47 non-bill real PDFs: none reads as a bill.

### A PDF bill code cannot read is transcribed, and every line says so

`src/lib/pdf-bill-transcribe.ts`, `src/lib/pdf-bill-checks.ts`,
`src/app/api/imports/[id]/transcribe/route.ts`, `PdfTranscriptionPanel.tsx`.
Built 2026-10-15 (C2, `a49ce76`…`6124f58`). **This is the one bill whose
cells a model writes, and it is the ONE exception to "code reads every cell".**
Max approved it in writing on 2026-10-15: "a PDF bill with no usable text
layer may be transcribed by the model, every line marked transcribed with its
page and checked by a person."

- **Registration holds it WAITING, and nothing is charged.** The review starts
  the transcription ONCE and never retries it after a failure. It reads in
  two-page windows, six in flight, up to 24 pages; past that it is refused in
  words.
- **The output is the SAME grid a sheet is**, stored as a workbook beside the
  PDF and read by the ordinary reader. So everything after it is unchanged,
  the structure read included.
- **Every line is marked transcribed, with its page.** Code cross-checks three
  things: printed quantity totals, codes against any text layer, and the
  model's own "unclear". A failure is red on the line, and in a red list
  APART from what the confirm waits on. The confirm is unchanged, and the
  reviewer is the gate.
- A whole-bill total that fails points only at pages whose own total failed.
- A scan is now classified (one small read). A scan read as a schedule, or as
  unclear, is held with the way to Bill.
- Measured on an invented two-page bill rendered as pictures only: 18 of 18
  lines exact, 15 s. **A real scanned bill has not been through it.**

### A bill's own specification read resolves by ROW, and a long sheet is read in windows

`src/lib/bill-rows.ts`, `src/lib/spec-document.ts` (`resolveRecords`),
`src/lib/spec-document-registers.ts` (`loadBillRowIndex`),
`src/lib/spec-reading-vocab.ts`, `src/lib/spreadsheet-windows.ts`,
`src/lib/extraction-windows.ts`, `tools/spec-gap.ts`

The first read of a real bill's descriptions (AMB, 101 lines) produced 559
proposals and placed 18: fabric-line refs such as `GR-FAB-13 (GR-FUR-10)` found
no record, a code on two lines was ambiguous, and "Spec size: D 460 X H 450 mm"
reached no slot. **The row is the record**: a read registered from a confirmed
bill (`boq-specs:<runId>`) maps each proposal's sheet row to the record the
bill's confirm made of it — a fabric line to its item — and that precedes the
ref matcher; a readable ref naming a DIFFERENT record is offered with the row's
record and neither is chosen. A fabric line's sizes never fill the item's slots
(its Width is a roll width); an item's metric size line is placed over its
imperial one; "Fabric: COM" and stone codes fill no field; a code the item
already holds is aimed at its own field, never at the next free COM. Re-matching
the staged read (free): **233 placed, 0 with nowhere to go** (was 18 and 88).
Still left for a person: ~400 rows that repeat the bill's own columns (Item
Description, Model Ref, Unit) — `found-in-use.md`, 2026-09-23.

**The wording rules live ONLY in `spec-reading-vocab.ts`**, each with the bill
it came from, because they were derived from ONE specifier's bill before
Matthew's examples arrived: size labels, the zone prefix (`GR-TIM-09` reads as
`TIM-09`), the words that mean COM. Add to it from verified wording only, and
run `npm run spec:gap -- <runId>` before and after.

**Windows:** a spreadsheet for an observation kind is sent as numbered rows, in
windows of 40, three in flight, at most nine, inside ONE attempt, so 360 rows
fit the unchanged timing inequality; more is refused before any call, in words.
One retryable failure re-reads every window (the succeeded ones are paid for
twice) — the fix, not built, is each window as its own queue message.

### The bill fills the finishes library, and BW's finish is set once per code

`src/lib/bill-fabric-filing.ts`, `src/lib/bill-fabric-load.ts`,
`src/lib/confirm-boq.ts` (`writeFabricLine`, `giveBillPicture`),
`src/lib/boq-row-kinds.ts` (`fabricLineIsPlaceholder`),
`src/lib/finish-edit.ts` (`mintInternalFinishCode`, `carryFinishToItems`),
`src/lib/finish-standard.ts`, `src/lib/finish-standard-palette.ts`,
`src/lib/bw-standard.ts` (`standardInForce`), `src/lib/item-image.ts`,
`src/lib/item-image-write.ts`, `src/lib/bill-row-image.ts` (`effectiveRowImage`),
`db/migrations/0044_finish_code_prefix.sql`, `db/migrations/0045_finish_standard.sql`,
`db/backfill-bill-swatches.ts`

Max, 2026-10-05, reviewing the Aman bill on pilot: the fabric's picture "should
be assigned to that fabric code in the fabric library … it is the swatch …
one and the same thing", so the library is there "as soon as the BOQ's in";
"main timber finish is like a Ben Whistler standard finish … when someone
actually looks at it in the finishes library they'll then apply it there"; "we
always prefer a picture over a drawing … a 3D render over a drawing". Each
rule below is a trap rather than a preference.

- **ONE filing decision, three callers.** The confirm, the review's "what will
  happen" line under each fabric row, and the backfill all call
  `bill-fabric-filing.ts`. A review that predicted one filing and a confirm
  that did another is the `proposalBlockers` disagreement again.
- **A coded fabric files as it always did** (match / new TBC client finish /
  conflict links nothing). **An uncoded fabric with real words is filed as an
  IN-HOUSE finish by default** — linked to an internal finish worded EXACTLY
  the same, otherwise a minted one, TBC. **A placeholder is never filed and
  never matched**: `fabricLineIsPlaceholder` strips the bill's own lead
  ("Fabric @ <item>") and TBC phrases, and a line with nothing left is a
  placeholder. Matching "Technical details TBC" to "Technical details TBC"
  would merge every undecided fabric on the bill into one. On the real Aman
  bill all twelve uncoded fabric lines are placeholders — correct, and the
  reason the backfill there plans swatches and no codes. **A CODED line whose
  words are only a placeholder LINKS BY ITS CODE** — the Aman bill names
  GR-FAB-13 in full under a stool and again under a desk chair as "Technical
  Details TBC"; words that say nothing are not offered to the CONFLICT rule, and
  a new code created from one gets no description. **The fabric's own code is
  `fabricOwnCode`** (the review's chip and the confirm ask it): the bracket off,
  `N/A` as none, the item's own code as none, and the item's own code written
  after the fabric's without a bracket (`GR-FAB-13 PL-FUR-04`) taken off — the
  last whole word only, matched against that item's code, never "a word that
  looks like a code". **A placeholder finish line is written TBC, and a
  line's CODE cell is never its words** (Max, 2026-10-13). `fabricLineWrite`
  (`bill-fabric-filing.ts`) is the one decision: no words gives a TBC with no
  value, and words that `fabricLineIsPlaceholder` calls nothing give TBC with
  the words kept. "Fabric @ Armchair" used to be a CONFIRMED COM 1 that shipped
  to BWS as written. Future confirms only: nothing stored was rewritten.
- **In-house codes are `BW-<short code>-nnn`** (`projects.finish_code_prefix`,
  set on the project's details; `BW-F-nnn` where none is set). Minted under the
  project row lock as before. Changing the short code starts a new series and
  renames NOTHING — a code somebody wrote down keeps its meaning (the variant
  letter rule). Whether a code is ours is still `code_origin`, never the prefix:
  a client schedule printing `BW-AMB-002` is a client code. Still never
  exported (`composeFinishCell`).
- **A fabric line's picture is its code's swatch, filed at confirm**, only
  where every pictured line of that code carries the SAME picture (content-
  addressed) and the code has no CURRENT swatch. Differing pictures file none
  and the confirm names the code; an existing swatch is never replaced. The
  filename `bill row N.<ext>` is where the source survives, the
  `swatch-page-N.png` rule.
- **"This row's picture" is ONE function**, `effectiveRowImage`: a person's
  crop or "no picture" on the review (stored on the staged line, version-
  checked) or else the bill's own. The thumbnail, the item picture at confirm,
  the swatch rule and its review sentence all read it.
- **An item picture is superseded, never deleted, and a drawing never
  displaces a bill's picture on its own.** The drawings confirm used to DELETE
  the record's `item_image` — against 0013 — which also threw away the photo a
  bill printed beside the item. Over a bill picture the crop is stored as an
  `item_image_alternative` and the record offers it ("Use the drawing's
  picture"), and the reverse; the swap (`/api/records/[id]/image/choose`) is a
  `manual_edit` change set and a version. Every reader takes the CURRENT row
  (`superseded_at is null`). Where a picture came from is DERIVED from its path
  and filename (`itemImageSource`), and the record's caption says it.
- **BW's own finish is set ONCE PER CODE in the library**, never per item.
  `standardInForce` is the one answer to "what ships": a spec linked to a
  finish takes the FINISH's standard — and ships none if the finish has none,
  because falling back to an older per-item choice would be the override Max
  ruled out; an unlinked spec keeps 0041's per-item standard. The per-item
  route refuses a linked spec (`standard_on_finish`). The list a code offers is
  read from the BWS fields its items sit in, then its kind, else none in words
  (a COM field has no BWS palette); never an "Other…" — it is BW's own range.
  One act recomposes and versions every record carrying the code
  (`carryFinishToItems`, shared with `editFinish`). Snapshots carry it (atoms
  schema 9 since 2026-11-06, 8 before); versions from before 0045 show the
  item's own standard, because that is what shipped then.
- **Slots are unchanged**: two timber or metal codes on one item fill Main,
  then 2, then 3, in the order the bill lists them (Max, same day).

- **ONE PLANNER decides every finish line, and the confirm executes it**
  (`planBillFinishWrites` and `billFinishPlanInputs` in
  `bill-fabric-filing.ts`, audit C5, 2026-11-06). The review GET describes the
  plan (`planBillFabrics`); the confirm plans every line once, under the lock,
  before any write, and `writeFabricLine` decides nothing — a planned finish id
  resolves to the row the confirm created for it, and a slot found taken after
  all is `finish_plan_stale`, a sentence, never the unique index's 500. Before
  this the confirm re-read the held finishes per line, INCLUDING the rows it
  had written earlier in the same confirm, so the second fabric of one kind on
  a carried item found the first held and refused the whole bill as
  `fabric_changed` while the review showed "→ COM 2": the `proposalBlockers`
  rule broken. The refusal is now: a finish the record held from the bill
  BEFORE this confirm that none of the revision's lines of that kind for the
  item states; a NEW finish of a held kind takes the next free slot; an item
  given no line of a kind is not refused, because a held fabric may be a
  description cell's, which a revision never re-writes.
- **A deferral is a placeholder** (C11). `fabricLineIsPlaceholder` also strips
  `DEFERRED_TO_SOMEBODY_PHRASES` (`spec-vocab.ts`: "to be selected by client",
  "client to select", "by others", "by ID", "designer to confirm"), so such a
  line is never minted as ONE in-house code that every later undecided fabric
  then links to — the merge the placeholder rule exists to prevent.
