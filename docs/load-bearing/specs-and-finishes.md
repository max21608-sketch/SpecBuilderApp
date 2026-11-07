# Specs, answers, corrections and the finishes library

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### The spec record and its client ref

The client ref is the key the client, the BOQ, the FF&E schedule and the emails
all use, and it exists long before a BWS job number does. It is the natural
identifier of the pre-sale record but **not its key**: the pilot BOQ contains
`SX11A` twice with different quantities. So records carry a surrogate id plus
`record_no`, and every ref lives in `spec_record_refs`. One ref legitimately
becomes several jobs (a fabric split, a configuration split), which is why
`spec_records` carries `parent_id` and `split_reason` **on the row itself** — a
satellite table would allow a child with no split reason, or two parents. This
tool is the definitive client ref ↔ job number mapping; nothing else in the
business holds it.

### A staged proposal is addressed by UUID, never by position

`src/lib/spec-document.ts`, `src/app/api/imports/[id]/route.ts`,
`src/lib/confirm-spec-document.ts`

The BOQ's staged lines are a fixed positional list, so an index is a stable
address. **Extraction proposals are not.** Reviewing one changes the set the
screen is filtering, so "the proposal at index 4" means a different row before
and after an Ignore. Every operation locates by `elem.id` in the live, locked
JSON.

Reviewed proposals **stay in `lines`** with `reviewStatus` flipped. Keeping them
removes array compaction, a second reviewed array, an inverted restore guard,
and restore-by-reinsertion, all at once.

Each proposal carries **its own version**. The run's coarse version is bumped by
every autosave on every row, so predicating an edit on it would make two people
editing two different rows conflict for no reason.

**Blockers are computed, never stored.** A retarget clears an overwrite
acknowledgement, and a duplicate-target clash appears and disappears as other
proposals move — so a blocker frozen into the JSON at extraction time is stale
by the first edit, and the screen and the confirm route would then disagree
about whether a card can commit. `proposalBlockers()` is called by both.

### The finishes library is set out from a list, not from a scan

`src/lib/finish-bulk.ts`, `src/app/api/projects/[id]/finishes/bulk/route.ts`

Matthew: "Project finishes I think are the way to go; set these out from the
outset, possibly loaded by scanning the finishes schedule." The first half is
built and the second is not, deliberately.

`finishes_schedule` has been a `document_kind` with its own prompt since 0007,
but the model's output shape (`RawProposal`) carries `attributeRaw` and
`valueRaw` and **no field for a finish code** — so pulling codes out of it means
parsing them from prose, which is the inference house/conventions §6 puts on
the far side of the fuzzy/exact line. Adding a code field to the tool schema is
the right eventual answer and **forces a re-read of every document already
read**: eleven billed calls for the Panther pack alone. A decision with a cost,
not an oversight.

So the half that needs no inference exists: a person pastes the codes, and
**preview always comes first** — which are new, which the project already
holds, and which repeat inside the paste. A box that silently created thirty
rows would be the opposite of the library's edit-once rule, where correcting
one code corrects every item carrying it. `kind` is still never inferred, so a
pasted code arrives filed as nothing.

**THE SCAN IS BUILT (2026-10-04, `docs/plans/intake-items-2026-10-04.md` Phase
4).** `finishes_schedule` has its own tool with a code field (staged
`schemaVersion: 2`; version 1 runs keep the old screen), a review listing
finishes with the library's verdict per code, and a confirm that creates and
fills the library in one change set — a conflict still writes nothing. The pack
reads bill → finishes schedule → drawings. The paragraphs above are the history
of why it waited.

**A schedule's swatches are cropped off it (staged `schemaVersion: 3`,
2026-10-15).** The Ronnie Scott's COM list prints a fabric photo on every row
and the v2 read kept only the words. Each entry now carries `swatchBox`, a
PLAIN array and never a nullable object. The tool already spends all 16 of
structured output's nullable fields, and a test counts them. The review crops
the box on arrival with `SwatchPicker`, the drawings card's control, and
uploads only the ticked rows at confirm. The confirm resolves the finish from
the entry's own code and files the crop on it, for `agrees` rows too, so a
schedule read again on a library it already filled adds the pictures. It never
files over a CURRENT swatch, and the row says so instead of offering a crop. A
proposal on a row that writes nothing is left out; a person's crop there is
refused in words. A v2 run has no picture column. Measured on the real COM list
(local stack, TEST T16718): 30 of 30 boxes, 30 swatches filed in one change set.

**Asked for again on 2026-10-01, as a step in the pack** (D1 of
`docs/plans/catchup-2026-10-01.md`). Matthew set the order as bill → finishes
schedule → drawings, so that a drawing read lands on finishes already expected.
The cost above is smaller than it reads on a real pack: P18181's schedule is
ONE 14-page document (`260824 - OMS and FF&E Tracker.pdf`, not named as a
schedule, which is why nobody in the room recognised it). Building the code
field and a schedule stage on the pack screen is still Max's decision.

### A palette BWS owns is READ from BWS, and never invented

`db/migrations/0030_spec_palettes.sql`, `db/migrations/0035_palette_option_code.sql`,
`db/seed/0008_spec_palettes.sql`, `db/seed/0011_bws_palette_options.sql`,
`db/seed/0009_requirements_local_keys.sql`, `src/lib/palettes.ts`,
`src/components/records/AnswerValue.tsx`,
`docs/plans/bws-palette-capture-2026-09-22.md`

Eleven of Matthew's 35 fields carry a palette, and answering a spec question
had always been a bare `<input placeholder="Value">` — so "Indoor | Outdoor |
Humid indoor" was typed eleven ways and nothing could tell `Outdoor` from
`External`.

- **`pick_lists` stays dead.** It has existed since 0001 with no seed, query or
  UI, and its shape carries no spec-field link, no free-text flag, no default
  and no sync provenance. Reviving the wrong shape to save one `create table`
  is how a schema ends up with two overlapping registers.
- **Six palettes are ours and FIVE ARE BWS'S, captured 2026-09-22.** Timber
  finish, metal finish, seat build, back cushion and stud all say "From the BWS
  … palette". For four months this app held none of them: they were rows with
  **zero options** and a null `synced_at`, the field stayed free text, and the
  screen said so in a sentence — the honest representation, because "this
  vocabulary exists, BWS owns it, we have never had it" is a question somebody
  can answer, where five invented finish lists is the one kind of wrong answer
  nothing downstream questions. Max got a BWS account and they were READ:
  timber 35, metal 15, seat build 27, back cushion 6, stud 13, seeded by
  `db/seed/0011` from `docs/plans/bws-palette-capture-2026-09-22.json`.
  **The rule did not change, the evidence did.** What holds it now:
  `synced_at` is set in the same file as the options, so a sync cannot be
  claimed by a run that inserted none; `0008`'s guard refuses options on a
  BWS palette with no `synced_at`; and the db-tier test that asserted the five
  were EMPTY now asserts the capture's exact counts, so a re-seed that drops
  or invents options fails. A count moving is not a number to edit — it means
  BWS changed, and a person reads the diff.
- **Do NOT scrape a field's *Values* page.** The palette is the **Palette
  options** box on `/standard_specification_fields/<id>/edit`; `/values` is
  what people have TYPED (`self-piped`, thirteen times). They are one click
  apart and somebody had already been caught by it.
- **The unheld branch stays live.** `isOfferable` and `unheldPaletteNote` are
  unreachable today and must not be deleted: the next gate row pointing at a
  BWS palette is unheld between landing and its sync, and a screen that has
  forgotten how to say so renders an empty dropdown, which reads as broken and
  gets typed around.
- **A divider is not an option, and `field_type` is what says a field has a
  palette.** BWS separates the indoor block from the `OUTDOOR -` block with a
  bare `--------` of varying length in the same textarea; seeded, it becomes a
  selectable answer called "------", and both the seed and the db test refuse
  one. And three of BWS's `free_text_only` fields still hold leftover text in
  their palette box (COM 1 and COM 3 both offer `COM / BW Supplied COM`), so
  anything widening the seed reads `field_type`, never "the box is non-empty".
- **The option's own code is parsed out AND left in the label** (0035). Stud
  spec alone prints `Standard - French Natural | BWE Code: U1660-6031`; eight
  of thirteen carry a code, five do not, and two carry a further qualifier
  after it. Storing only the code loses the half a reviewer recognises and
  storing only the prose loses the half a purchase order is raised against, so
  `value`/`label` keep BWS's line whole and `spec_palette_options.code` carries
  the code as well. `normalisePaletteValue` matches it — still the EXACT step,
  because a drawing quoting `U1660-6031` is naming exactly one stud.
- **`normalisePaletteValue` returns null rather than the nearest option.** The
  exact step, separate from the fuzzy one (house §6). It folds case,
  whitespace, the degree sign and dash VARIANTS onto a hyphen, and **does not
  fold a dash into a space** — the `normaliseFinishCode` rule: a normaliser
  clever enough to merge two spellings is clever enough to merge two things
  somebody kept apart. BWS's own wording is stored verbatim, en dashes, curly
  quotes, double spaces and all, so a value stays checkable against BWS.
- **Every offered list carries "Other…"**, even where Matthew's is closed. A
  list with no way out makes somebody pick the nearest wrong option, which is
  §5's plausible-looking wrong answer wearing a dropdown. A value already off
  the palette stays editable as itself and is flagged, never snapped on.
- **A default preselects a control and writes no answer.** His sheet says
  Assembly guide is "No (default)"; `missing` means nobody has looked, and a
  gate passed by a default is a gate passed by nobody. The select does not even
  show it preselected — a select already reading "No" fires no change event
  when somebody chooses No, so the one action recording their agreement would
  do nothing, which is the level picker's trap. It is a hint beside the control.
- **`requirements.local_key` is where the six id-less questions live.**
  `kind = 'readiness'` has meant "must be known, BWS has no column" since 0002,
  so Headboard fitted, Fitted banquette and the four conditionals they reveal
  are readiness rows tied to their gate row by key. That buys answers, states,
  versions, change sets and chase coverage for nothing. Before it, a fitted
  headboard could never satisfy TG0 — there was nowhere to say it was fitted.
- **The product code carries NO palette key.** His "Palette Options" cell there
  describes where the value comes from — "derived automatically: if MF1 or MF2
  is populated" — not a list the app offers. Caught by the assertion that every
  gate's palette key resolves to a palette.
- **The SIX "ours" all have a BWS list behind them too, and the wording
  differs.** Found by the same capture and NOT acted on: `stitching` shares
  only Plain Stitch with BWS, which offers Top Stitch and Saddle Stitch where
  this app has Channelling and Fluting — so a value chosen here is one BWS does
  not accept. `assembly_guide` lacks BWS's **TBC**. Also `environment`,
  `site_access`, `swivel`, `fr_interliner`. They are Matthew's own matrix
  wording and changing them is his call, not this repo's:
  `docs/plans/matrix-assumptions.md`.

**THE DRAWINGS REVIEW OFFERS THE LIST, AND THE MATCH FIRES ZERO TIMES**
(`src/lib/palette-load.ts`, `PaletteChoice` in
`src/components/imports/ObservationRows.tsx`, `tools/palette-gap.ts`, Stage 2
item 2.2, 2026-09-22). Matthew asked for it at the catchup — *"it'd be really
good if it would have stud and then it would have a go at matching with what
was specified on the drawing. But if it was wrong or couldn't find it, that
you'd be able to select one from the drop-down"*, and free text stays.

- **MEASURE BEFORE WIDENING THE MATCH. `npm run palette:gap` is read only.**
  98 callouts land on a palette-backed BWS field across 47 staged drawings
  runs and **ZERO match an option** — not by the exact fold, and not by a
  substring step, which matches nothing on this corpus either. That is not a
  defect to tune away: **a BWS palette is BW's own MANUFACTURING range**
  (`BW Oak Natural - Open grain 10%`) **and a drawing states the DESIGNER'S
  INTENT** (`Ceruse finish oak`, `Antique brass, machined`). They are two
  vocabularies at two stages of the job, and mapping one onto the other is a
  specification decision a person takes. So there is no substring, token,
  distance or model step, and `normalisePaletteValue` is the whole matcher.
  A fuzzy step putting `Antique brass, machined` onto `BW Antiqued Brass`
  would write a BW finish code the designer never specified into a field that
  ships to BWS, and nothing downstream would question it.
- **ONE loader, because the two copies had already DRIFTED.** The record and
  infill routes each carried their own copy of the two palette statements and
  since 0035 they were not the same query — the record route selected
  `spec_palette_options.code` and the infill route did not, so a stud quoting
  `U1660-6031` silently stopped resolving on that screen and nothing said so.
  `palette-load.ts` is now the one fetch and both callers use it. A register
  copied per screen is `composeDimensionCell`'s rule one layer out.
- **The palette is attached to the FIELD REGISTER the screens already thread**
  (`withPalettes`), never sent beside it, so the card and the confirm cannot
  disagree about what a row offers — and it resolves at READ time from the
  register, so a pack already read gains the list with no second model call.
  `palette: null` is the honest value for a field with no palette AND for
  every field when the register could not be read, which is
  `upgradeCalloutGuesses`' empty-`fields` rule in a second place.
- **The confirm route is untouched, and that is what keeps provenance honest.**
  Picking an option writes the observation's `value` through the autosave that
  already exists; `valueRaw` still holds what the drawing said and the row
  prints it underneath. No column and no migration. `Other…` restores the
  drawing's own words rather than clearing the box, and it is the state the row
  is in whenever the value is not an option, so it can never destroy typed text.
- **The off-palette sentence is ONE implementation and the TONE is each
  screen's own.** `offPaletteNote` is shared with `AnswerValue`, because two
  wordings for one fact is a reviewer working out whether they mean the same;
  it is AMBER on a settled answer sitting outside its list and NEUTRAL at
  intake, where it is the normal case on every real callout measured. Amber on
  all 81 teaches people to ignore amber — the argument that keeps
  `unanswerable` slate.
- **STILL OPEN, and Matthew's:** if a drawing's `Ceruse finish oak` is never
  going to be a BWS palette value, is picking the BW finish a decision taken at
  INTAKE or later? It decides whether the dropdown belongs on the drawings card
  at all or only on the record. In the questions message, unsent.

### A spec value has a second line, and the file gets one line

`db/migrations/0029_spec_qualifier.sql`, `src/lib/bws-export.ts`
(`EXPORT_QUALIFIER_MODE`, `joinQualifier`, `renderAnswerValue`),
`src/lib/promote-answers.ts`, `src/lib/export-check-sheet.ts`

Matthew, 2026-09-17: "the spec fields are structured with the top line as the
spec and the return line as the qualifier. So COM 1 might be 14m of T&G Pink
velvet, then the returned line will be the placement 'Main & Self Pipe'." His
matrix says it eight times — rows 15-22 are all "<field> + location".

- **A column, not a row.** `record_attributes_field_slot_key` already says one
  BWS field, one value per record. A qualifier is not a second statement; it is
  the second line of the same one, and a satellite row re-opens "which line
  wins" — the question that index closed.
- **Never folded into `value`.** That is the `TBC TBC` bug in a new place:
  `renderAttributeValue` is shaped the way it is because a marker composed into
  a string that may already hold it is not idempotent. Holding the placement
  apart means the composer always composes from atoms and never parses back.
- **The export writes ONE LINE, today.** `EXPORT_QUALIFIER_MODE` is `inline`
  and emits `<value> - <placement>`, which is the shape Matthew's own quote
  sheet already uses. A TypeScript constant, not an env var and not a toggle:
  a newline inside a BWS cell is a file-format change to the file that
  overwrites rather than fails, so flipping it is a deliberate commit — and a
  test asserts no exported cell contains a newline, so the flip means watching
  that test fail on purpose and running a fresh check sheet. His own file mixes
  a hyphen and an en dash; we emit one and parse neither.
- **It goes on AFTER the TBC marker.** A placement can never carry the client's
  not-decided marker, so folding it in first would let "Main body and self
  pipe" suppress a TBC that belongs on the value.
- **`renderAnswerValue` exists so an answer cannot be the exception.**
  `composeRowCells` used to put `answer.value.trim()` straight into the cell — a
  bare string with no composer behind it — which the moment an answer could
  carry a placement became a way for one typed on the record screen to vanish
  from the file while the screen went on showing it.
- **The composed DIMENSIONS cell carries none.** Four slots off three pages
  could carry four placements; picking one would invent a fact.
- **The check sheet shows it apart from the value**, because the exported cell
  joins them and a reviewer checking against a page has to be able to tell
  which half the document said.
- **Extraction is not retro-active and was not changed.** The tool schema has no
  placement field; adding one means re-reading and re-paying for every document
  already read. The `fabric_schedule` prompt already folds a position into the
  value, so today's placements are in prose — the hand-typed field is the
  recovery path, and a read-time splitter on " - " would halve a finish
  description that legitimately contains one.

### A person can add a record, a spec and a note, and none of it has a page

`db/migrations/0028_manual_capture.sql`, `src/lib/manual-capture.ts`,
`src/app/api/attributes/route.ts`, `src/app/api/projects/[id]/runs/route.ts`

Matthew's workflow of 2026-09-17 — "specs checked and added to manually and
developed with Q&A with client through your app tools" — needed three verbs the
app did not have. `find src/app/api -name route.ts` had **no POST** for records,
runs, attributes or answers: a record could only be created by confirming a
bill, a spec value only by confirming a document, and a bill line's own words
could not be corrected at all.

- **A typed value carries NO source run and NO page**, and that is the honest
  shape rather than a gap: a spec somebody typed IS a spec with no page to turn
  to. Every screen that prints provenance already handles the blank, and
  inventing a source would be worse than it.
- **`applyAnswerFills` had to learn one more predicate.** Its rule is "only an
  answer still `missing`, or one a SHOP-DRAWINGS run wrote". A hand-typed
  attribute wrote the answer once and could then never update it — the first
  typed dimension composed `W1900mm` and the next two could not reach the cell,
  so the record showed W, D and H while its Dimensions answer said `W1900mm`.
  `document` with a **null** `source_id` is the discriminator, and a precise
  one: every document path writes a run id, so nothing else can be there.
  `manual` and `email` stay out of reach, so a person's own checklist answer is
  still never overwritten.
- **Two free-text columns, not one.** `spec_description` is quote-facing and
  becomes the prose at the top of the quote's Specification block;
  `internal_notes` never leaves this app except as the quote CSV's own
  `Internal notes` column. The real quote example carries both, and one of its
  internal notes is a previous price — exactly what must not reach a client.
  Neither enters the 109-column grid: his matrix says Spec notes has no BWS
  mapping. Whether he meant one field or two is Still open.
- **The details panel saves as ONE act, not on blur.** Found in the browser:
  typing the quote description, tabbing to Internal notes and typing there LOST
  the second box, because the first blur saved, the screen reloaded and the
  reload re-keyed every input to what the server held. It was also four change
  sets and four versions for one correction. The checklist answers still save
  on blur and should — each of those is its own decision.
- **`label` is baseline-only.** 0012: "a baseline is named, and nothing else
  is". Descriptive text on any other change set goes in `reason`, or the insert
  is refused by a constraint whose message names nothing useful.
- **A change set cannot be deleted, only cascaded.** 0014 refuses the direct
  delete outright, so a test teardown that tries one throws and leaves its
  fixture behind. Delete the project; the changes go with it. Same for
  `record_snapshots` and its record.

### A confirmed spec can be CORRECTED, and the correction keeps the page

`db/migrations/0033_attribute_correct.sql`, `src/lib/attribute-correct.ts`,
`src/app/api/attributes/[id]/correct/route.ts`, the record's Specs tab,
`docs/plans/make-it-work-2026-09-19.md` §5.2

Matthew went looking for confirm-or-update on a confirmed record on
2026-09-18 and neither he nor Max could find it, because there was nothing to
find: a confirmed `record_attributes` row could be RETIRED (reason required)
or a new one TYPED by hand (no page), and correcting `W1900` to `W1090` off
the same page was two acts, two change sets, and a replacement that had lost
the page it was read from. Built 2026-09-20 (Stage 1a item 1.13).

A correction is a **supersession by a person**, and six things about it are
traps rather than preferences:

- **Never an edit in place.** `record_attributes` is what a DOCUMENT said. An
  in-place edit makes the row say something the page does not while still
  citing the page — a false provenance — and the history can no longer answer
  "what did the card say before Max fixed it". The old row is retired with
  `superseded_by_id` pointing at the new one, and stays visible under *show
  retired*, naming the value that replaced it.
- **The new row KEEPS the source run and page.** The page is still the right
  place to check the corrected figure; a correction that dropped it would be
  indistinguishable from a number somebody made up. A hand-typed row has no
  page and its correction keeps none — nothing is invented.
- **Retire before insert, then point.** Both partial unique indexes are
  `where status = 'active'`, so the old row is retired (version-checked) before
  the new one is inserted, and `superseded_by_id` is set on the retired row
  afterwards — the only order 0016's check (`superseded_by_id is null or
  status = 'retired'`) allows. A row already superseded is REFUSED, naming the
  newer value; a stale version is a 409 and nothing is written.
- **A reason is required, as for retire**: `attribute_correct` is in
  `REASON_REQUIRED_KINDS` AND in the database CHECK (0033 re-lists both CHECKs
  from the LIVE constraint text, the 0032 lesson). An open change satisfies
  it, as everywhere. The reason box is always shown on the record screen,
  because that screen has no notion of an open change and a control that
  sometimes asks is worse than one that always does.
- **It never writes the answer and never touches `spec_records.version`.**
  The checklist is recomposed through `recomposeAnswers` — the composed cell
  is a projection of the attributes, so the next drawing confirm would wipe a
  directly written answer — and one `snapshotRecords` gives the record its
  v(n+1). The DoD on the demo sofa: two clicks, `W1820` → `W1830`, "1 changed ·
  1 added · 1 removed · 60 unchanged".
- **A corrected FINISH asks the library row's own code, not the attribute's.**
  WHICH finish an attribute is was settled at confirm time and a correction
  never moves it; the only question left is whether the corrected WORDS still
  match the library's description, and a disagreement leaves the new row
  UNLINKED (the CONFLICT rule) with the library untouched. The first version
  passed the attribute's `material_code`, and a test fixture that hand-wrote
  `code_norm` without `normaliseFinishCode` made both finish tests pass with
  the branch deleted — a fixture that invents a normalisation is that
  function's own warning, one layer out.

Where it appears: beside every active spec on the record's Specs tab; on a
drawings card only before confirm (the editable value box is already that);
never on an applied proposal, which stays immutable history. Found on the way
and fixed the same day: a checklist question with NO answer row came through
`/api/records/[id]`'s LEFT JOIN as `state: null`, which every filtered view
dropped and the `#q-` deep link rendered — the route now coalesces to
`missing` and the tone lookup falls back to plain (`found-in-use.md`,
2026-09-20).

### A second document never silently beats the bill: it is kept beside it, in red

`db/migrations/0046_attribute_disagreements.sql`, `src/lib/attribute-from-bill.ts`,
`src/lib/spec-document.ts` (`heldReading`, `annotateHeld`, `asNoteProposal`),
`src/lib/disagreement-record.ts`, `src/lib/disagreements.ts`,
`src/lib/disagreement-resolve.ts`, `src/lib/record-refs.ts` (`expandZoneList`),
`src/lib/tracker-furniture.ts`, `src/components/records/DisagreementRows.tsx`

The Aman pack's `260824 - OMS and FF&E Tracker.pdf` is a finishes schedule
(pages 1-7) AND a furniture schedule (pages 8-14), dated 24 Aug, and in places
it says something different from the bill: GR-FUR-04 is bespoke at W21" x D24" x
SH16" on the bill and a WEWOOD Caravela at W540 x D610 x SH430 mm in the
tracker. Max, 2026-10-05: *"it needs to take in both ... keep them separate ...
highlight them in red ... flag it up somewhere ... keep whatever's in the BOQ to
begin with."* A spec document over a held value used to have two outcomes,
replace or ignore; neither keeps both.

- **A SIDE TABLE, never a third status on `record_attributes`.** Fifty files
  read that table assuming a row that is not retired is THE value; the one that
  forgot a third status would ship the tracker's width to BWS beside the
  bill's. `attribute_disagreements` holds the statement in the attribute's own
  shape beside `held_attribute_id`, invisible to the export, the composed cells,
  the gates and the library. Recording one takes no record version, so it is
  not in `SPEC_CONTENT_TABLES`; one OPEN row per (held value, document).
- **"The bill's value" is ONE predicate** (`loadBillHeldIds`), read by the
  drawings card, the spec-document registers and the confirm. `heldReading`
  answers `free` / `same` / `bill_differs` / `replace` and is re-read LIVE at
  review (`annotateHeld`) and inside the confirm, never trusted from the
  request or the staged JSON. `same` writes nothing; `bill_differs` keeps the
  bill's live and records the disagreement unless the reviewer chooses "Use
  this document's instead" (the old replace tick). Anybody else's value keeps
  the replace tick, unchanged. **An email follows the same rule.**
- **Red must mean a real disagreement, or nobody reads red.** The first real
  read put 32 rows in red. Three readings take a statement OUT of the
  comparison, each measured on that read: a note that only says where the
  answer is (`pointsElsewhere`: "REFER DRAWING" against the bill's "Stained"),
  a note whose words contain the bill's or are contained by them
  (`containsWords`: "WEWOOD — BESPOKE DESIGN" over "BESPOKE DESIGN"), and a
  figure printed with NO unit whose number equals the held one ("W: 660" over
  660mm — in `heldReading` only; the shared `alreadyRecorded` still refuses a
  unitless figure, because a drawing card must stop for its unit). One side in
  inches and the other metric agree within a millimetre unrounded: the bill's
  736mm is a person truncating the tracker's 2'-5" (736.6mm). **A free note is
  written BESIDE the bill's, never over it** — the confirm's retire step is
  guarded on `reading !== "free"`, and a db test fails without the guard.
- **A zone list names several items.** The tracker prints `GR / MUR / PL` and
  `FUR 04`; the bill has `GR-FUR-04` and `PL-FUR-04` and no MUR line.
  `expandZoneList` is exact (spaced slashes, 1-4 letter zones, a number with a
  digit, its parts may be spaced), runs only when the whole ref matched
  nothing, and matches each member on its own: two codes the document names
  separately are a fan-out, one code on two lines of a phase is still SX11A,
  and a member with no line is named in words, never a blocker.
- **Every pending row on a record is in its commit group.** A size the reader
  could not place staged as a row with an item and no label; the screen's
  `commitGroups` skipped it, the confirm counted it, and the whole item was
  refused as "changed while you were reviewing" with nothing changed. On a
  schedule such a size is now a note, verbatim, with the reason beside it.
- **The tracker is read TWICE, deliberately.** Its finishes go to the library
  through the finishes-schedule read; "Also read its furniture as an FF&E
  schedule — one charged read" on that review registers the same stored file
  again (`ffe-of:<runId>`, idempotent). The ffe prompt leaves the finish
  entries out and gives the maker, supplier, link, status and dated comment
  fixed labels; a statement no question matches is kept as a NOTE on schedule
  kinds, never on an email.
- **Settling one needs a reason, either way** (`disagreement_resolve`).
  "Keep the bill's" changes only the disagreement's status. "Use this instead"
  is a supersession that keeps the OTHER document's run and page, recomposes
  the checklist, and takes one version. A disagreement that outlives its held
  value can only be kept.

**Feet and inches read as printed on every SCREEN, the millimetres in
brackets** (`composeDimensionCell(rows, note, { mode: "screen" })`, an option
on the one composer, never a second one): `W 3'7" (1092mm)` with an amber
"converted from ft-in" chip. Every FILE keeps the millimetre cell — BWS field 3
is `W***mm` — and any box promising what BWS receives prints the file cell
under the screen cell. A size labelled AFTER its figure (`16" H X 2'-7" DIA`)
or with a colon (`W:540`) is read by the page's own label, the whole-label rule
unchanged (`L` is no slot).

**Measured on the real tracker, local stack, 2026-10-05** (TEST project
T18192): 399 statements, 315 applied to 40 of the bill's 67 items, 35 open
disagreements on 25 items. **STILL OPEN:** a code on two lines of one phase
(PL-FUR-04, GR-FUR-22, GR-FUR-26) waits for a person to choose a line, one
statement at a time; `46CM D , 48CM H` (comma-separated) is still a note; the
bill's `W` on a bed is its LENGTH where the tracker's `W` is its width, so
GR-FUR-08A disagrees red over a convention, which is a person's call.

**A FREE target is re-read too, and a spec-document finish links** (audit E2,
E3, E4, 2026-11-06). `annotateHeld` and the confirm (after its record lock)
both call `occupantSince`: a slot or field another document filled since
staging is the `slot_filled` blocker on the row and a 409 in words at
confirm, never the partial unique index's 500 ("Nothing was written. Check
the logs."), which is what two documents read in parallel and both proposing
SH for one item used to produce. The spec-document confirm and
`createAttribute` link a finish through `resolveFinishCode` over the words
BESIDE the code (`wordsBeside`, because a schedule value like `UPH-07 Velvet
Rose` compared whole was a conflict on every described code): matched links,
conflict and new link nothing and create nothing. The replace path sets
`superseded_by_id` on the retired row, as the other four retire-then-insert
paths always did; without it the disagreement chain walk ended at a retired
row and said "taken off this item" for a value an email had replaced.

### An attribute carries through to the checklist automatically

`src/lib/promote-answers.ts`, `src/lib/confirm-drawings.ts`,
`src/app/api/answers/[id]/route.ts`

`record_attributes` is what a document SAID; `spec_answers` is the checklist.
Nothing connected them, so the Panther sofa showed `W1900 x D790 x H720 x
SH440mm` on screen while its Dimensions *question* sat empty — the summary is
computed for display and no answer was ever written. Confirming a drawing card
now fills the answers its attributes answer, in the same transaction.

Four rules, each a trap rather than a preference:

- **A `tbc` attribute becomes a `tbc` ANSWER, never confirmed**, and a cell
  carrying no digit is never confirmed whatever the attribute said. The sofa
  records four dimensions as TBC and a fabric code reading `TBC – Yarn
  Collective…`; promoted as confirmed, a gate reports satisfied over values
  nobody has decided.
- **A person's answer is never overwritten, and provenance is RECORDED, not
  inferred** (0050, audit E1, 2026-11-06). `spec_answers.source_kind =
  'attribute'` means "composed by `promote-answers.ts` from the record's
  active attributes", whatever document produced them; every fill writes it,
  and fill and retract touch only `missing` or `attribute`. `manual` (typed),
  `email` and `document` (since 0050 ONLY a reviewer confirming a value off a
  specification document straight onto a question) are out of reach.
  `/api/answers/[id]` marks an edited answer `'manual'`, which is what takes
  it out of reach for good. **The history, because it is the trap:** until
  0050 both kinds of row were `document` and the recompose told them apart by
  the run behind `source_id` (`shop_drawings`, or null for a typed spec). The
  bill (`document_kind` null), the schedules, the tracker and email all
  recompose with their own run, so every answer they filled FROZE: a
  correction, a retire, a library edit or a BW standard reached the Specs tab
  and the file but never the checklist, the gates, TGQ, the chase or
  completion, and a RETIRED bill fabric shipped through its answer because
  the export falls through to the answer where no attribute holds the field.
  Never key a recompose on `document_kind` again. `npm run
  db:backfill-answer-provenance` relabels the pre-0050 rows (decision table in
  `src/lib/answer-provenance-backfill.ts`); a relabel takes a version, because
  `bump_version` fires. Until it has run on a database, every projected answer
  written before 0050 is out of the recompose's reach — apply 0050, deploy,
  run it at once.
- **The composed Dimensions answer includes a TBC slot with no figure**
  (`composesIntoCell`, audit F6), so its state is `tbc` whenever the file's
  cell carries a TBC marker; before this a TBC W beside a confirmed D and H
  gave a CONFIRMED answer `D790 x H720mm` while the file read `W TBC x D790 x
  H720mm`.
- **The whole record is recomposed, not the card.** A card supplying only the
  height still recomposes the cell over the width and depth an earlier document
  confirmed, so the attributes are re-read from the table rather than taken
  from the confirmed set. Otherwise the answer says `H720mm` and the record
  says `W1900 x D790 x H720mm`.
- **`composeDimensionCell` is still the only composer.** A second
  implementation is how a screen starts promising what the file does not
  deliver.

A dimension does not reach its field by `spec_field_id` — it carries a SLOT,
and all five compose into BWS field 3 (`json_id`, never the column letter).
An uncategorised record has no questions, fills nothing, and that is not a
failure. Setting a category later creates the answer rows AND recomposes them
in the same change (`setRecordCategory`, audit E5, 2026-11-06), so a bill line
categorised after its confirm gets its bill specs' answers at once.

`source_id` records WHICH document a value came from, and for a composed cell
that is the last contributing slot: a cell built from three drawings has no
single source, and the newest is the one a reader would go and check.

### A spec reaches its BWS field by slot or by field, never by matching a question

`src/lib/spec-dimensions.ts`, `src/lib/spec-finishes.ts`,
`src/lib/spec-document.ts` (`resolveProposals`, `seedTakenFields`),
`src/lib/confirm-spec-document.ts`, `src/lib/promote-answers.ts`

Once the run fan-out landed, the item resolved and the QUESTION did not: all
seven of the pilot email's values read *Question not matched*, because
`requirement_aliases` is empty and "Seat height" scores nothing against a
category that asks "Dimensions". The obvious fix was to seed the aliases. It is
the wrong fix, and finding out why is the whole of this section.

**"Seat height" and "Overall" are the SAME question.** There is one Dimensions
question and all five slots compose into it, so aliasing both onto it puts two
proposals on one answer and hits `duplicate_target` — the screen refuses them,
correctly. **A finish is worse**: COM 1 / COM 2 / Main timber finish is decided
by what the record already holds, so an alias would have to name one slot up
front and the next item contradicts it.

So an email's dimension or finish becomes a `record_attributes` row, exactly
like a drawing's, and the checklist answer follows from `promote-answers.ts`.
That is not a workaround — it is the architecture already in the building:
`record_attributes` is what a DOCUMENT said, an email is a document, and
`composeDimensionCell` stays the single composer. Writing the answer directly
would leave a Dimensions cell no attribute backs, and the next drawing confirm
recomposes from the attributes alone and silently wipes what the email gave.

Nine things are load-bearing:

- **An email writes prose; `parseDimensionFigure` is strict.** "445mm (measured
  to top of cushion, compressed)" is not one bare figure, so `readDimension`
  splits the leading figure, the unit and the QUALIFIER — and the qualifier is
  kept as a note attribute, because "445" alone does not say what it measures.
- **The unit comes from the wording or from nowhere.** There is no magnitude
  fallback anywhere in the dimension model and there is none here. A missing
  unit is amber and asked for on screen, and it is NOT a blocker:
  `composeDimensionCell` renders an underived figure verbatim in a bracket
  saying why, which is a truthful cell.
- **ONE PART PER PROPOSAL.** "Overall — W660 x D685 x H680mm" is three slots
  and therefore three proposals, sharing a `sourceOrdinal` so the screen shows
  one row. Two slots behind one version would mean two writes behind one
  acknowledgement.
- **A finish fires only on the document's own CODE.** `classifyCallout` reads
  words too, which is right for a drawing's short caption and wrong for prose:
  "seat upholstery build — loose or fixed?" would read as a fabric on one word
  and land a build instruction in COM 1. `readFinish` refuses anything with no
  `UPH-07`-shaped code, the one exception being a material label whose value is
  TBC, which carries no substance to misread.
- **The BWS slots are claimed across a WHOLE document, and `taken` is
  therefore a parameter.** `rematchProposals` re-resolves one observation at a
  time, so a fresh map per call gave all three of the pilot email's fabrics
  COM 1 — which the confirm would then refuse on 0007's unique index. Seeded
  once by the caller, from the record's existing attributes AND from every
  proposal the pass is not re-resolving.
- **`targetKey` names all four coordinates** — record, question, dimension
  slot, BWS field. It left the field out, so an observation that used to be a
  checklist answer and now reads as a fabric keyed identically both ways, and
  re-matching silently handed back the originals. Four of the pilot email's
  five finishes refused to re-match, and nothing said so.
- **Retire before insert, version-checked.** Both partial unique indexes are
  `where status = 'active'`, so the database decides that order. The occupant's
  version is re-checked at confirm and one that moved since is REFUSED, because
  the value a reviewer agreed to drop is not the value that is there.
- **A COMPOSED cell may be recomposed by any document.**
  `applyAnswerFills`' guard let only a shop-drawings run rewrite a cell, so an
  email giving W/D/H and a second email giving SH left the record holding four
  slots and its answer showing three. The `jsonId` branch IS the composed
  dimensions cell and nothing else, and a composed cell is a PROJECTION of the
  attributes rather than an answer anybody authored — so it must always equal
  their composition. `manual` and `email` stay out of reach, so a person's own
  checklist answer is still never overwritten.
- **Not everything is a slot, and that is correct.** `ARM HEIGHT` is named in
  the dimension invariant as the case a substring rule destroys; it has no
  slot, no finish code and no checklist question, so it stays unplaced. That is
  a true statement about the requirement matrix, not a failure to read.

**Import cycles were the cost.** `spec-dimensions` and `spec-finishes` need
`TBC_TOKENS`, `containsPhrase`, `deferredToSomebody` (now in `spec-vocab`) and
`classifyCallout` (in `drawing-document`), while `drawing-document` needed
`findRecordsByRef`, `normaliseRef` and `RecordEntry` from `spec-document`. Those
three moved to the leaf `src/lib/record-refs.ts` and everything is re-exported
from its old home, so no caller changed. A cycle between two of these works
right up until one is read at import time by the other, and then fails
somewhere unrelated.

### The record is the unit of commit, and a half-applied card is the failure

`src/lib/confirm-spec-document.ts`, `src/app/api/imports/[id]/confirm/route.ts`

One confirm request names ONE record and ALL of its currently pending assigned
proposals, with the versions the reviewer saw. The server checks that set
against the live grouping, so a proposal added or retargeted since the page
loaded refuses the request rather than committing a card the reviewer never saw
whole. Any failure rolls back everything: three finishes written and the fourth
refused looks finished, and the missing one is invisible until somebody notices
the answer is wrong.

`status = 'confirmed'` on an intake run means **no pending proposals remain** —
applied or explicitly ignored. Label it *Review complete*, never "complete":
settled answers are a different question. Restore accepts **ignored only**; an
applied proposal is immutable history, and undoing an answer is something a
person does on the record screen, on purpose.

### A spec can be retired, and a revised drawing replaces one

`db/migrations/0016_attribute_supersession.sql`, `src/lib/attribute-retire.ts`,
`src/lib/confirm-drawings.ts`, `src/lib/promote-answers.ts`

`record_attributes` carried `status`, `retired_at` and `retired_by` from 0007
and nothing ever set them, while three blocker messages told a reviewer to
"retire the old value". A revised drawing therefore could not land: the partial
unique indexes refused the insert and the remedy did not exist.

- **Retiring recomposes the checklist.** This is the half that is easy to leave
  out and wrong to. Confirming a drawing writes the attribute AND the answer it
  fills; retiring only the attribute leaves the checklist reporting a confirmed
  fabric the record holds no statement for, and **the export still ships it** —
  a confirmed answer is exported whether or not an attribute backs it.
  `planAnswerRetractions` puts such an answer back to `missing`. A person's own
  answer is never touched, and the change records that it now stands on nothing.
- **The replace acknowledgement is per (observation, RECORD).** A card fans out
  one record per run, and the mock-up run's COM 1 may hold a different old value
  from the main run's — keyed on the observation alone, a confirm could retire a
  value the reviewer never saw on the VE record. The occupant's version is
  re-checked at confirm; one that changed since is refused, not replaced.
- **Retire before insert**, and the database decides that: both partial unique
  indexes are `where status = 'active'`, so the reverse order cannot commit.
- **Reversible**, per `house/data-safety.md`. A restore is refused when
  something else now holds the slot, or when a later drawing superseded it, and
  both refusals name what is in the way.

### The finishes library is the truth; the attribute is the evidence

`db/migrations/0018_project_finishes.sql`, `src/lib/finishes.ts`,
`src/lib/finish-edit.ts`, `db/backfill-finishes.ts`

`record_attributes.material_code` was a dead column: no index, no uniqueness,
no edit path at any stage, no way to ask which items carry a code. Ten items
sharing a fabric were ten unrelated strings. This is the register CLAUDE.md
excluded as `project_materials`; the condition `docs/stack.md` set for building
it — "until extraction is producing them" — has been met since M2, and the
pilot's finishes schedule being **confirmed absent** makes edit-once the only
correction mechanism there is.

`project_finishes` is project-scoped, because the same client code means
different things on different projects. The attribute keeps the drawing's exact
words so a value stays checkable against its page; the CELL renders the library.

- **`composeFinishCell` has three callers** — the export composer, the record
  screen, and `planAnswerFills`. If the export rendered the finish and the
  checklist kept the attribute's text, editing the library would change forty
  export cells while every visible row said something else. Same rule as
  `composeDimensionCell`, in a second place.
- **The state is the weaker of the two.** A `tbc` finish can never produce a
  confirmed answer, whatever the attribute said. The Panther sofa's drawing
  says `TBC – Yarn Collective Tessarae`: the library knowing what the code is
  does not make that item's fabric decided.
- **Normalisation is case and whitespace only.** `CH-01.1` and `CH-01-1` stay
  two finishes. A normaliser clever enough to merge them is clever enough to
  merge two codes a client meant to keep apart, and there is no way back.
- **A bare code and its ZONE twin are one finish, and that is a LOOKUP, not a
  normaliser** (Max, 2026-10-13, checked on the Aman bill, which writes
  `TIM-13` on three rows and `GR-TIM-13` everywhere else). `findFinishByCode`
  (`finishes.ts`) tries an exact match first. Only when that finds nothing does
  a two-part `XXX-NN` read as the library's ONE `ZZ-XXX-NN`, or a three-part
  code read as a bare twin that no other zone shares. **Two three-part codes
  never fold** (`GR-MTL-01` and `PL-MTL-01` stay two), and a pointed code
  (`CH-01.1`) is neither shape. Every read this way prints its sentence ("read
  as GR-MTL-01: …"). The confirm, the bill review and the drawings card's
  "already recorded" all call it. Duplicates stored before it are merged by
  `npm run db:backfill-finish-twins`. **Known gap:** a fresh confirm files a
  bare code it meets first as the canonical row, where the backfill prefers the
  zoned one.
- **`kind` is SUGGESTED and never written.** The rule was "never inferred", on
  the grounds that `classifyGroup` already guesses a group from words in a
  label and a second guess stacked silently on it produces a register full of
  confident mistakes. That reasoning stands and nothing writes a kind on its
  own. What changed on 2026-09-18 is WHO DECIDES: `suggestFinishKind`
  (`src/lib/finish-kind-guess.ts`) reads the client's own code prefix and then
  the description's material words, the row prints the kind as a dashed blue
  button with its evidence beside it, and a person's click files it. The
  `level_suggested` rule (0025) in a second place — the register cannot fill
  with mistakes, because every entry in it was agreed to by somebody looking at
  the row. **A trim is a kind** (0049, 2026-10-15). The Ronnie Scott's COM
  list files `TR_01`… beside its fabrics. It is suggested from `TR` + a number
  (exactly: `TRV-01` is not a trim), from a bill's `F-TR-nn`, or from the word
  "trim", read before the material the trim is made of. A trim still fills no
  BWS field.
- **A CONFLICT links nothing.** Where the library has committed to a
  description and a new drawing says something else, the attribute stays
  unlinked and shows on the finishes page as a code needing a person. Linking
  would make the item render the library's words while its own page said
  otherwise.
- **`supplier_raw` does NOT satisfy "suppliers by modelled Capsule ID".** There
  is no supplier register in this app and no Capsule data in this repo; the
  `_raw` suffix marks it as what a document said. That invariant remains unmet.
- **Swatches arrive by hand — EXCEPT from a bill or a finishes schedule**
  (2026-10-05; the schedule since 2026-10-15, above). A person
  uploads one and must say which document and page it came from. Asking the
  model for swatch regions is a tool-schema change, which means re-reading and
  re-paying for every document already read. A bill's fabric line is the
  exception: its row picture becomes the code's swatch at confirm — see "The
  bill fills the finishes library" below.
- **It is a TAB on the project, beside the runs** (2026-09-17). It was a grey
  line on the Overview tab, so it disappeared the moment anybody clicked a run.
  `/dashboard/projects/[id]/finishes` still exists and REDIRECTS to
  `?tab=finishes`, because every link written before that date points at it.
- **A filter narrows what is LISTED, never what an edit touches.** Search, kind
  and run are client-side over the payload already loaded. The run one is the
  trap: a finish is project-scoped, so correcting one while looking at MUR still
  corrects it on the main run and the VE. The used-on count therefore stays the
  TOTAL with "n on <run>" beside it, the expansion lists every use including the
  runs the filter is hiding, and the edit panel goes on quoting the total.
  Showing the filtered number as the blast radius is how somebody changes a
  confirmed fabric believing it reaches one item when it reaches eleven.
- **`editFinish` REPLACES the row; an omitted field is written as null.** So the
  one-click kind picker on each row sends every field the finish already holds,
  not just the kind — a partial patch there silently deletes the description,
  supplier and reference. Anything else that patches a finish must do the same,
  or merge `undefined` in `editFinish` deliberately.
- **The kind is suggested, filed one click at a time, and the banner counts
  what the button files.** All eleven finishes on the sandbox Panther project
  had none, which made the kind filter dead. Six things about it:
  - **The word lists are shared and the callout half is FROZEN.**
    `src/lib/material-words.ts` is a leaf holding both, so the drawings path and
    the library cannot drift apart about whether `WD-05` is a timber. Everything
    named `*_CALLOUT_WORDS` is exactly what `classifyCallout` matched on before
    the move: `upgradeCalloutGuesses` runs at READ time, so widening those would
    silently re-classify rows on every pack already read. The library's extra
    vocabulary is additive and used by nothing else.
  - **A material word is not a part word.** The timber list has always carried
    `feet`, `leg`, `legs`, `frame`, which is right for a caption whose LABEL is
    the part and wrong for a description, where "for the legs" says where the
    finish goes. The library reads `TIMBER_MATERIAL_WORDS` only.
  - **Leather is read before fabric**, because `FABRIC_CALLOUT_WORDS` contains
    `leather`, `hide` and `suede` — the drawings path cannot tell them apart and
    does not need to, and `FinishKind` can.
  - **The route re-derives every kind from the live row** and the client sends
    ids and versions only, so the button can only file what the screen offered.
    The `questionTier` rule: a request that tries to SET one is not honoured.
  - **One click is ONE change set**, not N. `editFinish` now takes an optional
    `changeSetId` to attach to, because it otherwise calls `changeSetForEdit`
    per finish and eleven codes filed in one press become eleven entries in the
    trail. `finish_edit` is in `REASON_REQUIRED_KINDS` AND has a database
    constraint behind it, so the bulk route must supply a reason — found by
    pressing the button, which reported "A finish edited has to say why" and
    correctly wrote nothing.
  - **The picker is offered inline only on a TBC finish** — the route's own
    rule: a confirmed finish is a decision and changing it needs a reason, which
    the Edit panel collects. So the banner counts the TBC-and-suggested rows,
    not every suggestion, or the number on the button would not match what it
    does. Where nothing can be suggested the row keeps the empty picker and the
    screen says why.

### A line's common specs are a reading, and an edit to one fans out

`src/lib/configuration-common.ts`, `src/lib/configuration-family.ts`,
`src/app/api/records/[id]/common/route.ts`, `src/components/records/BillLineConfigurations.tsx`,
`src/lib/record-label.ts`, `db/migrations/0039_variant_ordinal.sql`

Max, 2026-09-23: S-301's five types numbered 34–38 meant nothing (they are now
**12.1–12.5**, the ordinal under the line), and the bill line's own screen
showed nothing — it should show the COMMON specs, and changing one there should
change all five. **No inheritance** (decided that day): each configuration keeps
its full copy, so the export, gates, TGQ, chase and completion are untouched. A
row is common when every configuration holds exactly one row with the same
value, unit, state and qualifier; otherwise it DIFFERS and is edited on the
configuration's own screen, never as common. The edit re-derives the set under
lock and refuses WHOLE on a moved version, a changed set or a row no longer
common; one change set, one version per configuration, `spec_records.version`
untouched. The 0039 backfill disables `spec_records_bump_version` for one
statement as owner, because a bump would stale every unsent chase draft; for
the same reason `coverageStaleReasons` forgives exactly one label change — a
frozen pre-0039 label — and nothing else. Exports sort a configuration under
its line; row order never changes what a BWS import replaces.

### A BW standard sits beside the client's words, and one function decides which ships

`db/migrations/0041_bw_standard.sql`, `src/lib/bw-standard.ts`
(`composeAttributeStatement`, `stateUnderStandard`), `src/lib/attribute-standard.ts`,
`src/lib/standards-backfill.ts`, `src/components/records/BwStandardControl.tsx`,
`src/components/imports/ObservationRows.tsx` (`PaletteChoice`)

Picking a BWS palette option on a drawings row OVERWROTE the observation's
value, and the confirm wrote only the value, so the client's words ("feet dark
tinted wood as per approved sample") survived nowhere but the staged JSON. Max:
*"we need to record what the client said and a BW standard finish … the BW
standard finish shouldn't override what they specified."* `value` is what the
document said, always; the pick sets `standard_*` (`proposed` | `agreed` |
`tbc`). `composeAttributeStatement` is the ONLY choice between the standard,
the finishes library and the page's words — `renderAttributeValue` and
`planAnswerFills` both call it, so never read `value` directly for a cell or an
answer. A proposal (or a TBC standard) holds the answer at TBC; the client's
AGREEMENT settles it whatever the client first wrote, because the agreement is
the decision. The check sheet carries **Client specified** and **BW standard**
columns beside the exported cell. Every reader of a staged drawings run loads
`loadFieldsWithPalettes`, or the confirm writes an option as the client's
words. Found on the way and fixed: `loadRecordAtoms` never selected
`qualifier`, so 0029's placement had never reached the BWS file.
