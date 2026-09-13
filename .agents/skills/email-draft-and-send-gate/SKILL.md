---
name: email-draft-and-send-gate
description: Generate downloadable email drafts and gate the "I sent it" confirmation against stale data.
---

# Email drafts and the send gate

The app never sends. It generates a draft; a human opens it in Outlook and
sends it; the human then tells the app they did. That last step is a **gate**,
not a checkbox.

## The tables

- **A draft table** — recipient, `status` (`draft` | `sent`), subject, body,
  `body_format`, `sent_at`/`sent_by`, `version` + bump trigger,
  `body_edited_at`/`body_edited_by`, and a `generation_token` uuid.
- **A coverage join table** — which records this draft covers, and critically
  **the version of each record at generation time**.

That snapshot is the whole trick. The email body froze the data. The snapshot
version is what later proves the email still describes reality.

## Generating

Group eligible records by recipient. Delete-and-rebuild only `status='draft'`
rows — **sent drafts are immutable history**.

Regeneration destroys hand-edited bodies, so it requires an explicit
`confirmDiscardEdits: true` rather than silently discarding someone's writing.

`generation_token` exists because "version N+1 now exists" is *also* true when
a concurrent writer produced N+1. A version bump does not prove your write won.
The token does: write it, then predicate dependent writes on finding it.

## Editing and downloading

- contentEditable `innerHTML` → `sanitizeEmailHtml()` → version-matched update
  or 409. Sent drafts refuse edits.
- `GET .../eml` builds the message with `buildEml()` and serves it as
  `message/rfc822`. It works for sent drafts too, so history stays retrievable.
- `From:` is the signed-in user, so the human sends from their own mailbox.
- **Keep the CR/LF stripping in `eml.ts`.** Register values go into address and
  subject headers; a newline in one of them is header injection.

## `confirm-sent` — the gate

One statement of data-modifying CTEs, atomic without a transaction batch:

1. `covered` — the records this draft claims.
2. `fresh` — how many still match: `version = snapshot_version`, still in the
   expected status, still current.
3. `qr_ok` — the draft is still `draft`.
4. Conditional update of the records and the draft, gated on
   `fresh_count = total_count AND total_count > 0`.

On mismatch: **409 with a `diff` array naming each stale record and why**
(versionChanged / statusChanged / retired). Not a bare "conflict" — the person
needs to know what moved so they can decide whether to regenerate.

It never silently flips. Already-confirmed is a 409 too.

## `undo-confirm` — the mirror

### First ask WHICH kind of undo this is

The two are not variants of one rule; they rest on different premises.

**Business-row undo** — confirming a send MUTATED the covered rows. Then require
`version = snapshot_version + 1` **exactly**: that single bump is the one the
confirm itself wrote, so anything else means a human edited the record after
sending, and undoing would discard their edit. 409.

**History-only undo** — confirming a send wrote NOTHING to the covered rows; it
recorded that a question was asked. There is no bump to count, and demanding one
is cargo-culting a rule whose premise does not hold. Undo voids the draft,
preserves the sent content and every earlier chase, and leaves every answer
alone. A replacement is a NEW draft, not an edit of the voided one.

Prefer history-only where you can. A `chased_at` column on the answer looks
simpler and is not: any update fires the version trigger, so marking a question
chased silently invalidates every extraction snapshot pointing at that answer —
for a reason that has nothing to do with the answer — and writes a communication
event into a business record. Derive "waiting for a reply" instead: a question is
waiting when it is still outstanding and some sent, tracking-eligible coverage
row still matches it.

Either way this makes a hard gate recoverable from a misclick without making it
soft.

## Staleness compares CONTEXT, not only versions

Version columns cover only the tables that have them. If the question text, the
reference or the recipient can change in a table with no version, comparing
versions alone misses an edited prompt or a corrected ref entirely. Snapshot the
rendered context too and compare it.

Compare it with a CANONICAL serialization. Plain `JSON.stringify` fails, because
`jsonb` does not preserve key order and every draft then reads as stale the
instant it is generated.

## Only prose is editable; the covered set is generated

Let an author edit an opening and a closing as PLAIN TEXT. Generate the table of
questions from the coverage rows. That is what makes the body and the coverage
provably the same set, which is the guarantee the whole send gate rests on — and
it is why there is no whole-body HTML editor. A sanitizer written as
"defense-in-depth for a single-tenant tool" is not a sanitizer.

Editing the coverage and editing the prose are one operation, so the two can
never drift apart between requests.

## Navigation guards, and what they do not cover

A `beforeunload` handler plus an anchor-click interceptor covers a reload, a
close and a link. It does NOT cover the browser Back button, a framework's
programmatic navigation, or a Cancel that routes. Say so where the hook is
defined, so nobody takes it for complete protection of an unsaved draft.

## A gate whose upstream is not ready

Make it an **explicit always-409 stub that explains why**, not an absent route.
An absent gate looks like an oversight and invites someone to "just add" an
ungated update.
