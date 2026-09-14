// Chase emails are HIDDEN for now, not deleted.
//
// The build refocused on the intake stage — getting a tender pack in, staged,
// reviewed and exported — and chasing what is missing is the stage after it.
// Everything that made M4 work is still here and still tested: the routes under
// src/app/api/drafts/, chase-drafts.ts, chase-template.ts, eml.ts and their
// suites. Deleting them would have thrown away a feature that was finished but
// never accepted by anybody; this screen just stops being a way in.
//
// To bring it back: restore this file from git history (it is one component),
// put the entry points back on the projects list and the project overview, and
// re-add the Waiting column to the spec table, which reads its count from the
// derivation removed in src/app/api/records/route.ts.
import { redirect } from "next/navigation";

export default function DraftsPage() {
  redirect("/dashboard/projects");
}
