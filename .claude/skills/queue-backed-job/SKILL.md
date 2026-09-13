---
name: queue-backed-job
description: Add a long-running background job on the queue, with correct retry and claim behaviour.
---

# Adding a queue-backed job

Anything that takes more than a few seconds — a model call, a large export —
must not run inside the HTTP request. A serverless request cannot be held open
for minutes, and when the platform cuts it the row stays at `processing` with a
screen that waits forever.

## The shape

```
route (enqueue, 202)  ->  queue  ->  consumer (does the work)  ->  screen polls
```

1. **The route only enqueues.** It flips status to `queued` in one predicated
   `update … returning` (409 if the row is not in a runnable state), **commits**,
   and only THEN sends the message with an idempotency key. Publishing inside the
   transaction lets a worker claim state that then rolls back.

   A publish failure is two different situations and must not be collapsed:

   - **Definite rejection** (the queue answered with a 4xx): mark the attempt
     failed — but fence it on nobody having claimed it, because the refusal you
     saw may have followed a delivery you did not.
   - **Ambiguous failure** (socket, DNS, timeout): the message may be in flight.
     Stay `queued`, record a dispatch error, and offer a human a **Retry
     dispatch** for that SAME attempt; the idempotency key makes it safe and it
     will not disturb a worker that already has the message. Marking this failed
     kills a run that is about to start; retrying blind double-publishes.
2. **The consumer does the work** (`src/app/api/queues/[topic]/route.ts`).
3. **The screen polls** with `usePoll`, active only while a row is non-terminal.

## Non-negotiables

- **The consumer is not a session route.** It is reached by the platform, not a
  browser. Keep it OUT of the middleware matcher (the chassis matcher already
  excludes `api/queues`) and let `handleCallback`'s signed protocol
  authenticate it. Adding it to the matcher breaks every job with a 401 that
  looks like a platform outage.
- **The timings are an INEQUALITY, not four independent knobs.** Put them in one
  module and assert them in a test — including against `vercel.json`, which is
  the thing actually deployed:

      model deadline  <  run abort  <  maxDuration
        so a failure is written down instead of being cut off mid-write
      claim expiry    >  maxDuration
        so a claim cannot expire under its own still-running invocation
      visibility      >  claim expiry
        so a redelivery is not a guaranteed busy no-op

  Change one number and the test tells you which of the others you just broke.
- **`MAX_DELIVERIES` is low (4), on purpose.** Each retry of a model job is a
  real, paid, high-effort run. The faults worth retrying either clear quickly
  or not at all.
- **On exhaustion, write a terminal status — unless a claim is live.** Without
  it the screen waits on something that is never coming. But fence it on the
  attempt AND on there being no unexpired claim: if another invocation is
  legitimately mid-run, marking the attempt failed kills work that is about to
  succeed and has already been paid for.
- **The topic must be declared in `vercel.json`** under `experimentalTriggers`.
  A new topic has NO consumer until that deploy lands; messages sent before
  then sit undelivered. Deploy first, then enqueue.

## Claiming work: TWO identifiers, not one

`attempt_id` identifies a logical attempt; `claim_token` identifies one worker
invocation inside it. Both are needed, and it is worth being clear why:

- Without `attempt_id`, a delivery from a superseded attempt clobbers the live
  one.
- Without `claim_token`, a worker whose claim EXPIRED while its request was
  still in flight lands its writes on top of the worker that legitimately
  reclaimed after it.

One predicated statement, and `returning` is what proves ownership:

```sql
update <table>
set status = 'processing',
    claim_token = $freshToken,
    claim_count = claim_count + 1,
    processing_started_at = now(),
    updated_by = $actor
where id = $id
  and attempt_id = $attemptId
  and attempt_deadline_at > now()
  and claim_count < $maxClaimsPerAttempt
  and (status = 'queued'
       or (status = 'processing'
           and processing_started_at < now() - make_interval(secs => $claimExpiry)))
returning id, attempt_id, claim_token
```

**Never claim `pending`** — that means nobody has asked for the work — and never
claim a terminal `failed`: a human decides whether to pay again.

Then **fence every later write** on `(id, attemptId, claimToken)` plus the status
it expects. Zero rows means ownership was lost: stop. Do not retry the write and
do not escalate it into a terminal failure.

**A live claim is `busy`, and busy THROWS.** It is not a successful no-op:
acking the duplicate spends the delivery recovery depends on. By the next
delivery either the work is done (and that delivery skips cheaply) or the claim
has expired and that delivery IS the recovery.

## Say honestly what the claim does not guarantee

It bounds spend — at most `maxClaimsPerAttempt` paid calls per attempt, and no
two concurrent — but there is **no exactly-once billing guarantee**. A failure
after the provider accepted the work cannot be distinguished from one before it.
Write that in the stack doc, and make any UI action that may re-bill say so
before a human takes it. Do not imply the claim prevents it.

A read-then-write instead of this let two deliveries both believe they had the
row, and both billed a full model run.

The stale window exists because an invocation killed mid-run leaves the row at
`processing`, and no other transition accepts that status — without a reclaim
it is stuck forever.

## Throwing vs not throwing — the load-bearing distinction

The caller is a queue that **retries on a throw**.

| Failure | Do |
|---|---|
| Model refusal, schema validation failure | **Terminal.** Write `failed`, return. Retrying buys the same refusal at full price. |
| Wrong file type, unparseable file | **Terminal.** Deterministic; it parses no better on the fourth attempt. |
| Blob 5xx, DB error, socket, timeout, transient model fault | **Release the claim, then throw.** |
| Blob 4xx, auth failure, truncated output | **Terminal.** It will say the same thing every time. |
| A post-model DB fault | **Release, then throw.** The run is paid for, but a DB fault means nothing was staged either. |

Include the BODY READ in whatever you treat as retriable. Catching `fetch()` and
letting `arrayBuffer()` throw uncaught is the classic version of this bug.

**Release BEFORE throwing.** The retry backoff is far shorter than the stale
window, so a row left at `processing` makes every retry a silent no-op.

**Never wrap the run function in one outer try/catch.** A release has to throw
past the step that raised it; an outer catch converts it back into a terminal
failure and deletes the retry, invisibly.

Best-effort side work (thumbnailing, image extraction) is time-boxed and its
failure swallowed. It must never fail a call that has already been paid for.
