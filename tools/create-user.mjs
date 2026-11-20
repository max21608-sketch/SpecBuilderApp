#!/usr/bin/env node
// Creates or updates a login in the `users` table, or switches one off.
//
//   Create, or reset a password / change a role (the password from the
//   environment, so it is in neither the shell history nor `ps`):
//     read -rs NEW_USER_PASSWORD && export NEW_USER_PASSWORD
//     node --env-file=.env.local tools/create-user.mjs <email> <name> <role> [--activate]
//
//   The same with the password as an argument — still works, and warns,
//   because it lands in the shell history and is visible in `ps` while it runs:
//     node --env-file=.env.local tools/create-user.mjs <email> <name> <role> <password> [--activate]
//
//   Switch an account off, ending every session it holds:
//     node --env-file=.env.local tools/create-user.mjs --deactivate <email>
//
//   Add --yes-pilot or --yes-production for those databases, as every script
//   that writes asks (db/script-env.mjs).
//
// A password is at least 12 characters (production hardening H5, 2026-11-20).
//
// RE-RUNNING THIS FOR A DEACTIVATED ACCOUNT IS REFUSED unless --activate is
// given. The upsert never touched `active`, so a re-run reset the password of
// an account that still could not sign in and said "User upserted" — and the
// obvious "fix", setting active on every upsert, would switch somebody back on
// who was switched off on purpose, by a command typed to change their name.
// Switching an account back on is its own decision, so it is its own flag.
//
// Uses `pg` and requireScriptEnvironment, like every other script that touches
// the database -- NOT the Neon HTTP driver. This matters: the HTTP driver
// skips the preflight, so this script would print no target host and accept no
// --yes-production guard. It creates ADMIN accounts; it is the last script
// that should be able to hit production silently.
import { scrypt as _scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { requireScriptEnvironment } from "../db/script-env.mjs";

const scrypt = promisify(_scrypt);

// Must match users_role_check in db/migrations/0001_foundation.sql and
// WRITER_ROLES in src/lib/roles.ts. All three are checked by
// tests/db/foundation.test.ts.
//
// RE-RUNNING THIS FOR AN EXISTING EMAIL ENDS THEIR SESSIONS (0053): it is how
// a password is reset and a role changed, and a reset that left a stolen
// cookie working would not be a reset. The token version moves on, and every
// session the user holds is refused at its next request. --deactivate moves
// it on too, which is what makes switching somebody off take effect at their
// next request rather than when their cookie runs out.
const ROLES = ["admin", "editor", "viewer"];

const MIN_PASSWORD_LENGTH = 12;

// Only these are flags; anything else is positional, so a --yes-pilot typed
// after the role is never read as the password.
const FLAGS = new Set(["--yes-production", "--yes-pilot", "--activate", "--deactivate"]);

const USAGE = [
  "read -rs NEW_USER_PASSWORD && export NEW_USER_PASSWORD",
  "node --env-file=.env.local tools/create-user.mjs <email> <name> <role> [--activate]",
  "node --env-file=.env.local tools/create-user.mjs --deactivate <email>",
  `role: ${ROLES.join(" | ")}; add --yes-pilot or --yes-production for those databases`,
];

function fail(lines) {
  for (const line of [].concat(lines)) console.error(line);
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => FLAGS.has(arg)));
const positional = args.filter((arg) => !FLAGS.has(arg));

if (flags.has("--deactivate")) {
  if (flags.has("--activate")) fail("--activate and --deactivate contradict each other. Give one.");
  if (positional.length !== 1) fail(["Usage:", ...USAGE.map((line) => `  ${line}`)]);
  await deactivate(positional[0]);
} else {
  await upsert(positional);
}

async function connect() {
  const { databaseUrl } = requireScriptEnvironment("create-user.mjs", USAGE);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function deactivate(email) {
  const client = await connect();
  try {
    const { rows } = await client.query(
      `update users set active = false, token_version = token_version + 1
       where email = $1
       returning id, email, name, role, active`,
      [email],
    );
    if (!rows[0]) fail(`No account has the email ${email}. Nothing was changed.`);
    console.log("User deactivated, and every session it held is ended:", rows[0]);
  } finally {
    await client.end();
  }
}

async function upsert([email, name, role, argvPassword, ...extra]) {
  if (!email || !name || !role || extra.length > 0) fail(["Usage:", ...USAGE.map((line) => `  ${line}`)]);
  // role gates every write in src/middleware.ts. An unrecognised value used to
  // be accepted verbatim, so "Viewer" created an account the viewer check missed
  // -- a typo in this one argument granted full mutation rights.
  if (!ROLES.includes(role)) fail(`Invalid role "${role}". Must be one of: ${ROLES.join(", ")} (lower-case).`);

  let password = argvPassword;
  if (password === undefined) {
    password = process.env.NEW_USER_PASSWORD;
    if (!password) {
      fail([
        "No password: set NEW_USER_PASSWORD (it stays out of the shell history and `ps`), or give it as the fourth argument.",
        "Usage:",
        ...USAGE.map((line) => `  ${line}`),
      ]);
    }
  } else {
    console.error(
      "Warning: a password given as an argument is in your shell history, and visible in `ps` while this runs. Prefer NEW_USER_PASSWORD.",
    );
  }
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    fail(`The password is shorter than ${MIN_PASSWORD_LENGTH} characters. Nothing was changed.`);
  }

  const client = await connect();
  try {
    await client.query("begin");
    const existing = await client.query(`select active from users where email = $1 for update`, [email]);
    if (existing.rows[0] && existing.rows[0].active === false && !flags.has("--activate")) {
      await client.query("rollback");
      fail([
        `${email} is deactivated. Re-running create-user does not switch an account back on, so nothing was changed.`,
        "To switch it back on deliberately, run the same command again with --activate.",
      ]);
    }

    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 32);
    const passwordHash = `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;

    const { rows } = await client.query(
      `insert into users (email, name, role, password_hash)
       values ($1, $2, $3, $4)
       on conflict (email) do update set
         name = excluded.name, role = excluded.role, password_hash = excluded.password_hash,
         active = users.active or $5,
         token_version = users.token_version + 1
       returning id, email, name, role, active`,
      [email, name, role, passwordHash, flags.has("--activate")],
    );
    await client.query("commit");
    console.log("User upserted:", rows[0]);
  } catch (cause) {
    await client.query("rollback").catch(() => {});
    throw cause;
  } finally {
    await client.end();
  }
}
