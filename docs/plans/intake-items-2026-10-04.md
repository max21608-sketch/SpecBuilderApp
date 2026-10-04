# Intake reads the document, not the page (Opus 5.5, item-centric drawings, Aman pack)

*2026-10-04. GO given the same day. Decisions are at the end.*

## Context

The 2026-10-01 catch-up (`docs/plans/catchup-2026-10-01.md`, on staging at
`459bc2e`) showed the Aman bill reading well and one single-page desk drawing
going wrong: two figures in Width, a section height in Depth, 68 rows to review
and the true depth folded away. Max's diagnosis (2026-10-04): the read is
**structured around the page**, so every real-world nuance — an item drawn over
two pages, a codeless second sheet, a title block naming the item differently
from the bill, four configurations on four pages — becomes another piece of
glue code, and "there are endless issues that arise from it". He also wants
**Opus 5.5**, and intake work to move to the **Aman pack** (P18181) as the
working set.

What the code does today (origin/staging `25badb9`, mapped 2026-10-04):

- `src/lib/anthropic.ts` sends the PDF whole as a native `document` block to
  `claude-opus-5` (effort high, adaptive thinking), with the tool **forced**
  (`tool_choice: {type:"tool"}`). Opus 5.5 rejects forced tool choice with a
  400. That is the only reason it is not on 5.5 (comment at `anthropic.ts:37`).
- `DRAWINGS_TOOL` (`extraction-schema.ts:530`) asks for **one entry per item per
  page** (`page` is a single integer), **every** dimension figure on that page
  (7 required fields each, up to 120), and a separate `codeGroups[]` to say
  which pages belong together.
- `stageDrawings` (`drawing-document.ts`, 4,511 lines) turns each page entry
  into its own `DrawingItem`. Roughly a dozen helpers then glue pages back
  together or second-guess the model: `canonicalCode`, `groupItemsByCode`,
  `variantLettersByItem`, `crossPageClaims`, `duplicateTargets`,
  `repeatedObservations`, `dedupeMeasured`, `redundantOverallRows`, `suggestUnit`,
  `configuration-cards.ts` (699 lines) and much of `clash-resolution.ts`.
  The confirm commits **one page at a time**.
- No golden exists for drawings. `measure:drawings` counts symptoms and scores
  nothing.

The intended outcome: one read per document that returns **the things to make**,
each spanning whatever pages describe it. Each item carries its overall size
(one figure per slot by construction, with the view and page it came from), its
configurations as the document names them, and its finishes. Every other figure
is kept, but secondary. It runs on Opus 5.5, is scored against a golden built
from the Aman and Panther packs before and after, and the glue is retired for
new reads only. Runs already read keep working, frozen.

---

## Phase 0 — a golden, and a harness that scores a read with no database

Nothing below is judged without this. It is the §6 rule ("measure first") and
the only thing that stops this rebuild being tuned on one desk.

1. **Golden files**, outside the repo (`~/dev/localstack/drawings-golden/`; real
   values never enter the repo). One JSON per document:
   `{file, items:[{codes:[...], pages:[...], configurations:[names],
   overall:{W,D,H,SH,Dia} in mm and as printed, finishCodes:[...]}],
   nonItemPages:[...]}`.
   - **Aman**: the 29 distinct one-page drawings (imperial, dense A1 sheets).
   - **Panther**: the 11 documents, chosen because they hold every multi-page
     case — S-200 on two pages with two titles, S-100's codeless second page,
     S-301's four configurations, S-203's unlabelled `80 x 70 x 90 cm`.
     Several answers are already recorded in `CLAUDE.md` (S-203 `W800 x D700 x
     H900`, S-200 `W840 x D790 x H720 x SH460`, S-100 `W1900 x D790 x H720 x
     SH440`).
   - **Who writes it**: see Questions. Recommended: Claude drafts each entry by
     viewing the rendered page, marked `verified: false`, and Max (or Matthew)
     ticks or corrects each one. Only verified entries score.
2. **`tools/eval-drawings.ts`** (`npm run eval:drawings -- --golden <dir>
   --files <dir> --pipeline v3|v4 [--model] [--effort]`). It calls the
   extraction function directly on local PDFs, with no DB, no queue and no blob
   store, and saves every raw response outside the repo so re-scoring costs
   nothing. It scores:
   - item grouping (pages → items, exact);
   - code resolution (bill code found);
   - per-slot overall dimensions (match within 1 mm after conversion; a figure
     in the wrong slot counts as wrong, not missing);
   - configuration count and names;
   - finish-code recall;
   - rows a reviewer would have to touch;
   - tokens, cost and wall time.
3. **Baseline**: run the current pipeline (v3, Opus 5) over both packs and
   record the score in the plan doc. This is the number to beat.

Files: new `tools/eval-drawings.ts`, `tools/drawings-golden.ts` (schema + scorer,
pure, unit-tested on synthetic goldens in `tests/lib/`). Reuses
`composeDimensionCell`/`toMillimetres`/`feetAndInches` (`src/lib/dimensions.ts`)
for conversion, so the scorer and the app cannot disagree about a millimetre.

## Phase 1 — Opus 5.5 under every extraction, with no forced tool

1. `EXTRACTION_MODEL = "claude-opus-5-5"` in `src/lib/anthropic.ts`. Replace the
   forced tool with **structured outputs**: `output_config: {effort, format:
   {type:"json_schema", schema}}`, reading the JSON from the text block.
   - The schema is derived from each kind's existing tool `input_schema` by one
     pure function, `toOutputSchema()`. It strips what structured outputs reject
     (`maxLength`, `maxItems`, `minimum`, `minItems`); the Zod schemas
     (`extraction-schema.ts`) still validate every response afterwards, so
     limits are enforced exactly as now.
   - One implementation, called by every caller: `extractSpecDocument`, the bill
     structure read (`boq-structure.ts:555`), and the large-PDF classify
     fallback (`document-classify.ts:73`). Haiku classify keeps its forced tool,
     which Haiku 4.5 still accepts.
2. **Effort is set explicitly.** Opus 5.5 defaults to `medium`, one level below
   today. Extraction starts at `high`; Phase 0's harness compares `medium`,
   `high` and `xhigh` on the golden before the value is fixed. The 740 s < 770 s
   < 800 s inequality (`extraction-claim.ts`, `tests/lib/extraction-timing.test.ts`)
   is re-checked against the measured times. If `xhigh` wins and does not fit,
   that is Max's call (the 1800 s beta).
3. **Refusal fallback**: `fallbacks: "default"` with beta
   `server-side-fallback-2026-07-01`. Without it a classifier refusal on a
   drawing is a terminal failure. Max to confirm — see Questions.
4. Parse changes: `stop_reason` `refusal` and `max_tokens` keep their current
   outcomes. `no_tool_use` becomes `no_json` (a text block that is not valid
   JSON). Mid-stream SSE error handling (`streamedErrorType`) is unchanged.
5. Tests: `tests/lib/anthropic*.test.ts` (request shape, no `tool_choice`,
   effort present, schema stripped), `toOutputSchema` unit tests over every
   kind's tool, and the timing test.

**Gate**: run Phase 0's harness with the *current* v3 schema on Opus 5.5.
That separates "a better model" from "a better question" — both numbers go in
the plan doc.

## Phase 2 — the item-centric read (staged `schemaVersion: 4`)

### The question asked (new `DRAWINGS_ITEMS_SCHEMA`, new prompt)

The prompt is rewritten around one instruction: *read the whole document and
list the things to be made; an item may span pages, and a page may hold several
items or none.* Per item:

| Field | Shape | Replaces |
|---|---|---|
| `codes` | every code the item is titled by, the bill code first if one is printed | `itemCodeRaw` + `codeGroups` + `canonicalCode` |
| `name`, `pages[]` | as printed; every page that describes it | per-page entries + `groupItemsByCode` |
| `overall` | `{width, depth, height, seatHeight, diameter}`, each `null` or `{valueRaw, unitRaw, view, page, evidence}` | `slot` on each of 120 rows; two-widths blocker |
| `configurations[]` | `{name, nameRaw, differsIn, pages[]}`, only where the document itself tells them apart | `relationship`, `variantLettersByItem`, `depictsConfigurations` |
| `finishes[]` | `{labelRaw, valueRaw, codeRaw, configurations[], page}` | `materials[]` (now with a page each) |
| `otherDimensions[]` | `{labelRaw, valueRaw, unitRaw, view, page}` — secondary, folded | the every-figure transcription |
| `notes[]`, `pictureRegions[]` | with page | `notesRaw`, `viewRegions` |
| `uncertain[]` | `{about, why}` — what the model could not settle, in words | nothing: today doubt is silent |

Plus document level: `nonItemPages[] {page, why}` (cover, legend, general
notes), so that a codeless page is a decision the model states rather than an
empty card.

Guidance the prompt gains that it lacks today:
- section views carry depth or height, never width;
- numbered elevations;
- on a curved or shaped item the plan's top figure may not be the outside;
- feet-and-inches kept verbatim (the existing rule stays);
- **one figure per slot, and say why**;
- "null is a good answer" stays.

**One figure per slot is enforced by the schema's shape**, not by a blocker
afterwards.

### Staging (`stageDrawingsV4` in a new `src/lib/drawing-items.ts`)

Maps each model item onto the **existing** `DrawingItem` / `DrawingObservation`
shape, so the review screen, the autosave route and the confirm need the
smallest change:

- one `DrawingItem` per model item; `pages: number[]` added beside `page` (kept
  as the first page, for readers that know only one);
- every `DrawingObservation` gains `page?`, the page its value is on, so
  `record_attributes` keeps true provenance when an item spans pages;
- `overall` slots become dimension observations with `dimensionSlot` set and
  `slotSuggested: false`. Disagreement with the printed label (via
  `normaliseDimensionSlot`) is still flagged;
- `otherDimensions` become measured rows with `isOverall: false`, folded as
  today (`foldableRow`);
- `configurations` map onto the named-configuration fields already on
  `DrawingItem` (`configurations`, per-observation `configurations`) — the
  machinery from `configurations-2026-09-23.md`, reused;
- `uncertain[]` becomes an amber notice on the card (and a blocker only where it
  names an overall slot);
- **kept, applied at staging exactly as now**: unit parsing, `feetAndInches`,
  `parseCombinedDimensions` for printed prefixes, `classifyCallout` for the BWS
  field, `mergeNoteBlocks`, TBC markers, standards.

**Not run for v4**: `codeGroups`, `canonicalCode`/`groupItemsByCode` grouping,
`variantLettersByItem`, `crossPageClaims`, `dedupeMeasured`'s cross-view collapse,
`suggestUnit`'s magnitude vote (the model states the unit, or nothing, and a
missing unit is asked for, as now), `dimension-guess.ts`. Each is gated on
`schemaVersion < 4` inside `assertStagedDrawings`, never deleted. v1–v3 runs read
exactly as today.

### Resolution and confirm

- `resolveDrawingTargets` takes `codes[]` (all of them) plus the filename. The
  suffix match from 2026-09-30 is unchanged. No new matching rule.
- `confirm-drawings.ts`: source page per attribute = `observation.page ??
  item.page`. Confirming one item writes all its pages in one transaction,
  which is the "never commit a card nobody saw whole" rule, now true across
  pages.
- Configurations confirm through `ensureVariant` as they do today for named
  configurations.

### Files

- `src/lib/extraction-schema.ts` — new schema + Zod (`RawDrawingItemV4`); old
  `DRAWINGS_TOOL` stays for re-reading old runs' raw.
- `src/lib/anthropic.ts` — new `PROMPTS.shop_drawings` (old text kept as
  `shop_drawings_v3` for the harness).
- New `src/lib/drawing-items.ts` (staging v4).
- `src/lib/drawing-document.ts` — version gates in `assertStagedDrawings`,
  `stageDrawings` dispatch.
- `src/lib/confirm-drawings.ts` — per-observation page.
- `tools/measure-drawing-reading.ts`, `tools/dump-drawing-run.ts` — understand
  v4.

### Gate

Phase 0's harness, v4 against the baseline, on both packs. Ship only if v4 is
at least as good on every measure and better on grouping and overall slots.
The numbers go in `docs/plans/README.md`.

## Phase 3 — the review screen for a v4 item

Most of it exists. A v4 item renders on the existing `DrawingItemCard` /
`ConfigurationCard`. Named configurations already render as tabs and confirm
per row through `namedConfigurationPlans` (`confirm-drawings.ts:429`), the
machinery from 2026-09-23, so a v4 item with configurations needs no new card.

1. **Pages on the card.** A page strip from `item.pages`; each row shows its
   page beside the "drawing said" line. The picture panel offers any of the
   item's pages.
2. **"Use as W / D / H / SH / Dia" — the slot swap.** Today the row's
   "Dimension / BWS field" select (`ObservationRows.tsx:893`) already moves a
   folded note into a slot, but it never clears the previous holder. The result
   is the "Two of these are the width" blocker (`drawing-document.ts:1739`).
   - Add a `swapSlot` row op to the PATCH route (`api/imports/[id]/route.ts`,
     `DrawingPatch`). In one locked write it sets the slot on this row and
     returns the previous holder to a note, each row version-checked.
   - On the folded rows, show the five slot letters as small `quiet` buttons
     beside each figure, so pointing at a figure is one click (Sebastian,
     42:10).
   - The save functions exist twice, in `DrawingsReview.tsx` and
     `PackDrawingsReview.tsx`. Both get the op. Merging the two copies is out
     of scope.
3. **The unit control says what it does.**
   - The per-row select (`ObservationRows.tsx:776`) gets the visible label
     "printed in". `BulkUnit` becomes "Every figure on this card is printed
     in: mm · cm · in".
   - A card-level **"Show in mm"** toggle (client state, display only) prints
     each figure as `1702 mm (5'-7")` using `toMillimetres` per row. Nothing
     stored changes (D3).
4. **`uncertain[]`** renders as amber notices at the top of the card. One
   naming an overall slot is a blocker until the reviewer touches that slot or
   dismisses the notice.

Tests: component tier for the swap buttons, the label and the toggle; db tier
for `swapSlot` (two rows, one transaction, a stale version refused).

## Phase 4 — the pack: bill → finishes schedule → drawings (D1)

1. **A finishes-schedule schema with a code field.**
   - Today `TOOLS.finishes_schedule = OBSERVATIONS` (`extraction-schema.ts:1219`),
     whose `RawProposal` has no code. The new `FINISHES_SCHEDULE_SCHEMA` is per
     entry: `{codeRaw, kindRaw, descriptionRaw, substrateRaw, finishRaw,
     colourRaw, sheenRaw, supplierRaw, referenceRaw, appliesToRaw, page}`.
     Each `*Raw` is verbatim or null, nothing composed.
   - It is a new kind so old runs stay valid: either `document_kind
     finishes_schedule` with `schemaVersion: 2`, or a CHECK widening — a
     migration that re-lists the CHECK from the LIVE constraint, the 0032
     lesson.
2. **Its review and confirm.** The schedule stages as a list of finishes, not
   as record proposals. Its review reuses `BulkAddFinishes`' preview: new /
   already held / repeated / **conflict** (via `resolveFinishCode`,
   `finishes.ts:221`). The confirm calls `createFinish`
   (`finish-edit.ts:99`) per new code, and `editFinish` only where the library
   row is still empty, which is the edit-once rule. A conflict links nothing
   and is listed for a person, exactly as on a drawing. One change set, kind
   `finish_edit`, with the schedule as evidence.
   - Substrate, finish, colour and sheen go into `description` and `notes`
     today, kept apart in the text. Separate columns wait for Claudia's sheets
     and Matthew's TGQ answer (H). That is recorded, not built.
3. **The pack screen**
   (`dashboard/projects/[id]/intake/[batchId]/page.tsx:268–506`).
   - `packSteps` gains the schedule between the bill and the drawings;
     `stepDone`, `currentStep`, the numbering and the copy at `:406` follow.
   - The drawings step says when no schedule is in the pack, without blocking:
     a pack without one is normal.
   - Drawings already resolve their finish codes against the library at
     confirm (`confirm-drawings.ts:649`). With the library filled first, they
     land on finishes already described.
4. **Classify by content.**
   - The classify prompt (`document-classify.ts:114`) and `DOCUMENT_GENRES`
     (`document-kinds.ts:24`) gain one sentence: a tracker or register listing
     finish codes with materials is a finishes schedule, whatever its name.
     The Aman "OMS and FF&E Tracker" is the test.
   - Unsure still fills nothing in.

## Phase 5 — the bill review (F, I)

1. **Correct a size slot before confirm.**
   - The plan is recomputed on every read and never stored
     (`bill-description.ts:265`, review GET `route.ts:874`, `confirm-boq.ts:324`),
     so the override is a staged line field. Add `slotOverrides?: Record<string,
     DimensionSlot | "note">` (keyed by the part's printed label) to
     `StagedBoqLine` (`boq-import.ts:136`). Accept it in `patchBoqLine`
     (`route.ts:925`). Apply it inside `planBillDescription`, so the review and
     the confirm read the same answer.
   - UI: the D-without-W caution in `BillDescription.tsx` gains "It's a
     diameter" / "It's the width" buttons.
2. **Bill thumbnails.**
   - `read-excel-file` cannot see images. `exceljs` (already a dependency,
     export only) can: `worksheet.getImages()` gives anchors whose
     `tl.nativeRow` maps to the line's 1-based `lineNo`.
   - At bill confirm, an image anchored on an item's row is stored as that
     record's `item_image` attachment, the same row a drawing crop writes. It
     is uploaded server-side under `projects/<id>/`.
   - A later drawing crop replaces it. A bill picture never replaces a drawing
     crop.
   - The review shows the thumbnail per line.
   - Proportionate: about 4.5 MB AMB workbooks. Measure the parse time on the
     real file first; drop to "recorded, deferred" if it costs more than a few
     seconds.

## Phase 6 — the Aman pack in, end to end, on the local stack

Fresh TEST project `TEST: Aman pack in full (2026-10-xx)`: the bill (seeded
layout), then the OMS & FF&E Tracker as the schedule, then all 29 drawings in
one pack. Done means:
- every bill line resolved or deliberately left;
- every drawing's item on its line;
- overall sizes matching the golden;
- the export's dimension column read against the golden.

Then the four checks with the database tier on the local stack, a browser walk
at 1920 and at 300 lines, and screenshots for Max. Promotion to staging and
pilot is Max's.

## How it runs, and in what order

- **Order**:
  - Phase 0 → Phase 1 → measure (gate 1) → Phase 2 → measure (gate 2) →
    Phase 3.
  - Phases 4 and 5 run beside 2–3 on disjoint files: schedule and pack screen;
    bill review.
  - Phase 6 last.
- **Who**: the main session orchestrates, writes the briefs, reviews every diff
  and does all browser verification. Opus subagents write the code, one per
  phase, each in its own worktree under `~/dev/worktrees`. At most two at once
  (8 GB machine).
- **Where**: everything is verified on the LOCAL stack with copies of the real
  Aman and Panther files (`~/dev/localstack/miami/`, `.../panther/`). The
  sandbox, pilot and SharePoint stay read-only for Claude. Charged reads happen
  only on the local stack or through the harness, never on the sandbox.
- **Landing**: each phase lands on `staging` after diff review, the four
  checks with the database tier (`npm run checks:local`), and its own gate.
  Promotion to pilot, and any migration on the sandbox or pilot, are Max's.
- **Measurement, the lower-API-cost version** (Max, 2026-10-04):
  - On the Max subscription, in this session, free of API cost: drafting the
    golden, and trying prompt wording on a handful of drawings through
    subagents before any API read. Only promising versions reach the API.
  - On the API (the app's own key, billed to the API account):
    - baseline v3 / Opus 5: 40 reads;
    - v3 on Opus 5.5: 40;
    - v4 on Opus 5.5: 40;
    - small effort check: ~10.
  - Total about 130 reads, **roughly $20–$60**. The price per read is
    estimated from the one real figure, the merged Panther read at about 1k
    output tokens per page; the harness records real usage from the first batch.
  - **Runs without asking**, at Max's instruction. Stop and report only if API
    spend passes **$100**.

## Phase 7 — the Aman project in PILOT, correct, with as little hand-editing as possible

The end state Max asked for: P18181 in pilot, usable and correct.

**One constraint shapes this phase.** The organisation policy makes pilot
read-only for Claude: Claude may read it (SELECT, screens) but not create,
upload or confirm there, and confirms are a human gate in this app anyway. So
Max's part is pressing buttons, not editing. Everything is prepared so that
little else is needed:

1. **The code reaches pilot.** `staging` → `pilot` fast-forward (Claude, as on
   2026-09-30). Max runs any pending migration and seed on pilot, using the
   exact `--yes-pilot` commands handed over, after a backup. Max checks the
   deployment (`/api/auth/me` at the SHA, the chip).
2. **Proved first on the local stack** (Phase 6): the same files, the same order,
   scored against the verified golden. Pilot only gets a pipeline already shown
   to read this pack correctly.
3. **Max's session on pilot** (~30–45 min):
   - create the project, `P18181 v3 — Miami Beach`;
   - drop the whole folder in one go (classify files it; the four
     non-specification files and two duplicates are left out by a list Claude
     provides);
   - Read all.
4. **Claude checks pilot's reads read-only**, against the golden, before Max
   confirms anything. The output is a per-card list: "confirm as is", or "change
   X to Y" (record, field, old, new) for the few that need it. A correct read
   needs no edit; the target is that most cards are "confirm as is".
5. **Max confirms** card by card from that list. Then Claude reads back the
   confirmed records read-only and reports any record whose overall size,
   finishes or configurations differ from the golden. The export check sheet is
   Max's to produce, as before.

Done means: every bill line on pilot carries its item; overall sizes, finishes
and configurations match the verified golden; the reported differences are
zero or each one is explained.

## Also, on confirmation

- `CLAUDE.md`/`AGENTS.md`: intake work is on the Aman pack. Replace the 2026-10-01
  "not decided" sentence with Max's decision of 2026-10-04. New load-bearing
  section for the v4 read.
- Memory: `extraction-accuracy-over-cost` updated to Opus 5.5.

## Verification

- Pure tier: `toOutputSchema`, v4 staging (synthetic two-page, codeless page,
  four-configuration and imperial fixtures written by hand, never real values),
  scorer.
- Component tier: Use-as-slot, unit label/toggle.
- DB tier on the local stack: confirm of a two-page v4 item writes one record's
  attributes with two source pages; v3 runs still confirm unchanged.
- Golden harness numbers before and after each gate.
- Browser walk of the Aman pack on the local stack.

## Added by Max, 2026-10-04 (after the go)

1. **Assign items to a mock-up phase without taking them off the main one.**
   - The Aman bill has no MUR (mock-up room) lines. Every MUR drawing's code
     matches both a GR line (Guest Suites) and a PL line (Ambassador and
     Presidential Suites).
   - The MUR drawings can also be a different design: the mock-up dresser stool
     has a handle and stands 1'-8 1/2"; the PL one has none and stands 1'-3".
   - So: on the phase table, select records → **"Also in a mock-up phase"**.
     - It creates the mock-up phase if there is none (a `spec_runs` row flagged
       `is_mockup`, migration 0043).
     - It adds a record there per selection, carrying the bill line's identity
       (client refs, description, category, level). Quantity is left blank and
       "not given", never 1. No specs are copied: the mock-up item gets its own
       from the MUR drawings, which may differ.
   - Resolution: a drawing whose number or title marks it as mock-up (a `MUR`
     segment in the drawing number, or "MOCKUP ROOM" in the title block, read
     by the model) resolves ONLY among records on a mock-up phase. Ambiguity
     there is asked as now. A non-mock-up drawing never lands on a mock-up
     phase by this rule; it fans out by the existing per-phase rule.
   - Phase 3b, after Phase 3.
2. **Rules for the golden and the prompt:**
   - seat height = overall height where you sit on the top (bench, stool,
     ottoman);
   - a bedframe's height excludes the headboard;
   - S-400 corrected to W570 D460 H493 (and the `CLAUDE.md` line that says
     otherwise).
3. **A detailed specification sheet is the first port of call, and EVERYTHING
   on it is taken in.** "That information may not present itself again."
   - When a spec sheet's labelled table and a shop drawing in the same document
     disagree, the spec sheet fills the slot and the drawing's figure is kept
     as a candidate.
   - The v4 read gains `statements[]`: every labelled line of a specification
     table (label, value, page, configurations) not already captured as a size
     or a finish. They are kept as `record_attributes` notes, requirement-free,
     which is what attributes were made for.
   - The item's picture AND each finish's swatch are proposed as crops
     (`pictures`, and a `swatch` box per finish). Swatches reach the finishes
     library through the existing swatch path at confirm.
4. **The finishes library comes before the drawings.** After the line items,
   the next stage is the fabric and finishes library, sorted. Phase 4 runs
   straight after Phase 1. In it the finishes library is filled from:
   - the finishes schedule (the Aman "OMS and FF&E Tracker");
   - the finishes stated on specification sheets.

   The drawings then land on finishes already described.

## Decided with Max, 2026-10-04

1. **Golden**: Claude drafts each entry from the rendered page, marked
   `verified: false`; Max ticks or corrects. Only verified entries score. The
   golden is never written into the repo.
2. **Spend**: the lower-API-cost version (~130 API reads, roughly $20–$60);
   prompt trials run on the Max subscription first. Run every phase without
   asking; stop and report only if API spend passes $100.
3. **Refusal fallback**: on (`fallbacks: "default"`, beta
   `server-side-fallback-2026-07-01`). The run records which model served it.
4. **Scope**: all six phases.
5. **Opus 5.5** for every extraction; **intake work is on the Aman pack**
   (`CLAUDE.md` updated when the work starts).

**GO given 2026-10-04: "go run all phases".** The end state is the Aman
project in pilot, correct (Phase 7).
