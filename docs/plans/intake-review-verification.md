# Verifying the drawings review against the pack

The drawings review is where a pack becomes records. `docs/plans/export-verification.md`
covers the file that comes out the other end; this covers the screen, because
until 2026-09-17 nothing did — and the screen is where every defect Max reported
actually lived. The rows were right in the staged JSON and wrong in front of
him, four separate times.

This is the procedure. Nothing here is automated scoring: a person compares a
card to a page and writes down what they found.

## Before the browser: the dump

```bash
npm run dump:drawings -- --run=<intake_runs.id>
npm run dump:drawings -- --project=<projects.id>     # every drawings run
npm run dump:drawings -- --run=<id> --item=S-201     # one code, row by row
```

Read only — no `--apply`, no `--yes-production`, nothing to guard. It prints the
resolved host first anyway, because knowing which database answered is the point
of `house/conventions.md` §3.

It runs the **real read-time pipeline** (`assertStagedDrawings`) and prints what
it returns, one line per page:

```
  page code      name          cfg meas  slot fold unit                  dimension cell
  5    S-201     ARMCHAIR      A   36    4    32   mm figures            W640 x D685 x H680 x SH445mm
```

| Column | Means |
|---|---|
| `cfg` | which configuration of its code this page is: A, B, C… or `-` for a code drawn once |
| `meas` | pending rows that state a figure (`isMeasuredRow`) |
| `slot` | how many of them are placed in one of the five slots |
| `fold` | the rest, which the card folds away |
| `unit` | every distinct unit and its provenance on the placed rows |
| `dimension cell` | what BWS would receive, through `composeDimensionCell` itself |

Blockers print under their page.

**Run it before and after a change to the read-time pipeline. The diff is the
change.** That is the artefact "verified against the pack" never had: a sentence
in CLAUDE.md cannot be re-run, and goes stale exactly when it matters.

## Then the browser

`.claude/skills/verify/SKILL.md` covers the session. The pack to drive is
whichever `shop_drawings` run the dump just described.

**Never exercise the WRITE path on a real project.** Confirming creates records
and variants and there is no undo for a person's sandbox. Copy the project first
(a repo-root `.mjs`, `__QA ` prefix, deleted afterwards) and confirm on the copy.
Two things to know about a copy: its records need `status = 'active'` written
explicitly, and `/api/imports/<id>/source` **404s**, because the PDF stays under
the original project's blob prefix and the read is scoped to it — by design.
That means no page previews and no crops on a copy, and it is not a fault.

## The checklist, per card

Read it against the page the card links to. One line per card.

| # | Check | What wrong looks like |
|---|---|---|
| 1 | **Cards match codes.** A code drawn on N pages is ONE card with N chips; a code drawn once is a plain card; a codeless page is collapsed with one Ignore | the same code as two cards; a chip whose letter is not its page order |
| 2 | **Chips.** One per configuration, its page links to that page, and it says `record exists` or `record will be created` | a chip claiming a record exists when the spec table has none |
| 3 | **Dimension line.** Present on every open card. Either a composed cell or "No width, depth or height placed yet" in words | absent; or a figure whose magnitude is 10x the page |
| 4 | **The cell against the page.** W, D, H, SH each read off the drawing | a component figure (a reveal, a gap) sitting in a slot |
| 5 | **Yellow rows.** Every guessed slot is yellow and carries a reason; a row a person has ruled on is not | everything yellow after an edit; nothing yellow on a page the model could not label |
| 6 | **Unit and its provenance.** `printed on the page` only where it is; `guessed from the figures` where the figures agreed; blank and amber where they did not | a unit stated as printed that the page does not print |
| 7 | **The fold.** `Other dimensions (N) — show` with N matching the dump's `fold`, and nothing folded when nothing is placed | a card showing a toggle and no rows |
| 8 | **Shared geometry, once.** One table for the card, not one per configuration. An edit to it reaches every configuration's page | the same width appearing N times; an edit that moves one page only |
| 9 | **Configuration sections.** One per page, colour-banded, each holding ITS fabric, ITS picture, ITS swatch controls | two configurations showing the same fabric |
| 10 | **Applies to.** One set for the card. A run the configurations disagree about is indeterminate and says so | per-page ticks that can drift apart |
| 11 | **Confirm.** One button naming the code and the count; disabled while ANY configuration is blocked, with the reason and the letter in words | enabled while one configuration cannot commit |
| 12 | **A failure path.** Force a refusal (edit a row's version underneath) and confirm: the banner survives the reload and names what was written, what was refused and what was not attempted | the card looks as though the click did not register |

## Verdicts

One word per line, so a pass can be counted rather than remembered.

| Verdict | Means |
|---|---|
| `ok` | the card says what the page says |
| `wrong` | a value is stated and the card has a different one |
| `missing` | the page states it and the card does not have it at all |
| `extra` | the card states something the page does not |
| `unreadable` | the page cannot settle it — a human could not either |
| `ugly` | right, but a reviewer would misread it |

`ugly` earns its place: four of the five defects found on 2026-09-16 and
2026-09-17 were right in the data and wrong on the screen. A verdict vocabulary
with no word for that collects "looks fine" against a card nobody can use.

## What comes back

The filled sheet holds real values off real client drawings and **never enters
this repo**. What comes back is the finding: a code fix, an alias seeded from
verified wording, or a dated line in `docs/plans/README.md`.

## Filled in so far

Nobody has completed one. The column choices above are a guess at what makes
the reading possible, and the first real pass tests this sheet as much as it
tests the screen.
