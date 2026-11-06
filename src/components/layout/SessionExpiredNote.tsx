"use client";
// ============================================================================
// AN EXPIRED SESSION, SAID ONCE, WITH THE WAY BACK IN (audit G11, 2026-11-06).
//
// The middleware answers a request with no session with a 401, and every
// screen used to print the body's own words, "auth required", in its red
// banner, with nothing to press. `apiFetch` now turns any such 401 into the
// sentence and announces it on `window`; this, mounted once in the dashboard
// layout, hears it and shows the link, so every screen gets it without each
// one learning to render a sign-in link in its own banner.
//
// The link carries the page the person was on (`?from=`).
// ============================================================================
import { useEffect, useState } from "react";
import Link from "next/link";
import { SESSION_EXPIRED_EVENT } from "@/lib/api-fetch";
import Note from "@/components/ui/Note";
import { buttonClass } from "@/components/ui/Button";

export default function SessionExpiredNote() {
  const [signIn, setSignIn] = useState<string | null>(null);

  useEffect(() => {
    const heard = (event: Event) => {
      const detail = (event as CustomEvent<{ signIn?: unknown }>).detail;
      setSignIn(typeof detail?.signIn === "string" ? detail.signIn : "/login");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, heard);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, heard);
  }, []);

  if (!signIn) return null;
  return (
    <div className="mx-auto max-w-[1100px] px-5">
      <Note
        tone="warn"
        title="Your session has expired."
        actions={
          <Link href={signIn} className={buttonClass("primary", "sm", "no-underline")}>
            Sign in again
          </Link>
        }
      >
        Nothing you do on this page can be saved until you sign in. Anything not yet saved is still on screen.
      </Note>
    </div>
  );
}
