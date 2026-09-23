// What a reviewer's answer to a cross-page clash WRITES, worked out before
// anything is sent.
//
// ============================================================================
// Plan any-bill, step 4. Two pages of one code give one configuration the same
// BWS field in different words (`crossPageClaims`), and the row now asks the
// real question with three answers:
//
//   SAME FABRIC — KEEP PAGE N'S WORDING. The kept row takes the other row's
//   client code where it has none, and the other row's swatch crop where it
//   has none; the other row is ignored "same as page N". A code is carried
//   because on S-301 only the shop drawing prints one (`CH-01.1`), and keeping
//   the sheet's fuller wording must not cost the library its key.
//
//   TWO FABRICS — MOVE PAGE N TO COM 2. The later row takes the next slot of
//   its kind free on that record, which the blocker already worked out.
//
// NOTHING NEW IS A WRITE PATH. Each edit is one autosave PATCH naming one
// observation and the version the screen showed, so a row somebody else has
// changed is refused on its own — and the confirm route is untouched. Pure,
// so the plan can be proved without a screen.
//
// THE SWATCH NEVER LEAVES THE BROWSER HERE. Crops are held client-side, keyed
// by observation, until confirm uploads them (CLAUDE.md, "A swatch is cropped
// off the page it is printed on"). An ignored row's crop would never be
// uploaded, so a carried crop is RE-KEYED onto the kept row; the caller moves
// it in its own map.
// ============================================================================
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";

export type ClashChoice =
  | { kind: "keep"; keepId: string; dropId: string }
  | { kind: "move"; observationId: string; fieldId: string };

export type ClashEdit = { item: DrawingItem; observation: DrawingObservation; changes: Record<string, unknown> };

export type ClashPlan =
  | { ok: true; edits: ClashEdit[]; swatch: { from: string; to: string } | null }
  | { ok: false; error: string };

function locate(items: readonly DrawingItem[], observationId: string) {
  for (const item of items) {
    const observation = item.observations.find((row) => row.id === observationId);
    if (observation) return { item, observation };
  }
  return null;
}

/**
 * The edits one answer makes, in the order they are sent: the kept row's code
 * first, then the ignore — so a refusal of the first leaves both rows where
 * they were, and the clash is still on the screen to answer again.
 */
export function planClashResolution(
  choice: ClashChoice,
  items: readonly DrawingItem[],
  /** Whether the screen holds a swatch crop for this observation. */
  hasSwatch: (observationId: string) => boolean,
): ClashPlan {
  const stale = "This row has changed since the page loaded. Reload and answer again.";
  if (choice.kind === "move") {
    const found = locate(items, choice.observationId);
    if (!found || found.observation.reviewStatus !== "pending") return { ok: false, error: stale };
    return {
      ok: true,
      edits: [{ ...found, changes: { specFieldId: choice.fieldId } }],
      swatch: null,
    };
  }

  const kept = locate(items, choice.keepId);
  const dropped = locate(items, choice.dropId);
  if (!kept || !dropped) return { ok: false, error: stale };
  if (kept.observation.reviewStatus !== "pending" || dropped.observation.reviewStatus !== "pending") {
    return { ok: false, error: stale };
  }

  const edits: ClashEdit[] = [];
  const keptCode = kept.observation.materialCodeRaw?.trim() ?? "";
  const droppedCode = dropped.observation.materialCodeRaw?.trim() ?? "";
  if (!keptCode && droppedCode) edits.push({ ...kept, changes: { materialCode: droppedCode } });
  edits.push({
    ...dropped,
    changes: { ignoreBecause: `same as page ${kept.item.page ?? "?"}` },
  });

  const swatch =
    !hasSwatch(kept.observation.id) && hasSwatch(dropped.observation.id)
      ? { from: dropped.observation.id, to: kept.observation.id }
      : null;
  return { ok: true, edits, swatch };
}
