# The four outputs

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### The field grid is a screen layout, never a file layout

`docs/bws-spec-grid.md`, `src/lib/dimensions.ts`, `src/lib/bws-export.ts`

Matthew's grid re-orders the 109 export columns into colour blocks and shows
only the fields one project needs. It governs how screens group fields, and it
is **not** a description of the file. Applying it to the export — reordering the
columns, or emitting only the 36 — produces an import that wipes the 73 it left
out: the same trap as a filtered export, on the most dangerous file in the
product. The blocks therefore never *filter*; a field outside the grid still
appears, because a field nobody can select is a spec value nobody can record.

The one thing the grid does govern is **how a value is written**, and the
dimension rule is the load-bearing one: `W*** x D*** x H***mm`, millimetres,
unit once at the end, `SH***` appended, `Dia.***` replacing `W x D` on a round
item. `composeDimensionCell` is the single implementation — the export, the
record screen and the drawings review all call it, because a second one is how a
screen starts promising what the file does not deliver.

It **refuses to emit a number it could not derive**. A figure with no unit, or a
value like "approx 720-740", renders verbatim outside the millimetre group in a
bracket saying why. A guessed conversion looks exactly like a real measurement.
The cell is a SUMMARY; the long-form sheet carries every original value, unit,
slot and page, which is what makes a converted `W1900` re-checkable against a
page that says 190.

**A person's ONE qualifier for the whole cell is a record column, composed by
the same composer** (`spec_records.dimension_note`, 0034, Stage 2 item 2.6,
2026-09-20). Matthew: *"1250 bracket L-shaped return"*. `composeDimensionCell`
takes it as its second argument and renders it LAST, `W1830 x D880 x H760 x
SH440mm (1250 L-shaped return)`, so the export, the quote's DIMS line, the
costing sheet's `Tags`, the record screen AND the checklist's Dimensions answer
(`planAnswerFills` reads the note; `editRecordDetails` recomposes when it
changes) all show one cell. It is NOT 0029's per-attribute placement — four
slots off three pages could carry four of those — and it is never an
attribute, because it has no page. One line, 200 characters, refused by the
route in words and by a CHECK; a note with no dimensions behind it is the
bracket alone with a `note_only` problem and writes NO answer, because a
sentence must not stand where a measurement goes; and `hasFigure` is read off
the figures WITHOUT the note, or "1250" in a note would confirm a TBC width.
The check sheet prints it in the Qualifier column, apart from the figures.

`Dia.` beside a `W` or `D` is a **conflict**, caught as a computed blocker and
named on the cell — cross-row, so no check constraint can hold it and a trigger
would fire mid-fan-out naming a row the reviewer never saw.

An overall dimension printed as ONE line (`80 x 70 x 90 cm`) is read by
`parseCombinedDimensions`, and how far it infers is the load-bearing part. A
printed prefix is the page speaking and is taken exactly. **Three bare figures
are read as W x D x H in printed order** — the only inference here the page does
not state — flagged `slotSuggested` so the card badges it amber beside the
composed cell, which is what makes a transposed order obvious in a second.
Everything else gets NO slot and becomes a note: two bare figures could be
W x H, W x D or Dia x H, four or more has no convention, and a line mixing
prefixed with bare parts would let the positional half inherit the explicit
half's credibility.

### One line per cell, and formulas inert in the CSVs a person opens

`src/lib/bws-export.ts` (`oneLineCell`, `toCsv`), the four export routes

"No newline in a BWS cell" was held by a test over fixtures that carry none;
a finish description (2,000 characters, typed in a textarea), a typed answer or
a document's value can carry one, and nothing stripped it (audit F12).
`oneLineCell` folds a line break to one space in the renderers and the job
columns, BEFORE `joinQualifier`, so a `second_line` flip is never eaten; what
the document said is untouched in the database. `toCsv({ neutraliseFormulas:
true })` prefixes `'` to a cell opening with `=`, `+`, `-`, `@`, a tab or a CR
(audit A17 — cell text comes from client documents and model reads, and
`=HYPERLINK(...)` runs when the file is opened); a PLAIN NUMBER is never
prefixed, which is how the numeric columns stay numeric without a per-sheet
list. The check sheet, the quote and the costing sheet pass it. **The BWS CSV
does not, deliberately:** it is imported, not opened, a leading `'` would
reach a BWS field, and what Tim's new importer does with a formula-like cell
is unknown until his column contract is in writing. The check sheet's "Client
specified" column uses `valueCarriesItsUnit` like every other display path,
and the quote's answer goes through `renderAnswerValue`, so neither can drift
from the file.

### The export and its check sheet load ONE scope

`src/lib/export-scope.ts`, `src/lib/export-check-sheet.ts`,
`src/app/api/projects/[id]/export/check-sheet/route.ts`,
`docs/plans/export-verification.md`

"Judged flawless by a human, read line by line against the pack" had no
artefact behind it. The check sheet is one line per record × field, each naming
the document and page its value came from, with **Pack says / Verdict / Note**
left empty for the reviewer. An empty Verdict column is the point: a sheet that
arrived pre-answered would be the app agreeing with itself.

Three things about it are load-bearing:

- **It is never filtered, for the reason the export is not.** A sheet covering
  a subset gets signed off in exactly the same words as one covering the file.
  "Just the populated cells" is the tempting version and it removes the only
  lines that can find a value the pack states and the export lost — a blank
  cell is the failure most worth catching. The sole omission is the 27 job
  columns that are blank BY DESIGN because they hold BWS-owned vocabularies,
  and they go so that 27 unanswerable questions per record do not teach a
  reviewer to tick without reading.
- **Both files load `loadExportScope`.** A record the check sheet never asked
  about must not be a record the export shipped, or a signed-off sheet is
  worthless. One loader is what makes that true rather than intended.
- **Provenance comes from the composer, not from beside it.**
  `composeRowCells` returns each cell with where it came from and `composeRow`
  is that list mapped to strings — one set of precedence rules, two views. A
  second copy is how a check sheet starts vouching for a value the file does
  not hold, which is the `composeDimensionCell` rule again.

A filled sheet holds real values off real drawings and **never enters this
repo**. What comes back is the finding — a code fix, an alias seeded from
verified wording, or a dated line in `docs/plans/README.md`.

### The quote file fills eight of twelve, and names the four it will not

`db/migrations/0031_bws_boilerplates.sql`, `db/seed/0010_bws_boilerplates.sql`,
`src/lib/quote-lines.ts`, `src/app/api/projects/[id]/export/quote/route.ts`

The second of Matthew's three outputs. It is **not** the BWS file: the
109-column export REPLACES a job's fields on import, which is why it refuses to
be filtered; this is a list of quotable lines with the specification written
out for a person to price. It shares `loadExportScope` and nothing else, so a
quote cannot cover a different set of records from the file.

- **Four columns stay blank and the screen says why.** There is no pricing
  anywhere in this app — no rate, no labour model, no material cost — and a
  generated number would be the first figure in the product nothing downstream
  could question. The UUID is BWS's; an item picture is a private blob BWS
  cannot fetch.
- **Nineteen of the real file's 57 lines cannot be generated at all** —
  interliner, stone, mattresses, delivery. The interliner line's quantity is
  the fabric METREAGE, and `composeFinishCell` deliberately does not hold it.
  Said in words on the screen rather than emitted as a row somebody prices off.
- **The Specification block uses the SAME composers as the export.**
  `composeDimensionCell` writes the DIMS line and `renderAttributeValue` the
  rest. A quote saying `W2860` where the BWS file said something else would be
  found by a client rather than by us. The labels are normalised: his own file
  writes `COM1`, `COM 1` and `COM` for one field.
- **An AMBIGUOUS product code derives nothing.** Matthew's rule is "MF1 or MF2
  populated → with-Metalwork, otherwise Simple", and the register is seeded
  from the 2026-09-14 capture — 18 of the 25 ids in his real quote match it
  exactly. But our `armchairs-benches-stools-sofas` is ONE sheet receiving
  three of his nine codes, so taking the first handed a **sofa the armchair
  boilerplate**. More than one code now derives nothing, the same rule as
  `findRecordsByRef` offering candidates and picking none. A blank is a visible
  gap; a wrong code prices the item against the wrong template.
- **"Populated" excludes a non-answer.** A metal finish recorded as `TBC` or
  `None` does not move an item onto the metalwork boilerplate and a different
  price. This repo's reading, and a question for Matthew.
- **None of the nine seating families has a Hero boilerplate**; six cabinetry
  families do. His rule says nothing about a hero sofa because there is no hero
  sofa code. Also a question for him.

### The costing sheet is TEN columns of eighty-three

`src/lib/costing-sheet.ts`, `src/app/api/projects/[id]/export/costing/route.ts`

The third of Matthew's three outputs, built 2026-09-18 against his skill.md,
its user guide and a REAL COMPLETED SHEET (Maybourne Paris seating, 69 items).

**The blocker this repo had recorded was the wrong one.** `matrix-assumptions.md`
said the costing sheet was blocked on the skill.md because "the app holds no
price of any kind and will not generate one". The skill generates no price
either: it adds page links, crops photos, converts imperial to metric and
deletes blank rows. Pricing was never what stood in the way.

`Estimating Sheet Template - with stone.xlsx` is 83 columns. A-J identify the
item; K rightwards is three identical estimator blocks whose median is taken,
then a stone block. **This export stops at J**, and that is the design rather
than a gap:

- **Emitting all 83 would produce a sheet that looks like the estimating sheet
  and prices nothing.** The template's value is its FORMULAS — exchange rate,
  multiples, GP targets, the median across three estimators — and this app
  holds none of the rates behind them. 73 empty columns where an estimator
  expects formulas is the plausible-looking wrong answer wearing a familiar
  layout. The BWS export's complete-or-nothing rule does NOT apply here: a BWS
  import replaces what it is given, and nothing imports the costing sheet — a
  person pastes into it.
- **A-J is contiguous, which is what makes the narrow file the useful one.** It
  pastes in as a block and columns K onwards keep their formulas. B is the
  template's own spacer and stays empty, or everything lands one column across.

**`Tags` carries the composed dimensions, and that is the point of the export.**
On the completed sheet that column holds a few real tags (`dining chair`) and,
on every other filled row, a measurement somebody pasted out of a drawing or a
designer's website: `Height: 91 cm\n- Width : 110 cm\n- Seat depth: 102cm`,
`H800mm x D635mm x W700mm SH480mm.`, `H 93 - L 47 - P 56 cm - seat H-53cm which
reduces by 3/4cm when seated`, `58 x 36 x 43cm`. Every trap the dimension model
exists for is in those four lines — cm and mm in one column with nothing saying
which a row is, `L`/`P` for longueur and profondeur, a qualifier welded to a
figure, and a bare triple whose order is an assumption. It is there because the
sheet had nowhere structured to put a size. `composeDimensionCell` is still the
single composer, so the figure an estimator prices against is the same one the
BWS file ships. **This is this repo's judgement, not Matthew's instruction, and
the file says so on its own second sheet.**

Four more things are load-bearing:

- **The links point at THIS APP'S copy, not SharePoint.** The app holds the
  document and `/api/imports/[id]/source` streams it inline with range support,
  so `#page=N` works. Where the file also sits in SharePoint this app has never
  been told, and composing a URL from a filename would resolve to a 404 or, far
  worse, to a different revision of the same drawing. The skill's own guide
  spends a page on getting that URL right, which is the cost of not holding the
  document.
- **NO PAGE MEANS NO LINK.** A hand-typed spec carries no source run and no
  page, deliberately. A link opening a document at page 1 to stand in would be
  a false provenance rather than a missing one.
- **Which page to link is COUNTED, not picked.** The (document, page) that
  accounts for most of the record's attributes goes first, ties breaking on the
  lower page so the order is stable between exports — an estimator who wrote
  down "Specs opens page 7" must not find it opening page 11 next week.
- **The quantity is never apportioned**, the 0024 rule in a fourth place, and
  the notes say how many rows it left blank.

The notes go IN the file, on an "About this file" sheet, not only on the screen
that produced the download: a caveat that lives on the screen is one nobody
reads at the moment it matters, which is when somebody opens the workbook next
week and wonders why column K is empty.

**Verified against the sandbox, 2026-09-18**, not fixtures: AP364c MAIN RUN
composed 19 rows with 11 carrying dimensions off the real shop drawings
(`S-100 W1900 x D790 x H720 x SH440mm`, and `S-400 W570 x D493 x H473 x SH358mm` —
**which was WRONG**: checked against the page 2026-10-04, S-400 is W570 x D460 x
H493; 473 is to the cushion edge and 358 is between the legs),
11 links into the real pack, 11 pictures, and `S-201 Armchair (A)` correctly
carrying a blank quantity. **`Specs 2` has never fired against real data** — no
record in the sandbox is yet specified across two pages — so it holds unit
coverage only.

**STILL OPEN:** what `Specs 2` should point at on the real sheet (a second
drawing set? the designer's own sheet?), and whether Matthew wants `Tags` to go
on receiving pasted prose once the app composes a real cell there.
