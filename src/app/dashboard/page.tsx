// The landing page a signed-in session arrives at, and — until M1 ships a real
// screen — the only one. It exists because /api/auth/login redirects here: an
// app with no page at this path answers a successful sign-in with a 404, which
// is indistinguishable from a broken sign-in at exactly the moment someone is
// trying to prove the deployment works.
//
// So it deliberately states what a deployment check needs to read: who is
// signed in, which app environment this is, and which DATABASE it is pointed
// at. The last one is the whole point — a staging build silently wired to the
// wrong database looks perfectly healthy from every other angle.
import { getSessionUser } from "@/lib/session";
import { getEnvironment } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser();
  const { appEnv, databaseEnvironment } = getEnvironment();

  return (
    <PageBody>
      <h1 className="text-xl font-semibold text-neutral-900">Project Spec Builder</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Start from Projects: import a BOQ, work through the spec table, then export it in the BWS layout.
      </p>

      <dl className="mt-8 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white text-sm">
        {[
          ["Signed in as", user ? `${user.name} <${user.email}>` : "nobody"],
          ["Role", user?.role ?? "—"],
          ["App environment", appEnv],
          ["Database", databaseEnvironment],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-4 px-4 py-3">
            <dt className="w-40 shrink-0 text-neutral-500">{label}</dt>
            <dd className="font-medium text-neutral-900">{value}</dd>
          </div>
        ))}
      </dl>
    </PageBody>
  );
}
