"use client";

// WHAT THE READ COULD NOT SETTLE, at the top of the card (schemaVersion 4).
//
// The item-centric read says in words what it was unsure of — a slot chosen
// between two figures, a figure it could not read, pages it was not sure
// belonged together — and before version 4 a doubt like that was silent: the
// card showed a confident figure and nothing said a person should look. Each
// one is an amber notice above the rows, because amber is "needs a person".
// NOT a blocker here: which doubts should hold a card is the review screen's
// next change (brief F), and a notice that blocks before the reviewer has a
// way to dismiss it is a card nobody can confirm.
import type { DrawingItem } from "@/lib/drawing-document";

const ABOUT_WORDS: Record<string, string> = {
  width: "Width",
  depth: "Depth",
  height: "Height",
  seatHeight: "Seat height",
  diameter: "Diameter",
  grouping: "Which pages",
  configurations: "Configurations",
  finish: "A finish",
  code: "The code",
  conflict: "Sheet and drawing disagree",
  other: "Unsure",
};

export default function ItemReadNotes({ items }: { items: readonly Pick<DrawingItem, "id" | "uncertain">[] }) {
  const notes = items.flatMap((item) =>
    (Array.isArray(item.uncertain) ? item.uncertain : [])
      .filter((entry) => entry && typeof entry.why === "string" && entry.why.trim() !== "")
      .map((entry, index) => ({ key: `${item.id}-${index}`, about: ABOUT_WORDS[entry.about] ?? "Unsure", why: entry.why })),
  );
  if (notes.length === 0) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2" role="note" aria-label="What the read was unsure of">
      <p className="text-xs font-semibold text-amber-900">The read was unsure of {notes.length === 1 ? "one thing" : `${notes.length} things`}:</p>
      <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
        {notes.map((note) => (
          <li key={note.key}>
            <b>{note.about}:</b> {note.why}
          </li>
        ))}
      </ul>
    </div>
  );
}
