"use client";
// ============================================================================
// WHAT A SCREEN SHOWS WHEN IT THROWS WHILE IT RENDERS (audit G4, 2026-11-06).
//
// There was no `error.tsx` anywhere under src/app, so one render-time
// TypeError took out the whole dashboard, nav bar included, and left a white
// page with nothing to press. CLAUDE.md already records the first such outage
// ("every screen reading the first version 2 run threw `Cannot read properties
// of undefined`"), and `apiFetch` passing an empty 200 on as data made the next
// one likelier.
//
// Every dashboard segment's `error.tsx` renders this, inside the shell, in the
// three bands: the header names what happened, the Note says the message and
// where, and the two ways on are one press each. Reload re-renders the
// segment through Next's `reset`, which remounts the screen and so fetches
// its data again. The way back goes to a page that does not depend on the
// data that failed.
// ============================================================================
import Link from "next/link";
import { usePathname } from "next/navigation";
import Button, { buttonClass } from "@/components/ui/Button";
import Note from "@/components/ui/Note";
import PageBody from "@/components/ui/PageBody";
import PageHeader from "@/components/ui/PageHeader";

export type ScreenErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ScreenError({
  error,
  reset,
  back,
}: ScreenErrorProps & {
  /** Somewhere to go that does not depend on what failed. */
  back: { href: string; label: string };
}) {
  const path = usePathname();
  return (
    <>
      <PageHeader title="This page could not be shown" subtitle="Nothing was saved or changed by this." />
      <PageBody>
        <Note
          tone="danger"
          title="Something on this page failed while it was being drawn."
          actions={
            <>
              <Button variant="primary" size="sm" onClick={() => reset()}>
                Reload this page
              </Button>
              <Link href={back.href} className={buttonClass("secondary", "sm", "no-underline")}>
                {back.label}
              </Link>
            </>
          }
        >
          <span className="font-mono">{error.message || "No message was given."}</span>
          {path && (
            <>
              {" "}
              at <span className="font-mono">{path}</span>
            </>
          )}
          {/* Next's own reference for the server log, where there is one. */}
          {error.digest && <span className="text-neutral-600"> · reference {error.digest}</span>}
        </Note>
      </PageBody>
    </>
  );
}
