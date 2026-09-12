---
name: external-vocabulary-sync
description: Hold a controlled vocabulary that an external system owns, and keep it in sync without silent drift.
---

# Controlled vocabularies owned by someone else

When another system (BWS, a client's schedule, a standards body) owns the list
of valid values, the app holds a *copy*. Copies drift. This is how to make the
drift visible instead of silent.

## The shape

Three things that must agree, and one that reconciles them:

1. **One TypeScript constant** is the list, next to the code that uses it.
2. **A database constraint or register table** agrees with it — a `check`, or a
   seeded table with a foreign key.
3. **A normalise function** folds known synonyms and **never guesses at an
   unknown one**. An unrecognised value returns null and becomes a visible
   flag; it does not get mapped to the nearest thing.
4. **A comparison key**, used everywhere instead of raw string equality.

## Compare through the key, never as raw strings

This is the expensive lesson. On the fabric app, a tariff priced per `"sqm"`
was invisible to a line quoted in `"m"` — the values were compared as strings,
so two spellings of the same concept simply never matched, and nothing errored.
The money was just missing.

Anything that is conceptually "the same value" must compare equal. Put that in
one function and use it at every call site.

## Extraction keeps the source's own wording

The model returns what the document said. Store it in a `*_raw` column. The
review screen resolves it to the app's vocabulary; the record remembers the
original, so a wrong mapping is traceable and correctable.

## Changing the vocabulary

A change is **four** edits, in one migration and one commit:

1. The TypeScript constant.
2. The constraint or the pick-list seed.
3. A backfill for existing rows that used the old spelling.
4. The normalise function's synonym table.

Do not add a value to the constant alone. The constraint rejects it at runtime,
in production, on the first row someone tries to save.

## Re-syncing from the source system

When the external list can change without telling you:

- Import the current list into a staging table.
- **Produce a diff report**: added, removed, renamed, unchanged.
- A human reviews it. Removals especially — a value that disappeared upstream
  may still be in use on live records here.
- Apply as a migration, never as a silent overwrite.
- Record when you last synced and against what. "Is this current?" should be
  answerable.

Never let an automatic sync delete a value that live rows still reference.
