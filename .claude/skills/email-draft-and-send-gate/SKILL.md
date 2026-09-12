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

Requires `version = snapshot_version + 1` **exactly** — the single bump that
the confirm itself wrote. Anything else means a human edited the record after
sending, and undoing would discard that edit. 409.

This makes a hard gate recoverable from a misclick without making it soft.

## A gate whose upstream is not ready

Make it an **explicit always-409 stub that explains why**, not an absent route.
An absent gate looks like an oversight and invites someone to "just add" an
ungated update.
