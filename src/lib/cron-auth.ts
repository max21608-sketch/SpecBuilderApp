// ============================================================================
// THE CRON ROUTES' ONE CHECK (audit A14, 2026-11-06).
//
// Vercel Cron calls these with `Authorization: Bearer <CRON_SECRET>`, and the
// middleware lets them through without a session, so this comparison is the
// whole of their authentication. It was `===` in three places: a string
// comparison returns at the first byte that differs, and the time it takes
// says how much of a guess was right. `timingSafeEqual` takes the same time
// for every guess of the right length.
//
// It FAILS CLOSED: an unset or empty secret refuses everything, so a
// deployment that forgot the variable cannot be driven by `Bearer ` (or by
// `Bearer undefined`, which a template string would have produced). A guess of
// the wrong length is refused before the comparison, which says only that the
// length is wrong; the secret is long and random, so its length is no secret
// worth keeping.
// ============================================================================
import { timingSafeEqual } from "node:crypto";

export function cronAuthorised(request: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const given = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
