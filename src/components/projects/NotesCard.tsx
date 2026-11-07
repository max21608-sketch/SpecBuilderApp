"use client";

// The project's preamble notes: what the preamble said the whole package is
// built under, collapsed by default, each flaggable and retirable. Moved out of
// src/app/dashboard/projects/[id]/page.tsx on 2026-11-07 (audit 5.3, cut B).
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Card from "@/components/ui/Card";

export type ProjectNote = {
  id: string;
  topic: string | null;
  title: string | null;
  body: string;
  flagged: boolean;
  source_page: number | null;
  source_filename: string | null;
  version: number;
};

export default function NotesCard({
  projectId,
  notes,
  onError,
  onChanged,
}: {
  projectId: string;
  notes: ProjectNote[];
  /** The page's banner: cleared before each write, set when one is refused. */
  onError: (message: string | null) => void;
  /** The page's whole load, after a write the server took. */
  onChanged: () => Promise<void>;
}) {
  // Collapsed by default. A real preamble states thirty things, each a
  // paragraph, and all of them expanded is why this section could not be read.
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [notesOpen, setNotesOpen] = useState(false);

  const toggleNote = (noteId: string) =>
    setOpenNotes((current) => {
      const next = new Set(current);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });

  /**
   * Marking a note load-bearing. Independent of `status`, which is whether the
   * note is a correct reading of the document -- "this is wrong" and "this
   * matters" are different answers and must not share a field.
   */
  async function setNoteFlag(note: ProjectNote, flagged: boolean) {
    onError(null);
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flagged, version: note.version }),
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    await onChanged();
  }

  async function retireNote(note: ProjectNote) {
    onError(null);
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "retired", version: note.version }),
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    await onChanged();
  }

  const flaggedCount = notes.filter((note) => note.flagged).length;
  const allNotesOpen = notes.length > 0 && notes.every((note) => openNotes.has(note.id));

  return (
    <Card
      title={
        <>
          From the preamble
          {flaggedCount > 0 && (
            <Chip tone="warn" className="normal-case tracking-normal">
              {flaggedCount} flagged
            </Chip>
          )}
        </>
      }
      actions={
        notes.length > 0 ? (
          <>
            <Button size="xs" variant="quiet" onClick={() => setNotesOpen((open) => !open)}>
              {notesOpen ? "Collapse" : `Show the ${notes.length}`}
            </Button>
            {notesOpen && (
              <Button
                size="xs"
                variant="quiet"
                onClick={() =>
                  setOpenNotes(allNotesOpen ? new Set() : new Set(notes.map((note) => note.id)))
                }
              >
                {allNotesOpen ? "Collapse all" : "Expand all"}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {notes.length === 0 ? (
        <p className="text-xs text-neutral-500">
          Nothing yet. If the pack came with a preamble, upload it above and review what it requires. Plenty of
          projects do not have one.
        </p>
      ) : !notesOpen ? (
        <p className="text-xs text-neutral-500">
          {notes.length} note{notes.length === 1 ? "" : "s"} from the preamble. Reference material; collapsed
          by default.
        </p>
      ) : (
        <>
          <p className="text-xs text-neutral-500">
            The conditions the whole package is built under. Flag the ones that change what gets quoted &mdash;
            a flameproofing standard, a tolerance, a precedence clause &mdash; so they are not read at the same
            weight as the boilerplate.
          </p>
          <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {notes.map((note) => {
              const open = openNotes.has(note.id);
              return (
                <li
                  key={note.id}
                  className={`px-4 py-3 text-sm ${note.flagged ? "border-l-2 border-l-amber-400 bg-amber-50" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    {/* The title is the whole row's toggle: a preamble
                        note's body runs to a paragraph, and thirty of them
                        expanded is why this section was unreadable. */}
                    <button
                      type="button"
                      onClick={() => toggleNote(note.id)}
                      aria-expanded={open}
                      className={`flex-1 text-left font-medium ${note.flagged ? "text-amber-900" : "text-neutral-900"}`}
                    >
                      {open ? "▾" : "▸"} {note.title ?? "Untitled requirement"}
                    </button>
                    <Button
                      size="xs"
                      variant="quiet"
                      title={note.flagged ? "Stop flagging this" : "Flag this as load-bearing"}
                      onClick={() => void setNoteFlag(note, !note.flagged)}
                    >
                      {note.flagged ? "★ Flagged" : "☆ Flag"}
                    </Button>
                    <Button size="xs" variant="quiet" onClick={() => void retireNote(note)}>
                      Retire
                    </Button>
                  </div>
                  {open && <p className="mt-1 whitespace-pre-line text-neutral-700">{note.body}</p>}
                  <p className="mt-1 text-xs text-neutral-500">
                    {note.topic}
                    {note.source_filename && <> &middot; {note.source_filename}</>}
                    {note.source_page && <> page {note.source_page}</>}
                    {!open && note.body.length > 0 && (
                      <> &middot; {note.body.length > 90 ? `${note.body.slice(0, 90).trimEnd()}…` : note.body}</>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
