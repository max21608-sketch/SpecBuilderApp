"use client";

// WHAT THE READ COULD NOT SETTLE, at the top of the card (schemaVersion 4).
//
// The item-centric read says in words what it was unsure of — a slot chosen
// between two figures, a figure it could not read, pages it was not sure
// belonged together — and before version 4 a doubt like that was silent: the
// card showed a confident figure and nothing said a person should look. Each
// one is an amber notice above the rows, because amber is "needs a person".
//
// A DOUBT ABOUT AN OVERALL SLOT HOLDS THE CARD (brief F) until a person
// touches that slot or presses Checked here. The blocker is computed by
// `uncertainBlockers`, which the confirm route calls too; this only says which
// notices are holding the card and offers the press. A doubt about grouping
// or a finish stays a notice and never holds anything.
import type { DrawingItem } from "@/lib/drawing-document";
import { uncertainNotices } from "@/lib/drawing-document";
import Button from "@/components/ui/Button";

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

type NoticeItem = Pick<DrawingItem, "id" | "uncertain" | "uncertainChecked" | "slotsTouched">;

export default function ItemReadNotes({
  items,
  busy = false,
  onCheck,
}: {
  items: readonly NoticeItem[];
  busy?: boolean;
  /**
   * Press "Checked" on one notice: the screen saves the item's
   * `uncertainChecked` with this index added. Absent: no button, and a slot
   * notice still says it holds the card.
   */
  onCheck?: (item: NoticeItem, index: number) => void;
}) {
  const notes = items.flatMap((item) =>
    uncertainNotices(item).map((notice) => ({
      ...notice,
      item,
      key: `${item.id}-${notice.index}`,
      label: ABOUT_WORDS[notice.about] ?? "Unsure",
    })),
  );
  if (notes.length === 0) return null;
  const holding = notes.filter((note) => note.slot && note.settled === null).length;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2" role="note" aria-label="What the read was unsure of">
      <p className="text-xs font-semibold text-amber-900">
        The read was unsure of {notes.length === 1 ? "one thing" : `${notes.length} things`}:
        {holding > 0 && (
          <span className="font-normal">
            {" "}
            {holding === 1 ? "one is about a size, and holds" : `${holding} are about a size, and hold`} the card until you
            check {holding === 1 ? "it" : "them"}.
          </span>
        )}
      </p>
      <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
        {notes.map((note) => (
          <li key={note.key} className="flex flex-wrap items-center gap-x-2">
            <span>
              <b>{note.label}:</b> {note.why}
            </span>
            {note.slot && note.settled === "checked" && <span className="text-neutral-600">— checked</span>}
            {note.slot && note.settled === "touched" && <span className="text-neutral-600">— you changed this slot</span>}
            {note.slot && note.settled === null && onCheck && (
              <Button size="xs" variant="quiet" disabled={busy} onClick={() => onCheck(note.item, note.index)}>
                Checked
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
