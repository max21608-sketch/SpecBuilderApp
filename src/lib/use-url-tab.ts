"use client";

// Which tab is open, kept in the URL.
//
// ============================================================================
// IT NEVER WRITES ON READ.
//
// The trap this replaces is the project page's one-shot `tabPreselected` ref:
// the page read `?tab=` ONCE, on the first render that had runs loaded, and
// from then on the tab lived in `useState` and the URL was never touched again.
// Three things then disagreed with the screen — reload gave you the tab in the
// URL rather than the one you were on, Back walked out of the page instead of
// between its tabs, and a link somebody pasted into Teams opened the tab they
// had left rather than the one they were looking at.
//
// So the URL is the state, read on every render. What makes that safe is the
// second half: an unresolvable value is NOT corrected. While the runs are still
// loading, `?tab=<a run id>` resolves to nothing — and rewriting it to
// `overview` there would destroy the deep link a quarter of a second before it
// became valid. The fallback renders, the URL is left exactly as it is, and the
// tab appears when the data does.
//
// `resolve` is where aliases live, because they are per-screen: the project
// page maps `spec` onto its first run and `finishes` onto itself, and only that
// page knows what a run id is.
// ============================================================================
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useUrlTab<T extends string>({
  param = "tab",
  fallback,
  resolve,
}: {
  param?: string;
  /** Rendered whenever the URL says nothing this screen recognises. */
  fallback: T;
  /** The URL's raw value → a tab id, or null for "not one of mine (yet)". */
  resolve: (raw: string | null) => T | null;
}): [T, (next: T) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const raw = params.get(param);
  const value = resolve(raw) ?? fallback;

  const setValue = useCallback(
    (next: T) => {
      // Every OTHER parameter is preserved. The spec table's filters and the
      // record's own query all live beside this one, and a setter that rebuilt
      // the query string from scratch would clear them on a tab click.
      const q = new URLSearchParams(params.toString());
      q.set(param, next);
      const query = q.toString();
      // `replace`, not `push`: twenty tab clicks should not be twenty presses
      // of the browser's back button to leave the page. `scroll: false`
      // because the tab content is below the strip, and jumping to the top of
      // the document puts the thing you just clicked off screen.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, param, pathname, router],
  );

  return [value, setValue];
}
