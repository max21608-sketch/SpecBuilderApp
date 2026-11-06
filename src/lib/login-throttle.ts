// ============================================================================
// A LIMIT ON GUESSING PASSWORDS (audit A11, 2026-11-06).
//
// `/api/auth/login` is the one write anybody can reach without a session, and
// nothing limited it. This counts failed sign-ins per EMAIL and per CLIENT
// ADDRESS; ten failures inside fifteen minutes lock that key for sixty seconds,
// and the route answers 429 with the wait in words and in `Retry-After`.
//
// WHAT IT IS, PLAINLY. The counts live in this instance's memory. Vercel runs
// several instances and starts new ones at will, so a determined attacker
// spread across instances, or arriving after a cold start, gets more than ten
// guesses a minute. What it does stop is the cheap case: one script hammering
// one account or from one address, which on a warm instance lands on the same
// counters. It needs no table and no migration, and it fails toward letting a
// person in: a lost counter is a forgotten failure, never a locked-out user.
// A durable limit would be a table keyed the same way, and is the next step if
// the logs ever show spread-out guessing.
//
// The email key is folded to lower case, as `verifyCredentials` matches it.
// The address is the first `x-forwarded-for` hop, which Vercel's edge sets and
// overwrites; it is never trusted for anything but this count.
//
// The maps are BOUNDED: past `maxKeys` the oldest key is dropped, so a flood
// of invented emails cannot grow an instance's memory without limit.
// ============================================================================

type Entry = { failures: number; firstAt: number; lockedUntil: number };

export type LoginKeys = { email: string; ip: string | null };
export type ThrottleVerdict = { locked: false } | { locked: true; retryAfterSeconds: number };

export function createLoginThrottle(
  options: { now?: () => number; maxFailures?: number; lockMs?: number; windowMs?: number; maxKeys?: number } = {},
) {
  const now = options.now ?? Date.now;
  const maxFailures = options.maxFailures ?? 10;
  const lockMs = options.lockMs ?? 60_000;
  const windowMs = options.windowMs ?? 15 * 60_000;
  const maxKeys = options.maxKeys ?? 10_000;
  const entries = new Map<string, Entry>();

  const keysOf = ({ email, ip }: LoginKeys) => [`email:${email.trim().toLowerCase()}`, ...(ip ? [`ip:${ip}`] : [])];

  function check(keys: LoginKeys): ThrottleVerdict {
    const at = now();
    let until = 0;
    for (const key of keysOf(keys)) until = Math.max(until, entries.get(key)?.lockedUntil ?? 0);
    return until > at ? { locked: true, retryAfterSeconds: Math.ceil((until - at) / 1000) } : { locked: false };
  }

  function fail(keys: LoginKeys): void {
    const at = now();
    for (const key of keysOf(keys)) {
      const current = entries.get(key);
      const fresh = !current || at - current.firstAt > windowMs;
      const entry: Entry = fresh ? { failures: 0, firstAt: at, lockedUntil: 0 } : current;
      entry.failures += 1;
      if (entry.failures >= maxFailures) {
        entry.lockedUntil = at + lockMs;
        entry.failures = 0;
        entry.firstAt = at;
      }
      // Re-inserted so the Map's order is last-touched, and the oldest is first out.
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxKeys) entries.delete(entries.keys().next().value as string);
    }
  }

  /** A right password clears the EMAIL's count. The address keeps its own, so one good account cannot launder a guessing run. */
  function succeed(keys: LoginKeys): void {
    entries.delete(keysOf(keys)[0]!);
  }

  return { check, fail, succeed, size: () => entries.size };
}

/** The instance's one throttle. */
export const loginThrottle = createLoginThrottle();

/** The client address a request came from, as Vercel's edge reports it. */
export function clientAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}
