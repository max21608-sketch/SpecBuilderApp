#!/usr/bin/env node
// Creates or updates a login in the `users` table. Hashes the password and
// upserts by email.
//   node --env-file=.env.local tools/create-user.mjs <email> <name> <role> <password>
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
// WRITER_ROLES in src/middleware.ts. All three are checked by
// tests/db/foundation.test.ts.
const ROLES = ["admin", "editor", "viewer"];

const [, , email, name, role, password] = process.argv;
if (!email || !name || !role || !password) {
  console.error("Usage: node --env-file=.env.local tools/create-user.mjs <email> <name> <role> <password>");
  console.error(`  role: ${ROLES.join(" | ")}`);
  process.exit(1);
}
// role gates every write in src/middleware.ts. An unrecognised value used to
// be accepted verbatim, so "Viewer" created an account the viewer check missed
// -- a typo in this one argument granted full mutation rights.
if (!ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${ROLES.join(", ")} (lower-case).`);
  process.exit(1);
}

const { databaseUrl } = requireScriptEnvironment("create-user.mjs");

const salt = randomBytes(16);
const hash = await scrypt(password, salt, 32);
const passwordHash = `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const { rows } = await client.query(
    `insert into users (email, name, role, password_hash)
     values ($1, $2, $3, $4)
     on conflict (email) do update set
       name = excluded.name, role = excluded.role, password_hash = excluded.password_hash
     returning id, email, name, role`,
    [email, name, role, passwordHash],
  );
  console.log("User upserted:", rows[0]);
} finally {
  await client.end();
}
