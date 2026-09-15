# Boilerplate grouping — captured research, not a plan

**Status: deferred. M8 owns everything until the Panther export is judged
correct.** This document exists so the work is picked up from evidence rather
than re-derived from memory. Nothing here is built, and the "where it would be
used" section is argument, not a commitment.

The eventual feature: BWS product codes in the `** BOILERPLATES **` grouping are
templates for jobs. Assigning one to an imported record would say which
specification fields that kind of item is expected to carry — suggested
automatically, later. What follows is what a boilerplate actually contains,
measured.

## The raw capture lives outside git

`docs/docs for building/bws-boilerplates-2026-09-14/` (gitignored — BWS rows,
and the repo commits schema, never rows):

| File | What |
|---|---|
| `boilerplate-spec-matrix.csv` | 45 boilerplates × 34 field labels, `1` where carried |
| `NOTES.md` | capture method, value distribution, seven anomalies |
| `MAPPING-REPORT.md` | the label → `json_id` comparison in full |
| `cmp.py`, `overlap.py` | regenerate both analyses from the CSV + `db/seed/` |

Captured 2026-09-14 from `bws-next-ai.whistlercloud.com`, grouping
`** BOILERPLATES **`, by GET of `/product_codes/<id>/specifications` — the
read-only "Specifications (Workshop)" view. 47 rows: 45 boilerplates plus two
`Planning stub` rows carrying no fields at all.

**Re-capture is cheap and should be redone rather than trusted.** That route
returns the whole sheet, so all 47 come back in one pass without clicking
through four pages each. The vocabulary is externally owned and will drift —
treat a stored CSV as a snapshot with a date on it, the same way
`external-vocabulary-sync` treats `spec_fields`.

## A boilerplate carries no values, only a field set

Across all 45 sheets there are five distinct values: `Not set TBC` (521), `TBC`
(142), `TBC by DLA Projects` (Routing, all 45), `N/A - Teflon Glide` (Floor
type, wherever present), and one Job Budget template string. So the entire
payload of a boilerplate is *which fields it lists*. That is what the matrix
records, and why a value column would have been noise.

## Mapping to `spec_fields` (2026-09-15)

34 distinct labels across the 45; 56 seeded fields.

- **29 of 34 match a seeded `name_norm` exactly.**
- **2 are renames applied on judgement, visibly** — the workshop sheet says
  `Timber Finish 1` / `Metal Finish 1` where the register says
  `Main timber finish` (4/AY) / `Main metal finish` (5/BB). `Timber Finish 2`
  (31/AZ) and `Metal Finish 2` (35/BC) match exactly either way, so the sheet is
  numbering what the register calls "Main". Applied via `RENAME` in
  `overlap.py`, never silently.
- **3 do not map**, all from the Banquettes pair: `Seat Cushion build`,
  `Show materials`, `Mechanics`.

`Seat Cushion build` is the one worth resolving: the register has
`Back Cushion Build` (25/AX) and **no Seat equivalent**, while it does carry
Seat/Back/Arm *Upholstery* Build. Either BWS is missing a column or the sheet
shows something that is not a spec column. `Mechanics` is near `Swivel Mechs`
(232/AT) — near enough to guess, not near enough to map.

Corroborating detail: the Banquettes pair are also the only two sheets whose
values read plain `TBC` rather than `Not set TBC`. They look authored at a
different time from the other 43, which is a reason to treat their three odd
labels as suspect rather than as three missing fields.

## The pre-sale boundary, reached twice independently

Two unrelated routes reach a spec field: a cheat-sheet question
(`requirements.json_id`) or a BWS boilerplate carrying it.

| | count |
|---|---|
| cheat-sheet reachable | 28 |
| boilerplate reachable | 31 |
| **both** | **24** |
| **neither** | **21** |

The 21 are coherent: all five BOM fields, all four Blue Label fields, four more
finishing-detail fields (Sheen, Timber Cut, Recipe, Colour of sample),
Purchasing Notes, Ex VAT RRP, Dimensions checked, the four Bed configuration
flags, Timber Finish 3, Upholstery pictures & Wash-up.

That is the "several BWS columns are post-sale only" position in `CLAUDE.md`,
arrived at from BWS's own templates instead of this repo's judgement. Its value
is for M8 step 4: it tells a human reading the export line by line which blanks
are *supposed* to be blank, which is otherwise 109 columns of category rules
held in the head.

**Disagreements, which are the useful part.** Four the cheat sheet asks and no
boilerplate carries — `Upholstery free text` (267/AP), `Swivel Mechs` (232/AT),
`Stone ` (147/BF), `Substrate` (192/CF); check whether the question is real or
the mapping was a guess. Seven the reverse — `Routing`, `Arm Upholstery Build`,
`Back Cushion Build`, `Timber Finish 2`, `Metal Finish 2`,
`Assy guide required`, `Job Budget`.

## KNOWN GAP (observed 2026-09-15): nothing asks for a second finish

`Timber Finish 2` is on 32 of 45 boilerplates and `Metal Finish 2` on 29, and
**neither has any cheat-sheet question**. Two-thirds of BWS's own templates want
a second finish; the requirement matrix never asks for one.

This is not an export hole. `/api/projects/[id]/export/route.ts` reads
`record_attributes` joined to `spec_fields` on `spec_field_id` (~:104) as well
as `spec_answers` (~:132), so a second finish stated on a drawing reaches column
AZ or BC as an attribute with no requirement in the way. Requirement-free
attributes are doing exactly their job.

The exposure is narrower, and sharper: the value arrives only if attribute
matching sets `spec_field_id` correctly, and that measured **1/7** on the M2
sample with `requirement_aliases` empty. **So the second finish is a good probe
for M8 step 2** — if the AP364 drawings state two finishes, whether they land in
AZ/BC tests matching directly, on a field most templates expect.

## The trap: a boilerplate is not a field list

Use it to *explain* a blank; never to *forbid* a value.

`CLAUDE.md` already says a boilerplate is a best guess, and the capture shows
why in the data:

- **Bar Stools with Metalwork carries no metal fields at all.** Every other
  "with Metalwork" variant gains `Metal Finish 1` + `2` over its Simple twin;
  that one gains only `Timber Finish 2`. It is also filed under category
  "Ottomans & Storage Boxes" while described as Bar Stools.
- **Three Hero variants are field-identical to their plain twin** — Bedside
  Tables, Mirrors, Consoles. Other Hero pairs do differ, so this reads as
  unfinished authoring.
- `Job Budget` appears on exactly one sheet, valued as a budget template rather
  than a specification. Treat as stray content, not a 35th field.

If a boilerplate ever narrows what can be recorded, it deletes the statement a
drawing actually made — the precise failure `record_attributes` was made
requirement-free to prevent, and the failure M8 step 3 exists to prove against.

## Still open

(1) and (2) need **Matthew**; they are the whole cost of the feature.

1. **The 2 renames and 3 unmapped labels.** Confirm `Timber Finish 1` /
   `Metal Finish 1` are the register's "Main" fields, and say what
   `Seat Cushion build`, `Show materials` and `Mechanics` are.
2. **Whether the 24-field agreed core is the pre-sale set.** It is a candidate
   found by measurement, not an authored rule.
3. **Deriving `na` from a boilerplate — downgraded, not adopted.** The original
   attraction was that `na` ("does not apply to this category") is populated
   from nothing real. A boilerplate is the wrong source given Bar Stools and the
   Hero duplicates. The 21-field post-sale set is safe for explaining blanks in
   the export; the rest is not safe for deriving state that gate rules read.
4. **Where a boilerplate assignment would live** — a column on `spec_records`,
   plus a suggestion pass off `item_categories`. Not designed. Gap and
   completeness checking is on the excluded list, so this waits on the Panther
   export being read by a human: that read is what says whether per-category
   field sets are even the missing piece.
