// Setting a project's finishes library out at the start, from a list.
//
// ============================================================================
// WHY THIS IS A PASTE BOX AND NOT AN EXTRACTION.
//
// Matthew, 2026-09-17: "Project finishes I think are the way to go; set these
// out from the outset, possibly loaded by scanning the finishes schedule."
//
// The scanning half cannot be built honestly yet. `finishes_schedule` is
// already a document kind with its own prompt, but the model's output shape
// (`RawProposal`) has `attributeRaw` and `valueRaw` and NO field for a finish
// code — so pulling codes out of it would mean parsing them from prose, which
// is precisely the inference house/conventions.md §6 puts on the far side of
// the fuzzy/exact line. Adding a code field to the tool schema is possible and
// is the right eventual answer; it also forces a re-read of every document
// already read, which is eleven billed calls for the Panther pack alone.
//
// So the part that needs no inference is built: a person pastes the codes —
// off the schedule, out of an email, from anywhere — and the app says which
// are new, which it already holds, and which are duplicates of each other.
// Nothing is guessed, and `set these out from the outset` works today.
//
// ---- IT PARSES A LIST, NOT A MEANING -----------------------------------
//
// One code per line, and an optional description after the first tab, comma or
// dash. `kind` IS NEVER INFERRED — the finishes library's own standing rule,
// which is why a code arrives filed as nothing and a person picks. And the
// code is normalised the way `normaliseFinishCode` normalises: case and
// whitespace only, so `CH-01.1` and `CH-01-1` stay two finishes.
// ============================================================================
import { normaliseFinishCode } from "@/lib/finishes";

export type ParsedFinishLine = {
  /** As typed, which is what gets stored. */
  code: string;
  description: string | null;
  /** The line it came from, so a screen can point at the one that is wrong. */
  lineNo: number;
};

export type BulkPreviewRow = ParsedFinishLine & {
  status: "new" | "already held" | "repeated in this list";
  /** What the library already calls it, where it holds it. */
  heldAs: string | null;
};

export type BulkPreview = {
  rows: BulkPreviewRow[];
  newCount: number;
};

/** One code per line; a description after the first tab, comma or " - ". */
export function parseFinishList(text: string): ParsedFinishLine[] {
  const out: ParsedFinishLine[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const split = trimmed.match(/^([^\t,]+?)(?:\t|,| - |–)\s*(.*)$/);
    const code = (split?.[1] ?? trimmed).trim();
    const description = split?.[2]?.trim() || null;
    if (!code) continue;
    out.push({ code, description, lineNo: index + 1 });
  }
  return out;
}

/**
 * What creating this list would do, before anything is created.
 *
 * Every dismissal in this app is reversible and every consequential write is
 * shown first: a paste box that silently created thirty rows, some of them
 * duplicates of codes the project already holds, would be the opposite of the
 * finishes library's edit-once rule.
 */
export function previewFinishList(
  parsed: ParsedFinishLine[],
  held: { code: string; codeNorm: string }[],
): BulkPreview {
  const heldByNorm = new Map(held.map((finish) => [finish.codeNorm, finish.code]));
  const seen = new Map<string, number>();
  const rows: BulkPreviewRow[] = [];

  for (const line of parsed) {
    const norm = normaliseFinishCode(line.code);
    const alreadyHeld = heldByNorm.get(norm);
    if (alreadyHeld !== undefined) {
      rows.push({ ...line, status: "already held", heldAs: alreadyHeld });
      continue;
    }
    if (seen.has(norm)) {
      // The same code twice in one paste, which a schedule routinely produces
      // because a code appears against every item that carries it. Reported
      // rather than silently de-duplicated: a person pasting thirty lines and
      // being told twenty-two were created should be able to see why.
      rows.push({ ...line, status: "repeated in this list", heldAs: null });
      continue;
    }
    seen.set(norm, line.lineNo);
    rows.push({ ...line, status: "new", heldAs: null });
  }

  return { rows, newCount: rows.filter((row) => row.status === "new").length };
}
