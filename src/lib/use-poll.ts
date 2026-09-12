"use client";

// Re-run something on an interval while a condition holds.
//
// Extraction moved off the request onto a queue, so the screens that used to
// await it now have to ask whether it has finished. This is the whole of that
// mechanism: no websocket, no subscription, just a GET the page already makes.
//
// Two details that matter:
//   - `active` is read from the latest render, so a poll that writes a terminal
//     status stops the next tick rather than running one more time.
//   - a backgrounded tab is skipped. A review screen left open overnight should
//     not spend the night calling the API.
import { useEffect, useRef } from "react";

export function usePoll(
  fn: () => void | Promise<void>,
  { intervalMs, active }: { intervalMs: number; active: boolean },
): void {
  // Kept in a ref so a caller can pass an inline closure without resetting the
  // interval on every render.
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      void saved.current();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, active]);
}
