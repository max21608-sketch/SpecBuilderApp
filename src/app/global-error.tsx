"use client";
// ============================================================================
// THE LAST BOUNDARY (review 3.4, 2026-11-16).
//
// `dashboard/error.tsx` covers the screens beneath the dashboard layout, not
// the layout itself: a throw in `NavShell` or the root layout was a white
// page. This file REPLACES the root layout when it renders, so it carries its
// own <html> and <body>, and it imports nothing that could be what failed —
// no primitives, no nav, no data; only Next's own Link and the stylesheet.
// The look is `ScreenError`'s: what happened, the message, a way to try again
// and a link out.
// ============================================================================
import Link from "next/link";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="border-b border-neutral-200 bg-white py-4">
          <div className="mx-auto max-w-[1100px] px-5">
            <h1 className="text-xl font-semibold text-neutral-900">This page could not be shown</h1>
            <p className="mt-1 text-sm text-neutral-500">Nothing was saved or changed by this.</p>
          </div>
        </div>
        <div className="mx-auto max-w-[1100px] px-5 py-6">
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-red-900"
          >
            <div className="min-w-0 flex-1">
              <b className="font-semibold">Something failed while the app itself was being drawn.</b>{" "}
              <span className="font-mono">{error.message || "No message was given."}</span>
              {error.digest && <span className="text-neutral-600"> · reference {error.digest}</span>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => reset()}
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800"
              >
                Reload this page
              </button>
              <Link
                href="/dashboard/projects"
                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 no-underline hover:bg-neutral-50"
              >
                Back to projects
              </Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
