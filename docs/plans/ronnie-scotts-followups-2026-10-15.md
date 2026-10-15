# After Ronnie Scott's: the plan (2026-10-15)

Max answered the questions in `catchup-2026-10-15.md` on the evening of
2026-10-15. This plan turns those answers into work. Each workstream says what
is decided, what changes, in which files, what "done" means, and what must not
break. The facts below were checked in the source and, for the categories, in
pilot's database (read-only) that evening.

**Already done or running, so not in here:**

- `dfed295`: the SH line, the `DIA X` line and the Confirm reason (recap plan
  items 1–3).
- The session *Blockers that highlight and direct, not explain* (recap items
  6–9): the replace box's wording, "another page" meaning the bill, "Correct",
  and one "needs you" list on the bill review and the drawing card. **Workstream
  E below waits for it**, because both edit the same review components.

**The rule over all of it** is Max's direction of the same day. A blocker is
highlighted where it is and names the next step in a few words, and the detail
is one click away (CLAUDE.md, the 2026-10-15 milestone paragraph).

---

## Max's answers

| Q | Answer (Max, 2026-10-15) | Becomes |
|---|---|---|
| Q1 PDF bills | **Yes.** "At some point that's going to need to happen" | Workstream C |
| Q2 categories | **What pilot holds for P16717 is correct; make it automatic next time** | Workstream A1 |
| Q3 fabric on a code on two lines | **Apply it to both. No tick boxes** | Workstream B |
| Q4 cheat-sheet categories vs the business | **Leave it, but flag it.** May come back to it | Logged below; not built |
| Q5 three packages as three phases | **Fine this time, "almost good"**, but people need more control over creating phases and putting items in them. "Technically these are all in the same phase, and those are actually just categories" | Workstream F (design first) |
| Q6 whole Finish cell into a BWS field | **Leave as is for now.** Add a **trim** kind, which was missing | Workstream A2 |
| Q9 field names | **Change "Main metal finish" → "Metal finish 1"** (and "Main timber finish" → "Timber finish 1"). Matthew asked for both in part 2 at 26:56–27:07. That is checked | Workstream A3 |
| — | **Intake should focus on TGQ**, without missing price-critical things such as fittings and brass feet. "I don't think it's too bad at the moment… everything else is folded down". **Think about it; do not implement now** | Workstream G (notes only) |
| — | **The dimension menu is "a nightmare"**. In both the bill's expanded line and the drawing card, only some figures offer a slot. "At its core, it's good how it doesn't show and then it expands… It's just when it expands, it's quite complex" | Workstream E |

Still unanswered: Q7 (where a supplier's website link goes), Q8 (one material
on three lines of a drawing as one finish), Q10 (same as Q6, so left as is).

---

## Why the model does not just read the PDF

Max asked this directly. **Nothing technical stops it.** The model reads every
drawing as a PDF today. Three things stand in the way, and the order below is
the order of how much they matter.

1. **A rule, set by Max on 2026-09-23: on a bill, the model reads the
   STRUCTURE and code reads every CELL.** A bill is 100–300 quantities and
   codes that go straight into a quote and into BWS. If code copies a
   spreadsheet cell, the copy is exact. If the model transcribes it, each line
   is a chance to mis-copy, and a mis-copied quantity (14 → 41) or code
   (`CH-03` → `CH-08`) looks exactly like a real one. Nothing downstream
   questions it. That is the "plausible wrong answer" failure this app exists
   to prevent. A drawing is different. The model reads a few values a page,
   and a person checks each one against the page on the card.
2. **Size and time.** The bill's own specification read of 101 lines took
   65,057 output tokens and 499 s, two thirds of the 740 s model deadline.
   Transcribing every cell of a 300-line PDF bill in one call does not fit.
   It has to be split by page range, which the spreadsheet read already does
   by rows (`extraction-windows.ts`).
3. **Everything after the read works on rows.** Fabric lines attach to the
   row above. Layouts match headings. Pictures come from cells. A revision
   pairs by row and code. A PDF read has to produce the same staged rows,
   with a page in place of a sheet row, or every one of those breaks.

So the plan (Workstream C) takes two routes. **First**, a PDF that has a text
layer is read by CODE, exactly. Ronnie Scott's PDFs were printed from Excel,
and `npm run pdf:schedule` already reads them this way with no model. **Only
when that fails**, the model transcribes. Every line it writes is marked as
transcribed, with its page, and is cross-checked wherever the PDF lets code
check it. Transcription changes the rule in point 1 for that one case, so it
is Phase C2, and it waits for Max to say yes to the CLAUDE.md change in
writing.

---

## Workstreams, in order

### A — Small and decided (one session, one commit each)

**A1. The categories go in by themselves next time.**

Pilot's P16717, read 2026-10-15. The item NAMES the matcher saw (it matches
on the name only, `boq-stage.ts` `loadLineSuggester` → `matchName`), the
bill's own category column, and the category a person set:

| Item name | Bill's category column | Set on pilot |
|---|---|---|
| POUFEE (sic, ×3) / POUFFE | SEATING - POUFEE | Armchairs Benches Stools Sofas |
| LOUNGE TABLE (×10), TABLE | TABLE - LOUNGE | Dining tables |
| BAR HEIGHT TABLE | TABLE - TALL / BAR HEIGHT | Dining tables |
| DINING TABLE | TABLE - DINING | Dining tables |
| GREETER | CASEGOOD - GREETER STATION | Drinks Cabinets Service Stations |
| DJ TABLE | CASEGOOD - DJ BOOTH | Drinks Cabinets Service Stations |

- Seed `item_category_aliases` (db/seed/0004) with `Pouffe`, `Poufee` (the
  bill's own spelling, kept because it is verified wording), `Lounge table`,
  `Bar height table`, `Greeter`, and `DJ table`. Each gets a comment citing
  this bill. Also seed `DJ booth` and `Greeter station`, since the bill's own
  category column uses those words (see A1b).
- **`Lounge table` → Dining tables carries the Q4 flag** in the seed comment
  and in `found-in-use.md`. Here a lounge table is 710 high, which is dining
  height. A low lounge table on another project will now land in Dining tables
  rather than Side Coffee Bedside Tables. The category is still a suggestion
  the reviewer sees, so the cost is one correction, not a wrong record.
- **DECIDED (Max, 2026-10-15): `Pouf` moves to Armchairs Benches Stools Sofas
  too.** The seed had mapped `Pouf` → Ottomans Storage boxes, this repo's own
  judgement on 2026-09-30 for the Aman bill ("no back"), never confirmed by
  Matthew. A term maps to ONE category, so `Pouf` and `Pouffe` on two sheets
  would contradict each other, and Matthew's placing of a pouffe is the only
  answer a person at BW has given. The seed's 2026-09-30 comment now says so.
  Records already confirmed are not touched.
- **Found while building it: a name written `<item> @ <where>` is matched on
  the item** (`suggestCategory`, `boq-stage.ts`). With `Lounge table` a term,
  the Aman bill's nine "Side Table @ Lounge" / "Coffee Table @ Lounge" lines
  tied Dining tables with Side Coffee Bedside Tables and went back to a
  person. What follows the `@` is a place or a part, never the item. Measured
  with `npm run boq:gap -- <folder> --categories` (new): on Aman only the two
  `Pouf @` lines move (the decision above); on bills-1006 nothing moves; on
  Ronnie Scott's every line is categorised except the one named only `TABLE`,
  which ties four sheets and needs A1b.
- **A1b (code), only if Max wants it:** when the item's name matches nothing,
  try the bill's own category column (`boq_category`, already staged). Ronnie
  Scott's names its lines `TABLE` and `GREETER` but categorises them `TABLE -
  LOUNGE` and `CASEGOOD - GREETER STATION`. Whole-term matching only, the
  same as the name. Measure with `boq:gap` on Aman and bills-1006 before and
  after; neither result may change.
- Done: re-stage the converted Ronnie Scott's workbook on the local stack and
  every line arrives categorised, with no click. The vocabulary test passes,
  and `db:seed` is re-run on sandbox and pilot (Max's step).

**A2. A `trim` finish kind.**

- Migration `0049`: re-list `project_finishes_kind_check` **from the LIVE
  constraint text** (the 0032 lesson), adding `trim`. Add it to `FINISH_KINDS`
  and `FINISH_KIND_LABELS` (`finishes.ts`), and to `suggestFinishKind`
  (`finish-kind-guess.ts`). The bill's `TR`/`F-TR` prefix and the word "trim"
  suggest it, never write it. Add it to the finishes-schedule review's kind
  picker. `tests/db/vocabulary-sync.test.ts` must pass.
- A trim still fills no BWS field. `billFinishLineKind` already writes a trim
  line with no field, and that does not change.
- Done: TR-01/TR-02 on the Ronnie Scott's COM list suggest *Trim*, and a
  click files it. Migrate before seeding on sandbox and pilot (Max).

**A3. "Timber finish 1" and "Metal finish 1" on every screen.**

- **The BWS name does not change.** `spec_fields.name` is BWS's register
  (`external-vocabulary-sync` skill), and `name_norm` is what a document's
  own label is matched against. A drawing saying "main metal finish" must
  still land there. The export's 109 headers are a static constant in
  `bws-export.ts` and stay BWS's.
- Add ONE display-name function (a small map in `spec-field-label.ts` or
  similar: json_id 4 → "Timber finish 1", 5 → "Metal finish 1"). Every screen
  that prints a field name calls it: the record, the drawing card, the bill
  review, the checklist, infill, chase and the finishes library. The check
  sheet prints both names (`Metal finish 1 (BWS: Main metal finish)`),
  because it is read against the BWS file.
- Done: `grep -rn "Main metal finish\|Main timber finish" src/components`
  finds nothing outside the map, and a test asserts the map's ids exist in
  the register.

### B — A fabric line names a code on two lines: it goes on both (decided) — BUILT 2026-10-15

Built as below with two narrowings, both found by measuring: a twin that has
its OWN finish lines takes none from another (read literally, the rule put the
salon CH-02's cloth on the members-bar CH-02 beside its own, and moved Aman's
GR-FUR-22 and PL-FUR-04), and the model's reading of where a line sits is
position, not naming (an `N/A` "Fabric @ Sofa" under OPTION 2 stays there).
Over the 391 finish lines staged on the local stack, only FB-CH-03 moves.
`found-in-use.md` has the detail.

- Today a COM line whose code names an item on two lines of a phase (CH-03,
  SALON ×2 and PDR ×12) attaches to the nearer one above and is flagged
  (`boq-row-kinds.ts`, `confirm-boq.ts` `writeFabricLine`,
  `bill-fabric-filing.ts`). **New rule: it is written to every line in that
  phase carrying the code.** Each gets its own attribute, in the next free
  slot of its kind, so two items can land on different COM numbers.
- **Where it applies:** only where the fabric line NAMES a code (its bracket,
  its FF&E code, or the model's parent reading resolving to a code). The
  layout rule "an FBX- line is fabric for the nearest item above" (Aman's
  `row_rules`) does not name a code and is unchanged. **It does not touch
  SX11A**: an ITEM line pairing at revision still refuses an ambiguous code.
  This rule is about a fabric line's targets, not about which record a bill
  line is.
- The review row says it in words: "for lines 17 and 18 (CH-03, both)". The
  confirm and the review GET call one decision, the `decideBillFinishSlot`
  rule, so the arrow is the write.
- Measure first and after: `npm run boq:gap -- <aman, bills-1006> --golden`
  and the description plans. Name any line that moves. Aman has codes on two
  lines of one phase (PL-FUR-04, GR-FUR-22, GR-FUR-26). **Not yet checked:**
  whether any Aman fabric line names one of them. If one does, it now goes on
  both, which changes a real bill, so Max sees the list before it ships.
- Done: the converted Ronnie Scott's workbook confirms FB_04 onto both CH-03
  records. That is a db-tier test with a synthetic bill, with no client
  wording in the fixture. Pilot's P16717 was confirmed before this, so its
  salon CH-03 still needs the fabric typed or the bill re-read (Max).

### C — PDF bills (decided: yes)

**C1. A PDF with a text layer is read by code (no model, exact).** — BUILT 2026-10-15

Built as below (`src/lib/pdf-bill.ts`; the run's source is the workbook, the
PDF a second attachment, each line's page on the staged document as
`pdfSource`). Measured on the local stack: the three real PDFs stage 28, 16 and
3 lines, every staged field equal to the hand-converted workbook's (575 of
575), and confirm. Three things were found by running the real files:

- **The fast model files these PDFs as FF&E SCHEDULES, certain.** Their pages
  say "FF&E SPECIFICATION"; "Procurement Schedule" is only in the filename.
  Telling the classify prompt "a procurement schedule is a bill" did not move
  it (measured, then reverted). So where the model names another schedule and
  the PDF's text reads as a bill's table, the row is HELD in amber: *"Read as
  an FF&E schedule, but its text is a table of 28 lines with a quantity on
  each: if it is the bill, choose Bill of quantities."* A person picks Bill
  (one select, or the bulk control). Neither reading wins on its own (house
  §5/§6), and nothing is registered or charged until they do.
- **A spec sheet's "QUANTITY : 2" over a drawing read as a three-line bill**,
  and the merged Panther preamble's prose ("quantities and dimensions supplied
  by…") as a two-line one. A header now needs two more headings the registers
  know whole, and no prose line in its band. Checked on 47 real PDFs that are
  not bills (Aman, Panther, bills-1006) and the 26 Ronnie Scott's sheets and
  COM list: none reads as a bill.
- The phase is named after the PDF (`261013_RONNIE SCOTTS_Procurement
  Schedule_ST4_MIRRORS`), where the hand-converted workbook's tab said
  `MIRRORS`. The reviewer edits it, as for any bill.

Still true: pictures are not carried (said on the review's header tip); a
header with fewer than two headings the registers know, besides its quantity,
is refused rather than handed to the model's structure read; a section row
with no quantity of its own is merged into the nearest line.

- Promote `tools/pdf-schedule-to-xlsx.ts` into `src/lib/pdf-bill.ts`. It
  places columns by the header's label positions and anchors rows on the
  quantity column. The tool's own limits stay true and get stated on screen:
  pictures are not carried, and it works on PDFs PRINTED FROM A SPREADSHEET.
- At classify: a PDF the classifier is CERTAIN is a bill (today `BOQ_AS_PDF`,
  refused) is read by `pdf-bill`. If that gives a header and rows, the
  workbook it builds is stored beside the PDF. The run registers as a bill
  from it, and from there everything is the ordinary bill path: Columns panel,
  model structure read, review, confirm. The review header says *"Read from a
  PDF by its text: check a few lines against the PDF"* and links to it. Each
  line carries its PDF page, the way a sheet row carries its row number.
- If it fails (no text layer, no header found, rows that do not anchor), the
  bill is held with that reason in one sentence, which is today's state,
  until C2 exists.
- Several PDFs of one tender (upholstered / casegoods / mirrors) upload as
  several bills, each a phase. That is today's behaviour and Max's "fine this
  time". Workstream F is the control over it.
- Done: the three real Ronnie Scott's PDFs upload as they are, with no Excel
  conversion by hand, on the local stack, and stage the same lines as the
  converted workbook did (compare with `boq:gap`). `pdf:schedule` stays as a
  read-only tool. CLAUDE.md's *Explicitly excluded* line comes out, and the
  bill section gains "a PDF bill is read by its text layer".

**C2. Otherwise the model transcribes, as a marked exception. APPROVED by
Max, 2026-10-15, in writing:** *"a PDF bill with no usable text layer may be
transcribed by the model, every line marked transcribed with its page and
checked by a person. Add C2 to the queue after C1."*

- For a PDF with no usable text (a scan, or a designer's laid-out sheet):
  the model reads it in page windows into the SAME staged row shape. **Every
  line is marked transcribed**, with its page and a link to it. Code checks
  what it can: printed totals against the sum of quantities, and each code
  against the PDF's text where there is any. A line that fails a check is
  red.
- CLAUDE.md gains the exception in so many words: "a bill is read by code;
  a PDF with no text layer is transcribed by the model, every line marked,
  and a person checks it against its page". The confirm is not changed, so
  the human review stays the gate.
- Starts after C1 is on staging, because it reuses C1's route into the bill
  pipeline. It is queued, and the rule change is approved.

### D — Data on pilot (Max's, Claude cannot write pilot)

P16717 was confirmed before `dfed295` and B. Before Matthew relies on its
numbers:

- SO-03, SO-04, SO-01, CH-02, CH-03 and CH-05 have no SH. Type it on each
  record ("Add a spec by hand", Seat height 420 mm etc.), or promote the fixes
  and re-confirm the bill as a revision.
- The SALON CH-03 has no FB_04.
- TB-01C and TB-05C have no H (710). With the fix, the review now asks which
  slot. Type it, or re-confirm the bill.

### E — The dimension menu, reworked (after the Blockers session lands)

Max: "it's just a nightmare using that kind of menu". Matthew: "you kind of
expect to read across… it's like a table" (part 1, 24:43). The fold-then-expand
is right. The expanded view is the problem, on the bill review AND on the
drawing card.

- **One shape, for every figure the line or page reads, as one row each:**
  the figure as printed, then ONE slot picker (`W · D · H · SH · Dia ·
  note`), then what it becomes (`W 3500 mm`). **Every figure gets the
  picker**, including the ones that are notes today. "Only three of the four"
  is exactly what this ends. The composed cell (`W3500 x D900 x H710mm`) sits
  large at the top, labelled *what BWS receives*. *As printed* is labelled as
  the DOCUMENT and goes underneath, never in a column beside it that reads as
  output.
- Rules unchanged: no slot is guessed (an unlettered figure starts as a
  note), never two values on one slot (picking a held slot moves the other
  figure to a note in the same write, the `swapSlot` rule), and one composer.
- **Mock-up first.** Two frames, the bill line and the drawing card, drawn to
  `docs/design-language.md`. Max signs them off before code (the `new-screen`
  skill). Walk them with the TB-08 and SO-03 cases.
- Done: the TB-08 drawing card and the SO-03 bill line can each be set with
  one click per figure, `tools/overflow-audit.mjs` is clean, and Max has
  walked it.

### F — Control over phases (design only, now)

Max: three packages as three phases is "almost good", but "there should be an
option… a bit more control over creating phases and assigning things to
phases… technically these are all in the same phase, and those are actually
just categories."

Two controls, to be designed before anything is built:

1. **At bill review: "these tabs are one phase".** Several sheets (or several
   PDFs) confirm onto ONE `spec_runs` row, and the sheet becomes a grouping on
   the line, not a phase.
2. **After confirm: move a record to another phase**, as a change set with a
   reason, the way a retire is.

The trap to design against: a phase is a SUB-QUOTE and the export's scope
(CLAUDE.md, *A BOQ tab is a PHASE*). Moving a record moves it between export
files, and a code on two lines of one phase is SX11A. **Nothing is built
until Max has seen the two controls drawn.**

**DRAWN 2026-10-15:** `docs/design/phase-control-mockup.html` (two frames) and
`docs/plans/phase-control-design-2026-10-15.md` (the rules, and four
questions for Max, P1–P4).

### G — An intake that aims at TGQ (thinking, not building)

Max: the first intake should let the reviewer confirm what TGQ needs:
"dimensions, get a picture, finishes, things like fittings". But it must not
miss things that matter to the price, like fittings and brass feet, and he
judges "it's not too bad at the moment… the key stuff goes in, and then
everything else is folded down". Matthew said the same in part 2 (59:22):
"only qualify the bits you need for TGQ… but keep all the other information".

Notes for when it is picked up, not a design:

- **The TGQ list already exists per category** (`spec_field_gates`, Matthew's
  matrix, and `itemTgq`). The drawing card and the bill line could sort and
  fold by it rather than by "is it a dimension". TGQ rows open, everything
  else folded with its count. That is a display change, and the data model
  does not move.
- The risk Max named is a price-critical thing that is NOT a TGQ field. If
  brass feet are not on the TGQ list for a category, folding by TGQ hides
  them. So "folded" has to keep showing a one-line summary of what it holds
  ("3 finishes, 1 hardware, 14 notes"), and **a finish or hardware row is
  never folded**, whatever the list says.
- Wait for Matthew and Claudia's item-review design (2026-10-12). This is the
  same idea from the intake end.

---

## Flagged, not built

- **Q4:** are the seventeen cheat-sheet categories the ones BW uses? Lounge,
  bar and DJ tables had no home of their own. The A1 aliases put them where
  Matthew put them; `found-in-use.md` keeps the flag.
- **Q6:** a whole Finish / Reference cell (`LOUNGE CYMBAL TABLE — ROUND BRONZE
  ANTIQUE BRASS`) is still written into a BWS field, as decided.
- **Q7, Q8** wait on Matthew.

## Suggested order

1. **A1 + A2 + A3**: one session, no design. A2 is a migration (Max applies
   it).
2. **B**: one session. It changes three Aman fabric lines, so Max sees the
   list before it ships.
3. **C1**: one session. It needs the three real PDFs on the local stack.
4. **E**: after the Blockers session commits. Mock-up first.
5. **F**: a design note and two drawn frames for Max.
6. **C2** and **G**: when Max says.

A, B and C1 touch different files and can run side by side. E must not run
beside the Blockers session.
