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
  only** — never rewrites the array.
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

### It removes the draft surgically

Filter the staged jsonb **by index against the live value**, inside the same
statement. Do not rewrite the array from a snapshot the client sent — that
races autosave and silently discards concurrent edits.

### It resolves IDs against its own staging row

A photo, attachment or candidate ID from the client is checked against *this
extraction's* candidates. A stale or foreign ID refuses the whole batch rather
than writing something unverified.

## Every ignore is reversible

If a reviewer can dismiss, skip, or mark something "not needed", there must be
a `restore` action. Keep the data in the staged rows; only the way back is
usually missing.

On the fabric app, "not quoted" was irreversible and permanently blocked
confirming a quote against that item. The data had been there the whole time.

## Status transitions

Write a `status_history` row for every transition, with the actor. `audit_log`
records every column change forensically; `status_history` is the queryable
lifecycle you can actually render on a screen.
