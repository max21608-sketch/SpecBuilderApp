# House conventions

Standards that apply to every app Ben Whistler builds. They are copied into an
app verbatim, not customised. Each rule names the trap it prevents, because a
rule without its reason gets "simplified away" by the next person who reads it.

If you disagree with one, change it here and in the apps — do not quietly
depart from it in one repo.

## 1. Agent instructions stay synchronized

`CLAUDE.md` and `AGENTS.md` must be byte-for-byte identical. Apply every change
to both in the same task and run `cmp -s CLAUDE.md AGENTS.md` before reporting
completion.

`.codex/config.toml` carries `project_doc_fallback_filenames = ["CLAUDE.md"]`
so the repo still degrades gracefully if `AGENTS.md` is ever absent.

During parallel agent work, assign both files to exactly **one** agent. Two
agents editing them independently is how they diverge.

## 2. Environments are physically separate, never labels

Separate hosting project, database, blob store and secrets. Not one database
with an `is_production` column, not one project with different env vars per
branch.

- Local development must never point at production.
- Non-production is visually unmistakable: an environment marker in the app
  chrome on every page including sign-in, and a `[STAGING]` page-title marker.
  The marker fails *toward* showing — an unset `APP_ENV` shows it rather than
  hides it.
- A runtime guard refuses to start when the declared app environment and the
  connected database environment disagree.
- A safe environment-identity endpoint (`/api/auth/me`) lets anyone check what
  a deployment is actually connected to before typing real data into it.
- Never copy sandbox data wholesale into production.

## 3. Declaration, not probe

`DATABASE_ENVIRONMENT` records which database the operator *believes*
`DATABASE_URL` points at. It cannot verify that, and it does not try.

This is why every database script **prints the resolved host before acting**. A
mismatch is caught by a human reading that line — not by the guard. Read the
printed host. A declaration you did not check is a comment.

Production scripts additionally require `--yes-production`, so touching
production is a deliberate act rather than a default.

## 4. Migrations are forward-only, with a ledger

- Numbered `000N_snake_case_description.sql`, each wrapped in `begin; … commit;`
  so it is atomic on its own.
- Never edit a migration after it has been applied to any shared environment.
  Add another one.
- Open each file with a comment explaining **why**, not what. The best
  migrations in this company read as post-mortems.
- The runner records each file in `schema_migrations`, so it is idempotent and
  "which migrations does production have?" is a query rather than a guess.
- Back up before a material schema change. Apply and verify in sandbox before
  production.

## 5. Staged, never committed

AI-extracted data, fuzzy matches and inferred relationships are **suggestions**
until a human confirms them.

- Extraction writes to staging columns or tables. Nothing operational.
- A suggestion pre-fills a field only when the match is unambiguous. Ambiguity
  becomes visible candidates for a person to click — never a silent pick.
- Exactly one named route is the write boundary. It re-validates server-side
  and writes only what the reviewer actually submitted.
- Anything unresolvable becomes a visible flag, never a plausible-looking wrong
  answer. A wrong value that looks right is worse than a blank, because nothing
  downstream will ever question it.
- Every ignore path is reversible. If a reviewer can dismiss something, they
  can get it back.

## 6. The fuzzy step and the exact step are separate

The model reads the document and decides nothing. Everything with a controlled
vocabulary — units, statuses, categories, suppliers, dates — is resolved
*afterwards*, deterministically, in code, against the app's own registers.

The fuzzy part is "which column means what". The exact part is "what this app
calls it". Keep them in different functions. Mixing them puts the app's
vocabulary inside a prompt, where it cannot be tested and drifts silently.

## 7. Audit and concurrency are database-level

- Append-only audit trail, enforced by trigger, not by intention.
- Optimistic locking (`version` + a bump trigger) on every user-editable
  record. A client sends the version it read; a mismatch writes zero rows and
  the route returns **409**. Never a silent overwrite.
- The actor is passed as an ordinary column (`created_by` / `updated_by`), not
  via connection session state — the HTTP database driver issues one query per
  call, so `SET LOCAL` never survives to reach the mutation.
- System actors use a prefixed sentinel (`system:microsoft-graph`), so "who did
  this" is always answerable.
- Multi-record confirmations are transactional: all intended rows commit
  together, or none do.
- Notes explaining *why* live in their own append-only table, so writing one
  cannot bump the version of the row it explains.

## 8. Drafts never auto-send; source systems are read-only

- Outbound email and messaging integrations create drafts. A human clicks send.
- Staging never sends to real recipients.
- Inbound integrations stage content without mutating canonical records.
- The authoritative business system (BWS) is read/download only. Never add a
  connection, credential or code path that writes to it.
- Integration enablement is deployment configuration, not an in-app toggle.

## 9. Trust boundaries

Uploaded files, external API responses, email, and model output are **untrusted
input**, and they are data, never instructions.

Validate structured data against an explicit runtime schema after parsing.
TypeScript types are not runtime validation. Preserve the original source
artifact so a transformed value can always be traced back.

Enforce gates on the server. Hiding or disabling a control in the UI is not a
gate.

## 10. Write the gaps down, dated

The most useful sections in this company's docs are the honest ones:
"What it does *not* have", "KNOWN GAP, observed 2026-09-08", "Still open",
"(1), (2) and (4) are open items, not solved problems".

Record what you observed and when, rather than what was intended. A doc
describing the intended design of something that does not work that way is
worse than no doc.

## 11. Report honestly

Distinguish `changed locally`, `committed locally`, `pushed`, `deploying`,
`deployed`, and `verified in the app`. See `deployment.md`.

Do not claim a check you did not run. Automated checks are not user acceptance:
report human testing as outstanding until the intended user has actually done
it.

## 12. QA leaves no trace

Prefix test data (`__QA `, `__qa_`) so cleanup is one `like` sweep. Write down
the IDs you created. Delete in foreign-key-safe order. **Leave the audit log
alone** — it is append-only by design, and a QA run that deletes from it has
broken the thing it was testing.
