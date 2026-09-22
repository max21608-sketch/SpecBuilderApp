// Loading the palette register, and the two links a screen resolves it through.
//
// ============================================================================
// ONE LOADER, BECAUSE THE TWO COPIES HAD ALREADY DRIFTED.
//
// The record screen (`/api/records/[id]`) and the infill screen
// (`/api/projects/[id]/infill`) each carried their own copy of these two
// statements, and on 2026-09-22 they were no longer the same query: 0035 added
// `spec_palette_options.code` so that a drawing quoting `U1660-6031` and
// nothing else resolves to exactly one stud, the record route's copy selected
// it, and the infill route's copy did not. Nothing said so on either screen --
// the option simply stopped resolving on one of them. A third copy for the
// drawings review is how that becomes three answers to one question, which is
// the `composeDimensionCell` rule applied to a register.
//
// `gate-load.ts` is the precedent: this file FETCHES and decides nothing. The
// exact step -- does this written value name an option -- stays in
// `normalisePaletteValue`, where `house/conventions.md` §6 puts it.
//
// ---- THE WIRE SHAPE IS THE DATABASE'S, DELIBERATELY ----------------------
//
// `palettes` comes back with `allows_free_text`, `source_note` and `synced_at`
// as the columns are named, not as `Palette` names them. Two screens already
// read that shape out of their payloads and fold it into a `Palette`
// themselves, so returning the camel-cased domain type here would be a change
// to those screens dressed up as a refactor. `paletteFromRow` in
// `palettes.ts` is the one fold, for a caller that wants the domain type --
// which is what the drawings routes use, because a THIRD copy of the fold on
// the client is the same drift one layer out.
// ============================================================================
import type { SqlLike } from "@/lib/record-atoms";
import { paletteFromRow, type Palette, type PaletteRow } from "@/lib/palettes";

/**
 * Which palette a QUESTION offers, keyed the two ways a gate row can be
 * addressed: the BWS field it points at, or the `local_key` carried by the six
 * readiness rows of Matthew's matrix that have no BWS field at all.
 */
export type PaletteQuestionLink = {
  json_id: number | null;
  local_key: string | null;
  palette_key: string;
};

export type PaletteRegister = {
  palettes: PaletteRow[];
  paletteByQuestion: PaletteQuestionLink[];
};

/**
 * Every palette, with its options, and the gate overlay's link to the
 * questions that offer them.
 *
 * TWO STATEMENTS RATHER THAN A JOIN, because the second one is a different
 * fact. The first is the register; the second is Matthew's matrix saying
 * "Stitching spec is one of these three", which is an overlay keyed on the
 * field and not a property of the palette.
 *
 * A PALETTE WITH NO OPTIONS STILL COMES BACK. Every screen says so in words
 * (`unheldPaletteNote`) rather than rendering an empty dropdown, which reads
 * as broken and gets typed around. None is empty since the 2026-09-22 BWS
 * capture; the branch stays live for the next gate row that points at a list
 * nobody has read yet.
 */
export async function loadPalettes(exec: SqlLike): Promise<PaletteRegister> {
  const palettes = await exec`
    select p.key, p.name, p.owner, p.allows_free_text, p.source_note, p.synced_at,
           coalesce(
             (select json_agg(json_build_object(
                       'value', o.value, 'label', o.label,
                       'sortOrder', o.sort_order, 'isDefault', o.is_default,
                       'code', o.code)
                      order by o.sort_order)
                from spec_palette_options o where o.palette_key = p.key and o.active),
             '[]'::json) as options
      from spec_palettes p
     order by p.key
  `;
  const paletteByQuestion = await exec`
    select f.json_id, g.local_key, g.palette_key
      from spec_field_gates g
      left join spec_fields f on f.id = g.spec_field_id
     where g.palette_key is not null
  `;
  return {
    palettes: palettes as unknown as PaletteRow[],
    paletteByQuestion: paletteByQuestion as unknown as PaletteQuestionLink[],
  };
}

/**
 * The palette each BWS FIELD offers, by `spec_fields.json_id`.
 *
 * ============================================================================
 * THE DRAWINGS PATH LINKS ON THE FIELD, NOT ON A QUESTION.
 *
 * A staged drawing observation carries a `spec_fields.id` and nothing else --
 * it has no requirement, no category and no local key, because a callout is a
 * statement a page made and not an answer to a checklist question. The gate
 * overlay is keyed on the field, so the link is already there:
 * `spec_field_gates.spec_field_id -> palette_key`, read here through
 * `json_id`, which is the key the register and every reader of it agree on
 * (`column_letter` is positional and never joined on).
 *
 * VERIFIED AGAINST THE SANDBOX, 2026-09-22: fourteen fields carry a palette
 * key and NOT ONE carries two, so there is no tie to break and this map cannot
 * silently drop a second answer. The five the drawings path can actually
 * assign are Main timber finish (4), Timber Finish 2 (31), Timber Finish 3
 * (143), Main metal finish (5) and Metal Finish 2 (35) -- all five BWS-owned.
 * COM 1/2/3 carry none, correctly: COM is free text in BWS.
 *
 * A local-key row is skipped rather than guessed at. It has no field to attach
 * to and a drawing has no way to reach one.
 * ============================================================================
 */
export function palettesByFieldJsonId(register: PaletteRegister): Map<number, Palette> {
  const byKey = new Map<string, Palette>();
  for (const row of register.palettes) byKey.set(row.key, paletteFromRow(row));

  const out = new Map<number, Palette>();
  for (const link of register.paletteByQuestion) {
    if (link.json_id === null || link.json_id === undefined) continue;
    const palette = byKey.get(link.palette_key);
    if (palette) out.set(Number(link.json_id), palette);
  }
  return out;
}

/**
 * The BWS field register a drawings screen threads, with each field's palette
 * attached.
 *
 * ATTACHED TO THE FIELD RATHER THAN SENT BESIDE IT, because the field register
 * is already what the review screen, its autosave, the pack screen and the
 * confirm all pass around (`specFieldEntries`). A parallel list would be a
 * second thing for a caller to forget, and a card rendering a palette the
 * confirm never saw is the disagreement `resolveStagedRun` exists to prevent.
 *
 * `palette: null` is the honest value for the 42 fields with no palette, and
 * for every field when the register could not be read: the row then renders as
 * it did before this existed, which is `upgradeCalloutGuesses`' rule about an
 * empty `fields` list in a second place.
 */
export function withPalettes<T extends Record<string, unknown>>(
  fields: readonly T[],
  register: PaletteRegister,
): (T & { palette: Palette | null })[] {
  const byJsonId = palettesByFieldJsonId(register);
  // Rows off the driver, like `specFieldEntries` takes them: the query decides
  // the columns and a row is `Record<string, unknown>` either way, so the read
  // is coerced here rather than the callers being asked to describe their own
  // select twice.
  return fields.map((field) => ({ ...field, palette: byJsonId.get(Number(field.json_id)) ?? null }));
}
