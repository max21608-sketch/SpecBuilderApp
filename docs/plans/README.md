# Plans

## Releases

| Release | Document | Depends on | State |
|---|---|---|---|
| Scaffold | `bw-app-kit` Part 2 plan | — | Built 2026-09-12 |
| M1 — spec table and completion view | `part-2/` plan + this log | — | **Shipped to staging 2026-09-13** |
| M2 — AI extraction of richer documents | — | M1 | Unblocked 2026-09-13, not started |
| M3 — BWS CSV export (complete dataset) | — | M1; a way to test an import | Named only |
| M4 — draft chase emails | — | M1 | Named only |
| M5 — shared-inbox ingestion | `docs/integration.md` | Entra app + scoped mailbox | Named only |
| M6 — VE rounds, TG0 A/B/C sign-off | — | a settled gate model | Named only |

M2–M6 are named so they are not built speculatively. Only M1 is scoped.

## Decisions taken 2026-09-12

Record the reasoning, not just the outcome — the reason is what tells a future
reader whether the decision still applies.

1. **Fork the kit rather than share a package.** A shared `@benwhistler/core`
   would force premature abstraction on ~25 files that are mostly 20–100 lines
   and couple two apps' releases while both move fast. Copying is cheap;
   `chassis/PROVENANCE.md` in the kit records origin so an upstream fix is
   ported deliberately. The cost — fixes do not propagate on their own — is
   accepted and paid with a CHANGELOG line.
2. **One Neon project per environment, not one project with two branches.**
   Production gets a completely separate Neon project. Stronger isolation:
   separate credentials, and no console action can promote or reset across the
   boundary. The cost is losing the ability to branch production data into a
   sandbox for debugging; the replacement is a restore from `db/backup.mjs`.
3. **The Neon default branch is named `root`.** Renamed from `production`
   because a branch by that name inside the non-production project would make
   `DATABASE_ENVIRONMENT=production --yes-production` succeed against the wrong
   database while every guard reported exactly what it was designed to report.
   Only the name could close that gap.
4. **Vercel's Production Branch is `staging`, and there is no `main` branch.**
   Vercel's "production deployment" is a deployment class, not our environment:
   it decides which branch claims the stable alias and receives the project's
   variables, and those variables declare `APP_ENV=staging`. Left at `main`,
   every push takes the Preview path — new hostname per deploy so session
   cookies do not carry, no project env vars so the app throws on `APP_ENV`,
   and Vercel Authentication in front of the URL that reads as our own sign-in
   being broken.
5. **Functions pinned to `lhr1` in `vercel.json`, not in the dashboard.** The
   default was `iad1`, which put every query across the Atlantic from a London
   database and processed NDA material in the US. A committed declaration
   survives the project being recreated; a dashboard setting does not. Ported
   back to the kit's chassis.
6. **A `/dashboard` page exists before any feature does.** `/api/auth/login`
   redirects there, so without it a successful sign-in answers 404 —
   indistinguishable from a broken sign-in at exactly the moment someone is
   proving a deployment works. It states who is signed in, the app environment,
   and which database. Ported back to the kit's chassis.
7. **Model gates as data, not an enum in code** — because the gate model is not
   settled. See below.

## Decisions taken 2026-09-13 (M1)

8. **Records are keyed by a surrogate id plus `record_no`, not by client ref.**
   The pilot BOQ contains `SX11A` twice with different quantities, and the same
   item carries four different refs across four documents. Refs live in
   `spec_record_refs`, unique per record rather than per project. `record_no`
   exists so a reviewer can tell two `SX11A`s apart and the M3 export has a
   stable sort.
9. **Answers are keyed on the cheat-sheet question, not the BWS field.** A
   person answers a question; the field is where the answer goes afterwards.
   The 408 readiness questions have no field, so they are structurally
   incapable of reaching a BWS export.
10. **Category matching got a seeded vocabulary, not a lower cutoff.** Matching
    BOQ words against sheet names scored 5 of 59 — a BOQ says "Sofa", the sheet
    is "Armchairs, Benches, Stools, Sofas". `item_category_aliases` takes it to
    56 of 59. Lowering the confidence cutoff would have turned "no match" into
    "confidently wrong", and a wrong category measures a record against the
    wrong checklist: complete-looking while asking none of the right questions.
11. **Requirements ship ungated.** No cheat sheet mentions a gate anywhere, so
    assigning one would be inventing data and attributing it to its owner.
12. **Cabinetry requirements were authored after all.** The brief said to leave
    them empty so they read as not-yet-defined; that predated having the
    sheets, which turned out near-identical to the upholstery ones.
    `requirements_authored` remains for a category added later without one.
13. **The source document is kept, in a PRIVATE blob store.** A public blob URL
    is access for anyone holding it, and these are NDA-covered client
    documents. Where no store is configured the import still works but records
    that the original was not kept, rather than pretending it was.
14. **`revision_no` ships at 0 on every answer.** One column now, instead of a
    primary-key migration on the busiest table when M6 needs the original spec
    and a VE alternative side by side.

## Still open

Observed 2026-09-12. These are the brief's own gaps; none is a decision taken.

1. **The gate model is unreconciled.** The handover and the design requirements
   use TG0 / TG1 / TG2. On 2026-09-12 Matthew separately proposed a pre-sale
   gate **TGQ** ("enough info to quote"). Until Matthew reconciles them, gates
   are data and TGQ is recorded as proposed.
2. **Who owns the requirement matrix after M1 seeds it is undecided.** The
   cheat sheets are XLSX/PDF per category in SharePoint (~19 across Upholstery
   and Cabinetry). The workflow diagram flags this as the real institutional
   gap: it currently relies on KAM / sales-support knowledge. Waiting on
   Matthew.
3. **Keeping `spec_fields` in sync with BWS** — mechanism and cadence
   undecided. The `external-vocabulary-sync` skill covers the *how*; the *who*
   and *when* do not exist. Waiting on Matthew.
4. **TOE dates for P17231 are stale** (order 17/02/2026, delivery 17-Jun, both
   past), so the overdue and flagging logic has no live dates to run against.
5. **The finishes schedule for P17231 was not found.**
6. **BWS access.** The user could not log in as of 2026-09-12. The AI mirror
   (`bws-next-ai.whistlercloud.com`) is refreshed daily, discards changes, and
   its import/export does not work — a read/reference surface, not an
   integration target, and it cannot be used to test the M3 CSV export.
7. ~~**Anthropic zero-data-retention.**~~ **Cleared 2026-09-13** by the user.
   Client specification documents may go to the model; M2 is unblocked. Who
   owns the Anthropic Console account is still unnamed.
8. **Account ownership.** The GitHub repo (`max21608-sketch`) and the Neon org
   (`max21608@gmail.com`) are personal accounts holding NDA-covered client
   material under a Ben Whistler contract. Noted, not decided.
9. **Blob retention.** Nothing in the application deletes an uploaded
   document, ever. M1 is the first real consumer of that store, so the gap is
   now live rather than theoretical. See `db/README.md`.
10. **The question-to-BWS-field mapping is unreviewed.** 320 of the 728 seeded
    requirements point at a BWS field, and that mapping is this repo's
    judgement, not Matthew's. Only 28 of the 56 fields are reachable from a
    cheat-sheet question at all. Review before M3 depends on it.

## Running agents in parallel

- One `git worktree` per agent.
- **Exactly one agent owns `db:migrate` and the sandbox.** The runner applies
  every not-yet-applied file in sorted order, so a second agent's half-written
  migration would be applied by the first.
- Give a pure-library agent no `DATABASE_URL`; database suites skip without it,
  which is correct for that work.
- Exactly one agent pushes the branch.
- `CLAUDE.md` / `AGENTS.md` belong to exactly one agent, or they diverge.
- Two agents works. Three does not, and would likely be slower than two.
