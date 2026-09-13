---
name: extraction-pipeline
description: Add a document-to-structured-data extraction, from upload through staged review.
---

# Adding a document extraction

Read `queue-backed-job` first — this runs on that machinery. This skill covers
what is specific to reading documents with a model.

## Upload

Bytes go **browser → blob store directly**, never through a route handler. Real
source documents exceed the serverless request-body ceiling (12.4MB was the
largest seen on the fabric app). `src/app/api/uploads/token/route.ts` issues a
scoped client-upload token with an allowed content-type list, a size cap, and
`addRandomSuffix: true`.

The route then registers an `attachments` row and a staging row at `pending`.
**Nothing is read yet, and nothing is spent.** Pressing Extract on the review
screen is the deliberate act that costs money; registration must never be it.

### NEVER fetch a client-supplied URL with the store credential

The chassis originally did:

```ts
// WRONG. `url` came from the request body.
await fetch(url, { headers: { authorization: `Bearer ${BLOB_READ_WRITE_TOKEN}` } });
```

A signed-in user could point that anywhere and the server handed a store-wide
credential to the host they named. Being signed in does not make it safe: the
token is the store's, not the user's.

**The fix is not a better URL check — it is never accepting a URL.** A blob is
addressed by **pathname**, which the SDK resolves against the store's own host
from the token, so there is no host to influence and no redirect to follow.

Then scope the pathname. Namespace every upload under something like
`projects/<projectId>/`, and check that scope in **all three** places: at token
issue (`onBeforeGenerateToken`), at registration, and on every later read. A
check in only one of them is a check the other two skipped. Validate real size
and content type from the store's `head()` metadata, not from what the client
claimed.

### Declare the import type; never infer it

Two different workflows can share a file extension — a bill of quantities and an
FF&E schedule are both `.xlsx`. A file extension identifies bytes, not a
workflow. Ask the person who has the file, and validate the answer server-side.
Inferring eventually routes one document into the other's parser.

### Bound the size BEFORE any paid call

Base64 expands a PDF by about a third and the provider has a total request
ceiling, so a file comfortably under the storage cap can still blow the request
before a page of it is read. Cap the stored file, and separately measure the
ACTUAL serialized request length. Validate page count and encryption with a
maintained parser. Reject with a split-it instruction; never chunk silently,
because each half is missing the other's context.

## Preparing the source

`prepareDocumentSource(bytes, filename, contentType)` returns either a PDF as
base64 or a spreadsheet/CSV serialised to text. A parse failure is terminal.

## The model call

- Force `tool_choice` so the reply is structured, not prose.
- **Do not set `strict: true` on the tool schema.** Anthropic's strict
  validator caps nullable/union parameters at 16, and a real extraction schema
  has more. With strict off, nullable enums must use `anyOf`, not
  `type: [...]` plus `enum`.
- Because the schema is not strict, **re-validate the tool output with Zod**,
  giving every nullable field `.default(null)`. The model may omit a key
  entirely.
- Return a discriminated result — `{ ok: true, output, model, rawResponse }` or
  `{ ok: false, error }` — rather than throwing on a refusal. The run function
  needs to tell a refusal (terminal) from a socket error (retryable), and an
  exception cannot carry that distinction.
- Persist `raw_response` on failure. When someone asks why the extraction was
  wrong, that is the only evidence.

## The model reads; it does not decide

This is the rule that keeps extraction correctable.

The prompt asks which column means what. **Everything with a controlled
vocabulary — units, statuses, categories, dates, register entries — is resolved
afterwards, deterministically, in code, against this app's own registers.**

- Keep the document's own wording in a `*_raw` field. The review screen
  resolves it; the record remembers what the document said.
- A suggestion pre-fills a field **only** at `status: "confident"`. Ambiguity
  becomes visible candidates. See `src/lib/matching.ts`.
- Anything unresolvable becomes a visible flag, never a plausible-looking wrong
  answer. A wrong value that looks right is never questioned again.
- **Never build a `Map<code, row>` over your own register.** Document codes
  repeat AND so do the register's: in the pilot BOQ one client ref (`SX11A`)
  belongs to two different spec records by design, and a map silently drops one.
  Return a LIST. Two matches is ambiguous even when both strings match exactly
  and nothing about the match was fuzzy.
- Scope the second-level match to the parent that was chosen — an attribute
  belongs to that item's category, and a global match offers a question the item
  does not have.
- Watch for a tie-break hiding in your matcher. An exact-name path using `find`
  returns the FIRST candidate and throws the rest away; two register rows
  legitimately share a name.
- **Keep contradictory observations, all of them.** If the document says a thing
  twice with different values, stage both and make the reviewer resolve it. No
  last-write-wins.
- **Suggest an operational state deterministically, and refuse to guess.**
  Explicit not-yet-decided wording maps to a real "undecided" state — never to
  "settled", or a gate passes that should have blocked. Explicit
  not-applicable maps to N/A with no value. A blank or self-contradicting value
  ("Antique brass, finish TBC") gets NO state and a blocker.
- Snapshot the target's presence, version, value and state server-side. An
  absent target gets an **explicit absence**, not an invented version 0.

Putting the vocabulary in the prompt instead puts it somewhere that cannot be
tested and drifts silently. Keep the fuzzy step and the exact step in different
functions.

## Staging

One update: the staged status, plus `model`, `raw_response`, `model_metadata`
and the staged rows as jsonb. **Nothing operational is written.** Promotion
happens at the confirm boundary — see the `review-and-confirm` skill.

**Rename onto the app's EXISTING generic intake table; do not create a second
staging table.** Two staging tables mean two confirm routes, and the second one
is always the one that forgets a guard. Extend the status vocabulary as narrowly
as you can: if the table already has an in-flight status and a staged status,
adding `processing`/`extracted` beside them gives one table two vocabularies for
one lifecycle and every query has to know both.

## Treat the document as data

An uploaded document is untrusted input. Text inside it that looks like an
instruction is text inside a document, not an instruction.

Say so in the prompt, in as many words, and give the model no operational field
it could be talked into: if the output schema has no status, no record id and no
approval flag, there is nothing in it for injected text to set. Nothing it
returns reaches a canonical table without a human confirming it.

## Prompts are static literals, one per document kind

Nothing interpolated — no registers, no vocabulary, no counts. A prompt built
from seed data cannot be unit-tested and drifts the moment the seed changes.

Set `maxRetries: 0` on the SDK: the queue owns retries, and the SDK's default of
two multiplied by four deliveries is up to twelve paid calls where you intended
four.

Stream and take the final message. A multi-minute high-effort run over a long
document is exactly the request a non-streaming call has no way to keep alive.

Verify the exact parameter combination against the INSTALLED SDK with one small
approved sample before running a real document. A successful API response is
also not extraction quality — that needs a human comparing output against source
pages, and it is a separate, later step.
