# Twin lines: one item on two bill lines, linked so a spec lands on both (2026-11-06)

Max, 2026-10-12: *"`GR-FUR-13` and `PL-FUR-13` are the same item on two lines
(Guest Suites and Ambassador Suite). Keep them as separate lines in case one
changes, but link them better, so a spec is added to both at once."* The
spec-change audit of 2026-10-23 recorded it as finding 9 ("every fix is made
twice or missed once") and Max answered F6 "later, its own plan: it is a
schema change". The whole-codebase audit of 2026-11-06 put it at Stage 5.6
with the same note. This is that plan, written before the build.

**Status: PLAN, built in the audit's Stage 5.6 on `audit-int` (see
`docs/plans/README.md`).**

## 1. What a twin is, and what it is not

A **twin** is a second BILL LINE that is the same thing to make as the first,
listed separately because the bill lists it per area (GR = Guest Suites, PL =
Presidential / Ambassador Suite on the Aman bill), per phase (the mock-up and
the main run quote one chair), or per quantity break. The lines stay separate
records with their own `record_no`, quantity, area, client ref and export
row: a twin is NOT a configuration (0024: one line split into things that
differ by a cloth) and NOT a pairing (0017: a revised line continuing an old
record). It is a symmetric, many-to-many link between live bill lines that
says "a spec recorded on one is meant for the other too, unless somebody says
otherwise".

Two things the app already does are the shape to follow. A drawing of a code
that sits on one line in each of three PHASES is a fan-out: the confirm
writes to all three and the reviewer unticks a phase whose spec differs
(CLAUDE.md "One drawing, several runs"). And a finish line that NAMES a code on
two lines of one phase goes on both (`finishLineTargets`, 2026-10-15, Max:
"apply it to both, no tick boxes"). A twin link makes the same rule available
to a person on the record screen, and to a drawing whose code is on two lines
of one phase (today "still SX11A", offered and never chosen).

## 2. The data: `spec_record_twins`

```
spec_record_twins
  id            uuid pk
  project_id    uuid not null references projects on delete cascade
  record_a      uuid not null references spec_records on delete cascade
  record_b      uuid not null references spec_records on delete cascade
  reason        text not null            -- "same stool, Guest Suites and Ambassador Suite"
  status        text not null default 'active' check (status in ('active','retired'))
  retired_at, retired_by, retire_reason
  created_at, created_by, updated_at, updated_by, version
  unique (least(record_a, record_b), greatest(record_a, record_b))   -- as an expression index
  check (record_a <> record_b)
```

- **Symmetric by construction**: one row per unordered pair, so "are A and B
  twins" is one lookup either way. A set of three twins is three rows (the
  pairs), not a group id: a group would need a name nobody has, and three
  stools in three suites are three pairs a person can retire one at a time.
- **Both records are BILL LINES of one project** (`parent_id is null`,
  trigger-checked): a configuration carries its parent's twins through
  `parent_id`, as it carries its client ref and quantity.
- **Retired, never deleted** (house data-safety): a wrong link is retired
  with a reason and can be restored; a retired record's links stay as
  history and are not followed.
- **No per-twin version of the specs.** The link carries no values: the
  attributes on each record stay each record's own rows, with their own
  source run and page, exactly as a drawing fan-out writes one row per
  record. This is what keeps the export, gates, TGQ, chase and history
  untouched: nothing reads the link except the three writers below and the
  screens.

Migration **0060_spec_record_twins.sql** (the audit's Stage 5.4 holds 0059).
`change_sets.kind` gains `twin_link` and `twin_unlink` (re-listed from the
LIVE constraint, 0032's rule), both in `REASON_REQUIRED_KINDS`, because a link
is a statement that two lines are one item and an unlink says they are not,
and each destroys or overrides what a bill said.

## 3. Where a twin comes from

1. **A person, on the record screen.** "This line is one of two" → a picker
   over the project's other live bill lines (search by ref and description),
   a reason, Link. The panel then lists the twins with their phase, area and
   quantity, and each has Unlink (reason).
2. **The bill review SUGGESTS twins, and never writes one unseen.** Two lines
   of a sheet whose client refs are the same code under different ZONE
   prefixes (`GR-FUR-13` / `PL-FUR-13`: `zonedCodeParts` in `finishes.ts`
   already reads the zone), or the same ref on two lines of one phase (SX11A),
   render a `SuggestButton` "Twin of row 24?" with the evidence; accepting
   stages `twinOf` on the line; the confirm writes the link in the same
   change set as the records. A guess nobody accepted writes nothing — the
   level and category rule.
3. **Nothing else.** A drawing does not create a twin; it may USE one (§4).

## 4. What follows a twin, and the one rule for all of it

**A spec written to one twin is offered to the others, ticked by default, and
written as its own row on each.** The three writers that exist are the three
places:

- `createAttribute` (Add a spec by hand, the fill-in's dimension row) takes
  `alsoRecords: uuid[]` and writes one attribute per record, each with
  `source_run_id` null and the same words; one change set, one version per
  record. The AddSpec form shows "Also on its twin PL-FUR-13 (Ambassador
  Suite)" ticked, with the twin's current value for that slot or field beside
  it where one exists ("holds W 540 — will be replaced" goes through the
  replace acknowledgement, never silently).
- `correctAttribute` (Edit value) takes `alsoRecords` and corrects the twin's
  MATCHING row (same slot or field, same value before) by the same
  supersession; a twin whose row differs is listed unticked with its value
  ("PL-FUR-13 reads W 560, not 540 — left alone").
- `retireAttribute` likewise, for a matching row.

A drawing whose code resolves to TWO lines of one phase that are twins is no
longer "SX11A, offered and never chosen": the resolution reads the link and
lists both lines TICKED under one phase with the sentence "twins — the bill
says these are one item" (`oneLinePerPhase` stays for lines that are not
linked). The confirm's fan-out writes to both as it writes to two phases.

The bill's own finish lines already land on both twins where the line names
the code (`finishLineTargets`); a link does not change that, and a finish
line that sits under one twin and names neither still goes to the one it
sits under (Max, 2026-10-15: where a line SITS names nothing).

**The one rule:** a twin never MERGES anything. There is one row per record,
each with its own provenance; the link only decides which records a person's
one act is offered on, and the act is shown record by record before it is
taken. Nothing is averaged, nothing is copied silently, and unticking is
always there.

## 5. What does NOT follow

- Quantity, area, designer, the bill's own columns: those are what made them
  two lines.
- Checklist answers a person typed (`manual`, `email`, `document`): a twin's
  projection follows from its own attributes through `recomposeAnswers`, as
  everywhere.
- Level and category: offered once ("also set on its twin"), never written
  without the tick.
- Configurations: a twin's configurations are its own; "Add a configuration"
  on one twin offers the other, as it offers the other phases today.

## 6. Screens

- Record screen, identity band: a chip per twin ("twin of P…-024, Ambassador
  Suite") linking to it; the Twin lines panel under Configurations.
- Phase table: a small "twin" chip on each linked line, with the other's
  record number in the hover.
- Bill review: the `SuggestButton` per line (§3.2) and "Accept the n suggested
  twins on this tab".
- AddSpec, Edit value, Retire: the "also on" ticks (§4).
- Drawing card: the twin sentence under a code on two lines (§4).

## 7. Order of the build (Stage 5.6)

1. Migration 0060 + the vocabulary (kinds) + `src/lib/record-twins.ts`
   (`linkTwins`, `unlinkTwins`, `twinsOf`, `suggestTwins` pure over a sheet)
   with db tests.
2. The three writers' `alsoRecords` with db tests (one change set, one
   version per record, the replace acknowledgement on a held slot, the
   "differs, left alone" case).
3. The drawing resolution reading the link (db test: a code on two twinned
   lines of one phase confirms onto both; untwinned stays ambiguous).
4. The bill review suggestion + confirm writing the staged `twinOf`
   (component + db test).
5. The record screen panel and the ticks (component tests).
6. CLAUDE.md section, README, the walk on the local stack with the Aman
   TEST project (GR-FUR-13 / PL-FUR-13).

## 8. Questions for Max (defaults taken if unanswered)

| Q | Question | Default |
|---|---|---|
| T1 | Ticked by default on a twin ("so a spec is added to both at once") | **Yes**, ticked, shown record by record |
| T2 | May a twin link cross PHASES (the mock-up copy of a main-run chair)? | **Yes**: the mock-up phase is already a copy with no specs; a twin link is how its specs follow. The drawing fan-out already treats phases that way |
| T3 | A twin suggestion from zone prefixes only, or also from identical descriptions? | **Zone prefixes and same-ref only**: descriptions match by accident ("Armchair" × 40) |
