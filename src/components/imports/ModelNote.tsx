"use client";

// What the model said about the WHOLE document, folded to one line.
//
// ============================================================================
// ONE CLICK AWAY, NOT AHEAD OF THE WORK (review 3.7b, 2026-11-16).
//
// Every document review opened with a full paragraph, "The model noted: …",
// above everything else — often five lines of title-block boilerplate the
// model copied off the sheet. It is context, not a blocker: nothing a reviewer
// must see before confirming lives in it (the per-card "Before you can confirm"
// and "The read was unsure of" blocks carry those, and stay open). So it is one
// line that says a note exists, and the text is one press away through the
// one `Disclosure` the app has.
//
// ONE COMPONENT FOR ALL FOUR PLACES (the drawings review, the finishes
// schedule review twice, the preamble review) so the wording and the fold
// cannot drift apart.
// ============================================================================
import { useState } from "react";
import Disclosure from "@/components/ui/Disclosure";
import Note from "@/components/ui/Note";

export default function ModelNote({ text }: { text: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!text?.trim()) return null;
  return (
    <Disclosure
      title="The model left a note on this document"
      open={open}
      onToggle={() => setOpen((was) => !was)}
      className="mt-3"
    >
      <Note tone="plain" className="mt-1.5 whitespace-pre-line">
        {text}
      </Note>
    </Disclosure>
  );
}
