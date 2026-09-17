// The finishes library moved INTO the project's tab bar, beside the runs.
//
// It was a screen of its own reachable only from a grey line on the Overview
// tab, which put it out of sight the moment anybody clicked a run. It is now
// `?tab=finishes` on the project screen.
//
// This route stays, redirecting, because it is what every link written before
// today points at — a record screen's finish code, a bookmark, a link in an
// email. `redirect()` from a server component issues the 307 before anything
// renders, so there is no flash of a page that has moved.
import { redirect } from "next/navigation";

export default async function FinishesRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/projects/${id}?tab=finishes`);
}
