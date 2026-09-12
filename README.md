# Project Spec Builder

A structured, auditable record of what a piece of furniture is actually
specified to be — held from tender/BOQ stage through to delivery, in one place,
instead of being retyped between a BOQ, a costing sheet, a Word document, a BWS
quote freetext field and the BWS job spec fields. It is for the KAM and
sales-support people who currently carry that reconciliation in their heads.

Built by Ben Whistler Ltd. Internal. Contains NDA-covered client material.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run db:migrate
npm run db:seed        # no seeds until M1
npm run create-user -- you@benwhistler.com "Your Name" admin '<password>'
npm run dev
```

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Database-tier tests skip silently without `DATABASE_URL`. A green run does not
mean they ran.

## Documentation

| Document | For |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | How to work in this repo. Start here. |
| `house/` | Company-wide standards (conventions, deployment, data safety) |
| `docs/stack.md` | What runs where, and what this app deliberately lacks |
| `docs/environments.md` | Sandbox/staging vs production |
| `docs/recovery.md` | When something is broken |
| `db/README.md` | Migrations, seeds, backups, restores |

| `docs/integration.md` | External integrations: scope, setup, activation |
| `docs/plans/README.md` | Releases, dated decisions, what is still open |

Started from `bw-app-kit`. Fixes that belong upstream get ported back
deliberately — this is a fork point, not a dependency.
