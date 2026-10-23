# Changing a spec that is wrong: the audit, and one "fix it" design (2026-10-23)

Max, 2026-10-23: "we need to do a complete revision of how do we change specs
if they're wrong … there's still a lot of work to do there." He asked for the
audit and a draft design, **and nothing built**.

The audit was read in the source on 2026-10-23, at `8f64e03`. Every route that
writes spec content was opened and followed into `src/lib`, and every screen
control that calls one was found. Nothing was driven in a browser. Where a
finding below is a defect, it was read in code and has not been reproduced on a
screen.

**Status: a draft for Max.** Six questions at the end are his. It must not be
built ahead of Matthew and Claudia's item-review design (CLAUDE.md, the
2026-10-12 milestone paragraph). The design below is a PANEL their screen can
host, not a screen of its own.

---

## 1. Why it is hard: a shipped value is up to four things

A value on any screen is not one stored string. `composeAttributeStatement`
(`src/lib/bw-standard.ts:195`) builds it from as many as four layers, and the
export picks between two stores:

| Layer | Where it is stored | Who changes it, and where | How far it reaches |
|---|---|---|---|
| **What the document said** | `record_attributes.value`, with its run and page | "Edit value" (a supersede that keeps the page), "Retire", on the record's Specs tab | one record |
| **The finishes library** | `project_finishes` (description, state), linked by `finish_id` | "Edit" on the project's Finishes tab | **every item carrying the code** |
| **BW's own finish** | `standard_*` on the finish if linked (0045), else on the attribute (0041) | the Finishes tab for a linked spec, the record for an unlinked one | N items, or one |
| **A size** | five slot attributes plus `spec_records.dimension_note` | slot rows on the Specs tab; the note under "This item → Edit" | one record |

Then there is **the checklist answer** (`spec_answers`), which is a PROJECTION
of the attributes until a person types in it, and then it is not.

So "this is wrong" has no single meaning. The fabric shown as COM 1 may be wrong
because the drawing was misread (a supersede on one item), because the library's
description of `FAB-14` is wrong (eleven items), because BW's proposed finish is
wrong, or because the item should not carry a COM 1 at all (retire). Today the
person has to know which layer produced the words before they can find the
control. That is the whole problem, and every finding below is a face of it.

## 2. What exists today

### Every write, by what it does to the value

29 routes write spec content. Grouped by verb, with the screens that reach them:

| Verb | Route (under `src/app/api`) | Screen and control | Reason | Reach |
|---|---|---|---|---|
| **Correct one value** | `attributes/[id]/correct` | Record → Specs, "Edit value" → "Save the correction" | always, inline | one record; supersede, keeps the page |
| | `disagreements/[id]/resolve` (`used_this`) | Record → Specs, red row, "Use this instead" | always, inline | one record; supersede |
| | `records/[id]/common` (`correct`) | Split bill line, "Edit on all N" | inline, or an open change | N configurations |
| **Type an answer** | `answers/[id]` PATCH | Record → Checklist box (saves on blur); infill row | only over a confirmed answer, and asked at the TOP of the page after a refusal | one row; becomes `manual` for good |
| | `projects/[id]/answers/apply` | Infill → By question, "Record on N items" | none; settled rows skipped and named | N records |
| | `projects/[id]/project-wide` | Overview, project-wide card, "Save on N items" | only over a differing settled answer | every item asking it |
| | `records/[id]/common` (`answer`) | Split line, "Answer on all N" | only when overriding | N configurations |
| **Add a value** | `attributes` POST | "Add a spec by hand"; the Dimensions row's "Record" | none | one record |
| | `records/[id]/common` (`add`) | "Add a spec to all N" | optional | N configurations |
| **Remove a value** | `attributes/[id]` PATCH | "Retire" → "Retire it"; "Put back" is one click | always, inline (Put back auto-fills one) | one record |
| | `records/[id]/common` (`retire`) | "Retire from all N" | always | N configurations |
| **Change the finish** | `attributes/[id]/finish` | "Attach to a finish…" / "Change the finish…" | only to unlink | one record |
| | `projects/[id]/finishes/[finishId]` PATCH | Finishes tab, "Edit" → "Save" | when the finish is confirmed | **every linked item**, said with a count |
| | `projects/[id]/finishes/kinds` | Finishes tab, "File all N" | generated | every linked item |
| **Change BW's finish** | `attributes/[id]/standard` | Record → Specs, "Set…" / "Client agreed" (unlinked specs only) | only over an agreed one | one record |
| | `projects/[id]/finishes/[finishId]/standard` | Finishes tab, "Set…" / "Client agreed" | only over an agreed one | N items, said |
| **Change the item** | `records/[id]` PATCH | "This item → Edit" (description, qty, area, dimension note…); category and level selects | none | one record |
| | `projects/[id]/levels/accept` | "Accept all N" in four places | none | up to a project |
| **Before confirm** | `imports/[id]` PATCH | every review screen's rows, saved on change | none; staged only | the staged JSON |

Not spec values, listed so nothing is missed: `records/[id]/configurations`,
`configuration-name`, `configuration-status`, `image/choose`,
`projects/[id]/runs/[runId]`, `projects/[id]/mockup`, `projects/[id]/notes/[noteId]`,
the finish swatch, `projects/[id]/finishes` POST and `bulk`, and every
`imports/[id]/confirm`. Outside the API: four backfill scripts write
`record_attributes` under change sets, and the QA tools delete rows directly.

**There are sixteen separate controls for "this value is wrong"**, spread over
the record's Specs and Checklist tabs, the fill-in screen, the overview and the
Finishes tab. Which one applies depends on the layer.

### What is consistent, and should stay

- **Nothing is edited in place that a document said.** A correction is a
  supersede that keeps the run and page (0033); a disagreement keeps both
  sides; a retire is reversible. This is the provenance rule and the design
  keeps it whole.
- **Every write takes the record's version, opens or joins a change set, and
  takes one snapshot per record.** The 409s are named and reach the row.
- **The answer follows the attributes** (`recomposeAnswers`), so the checklist
  and the file agree — until somebody types in the checklist (§3.1).

## 3. What the audit found

Numbered for the questions in §6. Each says what is wrong and where.

1. **A checklist answer typed over a field an attribute holds is IGNORED by the
   file, and the screen never says so.** The Checklist box has no guard: it
   edits any answer (`RecordChecklist.tsx:792`), and `editAnswer` writes it
   `manual`. The export takes the attribute first and the answer only where no
   attribute holds the field (`bws-export.ts:561-571`). So a person who corrects
   COM 1 on the Checklist sees their value on the Checklist and in the gates,
   while the BWS file and the check sheet ship the drawing's. The Dimensions row
   learned this on 2026-09-22 and has no box. No other field has learned it.
   *Read in code, not reproduced on a screen.*
2. **Correcting a linked finish can unlink it silently.** "Edit value" on a spec
   linked to the library unlinks it where the new words conflict with the
   library's description (`attribute-correct.ts:225-249`). The person is told
   after saving (`records/[id]/page.tsx:638`), not before.
3. **A link to the library gives no count.** "Attach to a finish…" says
   "correcting the finish once corrects every item carrying it", with no number
   (`page.tsx:1454`). The Finishes tab's own Edit does give the number.
4. **The reason is asked four different ways.** Always and inline (correct,
   retire, resolve); only over a confirmed answer, in a box at the top of the
   page after the server refuses (Checklist); only over an agreed standard; or
   never (add, details, levels). An open change satisfies some and not others:
   anything that always supplies its own reason never joins one.
5. **"Open a change first" points at nothing on the record screen.** The
   refusal says it, and `OpenChangeBar` is mounted only on the project page and
   the fill-in screen.
6. **Values shown with no way to their editor.** The composed Dimensions card
   links neither to its slot rows nor to the note editor. The Checklist's
   "— already recorded" slot does not link to the Specs row that changes it.
   The Gates tab's slot and record-column rows are plain text. The drawings
   card's replace panel and the bill review's "was → now" name a held value but
   do not link the record holding it.
7. **A refused qualifier edit is lost.** On a configuration's "What makes …
   different" card, an edit refused for want of a reason is replayed without
   its qualifier (`PendingReason`, `page.tsx:438`, `:533`).
8. **A preamble note's Retire and Flag open no change set.** The route runs
   outside a transaction (`projects/[id]/notes/[noteId]`), so its audit rows
   belong to no change. Flagging a retired note re-stamps `retired_at`.
9. **Twin lines have no link.** `GR-FUR-13` and `PL-FUR-13` are one item on two
   lines (Max, 2026-10-12: "link them better, so a spec is added to both at
   once"). Nothing can say so today, so every fix is made twice or missed once.

## 4. The design: one "Fix" on every value

**Matthew's ask, 2026-10-12 (58:36):** "these are the specifications that …
the app thinks it's got. These are the specifications that it's not sure about
… almost like on a table." **His ask on 2026-10-15 (43:52):** "flagging that
this intake contradicts what you already put in." **Max's direction of
2026-10-15:** a few words and the next step, the detail one click away.

### 4.1 The shape

Every spec value on the record screen, the fill-in screen and the coming
item-review screen carries **one** control, **Fix**. It opens one panel with
three parts:

**What BWS receives**, in large type, exactly as the file will carry it.

**Where it comes from**, one line per layer that contributed, each in plain
words with its source:
- *The drawing says* "Antique brass, machined" — `AM-ID-PL-FUR-11.pdf`, page 2
- *The library's GR-MTL-01 says* "Antique Bronze" — on 17 items
- *BW's finish for GR-MTL-01* "BW Antiqued Brass" (proposed)

**What's wrong?** A short list of answers, offered only where they apply:

| The person says | What it does | Existing write |
|---|---|---|
| **The words are wrong for this item** | supersedes the attribute, keeps the page | `attributes/[id]/correct` |
| **It's the wrong finish code** | relinks this item to another code | `attributes/[id]/finish` |
| **GR-MTL-01 is described wrong** (on 17 items) | edits the library row | `projects/[id]/finishes/[finishId]` PATCH |
| **BW's finish is wrong** | sets the standard, per code or per item | the two `standard` routes |
| **It's in the wrong place** (a size) | the slot picker, as on the drawing card | `attributes/[id]/correct` with a slot |
| **Not decided yet** | TBC | `attributes/[id]/correct` with state `tbc` |
| **This item doesn't have it** | retires it | `attributes/[id]` PATCH |
| **Ask somebody** | adds the question to the chase | nothing new until Matthew and Claudia's design says what a question is |

Then **one line saying what will change before anything is written**, always
with a count: "Changes this item only", "Changes 17 items: GR-FUR-04, …", "This
item stops using GR-MTL-01 and keeps its own words". This closes findings 2 and 3.

Then **one reason box**, the same everywhere (finding 4): asked whenever the fix
overrides something a document said or a person settled, and satisfied by an
open change. `OpenChangeBar` moves onto the record screen (finding 5).

Afterwards the panel shows **before → after** of what BWS receives, which is
the check that the fix landed where the person meant.

### 4.2 Rules it must keep

- **No new write paths.** The panel chooses among the routes above. The
  provenance rule, the version checks, the change sets and the snapshots stay
  exactly where they are. What is new is the READ: one loader that, given a
  record and a field (or slot), returns the layers, the reach of each answer,
  and the composed cell. It calls `composeAttributeStatement` and
  `composeDimensionCell` and never re-implements them — the single-composer
  rule.
- **The reach is computed on the server and re-checked at write.** A count on
  screen that the write does not honour is how somebody changes eleven items
  believing it is one (the finishes library rule).
- **A field an attribute holds has no free answer box** (finding 1). The
  Checklist row shows the composed value with Fix, as the Dimensions row already
  does. A field no attribute holds keeps its box, because its answer IS the
  value.
- **A configuration and a split line ask "this one or all N"**, through the
  existing `common` route. A value that differs between configurations is fixed
  on each.
- **Every value shown elsewhere links to its Fix** (finding 6): the Dimensions
  card, the Gates rows, the "already recorded" slot, the replace panel's held
  value.
- **Before confirm stays as it is.** A review screen's row edits the staged
  JSON, which writes nothing and needs no reason. Fix is for what is already on
  the record.

### 4.3 What it does not do

- It does not merge layers or decide which is right. The person picks.
- It does not edit a value in place.
- It adds no table and no migration in its first two steps (§5).

## 5. If Max says go: the order

1. **The loader and the panel on the Specs tab**, beside the controls that
   exist, so the two can be compared. Fixes findings 2 and 3 on the way.
2. **The Checklist row**: an attribute-held field shows the composed value and
   Fix, and loses its box (finding 1). Before it ships, measure how many
   `manual` answers on pilot already sit over an attribute that differs: they
   are values a person believes are in the file and are not.
3. **One reason rule and `OpenChangeBar` on the record screen** (findings 4
   and 5).
4. **The links** (finding 6), and the small defects (7 and 8).
5. **Placed into Matthew and Claudia's item-review screen** when their design
   arrives. "Ask somebody" is designed there.
6. **Twin lines** (finding 9): needs a stored link between two records, so a
   migration. Its own plan.

The old controls are removed only after Max has used Fix on pilot. Two ways to
do one thing for a while is cheaper than a fix nobody can find.

## 6. Questions for Max

| Q | Question | Proposed |
|---|---|---|
| F1 | A checklist answer over an attribute-held field: lock it to Fix, or keep the box and make it write the attribute? | **Lock it.** A box that writes somewhere else is a second way to supersede, with no page and no reach line |
| F2 | The answers already typed over an attribute (finding 1): leave them, list them on the record, or ask on each? | **List them on the record**, red, as "the Checklist says X, the file ships Y", with Fix |
| F3 | When is a reason asked? | **Whenever the fix overrides a document's words or a settled value**, one line, an open change counts. Never for TBC or for filling a gap |
| F4 | Is Fix the word? | **"Fix"**, or "Change". Never "Correct", which Matthew read as "mark it as correct" on 2026-10-15 and which is now "Edit value" |
| F5 | Does Fix wait for Matthew and Claudia's design? | **Steps 1–4 do not**: they are on the screens that exist. Step 5 waits |
| F6 | Twin lines now or later? | **Later**, its own plan: it is a schema change |
