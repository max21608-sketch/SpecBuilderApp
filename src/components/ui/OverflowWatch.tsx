"use client";

// Reports, in development only, any box on the screen that is wider than it
// is allowed to be. The rule and its exceptions are in `src/lib/overflow.ts`.
//
// It runs after each render settles (a mutation or a resize, debounced), says
// each overflow ONCE per page as a console error naming the box and how many
// pixels it is over — which the browser checks already treat as a failure —
// and exposes the same reading as `window.__specBuilderOverflows()` for
// `tools/overflow-audit.mjs`. It renders nothing, and in a production build
// it returns before touching the DOM.
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { findOverflows, type Overflow } from "@/lib/overflow";

declare global {
  interface Window {
    __specBuilderOverflows?: () => Overflow[];
  }
}

export default function OverflowWatch() {
  const pathname = usePathname();
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__specBuilderOverflows = () => findOverflows(document);
    const reported = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const overflow of findOverflows(document)) {
          const key = `${overflow.where}@${window.innerWidth}`;
          if (reported.has(key)) continue;
          reported.add(key);
          console.error(
            `[overflow] ${overflow.where} is ${overflow.overBy}px wider than its box at ${window.innerWidth}px — ` +
              "see src/lib/overflow.ts for the rule and the one exception.",
          );
        }
      }, 800);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", check);
    check();
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [pathname]);
  return null;
}
