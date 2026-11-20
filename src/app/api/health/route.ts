// GET /api/health — is this deployment up, can it reach its database, and
// which commit is it (production hardening H4, 2026-11-20).
//
// PUBLIC, deliberately, and anchored in the middleware's matcher
// (`api/health$`), so an uptime monitor and a person confirming a promotion
// can ask without signing in. Until this route the only thing that named the
// commit was `/api/auth/me`, behind a session: "is the deployment of this SHA
// live" could not be answered from outside.
//
// IT SAYS FOUR THINGS AND NOTHING ELSE, because anybody can read it:
//   200 {"ok":true,"commit":"<VERCEL_GIT_COMMIT_SHA or null>"}
//   503 {"ok":false,"problem":"environment_misconfigured"}     APP_ENV / DATABASE_ENVIRONMENT
//   503 {"ok":false,"problem":"session_secret_misconfigured"}  AUTH_SECRET
//   503 {"ok":false}                                           the database did not answer
// No environment name, no database host, no error text, no variable's value
// or length — the log holds the cause under a reference (`reportFailure`),
// and `/api/auth/me` still answers "which environment" for somebody signed
// in. `Cache-Control: no-store`, so neither a browser nor a CDN answers for a
// database that has since gone.
//
// THE DEPLOYMENT'S OWN COMPLAINT FIRST (pre-push review E3, 2026-11-20). The
// middleware answers every other request 503 `environment_misconfigured`
// when `src/lib/env.ts` has a complaint, and skips this route; asking only
// `select 1`, health said 200 {"ok":true} on a production build with no
// usable AUTH_SECRET, which nobody could sign in to — and that 200 is the
// go-live proof `docs/environments.md` names. So it asks the same question
// before the database, and answers the CODE (`environmentProblemCode`): the
// sentence the middleware prints is for a person at the page, and the detail
// names variables, which this route never does.
//
// `select 1` with a timeout: a database that does not answer within it is
// down for this purpose, and the request is never held for the function's
// whole life. The timeout allows for a Neon compute waking from scale-to-zero,
// which takes a second or two; an uptime monitor polling this keeps the
// compute awake, which is a cost to decide on, not a reason to lie.
import { sql } from "@/lib/db";
import { environmentProblemCode, type EnvironmentProblemCode } from "@/lib/env";
import { reportFailure } from "@/lib/error-detail";

export const dynamic = "force-dynamic";

/** How long `select 1` may take before the database counts as not answering. */
const HEALTH_TIMEOUT_MS = 5_000;

type HealthBody = { ok: true; commit: string | null } | { ok: false; problem?: EnvironmentProblemCode };

function answer(body: HealthBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function databaseAnswers(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`select 1 did not answer within ${HEALTH_TIMEOUT_MS} ms`)),
      HEALTH_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([sql`select 1`, timeout]);
    return true;
  } catch (cause) {
    reportFailure("health", cause);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const problem = environmentProblemCode();
  if (problem) return answer({ ok: false, problem }, 503);
  if (!(await databaseAnswers())) return answer({ ok: false }, 503);
  return answer({ ok: true, commit: process.env.VERCEL_GIT_COMMIT_SHA || null }, 200);
}
