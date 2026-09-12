---
name: ship-to-staging
description: Commit, push, deploy and verify a change on staging, and report its state honestly.
---

# Shipping to staging

## Sequence

1. `git status` — check nothing unrelated is about to be swept in. Uncommitted
   and untracked files belong to the user.
2. `npm run lint && npm run typecheck && npm test && npm run build`.
3. Commit **only the scoped files**. No `git add -A`.
4. `git push origin staging`.
5. Find the deployment **for that exact SHA**. Not the newest one — the one
   whose source commit matches. `git rev-parse HEAD` and compare.
6. Wait for `Ready`. Space checks by at least 15 seconds; rapid polling of live
   URLs triggers bot protection.
7. Sign in to staging and exercise the changed flow (see the `verify` skill).
8. Confirm `/api/auth/me` reports the sandbox database.

## If the push did not produce a deployment

Search all deployment statuses for the exact SHA before concluding anything. A
provider's "redeploy" button may rebuild the *old* commit rather than the
current branch tip.

A newly created hosting project may deploy an older tip from its configured
branch — verify its source SHA before treating it as current.

## If you changed or added an environment variable

Set it in every hosted environment that will run the code, update
`.env.example`, then trigger a **fresh** build. Configuration changes do not
alter deployments that were already built, and "redeploy" may rebuild the old
commit.

## If you added a queue topic

It has no consumer until the deploy declaring it in `vercel.json` lands.
Messages sent before then sit undelivered. Deploy first, then enqueue.

## Reporting

Use these exactly:

`changed locally` · `committed locally` · `pushed` · `deploying` · `deployed` ·
`verified in the app`

Name the SHA and the environment. Do not say "deployed" when you mean "pushed".
Do not claim a check you did not run. If something is unverified, say which
thing and why.

## Production

Not from this skill. Production requires explicit authorization for that
specific action, every time.
