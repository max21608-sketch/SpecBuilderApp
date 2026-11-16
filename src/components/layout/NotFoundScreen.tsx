// ============================================================================
// WHAT AN ADDRESS THAT LEADS NOWHERE SHOWS (review 3.4, 2026-11-16).
//
// There was no `not-found.tsx` anywhere under src/app, so an unknown address
// under /dashboard rendered Next's bare "404 | This page could not be found."
// with no nav bar and nothing to press. This is the same three bands as
// `ScreenError`: the header says what happened, the Note says the address,
// and the way on is a LINK, because it goes somewhere.
//
// No "use client": both not-found files render it on the server, and the way
// on depends on nothing that could have failed.
// ============================================================================
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import Note from "@/components/ui/Note";
import PageBody from "@/components/ui/PageBody";
import PageHeader from "@/components/ui/PageHeader";

export const BACK_TO_PROJECTS = { href: "/dashboard/projects", label: "Back to projects" } as const;

export default function NotFoundScreen({
  title = "There is no page at this address",
  children,
}: {
  title?: string;
  /** What was looked for, when the screen knows. */
  children?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} subtitle="Nothing was saved or changed by this." />
      <PageBody>
        <Note
          tone="warn"
          title="Nothing here."
          actions={
            <Link href={BACK_TO_PROJECTS.href} className={buttonClass("secondary", "sm", "no-underline")}>
              {BACK_TO_PROJECTS.label}
            </Link>
          }
        >
          {children ?? "The link may be out of date, or the item it pointed at may have been removed."}
        </Note>
      </PageBody>
    </>
  );
}
