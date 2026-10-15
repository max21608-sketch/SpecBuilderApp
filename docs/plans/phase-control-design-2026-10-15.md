# Control over phases — design for Max (2026-10-15)

Workstream F of `ronnie-scotts-followups-2026-10-15.md`. **Nothing here is
built.** The drawn frames are `docs/design/phase-control-mockup.html`. Open
it in a browser; it is two frames.

Max, 2026-10-15: "we need some kind of option to… have a bit more control over
creating phases and assigning things to phases. I think technically these are
kind of all in the same phase, and those are actually just categories."

## What exists today (checked in the source)

- A bill's every tab becomes its own phase (`spec_runs` row), named on the
  review's "This tab becomes a phase" card, or **replaces** an existing phase
  as a revision (`replacesRunId` in `confirm-boq.ts`: pair, update, retire).
- *+ Add a phase* makes an empty phase by hand (`AddRun.tsx`, 0028).
- *Also in a mock-up phase* (0043) puts COPIES of items on the mock-up phase.
- **Missing:** putting several tabs into ONE phase, adding a bill's lines to
  a phase WITHOUT revising it, and moving a confirmed record to another
  phase.

## The two controls

**1. At bill review, "Goes into"** (frame 1). One control per tab, with
three answers:

- **A new phase** named … This is today's default, so nothing changes
  unless somebody picks.
- **One phase with other tabs of this bill**, named …, with the tabs ticked.
  Each line keeps its tab's name as its **package**.
- **Add to a phase that already exists.** It inserts only and changes nothing
  that is there. It is deliberately NOT a revision: "Replaces phase…" stays
  the one way to replace a bill, so the two cannot be confused.

The Confirm button counts phases from the answers ("creates 30 records on 1
phase"). The summary line above the tabs states the grouping in words.

**2. After confirm, "Move to phase…"** (frame 2). Tick rows on the phase
table, choose a phase (or a new one by name), and give a reason. The dialog
says what changes before anything moves.

## Decisions it needs from Max

| # | Question | Recommendation |
|---|---|---|
| P1 | Is the tab name, when tabs are merged, a **package** on each line (a new column, a filter like area)? | **Yes.** A new nullable `spec_records.package text`, written only at confirm from the tab name, shown as a chip and a filter. Not a category: categories are the cheat sheets and carry questions |
| P2 | Can a record be moved after a BWS file has been downloaded for its phase? | **Yes, with the sentence** "a BWS file already downloaded for that phase no longer matches". Nothing records downloads, so there is nothing to refuse on |
| P3 | Does an emptied phase retire itself? | **No.** It is offered ("RSL ST4 now has no items — retire it?"), with a reason, as any retire |
| P4 | The name: "Move to phase…" or "Change phase…"? | "Move to phase…" |

## The rules the build must keep (traps, not preferences)

- **A phase is a sub-quote and the export's scope** (CLAUDE.md, *A BOQ tab is
  a PHASE*). A move changes which file a record ships in. That is why it
  needs a reason and a change set, like a retire.
- **One change set per move, and one version per record moved.** The version
  carries the new phase: `record-atoms.ts` already includes `runName`, so the
  diff shows "Phase: RSL ST4 → MIRRORS". A new change-set kind
  `record_phase_move`, in `REASON_REQUIRED_KINDS` AND the database CHECK.
  **Re-list the CHECK from the LIVE constraint** (the 0032 lesson).
  `spec_records.version` is untouched; `run_id` is a column, so the update is
  audited, and the version comes from `snapshotRecords` under its lock.
- **Configurations move with their bill line, never on their own.** A
  configuration ticked alone is refused, naming its line. A bill line takes
  its configurations with it.
- **`record_no` never changes.** It is project-wide, and somebody has already
  written `P16717-028` down.
- **A code already on the destination phase is not a reason to refuse.**
  Both stay as records, and the dialog names the code. Two lines with one code
  in a phase is SX11A, which the app already handles everywhere.
- **Mock-up copies are separate records.** Moving the main item does not move
  its mock-up copy, and the dialog says so if one exists.
- **A later REVISION of the bill pairs within the record's CURRENT phase.**
  A record moved out of phase A is not retired by A's next bill revision,
  because it is no longer on A. A record moved IN is paired by A's revision
  like any other. State it in the revision review ("moved here by hand on …")
  so a person sees why a line pairs.
- **"Add to an existing phase" at confirm** inserts with the same SX11A rule.
  A code already on that phase is flagged amber on the review and never
  paired, because pairing is what a revision does.

## Size, roughly

- Control 1: the staged sheet gains `phaseGroup` (which tabs share a phase,
  and its name) and `appendToRunId`. Confirm creates one run per group and
  writes `package`. One migration (the column). Review UI on the existing card.
- Control 2: one route (`POST /api/projects/[id]/records/move`), the dialog,
  and a table-selection action. One migration (the change-set kind).
- Tests: db-tier for both (merge three sheets → one run with packages; move
  with configurations; refused configuration alone; version diff shows the
  phase), plus component-tier for the dialog.

**Waiting on Max:** P1–P4 above, and a look at the two frames.
