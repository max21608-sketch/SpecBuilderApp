// Which BWS list a finish CODE's BW finish is chosen from (0045).
//
// ============================================================================
// A FINISH HAS NO PALETTE OF ITS OWN, AND THAT IS NOT AN OVERSIGHT.
//
// Palettes belong to BWS FIELDS (`spec_field_gates.palette_key`): Main timber
// finish, Timber Finish 2 and 3 offer BWS's timber list; Main metal finish and
// Metal Finish 2 its metal list; COM 1/2/3 offer nothing, because COM is free
// text in BWS. A row in the finishes library is the client's CODE, and which
// list BW's own finish for it comes from is a reading of where that code is
// used. So it is DERIVED, here, every time -- never stored, because a stored
// palette key would be a third answer beside the fields and the kind, and it
// would go stale the first time a code moved fields.
//
// ---- THE ORDER, AND WHERE IT STOPS -----------------------------------------
//
//   1. THE FIELDS ITS ITEMS SIT IN. Every active attribute carrying the code
//      that is placed in a BWS field. Where they all name ONE list, that is
//      the list: the BWS cell the standard ships into is the one offering it.
//      Where they all sit in fields with NO list -- a fabric on COM 1 -- there
//      is no BW finish to choose, whatever the kind says: the standard ships
//      into those cells, and a timber option in a COM cell is a wrong answer
//      no reader of the file would question.
//   2. THE FINISH'S KIND, where the fields DISAGREE or no item is placed in a
//      field yet: timber reads the list Main timber finish offers, metal the
//      list Main metal finish offers. Read off the register through those two
//      fields rather than by palette key, so the register stays the only place
//      that says which list is which.
//   3. Otherwise NONE, and a sentence saying why. Never an invented list
//      (FMT-GEN-01): a fabric has no BW finish, and an empty dropdown reads as
//      broken and gets typed around.
//
// A leaf: pure, so the library screen (to offer the list) and the write path
// (to resolve the option a person sent) ask the same function -- the
// `proposalBlockers()` rule. A screen offering an option the server would
// refuse is a control that lies.
// ============================================================================
import type { FinishKind } from "@/lib/finishes";
import type { Palette } from "@/lib/palettes";

/** The two fields whose lists a KIND reads, by `spec_fields.json_id`. */
export const KIND_PALETTE_FIELD: Partial<Record<FinishKind, number>> = {
  timber: 4, // Main timber finish
  metal: 5, // Main metal finish
};

/** One active attribute carrying the code: the BWS field it sits in, if any. */
export type FinishUse = { jsonId: number | null; fieldName?: string | null };

export type FinishPaletteReading = {
  /** The list BW's own finish is chosen from, or null where none is offered. */
  palette: Palette | null;
  /** How it was read: off the fields, off the kind, or not at all. */
  from: "fields" | "kind" | null;
  /** In the reviewer's words: why this list, or why no list. */
  why: string;
  /**
   * The code's items sit in fields that disagree, so the kind decided -- and
   * the BW finish then ships into EVERY item's cell, including any in a field
   * that offers a different list or none. Said on the screen, not hidden.
   */
  mixed: boolean;
};

function fieldList(uses: readonly FinishUse[]): string {
  const names = [...new Set(uses.map((use) => use.fieldName?.trim()).filter((name): name is string => Boolean(name)))];
  return names.length > 0 ? names.join(", ") : "BWS fields";
}

/**
 * Which list a code's BW finish is chosen from. See the header for the order.
 *
 * `byField` is `palettesByFieldJsonId(loadPalettes(...))` -- the register the
 * record screen and the drawings review already read.
 */
export function paletteForFinish(
  finish: { kind: FinishKind | null },
  uses: readonly FinishUse[],
  byField: ReadonlyMap<number, Palette>,
): FinishPaletteReading {
  const placed = uses.filter((use) => use.jsonId !== null && use.jsonId !== undefined);
  const keys = placed.map((use) => byField.get(Number(use.jsonId))?.key ?? null);
  const distinct = [...new Set(keys)];

  // 1. The fields agree.
  if (placed.length > 0 && distinct.length === 1) {
    const key = distinct[0];
    if (key) {
      const palette = byField.get(Number(placed[0]!.jsonId)) ?? null;
      return { palette, from: "fields", why: `From ${fieldList(placed)}, where its items sit.`, mixed: false };
    }
    return {
      palette: null,
      from: null,
      why: `Its items sit in ${fieldList(placed)}, which BWS keeps no list for — so there is no BW finish to choose.`,
      mixed: false,
    };
  }

  // 2. The kind, where the fields disagree or say nothing.
  const mixed = distinct.length > 1;
  const kindField = finish.kind ? KIND_PALETTE_FIELD[finish.kind] : undefined;
  const byKind = kindField === undefined ? null : (byField.get(kindField) ?? null);
  if (byKind) {
    return {
      palette: byKind,
      from: "kind",
      why: mixed
        ? `Its items sit in different fields (${fieldList(placed)}), so its kind decides — and the BW finish goes into every one of them.`
        : `From its kind (${finish.kind}) — no item carrying it is placed in a BWS field yet.`,
      mixed,
    };
  }

  // 3. None.
  if (finish.kind === "fabric" || finish.kind === "leather") {
    return {
      palette: null,
      from: null,
      why: `A ${finish.kind} has no BW finish — the COM fields carry no BWS list.`,
      mixed,
    };
  }
  return {
    palette: null,
    from: null,
    why: mixed
      ? `Its items sit in different fields (${fieldList(placed)}) and it has no timber or metal kind to decide between them.`
      : finish.kind
        ? `BWS keeps no BW finish list for ${finish.kind}.`
        : "No item places it in a timber or metal field and it has no kind — set its kind to offer BW's list.",
    mixed,
  };
}
