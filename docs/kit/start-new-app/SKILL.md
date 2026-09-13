---
name: start-new-app
description: Scaffold a new Ben Whistler app from bw-app-kit, through to a signed-in staging deployment.
---

# Starting a new app from the kit

## 1. Repo and chassis

```bash
mkdir <app> && cd <app> && git init -b staging
cp -R <kit>/chassis/. .
mv package.json.template package.json
cp -R <kit>/house .
```

The initial branch is the deploy branch, not `main`. Vercel will not offer a
branch as its Production Branch until that branch exists on the remote, and an
app with no `main` should not pretend to have one.

Then, before anything is committed, add this app's real client data patterns to
`.gitignore` and prove they took:

```bash
git check-ignore -v .env.vercel-staging '<a real client filename>'
```

**Append after copying the chassis, never before.** The chassis ships its own
`.gitignore`, so `cp -R <kit>/chassis/.` overwrites anything written first —
silently, and `git status` will not mention it. On the first real fork that
reverted three lines and left a file of staging secrets
untracked-but-committable. `git check-ignore` caught it; reading the file would
not have.

NDA material in git history is forever, and a private repo does not change
that.

## 2. Replace every placeholder

```bash
grep -rn "CUSTOMIZE" --exclude-dir=node_modules .
```

At minimum:
- `CUSTOMIZE_APP_NAME`, `CUSTOMIZE_APP_SLUG`, `CUSTOMIZE_APP_DESCRIPTION`
- `SESSION_COOKIE` in `src/lib/auth.ts` — **must differ from every other Ben
  Whistler app.** Two apps on a shared parent domain otherwise read and write
  the same cookie, and whichever signed in last wins in both.
- `WRITER_ROLES` in `src/middleware.ts` and the `users_role_check` constraint
  in `0001_foundation.sql` — they must agree.
- The `NAV` list in `NavShell.tsx`.

## 3. Docs

Fill `templates/` into `CLAUDE.md` and `AGENTS.md` (byte-identical — finish
with `cmp -s CLAUDE.md AGENTS.md`), `docs/`, `db/README.md`, `.env.example`,
`README.md`. Add `.codex/config.toml` and `.claude/launch.json`.

Do not restate `house/` content in `CLAUDE.md`. Point at it.

## 4. Skills

```bash
cp -R <kit>/skills .claude/skills
cp -R <kit>/skills .agents/skills
```

Keep the two copies identical.

## 5. Infrastructure

Someone with the accounts must create these — they cannot be scripted from
here:

- Neon project, **region-pinned to UK/EU** (NDA client data), sandbox branch.
- Vercel project. Set **Production Branch to `staging`** — but note the
  dropdown is empty until the branch exists on the remote, so this happens
  after the first push, not before. Vercel's "production deployment" is a
  deployment class, not your environment: it decides which branch claims the
  stable alias and receives the project's environment variables. Left at
  `main`, every push takes the Preview path — a new hostname per deploy so
  session cookies do not carry, no project environment variables so the app
  throws on a missing `APP_ENV`, and Vercel Authentication in front of the URL
  that reads as your own sign-in being broken.
- Pin the hosting region near the database. `chassis/vercel.json` declares
  `lhr1`; change it there, not in the dashboard.
- Blob store.

Then locally: `npm install`, fill `.env.local`, `npm run db:migrate`,
`npm run create-user`.

## 6. Verify before building anything

- `npm run lint && npm run typecheck && npm test && npm run build`
- `npm run db:migrate` twice — the second run must apply nothing.
- Sign in locally.
- Push `staging`, confirm the deployment matches the SHA, sign in there.
- Confirm the banner, the `[STAGING]` title, and that `/api/auth/me` reports
  the sandbox database.
- Confirm a signed-out request to a protected route redirects, and a write as
  the read-only role returns 403.

Prove the deploy path before a feature depends on it. On the fabric app the
`staging` branch turned out not to feed the staging URL at all — pushes
produced Preview deployments on a different hostname, so session cookies did
not carry. That was found late.

## 7. Production

Not now. Not without explicit authorization.
