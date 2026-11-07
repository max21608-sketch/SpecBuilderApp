# Extraction attempts, slots and the queue

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### Registering a specification document SPENDS MONEY

`src/app/api/imports/route.ts`, `src/lib/extraction-dispatch.ts`,
`src/components/projects/IntakeBatchUpload.tsx`

It did not until 2026-09-15, and three file headers said so. Registration read
no body and cost nothing; pressing Read was a separate deliberate act, one
document at a time, with the charge on the button. A real pack broke that:
Panther is eleven documents and packs of thirty are expected, so the state
anybody actually wants — everything read — was reachable only by remembering to
click thirty times across eleven screens. Asking per document was ceremony, not
consent.

So an attempt is opened and published as each specification document registers.
**The upload screen states the count and the charge before anything uploads, and
that statement is where the human decision now lives.** A bill of quantities is
not part of it: a bill is parsed synchronously, by code. Since 2026-09-23 a
model MAY read a bill's STRUCTURE — never its cells — when nothing the app
knows maps its columns, as one small charged read the screen names (see *A
bill is never refused; it is mapped*).

Three things about it are load-bearing:

- **`openAttempt` runs in the SAME transaction as the insert; the publish comes
  after the commit.** A run committed at `pending` with a message already
  published against it is a paid call against state that may not exist.
- **A registration returns 201 even when its dispatch fails.** The file is
  stored and the row exists either way, so the failure is recorded on the run —
  where the review screens already render it with a Retry — and reported as
  `autoRead` on the response. Failing the upload would tell somebody their file
  did not arrive when it did.
- **A replayed registration must not open a second attempt.** It returns the run
  it already made; publishing again spends one of only four deliveries.

`src/lib/extraction-dispatch.ts` holds commit-then-publish and the two publish
failure modes **once**, because the manual route and registration need the same
protocol and two copies would be two sets of rules about when a paid call may be
claimed twice. Nothing is retro-active: a document already at `pending` is read
by the pack screen's *Read all*, not by anything in registration.

**A pack reads THREE documents at a time, and the rest wait for a slot**
(`src/lib/extraction-slots.ts`, `MAX_IN_FLIGHT_READS_PER_PACK` in
`extraction-claim.ts`, Stage 2 item 2.10.f, 2026-09-21). Registration still
returns 201 and still stores the file; at the cap the run is DEFERRED rather
than refused — a refused registration tells somebody their file did not
arrive, and thirty files would mean twenty-seven Read presses. A deferred run
is marked by `attempt_deadline_at` set with `attempt_id` NULL, a pair nothing
else writes, so no migration was needed and no status was added; the screens
read it as *Waiting for a slot*. The slot is taken under a
`pg_advisory_xact_lock` on the pack (the project, for a batch-less email), not
the project row, so a registration never queues behind a bill confirm. The
hand-off runs where an attempt SETTLES — parsed, `fail()`, and
`recordExtractionFailure`, which gained a `returning` so only the invocation
that wrote the failure hands on — through the same `openAttempt` +
`publishAttempt` protocol, commit then publish; `releaseAndThrow` keeps its
slot because that attempt is alive and will be redelivered. `inFlight` counts
only attempts inside their deadline, or one stuck document would shrink a
pack's capacity for good and stop the *Read all* that is the way out. Two
holes stand and are logged: nothing settles an attempt that passes its 24-hour
deadline, so nothing hands its slot on at that moment. The three
single-document review screens say *Waiting for a slot* for a deferred run
since `f91f43c` (the GET payload carries `waitingForSlot`; a 202 `waiting`
press reports the sentence as an info notice after the reload, never the red
banner); `WAITING_FOR_SLOT_MESSAGE` lives in `intake-status.ts`, a leaf,
because a client component importing `extraction-slots.ts` would pull the
database driver into the browser bundle. *Read all* honours the cap since `73cf827`: the extract
route's `start` takes a slot or defers with a 202 that says *waiting*, never
an error; `retry-dispatch` and `restart-expired` stay uncapped because the
first re-publishes an attempt that already holds a slot and the second is one
press on a document whose expired attempt has stopped counting. The advisory
lock is taken BEFORE the run's row lock, because the hand-off takes them in
that order and the reverse is a real deadlock that would turn a correct press
into a 500. A deferred `failed` run is put back to `pending` with its attempt
columns cleared, because the hand-off can only find the (no attempt, live
deadline) marker and a red Retry beside a read already promised is a lie. The
*Read all* button no longer counts a waiting run — "each is charged" over eight
promised reads would be a charge nobody pays.

**A status moves on its own, and `isIntakeRunInFlight` is why** (found in use
2026-09-23: *"you have to reload the page to get it to switch"*). The pack
screen polled only `queued` and `parsing`, so a pack whose last documents were
WAITING FOR A SLOT stopped polling and never saw them start; the overview did
not poll at all. Being read OR waiting for a slot is in flight; a plain
`pending` run nobody asked to read is not, or polling would never stop. The
overview refreshes its DOCUMENTS only, never through `load()`, which resets the
details form. The waiting expression is in FOUR queries and
`tests/lib/intake-in-flight.test.ts` holds them equal — the fourth is
`project-summary.ts`'s `documents_reading`, which counted `pending` (not in
flight) and missed `queued` (what dispatch writes), so a document nobody asked
to read pinned the overview's primary step at "Reading 1 document…" (audit F9,
2026-11-06). It counts in-flight documents and never a plain `pending`.

**An oversize document is refused before a byte is stored**
(`src/lib/upload-limits.ts`, a leaf, and `upload-check.ts`): over 20 MB or 600
counted pages is refused on its upload row in words; over 70 pages is a
WARNING and proceeds, because the real ceiling is time and output, which a page
count only approximates, and a refusal set too low is the one error with no
way round it. The 70 is PROVISIONAL, from one 44-page measurement, until a
100-page set has been read. An uncertain count proceeds.

### An extraction attempt is owned by two identifiers

`src/lib/extraction-claim.ts`, `src/lib/extraction-run.ts`,
`src/app/api/imports/[id]/extract/route.ts`, `src/lib/extraction-dispatch.ts`

`attempt_id` is a logical attempt; `claim_token` is one worker invocation inside
it. Both are needed: a hard-killed worker leaves a claim that expires, a later
delivery reclaims the same attempt with a NEW token, and if the "dead" worker
was only slow its writes must then match nothing. Every worker write is fenced
on `(runId, attemptId, claimToken)` plus the status it expects, and **zero rows
means ownership was lost** — stop; never escalate that into a terminal failure.

A live claim is a **busy** outcome and it THROWS. Acking a duplicate delivery
would spend the delivery that recovery depends on.

The extract route is **no longer the only way an attempt starts** — registration
dispatches one automatically. What remains manual is what automation cannot
cover: a document that FAILED, an attempt the queue never accepted, and an
attempt abandoned by a worker that died mid-run.

The timings are an inequality, not three knobs: model deadline < run abort <
`maxDuration`; claim expiry > `maxDuration`; visibility timeout > claim expiry.
`tests/lib/extraction-timing.test.ts` asserts each, against `vercel.json`, and
since 2026-11-06 for EVERY route that declares a `maxDuration` (a table that
fails on a route it does not know; `TRANSCRIPTION_CLAIM_MS` is 900 s, not the
800 s that equalled its route). There is **no exactly-once billing
guarantee**; an ambiguous failure can cost a second call, and the UI says so
before a human restarts one.

**A read that runs out of time is terminal, and a busy redelivery waits the
claim out** (audit D1, D7, D8, D9, 2026-11-06). Our own 740 s deadline and the
run's abort reject the stream with an abort that carries no status, and it
fell to retryable `transport`, so the queue read a 100-page document up to four
times at full cost and then said "could not be reached". `classifyCallFailure`
reads the combined SIGNAL first, and an abort is `timeout`: "ran out of time
after N minutes … split the document". The stream's `currentMessage` is kept
as `raw_response` on every failure, so the paid partial answer is on the row.
Staging (`stageOutput`) is the only step inside a try after the model call: a
throw there fails terminally with the paid answer on the row, and never
releases the claim. A `busy` outcome carries `claimExpiresInSeconds` and
`redeliveryDelaySeconds` waits for it plus 30 s, because 30/60/120 s all land
inside a 900 s claim and the recovery that `busy` promises never ran.
**Whether "Start again" is offered is `attemptRestartable`**, called by the
extract route and the four review screens: never over a live claim, whatever
`claim_count` says (a live fourth attempt used to show the red button, and
pressing it fenced the paid worker out). Every claim window in SQL is
`make_interval` over `CLAIM_EXPIRY_SECONDS`; a test refuses a literal, because
the document GET carried `interval '360 seconds'` against a 900 s claim and
showed Restart from minute 6. A resent press (same request id) is answered with
what it did and never re-opens its attempt: re-opening replays a key the queue
drops, and minting a new one charges twice. Files: `src/lib/anthropic.ts`,
`extraction-claim.ts`, `extraction-run.ts`, `pdf-bill-checks.ts`,
`src/app/api/queues/[topic]/route.ts`, `src/app/api/imports/[id]/extract/route.ts`,
`tests/lib/extraction-timing.test.ts`, `extraction-restart.test.ts`,
`anthropic-timeout.test.ts`.

### The queue consumer runs only on what the service handed it

`src/lib/queue-callback.ts` (`unverifiableCallbackReason`),
`src/app/api/queues/[topic]/route.ts`, `tests/lib/queue-callback.test.ts`

Audit R3, found by the route contracts (5.2) and closed in 5.4, 2026-11-07.
Nothing in a queue callback is signed, and this file and the middleware used
to say "authenticated by the queue's own signed protocol". With
`@vercel/queue` 0.4.0 the v1beta structured callback is safe for a different
reason: the SDK fetches the payload by message id FROM the queue service with
the deployment's OIDC token, so a forged request can at most name an id that
does not exist. The v2beta binary callback (ce-* headers and a receipt handle)
deserialises the payload from the request's OWN body and runs the consumer on
it before the service is asked anything — measured: a forged one answered 200
and ran the stubbed consumer, and a forged message naming a pending run would
have started a CHARGED read if a claim was free; only the claim fence limited
it. `unverifiableCallbackReason` refuses that shape (a v2beta ce-type, any
other ce-type, a receipt-handle header) before `handleCallback` runs, so the
consumer only ever runs on a payload the SDK received from the service. The
test pins `vercel.json`'s trigger type (`queue/v1beta`) beside the guard: a
move to v2beta would refuse every small message, so the two change together,
and that move needs this section read first. The local queue
(`local-queue.ts`) mirrors `redeliveryDelaySeconds` and the 24-hour dedup
window, so the stack reads are verified on behaves as the real one.

### A failure names its reason on the row, and the panel stays open

`src/lib/classify-failure.ts`, `src/lib/document-classify.ts`,
`src/app/api/imports/classify/route.ts`, `src/components/projects/IntakeBatchUpload.tsx`

The pilot "mass fail" of 2026-09-23 was two defects in series. The classify
route answered `200 ok:true` when the model call itself FAILED (no API key on
the deployment) and the screen read only `evidence`, so thirty rows said "Say
which" with no reason — and then `onUploaded`, which the project page answers
by UNMOUNTING the upload panel, fired on every press, so all thirty rows
vanished together and nothing had registered (two batches, zero runs, zero
attachments, read off pilot). Now: a failed look is `ok:false` with a stable
code, the sentence and a truthful `charged`; the row is red with **Try
identifying again** (the file is stored, nothing uploads twice); two or more
failures for one reason get one banner; `onUploaded` fires only when nothing
waits on a person, and `onRegistered` refreshes the page otherwise; a batch is
created at the first REGISTRATION, and the batches route lists no empty one. A
PDF over the classify model's 100 pages is identified by `EXTRACTION_MODEL`.
Bulk assign ("Set the ticked ones to…", "All unset → Shop drawings") is a
person's choice and skips the model call, exactly as the select does.
