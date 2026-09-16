# TGQ — getting the gate out of Matthew's head

**Raised 2026-09-16 by Max, after the review with Matthew.**

Two routes to the same answer, both generated from the seed files. **The
workbook is the one to use** (Max, 2026-09-16). The interview is kept because
it is the same decision spoken rather than typed.

| | Built by | Asks | Costs Matthew |
|---|---|---|---|
| **Workbook** | `tools/tgq-checklist.mjs` | **1,368 tick boxes, all empty** | tick what we can quote without |
| Interview pack | `tools/tgq-interview.mjs` | 62 questions, spoken | 5 chats, 20–30 min each |

Interview answers come back through `tools/tgq-answers.mjs`; the workbook comes
back as the workbook.

## What TGQ is

**TGQ is the pre-sale gate: we know enough to put a price on this item.** Not
enough to build it — enough to quote it. Everything else can still be TBC.

It is the milestone the app is being built towards. Today the completion view
reports confirmed / TBC / missing across all 728 cheat-sheet questions, which
tells a KAM how full the form is and not whether they can send a quote. Those
are different questions, and only the second one is worth anything at tender
stage.

TGQ sits below the handover's TG0 / TG1 / TG2. Those are unauthored too —
`requirements.required_at_gate` is null on all 728 rows and there is no `gates`
table — and they stay out of scope.

## The three levels

Matthew described a three-level system per category: **simple sofa, complex
sofa, hero sofa** — or **simple table, table with metalwork, hero table**. What
changes between them is how much has to be known before a price is possible. A
hero item has intricate stitching to price; a table with metalwork has metal to
price; a simple one has neither.

This is not an invention of this repo's. **BWS already uses that vocabulary**:
the 45 boilerplate product codes captured on 2026-09-14 come in `, Simple` /
`, with Metalwork` pairs across the upholstery categories, and `Hero` variants
across cabinetry. Both routes show a category's existing BWS variants and let
Matthew rename the levels to whatever the business actually says.

## The workbook

`node tools/tgq-checklist.mjs` writes `out/TGQ-checklist-<date>.xlsx`: five
sheets, dropdowns of Yes / No / N/A / ?, one long filterable Checklist sheet
plus the commercial block hoisted onto its own.

### Three boxes per question, and a tick means NOT needed

Simple, Complex, Hero. **An empty box means the question is needed to quote; a
ticked box means we can quote that level without it.** Empty is therefore
today's position — all 728 questions required of everything — so the file states
the current state and the value in the returned copy is entirely what Matthew
strikes out.

Three things about how the box is built:

- **It is a bordered empty cell and the tick is a plain `X`.** Excel's own
  click-to-toggle checkbox (Microsoft 365, 2024) is a cell format this
  toolchain cannot write, and legacy Form Control checkboxes are one drawing
  object each — 1,368 of those makes a file nobody can scroll. A bordered cell
  is what a checkbox looks like on paper and costs one keystroke. If the real
  control is wanted later, the move is to select the three columns in Excel and
  use Insert → Checkbox.
- **No ballot-box glyph** (`☐` / `☑`). It renders as tofu wherever the font
  lacks it, and a checklist whose boxes show as missing characters is worse than
  one drawn with borders. **Anything** in the cell counts as ticked, so a typed
  x, a tick character or a pick from the dropdown all read the same; validation
  is warning-only, because blocking validation on a checkbox rejects the one
  gesture people actually use.
- **An empty box is genuinely empty, never `''`.** exceljs writes an empty
  string as a real shared-string cell, which Excel does not treat as blank —
  `COUNTA` then counts every untouched box as ticked and an untouched file
  reports 1,368 of 1,368 struck out. The cells carry a style and no value.

### What the box cannot say, and what covers it

The four-value dropdown it replaces could say **N/A** (this question does not
belong on this category at all) and **?** (unsure). A box cannot. Both now go in
the **Notes** column, which the Start here sheet asks for explicitly — the
capability is kept, the control is not.

And the cost of a single mark: **an empty box means "needed to quote" and "not
looked at yet" at the same time**, so a category Matthew never opened is
indistinguishable from one he read and agreed with, and the second is a decision
where the first is a silence. The **"Been through it?"** column on the Level
names sheet recovers it — Done / Part way / Not yet, seventeen ticks rather than
1,368, left blank and never pre-filled, because it is the one cell in the
workbook whose whole job is to say a human looked.

### The hoist

The commercial 17 are byte-identical everywhere — asserted by
`assertSharedBlockIdentical`, not assumed — so they are asked once instead of
seventeen times. 2,184 cells become 1,368.

**N/A earns its place in both routes.** Several questions sit on sheets they do
not belong on — the Consoles sheet asks for `Stitching spec` and `Stud spec`,
the Dining tables sheet asks whether the item is fully outdoor. Saying N/A
prunes the matrix at the same sitting, by the only person who can.

## Why the interview asks 62 questions and not 728

**The 17 cheat sheets repeat each other.** 728 requirement rows are only **62
distinct questions**: "Stitching spec" is on fifteen sheets, "Dimensions" on
all seventeen, and the entire commercial block is word-for-word identical
everywhere. Whether a question gates a quote is **one decision, not fifteen**.

So the interview asks each question once, and `tgq-answers.mjs` expands the
answer back across every category that asks it. Where a category genuinely
differs, Matthew says so in passing — "yes, but never for mirrors" — and that
is recorded as an exception row against that category.

The workbook cannot do this, which is why it is the slower route: it asks per
category because a spreadsheet cell has to belong to a row.

## The interview pack, if he would rather talk

`node tools/tgq-interview.mjs` writes six files to `out/tgq-interview/`:

| File | | |
|---|---|---|
| `00-read-this-first.md` | the brief | what TGQ is, the levels, how to run a chat |
| `01-commercial.md` | 17 | the project, not the piece |
| `02-the-item.md` | 9 | design intent, size, material, finish, metal |
| `03-upholstery.md` | 15 | fabric, fill, stitch, mechanism |
| `04-cabinetry.md` | 8 | carcass, moving parts, ironmongery |
| `05-site.md` | 13 | environment, fit, services, surroundings |

Matthew opens a chat, turns on voice, pastes one file, talks through it, and
copies out the block Claude prints at the end.

**Every file repeats the rules and the output format in full.** A voice session
may be started fresh or lose the top of its context, and a chunk answered under
half the rules is worse than a chunk not answered. The files can be done in any
order, on any day, in separate chats; nothing carries between them.

Three things in the brief are load-bearing rather than decorative:

- **The interviewer must never infer an answer he did not give** — not from a
  similar question, not from what the category obviously needs. This is the
  repo's own rule about not replacing a human decision with automation, applied
  to the conversation that authors the rules.
- **"Not sure" is a recordable answer** (`?`), and unreached questions come back
  as `-`. A question with no answer must stay visibly unanswered; the reader
  names them rather than defaulting them to "No".
- **Exceptions are only recorded when Matthew names one.** The model is told not
  to walk the category list asking him to confirm each, and the reader refuses
  an exception naming a category that does not ask that question — which is what
  an invented exception looks like.

### The chunking is editorial, and only that

The eight sections come from the cheat sheets. **Build details is 36 questions**,
too long for one conversation, so it is split into three by what a person is
thinking about. No question moves section, changes id, or leaves the pack, and
the generator refuses to build if a Build details question is not in exactly one
group — dropping one silently is the failure that grouping invites.

## Reading the answers back

```bash
node tools/tgq-answers.mjs <file-with-the-blocks>
```

Takes one file with however many blocks in it, fences and chatter included, in
TSV or markdown-table form. Writes `out/tgq-answers/expanded.csv` (one row per
requirement per level) and `summary.md` (coverage, outstanding, unsure,
exceptions, per-category counts, and anything Matthew wanted added).

**It writes nothing to the database.** The summary exists so that what Matthew
said can be checked against what the tool understood before anything is seeded.

It refuses, rather than guesses, on three things:

- **A pack fingerprint that is not this seed's.** Question ids are positional
  (`Q01`–`Q62`), so a seed revision between issuing the pack and reading it back
  shifts them and every later answer lands on the wrong question — in the
  direction of a *wrong gate*, not a missing one. The pack id carries a hash of
  the exact question list it was built from.
- **An exception naming a category that does not ask that question.**
- **A value that is not one of the five.** Blank is not "No".

## What comes back, and what happens to it

The `Key` on every expanded row is `<category slug>:<sort_order>` — exactly the
pair `db/seed/0003_requirements.sql` keys on.

Turning the answers into behaviour is **a re-seed plus a migration, and no
application logic moves** — the same rule as every other cheat-sheet revision:

1. a migration adding the TGQ level dimension to `requirements` — shape decided
   once the answers exist and the exceptions are known, not before;
2. a re-seed carrying `expanded.csv`;
3. the completion view reading TGQ instead of, or alongside, the flat count.

## The known gap

**An item's level is not recorded anywhere.** The answers produce rules of the
form "for a hero sofa, dimensions are required to quote", and the app has no way
to know that a given BOQ line is a hero sofa. Setting a level will be a person's
decision on the record, alongside category — it is not derivable from a BOQ
line, and guessing it would put the whole gate on a guess. A known next step,
not an oversight, and it blocks nothing about asking Matthew now.

## What is NOT being asked

**The BWS field mapping.** Each question shows where its answer would land, for
context. That mapping is this repo's judgement and reviewing it is the separate
four-question note — [`questions-for-matthew.md`](questions-for-matthew.md).
Mixing the two turns a conversation into an audit.

## Regenerating

```bash
node tools/tgq-interview.mjs
node tools/tgq-checklist.mjs
```

Both write to `out/`, which is gitignored: the generators are the artefacts
worth keeping, and a filled-in copy comes back by email rather than by git. Both
read the seed files, not the database, so neither needs `DATABASE_URL` and
neither can be affected by the state of any environment. `tools/lib/requirement-seed.mjs`
is the single parser they share — question identity has to be the same in the
pack and in the reader, or an answer lands on the wrong question.
