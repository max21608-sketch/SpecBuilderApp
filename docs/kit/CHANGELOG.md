# Changelog

Dated entries whenever a kit rule, template or chassis file changes. Record the
reason, not just the change — the reason is what tells a future reader whether
it still applies.

## 2026-09-13 — the kit is folded into the Spec Builder app

This file now lives at `SpecBuilderApp/docs/kit/CHANGELOG.md`. See the README
beside it for why. Entries below this line were written while the kit was a
separate repository; entries above it are recorded here instead of being
ported upstream, because there is no longer an upstream to port to.

## 2026-09-13 — what building M2 (document extraction) found in the chassis

All of these are applied in this app. They are recorded here because a future
app forking from this one would otherwise inherit the original faults.

- **The chassis told an app to create a SECOND staging table.** The `M2:`
  comments in `extraction-run.ts` said to create `document_extractions` and
  named its columns. Following that advice gives an app two staging tables and
  therefore two confirm routes — and the `review-and-confirm` skill forbids that
  outright, because the second route is always the one that forgets a guard. The
  advice should have been: RENAME this file's statements onto the app's existing
  generic intake table. `intake_runs` in this app was written generic for exactly
  that, and 0002 says so.

- **The claim protocol had one identifier where it needs two.** The chassis
  claimed on `status` plus a stale-processing window. That stops two deliveries
  claiming at the same moment, but it does not stop a worker whose claim EXPIRED
  while its request was still in flight from landing its writes on top of the
  worker that legitimately reclaimed after it. `attempt_id` (a logical attempt)
  plus `claim_token` (one invocation) fences both, and every write carries both.

- **An unexpired claim was a successful no-op.** A duplicate delivery that found
  a live claim returned `skipped` and the message was acked. That spends the
  delivery recovery depends on: if the live worker is then killed, nothing comes
  back to reclaim it. It is now `busy`, and busy throws.

- **Exhaustion could kill a live run.** `recordExtractionFailure` was predicated
  only on the non-terminal statuses, so the last delivery of a duplicated
  message could mark an attempt failed while another invocation was mid-run and
  already paid for. It is now fenced on the attempt and on the claim having
  expired.

- **The retriable blob read caught `fetch()` but not `arrayBuffer()`.** The body
  read throws separately, and it was outside the try.

- **`/api/imports` fetched a client-supplied URL with `Bearer
  BLOB_READ_WRITE_TOKEN`.** A signed-in user could point it at any host and the
  server handed over a store-wide credential. The fix is not a better URL check
  but never taking a URL: blobs are addressed by pathname, resolved by the store
  against its own host, scoped to a project prefix that is checked at token
  issue, at registration and on every read. This is the most serious defect the
  chassis has shipped, and any app forked before today has it.

- **`matchName`'s exact-name path used `find`.** It returned the first candidate
  whose normalised name matched and discarded the rest — a silent tie-break, in
  the one module whose header says never to make one. Two register rows
  legitimately share a name. It now returns every exact match, so a tie stays a
  tie.

- **The timing constants were scattered and unasserted.** `maxDuration`,
  `visibilityTimeoutSeconds`, the stale window and the model deadline are an
  INEQUALITY, not four independent numbers, and two of them also live in
  `vercel.json`. They are now one module with a test that asserts the
  relationships and checks them against the deployed trigger.

- **Nothing said the transaction helper was required for real rollback.** A
  batch API taking a pre-built array of statements cannot evaluate a guard and
  abort, so every check runs before the transaction opens under read-committed.
  `db-transaction.ts` exists for that; the skills now say when it is mandatory
  rather than leaving it as a local convenience. It is worth porting only with
  its Node-runtime and dependency caveats — do not silently change every app's
  driver.

## 2026-09-13 — what building M4 (chase emails) found in the chassis and skills

All of these are already applied or accounted for in this app. They are
recorded here because a future app forking from this one would otherwise
inherit the original faults.

- **`eml.ts` could not cc anybody.** `BuildEmlInput` had `from`, `to`,
  `subject`, `body` and no `cc`, so an app whose whole requirement is "draft the
  chase and copy the project inbox" had to fork the one file whose safety
  argument is that it is small enough to read. Added as an optional field that
  emits no header at all when empty — an empty `Cc:` is not the same as no Cc,
  and some clients render it as a blank recipient chip.

- **`eml.ts` concatenated display names into address headers.** `${name}
  <${email}>` is wrong for a name containing a comma: `Lecoadic, Scotto
  <lcs@…>` parses as TWO recipients, the second malformed. Added
  `formatAddress`, which quotes a name containing RFC 5322 specials and
  RFC 2047-encodes a non-ASCII one (an encoded-word may not appear inside a
  quoted string, so the two cases are exclusive). The existing CR/LF stripping
  is kept and now applies to both halves.

- **`eml.ts` still carried the fabric app's de-domaining leftovers.** Its header
  named a person who works on that app and referenced one of *its* migration
  numbers (`pre-0007`), neither of which means anything in a forked app.

- **`extraction-run.ts`'s `M2:` comments instruct you to create a table called
  `document_extractions`.** This app had already built a deliberately generic
  `intake_runs` for exactly that purpose, and the two disagreed silently: the
  chassis file was dead code pointing at a table that did not exist. The
  comment should say: if the app already has a generic intake/staging table,
  rename onto it — two staging tables mean two confirm routes, which the
  `review-and-confirm` skill forbids outright.

- **`email-draft-and-send-gate/SKILL.md` states the `version = snapshot + 1`
  undo rule unconditionally.** It is only correct for a gate whose confirm
  MUTATES the covered business rows — that is what makes exactly one bump proof
  that nothing else touched them. This app's chase deliberately writes nothing
  when a send is recorded (a `chased_at` column would bump `spec_answers` and
  invalidate every extraction snapshot taken against it), so there is no bump
  to count and the rule does not apply. The skill should state the premise
  alongside the rule.

- **The same skill assumes a whole-body `contentEditable` editor.** Its own
  sanitiser describes itself as "defense-in-depth for a single-tenant tool
  whose only author is the logged-in user" — not a sanitiser. Worse, it lets
  the body and the coverage rows drift apart, and the send gate's entire
  guarantee is that they cannot. Editable plain-text prose plus a generated
  question table is the safer shape.

- **Not in any skill, and it cost an afternoon:** a context snapshot stored as
  `jsonb` cannot be compared with `JSON.stringify`. Postgres does not preserve
  key insertion order, so the stored value never matches the freshly computed
  one and every draft reads as stale the instant it is generated. Compare with
  a canonical stringification that sorts keys.

## 2026-09-13 — the chassis vercel.json never deployed

Found by actually deploying a forked app for the first time. **Every deployment
from the previous chassis failed**, in the schema-validation step, before a
single line of application code ran — and nothing in the kit's own checks could
catch it, because `lint`, `typecheck`, `test` and `build` all pass with an
invalid `vercel.json`.

Two errors, one after the other:

1. `experimentalTriggers[0]` `should NOT have additional property
   "maxAttempts"`. There is no such key. The real one is `maxDeliveries`.
2. `experimentalTriggers[0].type` `should be equal to constant`. The schema has
   two queue variants: `queue/v1beta` **takes** a `consumer`, `queue/v2beta`
   does **not**. The chassis declared `queue/v2beta` *with* a consumer, which
   matches neither.

`chassis/vercel.json` now declares `queue/v1beta` with `consumer`,
`retryAfterSeconds` and `maxDeliveries: 4` — the same 4 the consumer route
enforces as `MAX_DELIVERIES`, with a comment in the route saying they must
agree. If they diverge, either a job is abandoned while its screen still polls,
or a paid model call is retried more times than intended.

Worth remembering as a kit rule: **a deployment is the only thing that
validates `vercel.json`.** Part 1 verified the chassis by building and running
it locally, which is exactly why this survived.

## 2026-09-12 — first fork (Project Spec Builder)

Found while forking the kit into `SpecBuilderApp`. All three are chassis fixes,
already applied in that app.

- **`chassis/vercel.json` now declares `regions: ["lhr1"]`.** It declared no
  region at all, so a forked app inherits whatever the Vercel dashboard
  defaulted to — `iad1` in practice, putting every query across the Atlantic
  from a London database, and processing NDA-covered material in the US. A
  committed declaration survives the hosting project being recreated; a
  dashboard setting does not.
- **`chassis/src/app/dashboard/` and `src/app/page.tsx` added.**
  `/api/auth/login` redirects to `/dashboard` and nothing was there, so a
  successful sign-in answered 404 — which looks exactly like a broken sign-in,
  at the one moment someone is trying to prove a deployment works. The page
  reports who is signed in, the app environment and which database.
- **`skills/start-new-app` reordered.** It told you to write the ignore rules
  before copying `chassis/`, but the chassis ships its own `.gitignore`, so the
  copy silently reverts them. This happened on the first real fork and left a
  file of staging secrets untracked-but-committable; `git check-ignore` caught
  it, reading the file would not have. The skill now says to copy first, append
  second, and verify with `git check-ignore`.

## 2026-09-12 — initial

Distilled from `benwhistler/fabric-ordering-app` at commit `7b73692`.

Supersedes two earlier untracked attempts that live in that repo:
`CLAUDE.portable.md` (a single-file instruction template, about 85% of what was
needed — it had no companion doc templates, no load-bearing-workflows scaffold,
no skills and no code) and `quote-panda/` (that template applied to a different
sibling app, docs only).

Deliberate departures from upstream, all recorded in `chassis/PROVENANCE.md`:

- **Middleware matcher polarity inverted** to default-protected. Upstream lists
  protected prefixes, so a route someone forgets to list is wide open.
- **Backups default outside the repository.** Upstream writes dumps into an
  iCloud-synced working directory, uploading NDA-covered client data to a
  personal cloud account.
- **CI added.** Upstream has no `.github/` at all; lint, typecheck and test are
  run by hand.
- **`0001_foundation.sql` folds in upstream's later audit fixes** (`0002`,
  `0012`, `0019`) rather than reproducing the original `0001`, which is missing
  all three.
- **The `verify` skill's migration gotcha corrected.** Upstream's copy still
  says migrations are untracked and must be hand-run; the `schema_migrations`
  ledger made that wrong, and hand-running a file now causes the double-apply
  it warns against.

- **`tools/create-user.mjs` switched to `pg` + `requireScriptEnvironment`.**
  Upstream uses the Neon HTTP driver, which skips the preflight — so the script
  that creates admin accounts prints no target host and accepts no
  `--yes-production` guard. Found while verifying the chassis. **This one is
  worth porting back to the fabric-ordering app.**

Not fixed, inherited, and documented as open: no blob backup or retention
policy, and no monitoring or alerting.

## 2026-09-14 — two rules learned from the intake rebuild

- `extraction-pipeline` gains **"resolve at read time when the output is
  register-independent"**. The kit's advice assumed every extraction resolves in
  the worker, which is right only when a proposal will UPDATE an existing row
  and therefore needs a target snapshot. An observation that will INSERT one
  depends on no register, and resolving it on read is what lets a document be
  extracted before the document that creates its targets — without a second
  paid call. The cost is one extra guard, written down with it.
- `review-and-confirm` gains **"the unit of commit is whatever card the reviewer
  sees whole"**. The kit said "one record per confirm", which is one INSTANCE of
  the rule rather than the rule. Where one staged row legitimately targets
  several canonical rows, the staged row is the boundary. Both shapes are now
  described, rather than the old wording being generalised in place.
