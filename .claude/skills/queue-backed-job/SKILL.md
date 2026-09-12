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
   `update … returning` (409 if the row is not in a runnable state), sends the
   message with an idempotency key, and returns **202**. If the send throws, it
   sets the row to `failed` and returns 502 — otherwise the row waits for a
   message that does not exist.
2. **The consumer does the work** (`src/app/api/queues/[topic]/route.ts`).
3. **The screen polls** with `usePoll`, active only while a row is non-terminal.

## Non-negotiables

- **The consumer is not a session route.** It is reached by the platform, not a
  browser. Keep it OUT of the middleware matcher (the chassis matcher already
  excludes `api/queues`) and let `handleCallback`'s signed protocol
  authenticate it. Adding it to the matcher breaks every job with a 401 that
  looks like a platform outage.
- **`visibilityTimeoutSeconds` must exceed the function `maxDuration`** (600 vs
  300). Otherwise a run that uses its whole budget is redelivered underneath
  itself, and two invocations race for the same row.
- **`MAX_DELIVERIES` is low (4), on purpose.** Each retry of a model job is a
  real, paid, high-effort run. The faults worth retrying either clear quickly
  or not at all.
- **On exhaustion, write a terminal status.** Without it the screen waits on
  something that is never coming. That is what `recordExtractionFailure` is
  for, and it is predicated on the non-terminal statuses so it cannot overwrite
  a result that landed meanwhile.
- **The topic must be declared in `vercel.json`** under `experimentalTriggers`.
  A new topic has NO consumer until that deploy lands; messages sent before
  then sit undelivered. Deploy first, then enqueue.

## Claiming work

One predicated statement, and `returning` is what proves ownership:

```sql
update <table>
set status = 'processing', processing_started_at = now(), updated_by = $actor
where id = $id
  and (status in ('queued','pending','failed')
       or (status = 'processing'
           and processing_started_at < now() - make_interval(mins => 15)))
returning id
```

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
| Blob 5xx, DB error, socket, timeout | **Release the claim, then throw.** |
| Blob 4xx | **Terminal.** It will say the same thing every time. |

**Release BEFORE throwing.** The retry backoff is far shorter than the stale
window, so a row left at `processing` makes every retry a silent no-op.

**Never wrap the run function in one outer try/catch.** A release has to throw
past the step that raised it; an outer catch converts it back into a terminal
failure and deletes the retry, invisibly.

Best-effort side work (thumbnailing, image extraction) is time-boxed and its
failure swallowed. It must never fail a call that has already been paid for.
