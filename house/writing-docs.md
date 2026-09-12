# Writing docs in this company

## Document the trap, not the rule

The distinctive thing about this codebase's documentation is that it explains
what a naive change breaks, and why the breakage would be invisible.

> Release the claim before throwing, because the retry backoff is far shorter
> than `STALE_CLAIM_MINUTES` — a row left at 'processing' makes every retry a
> silent no-op.

Not:

> Remember to release the claim.

The second version gets deleted by whoever is tidying up. The first survives,
because it tells the reader what it costs to be wrong.

## Write gaps down, dated, as observations

Use these headings freely:

- **What it does *not* have** — deliberate absences, stated as risk removal.
- **KNOWN GAP (observed 2026-09-08)** — what you saw, when, not what was
  intended.
- **Still open** — with the honest count: "(1), (2) and (4) are open items, not
  solved problems."
- **Known limits, worth being honest about**

A doc describing the intended design of something that does not work that way
is worse than no doc, because people act on it.

## Keep a dated decision log

`docs/plans/README.md` holds a release table, a dated list of decisions with
their reasons, and what is still open. Record the reasoning, not just the
outcome — the reason is what tells a future reader whether the decision still
applies.

## Keep the status section current

A stale "current milestone" section is worse than none, because agents and
people both make decisions from it. It needs four parts:

- **Done** — be honest; "documented the scope" is a real entry on day one.
- **In progress / next**
- **Explicitly excluded for now** — the most valuable of the four. It stops
  speculative implementation of things that merely sound adjacent.
- **Known gaps or decisions awaiting someone** — name the person.

## Write for the person who arrives mid-incident

`docs/recovery.md` is written to be followed under pressure by whoever is
available. That means: a triage table first, the cheapest diagnostic first
("check `/api/auth/me`"), numbered steps, and an escalation table whose last
row is *what to tell the user, in order* — whether it is safe to keep working,
whether anything they did was lost, when to check back. Not the cause. The
cause can wait.

## Running agents in parallel

From the fabric app's `docs/plans/README.md`, learned by doing it:

- One `git worktree` per agent.
- **Exactly one agent owns `db:migrate` and the sandbox.** The runner applies
  every not-yet-applied file in sorted order, so a second agent's half-written
  migration gets applied by the first.
- Give a pure-library agent no `DATABASE_URL`. Database suites skip without it,
  which is correct for that work.
- Exactly one agent pushes the branch.
- `CLAUDE.md` / `AGENTS.md` belong to exactly one agent.
- Two agents works. Three does not, and would likely be slower than two.

## An end-to-end sandbox run writes a cleanup manifest

Stamp a distinctive actor on everything the run creates
(`sandbox-test:<name>`), and write a machine-readable manifest of every row and
blob ID. Cleanup is then exact rather than a guess, and the manifest doubles as
a record of what the run actually did.
