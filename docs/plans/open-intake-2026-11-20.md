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
