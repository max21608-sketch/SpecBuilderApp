// Password hashing/verification — needs node:crypto's scrypt, so this file
// must only be imported from Node-runtime code (route handlers), never from
// middleware.ts (Edge runtime). Session JWT handling lives in auth.ts.
import { scrypt as _scrypt, timingSafeEqual, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "./db";
import type { SessionUser } from "./auth";

const scrypt = promisify(_scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 32;

// stored format: "scrypt$<saltHex>$<hashHex>" (see tools/hash-password.mjs)
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = await scrypt(password, Buffer.from(saltHex, "hex"), KEYLEN);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  active: boolean;
};

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const rows = (await sql`
    select id, email, name, role, password_hash, active
    from users where lower(email) = lower(${email})
  `) as UserRow[];
  const user = rows[0];
  if (!user || !user.active) return null;
  if (!(await verifyScrypt(password, user.password_hash))) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
