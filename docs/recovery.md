# Recovery

Written to be followed under pressure, by whoever is available.

## Two things to hold onto

1. **The database is the app.** The website is disposable — it rebuilds from
   git in about two minutes. The database is not. When in doubt, protect the
   database and let the website stay broken a while longer.
2. **Production and sandbox are completely separate.** Nothing you do in
   sandbox can damage production. If you are unsure which you are touching,
   stop and check — see "the single most useful habit" below.

## The single most useful habit

Open `/api/auth/me` first. It tells you which environment and which database
you are actually looking at. Most confused incidents are someone testing the
wrong deployment.

## Triage

| Symptom | Likely cause | Go to |
|---|---|---|
| Whole site is down / 500 on every page | Bad deploy, or env var missing | §1 |
| Nobody can log in | `AUTH_SECRET` changed, or database unreachable | §2 |
| One page or feature broken, rest fine | Code bug in that route | §3 |
| Everything slow, or "could not connect" | Database unreachable | §4 |
| Uploads fail, or extraction stuck on Processing | Blob, queue, or model API | §5 |
| Shared-inbox messages not appearing (M5) | Graph credentials, or the poll | §6 |
| Data is wrong or missing | **Slow down.** | §7 |
| Need to undo a release | | §8 |

## What you need before you start

| Access | Who has it |
|---|---|
| Vercel (`spec-builder-app`, team `max21608-sketch's projects`) | Max de Groot |
| Neon (`SpecBuilder`, org `max21608@gmail.com`) | Max de Groot |
| GitHub (`max21608-sketch/SpecBuilderApp`) | Max de Groot |
| Anthropic Console | **unassigned — nobody has confirmed who owns this** |
| BWS (read-only reference) | **open — the user could not log in as of 2026-09-12** |
| SharePoint (cheat sheets, BOQs, TOE folder) | Ben Whistler M365 accounts |

Every row above is one person. That is the single largest operational risk in
this table and it is not a technical problem.

Fill the right-hand column in. An access list nobody can act on is not a
recovery plan.

## 1. Whole site down

1. Check the hosting dashboard for a failed build. A failed build means the
   previous deployment is still serving — so if the site is *down*, the newest
   build probably succeeded and is broken.
2. Read the runtime logs for the failing route.
3. If it began right after a deploy, roll back (§8).
4. If it began right after an environment-variable change, that change did not
   reach the running build until it was rebuilt — check which build is live.

## 2. Nobody can log in

- `AUTH_SECRET` changed → every existing session cookie is now invalid. Users
  sign in again; nothing is lost. If it changed by accident, restoring the old
  value restores the sessions.
- Database unreachable → §4. Login reads the `users` table.
- One person only → check `users.active` and their role.

## 3. One feature broken

Reproduce it signed in, read the network response (not the UI's error text),
then the runtime logs for that route. Fix forward if it is small; roll back if
it is not obvious within a few minutes.

## 4. Database unreachable

Check the database provider's status and whether the project is suspended or
over quota. Confirm `DATABASE_URL` in the live deployment. Nothing is lost
while it is unreachable — do not start restoring backups to "fix" an outage.

## 5. Uploads and extractions

| Symptom | Check |
|---|---|
| Upload fails immediately | Blob token; file type against the allowed list; size cap |
| Stuck on "Processing" | The queue consumer. A row claimed by a killed invocation is reclaimed after the stale window — wait it out before intervening |
| Extraction fails instantly | The model API key, quota, and the stored `raw_response` on the row |
| Queue messages never arrive | Is the topic declared in `vercel.json` on the **deployed** build? A topic has no consumer until that deploy lands |

## 6. Shared-inbox ingestion (M5 — not built yet)

Nothing ingests mail today. When it exists: it is **read-only**, it stages
messages rather than mutating spec records, and turning it off is removing the
`GRAPH_*` variables and redeploying. See `docs/integration.md`.

## 7. Wrong or lost data

**This is the one place where moving fast makes things worse.**

### Stop before you fix

1. Take a backup **of the broken state**, now. You may need it to reconstruct
   what happened.
2. Write down exactly what is wrong: which records, which fields, what they
   say, what they should say.
3. **Check the audit trail before assuming a bug.** Very often "the data is
   wrong" turns out to be "someone changed it" — which is a conversation, not a
   repair.

### Then repair

Work out the correct values from the audit log and the source documents. Make
the change deliberately, as the acting user, so the repair is itself audited.
Prefer many small verified corrections to one clever bulk update.

### Known limits, worth being honest about

- Restoring a backup restores the **whole database** to that moment. It cannot
  restore one table without discarding everything else since.
- Blob is not covered by a database restore: restored rows may point at
  documents with a different lifecycle.
- **Local and staging share one database** (the Neon `sandbox` branch), so a
  local repair touches what staging shows, and vice versa.
- The audit trail is append-only and immutable by trigger, so it survives a
  bad repair — but it only records what went through the app. A change made
  with `psql` leaves no actor and no before/after.
- There is no production to lose yet. The first real exposure arrives with the
  production project.

## 8. Emergency rollback

Redeploy the last known-good commit, then verify the SHA that is actually live.

If the bad deploy included **no migration**, this is safe and complete. If it
did, the database is now ahead of the code. That is usually harmless — but
verify it rather than assuming, because forward-only migrations have no down
step and the fix is another migration.

## Escalation

| Situation | Who | When |
|---|---|---|
| Production data loss | Max de Groot → Matthew Lewis | Immediately |
| Suspected credential exposure | Max de Groot; rotate first, explain second | Immediately |
| Extended outage | Max de Groot | Within the hour |
| A BWS export that may have wiped fields | Stop. Matthew Lewis, before anyone re-imports | Immediately |
| **What to tell the user** | — | As soon as you know: (1) is it safe to keep working, (2) was anything they did lost, (3) when to check back. **Not the cause — that can wait.** |

## Checking the change history is complete

Since `0012` every write to spec content belongs to a CHANGE SET, and every
change set that touched a record should hold a VERSION of it. Nothing enforces
that with a trigger — see decision 63 — so this is the query that checks it.
Run it against any environment; an empty result is the healthy state.

```sql
select cs.id, cs.kind, cs.actor, cs.created_at, count(*) as writes
from change_sets cs
join audit_log al on al.change_set_id = cs.id
where al.table_name in ('spec_records', 'spec_answers', 'record_attributes', 'spec_record_refs')
  and not exists (select 1 from record_snapshots s where s.change_set_id = cs.id)
group by cs.id, cs.kind, cs.actor, cs.created_at
order by cs.created_at;
```

A row here means a write path changed a record and recorded no version of it.
The fix is in the code that made the write, not in the data — but the missing
versions should then be written under the change set that made the change, so
the trail is complete rather than quietly short. `db/backfill-finishes.ts`
carries an example of taking them.

Rows written BEFORE `0012` carry a null `change_set_id` and are not joined
here. That is correct: history starts at `history_begins`, and
`docs/plans/README.md` decision 58 says why it is not reconstructed.

**A fix applied with `psql` belongs to no change set.** Nothing refuses it, and
the trail will simply not explain what happened — which is worse than usual now
that a history screen exists and people read it. Open a change set first:

```sql
begin;
insert into change_sets (project_id, kind, reason, closed_at, actor)
values ('<project-id>', 'manual_edit', '<why, in a sentence>', now(), 'system:psql')
returning id;
select set_config('app.change_set_id', '<that id>', true);
-- ... the fix ...
commit;
```

A version still has to be taken separately, because composing one means running
`composeRowCells` and rebuilding that in SQL is the second composer the export
design exists to prevent.
