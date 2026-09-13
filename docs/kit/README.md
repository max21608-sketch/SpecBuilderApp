# The app kit, folded in

**Decided 2026-09-13.** This app no longer works out of a sibling `bw-app-kit`
repository. Everything is here.

## What the kit was

`bw-app-kit` was the shared starting point for Ben Whistler's internal
applications: company standards, per-app document templates, agent skills, and
a de-domained chassis of real source files. This app was forked from it on
2026-09-12 — the first, and so far only, app built that way.

## Why it is folded in

Two folders for one piece of work was a running source of confusion about which
one to open, and it bought nothing: **this app already contained everything the
kit had.** Verified file by file on 2026-09-13 —

| Kit folder | Where it already was |
|---|---|
| `house/` | `house/`, byte-identical |
| `skills/` | `.claude/skills/`, mirrored to `.agents/skills/` |
| `chassis/` | the real `src/`, `db/` and config files |
| `templates/` | filled in as `CLAUDE.md`, `docs/`, `db/README.md`, `.env.example` |

Only four kit-only files existed nowhere in the app. They are the four in this
directory.

The kit was also fragile in a way that made keeping it unattractive: **no git
remote, four commits, living in one iCloud folder on one machine.** Noted at
the time in `docs/plans/part-2/scaffold-plan.md`; never fixed.

## What is in here

| File | What it is |
|---|---|
| `PROVENANCE.md` | Which `autofab` file each chassis file came from, and what changed. Still the answer to "why is this written this way?" |
| `CHANGELOG.md` | The kit's dated decision log, continued here. Fixes that would once have been ported upstream are now recorded as entries. |
| `package.json.template` | The dependency set a new app starts from |
| `start-new-app/SKILL.md` | The procedure for scaffolding a new app. Deliberately never carried into an app's own `.claude/skills/`, because it is about creating an app, not working in one. |

## What this costs

A third Ben Whistler app can no longer fork a clean, de-domained kit. It would
fork **this** app and strip the Spec Builder domain out, or lift from the
sibling folder if it still exists.

That trade was made deliberately, with one app in existence and a second only
hypothetical. If a third app does start, read `CHANGELOG.md` here first: it
records what was learned that a fresh fork would otherwise rediscover.

The `bw-app-kit` folder has been left in place rather than deleted. It is no
longer worked in and will go stale.
