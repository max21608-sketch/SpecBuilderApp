"use client";

// One captured spec value, as a person reads it.
//
// A note is not a short value. `mergeNoteBlocks` puts a whole page of general
// conditions in ONE row — the Panther bench's is about 1,800 characters — and
// the record screen rendered it verbatim in a bare span, so its line breaks
// collapsed and the row became a wall of shouting capitals taller than the rest
// of the screen put together. Everything below the specs (the checklist, the
// history) sat underneath it.
//
// So a long value is CLAMPED, and a shouted one is softened for reading. Both
// are display decisions, and both say so:
//
//  - "Show all" / "Show less" reveals every line. Nothing is dropped, and the
//    full value is always one click away.
//  - "As printed" puts the capitals back, because `softenShout` cannot tell a
//    proper noun from a common one and the page is what a reviewer checks
//    against. What is STORED is always what the page said; see src/lib/shout.ts.
//
// Line breaks are rendered (`whitespace-pre-line`), which is what the merge put
// there to keep a sheet's lines in their printed order.
import { useState } from "react";
import { clampText, softenShout } from "@/lib/shout";
import Button from "@/components/ui/Button";

/** Past either of these a value is clamped. Lines first: fifteen short remarks
 *  are as unreadable as one long paragraph. */
const CLAMP_LINES = 4;
const CLAMP_CHARS = 300;

export default function SpecValue({ text }: { text: string }) {
  const softened = softenShout(text);
  const shouted = softened !== text;
  const [asPrinted, setAsPrinted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const full = asPrinted ? text : softened;
  // Measured on what is actually on screen. Putting the capitals back changes
  // nothing about the length, so the control does not appear and disappear as
  // somebody switches between them.
  const { clamped, wasClamped } = clampText(full, CLAMP_LINES, CLAMP_CHARS);
  const shown = expanded ? full : clamped;

  return (
    <>
      {/* INLINE unless it has line breaks to honour. A unit renders
          immediately after this value ("790" + "mm"), and making every value a
          block would drop every unit in the table onto its own line. */}
      <span
        className={shown.includes("\n") ? "block whitespace-pre-line" : "whitespace-pre-line"}
        // The clamp hides text, so the whole value stays available to anything
        // not reading the pixels — copy, find-in-page, a screen reader.
        title={wasClamped && !expanded ? full : undefined}
      >
        {shown}
      </span>
      {(wasClamped || shouted) && (
        <span className="mt-0.5 flex flex-wrap items-center gap-2">
          {wasClamped && (
            <Button size="xs" variant="quiet" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show less" : "Show all"}
            </Button>
          )}
          {shouted && (
            <Button
              size="xs"
              variant="quiet"
              onClick={() => setAsPrinted((value) => !value)}
              title="The drawing prints this in capitals. This screen reads it back in sentence case; the stored value is always what the page said."
            >
              {asPrinted ? "Read it back" : "As printed"}
            </Button>
          )}
        </span>
      )}
    </>
  );
}
