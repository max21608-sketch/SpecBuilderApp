// Staging an FF&E preamble as project notes.
//
// Pure. The preamble states the conditions every item in the package is made
// under — flameproofing standards, tagging and its penalties, moisture content,
// tolerances, who verifies site dimensions. None of it belongs to one item, so
// none of it can be a spec answer or a record attribute.
//
// It goes to `project_notes` rather than the chassis `notes` table, which is
// append-only by trigger: a model reading nineteen pages of prose will
// occasionally cut a requirement in the wrong place, and an uncorrectable
// mis-extraction on the project overview is worse than no extraction.
//
// Nothing here decides anything. There is no matching to do and no vocabulary
// to resolve: a note is text a human reads, edits and accepts.
import type { RawPreambleNote } from "@/lib/extraction-schema";

export type PreambleNote = {
  id: string;
  version: number;
  page: number | null;
  topicRaw: string | null;
  titleRaw: string | null;
  bodyRaw: string | null;
  /** The reviewer's text. Starts as the document's own. */
  topic: string | null;
  title: string | null;
  body: string | null;
  reviewStatus: "pending" | "ignored" | "applied";
  reviewedAt: string | null;
  reviewedBy: string | null;
  applied: { noteId: string } | null;
};

export type StagedPreamble = {
  schemaVersion: 1;
  kind: "preamble";
  filename: string | null;
  documentNotes: string | null;
  notes: PreambleNote[];
};

let stagingCounter = 0;
const nextId = (): string =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `note-${Date.now()}-${(stagingCounter += 1)}`;

export function stagePreamble(
  notes: RawPreambleNote[],
  filename: string | null,
  documentNotes: string | null,
): StagedPreamble {
  return {
    schemaVersion: 1,
    kind: "preamble",
    filename,
    documentNotes,
    notes: notes.map((note) => ({
      id: nextId(),
      version: 1,
      page: note.page,
      topicRaw: note.topicRaw,
      titleRaw: note.titleRaw,
      bodyRaw: note.bodyRaw,
      topic: note.topicRaw,
      title: note.titleRaw,
      body: note.bodyRaw,
      reviewStatus: "pending",
      reviewedAt: null,
      reviewedBy: null,
      applied: null,
    })),
  };
}

export function assertStagedPreamble(parsed: unknown): StagedPreamble {
  const doc = parsed as Partial<StagedPreamble> | null;
  if (!doc || typeof doc !== "object" || doc.kind !== "preamble" || !Array.isArray(doc.notes)) {
    throw new Error("This run was not staged as a preamble. Upload the preamble again.");
  }
  return doc as StagedPreamble;
}

export type PreambleBlocker = { code: "empty_body"; message: string; noteId: string };

/**
 * Computed on read, never stored — the same rule as the drawing blockers. A
 * note whose body the reviewer has emptied cannot be added: `project_notes`
 * requires a non-blank body, and a 500 from a check constraint tells the
 * reviewer nothing.
 */
export function preambleNoteBlockers(doc: StagedPreamble): PreambleBlocker[] {
  return doc.notes
    .filter((note) => note.reviewStatus === "pending" && !note.body?.trim())
    .map((note) => ({ code: "empty_body" as const, noteId: note.id, message: "A note needs a body, or ignore it." }));
}

export function hasPendingNotes(doc: StagedPreamble): boolean {
  return doc.notes.some((note) => note.reviewStatus === "pending");
}
