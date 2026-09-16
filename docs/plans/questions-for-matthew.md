# Four questions for Matthew — the BWS field mapping

**Raised 2026-09-16 by Max. Blocks M8 step 4 (the Panther export judged
correct). Nothing else in M8 waits on it.**

Each question below is a decision only Matthew can make, and each one is
narrow: there is evidence attached to every one, and none of them needs a
document to be found first. Estimated 30–40 minutes in total.

## Why these are being asked now

The Spec Builder's checklist is seeded from the 17 cheat sheets — 728
questions, in the sheets' own wording. When a question is answered, the answer
has to land in the right **BWS spec column**, or the export writes a correct
value into the wrong field and nothing downstream questions it.

That question-to-column mapping is currently **this repo's judgement, not
Matthew's**. It reaches 28 of the 56 BWS spec fields.

On 2026-09-14 all 47 BWS boilerplate product codes were captured read-only from
the `** BOILERPLATES **` grouping, which gave a **second, independent** answer
to the same question: which spec fields does BWS itself expect an item of this
kind to carry? 31 fields are reachable that way.

The two routes agree on **24 fields**. The disagreements are what follows — and
they are the useful part, because a disagreement is either a wrong mapping on
our side or a gap in the BWS templates, and we cannot tell which from here.

---

## Q1 — Four fields the cheat sheets ask for, and no BWS template carries

For each of these, a cheat-sheet question was mapped to a BWS column by this
repo. No boilerplate carries the column, which means either the mapping is
wrong, or the templates simply do not pre-load a field that is nonetheless
real.

| BWS field | Col | The cheat-sheet question we mapped to it | Asked by |
|---|---|---|---|
| `Substrate` (192) | CF | "Substrate" | all 17 categories |
| `Stone ` (147) | BF | "Stone Details" | 7 cabinetry categories |
| `Swivel Mechs` (232) | AT | "Swivel Mechanism 360 or 180 (return or non return also)?" | 5 seating categories |
| `Upholstery free text` (267) | AP | "Fluted, Deep buttons & pleats specs" | 9 upholstery categories |

**What we need:** for each row, *is the mapping right?*

Two of them look safe on their face — `Substrate` and "Substrate" are the same
word, and the swivel question could hardly mean anything but `Swivel Mechs`. If
those mappings are right, the finding is about the **templates**, not us.

The one we actively doubt is the last. "Fluted, deep buttons & pleats" is a
specific upholstery detail, and we parked it in a **generic free-text column**
because no better column existed. If there is a right home for it, say so; if
free text is genuinely where it goes, confirm that and we will stop treating it
as suspect.

---

## Q2 — Four fields BWS templates carry, and nothing asks for

The reverse direction. These are on most or all boilerplates, so BWS clearly
expects them — but no cheat sheet asks a question that would fill them, which
means the checklist can never produce one.

| BWS field | Col | On how many of the 45 templates |
|---|---|---|
| `Routing` (34) | AF | **45 / 45** — every one, always valued "TBC by DLA Projects" |
| `Assy guide required` (191) | BL | **44 / 45** |
| `Timber Finish 2` (31) | AZ | **32 / 45** |
| `Metal Finish 2` (35) | BC | **29 / 45** |

**What we need:** should any of these become a cheat-sheet question?

The sharp one is the **second finish**. Two-thirds of BWS's own templates want
a second timber finish and nearly two-thirds want a second metal finish, and
the requirement matrix never asks for either. A two-tone item is not unusual.

This is not an export hole — a second finish stated on a drawing still reaches
column AZ or BC as an attribute, with no question in the way. The exposure is
narrower: it only lands there if the drawing's wording is matched to the right
field automatically, and that currently measures **1 in 7**. A question would
make it reliable instead of lucky.

`Routing` and `Assy guide required` may well be post-sale fields that a
pre-sale checklist should not ask about at all. If so, saying that is the
answer, and it is just as useful.

---

## Q3 — The Banquettes pair, which is where every oddity comes from

Two boilerplates — `.BW-Banquettes,-Simple` (id 1312) and
`.BW-Banquettes,-with-Metalwork` (id 1313) — account for nearly everything
strange in the capture.

They are the **only two of 45** that carry `Seat Upholstery Build`,
`Back Upholstery Build`, `Arm Upholstery Build`, `Back Cushion Build`,
`Seat Cushion build` and `Show materials`. They are also the **only two** whose
placeholder values read plain `TBC` where the other 43 read `Not set TBC`.

Three of their labels match **no field in the BWS register** we hold:

- **`Seat Cushion build`** — the register has `Back Cushion Build` (25 / AX) and
  **no Seat equivalent**, though it does carry Seat/Back/Arm *Upholstery* Build.
  Either BWS is missing a column, or this sheet shows something that is not a
  spec column.
- **`Show materials`** — no near match at all.
- **`Mechanics`** — close to `Swivel Mechs` (232 / AT). Near enough to guess,
  not near enough to map. Note this may be the same field as Q1's third row.

**What we need:** were these two authored to a different standard from the
other 43, and what are those three labels? If they are simply out of date, we
will treat their odd labels as noise rather than as three missing fields.

**Two renames to confirm while you are there.** The workshop Specifications
sheet says `Timber Finish 1` and `Metal Finish 1`, where the spec register says
`Main timber finish` (4 / AY) and `Main metal finish` (5 / BB). Since
`Timber Finish 2` (31 / AZ) and `Metal Finish 2` (35 / BC) match exactly either
way, we have read the sheet as *numbering* what the register calls "Main", and
applied that rename visibly rather than silently. Confirm or correct it.

---

## Q4 — What the export puts in the job columns

The BWS export is 109 columns: about 30 of job metadata, then the 56 spec
fields, then the website-archive block. **This app only fills five of the job
columns**, and everything else is left blank on purpose — a guessed enum
imports as a wrong classification.

| Column | What we put in it |
|---|---|
| `Client` | the project's client |
| `Project Ref` | the project name |
| `Name` | the BOQ line's item description |
| `Item Count` | the BOQ quantity |
| `Client Code` | the item's BOQ reference(s) |

**What we need:** are those five right, and is blank the correct value for the
rest?

Also worth confirming explicitly: the file carries **no `Id` and no
`Job Number`**, because this app has never known either. It is a review file a
person uploads, never a write-back.

**The reason this one matters more than it looks.** A BWS quote import
**replaces** rather than merges. If a column is wrong or a required one is
missing, the import does not partially fail — it overwrites. This is the most
dangerous file in the product, and the only thing standing between it and a
real import is somebody who knows BWS reading it line by line.

Ideally: **a real BWS export of an existing job**, to compare against. That
would answer this question in about two minutes and would also settle whether
any of the 21 fields we believe are post-sale actually are.

---

## While you are in the boilerplates — four things that look like authoring slips

Lower priority than the four questions, but cheap to check in the same sitting.
Flagged, not cleaned up, because we do not know which side is wrong.

1. **`.BW-Bar-Stools,-with-Metalwork` (940) carries no metal fields at all.**
   Every other "with Metalwork" variant gains `Metal Finish 1` and `2` over its
   Simple twin; this one gains only `Timber Finish 2`.
2. **The same code (940) is filed under category "Ottomans & Storage Boxes"**,
   while its description reads "Boilerplate for Bar Stools, with Metal". One of
   the two is wrong.
3. **Three Hero variants are field-identical to their plain twin** — Bedside
   Tables (950 vs 844), Mirrors (948 vs 949), Consoles (945 vs 947). Other Hero
   pairs do differ, so this reads as unfinished rather than intended.
4. **`Job Budget` appears on exactly one boilerplate** (929, Armchair Simple),
   valued as a budget template string rather than a specification. Looks like
   stray content on that record, not a real 35th field.

---

## What we are *not* asking for

**The gate model.** TG0 / TG1 / TG2 assignments are still unauthored —
`required_at_gate` is null on all 728 requirements — and that is fine for now.
Gates are explicitly out of scope until the Panther export is judged correct.
A grid that is right is worth more than a gate over a grid that is not.

Please do not let the gate question hold up the four above.

---

## Links

**The boilerplate specification sheets in BWS.** Captured read-only on
2026-09-14 by GET of `/product_codes/<id>/specifications` — the
"Specifications (Workshop)" view. The ids in Q3 and the slips list address that
path. The capture ran against the AI mirror
(`bws-next-ai.whistlercloud.com`); the live equivalent is presumed to be the
same path on `bws.whistlercloud.com`, but that has not been checked.

**The cheat sheets** — `CHEATSHEET LISTS`, in the P17231 Guest Rooms folder:
`Enterprise/Shared Documents/Work Instructions/Projects/ap346-isg-maybourne-paris p17231/AP346 ISG Maybourne Paris/GR/CHEATSHEET LISTS`

**The Panther pack** the export will be judged against:
`Enterprise/Shared Documents/Work Instructions/Projects/ap364-project-panther p17726/Project Specs and BOQ`

> The Microsoft Graph connector returned 500 on 2026-09-16, so these two paths
> are taken from the project context documents rather than resolved live. If a
> link does not open, the path is the reliable part.

**In this repo**, for whoever picks this up:

- [`docs/plans/boilerplate-grouping.md`](boilerplate-grouping.md) — the full
  capture write-up, the mapping report, and why a boilerplate must never be
  used to *forbid* a value
- [`db/seed/0003_requirements.sql`](../../db/seed/0003_requirements.sql) — the
  728 questions and every field mapping in Q1
- [`src/lib/bws-export.ts`](../../src/lib/bws-export.ts) — the 109-column
  layout and the job columns in Q4
- `docs/docs for building/bws-boilerplates-2026-09-14/` (gitignored) — the
  matrix CSV, the anomaly notes, and `overlap.py`, which regenerates every
  count above from the CSV plus the seed
