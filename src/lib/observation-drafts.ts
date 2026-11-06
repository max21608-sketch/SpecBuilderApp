// ============================================================================
// WHAT A DRAWINGS ROW SHOWS AFTER ITS SAVE COMES BACK (audit G10, 2026-11-06).
//
// A row's value box shows the reviewer's draft where there is one, and the
// server's value otherwise. Nothing ever cleared a draft, so after a REFUSED
// save the box went on showing the typed text: the confirm then committed the
// server's old value under a row that said something else, and the next blur
// compared the typed text with the fresh server value, found them different,
// and sent the typed text again against the new version, overriding the edit
// that had caused the refusal.
//
// So a draft ends with its save. Accepted: the draft goes and the row shows
// what the server holds, which is what was typed. Refused: the typed words go
// too, AFTER the reload has landed, and the row shows the server's value with
// one sentence saying what was not saved, so the reviewer can type it again
// over a value they can now see.
//
// A draft is only dropped when it still holds what the save sent. Typing that
// carried on while the save was away is newer than both, and is kept.
// ============================================================================
import type { DrawingObservation } from "./drawing-document";

/** What the reviewer is typing into a row, and why the last attempt failed. */
export type ObservationDraft = Partial<DrawingObservation> & {
  /** One sentence, shown on the row: a value the server refused. */
  refused?: string;
};

export type ObservationDrafts = Record<string, ObservationDraft>;

/** The same words, as the blur compares them: an empty box is a null value. */
function sameWords(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "") === (b ?? "");
}

/** A copy of the draft with no refusal on it. */
function withoutRefusal(draft: ObservationDraft | undefined): ObservationDraft {
  const copy = { ...draft };
  delete copy.refused;
  return copy;
}

/** The sentence a refused value leaves on its row. */
export function refusedSentence(typed: string | null, reason: string): string {
  return typed === null || typed === ""
    ? `Clearing this value was not saved: ${reason}`
    : `Your '${typed}' was not saved: ${reason}`;
}

/** The reviewer typed: the new words, and any old refusal is answered. */
export function typedDraft(drafts: ObservationDrafts, id: string, value: string): ObservationDrafts {
  return { ...drafts, [id]: { ...withoutRefusal(drafts[id]), value } };
}

/**
 * The drafts once a save of this row has come back. `sent` is the changes the
 * save carried; only a save that sent a `value` decides anything about the
 * typed words. A refusal of any other change (a unit, a slot) leaves the
 * draft alone and is reported in the banner, as before.
 */
export function draftAfterSave(
  drafts: ObservationDrafts,
  id: string,
  sent: Record<string, unknown>,
  outcome: { ok: true } | { ok: false; error: string },
): ObservationDrafts {
  const held = drafts[id];
  if (!held) return drafts;
  const sentValue = "value" in sent ? ((sent.value as string | null | undefined) ?? null) : undefined;

  if (outcome.ok) {
    const rest = withoutRefusal(held);
    if (sentValue !== undefined && "value" in rest && sameWords(rest.value, sentValue)) delete rest.value;
    const next = { ...drafts };
    if (Object.keys(rest).length === 0) delete next[id];
    else next[id] = rest;
    return next;
  }

  if (sentValue === undefined) return drafts;
  const rest = withoutRefusal(held);
  // Typing that carried on while the save was away is newer than both, so it
  // stays; the sentence still says what did not land.
  if ("value" in rest && !sameWords(rest.value, sentValue)) {
    return { ...drafts, [id]: { ...rest, refused: refusedSentence(sentValue, outcome.error) } };
  }
  delete rest.value;
  return { ...drafts, [id]: { ...rest, refused: refusedSentence(sentValue, outcome.error) } };
}
