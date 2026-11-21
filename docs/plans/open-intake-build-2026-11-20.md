# Open intake, Stages 1–2: the build design (2026-11-20)

Max, 2026-11-20: *"I need you to plan and then build the taking in a mix of
documents. I need you to do that now to really high quality."* This is the
design the build follows. The plan it implements is
`open-intake-2026-11-20.md`; read that first for why.

## What is built, and what is not

**Built:** a file dropped on the upload screen is SURVEYED into parts; a file
with more than one part shows each part with its own kind; a person's press
registers one READ per reader per file; each read takes in only its part; the
screens name the part. One PDF holding a bill, its drawings and a preamble
becomes three reads. One workbook with bill sheets and a finishes sheet becomes
two.

**Not built, deliberately:**

- **Model-proposed links between documents (Stage 3).** It waits for Matthew
  and Claudia's item-review design. Drawings still reach their bill line by
  code, as today.
- **Email attachments as parts.** The inbox assigns and reads automatically
  under a daily cap; that path is not changed in the same build.
- **A row range of a sheet as a part.** A sheet is the smallest part of a
  workbook. A sheet the survey says holds two kinds is HELD with what it saw.
- **Copying pages out of a PDF.** The whole file is sent and the read is told
  which pages are its own (below, and why).

## The one idea: a READ is a file, a reader, and a place

The survey answers in parts (`SurveyPart`, one place each). The app does not
register a part; it registers a **read**: every part of one file that goes to
the same reader, together. `KIND_FROM_GENRE` decides the reader, as it always
has.

- **Why together.** The merged Panther pack is shop drawings on pages 1–11 and
  specification sheets on 31–44, the preamble between them. Both go to the
  drawings reader, and that reader's whole job is to say that S-200's sheet on
  page 34 and its drawing on page 2 are ONE item. Two reads would stage the
  armchair twice and leave a person to notice.
- **A file with one read is registered exactly as today**, `source_part` null,
  the whole file. Nothing about a single-kind file changes: not the request,
  not the prompt, not the screen. Every existing pack is this case.

```ts
// src/lib/source-part.ts — a LEAF (a screen imports it; no server import).
export type SourcePart =
  | { kind: "pages"; ranges: { from: number; to: number }[] }  // PDF pages, 1-based, inclusive,
                                                               // in the FILE's numbering; sorted, merged
  | { kind: "sheets"; sheets: string[] };                      // workbook sheets, by exact name
```

`intake_runs.source_part jsonb` (migration **0065**; null = the whole file).

## Traps this design exists to avoid

1. **Page numbers stay ABSOLUTE, so the whole PDF is sent.** Every staged
   page, every `record_attributes.source_page`, every swatch crop and every
   `#page=N` link in the app is a page of the stored file, served whole by
   `/api/imports/[id]/source`. Copying a part's pages into its own PDF would
   make all of them relative, and wrong, silently. So the read sends the file
   and an instruction naming its pages; time and output tokens fall because the
   model WRITES less (about 980 output tokens a page is what binds).
2. **The model is not trusted to stay in its part.** After the read, code drops
   what was reported from pages outside the part and SAYS so in the document's
   notes (`src/lib/part-filter.ts`, on the raw output, before any staging
   function). The precedent is `mergeWindowProposals` for rows. Without it an
   item from another part stages, previews and confirms as if it belonged, and
   the same item is staged by two reads.
3. **A request id per read.** The upload made one `registrationRequestId` per
   FILE. Two reads sharing it would return the first read's id for the second,
   silently (`spec-registration.ts`' replay guard doing its job).
4. **The bill paths have no replay guard today.** `parseBoqInto` and
   `registerPdfForTranscription` never write `registration_request_id`, so a
   retried bill registration makes a second bill. Parts retry more; the guard
   goes in.
5. **A PDF bill's workbook is named from the PDF alone**
   (`pdfBillWorkbookPathname`). A bill read of a part gets the part in its
   name.
6. **`readPdfBillPages` refuses a whole PDF on `columns_change`.** In a mixed
   PDF any later table would trip it. It reads the part's pages only, and
   keeps each row's page absolute.
7. **A filename names a file, not a part.** `drawingNumberOf(filename)` and
   `isMockupDrawing(…, filename)` apply the file's name to every item in it.
   A read with a `source_part` does not take a drawing number or a mock-up
   flag from the filename.
8. **Local replay is keyed by the PDF's bytes.** Every read of one file would
   replay the same saved answer. The key gains the part.
9. **"Include this sheet" on a bill.** A sheet left out of the bill at upload
   is staged `ignored` with a reason that says so, so a person can still
   include it, knowingly.

## Registration (`POST /api/imports`)

- New optional field `part: SourcePart` (zod, `.strict()`; at most 50 ranges,
  200 sheets). `pages` only with a PDF; `sheets` only with `.xlsx`; never with
  `documentKind: "email"`; ranges inside the counted pages where they can be
  counted. Refusals are sentences a person can act on.
- One `attachments` row per registration, as today. Reads of one file do NOT
  share an attachment: `record-documents.ts` merges runs that share one into a
  single row with one kind, which is right for a bill and its own
  specification read and wrong for a bill and a drawing set.
- **Replay guard on every path**: the bill paths write
  `registration_request_id` and answer a replay with the first run, as
  `insertSpecDocumentRun` does.
- **Spec document with a part:** the run is inserted with `source_part`; the
  worker does the rest.
- **Bill, workbook, `sheets` part:** every sheet is still parsed and staged
  (the structure read pairs staged sheets to source sheets by name, falling
  back to INDEX — staging fewer sheets would pair the wrong ones). Sheets
  outside the part are staged `ignored: true`,
  `ignoredReason: "Not filed as part of the bill at upload."`.
- **Bill, PDF, `pages` part:** `readPdfBill` reads those pages only, rows keep
  absolute pages; the workbook's pathname carries the part
  (`… (read from PDF, pages 1-12).xlsx`); `pdfSource` records the part. The
  transcription fallback windows over the part's pages, not `1..pageCount`.
- **The bill's own specification read and the tracker's furniture read** copy
  their parent run's `source_part`.

## The read (`extraction-run.ts`, `anthropic.ts`, `intake-source.ts`)

- The claim returns `source_part`.
- **Workbook:** `prepareDocumentSource` keeps only the part's sheets, in both
  `text` and `sheets`. A named sheet that is not in the file fails the read in
  words. The 360-row cap then counts the part's rows only.
- **PDF:** `extractSpecDocument` sends `options.instruction` for a PDF too
  (today it is dropped for PDFs). `partInstruction(part)` says, after the
  prompt: this file holds several documents; for this read THE DOCUMENT is
  pages X–Y (and A–B), counted 1..N from the first page of the file, not by
  printed sheet numbers; the other pages are other documents, read
  separately — report nothing from them; give every page as its number in the
  whole file. One static sentence template, no data interpolated but the
  numbers.
- **`restrictOutputToPart(outputKind, raw, part)`** (pure, `part-filter.ts`),
  first thing in `stageOutput`:
  - drawings v4: an item whose pages are ALL outside is dropped; an item partly
    outside keeps its inside pages, loses rows citing outside pages, and gains
    an `uncertain` entry saying which pages were left out;
  - finishes entries, preamble notes, observations: dropped when their page is
    outside;
  - everything dropped is counted and named (codes, pages) in one line added to
    the document's notes: *"Left out: 2 items reported from pages 12–30, which
    are not part of this read (pages 1–11 and 31–44): …"*. Nothing is dropped
    silently.
  - a row with NO page is kept: absence of a page is not evidence it is
    outside.
- The staged document records `sourcePart`, and the filename rules in trap 7
  read it.
- `local-read-replay`: key = sha256(base64 + canonical part).

## The upload: survey, then parts

**`POST /api/imports/classify`** — the survey is the one look.

- `.eml`, and a scanned PDF, take today's path unchanged.
- Otherwise `surveyFile` replaces `classifyDocument`. Parts with
  `nothingToRead` are set aside. Then:
  - **One part left:** it is adapted to the result `classifyDocument` gave
    (`genre`, `decision` through `fileDocument`, `certain`, `evidence`), and
    every rule after the look runs as today: the name disagreement (K1), a
    non-bill PDF that reads as a table (C1), the PDF-bill read, the
    transcription note. The response has today's shape.
  - **Two or more:** the response carries `parts[]`, each
    `{ place, genre, decision | null, certain, evidence, held?, itemCodes,
    finishCodes, pdfBill? }`, plus the file `note`. The filename rule (K1) is
    not applied: a name cannot describe a mix.
- **Bill or schedule goes to CODE** (Stage 0's finding; more prompt made it
  worse). A part the model is torn on between a bill and an FF&E schedule is
  tried by the bill reader for nothing: a PDF part through `readPdfBill` on its
  pages, a sheet through `parseBoqSheets` with the saved headings and layouts.
  Where it reads as a table with a code or description column AND a quantity
  column, the part stays HELD — a wrong bill is a project's worth of wrong
  records — but its box is filled with *bill* and the evidence says what was
  found: *"Reads as a bill: 26 lines; code and quantity columns found."* One
  press, informed, instead of a choice from nothing.
- The survey gets **its own genre wording** (not the file check's, which still
  says a finishes schedule is one "even where it also tracks some furniture").
  Judged by `eval:survey`, twice over every key, before it lands.

**`IntakeBatchUpload.tsx`**

- A file whose answer has `parts` shows them under its row: the place
  (*pages 1–12*, *sheet "Finishes"*), the kind box, the evidence, and the same
  held/suggested states a file has. Each part's box also offers **Don't read
  this part**.
- A file with one read looks and behaves exactly as today, and every existing
  upload test passes unchanged.
- On the press, `readsOf(parts)` (pure, `src/lib/upload-reads.ts`) groups the
  file's parts by chosen kind: one registration per kind, its `part` the union
  of their places, its own `registrationRequestId`. If every part of the file
  ends up in ONE read, it is registered with no `part` (the whole file).
- Bulk assign and "All unset → Shop drawings" act on whole-file rows only.
- Nothing is registered for a file while any of its parts is held and
  unanswered: a half-registered file is the state nobody can read.

## Naming the part on screens

One helper, `documentLabel(filename, part)` → *"Pack.pdf — pages 1–11 and
31–44"*, *"Schedules.xlsx — sheet "Finishes""*. Every route that returns a
run's filename returns `sourcePart` beside it, and these screens use the
helper: the Documents tab, the pack page (rows and step summaries), the pack
drawings review, the five review screens' headers and their "not read yet"
cards, and the record's Documents list.

## How it is verified

1. Pure and component tests with each piece; the database tier for
   registration, the worker and the bill paths (`:local`, never the sandbox).
2. `eval:survey` twice over all six keys after the wording change.
3. **Real reads on the local stack**, through the browser, of the three
   invented mixed files and the merged Panther PDF: survey → parts → press →
   reads → review. The merged Panther drawings read is compared item by item
   with the separate-file reads of the same pack.
4. An independent review of the whole diff by an agent that did not write it.
5. The four checks with the database tier required.

Human acceptance is outstanding until Max has walked it.

## What the build did, and what was verified (2026-11-21)

Built by four Opus coders in sequence on `intake-2026-11-20` (sixteen
commits, about 6,000 lines with tests), reviewed by an agent that wrote none
of it, and walked in a browser on the local stack with real reads.

- **The four checks pass** with the database tier required: 5,638 tests at
  `fd83017`, the last code commit, on the local stack. `tools/overflow-audit.mjs`
  found no box wider than itself on 26 pages at 1920 and 1440, the three test
  projects' screens among them.
- **The independent review found nine defects, all fixed, each with a test.**
  The three that mattered: changing a part's kind after other parts were
  registered re-registered the same pages (a second charged read); a
  single-kind file with a cover and a blank divider stopped being one
  whole-file read; and a part the survey dropped could collapse a mixed
  workbook into one wrong whole-file read with no press.
- **Walk 1, invented Harbour House pack mixed into three files** (project
  `T20122`, local stack): one press, 78 seconds, EIGHT reads and nothing held —
  the combined PDF as bill (pages 1–5), finishes (6), drawings (7–8) and
  preamble (9); the workbook as its bill sheet, its finishes sheet and its
  notes sheet (a preamble); the drawings PDF whole. Every read stayed inside
  its part (the model's own notes say "Page 9 only", "Other pages of the file
  … not read for this document"), every page number was the file's. The
  workbook's bill sheet confirmed into 32 records on one phase with the other
  two sheets left out, and the drawings read of pages 7–8 then found its
  records and recognised the sizes the bill had already recorded.
- **Walk 2, the real merged Panther PDF (44 pages) with its bill workbook**
  (project `T20123`): the survey gave drawings 1–11, preamble 12–24, pages
  25–30 uncovered (shown as their own held row, answered "preamble" by hand)
  and specification sheets 31–44. ONE drawings read of pages 1–11 and 31–44
  returned exactly ten items, each joining its drawing to its sheet (S-100 on
  pages 1, 31, 32; S-200 on 3, 4, 34, 35; S-301 on 8–11, 39, 40), with the
  sizes this pack is known to have (S-100 W1900 D790 H720 SH440; S-200 W840
  D790 H720 SH460; S-203 80 × 70 × 90 as printed in centimetres). The
  preamble read of pages 12–30 returned 114 notes. The bill's
  value-engineering sheet was held with "Reads as a bill: 14 lines; code and
  quantity columns found."
- **Found on the last walk and fixed:** the pilot pack's own bill workbook
  (MUR, MAIN RUN, MAIN RUN - VE) had started to need a press on every upload,
  because the survey is never certain the value-engineering sheet is a bill.
  An uncertain bill sheet beside a certain bill sheet of the same workbook is
  now one more tab of that bill — every sheet is staged as a tab, nothing is
  written before the bill's Confirm, and its review is where a tab is dropped —
  so the workbook is one certain bill again, as it was before this build. A
  lone uncertain sheet, and any PDF part, still wait for a person.
- **Survey wording: no change.** Three rewordings, twice each over all six
  keys, each made a pack worse; the table is in `open-intake-2026-11-20.md`.

**Known limits, worth being honest about**

- The PDF bill inside the invented combined pack went to the model for
  transcription ("This PDF's columns change from page to page"): its three
  sections print different columns. That is the bill reader's existing rule,
  not new, and it is a charged read where a workbook is free.
- Where two parts claim the same pages, both are shown but nothing on the row
  says they overlap.
- The survey holds real procurement schedules as "bill or schedule" every
  time. The code probe now puts the bill and its line count beside the box,
  so it is one press, but it is a press on every such file.
- The four real answer keys are still Claude's drafts (`verified: false`);
  Max is checking them (`docs/docs for building/survey-key-check-2026-11-20.md`).
- Nothing here has been walked by Max, Matthew or Claudia.
