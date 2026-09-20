import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { getEnvironment } from "@/lib/env";

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  const environment = getEnvironment();
  // WHICH COMMIT IS RUNNING. house/deployment.md: a deployment exists "for
  // that exact commit SHA — confirmed, not assumed", and nothing served by the
  // app said which one it was built from. Vercel sets this at build time;
  // locally it is null, which is the honest answer rather than HEAD.
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  return json(user ? { authed: true, user, environment, commit } : { authed: false, environment, commit });
}
