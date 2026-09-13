---
name: review-and-confirm
description: Build a staged-review screen and the confirm route that promotes reviewed data into canonical tables.
---

# Staged review and the confirm boundary

Extraction stages. A human reviews. **Exactly one route** promotes reviewed
data into canonical tables. That route is a named, tested boundary, not an
incidental `update`.

## The review screen

- Loads the staged jsonb, groups it the way the reviewer thinks about the work.
- Autosaves field edits with a `PATCH` that **merges into still-present rows
  only** — never rewrites the array. It assembles the replacement value from the
  LOCKED current row, never from an array the client sent.
- **Autosave is not proof that edits saved.** Hold acknowledged server state and
  dirty local buffers separately; on failure keep the user's text and show it
  beside the server's. Serialize saves per row with a local edit sequence so a
  response that lands after more typing cannot overwrite the newer text. Flush
  and await before any action that commits, and send the versions the server
  ACKNOWLEDGED, not the ones first loaded. Keep the navigation guard armed while
  anything is dirty or failed.
- **Do not key the component on the run's version.** Every ordinary autosave
  bumps it, and a key on it remounts the grid mid-edit.
- Polls while the extraction is running (`usePoll`, active only while
  non-terminal), so a four-minute wait shows progress rather than a dead page.
- Shows ambiguity as clickable candidates, with the document's original wording
  next to them.
- Shows blockers as blockers. A reviewer should not be able to press Confirm
  and then find out.

## The confirm route

### It writes only what was submitted

**No matching is re-run here.** Re-matching at confirm time means the thing
that gets written is not the thing the reviewer approved — the register may
have changed since they looked.

The one defensible exception is creating a register row for a value the
reviewer explicitly named but did not link, and it must do a
case/whitespace-insensitive lookup first so an identical row is reused rather
than duplicated.

### It re-checks everything server-side

Blocking flags, gate conditions and collisions are re-evaluated against the
live rows at confirm time. **Never trust a flag from the review screen** — its
view may be minutes old, and it is client-supplied either way.

### It commits groups atomically

A parent and its children write and leave the staging set together, in one
transaction. A half-imported item cannot be allowed to exist, because nothing
downstream will know it is half.

**Name the whole group, and check it against the live set.** One request should
carry the group's identity and EVERY one of its currently pending rows with the
versions the reviewer saw. If the live grouping differs, refuse — otherwise a row
added or retargeted into the group since the page loaded lets the reviewer commit
a card they never saw whole.

**Roll back on any failure, not per row.** Three values written and the fourth
refused looks finished, and the missing one is invisible until somebody notices
the answer is wrong.

**Real rollback needs a real transaction.** A batch API that takes a pre-built
array of statements cannot evaluate a guard and abort: every check runs before
the transaction opens, under read-committed, and the thing you checked can change
before you write it. Use an interactive transaction, verify exact affected-row
counts (zero rows from a guarded UPDATE is a guard result, not a driver error),
and on an uncertain COMMIT do not claim nothing was written.

### Identity: index only when the set is fixed

An index is a stable address **only** for a list nothing is ever added to or
removed from — a spreadsheet's parsed rows, say. The moment reviewing a row
changes the set the screen is filtering, "the row at index 4" means different
rows before and after an Ignore, and a positional edit writes to the wrong one.

For anything else, give every staged row a **server-generated UUID** and locate
by `elem.id` in the live, locked JSON. Then:

- **Keep reviewed rows in place** with a `reviewStatus` flipped, rather than
  removing them. That deletes array compaction, a second reviewed array, an
  inverted restore guard and restore-by-reinsertion in one move.
- Give each row **its own version**. The run's coarse version is bumped by every
  autosave on every row, so predicating one row's edit on it makes two people
  editing two different rows conflict for no reason.
- **Compute blockers, never store them.** A retarget clears an acknowledgement
  and a duplicate-target clash comes and goes as other rows move. A blocker
  frozen at extraction time is stale by the first edit, and the screen and the
  confirm route then disagree about whether a card can commit. One pure function,
  called by both.

Either way: do not rewrite the array from a snapshot the client sent — that
races autosave and silently discards concurrent edits.

### Retargeting is its own operation

Changing which canonical row a staged row points at must revalidate membership,
build a FRESH target snapshot, and clear what the old target justified — an
overwrite acknowledgement above all, because it was about a different row's
value. Clear only what is genuinely **incompatible**: a selection that is still
valid under the new target is kept, not thrown away.

Distinguish an EXPLICIT selection from a CARRIED-OVER one. An explicitly sent
child that does not fit is a refusal; one merely inherited from the old parent is
silently cleared. Conflating them refuses an edit over a value the reviewer never
chose and cannot see.

### It resolves IDs against its own staging row

A photo, attachment or candidate ID from the client is checked against *this
extraction's* candidates. A stale or foreign ID refuses the whole batch rather
than writing something unverified.

## Every ignore is reversible; an APPLIED row is not

If a reviewer can dismiss, skip, or mark something "not needed", there must be
a `restore` action. Keep the data in the staged rows; only the way back is
usually missing.

On the fabric app, "not quoted" was irreversible and permanently blocked
confirming a quote against that item. The data had been there the whole time.

**Restore accepts ignored rows only.** An applied row is immutable history —
restoring it would imply undoing a canonical write, and a review screen is not
where that happens. Restoring the last outstanding row REOPENS a completed run;
a completed run means nothing is left to REVIEW, which is not the same as the
underlying work being finished, so label it accordingly.

## Status transitions

Write a `status_history` row for every transition, with the actor. `audit_log`
records every column change forensically; `status_history` is the queryable
lifecycle you can actually render on a screen.
