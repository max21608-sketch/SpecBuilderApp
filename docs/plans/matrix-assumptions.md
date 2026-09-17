# Matthew's matrix: what Max answered on his behalf, and how to undo it

**2026-09-17.** Matthew's `BWS_Spec_Decision_Matrix_for_Max.xlsx` arrived with
eight open questions attached (`docs/plans/questions-for-matthew.md` has the
earlier four; the new ones are in the draft reply). Rather than wait, Max
answered the ones that blocked code so the gate model could be built, on the
explicit understanding that **every answer here is a stand-in and each is still
to be checked with Matthew.**

This file is the checklist for that conversation. Each entry says what was
assumed, what it changed, what it costs if it is wrong, and how to reverse it.

Nothing here is expensive to undo. The gate model is seed data: a re-seed plus
a migration is the whole change, and five of the seven entries below are a
re-seed alone.

---

## 1. The matrix is adopted as the gate model — YES

**Max's answer:** "I think the answer is yes to the matrix, unless there's
anything really obvious. I assume it includes things like key dimensions."

**Checked:** it does. Rows 4–7 are Width, Depth, Height and Seat height, all at
TGQ, all carrying BWS id 3. Seat height is excluded from Daybeds, Ottomans and
Beds & Headboards in his own sheet, and that exclusion is preserved.

**What it changed:** `spec_field_gates` holds all 35 of his rows. The record
screen and the spec table report TGQ / TG0 / TG1 per record.

**To reverse:** delete the seed rows. Nothing else in the app reads them.

---

## 2. His TGQ set was NOT used to re-tier the quote questions — DELIBERATELY NOT DONE

**This is the one that would have been expensive, and it was left alone.**

Read literally, his fourteen TGQ rows say that only fourteen fields stop a
quotation going out. The app already has a to-quote tier — `requirements.tgq_levels`
(0019), read by `questionTier`, the chase emails, the drafts screen and the
spec table — and applying his reading to it would strike roughly 48 of the 62
distinct checklist questions out of that tier in one re-seed.

That is a big claim with a big blast radius, and it is exactly what the tick-box
workbook sent to Matthew on 2026-09-16 (`tools/tgq-checklist.mjs`) was built to
ask. So `tgq_levels` is untouched: all 788 requirement rows still carry all
three levels, and "Needed to quote" on the spec table means what it meant
yesterday.

**What to ask Matthew:** does the matrix answer the workbook? If yes, stop the
workbook — two answers to one question is worse than none — and the change is a
re-seed of `tgq_levels` with no code.

---

## 3. The category mapping — THREE JUDGEMENT CALLS

His nine seating categories are not our seventeen cheat sheets. The mapping is
in `db/seed/0005_spec_matrix_categories.sql`, and every debatable row carries
its reasoning in the `note` column so it is visible in the data.

Six of the nine are unambiguous. Three are not:

| Assumed | Why | If it is wrong |
|---|---|---|
| **A → `desk-chair-cinema-chair`** | He has no category for desk or cinema chairs at all. They are nearer occasional chairs than dining chairs, and swivel — which he asks of A — is already asked of a desk chair by our own seed. | Desk chairs get a gate view built from armchair rules. Remove the map row and they get no gate view instead, which is the honest fallback. |
| **S and B both → `armchairs-benches-stools-sofas`** | That is one sheet covering armchairs, benches, stools and sofas, so it receives his S, A and B together. | **Swivel widens**: he asks it of A and not of S or B, and it is now asked of all of them. |
| **S and D both → `sofas-bed-daybeds`** | That sheet covers sofa beds and daybeds. | **Seat height widens**: he asks it of S and explicitly not of D ("Not applicable: Daybeds, Ottomans, Beds"). |

**Union was chosen over intersection** on the repo's own rule — "a field nobody
can select is a spec value nobody can record". A widened question can be
answered N/A, which is a real state; a missing one cannot be answered at all.
But widening is still a decision, and `tests/db/spec-field-gates.test.ts`
asserts both of them explicitly, so changing the mapping fails a test rather
than quietly altering what gets asked.

**To reverse:** edit the map rows and re-seed.

---

## 4. Sixty new checklist questions — PROMPTS ARE HIS FIELD NAMES

Six BWS fields his matrix gates were asked by **no question anywhere in the
repo**: Assembly guide (191), Timber Finish 2 (31), Timber Finish 3 (143),
Metal Finish 2 (35), Back Cushion Build (25), Purchasing Notes (24). Three of
those were already flagged as a gap on 2026-09-16 in
`docs/plans/questions-for-matthew.md` Q2, and his matrix answers it: they are
wanted.

Two more (Seat Upholstery Build, Outdoor) were asked by some categories and not
others, where his matrix says all.

`db/seed/0007_requirements_gate_fields.sql` adds 60 rows, taking the checklist
from 728 to 788.

- Where a field is already asked somewhere, **that exact prompt is reused**, so
  one question reads identically across every category — the property that
  makes 788 rows only 68 distinct questions.
- Where it is asked nowhere there is no cheat-sheet wording to reuse, so the
  prompt is **Matthew's own field name** and the help text says so and names
  the matrix row.
- `tgq_levels` is all three, the 0019 default. **That is not a claim these six
  block a quote** — it is today's position, required of everything, until
  entry 2 above is settled.

**Visible side effect:** outstanding counts on already-categorised records went
up, correctly. There genuinely are more questions now.

---

## 5. A default does NOT satisfy a gate — ASSUMED

His sheet says Assembly guide is "No (default)".

**Assumed:** a default pre-selects a *control*; it never writes an *answer*.
`missing` means nobody has looked, and a gate passed by a default is a gate
passed by nobody. So Assembly guide reads as outstanding at TGQ and TG1 until
somebody answers it.

**If Matthew disagrees**, the change is one seeded palette option marked
`is_default` and a rule that treats it as confirmed — which would also mean
deciding what `Dimensions checked` means when nobody has checked them. Worth
asking before building the palettes (Stage 4).

---

## 6. The five BWS-owned palettes — NOTHING INVENTED

Timber finish, metal finish, seat build, back cushion and stud all say "From
the BWS … palette" and **this app holds none of them**.

They are recorded by key with his exact wording, the fields stay free text, and
the screen says "not loaded in this app yet" in words rather than offering an
empty dropdown. FMT-GEN-01: a BWS-owned vocabulary this app does not know is
left blank, never guessed.

**No assumption taken.** This is question 7 of the draft reply and it blocks
the finish dropdown he asked for in his first bullet.

---

## 7. Four things deliberately NOT built yet

Each is a stage of the plan, and each depends on an answer that has not come:

- **The free-text field**, one column or two. `Product code` and `Spec notes`
  currently report "Nowhere to record it" on the TGQ panel, which is the truth.
- **The qualifier / return line.** Nothing is captured and the export is
  unchanged and still one line per cell.
- **The Product code / boilerplate derivation**, and what selects Hero.
- **The costing sheet.** Max does not have the `skill.md`; ask Matthew for it.
  The app holds no prices and will not generate one.

---

## How to check this file is still true

```bash
npm run db:seed                      # idempotent; re-seeding is how the model changes
node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/spec-field-gates.test.ts
```

The db-tier test asserts the 35 rows, both widenings, that every mapped
category can answer every field its gates name, that the eight cabinetry sheets
get no gate view, and that the five BWS palettes are still empty. If Matthew
changes an answer, that test is what tells you what else moves.
