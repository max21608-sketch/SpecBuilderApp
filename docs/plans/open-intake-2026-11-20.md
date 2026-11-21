# Open intake: survey, route, read, assemble (plan, 2026-11-20)

Max, 2026-11-20: *"how do we go about making it more open to accepting
documents in pretty much any format … as long as they include the right
information, we can take them in, sort them, and then start scanning. Maybe we
use a lower grade AI to first scan and just assess what's where … for anything
that's a drawing, we use this level, for anything that's just a table, we use
this level, and we kind of piece it together, and we don't just have set
things that get assigned … that's something that's going to take a bit of
work, so we need to set out a plan."*

This is a plan, not a build. Nothing in it is started. The decisions it needs
are named at the end, with the person who owns each.

**Decided, Max, 2026-11-20, on the plan as a whole:** *"that's exactly what I
want to do … measure, survey, route and read, piece it together … we can be
given stuff in whatever format. It could all be mixed into one document. It
could be in 3, 5, 10 separate documents. Doesn't matter … by teaching it
limits that I thought would increase its productivity, it's actually made it
worse. So I think it's just kind of about removing those. So yeah, let's go
ahead."* Taken as the yes to both items the plan put to him against
CLAUDE.md's excluded list — reading PART of a file, and sending readings into
a later model call — because the plan named both and he approved it whole.
CLAUDE.md's list is amended when `prod-ready` lands: until then CLAUDE.md
belongs to the production-readiness session (one owner at a time). Stage 0
starts now; Stages 1–2 wait for `prod-ready`, because they change the same
upload code it is still changing.

**Which limits go, and which stay.** The limits that made the reading worse
are limits on what the model may SEE and SAY: one kind per file, a fixed
label list, a closed answer where an open one was true ("answer unclear
whenever you are not sure" is what made Haiku 5.5 hold real drawing sets).
Those are what this plan removes. The limits on what gets WRITTEN without a
person — code copying numbers out of cells, a confirm before anything is
canonical — are why the result can be trusted line by line, which a chat's
answer cannot, and they stay.

## The step back: is the current approach right?

**The readers are right; the routing around them is the part to change.** It
is an evolution, not a rewrite.

What is right, and survives every stage below unchanged:

- **The model reads; a person confirms; nothing canonical is written unseen.**
  Every reading is staged, and only a confirm writes (CLAUDE.md, hard approval
  gates).
- **Code copies every number out of a spreadsheet cell.** The model reads a
  bill's STRUCTURE and never transcribes a quantity (`boq-structure.ts`).
  Three hundred transcribed quantities would be three hundred chances to
  mis-copy one that nothing downstream questions.
- **The model says which figure is which, with the evidence, and nothing is
  inferred from a figure's size** — not the slot, not the unit
  (`docs/load-bearing/drawings.md`).
- **The bill is the backbone.** It is the only document that creates records,
  keyed by the client's own ref, because that is how the business quotes.
- **Unsure goes to a person**, never to a confident guess.

What generates a new special case every time a new client's pack arrives:

1. **The unit of work is a FILE, and a file gets ONE kind.** `classifyDocument`
   returns one genre per file; `KIND_FROM_GENRE` turns it into one
   `document_kind`; that selects one prompt, one staged shape and one review
   screen. Real packs do not respect file boundaries: a PDF holding a bill, its
   drawings and its specification sheets; a tracker listing furniture AND
   finishes (the finishes read leaves the furniture out and counts it in a
   note); a merged pack with a preamble in it. On 2026-11-20 Haiku 5.5 answered
   the merged 44-page Panther pack "unclear — the pack mixes Jacques Grange
   drawings with … specification sheets … and a general preamble", which is
   true, and the app had no way to act on it except to ask a person to pick ONE
   kind for all of it. `docs/load-bearing/bills.md` is 765 lines, most of them a
   rule a specifier's own layout forced on one path.
2. **Each document is read on its own, and the joining-up is done by matching
   codes.** Which drawing is which bill line, which finish code on a drawing is
   which row of the finishes schedule, where two documents disagree — code
   matches refs (`spec-document.ts`, `resolveRecords`), and a person does the
   rest. Joining things up across documents is exactly the work a model does
   well and string rules do badly — a drawing titled "MUR.2 ARMCHAIR" whose
   bill line is "S-200" — and it is cheap, because it needs the READINGS, not
   the documents.
3. **What a label means is a hand-written list.** The drawings read moved to
   "the model names the slot and quotes what told it" (staged schemaVersion 4,
   2026-10-04). The bill description, schedule and specification-document
   reads still hand the document's labels to `spec-reading-vocab.ts`, whose
   rules "were derived from ONE specifier's bill before Matthew's examples
   arrived" (`docs/load-bearing/bills.md`). A new specifier's wording is not lost — it is
   kept on the record for a person to place — but it fills no field.
4. **Almost nothing measures the readings.** One eval exists
   (`tools/eval-drawings.ts`), and its answer key is Claude's draft that no
   person has verified ("unverified drafts: 30 documents"). There is none for
   classification, schedules, bill descriptions or email. So every change is
   judged by hand, and a regression is found by luck. **Observed 2026-11-20:**
   swapping the file check from Haiku 4.5 to Haiku 5.5 silently blanked the
   evidence on most answers (a 400-character bound the forced tool does not
   enforce, and a `.catch("")` that threw the whole answer away) and held the
   real Panther shop-drawing set for a person three times in three. A hand test
   caught both, and only because the model was being changed on purpose.

## The shape: survey → route → read → assemble

```
upload (any files, any mix)
  │
  ├─ 1. SURVEY — Haiku 5.5, cents per pack, automatic as the file check is now
  │      per file: a MAP of its PARTS — page ranges of a PDF, sheets (and row
  │      ranges) of a workbook, an email's body and each attachment — each with
  │      a kind, the evidence, how sure, and the item and finish codes it names.
  │      per pack: which parts name the same codes; what the pack lacks.
  │      A person confirms the map (the gate before any charged read).
  │
  ├─ 2. ROUTE + READ — one table says which reader and which model per kind
  │      bill table ........... code reads cells; Opus 5.5 reads structure only
  │                             when no heading or layout knows it (today)
  │      drawings / spec sheets  Opus 5.5 high, item read v4, on the part only
  │      finishes / fabric list  finishes read (today)
  │      prose (preamble, bible) prose read (today)
  │      email ................. email read (today); attachments become parts
  │
  └─ 3. ASSEMBLE — text only, no document re-sent
         code links what an exact code links (today); the model proposes the
         rest — drawing item ↔ bill line, callout ↔ finishes row — and flags
         where two parts disagree, each with its evidence. A person confirms.
```

The readers stay specialised. **A single universal reader was considered and
rejected:** one prompt for every document would be simpler to route, but it
would throw away what each reader learned the hard way — that a bill's numbers
come out of cells by code, the v4 slot and seat-height rules, the finishes
read's "the code is the key". What becomes general is the ROUTING, and the
granularity it routes at: a PART, decided per pack, not a FILE with a kind.

## Stages

Sizes are relative. Every stage ends with the four checks green on the local
stack with the database tier required, and nothing reaches pilot without Max.

### Stage 0 — measure first (prerequisite; small to build, slow to verify)

Nothing below can be judged without it, and it is the cheapest stage to build.

- **A pack-level answer key** for four packs from different specifiers:
  Panther, Aman, Ronnie Scott's, and the invented Harbour House pack
  (`~/dev/localstack/synthetic-hhh/`, which can be committed as a fixture
  because nothing in it is client data). Per file: its parts and their kinds.
  Per item: which parts describe it. Kept OUTSIDE the repo for real packs, as
  the drawings golden is.
- **Claude drafts it; a person verifies it.** An unverified key scores the
  model against Claude's opinion of the document. The drawings key has waited
  since 2026-10-04 for this step.
- **`npm run survey:eval`**: the survey's map scored against the key (parts
  found, kinds right, codes found), with cost and time, saving every raw answer
  outside the repo so a re-score is free — the `eval:drawings` pattern.
- Add the file check itself to it now: the 2026-11-20 Haiku comparison was run
  by hand (`~/dev/localstack/haiku-live/`) and should not have to be again.

#### Stage 0, first measurement (2026-11-20)

Built: `src/lib/pack-survey.ts` (the survey, Haiku 5.5, a forced tool, a
short open prompt; code drops impossible places, merges adjacent PDF parts
that go to the same reader, and sets aside parts with nothing to read),
`tools/survey-golden.ts` + `npm run eval:survey` (the scorer and the run),
answer keys in `~/dev/localstack/survey-golden/` — two invented Harbour House
keys, exact by construction and `verified: true`; four real keys drafted by
Claude, `verified: false`, with the drafter's doubts in `NOTES.md` there.

| Pack | Files | Parts in the key | Found | Held for a person | Wrong reader | Missed / extra |
|---|---|---|---|---|---|---|
| Harbour House, six separate files (invented) | 6 | 8 | 8 | 0 | 0 | 0 / 0 |
| Harbour House, the same pack mixed into 3 files (invented) | 3 | 8 | 8 | 0 | 0 | 0 / 0 |
| Panther, merged into one 44-page PDF | 1 | 3 | 3 | 0 | 0 | 0 / 0 |
| Panther, as delivered | 12 | 14 | 11–12 | 2 | 0 | 0–1 cut wrong |
| Aman | 36 | 40 | 34 | 3–4 | 0 | 2–3 / 1 |
| Ronnie Scott's | 5 | 7 | 0 | 7 | 0 | 0 / 0 |

Ranges are two runs of the same prompt. All six packs cost about $0.14 a
run. What it says:

- **No part went to the wrong reader**, in any pack, on any run. The failure
  mode is HELD — a person asked — which is the safe one.
- **A mixed file works.** The merged Panther PDF came back as exactly its
  three documents with every page boundary right (drawings 1–11, preamble
  12–30, specification sheets 31–44), and the invented 3-file pack scored as
  well as the 6-file one. The model splits a drawing set one part per item
  (Panther: 29 parts); code's merge of adjacent same-reader parts is what makes
  it three. Without the merge the eval would show the set cut in pieces.
- **The holds sit on three genre boundaries**: bill or schedule (all of
  Ronnie Scott's: procurement schedules with an order quantity and no price),
  preamble or specification bible (Panther's Argenta preamble), finishes or
  fabric list (Ronnie Scott's COM list). And the Aman tracker came back as one
  finishes part where the key has finishes (pp 1–7) then furniture (pp 8–14):
  the genre wording the survey reuses still says a finishes schedule is one
  "even where it also tracks some furniture" — the one-kind-per-file rule,
  showing through.
- **Adding knowledge to the prompt made it WORSE, and was reverted.** A
  paragraph stating what the app knows (a procurement schedule is a bill; a
  tracker of finishes then furniture is two parts; a COM list is a finishes
  schedule; preamble versus bible) moved Ronnie Scott's not at all, cost the
  invented bill-and-finishes workbook a part and all 20 of its item codes, and
  gave Panther five extra parts. Both runs without it scored those packs
  clean, so it is not noise. Max's point — limits taught to the model made it
  worse — held under measurement.

**What follows from it, for Stage 1:**

1. **A person verifies the four real keys** (`NOTES.md` lists where to look
   first). Until then they are Claude's opinion of the documents.
2. **Bill or schedule goes to CODE, not to more prompt.** A part held as
   bill-or-schedule is tried by the bill reader, for nothing — the known
   headings, a saved layout, `pdf-bill.ts` for a PDF printed from a
   spreadsheet — and the person sees "reads as a bill: 26 lines, code and
   quantity columns found" beside the press. The same rule as everywhere else
   in this app: the model says what it saw, code makes the exact step.
3. **The survey gets its own genre wording**, without the one-kind-per-file
   clauses ("even where it also tracks some furniture"), and the eval says
   whether that splits the Aman tracker without costing anything else.
4. **Every prompt change is run twice against all six keys before it lands.**
   One run cannot tell a change from the ±1 part a pack moves by between runs.

#### The survey's own genre wording, measured (2026-11-21): no change

Item 3 above, done as item 4 says: three wordings, each run twice over all six
keys (labels `c2a-*`, `c2b-*`, `c2c-*` in `~/dev/localstack/survey-eval/`;
about $0.77 in all). Parts found per run, against today's (`v1b`/`real`):

| Pack (parts) | Today | Own words, no price cue | + price cue | File check's less the clause |
|---|---|---|---|---|
| Harbour House separate (8) | 8, 8 | 5 (3 held) | 8, 8 | 8, 8 |
| Harbour House mixed (8) | 8, 8 | 7 (1 held) | 7, 7 (1 missed) | 8, 8 |
| Panther merged (3) | 3, 3 | 2 | 3, 2 | 2, 2 |
| Panther (14) | 12, 11 | 9 | 12, 12 | 12, 12 |
| Aman (40) | 34, 34 | 35 | 34, 34 | 34, 34 |
| Ronnie Scott's (7) | 0, 0 (7 held) | 0 | 0, 0 | 0, 0 |

Nothing went to the wrong reader in any run. The Aman tracker never split
into its finishes and furniture parts, and every wording cost a pack on at
least one run, so **today's wording stays** (the reasons are in the header
of `pack-survey.ts`). The first attempt ran once: its bill sheets held on
every workbook was reason enough. "Bill or schedule goes to CODE" (item 2)
is built and does not depend on the wording.

> **Stages 1 and 2 were built on 2026-11-20/21** (Max: "plan and then build
> the taking in a mix of documents … to really high quality"). The design and
> what the build verified are in `open-intake-build-2026-11-20.md`; the traps
> are in `docs/load-bearing/email-and-inbox.md`. Stage 3 and Stage 4 below are
> not started.

### Stage 1 — the survey (medium)

Replaces the per-file classify. Same model (Haiku 5.5), same place in the
upload, same rule that it fills the box in and a person's press commits it.

- **The answer is a list of parts per file**, not one genre. A part is a PDF
  page range, a workbook sheet (or a row range of one), an email body or one
  attachment. Each carries the trade genre (the existing `DOCUMENT_GENRES`,
  so `KIND_FROM_GENRE` stays the one map), the evidence, how sure, and the
  codes it names. One part covering the whole file is the common answer and
  must stay the cheap, unremarkable case.
- **A pack pass**, text only: the file maps put together — which parts name
  the same codes, two bills (which is the revision is still a person's call),
  drawings naming codes no bill carries, no finishes schedule at all.
- **Data:** a run gains the part it reads (`intake_runs.source_part`, jsonb:
  `{pages:[13,60]}` / `{sheet:"FF&E"}` / `{attachment:2}`; null = the whole
  file, which every existing run already is). One file can then hold several
  runs — the precedent is "one email, one code, three runs"
  (`docs/load-bearing/email-and-inbox.md`). A migration, sandbox first.
- **Screen:** the upload row lists the parts it found, each with its kind box,
  in the design language. A file whose map is one part looks exactly as it
  does today.

**Traps:**

- **Never cut inside a drawing set.** The v4 read exists because an item is
  drawn across several pages and a page can carry several items; reading pages
  one at a time and gluing them back is what it retired. A part boundary goes
  only where the KIND changes (bill pages, then drawing pages), never between
  two pages of drawings.
- **The cost asymmetry still holds.** A spreadsheet that could be a bill or a
  schedule is still `unclear`: a wrong bill is a project's worth of wrong
  records. And doubt only between two genres that are READ the same way is not
  doubt — the code rule `fileDocument` gained on 2026-11-20 (`weighedAgainst`)
  carries over per part.
- **The survey is the only automatic look.** It is Haiku, cents a pack, as the
  file check is now. Every READ still starts on a person's press.

### Stage 2 — route and read by part (medium)

- **One table says which reader and which model reads each kind**, with its
  effort — the "this level for drawings, that level for tables" choice, made in
  one place and judged by Stage 0, not spread over four files as
  `EXTRACTION_MODEL`, `STRUCTURE_MODEL`, `TRANSCRIBE_MODEL` and
  `CLASSIFY_MODEL` are today.
- **A reader takes a part.** For a PDF the first version sends the whole file
  and tells the model which pages to read — no new dependency, and the model
  still sees a drawing's neighbours. Copying out the pages (a PDF library on
  the server; only `pdfjs-dist` is there today, which reads) is the second
  version, and only if time or tokens bite. The read's time ceiling (740 s;
  about 90 pages, measured 2026-09-23 on Opus 5 at high and not re-measured on
  5.5) is set mostly by what the model WRITES, about 980 output tokens a page,
  so asking for fewer pages raises it either way.
- **A workbook's sheets go where they belong.** Today the bill structure read
  says which sheets are "not a bill", and they are ignored with its reason
  (`boq-stage.ts`); a finishes sheet in
  the bill's workbook should become its own part, read as finishes.
- **An email's attachments become parts** — the variance-matrix row "an email
  whose spec is in an attached PDF" (`make-it-work-2026-09-19.md` §6.10.c),
  still only flagged.

### Stage 3 — assemble (large; depends on the item-review design)

- **Code links first, the model proposes the rest**, the order bills already
  follow (layout → synonyms → model → person). An exact code links as today;
  the model is given the bill's records and each part's items AS TEXT — codes,
  titles, sizes, finishes, never the documents again — and proposes the links
  code could not make, each with its evidence, plus the places two parts
  disagree. Small and cheap: a pack's readings are tens of thousands of tokens.
- **A person confirms each link**, the rule for pairing a revised bill line
  today: a proposal that is ambiguous pairs nothing.
- **Where it is confirmed belongs to Matthew and Claudia's item-review
  screen**, which CLAUDE.md says not to build ahead of their design. This stage
  waits for it; Stages 0–2 do not.

### Stage 4 — retire the label list, one reader at a time (ongoing)

Move the bill-description, schedule and specification-document reads to what
the drawings read already does: the model names the target slot or BWS field
and quotes what told it; code CHECKS the answer (the figure is in the source
text, the unit is printed beside it) instead of interpreting the label. Each
`spec-reading-vocab.ts` rule is retired only when the eval shows the model
path places what the rule placed, and the list stays as a cross-check until
then.

## What does not change

- No charged read without a person's press; the survey is the one automatic
  look, as the file check is today.
- Extraction stages; only a confirm writes. The confirm boundary stays per
  run — `PackDrawingsReview.tsx` explains why a pack-level confirm would be the
  worse failure.
- The bill is the only thing that creates records, and code reads its cells.
- Units, slots and `TBC` keep every rule they have.
- Model choice: Opus 5.5 for reading, Haiku 5.5 for looking (Max,
  2026-11-20). Stage 0's eval is what any later change of model is judged by.

## Decisions needed

- **Max — scope against the excluded list.** CLAUDE.md excludes "splitting an
  oversize drawing set" and "feeding preamble notes into later model calls".
  Stage 2 reads part of a file (not an oversize split, but close), and Stage 3
  sends readings into a later model call (readings, not preamble notes). Both
  need a yes before they are built.
- **Max — when.** M8 is still open and production readiness is in flight
  (`production-readiness-2026-11-20.md`, on `prod-ready`). The recommendation
  is Stage 0 now (it is mostly verification, and it protects every later
  change), Stages 1–2 after `prod-ready` lands, Stage 3 after the item-review
  design.
- **Max or Matthew — who verifies the answer keys**, about a pack a sitting.
  Without a person, Stage 0 measures the model against Claude.
- **Matthew and Claudia — where link confirmation sits** in the item-review
  screen (Stage 3).

## Known limits, worth being honest about

- **The survey is new work for a small model.** Haiku 5.5 found the parts of
  the merged Panther pack in words on 2026-11-20 ("mixes … drawings with …
  specification sheets … and a general preamble"), but it has not been asked
  for page ranges, and nothing has measured how well it gives them. Stage 0
  exists to find out before Stage 1 depends on it.
- **A scanned document is still refused** (except a scanned bill), and images
  are still excluded. "Any format" in this plan means any MIX of the formats
  the app reads — PDF with text, spreadsheet, email — not photographs.
