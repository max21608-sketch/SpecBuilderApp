// Signing in.
//
// THE ONE ROUTE MIDDLEWARE CANNOT COVER, and therefore the one that has to
// answer for itself. `/api/auth/login` is excluded from the matcher on purpose
// — protecting the way in locks everybody out — so the environment guard that
// now runs in middleware never sees this request. On a fresh deployment this is
// also the FIRST thing that touches `db.ts`, which is why a misconfigured pilot
// build (2026-09-19) rendered its whole signed-out surface correctly and then
// answered a deliberately wrong password with a bodyless 500.
//
// So: the pair is checked here too, and anything else that goes wrong reaching
// the database is reported as a sentence rather than as an empty 500, with a
// reference the log holds the cause under. The driver's own text is appended
// ONLY on a developer's deployment (audit A12): it used to be appended on
// everything but production, and pilot holds real data while a driver message
// can name a host.
//
// NOTHING HERE CHANGES WHAT A WRONG PASSWORD ANSWERS. A 401 with "incorrect
// email or password" is still the only thing a failed sign-in says, and the
// 503s below are reachable only when the deployment itself cannot serve.
//
// TEN WRONG PASSWORDS LOCK THE EMAIL, OR THE ADDRESS, FOR A MINUTE (audit
// A11): a 429 with the wait in words and in Retry-After, checked BEFORE the
// password, so a locked account answers the same whether the guess was right.
// `login-throttle.ts` says plainly what an in-memory count does and does not
// stop. And `verifyCredentials` runs scrypt for every request, so the time a
// refusal takes no longer says whether the account exists.
import { z } from "zod";
import { json } from "@/lib/db";
import { makeSessionToken } from "@/lib/auth";
import { verifyCredentials } from "@/lib/auth-node";
import { setSessionCookie } from "@/lib/session";
import { environmentProblemMessage } from "@/lib/env";
import { explainFailure } from "@/lib/error-detail";
import { clientAddress, loginThrottle } from "@/lib/login-throttle";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** A failure reaching the database, in words, without pretending to know which. */
function unreachable(cause: unknown): Response {
  const sentence =
    "Signing in could not reach the database. This is the deployment, not your password — " +
    "check DATABASE_URL and DATABASE_ENVIRONMENT on this project.";
  // Every cause here is the database's, never a sentence this app wrote.
  return json(
    {
      ok: false,
      code: "database_unreachable",
      error: explainFailure(sentence, cause, "login", { ownMessages: false }),
    },
    503,
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "email and password required" }, 400);

  const misconfigured = environmentProblemMessage();
  if (misconfigured) return json({ ok: false, code: "environment_misconfigured", error: misconfigured }, 503);

  const keys = { email: parsed.data.email, ip: clientAddress(req) };
  const verdict = loginThrottle.check(keys);
  if (verdict.locked) {
    const response = json(
      {
        ok: false,
        code: "too_many_attempts",
        error: `Too many sign-in attempts. Wait ${verdict.retryAfterSeconds} seconds and try again.`,
      },
      429,
    );
    response.headers.set("retry-after", String(verdict.retryAfterSeconds));
    return response;
  }

  let user: Awaited<ReturnType<typeof verifyCredentials>>;
  try {
    user = await verifyCredentials(parsed.data.email, parsed.data.password);
  } catch (cause) {
    return unreachable(cause);
  }
  if (!user) {
    loginThrottle.fail(keys);
    return json({ ok: false, error: "incorrect email or password" }, 401);
  }
  loginThrottle.succeed(keys);

  const token = await makeSessionToken(user);
  await setSessionCookie(token);
  // The token version is the session's own bookkeeping, not the screen's.
  return json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}
