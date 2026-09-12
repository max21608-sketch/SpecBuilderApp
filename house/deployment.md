# Deployment and release policy

## The six terms

Use these exactly. They are not synonyms, and blurring them is how someone
believes a fix is live when it is sitting in a working tree.

| Term | Means |
|---|---|
| `changed locally` | Files edited. Not committed. |
| `committed locally` | A commit exists on your machine. Nothing has left it. |
| `pushed` | The commit is on the remote branch. **No deployment is implied.** |
| `deploying` | A build for that exact SHA exists and is running. |
| `deployed` | That build reached its ready state. |
| `verified in the app` | Someone signed in and exercised the changed flow. |

**A local commit is not a deployment.** Never report a hosted change as
available because it was committed or pushed.

## Production requires explicit authorization

Every time, for that specific action. Approval to deploy staging is not
approval to deploy production; approval to deploy production is not approval to
migrate its database.

Never without an explicit yes:
- merge or push the production branch
- deploy production
- apply a production migration
- copy data into production
- change production configuration

## A staging handoff is complete when

1. The scoped files are committed (nothing unrelated swept in).
2. `staging` is pushed.
3. A deployment exists **for that exact commit SHA** — confirmed, not assumed.
4. It reached `Ready`.
5. The changed workflow is verified in the signed-in staging app.

Record the SHA and the environment in the report.

## Traps that have actually happened

- **A push may not trigger a deployment.** Search all deployment statuses for
  the exact SHA rather than reading the newest row.
- **"Redeploy" can rebuild the OLD commit** rather than the current branch tip.
  Use the documented trigger method.
- **A newly created hosting project may deploy an older tip** from its
  configured branch. Verify its source SHA before treating it as current.
- **Environment-variable, branch and storage changes do not alter an existing
  deployment.** They apply to the next build. Change the setting, then trigger
  a fresh deployment, then verify the new build actually uses it.
- **A new required env var must be set in every hosted environment BEFORE the
  code that needs it deploys** — and added to `.env.example` in the same
  change.
- **A queue topic has no consumer until the deploy declaring it lands.**
  Messages sent before then sit undelivered.
- **Do not rapidly poll live deployment URLs.** It triggers bot protection.
  Space checks by at least 15 seconds.

## Schema releases are two operations

Applying the migration and deploying the dependent code are separate, and the
order matters. Additive migrations go first; destructive ones go after the code
that stopped using the column. Never assume the platform runs migrations — it
does not.

## Rollback

Rolling code back is safe **if the bad deploy added no migration**. If it did,
the database is now ahead of the code. That is usually harmless, but verify it
rather than assuming — forward-only migrations have no down step, so the fix is
another migration, not a reversal.
