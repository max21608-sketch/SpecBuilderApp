// The landing page a signed-in session arrives at. It exists because
// /api/auth/login redirects here: an app with no page at this path answers a
// successful sign-in with a 404, which is indistinguishable from a broken
// sign-in at exactly the moment somebody is trying to prove the deployment
// works.
//
// IT IS NOW A REDIRECT, and the thing it used to do has a better home. It
// printed who was signed in, which app environment this is and which DATABASE
// it is pointed at — the last being the whole point, because a staging build
// silently wired to the wrong database looks healthy from every other angle.
// All three are what `/api/auth/me` returns, which is where the environment
// chip in the top bar reads them from, so the check is on every page instead of
// on one nobody visits. A landing page whose only content is a deployment check
// is a screen people bounce off on the way to Projects.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  redirect("/dashboard/projects");
}
