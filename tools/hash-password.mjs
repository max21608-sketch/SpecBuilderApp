#!/usr/bin/env node
// Print a scrypt password hash in the "scrypt$<saltHex>$<hashHex>" format
// used by the `users.password_hash` column, plus a fresh AUTH_SECRET.
// Usage:  node tools/hash-password.mjs '<password>'
import { scrypt as _scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(_scrypt);

const password = process.argv[2];
if (!password) {
  console.error("Usage: node tools/hash-password.mjs '<password>'");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = await scrypt(password, salt, 32);
console.log("password_hash: scrypt$" + salt.toString("hex") + "$" + hash.toString("hex"));
console.log("AUTH_SECRET=" + randomBytes(32).toString("hex"));
console.log("\nUse the password_hash value with tools/create-user.mjs, or set AUTH_SECRET in .env.local.");
