# Verifying the BWS export against the pack

M8 is done when the export is **judged flawless by a human, read line by line
against the pack**. Until 2026-09-16 that sentence had no artefact behind it:
the check was a person, a screen and a memory of what the drawings said.

This is the procedure and the file it produces. It is the acceptance test for
step 4 of M8, and nothing here is automated scoring — the whole point is that a
person compares a value to a page and writes down what they found.

## Why a separate file, and not just reading the export

The export is 109 columns wide and each row is composed from three places: an
attribute a reviewer confirmed off a document, a confirmed checklist answer, or
the BOQ line. Reading it across means holding a record's row, its drawing page
and its bill line in your head at once. What actually happens then is that the
obviously-populated cells get checked and the rest get skimmed — and the cells
that get skimmed are the blanks, which is where the failure worth catching
lives.

The check sheet turns one 109-cell row back into one line per field, each
naming **the document and page its value came from**, and leaves three columns
empty for the reviewer.

## Producing it

On a phase's spec table, in the header's outputs cluster — Spec upload, Quote
lines, Costing block — press **Check sheet**. Or directly:

```bash
curl -b sb_session=... "$BASE/api/projects/$PROJECT/export/check-sheet?runId=$RUN" -o check-sheet.xlsx
```

`.xlsx` gives a frozen header, an autofilter and a dropdown on Verdict;
`&format=csv` gives the same rows flat. It accepts `runId` and `format` and
**nothing else** — see below.

## What is in it

| Column | Means |
|---|---|
| Record, Client code, Item, Run | which spec record this line is about |
| Column | the export's own column letter, so a finding can be pointed at in the file |
| BWS field, Field id | the field, by name and by `json_id` — never by letter, which moves |
| Exported value | exactly what the export cell holds, `TBC` included |
| Came from | `Document`, `Checklist`, `BOQ line`, `Project`, or blank |
| Source document, Page | where to go and look. A composed dimensions cell names **every** page that contributed |
| **Pack says** | the reviewer's: what the document actually states |
| **Verdict** | the reviewer's: one word, below |
| **Note** | the reviewer's: anything the other two cannot hold |

## The verdict vocabulary

One word per line. Free text cannot be counted, and "looks fine" is not a
result.

| Verdict | Means |
|---|---|
| `ok` | the cell matches what the pack states, in the right field |
| `wrong` | the pack states something different |
| `missing` | the pack states a value and the cell is blank |
| `extra` | the cell states something the pack does not — the M8 failure mode: a value inferred rather than transposed |
| `unit` | the figure is right and the unit is not, or a conversion is wrong |
| `unsure` | the pack is ambiguous, or two documents disagree. **Not a pass.** It is a question for the client or the designer, and it is the most valuable row in the sheet |

Leave a line blank if you have not looked at it yet. A blank Verdict and an
`ok` must stay different things, for the same reason `missing` and `TBC` are
different states in `spec_answers`.

## How to work through it

A Panther phase is around 4,800 lines. The sheet does not make that smaller —
it makes it possible. Record by record is the order that works, because that is
how the pack is organised:

1. Filter **Record** to one item. That is about 82 lines, one screen.
2. Open the pages named in **Source document**. Rule on every line where
   *Came from* is `Document` — those are the model's output and this repo's
   unit handling, and they are what M8 is testing.
3. Then read the **blanks** for that record against the same pages. This is
   the pass people skip and the one that finds `missing`.
4. `Came from = Checklist` is somebody's typing, not a document. Check it
   against whatever they typed it from, or mark `unsure`.
5. The four `Project` / `BOQ line` fields — Client, Project Ref, Name, Item
   Count — are **this repo's judgement about what BWS wants**, not Matthew's.
   Check them on the first record and once more on a split record; they do not
   need checking 59 times.

## It is never filtered, and that is load-bearing

The route accepts `runId` and `format` and 400s on anything else, the same as
the export.

A check sheet covering a subset would be signed off in exactly the same words
as one covering the file. "Just the populated cells" is the tempting one, and
it removes the only lines that can find a value the pack states and the export
lost. The 27 job columns that are blank **by design** — BWS-owned vocabularies
this app has never known — are the sole omission, and they are omitted so that
27 unanswerable questions per record do not teach a reviewer to tick without
reading.

## Where a filled sheet lives

**Not in this repo.** A completed sheet is client specification material: it
holds real values from real drawings, and the rule is that the schema gets
committed and never a row. Keep it with the pack — `/Reference/` and
`docs/docs for building/` are both gitignored — named
`<project> - <phase> - export check - YYYY-MM-DD.xlsx`.

What comes back into the repo is the **finding**, not the value:

- a wrong unit, a wrong slot, a value in the wrong field → a code fix, with a
  test written from the shape of the error and synthetic values
- a label the matcher did not recognise → `requirement_aliases` /
  `item_category_aliases`, seeded from the verified wording
- a judgement nobody can settle yet → a dated line in
  `docs/plans/README.md` under *Decisions awaiting the user*

Summarise counts in the dated log — "59 records, 4,838 lines, 12 `wrong`, 4
`extra`, 9 `unsure`" — and keep the sheet itself out.

## Known limits, worth being honest about (2026-09-16)

- **Nobody has filled one in.** The sheet was built on 2026-09-16 and verified
  against synthetic fixtures only. Its column choices are a guess at what makes
  the reading possible, and the first real pass is as much a test of the sheet
  as of the export.
- **It proves the file against the pack, not against BWS.** Whether `Name`,
  `Item Count`, `Project Ref`, `Client` and `Client Code` are the columns BWS
  actually wants is a separate question, answerable only by a real import.
- **A `Checklist` line has no page to send you to.** `spec_answers` records a
  source kind, not a document reference, so the sheet can say an answer was
  typed and not what it was typed from.
- **It cannot show you what is not in the export at all.** A record the BOQ
  import dropped has no lines here. The bill's own line count is checked at
  confirm, and that remains a separate check.
