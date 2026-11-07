# Drawings and the model read of them

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### A page code that is the END of a bill code, and a tag drawn as boxes

`src/lib/record-refs.ts` (`endsOnSegment`, `namesOnSegments`),
`src/lib/drawing-document.ts` (`resolveDrawingTargets`, `resolveStagedItem`,
`drawingNumberOf`, `alreadyRecorded`), `src/lib/material-words.ts`
(`stackedTagCode`, `projectCodeKind`)

The Aman drawings title each item by its FAMILY code — `BEDFRAME FUR-08`,
`SOFA (KIDS BED) FUR-03 B` — while the bill carries `GR-FUR-08`, `PL-FUR-08`
and `PL-FUR-03B`, so neither real card matched a record (2026-09-30). **Only
where nothing matches exactly**, a bill code whose printed segments END with
the page code is a candidate (never `GR-FUR-08A` for `FUR-08`). One candidate
resolves; several resolve only when the run's drawing number (its stored
filename, `AM-ID-PL-FUR-08 Bed frame`) names exactly one whole; otherwise
every phase is ambiguous and nothing is suggested. The card says how it
matched, in amber. `resolveStagedItem` is the only call the screen and the
confirm make, so `targets_changed` still holds.

**A tag drawn as stacked boxes is its code.** The drawing prints `GR / FAB /
04` in three boxes and the model writes `GR FAB 04`; exactly that three-group
shape, anchored to the whole value, is read into `materialCodeRaw` as
`GR-FAB-04` at read time, so it files as the SAME finish the bill created and
lands on COM 1 as "already recorded — the same finish", never a second COM.
`value` keeps the drawing's words and `normaliseFinishCode` stays case and
whitespace only. A three-part code's kind is its middle group, read after the
prefix test.

**A converted figure and the bill's millimetres are compared in whole mm**
(`alreadyRecorded`), the precision the cell writes: `6'-4"` is 1930.4mm and
the bill's `W 1930` is the same width; compared unrounded, the card asked to
replace 1930 with 1930. And a value printing its own foot or inch mark shows
no second unit (`valueCarriesItsUnit`, every display path), or `7'-3"in`.

**Every code the item gives is tried exactly before an ending is read, and a
later exact match IS the answer** (`resolveByLaterCodes`, audit D6,
2026-11-06). A v4 read lists the title code `FUR-08` before the drawing
number's `PL-FUR-08`, and the resolver returned an EMPTY resolution when any
later code matched exactly, so the item read "No record carries this item code
yet" where the code-end step alone would have placed it. Two of an item's
codes naming DIFFERENT bill lines are offered and none is chosen
(`matchedBy.kind = "several_codes"`, one pick per phase), never the first.

### One drawing, several runs: the item card is the unit of commit

`src/lib/drawing-document.ts`, `src/lib/confirm-drawings.ts`

There is ONE drawing of `S-100`, and the mock-up, main and VE runs all quote it.
So a code matching one record **per run** is a FAN-OUT and the confirm writes to
all of them; the reviewer unticks a run whose spec genuinely differs. The same
code matching TWO records in ONE run is the `SX11A` case and stays **ambiguous**
— candidates offered, nothing chosen. A matcher that ignores runs cannot tell
those two apart, which is why grouping by run is the whole of the function.

**The reviewer may tick ONE of those lines or SEVERAL** (2026-10-11). The Aman
bill lists `PL-FUR-11` twice in one phase — one stool in the Ambassador Suite,
one in the Presidential Suite — and the drawing's own type schedule says it is
for both. Until then `ambiguous_run` fired for as long as the phase WAS
ambiguous, whatever was ticked, so picking a line never cleared it and such a
card could never be confirmed. It now clears once any of the phase's lines is
in the ticked-minus-unticked targets, read by the screen and the confirm alike.
Nothing is ever pre-ticked: two lines with one code are sometimes two items.
A page code that is only the END of several different bill codes stays ONE
choice per phase (`oneLinePerPhase`), and the confirm refuses two there.

The card the reviewer reads is therefore the ITEM, not the record, and that is
what commits atomically. This is the same rule as "the record is the unit of
commit", not an exception to it: never commit a card somebody did not see whole.
A page written to two of its three runs looks finished and is not.

`spec_records.version` is **not** touched by any of this. An attribute is its
own row; bumping the record would invalidate every extraction snapshot and chase
coverage row taken against it, for a reason that has nothing to do with them.

**The confirm writes to the records the card SHOWED, and a replace tick
follows its row** (audit D2, D3, 2026-11-06). A drawings confirm carries
`shownTargets`, the records the card displayed from the review GET's
`ItemResolution.targets`; `confirmDrawingItem` compares them with its live
`targetRecordIds` and refuses `targets_changed` on any difference, on a
ticked or an UNTOUCHED card. Before this an untouched card took the LIVE
suggestion, so a bill confirmed in another tab that put the code on a new
phase got that drawing's specs, picture and answers unseen. A confirm without
`shownTargets` is a 400 asking for a reload, which an un-reloaded tab gets
once after deploy. A "Use this drawing's" tick names one attribute on one
record: `onRowRetargeted` (`drawing-document.ts`) is the autosave's one rule —
any change of group, slot or BWS field clears `replaces`, and a field change
also clears the BW standard; the screen never sends `replaces: []` with a
move, and a patch that sends both is refused (`replace_with_move`). The
confirm's `retireOccupant` is pinned to `replaceTargetOf(observation)`, the
slot or field the row writes; a tick that no longer names that target's
occupant is the `replace_stale` blocker, and the retire refuses it again
behind the blocker. Before this a ticked width moved to "Keep as a note"
retired the bill's W, superseded by the note, and the cell and the export lost
W silently. Files: `src/lib/drawing-document.ts` (`onRowRetargeted`,
`replaceTargetOf`, `shownTargetsDiffer`), `src/lib/confirm-drawings.ts`,
`src/app/api/imports/[id]/route.ts`, `confirm/route.ts`,
`tests/db/shown-targets.ts`.

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

### A page the reviewer will dismiss must not cost what a page costs

`src/components/imports/DrawingItemCard.tsx`, `src/lib/drawing-document.ts`

Two shapes arrive on every specification sheet and neither is a fact anybody
has to decide.

**A page with no item code is still an item.** The model is told to record an
absent reference as null rather than guess whose page it is, so a second page
of views, a legend or a cover sheet stages as a card of its own — and that card
can never commit, because no code means no resolved runs. It is therefore
COLLAPSED on arrival, to a summary line, and carries one button that ignores
the whole page instead of one Ignore per row. It is never dropped: dismissing
it is a reviewer's decision, taken once. The `no_targets` blocker and the
review screen's banner both say the true reason — confirming the bill of
quantities will never match a page that carries nothing to match on.

**The lines a sheet prints under one heading are ONE row.** The Panther sheets
stamp each line of their general conditions with its field (`REMARKS:`,
`SUPPLIER:`, `REQUIRED SUBMITTALS:`), and fifteen REMARKS rows bury the four
facts on the page a reviewer actually has to rule on. `mergeNoteBlocks` joins
them: every line verbatim, in printed order, one per line inside the value, the
heading moved to the label. It runs at staging AND at read time — the block
takes the FIRST line's id and version, so the same staged JSON merges to the
same ids on every read, which is what lets the screen, the autosave and the
confirm route agree. Same discipline as `upgradeDimensionSlots`, for the same
reason: a pack read before this existed is reviewable without re-reading it.

The test is deliberately narrow — the staging label `Note`, no unit, no slot,
no BWS field, still pending. `ARM HEIGHT 520` is also a note, and merging a
measurement into a paragraph would destroy it. The merged state is the most
cautious of the lines it joins, so one unruled line leaves the block unruled
rather than inheriting a confidence none of them had.

A note is never ASKED for a unit: nothing blocks a unitless note, so an empty
amber select beside fifteen remarks reads as fifteen unanswered questions where
there are none. Where a note already carries one it stays editable, because a
wrong `mm` on `ARM HEIGHT` must be correctable without promoting the row to a
slot it does not belong in.

**A note block is keyed on its page, its heading AND its configurations**, the
model's and the reviewer's (`noteConfigurationKey`, audit D5, 2026-11-06). The
merge kept the FIRST row's `configurations`, so a "Type 3" note merged into a
shared one was written to every record. Blocks merged wrongly at staging
before 2026-11-06 stay as they were stored; the original lines are gone.

### The drawing read asks for ITEMS, not pages (staged schemaVersion 4)

`docs/plans/intake-items-2026-10-04.md`, `src/lib/drawing-items.ts`
(`stageDrawingsV4`), `src/lib/extraction-schema.ts` (`DRAWINGS_ITEMS_TOOL`),
`src/lib/model-request.ts`, `src/lib/bill-over-drawing.ts`,
`src/lib/slot-swap.ts`, `tools/eval-drawings.ts`, `tools/drawings-golden.ts`

Max, 2026-10-04: the page-centric read meant every nuance — an item over two
pages, a codeless continuation sheet, a title block naming the item
differently, configurations across pages — became glue code, "and there are
endless issues that arise from it". Since that day every new drawings read asks
the document once: **what are the things to be made, and what does it say about
each**. One staged `DrawingItem` per item, `pages[]`, every observation carrying
its own `page`, at most one figure per overall slot with its view and evidence,
`candidates` for the figures it chose between, `uncertain[]` in its own words,
`statements` (everything else a spec sheet states, folded), a swatch box per
finish, and a `mockup` flag. v1–v3 runs read exactly as before — a
byte-for-byte snapshot test (`drawings-v3-frozen`) holds it.

**Measured, not argued** (unverified golden, 2026-10-04): the old read on Opus 5
FAILED 12 of 30 Aman drawings outright (an inch mark broke the forced tool's
JSON); on the 30 Aman drawings v4 on Opus 5.5 grouped 30/30, placed 78 overall
sizes right with **0 in the wrong slot**, against 70 and 7 for the old read on
the same model. Re-measure with `npm run eval:drawings` (charged) or
`--rescore` (free) before changing the prompt, the schema or staging.

Eight things are load-bearing:

- **Structured outputs cap the schema.** No more than 16 nullable/union fields,
  and the compiled grammar refuses somewhere between 43 and 47 fields (probed).
  That is why the v4 tool is FLAT — overall sizes as a list of slot entries,
  candidates and doubts as one line of text each — and Zod rebuilds the nested
  shape. A new field must be measured against that limit, not assumed to fit.
- **The unit vote is kept for v4** (the section below says why), narrowed to the
  slots the model filled. Removing it left all 21 Panther shop-drawing figures
  unitless and was the brief's mistake, corrected the same day.
- **A combined line of three bare figures** is read W x D x H in printed order
  and flagged amber with the reason; printed prefixes still win.
- **A component drawn with an item is part of it** (scheduled cushions, a
  mattress, a glass top): its codes are the item's finishes. The Aman bill has
  no cushion lines.
- **Mock-up rests on the title block or the drawing number, never a caption.**
  Nearly every Aman PL sheet carries a caption ending "(MUR)" copied from the
  mock-up sheet; read on the caption, PL drawings landed on the GR mock-up
  copies. `isMockupDrawing` needs "MOCKUP ROOM" in the evidence or a `MUR`
  segment in a drawing number (never a bracketed "(MUR)").
- **A main drawing never writes to a mock-up item unless a person ticks it**
  (`notOntoMockup`): the mock-up phase is listed and left unticked, with the
  sentence why. Mock-up items are added by hand ("Also in a mock-up phase",
  0043) and copy no specs.
- **The bill's values give way in ONE click, never silently.** A bill's
  description writes sizes and finish codes first; every drawing card then finds
  the slots taken. "Use this drawing's values over the bill's (n)" sets exactly
  the per-row replace acknowledgements, listing each replacement first; a drawn
  diameter also retires the bill's W and D. A typed value or another drawing's
  is never in that list.
- **A doubt about a size holds the card** until a person touches that slot or
  presses Checked (`uncertain_unchecked`); "Use as W · D · H · SH · Dia"
  (`swapSlot`) points at any figure the read found, returning the previous
  holder to a note in the same locked write.

The golden lives OUTSIDE the repo (`~/dev/localstack/drawings-golden/`, real
values), drafted by Claude from the rendered pages and checked by Max at the
local review page (`~/dev/localstack/tools/golden-review/server.mjs`). On the
local stack a read can be answered from a saved response
(`src/lib/local-read-replay.ts`, `LOCAL_READ_REPLAY_DIR`, off unless
LOCAL_STACK=1 and APP_ENV=development) — built when the API credit ran out,
so screens are verified against reads already paid for.

### The model says which figure is the width; nothing sorts them by size

`src/lib/extraction-schema.ts` (`DRAWINGS_TOOL`, `slotFromModel`, `RawCodeGroup`),
`src/lib/anthropic.ts` (`PROMPTS.shop_drawings`),
`src/lib/drawing-document.ts` (`stageDrawings`, `assertStagedDrawings`,
`canonicalCode`, `variantLettersByItem`, `foldableRow`, `wasReadByModel`),
`src/lib/dimension-guess.ts`, `tools/measure-drawing-reading.ts`

Three defects reported on one pack in one sitting, 2026-09-18 — a transposed
dimension cell, a card nobody could read, one armchair about to become two BWS
jobs — were three faces of one thing: **code was inferring what the model could
have been asked to read off the page**, and every rule doing the inferring had
been tuned against this one pack. Max: *"it's not always as simple as one item
per page … we need a total overhaul here, because it seems that this issue keeps
occurring."*

`house/conventions.md` §6 was rewritten to allow it, and the reason is measured
rather than argued: forbidding the model to say which figure was the width did
not remove the decision, it moved it into code, which cannot see the page.

**MEASURE FIRST. `npm run measure:drawings` is read only and calls
`assertStagedDrawings`, the same function the screens call.** Before: 18 staged
runs, 70 items, **141 of 183 placed dimensions were guesses (77%)**, 19 items
slotted BY SIZE, 45 raising a dispute, 38 items lettered as configurations. Run
it before and after; a sentence in a document cannot be re-run.

**A staged run is `schemaVersion: 2`** when the model was asked. Version 1 keeps
the old guessing pipeline, FROZEN, until it is re-read — nothing is upgraded in
place, because inventing the fields an old run never carried would be one more
inference layer.

Seven things are load-bearing.

- **TWO READINGS OF A SLOT, and a disagreement is never settled silently.** The
  model says which figure fills which slot and why; `normaliseDimensionSlot` is
  now a VALIDATOR over the page's own label, keeping its whole-label rule
  (`WIDTH SEAT` is not a width). Agreeing is unflagged. The model alone is
  flagged, with its own evidence as the reason. **A conflict gives the slot to
  the page's printed word and names the disagreement on the row** — that is the
  S-203 signature, `"Width" = 80` landing in the depth slot.
- **A COMBINED LINE NO LONGER INVENTS SLOTS FROM PRINT ORDER.** A printed prefix
  (`W1520`, `Dia.460`) is the page speaking and is kept; three bare figures get
  none, and the model reports the same figures with the evidence for each. Two
  inferences on one line meant the weaker winning silently: `80 x 70 x 90 cm`
  shipped as `W900 x D800 x H700mm`.
- **A PAGE COUNT IS NOT EVIDENCE OF A SPLIT.** `variantLettersByItem` reads the
  model's `one_item` / `configurations` / `unclear`, and only `configurations`
  letters anything — because lettering takes the bill line out of
  `loadExportScope` and ships each letter to BWS as its own job. **No string
  rule can do this instead, and that was measured.** S-200 states `Tibor Blob
  Amber Fern` on one page and `CLO003 A = Tibor Blob Amber Fern` on the other;
  comparing codes calls it a split, and comparing descriptions calls it a split
  too, because one page adds "as per approved sample".
- **IT IS NOT ONE ITEM PER PAGE, IN EITHER DIRECTION**, and the pages may TITLE
  one item differently. S-200 is headed `S-200` on its specification sheet and
  `MUR.2 ARMCHAIR` in the shop drawing's title block. `codeGroups.itemCodes` is
  a LIST with the bill's code first, and `canonicalCode` is what grouping AND
  resolution key on — without it the shop drawing is an item no record carries.
- **THE FOLD ASKS WHETHER A FIGURE IS OVERALL**, not whether the value is a
  number. `isOverall` is the model's answer; `foldableRow` lives in
  `drawing-document.ts` so the card and anything measuring the card ask one
  function. S-201's five blank `TBC` sub-dimensions state no figure, so the old
  test could never fold them and they printed inline between the four that
  matter and the fabrics. Slots also sort W/D/H/SH/Dia to match the composed
  cell above them, and the rest group by kind.
- **ONE DIMENSION STATED ON FOUR VIEWS IS ONE DIMENSION.** Cross-view duplicates
  used to be kept deliberately — that repetition was the evidence the magnitude
  guess read — and there is no guess left to feed. Same slot and same figure
  collapses; same slot and a DIFFERENT figure never does, because that is two
  views disagreeing about the chair.
- **A CARD THE MODEL READ DOES NOT ALSO GUESS.** Both cards re-run
  `guessSlotsFromViews` at render time, and on a version 2 item that printed a
  dispute banner describing a sort the app no longer does, directly above rows
  saying something else. `wasReadByModel` reads it off the item, because
  `isOverall` is set on every version 2 dimension row and on none before.

**THE UNIT VOTE IS DELIBERATELY KEPT.** `suggestUnit` still reads cm or mm from
magnitude where the page prints nothing — the same KIND of inference, and not
the same situation: a page that prints `80 x 70 x 90 cm` beside the word Width
HAS stated which figure is the width, where the AP364 shop drawings state no
unit anywhere. It is flagged on every row it touches, one click corrects a whole
page, and removing it left every card blocked by `unit_missing` with no control
able to unblock it. What moved is the NARROWING to the overall figures, which
used to live inside `applyViewGuesses` and now runs at staging off the model's
own answer.

**NEVER FAIL A PAID RUN OVER A HINT.** `itemCodes` came back as a bare string on
one document and `z.array()` refused it, so a read that had already been charged
for went terminal with "Expected array, received string". A string is read as a
one-entry list, and a group that still makes no sense is dropped —
`codeGroupsOf` — which leaves the item whole and asks a person. The same rule
put `evidence` at `MAX_NOTE`: the model wrote 480 useful characters explaining a
grouping and a 300-character bound silently nulled them.

**The variance matrix's drawings and email rows (plan §6.10.b/c) were driven
through these paths on 2026-09-21**, six rows, synthetic fixtures built by
`tests/fixtures/build-pdf.mjs`. What they changed: **six ARRAYS were still
failing a paid read over a hint** — `dimensions`, `materials`,
`dimensionsCombinedRaw`, `notesRaw`, `proposals`, `notes` — and now go through
`bareValuesAsList` (a bare value is a one-entry list, a null entry is dropped;
`items`, an ABSENT required array and an over-long one stay terminal, each
saying why). **Plain inches convert exactly** (`in` has been in
`ATTRIBUTE_UNITS` and `TO_MM` since 0007 — `18"` is `W457mm`, and "never
converted" would have lost a correct figure); **a feet-and-inches value
converts exactly when it reads COMPLETELY, and is refused WHOLE when it does
not** (2026-09-30: every P18181 drawing is dimensioned in feet and inches
only, and the refusal left no dimension on any of them). `feetAndInches` in
`dimensions.ts` is the one reader — `6'-4"`, `2'-0 1/2"`, `3'7""`, `5'-8''`,
primes, `ft`/`in` words → total inches — and returns null for a stray word
(`8'-6" eq`), a lost inch mark (`2'-5`), a range, a zero or improper fraction,
or 12 inches or more after feet, which keeps the cell's *imperial, not
converted* (it used to half-read `1'6"` as a figure of 1). `parseDimensionFigure`
returns a complete one as one figure marked `imperial`, so `toMillimetres`
stays the one conversion and `composeDimensionCell` the one composer; the
attribute keeps the document's words as `value` with unit `in` (no new unit,
no CHECK change). The marks ARE a printed unit, so a compound never takes the
project default; it never votes in `suggestUnit` (76 inches would vote a page
into centimetres); beside mm or cm it is a `unit_conflict`, never read at that
unit; and on a size line one slot part that fails to read refuses the whole
line. Files: `src/lib/dimensions.ts`, `src/lib/spec-dimensions.ts`,
`src/lib/drawing-document.ts` (`splitFigureAndUnit`, `rejoinInchMark`,
`suggestUnit`).
**A PDF over 600 pages is refused before the call**, with the number in words:
600 is the documented ceiling for a 1M-context model, which `EXTRACTION_MODEL`
is, and 100 for a 200k one, so `MAX_MODEL_PDF_PAGES` is a named constant with
that sentence beside it and a test that pins it; the count is read off the
page tree, and NULL means proceed. **A rotated page's crop maths are
extracted (`cropGeometry`) and proved** against a four-rotation PDF rather
than assumed. On the email side: **an `.msg` declared as an email is refused
at registration** before anything is recorded or dispatched — it used to be
routed and sent to the model as binary OLE — and **an email's attachments are
listed as *not read* and downloadable** through `GET /api/imports/[id]/attachments/[index]`
(always `attachment` + `nosniff`, registers nothing), because the bytes live
inside the `.eml` and a one-press "register it" would be two hard gates in
one button. Recorded, not fixed: `viewRegions` and `codeGroups` still drop
ALL entries when one is malformed; drag-drop still lets a `.msg` reach the
project's blob prefix before the route refuses it.

**STAGED JSON IS DATA FROM THE PAST.** `assertStagedDrawings` casts rather than
validates, and this shape changed twice in one afternoon — so every screen
reading the first version 2 run threw `Cannot read properties of undefined`.
Read a staged field defensively or a schema iteration is an outage.

**Verified on the sandbox by re-reading the Panther-d pack, ten charged calls.**
Every guess gone: items slotted by size 10 → **0**, disputes 14 → **0**, rows
whose label disagrees 3 → **0**, items lettered 4 → **0**, inline rows with no
figure 25 → **3**. S-203 `W900 x D800 x H700mm` → **`W800 x D700 x H900mm`**;
S-200 one item on two pages, both `W840 x D790 x H720 x SH460mm`; S-100's
previously CODELESS second page now groups with S-100 through its title block.
S-201's reason followed the page: *"page 1 explicitly instructs 'ITEM: REFER TO
JACQUES GRANGE DRAWINGS' … tying the two pages to the same armchair."*

### One finish stated on two pages is one finish

`src/lib/drawing-document.ts` (`sameFinish`, `crossPageClaims`),
`src/lib/clash-resolution.ts`, `src/components/imports/review-row-actions.tsx`

`crossPageClaims` decided "the same finish" by client code alone, so S-301's
specification text (no code) and its swatch caption (`CH-01.1`) — the SAME
raffia, words reordered — clashed "in different words", and the card advised
"move one to another field": following it would have put a second, invented
fabric into COM 2 of the BWS file. Two rows are the same finish when both carry
one code, or their words are identical after folding case, punctuation and
WORD ORDER; a code on only one side decides nothing, because on Panther
`CH-01.1` is a POSITION code (four cloths share it). Anything else asks the
real question on the row: *keep page 1's wording* / *keep page 2's* (the kept
row takes the other's code and swatch; the other is ignored "same as page N"
through the PATCH's `ignoreBecause`) / *two fabrics — move page N to the next
free COM*. Never go back to the old advice.

### One bill line, two things to make

`db/migrations/0024_record_variants.sql`, `src/lib/record-variants.ts`,
`src/lib/export-scope.ts`

The AP364 set draws S-201 twice, S-200 twice and S-301 **four times** —
identical geometry, different fabric and timber callouts, one bill line at 45
off. Both cards resolved to the same record, so `duplicateTargets` read them as
two documents fighting over one row and confirming the second offered to RETIRE
the first's fabric. The second fabric is not a correction of the first; they are
both true, and they are two different chairs to build.

0002 anticipated this and stopped one step short: `parent_id`, `depth` (capped
at 1) and `split_reason in ('fabric','configuration')` have existed since the
foundation, with the comment that "one ref legitimately becomes several jobs (a
fabric split, a configuration split)". **Nothing has ever written any of the
three** — a column is the same promise an empty table makes. What was missing
was a NAME: a split with only its own `record_no` reads as an unrelated line,
and what a person says out loud is "S-201 A".

Settled with Max on 2026-09-16, and each half is a trap:

- **The variants export; the parent does not.** A bill line with a live variant
  is a heading and its variants are the jobs. Three rows for one line, in a
  file that replaces rather than merges, reads as three items to make — the
  same class of error as a filtered export. The predicate is a correlated
  `not exists` on an ACTIVE variant, never a stored "has been split" flag:
  retire both variants and the parent is an item again, still 45 off on the
  bill, and a file that omitted it would wipe every BWS field it holds.
- **No quantity is apportioned.** The bill says 45 and never says how many are
  fabric A. Variants are created with `qty = null` and the screens say the 45
  is unallocated. `unallocatedQty` does NOT clamp a negative: variants adding
  up to more than the bill line is a real mistake, and hiding it behind a
  `Math.max` is how it reaches a quotation.
- **The client ref is unchanged.** `S-201` stays the ref, because a ref is the
  client's key and the letter is ours. One ref, several BWS jobs — what the
  pre-sale key model has always said.
- **A letter is never reused**, including a retired variant's: somebody quoted
  "S-201 C" in an email and it has to keep meaning that. Past Z,
  `nextVariantLabel` returns null rather than inventing `AA`.
- **`parent_id` is now `on delete cascade`.** It was `restrict` since 0002,
  which would have refused a project delete the moment anything was split —
  the lesson 0013, 0014 and 0015 each learned separately, found across a
  maintenance path for the third time.

**BUILT SO FAR: the migration, the library, the export rule and its db-tier
test — and all of it is INERT until something creates a variant.** No variant
exists, so the `not exists` clause matches nothing and the export behaves
exactly as before.

**The letter is DERIVED, never stored and never sent by the client.**
`variantLettersByItem` is a pure function of the staged document, so the review
screen and the confirm route reach the same answer without either telling the
other — the `proposalBlockers()` rule, and the reason a letter on the request
would be a client naming the record its data belongs to. Order is PAGE order
and it ignores review state: if dismissing page 5 turned page 6 from B into A,
every letter anybody had written down would mean something else. It folds codes
with `spec-document`'s `normaliseRef` — the one `findRecordsByRef` matches by,
NOT `boq-import`'s looser one — or cards would group as one code and resolve to
different records.

**`ensureVariant` find-or-creates one variant per (parent, letter)**, takes the
project row lock before allocating a `record_no` (the `boq-concurrency`
defect), copies the parent's identity, leaves `qty` null, creates the checklist
rows, refuses to un-retire a variant somebody retired with a reason — and
carries THE GUARD: a parent that already holds active `record_attributes`
cannot be split, because those specs would stay on a record the export has
stopped shipping and a confirmed fabric would vanish from the file. Thirteen
records in the sandbox already carry specs; S-200, S-201 and S-301 did not,
which is why the case in hand was clean.

**The confirm keeps TWO LISTS and they are not interchangeable.** `ordered` is
what the reviewer TICKED — the bill's own records, echoed back into the staged
item and compared against the live resolution on the next read, so writing
variant ids there would make every later confirm fail `targets_changed`.
`writeIds` is where the specs land. The write loop carries both per iteration,
because the replace acknowledgements are keyed on the record the reviewer SAW.
Snapshots are taken of the records that changed — a version of the bill line
would describe a heading nothing was written to.

**`occupancyThrough` re-keys rather than re-points.** The occupancy of the
record being WRITTEN, returned under the key of the record the reviewer ticked,
so `drawingItemBlockers` and `occupantsFor` work unchanged and go on naming what
is on the card. Two things come out right for free: a variant that does not
exist yet shows no occupants, because there is nothing there to replace; and
re-confirming over an existing variant shows that variant's values rather than
the bill record's, which is empty because a split parent is a heading. The same
function serves the confirm and `resolveStagedRun`, so the screen and the
confirm cannot disagree about whether a card can commit.

**A variant reads its PARENT'S `boq_code`.** `loadRecordAtoms` follows
`coalesce(r.parent_id, r.id)` for that ref system only — without it every split
item shipped a blank Client Code, since a variant deliberately carries no client
ref. A `bws_job` ref still belongs to the variant that earned it. The `Name`
column appends the letter (`Armchair (A)`), which is THIS REPO'S JUDGEMENT like
the rest of the job columns: two variants otherwise show BWS two identical jobs
against one client code. Confirm it against a real BWS import.

**The screens read it from both ends.** A configuration is sorted under its bill
line by `/api/records` — ordered on the PARENT'S `record_no`, because a variant
is allocated the next free number in the project and would otherwise land pages
away from what it belongs to (ordering on the parent id puts the groups in uuid
order, which is no order at all). It is indented there and named `S-201 A`, its
client ref read through the parent. The bill line says in words that its
configurations are what the export carries, or it reads as an item nobody has
specced. The record screen shows the family in whichever direction the record
sits in it: a bill line lists its configurations with what each has captured, a
configuration names the bill line it came from and links back.

**The unapportioned quantity is stated, never divided**, on both screens. The
bill says 45 and never says how many are fabric A.

**And the REVIEW screen is one card per CODE** (`src/lib/configuration-cards.ts`,
`src/components/imports/ConfigurationCard.tsx`, 2026-09-17). Four pages of
S-301 were four cards carrying a grey chip and a sentence, so the same four
dimensions were checked four times and the fabric — the only thing that
actually differs — was what got scrolled past. Now: one card, a chip per
configuration coloured by LETTER (A is always sky, so the chip finds its own
section), the geometry ONCE, each configuration's own finishes below it in its
own band, and a reviewed configuration collapsed to a line.

Five things about it are load-bearing:

- **What is shared on screen is still written per page.** An edit to the shared
  geometry table fans out to the MATCHING row on every configuration's page
  (`byMember`, keyed by `measuredKey`), each with its own version, in one
  batched save. That is the data model, not a shortcut around it:
  `record_attributes` holds what a PAGE said, so B's width comes from page 6 and
  carries page 6 as its source. Writing A's row to B would fabricate a source
  page or lie about one.
- **The confirm route is untouched.** One request still names ONE staged item
  and its whole pending set; the card issues several in letter order. A refusal
  on B leaves A applied — correct, and what the reloaded card shows — and the
  banner names what was written, what was refused and what was never attempted.
  Copying rows at confirm time instead would make B's atomicity depend on A.
- **One APPLIES TO for the card.** Ticking a run is a statement about the CODE.
  Per-page targets would let A apply to the VE run and B not, producing
  `S-201 A` under a bill line with no B. Where they currently disagree the tick
  is indeterminate and says so.
- **The pages may DISAGREE about the size, and that is never averaged.**
  `compareGeometry` compares SLOT signatures — not every measured row, because
  two pages of one chair routinely differ by a radius and failing the card over
  a 5mm reveal would put four tables back on screen. A difference is an amber
  notice naming each letter's figure, each configuration keeps its own, and it
  is NOT a blocker: it is either a configuration split or a misread, and both
  are a person's call.
- **`groupItemsByCode` is the one grouping.** `configurationGroup` compared
  `itemCodeRaw` RAW while `variantLettersByItem` folded it with `normaliseRef`,
  so `S-201` and `s 201` were lettered A and B and then printed under two
  separate headings. Both now call the same function. Grouping never crosses
  runs: letters are per staged run, so a code drawn once in each of two files is
  letter A in both and writes to the same variant — the pack's
  `duplicateTargets` banner is what reports that case.

**CLOSED 2026-09-23:** a record that already carries confirmed specs could not
be split at all (`ensureVariant`'s guard). The guard stays for intake; the path
it asked for now exists — *Add a configuration* copies the bill line's specs
onto the new configuration as ticks and says what stops being exported (see
"A person can add, rename and retire a configuration"). **CORRECTED 2026-09-21 (variance row d4):** this file
said for four days that nothing lets a person SET a configuration's quantity.
That has been false since 0028 — `PATCH /api/records/[id]`'s `details` accepts
`qty` and the record's details panel renders the field on a configuration too.
What is true: nothing APPORTIONS it, and the three list screens say *quantity
not allocated* in the same words while it is null; the infill and chase lines
say it UNCONDITIONALLY (`FinishOptionGroup` carries no `qty`), which is logged.

### A configuration is what the document TELLS APART, named as the document names it

`src/lib/extraction-schema.ts` (`DRAWINGS_TOOL`, staged `schemaVersion: 3`),
`src/lib/drawing-document.ts` (`namedConfigurationsByCode`, the per-row
fan-out, `alreadyRecorded`, the pairing blockers),
`src/lib/confirm-drawings.ts`, `src/lib/variant-create.ts` (`insertVariant`),
`src/lib/record-variants.ts` (`VARIANT_LABEL_SHAPE`, `normaliseVariantLabel`),
`src/components/imports/ConfigurationCard.tsx`, `ConfigurationTabs.tsx`,
`ReviewItemList.tsx`, `docs/plans/configurations-2026-09-23.md`

Max, 2026-09-23, on the S-301 desk chair: *"fabric reference as per room
type ... there's type one to five. So five different configurations."* The v2
read had it right and nowhere to put it: a configuration could only come from
separate PAGES, so the room type was welded into the row LABEL (`FABRIC
REFERENCE - Type 2`) and `classifyCallout` handed four room types COM 1, COM 2
and COM 3 of ONE record. **Confirming that card wrote one chair with three
fabrics.** Nine things are load-bearing.

- **A page lists the configurations it names; a row says which it applies to**
  (v3). Empty = shared. `Type 1 & 5` is TWO configurations sharing one row
  (Max: one per room type). A title block (`MUR 1 & TYPO 5`) is
  `depictsConfigurations`. The name is the PAGE'S OWN WORDS, folded by case and
  whitespace only — `MUR 1` is never translated into `Type 1` across
  documents. v1/v2 runs are frozen; nothing parses an old label.
- **A configuration exists only where the document gives it something
  different.** If no row targets a strict subset of a code's named
  configurations, the names distinguish nothing and the code is ONE item. The
  merged Panther pack read S-100 SOFA as TYPE 1 / TYPE 5 off its title block
  alone — two identical BWS jobs for one sofa, the "a page count is not a
  split" trap in a new form. One function decides it for the grouping, the
  card, its button and the confirm.
- **BWS slots are claimed PER WRITTEN RECORD.** Type 2's fabric is COM 1 on
  `S-301 TYPE 2`. The unit of commit is unchanged — one request, one page — and
  a page fans out to its configurations × its phases (S-301: 5 × 2 = 10).
- **A configuration is named, not lettered, when the document names it**
  (`S-301 TYPE 2`). `variant_label` keeps 0024's upper-case CHECK, and
  `VARIANT_LABEL_SHAPE` in record-variants.ts is its ONE copy in code. 0037
  widened both to 24 characters with `&` — applied to the SANDBOX on
  2026-09-23, in the same change that widened the constant. **Pilot must get
  0037 (and 0038) before this code is promoted**, or the card lets through a
  name its database refuses.
- **The review card is TABS, one per configuration, in natural order** (Max:
  *"configuration one ... it's got the dimensions and the fabric ... it's the
  same every time"*). A shared row is ONE observation on every tab. One row per
  measurement: a figure two pages state identically is one row. Notes shared by
  every configuration fold behind one toggle. A code with no configurations has
  the same layout and no strip.
- **The same value on another page is not a replacement** (`alreadyRecorded`):
  same slot, same figure IN MILLIMETRES through the one parser, same state — or,
  for a finish, the same non-empty client code. The confirm writes nothing there
  and says so. Anything else two pages give one configuration in different
  words is a decision SHOWN BEFORE CONFIRM, and Confirm is disabled until it is
  taken; a confirm must never half-apply because of something the card could
  see.
- **A new configuration beside existing ones is a question, lettered or named.**
  The drawing set's S-301 pages (A–D, or MUR 1 & TYPO 5 / MUR 2 / TYPO 3 /
  TYPO 4) against the spec sheet's TYPE 1–5 would otherwise have made nine
  configurations. Only an exact fold of the page's own words pairs silently;
  anything else asks, a page may pair with MORE THAN ONE (`MUR 1 & TYPO 5` →
  TYPE 1 + TYPE 5), and the question is asked once per configuration, not once
  per phase. A document is never asked about a configuration it created itself.
  A disagreement between the two documents then surfaces as the ordinary
  replace acknowledgement — it did, on the real pack: Type 2 is Le Manach on the
  spec sheet and *Tibor Blob Amber Fern* on the drawing set's `MUR 2`.
- **A reviewer can fix the reading on the card** — add, rename or remove a
  configuration, change a row's configurations, split or join — as edits to the
  staged JSON with the model's reading kept beside them ("read as 4, you set
  5"). A row whose only configuration was removed is a blocker, never silently
  shared.
- **ONE insert and one name rule** for intake and for the hand-added
  configuration (`insertVariant`, `normaliseVariantLabel`): two copies had
  already been written by two coders on the same day.

**Measured on the real Panther pack, local stack, Opus 5, 2026-09-23:** S-301
sheet → five configurations, ten records, each cloth in COM 1 on its own
record; the card 2,400 px tall against 5,300 before the tabs; the drawing set
guarded and asking. **STILL OPEN, and Max's:** whether `MUR 1` is Type 1 —
the model maps the two inside ONE document and shows both names; across
documents the app asks.

### A person can add, rename and retire a configuration

`src/lib/configuration-add.ts`, `src/lib/configuration-carry.ts`,
`src/app/api/records/[id]/configurations/route.ts`,
`src/app/api/records/[id]/configuration-name/route.ts`,
`src/components/records/AddConfiguration.tsx`, `DifferingFields.tsx`,
`db/migrations/0038_record_retire.sql`

Max, 2026-09-23: *"if someone sees that something's wrong, they still need to
work through, even if it means they have to add it manually ... it should come
equipped with a default set of things to fill in."*

- **The bill line's specs are COPIED, each a tick keeping its source page**;
  COM 1–3 start blank and sit first on the new record (`DIFFERING_FIELD_JSON_IDS`,
  this repo's judgement and a question for Matthew). Timber and metal are
  carried. A copied answer is `manual`; an answer that is a PROJECTION of the
  bill line's attributes is never offered, so an answer and its attribute are
  never both copied.
- **Every other phase carrying the same client ref is offered**, each from its
  OWN bill line's specs — never phase A's specs onto phase B. A ref on two lines
  of one phase (`SX11A`) offers nothing for that phase.
- **What stops being exported is stated before Add** (anything left unticked:
  the bill line becomes a heading), and the route re-derives the offer under
  the project lock, then the bill lines in id order, and refuses one that is not
  what was shown. One change set, one version per new record, the parent
  untouched. This closes the 2026-09-17 gap: a bill line that already held
  specs could not be split at all.
- **A name is never reused**, retired ones included. Retire needs a reason
  (`record_retire`, 0038 re-lists both CHECKs from the LIVE constraint text);
  restore does not. Retiring the last live configuration makes the bill line an
  item again, and the panel says so.

### A drawing dimensions everything, and four of them matter

`src/lib/drawing-document.ts` (`dedupeMeasured`, `foldableRow`),
`src/components/imports/ObservationRows.tsx` (`orderRows`)

The real S-201 armchair card carried **forty-three** measured rows. A figure
repeated on ONE view is one measurement — a front elevation prints 5, 5, 27, 27
because the chair is symmetrical — and `dedupeMeasured` collapses those, keyed
on the view label, the figure and the unit, keeping the FIRST so ids are stable
across reads. An unlabelled figure is keyed WITHOUT its label: `Dimension 37`
and `Dimension 42` are positions this app invented, not names the page gave.

**The ones that matter go first and the rest fold away.** Four of thirty-six
rows compose BWS field 3; the others are arm heights, gaps and radii. Inline
they bury the four. They are FOLDED, never dropped — what the document said is
the point of `record_attributes`, and a figure nobody can see is one nobody can
correct — with the count on the toggle so the card never implies the page says
less than it does.

**Which rows fold is the section above**: `isOverall`, as the model read it, not
"does the value state a figure". That older test is why a page whose
sub-dimensions were all `TBC` printed five rows of nothing inline.

### A swatch is cropped off the page it is printed on

`src/components/imports/SwatchPicker.tsx`,
`src/components/imports/PageCropper.tsx`, `src/lib/confirm-drawings.ts`

`project_finishes` has taken a swatch since 0018 and nobody ever added one. The
feature was not the problem; the flow was. A person had to find the finish, find
the PDF, find the page, screenshot a chip, save a file, upload it and then TYPE
which document and page it came from — which the swatch route requires,
correctly, because a picture nobody can trace to a page is a picture nobody can
check. A reviewer on a drawings card already has all of it: the page is open,
the document and page are known, and the chips are printed in the materials
panel.

- **`PageCropper` is one implementation**, shared by the item picture and the
  swatch. A second copy is how the two start disagreeing about what a click
  means — the 2% minimum is the difference between "no crop" and a one-pixel
  smear somebody has to notice and undo.
- **A swatch belongs to the CODE, not to the item.** `project_finishes` is
  unique on `(project_id, code_norm)` and `WD-05` is on three pages of the real
  set, so cropping it once crops it for every item carrying the code. That is
  the library's edit-once rule; the card says so, or somebody crops the same
  chip five times and wonders why the fifth won.
- **Nothing is uploaded until the card is confirmed**, like the item picture: a
  card nobody commits leaves no bytes in the store, and the finish the swatch
  attaches to does not exist until the confirm creates it.
- **Keyed by OBSERVATION; the finish is resolved server-side** from that row's
  own code. The client does not get to say which library row a picture belongs
  to — the `blob-source.ts` discipline, applied to the choice of target as well
  as to the pathname.
- **Refused, never dropped.** A row whose code does not resolve to one finish
  (a conflict with the library links nothing, by design) fails the confirm with
  that reason. Silently discarding a crop is how somebody comes to believe it is
  stored. **Supersede, never delete**, as the swatch route already does.

### One crop at a time, and never one nobody asked for

`src/lib/pdf-crop.ts`, `src/components/imports/ItemImagePicker.tsx`,
`src/components/imports/PagePreview.tsx`

Rasterising an A3 drawing is the most expensive thing the review screen does,
and three things were making it happen far more often than anybody asked:

- **The callback was in the effect's dependencies.** A card passes
  `onCropped={(image) => onImage(item.id, image)}` — a new function on every
  render — so every re-render of the card started a fresh crop. Measured on the
  real pack: **33 rasterisations for 12 picture panels.** `onCropped` now lives
  in a ref, so a crop depends on WHAT is being cropped and never on the
  identity of the function that receives it. A caller passing a lambda is
  ordinary React; the guarantee belongs in the component.
- **Nothing cancelled a superseded render.** `cropPdfRegion` takes a `signal`
  and cancels the pdfjs render task; the picker aborts the previous crop and
  its own on unmount, and treats a cancellation as "superseded" rather than
  showing *Could not render*. `tests/components/item-image-picker.test.tsx`
  holds all of it.
- **They all ran at once.** Crops are now serialised through one queue, so the
  first picture appears in a second instead of all of them appearing
  eventually, and two renders of the same page can never overlap — which is
  the one thing pdfjs asks a caller not to do.

And the document is fetched **in one request**: pdfjs's default keeps a
background download open and issues 64KB range requests on top, each going
through this app's route to a blob store in another region — 123 requests for
one visit, against a browser limit of six connections that the screen's own API
calls also need. `disableRange` and `disableStream` make it 1.

**A hidden tab renders nothing, and that is not a bug.** pdfjs drives canvas
rendering from `requestAnimationFrame`, which a background tab does not fire,
so every crop sits unfinished until the tab is looked at. Anybody verifying
this screen in a headless or hidden browser pane will see "Rendering…" for ever
and should not go hunting for a deadlock — check `document.visibilityState`
first.

### A fabric is a fabric, whatever the drawing calls the part

`src/lib/drawing-document.ts` (`classifyCallout`, `upgradeCalloutGuesses`),
`src/components/imports/ObservationRows.tsx`

The real S-100 sheet captions its upholstery `SOFA / Yarn Tessarae YC04158 -
01` — the PART in the label, as the prompt asks for, the CLOTH in the value —
and it staged as group *Other* with no BWS field, while its sibling `SOFA FEET
/ Dark tinted wood` landed correctly on "feet" and "wood". `classifyGroup` and
`suggestSpecField` each ran the same word lists over the same text
INDEPENDENTLY, so the row lost its group and its field in one go, and a
widened list could have fixed one and left the other.

`classifyCallout` is now the single reading and both call it — the
`composeDimensionCell` rule, in a third place. Its evidence stops at the first
thing that decides:

1. **The words**, widened to the vocabulary a swatch caption actually uses
   (`yarn`, `boucle`, `linen`, `mohair`, `chenille`, …). A fabric is named by
   its cloth, not by the word "fabric".
2. **The client's own finish code** — `UPH`/`FAB`/`COM` fabric, `WD`/`TIM`
   timber, `MT`/`MTL` metal. That is the page speaking. **`CH` is deliberately
   unmapped**: the real set prints `CH-01.2` and no page says what CH means.
3. **The caption names the item itself** (`SOFA` on a sofa page) and names no
   timber, metal or hardware → its upholstery. The ONLY inference here, so it
   is flagged `groupSuggested` and the card renders it yellow with its reason
   — the same treatment a guessed dimension slot gets. It requires the value to
   carry real text, so `PIPING / TBC` still classifies as nothing.

**`upgradeCalloutGuesses` runs at READ time**, like `upgradeDimensionSlots` and
`mergeNoteBlocks`, so a pack already read gains the corrected reading with no
second model call. It touches a row only when it is still `pending`, at
`version === 1` (nobody has patched it), holds no field, and is not a dimension
or a note — so a reviewer's decision is never second-guessed, and a merged note
block is never promoted to a fabric. It re-seeds `taken` from the rows that
already hold fields, so it cannot hand COM 1 to two rows.

**The register has to reach every reader.** `assertStagedDrawings` takes the
spec fields, and the review GET, its autosave PATCH, the pack screen and
`confirm-drawings` all pass them. A confirm that resolved the field differently
from the screen would be a cell the file does not deliver.

A fabric lands in the group **Materials and fabrics**, not *Finishes*: `finish`
is this app's word for timber and metal. The BWS field is the part that
matters.

### A page that reported no picture proposes the page itself

`src/components/imports/ItemImagePicker.tsx`

The eleven-page Panther set came back with no view regions at all, the model
saying it could not fix exact crop boxes from what it had read. Those pages are
almost entirely picture — a reviewer drags a box over nearly the whole sheet —
so "no picture" was the one answer that was certainly wrong, and it was the
answer every card defaulted to.

A card with no reported view therefore proposes the WHOLE PAGE. That is not a
guess about what the item looks like: the page IS the drawing of it, the card
says "The whole page" in words, the crop renders in front of the reviewer before
anything is stored, and *Drag a box* and *No picture* are each one click — with
the whole page offered back afterwards, so *No picture* is not a one-way door.
It does not contradict the card's rule that nothing is pre-selected where the
answer is unknown: that rule is about spec VALUES, which get exported and quoted
against. A picture is an aid to recognising an item, and the reviewer is looking
straight at it.

**A card whose item ALREADY HAS A PICTURE proposes none** (Max, 2026-10-05, the
Aman pack: *"if there's already an image, by default it needs to go to no
image"*). A bill that prints a picture per row gives it to the record
(`giveBillPicture`), and the drawings confirm REPLACES whatever `item_image` it
finds, so confirming a card for its specs silently swapped the bill's picture
for a drawing crop. `resolveStagedRun` sends `pictureHeld: { recordIds, of }` —
the WRITE targets already holding a picture, read once per project in
`loadDrawingContext` and walked by `pictureWriteTargets` over the confirm's own
fan-out, so a page of configurations is judged by its variants, never the bill
line; absent when empty, so other payloads are byte-identical.
`ItemImagePicker` then starts at none — no crop on mount, `onCropped(null)`, the
reason in words — with the proposal, the whole page and a drag one click away,
and a chosen picture says what confirming does — over a BILL'S picture the bill's
stays and the crop is kept beside it (`placeDrawingCrop`, bd04f67), so
`pictureHeld.fromBill` counts those apart and the card never says "replaces"
there; it reads the CURRENT picture (`superseded_at is null`). **Untouched, the
panel FOLLOWS the ticked records; touched, it is the person's**: a code on two
bill lines resolves to nobody until a line is picked, so a mount-time default
would keep proposing the drawing over exactly the picture this protects (found
in the browser the same day). Re-set only on a CHANGE, so mount is still one
crop. The confirm route is unchanged: no picture sent, nothing written or
deleted.
