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
// the database is reported as a sentence rather than as an empty 500. The
// detail is appended on non-production builds only. A driver failure's message
// can name a host; it does not carry the credential, and the alternative is the
// blank page that sent somebody to look at a database string while the database
// was fine.
//
// NOTHING HERE CHANGES WHAT A WRONG PASSWORD ANSWERS. A 401 with "incorrect
// email or password" is still the only thing a failed sign-in says, and the
// 503s below are reachable only when the deployment itself cannot serve.
import { z } from "zod";
import { json } from "@/lib/db";
import { makeSessionToken } from "@/lib/auth";
import { verifyCredentials } from "@/lib/auth-node";
import { setSessionCookie } from "@/lib/session";
import { currentAppEnvIsProduction, environmentProblemMessage } from "@/lib/env";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** A failure reaching the database, in words, without pretending to know which. */
function unreachable(cause: unknown): Response {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const sentence =
    "Signing in could not reach the database. This is the deployment, not your password — " +
    "check DATABASE_URL and DATABASE_ENVIRONMENT on this project.";
  return json(
    {
      ok: false,
      code: "database_unreachable",
      error: currentAppEnvIsProduction() ? sentence : `${sentence} (${detail})`,
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

  let user: Awaited<ReturnType<typeof verifyCredentials>>;
  try {
    user = await verifyCredentials(parsed.data.email, parsed.data.password);
  } catch (cause) {
    return unreachable(cause);
  }
  if (!user) return json({ ok: false, error: "incorrect email or password" }, 401);

  const token = await makeSessionToken(user);
  await setSessionCookie(token);
  return json({ ok: true, user });
}
