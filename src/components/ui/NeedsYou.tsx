"use client";

// What still stops a Confirm: a short list at the top, each item a link to the
// place it is about (2026-10-15).
//
// ============================================================================
// HIGHLIGHTED WHERE IT IS, AND SAYS THE NEXT STEP IN A FEW WORDS.
//
// Max, after the Ronnie Scott's calls: the reasons were "developer style error
// messages" in places nobody was looking — a hover title, a banner scrolled
// away, a "Checked" button that looked like text. Each item here is the next
// step in a few words; pressing it scrolls to the row, panel or notice and
// lights it amber for a moment (`goToAndFlash`). The full sentences the screen
// already wrote are kept, behind "Why", never deleted: they are how a reviewer
// checks what the app is asking of them.
//
// Amber, because it needs a person; a link, because it GOES somewhere and
// changes nothing (`Button.tsx`'s rule). `onGo` runs first, for the screen to
// switch a tab or unfold a row so the target exists to scroll to.
//
// Empty renders nothing: a list of nothing is a control that says "all clear"
// in a place nobody looks for good news. The Confirm button says that.
// ============================================================================
import { useState } from "react";
import type { NeedsYouItem } from "@/lib/needs-you";
import { goToAndFlash } from "@/lib/go-to";
import { TONE } from "./tone";

export default function NeedsYou({
  id,
  items,
  title = "Before you can confirm",
  onGo,
  tone = "warn",
  className = "",
}: {
  /** The list's own id, so a sentence beside Confirm can link back to it. */
  id: string;
  items: readonly NeedsYouItem[];
  title?: string;
  /** Called with the item before scrolling: switch a tab, unfold a row. */
  onGo?: (item: NeedsYouItem) => void;
  /**
   * Amber: it needs a person before the confirm. Red only for the checks a
   * TRANSCRIBED bill failed (`transcriptionNeedsYou`), which the confirm does
   * not wait on and a person must not miss.
   */
  tone?: "warn" | "danger";
  /** Layout only. */
  className?: string;
}) {
  const [why, setWhy] = useState(false);
  if (items.length === 0) return null;
  const explained = items.filter((item) => item.why);
  return (
    <section
      id={id}
      aria-label="What needs you"
      className={`rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-5 ${TONE[tone].note} ${className}`.trim()}
    >
      <p className="font-semibold">
        {title}: {items.length === 1 ? "one thing needs you" : `${items.length} things need you`}
      </p>
      <ol className="mt-1 space-y-0.5">
        {items.map((item, index) => (
          <li key={item.key} className="flex gap-1.5">
            <span className="tabular-nums opacity-70">{index + 1}.</span>
            <span className="min-w-0">
              {item.target ? (
                <a
                  href={`#${item.target}`}
                  className={`font-medium underline underline-offset-2 hover:decoration-2 ${tone === "danger" ? "decoration-red-500" : "decoration-amber-500"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onGo?.(item);
                    goToAndFlash(item.target!);
                  }}
                >
                  {item.words}
                </a>
              ) : (
                <span className="font-medium">{item.words}</span>
              )}
              {why && item.why && <span className="mt-0.5 block font-normal opacity-90">{item.why}</span>}
            </span>
          </li>
        ))}
      </ol>
      {explained.length > 0 && (
        <button
          type="button"
          aria-expanded={why}
          onClick={() => setWhy((value) => !value)}
          className="mt-1 text-[11.5px] underline decoration-dotted"
        >
          {why ? "Hide why" : "Why"}
        </button>
      )}
    </section>
  );
}
