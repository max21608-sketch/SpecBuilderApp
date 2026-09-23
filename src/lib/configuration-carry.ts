// Adding a configuration by hand: the name, what is carried, and what stops
// being exported. PURE — no database, so the panel and the route read the same
// rules out of the same file and the pure tier can hold them.
//
// ============================================================================
// WHY A PERSON ADDS ONE AT ALL.
//
// Max, 2026-09-23: "once this goes into production, if someone sees that
// something's wrong, they still need to work through, even if it means they
// have to add it manually. So we need the option to add a configuration
// manually, and it should come equipped with a default set of things to fill
// in." Intake makes configurations from the pages a drawing set prints; this
// is the way through when the pages did not say, or said it wrongly.
//
// ---- THE BILL LINE'S SPECS ARE CARRIED, NOT MOVED ------------------------
//
// A configuration is the same piece of furniture in a different cloth, so
// what the bill line already holds — its dimensions, its notes, its
// construction — is usually true of it too. Each is offered as a TICK the
// person can clear, with where it came from, and nothing is copied that they
// did not leave ticked. The fields that usually DIFFER between configurations
// start unticked, so the new one begins blank exactly where it is different.
//
// ---- AND THE BILL LINE BECOMES A HEADING ---------------------------------
//
// `ensureVariant` refuses to split a bill line that holds specs, because once
// it has a live configuration the export stops shipping it
// (`parentIsSupersededBy`) and its specs would vanish from the file. This path
// is the answer to that block, not a way round it: before Add commits, the
// panel says in words which of the bill line's statements will stop reaching
// the export — every one the person left unticked — and the route re-derives
// that list from the live rows and refuses if it is not what was shown.
// ============================================================================

import { VARIANT_LABEL_SHAPE, normaliseVariantLabel } from "@/lib/record-variants";

/**
 * The shape a configuration's name may take.
 *
 * THE ONE COPY OF `spec_records_variant_shape` (0024) in application code:
 * short, printable, upper case, because these are read aloud and typed into
 * emails. If a migration widens the CHECK (0037 is being written for names a
 * document prints, `S-301 TYPE 2`), this is the one line to change with it —
 * and the database still refuses whatever this lets through, so a drift fails
 * loudly rather than storing something the CHECK does not allow.
 */
// NOT a second copy: the shape and the fold live in record-variants.ts, which
// the intake confirm (`ensureVariant`) and the review card read too. Two copies
// of a CHECK drift (0028 dropped a value 0021 had added), and two folds would
// store `TYPE 2` from intake and `Type 2` by hand as two configurations.
export const VARIANT_LABEL_PATTERN = VARIANT_LABEL_SHAPE;

/** The same rule in words, for the refusal. Keep it beside the pattern. */
export const VARIANT_LABEL_RULE =
  "up to 24 characters, starting with a letter or a number, using only letters, numbers, spaces, full stops, slashes, ampersands and hyphens";

/** Trimmed, inner whitespace collapsed to one space, upper-cased. `type  2` → `TYPE 2`. */
export const foldConfigurationName = normaliseVariantLabel;

export type TakenName = { label: string; status: string };

export type NameCheck =
  | { ok: true; label: string }
  | { ok: false; code: "name_required" | "name_shape" | "name_taken" | "name_retired"; message: string };

/**
 * Whether `raw` can name a new configuration under a bill line that already
 * has `taken`.
 *
 * A RETIRED NAME IS NEVER REUSED — `nextVariantLabel`'s rule for letters,
 * applied to names. Somebody quoted "S-301 TYPE 2" in an email and it has to
 * go on meaning the thing they quoted.
 */
export function checkConfigurationName(raw: string, taken: readonly TakenName[], billLine: string): NameCheck {
  const label = foldConfigurationName(raw);
  if (!label) return { ok: false, code: "name_required", message: "A configuration needs a name — what the drawing or the client calls it." };
  if (!VARIANT_LABEL_PATTERN.test(label)) {
    return { ok: false, code: "name_shape", message: `“${label}” cannot be a configuration name: it has to be ${VARIANT_LABEL_RULE}.` };
  }
  const clash = taken.find((name) => foldConfigurationName(name.label) === label);
  if (clash) {
    return clash.status === "active"
      ? { ok: false, code: "name_taken", message: `${billLine} already has a configuration called ${label}.` }
      : {
          ok: false,
          code: "name_retired",
          message: `${billLine} had a configuration called ${label}, and it was retired. A name is never reused, because somebody may have quoted it — choose another.`,
        };
  }
  return { ok: true, label };
}

/**
 * The fields that usually DIFFER between configurations of one bill line, by
 * BWS `json_id` (db/seed/0001_spec_fields.sql): COM 1, COM 2, COM 3 — in that
 * order, which is the order the new configuration's screen shows them in. A
 * qualifier (0029) is the second line of the same field, so it goes with it.
 *
 * THIS REPO'S JUDGEMENT, and a question for Matthew. The AP364 pages that are
 * configurations of one chair differ in fabric; nothing written down says
 * which fields a configuration may differ in. The main timber and metal
 * finishes (4, 5) are deliberately NOT here: Max chose, 2026-09-23, to carry
 * the bill line's shared specs — dimensions, timber, metal — ticked.
 */
export const DIFFERING_FIELD_JSON_IDS: readonly number[] = [1, 2, 14];

export function isDifferingField(jsonId: number | null | undefined): boolean {
  return jsonId !== null && jsonId !== undefined && DIFFERING_FIELD_JSON_IDS.includes(jsonId);
}

export type CarryKind = "attribute" | "answer" | "dimension_note";

/** One thing on the bill line that could be carried onto the new configuration. */
export type CarryItem = {
  kind: CarryKind;
  /** The attribute's or answer's id; the bill line's own id for its dimension note. */
  id: string;
  /** The row's version, or the bill line's for its dimension note. */
  version: number;
  label: string;
  value: string | null;
  qualifier: string | null;
  /** `confirmed` / `tbc` for a spec, `confirmed` / `na` for an answer. */
  state: string;
  jsonId: number | null;
  /** The spec's `attr_group` (dimension, material, finish, note, …), so the
   *  panel can fold the list by group. Null for an answer and for the note. */
  group?: string | null;
  /** Where it came from: a document and page, or typed. */
  source: { filename: string | null; page: number | null } | null;
  differing: boolean;
};

export type CarryRef = { kind: CarryKind; id: string; version: number };

export function carryKey(item: { kind: CarryKind; id: string }): string {
  return `${item.kind}:${item.id}`;
}

/** Everything ticked except a differing field. */
export function defaultTicked(item: Pick<CarryItem, "differing">): boolean {
  return !item.differing;
}

/** The default selection, as keys. */
export function defaultSelection(items: readonly CarryItem[]): Set<string> {
  return new Set(items.filter(defaultTicked).map(carryKey));
}

/**
 * Whether the offer the screen showed is the offer that is there now: the
 * same rows at the same versions, no more and no fewer. The `targets_changed`
 * discipline — the client sends ids and versions, never values.
 */
export function sameOffer(shown: readonly CarryRef[], live: readonly CarryRef[]): boolean {
  if (shown.length !== live.length) return false;
  const liveByKey = new Map(live.map((item) => [carryKey(item), item.version]));
  return shown.every((item) => liveByKey.get(carryKey(item)) === item.version);
}

/**
 * What stops reaching the export when this configuration is added.
 *
 * Only when the bill line is NOT already split: its first configuration makes
 * it a heading, and everything on it the person did not carry leaves the file
 * with it. Once it is already a heading, adding another configuration changes
 * nothing about what the bill line exports — it exports nothing already.
 */
export function stopsBeingExported(
  offered: readonly CarryItem[],
  ticked: ReadonlySet<string>,
  alreadySplit: boolean,
): CarryItem[] {
  if (alreadySplit) return [];
  return offered.filter((item) => !ticked.has(carryKey(item)));
}

/** The sentence the panel shows above Add, and the route's refusal repeats. */
export function describeExportEffect(
  stops: readonly CarryItem[],
  alreadySplit: boolean,
  billLine: string,
  name: string,
): string {
  const configuration = name ? `${billLine} ${name}` : "the new configuration";
  if (alreadySplit) {
    return `${billLine} is already a heading. Adding ${configuration} changes nothing it exports; the export carries its configurations.`;
  }
  const head = `${billLine} becomes a heading: from now on the export carries its configurations, starting with ${configuration}, and not the bill line itself.`;
  if (stops.length === 0) return `${head} Everything it holds is carried across, so nothing stops being exported.`;
  const named = stops.map((item) => item.label).join(", ");
  return `${head} ${stops.length} thing${stops.length === 1 ? "" : "s"} you left unticked will stop being exported: ${named}.`;
}

/**
 * What retiring a configuration does, in the words the panel shows before
 * the person confirms it.
 *
 * `othersLive` is how many OTHER live configurations the bill line has. At
 * zero, the bill line is an item again — `parentIsSupersededBy` reads a live
 * child, never a stored flag — and its own specs reach the export again.
 */
export function describeRetireEffect(billLine: string, name: string, othersLive: number): string {
  const head = `${billLine} ${name} stops being exported.`;
  if (othersLive === 0) {
    return `${head} It is the last live configuration, so ${billLine} becomes an item again and its own specs are exported again.`;
  }
  return `${head} ${billLine} stays a heading: its other ${othersLive === 1 ? "configuration is" : `${othersLive} configurations are`} still exported.`;
}
