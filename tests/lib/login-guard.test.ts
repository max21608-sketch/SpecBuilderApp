// Signing in says nothing about which accounts exist, and cannot be hammered
// (audit A11, 2026-11-06).
//
// `verifyCredentials` returned BEFORE scrypt for an unknown or inactive email,
// so a wrong password on a real account took tens of milliseconds longer than
// one on an invented address: timing named the accounts. And nothing limited
// the one public write in the app.
import { beforeEach, describe, expect, it, vi } from "vitest";

const scryptCalls = vi.hoisted(() => ({ count: 0 }));
const users = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const scrypt = ((...args: Parameters<typeof actual.scrypt>) => {
    scryptCalls.count += 1;
    return (actual.scrypt as (...a: unknown[]) => void)(...args);
  }) as typeof actual.scrypt;
  return { ...actual, default: { ...actual, scrypt }, scrypt };
});

vi.mock("@/lib/db", () => ({ sql: async () => users.rows }));

const { hashPassword, verifyCredentials } = await import("@/lib/auth-node");
const { createLoginThrottle } = await import("@/lib/login-throttle");

beforeEach(() => {
  scryptCalls.count = 0;
  users.rows = [];
});

describe("verifyCredentials", () => {
  it("runs scrypt for an unknown email, exactly as for a real one", async () => {
    expect(await verifyCredentials("nobody@example.test", "guess")).toBeNull();
    expect(scryptCalls.count).toBe(1);
  });

  it("runs scrypt for an inactive account, and for a hash it cannot read", async () => {
    const stored = await hashPassword("right");
    scryptCalls.count = 0;
    users.rows = [{ id: "u", email: "a@example.test", name: "A", role: "editor", password_hash: stored, active: false }];
    expect(await verifyCredentials("a@example.test", "right")).toBeNull();
    users.rows = [{ id: "u", email: "a@example.test", name: "A", role: "editor", password_hash: "garbage", active: true }];
    expect(await verifyCredentials("a@example.test", "right")).toBeNull();
    expect(scryptCalls.count).toBe(2);
  });

  it("still signs in the right password", async () => {
    const stored = await hashPassword("right");
    users.rows = [{ id: "u", email: "a@example.test", name: "A", role: "editor", password_hash: stored, active: true }];
    expect(await verifyCredentials("a@example.test", "right")).toEqual({
      id: "u",
      email: "a@example.test",
      name: "A",
      role: "editor",
    });
  });
});

describe("the login throttle", () => {
  function throttle() {
    let now = 1_000_000;
    const t = createLoginThrottle({ now: () => now });
    return { t, advance: (ms: number) => (now += ms) };
  }
  const keys = { email: "A@Example.test", ip: "203.0.113.9" };

  it("locks an email for 60 s after 10 failures, and says how long", () => {
    const { t, advance } = throttle();
    for (let i = 0; i < 9; i += 1) t.fail(keys);
    expect(t.check(keys)).toEqual({ locked: false });
    t.fail(keys);
    expect(t.check(keys)).toEqual({ locked: true, retryAfterSeconds: 60 });
    // The same email from another address is still locked: the email is the key.
    expect(t.check({ email: "a@example.test", ip: "198.51.100.1" }).locked).toBe(true);
    advance(30_000);
    expect(t.check(keys)).toEqual({ locked: true, retryAfterSeconds: 30 });
    advance(30_001);
    expect(t.check(keys)).toEqual({ locked: false });
  });

  it("locks an address that tries many emails", () => {
    const { t } = throttle();
    for (let i = 0; i < 10; i += 1) t.fail({ email: `n${i}@example.test`, ip: "203.0.113.9" });
    expect(t.check({ email: "fresh@example.test", ip: "203.0.113.9" }).locked).toBe(true);
    expect(t.check({ email: "fresh@example.test", ip: "198.51.100.1" }).locked).toBe(false);
  });

  it("forgets an EMAIL's failures on a successful sign-in, and not the address's", () => {
    const { t } = throttle();
    for (let i = 0; i < 9; i += 1) t.fail(keys);
    t.succeed(keys);
    t.fail(keys);
    // The email starts again from one failure...
    expect(t.check({ email: keys.email, ip: "198.51.100.1" }).locked).toBe(false);
    // ...and the address has made ten, so one good account cannot launder a run.
    expect(t.check(keys).locked).toBe(true);
  });

  it("lets old failures lapse rather than accumulating for ever", () => {
    const { t, advance } = throttle();
    for (let i = 0; i < 9; i += 1) t.fail(keys);
    advance(16 * 60_000);
    t.fail(keys);
    expect(t.check(keys).locked).toBe(false);
  });

  it("holds a bounded number of keys, so a flood cannot exhaust an instance", () => {
    const { t } = throttle();
    for (let i = 0; i < 25_000; i += 1) t.fail({ email: `n${i}@example.test`, ip: `10.0.${i >> 8}.${i & 255}` });
    expect(t.size()).toBeLessThanOrEqual(10_000);
  });
});
