// What a bill line's configurations have in common, and where they differ.
//
// ============================================================================
// COMPUTED, NEVER STORED — AND NEVER INHERITED.
//
// S-301 is one bill line drawn as five configurations. The five share a
// seat height, a frame, a timber; they differ in the cloth. Max, 2026-09-23:
// the bill line's own screen must show what is COMMON to all of them, and an
// edit there must change it on every one.
//
// The obvious model is inheritance — the line holds the common specs and each
// configuration holds only what differs — and it is rejected. Every loader in
// this app reads a configuration as a whole record: the export ships it, the
// gates judge it, TGQ tiers it, the chase asks about it, completion counts it.
// Inheritance would put a second source of truth under each of those, and the
// day one of them forgot to look up would be a configuration exported without
// its seat height. So each configuration keeps its OWN full copy, "common" is
// a reading taken over those copies here, and an edit to a common row fans
// out to every copy (`POST /api/records/[id]/common`).
//
// ---- WHAT "COMMON" MEANS, EXACTLY ----------------------------------------
//
// A group is COMMON when every active configuration has EXACTLY ONE live row
// in it, and all of those rows say the same thing: value, unit, state and
// qualifier. Anything else DIFFERS, and a differing row is never offered as
// one edit — that is the trap this whole reading exists to avoid: a "common"
// edit that silently overwrites the configuration somebody deliberately
// changed. So:
//
//   * a row on only SOME configurations differs — the others say "none", which
//     is a real difference and not a gap to fill in;
//   * a configuration with TWO rows in one group differs — the edit would
//     have to choose which of them it meant;
//   * values are compared EXACTLY (trimmed). `Oak` and `oak` differ. Folding
//     them would make a common edit replace a value nobody saw as different,
//     which is the normaliseFinishCode rule: a fold clever enough to merge two
//     spellings is clever enough to merge two things somebody kept apart.
//
// ---- HOW ROWS ARE MATCHED ACROSS CONFIGURATIONS --------------------------
//
// By what the row IS, in this order, first match wins:
//
//   1. its DIMENSION SLOT — W, D, H, SH, Dia. One per record by index (0011).
//   2. its BWS FIELD — COM 1, Main timber finish. One per record by index.
//   3. its GROUP and its LABEL, folded by case and whitespace — a note, a
//      hardware line, anything the register has no field for.
//
// A slot or a field is the app's own name for the row and cannot be two
// things; a label is the document's, which is why it is last and why two rows
// sharing one make the group differ rather than picking one.
// ============================================================================
import type { AttributeGroup, AttributeState, AttributeUnit, DimensionSlot } from "@/lib/spec-vocab";
import { DIMENSION_SLOTS } from "@/lib/spec-vocab";
import { isFinishGroup } from "@/lib/finishes";

/** One live attribute on one configuration, as the record route loads it. */
export type CommonSourceAttribute = {
  id: string;
  version: number;
  attrGroup: AttributeGroup;
  label: string;
  value: string | null;
  unit: AttributeUnit | null;
  qualifier: string | null;
  state: AttributeState;
  dimensionSlot: DimensionSlot | null;
  specFieldId: string | null;
  /** The BWS field's own name, for the heading. Null for a slot or a label group. */
  fieldName: string | null;
  sortOrder: number;
};

/**
 * One configuration, with its live attributes. Generic over the attribute so
 * a screen can carry its own display columns (the source page, the finish
 * code) through the reading and get them back typed on each member.
 */
export type CommonSourceConfiguration<A extends CommonSourceAttribute = CommonSourceAttribute> = {
  recordId: string;
  /** `12.3` — what the screen calls it. */
  number: string;
  /** `TYPE 3` — what the document called it. */
  variantLabel: string;
  version: number;
  attributes: A[];
};

export type CommonGroupKey = string;

/** Where a group is shown: the order the brief asks for. */
export type CommonSection = "dimensions" | "finishes" | "notes";

export type CommonMember<A extends CommonSourceAttribute = CommonSourceAttribute> = {
  recordId: string;
  number: string;
  variantLabel: string;
  /** Empty where this configuration says nothing in this group. */
  rows: A[];
};

export type CommonGroup<A extends CommonSourceAttribute = CommonSourceAttribute> = {
  key: CommonGroupKey;
  section: CommonSection;
  /** What the heading reads. The slot's name, the BWS field's, or the document's label. */
  title: string;
  attrGroup: AttributeGroup;
  dimensionSlot: DimensionSlot | null;
  specFieldId: string | null;
  status: "common" | "differs";
  /** The shared statement, on a common group only. */
  shared: { label: string; value: string | null; unit: AttributeUnit | null; qualifier: string | null; state: AttributeState } | null;
  /** One per configuration, in the order they were given. */
  members: CommonMember<A>[];
};

export type CommonReading<A extends CommonSourceAttribute = CommonSourceAttribute> = {
  groups: CommonGroup<A>[];
  /** How many configurations the reading is over. */
  configurationCount: number;
};

function fold(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The key a row is matched on across configurations. Exported so the route re-derives the same one. */
export function commonGroupKey(attribute: Pick<CommonSourceAttribute, "dimensionSlot" | "specFieldId" | "attrGroup" | "label">): CommonGroupKey {
  if (attribute.dimensionSlot) return `slot:${attribute.dimensionSlot}`;
  if (attribute.specFieldId) return `field:${attribute.specFieldId}`;
  return `label:${attribute.attrGroup}:${fold(attribute.label)}`;
}

/** Which heading a group is shown under. Exported so a configuration's own tab uses the same split. */
export function sectionOfGroup(attrGroup: AttributeGroup): CommonSection {
  if (attrGroup === "dimension") return "dimensions";
  if (isFinishGroup(attrGroup) || attrGroup === "material") return "finishes";
  return "notes";
}

const SECTION_ORDER: Record<CommonSection, number> = { dimensions: 0, finishes: 1, notes: 2 };

function same(a: CommonSourceAttribute, b: CommonSourceAttribute): boolean {
  const text = (value: string | null) => (value ?? "").trim();
  return (
    text(a.value) === text(b.value) &&
    (a.unit ?? null) === (b.unit ?? null) &&
    a.state === b.state &&
    text(a.qualifier) === text(b.qualifier)
  );
}

/**
 * The reading, over every active configuration of one bill line.
 *
 * Fewer than two configurations has nothing to compare, and returns no groups:
 * "common to all 1" is a sentence about one record, and that record's own
 * screen already says it.
 */
export function readCommonSpecs<A extends CommonSourceAttribute>(
  configurations: readonly CommonSourceConfiguration<A>[],
): CommonReading<A> {
  if (configurations.length < 2) return { groups: [], configurationCount: configurations.length };

  const byKey = new Map<CommonGroupKey, { first: A; members: Map<string, A[]> }>();
  for (const configuration of configurations) {
    for (const attribute of configuration.attributes) {
      const key = commonGroupKey(attribute);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { first: attribute, members: new Map() };
        byKey.set(key, entry);
      }
      const rows = entry.members.get(configuration.recordId) ?? [];
      rows.push(attribute);
      entry.members.set(configuration.recordId, rows);
    }
  }

  const groups: CommonGroup<A>[] = [];
  for (const [key, entry] of byKey) {
    const members: CommonMember<A>[] = configurations.map((configuration) => ({
      recordId: configuration.recordId,
      number: configuration.number,
      variantLabel: configuration.variantLabel,
      rows: [...(entry.members.get(configuration.recordId) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    }));
    const everyOneHasOne = members.every((member) => member.rows.length === 1);
    const reference = members[0]?.rows[0] ?? null;
    const common = everyOneHasOne && reference !== null && members.every((member) => same(member.rows[0]!, reference));

    const first = entry.first;
    groups.push({
      key,
      section: sectionOfGroup(first.attrGroup),
      title: first.dimensionSlot ? first.dimensionSlot : first.fieldName?.trim() || first.label,
      attrGroup: first.attrGroup,
      dimensionSlot: first.dimensionSlot,
      specFieldId: first.specFieldId,
      status: common ? "common" : "differs",
      shared:
        common && reference
          ? {
              label: reference.label,
              value: reference.value,
              unit: reference.unit,
              qualifier: reference.qualifier,
              state: reference.state,
            }
          : null,
      members,
    });
  }

  // Dimensions in W, D, H, SH, Dia order — the composed cell's own — then
  // fabrics and finishes, then notes; within a section, by the first row's
  // place on its record.
  const slotRank = (slot: DimensionSlot | null) => (slot ? DIMENSION_SLOTS.indexOf(slot) : DIMENSION_SLOTS.length);
  const firstOrder = (group: CommonGroup<A>) =>
    Math.min(...group.members.flatMap((member) => member.rows.map((row) => row.sortOrder)), Number.MAX_SAFE_INTEGER);
  groups.sort(
    (a, b) =>
      SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
      slotRank(a.dimensionSlot) - slotRank(b.dimensionSlot) ||
      firstOrder(a) - firstOrder(b) ||
      a.key.localeCompare(b.key),
  );

  return { groups, configurationCount: configurations.length };
}

/**
 * Every row the screen showed for a group, as `{attributeId, version}` —
 * what a common edit sends back as `seen`, so the server can refuse it if any
 * one of them moved.
 */
export function seenRows(group: CommonGroup<CommonSourceAttribute>): { attributeId: string; version: number }[] {
  return group.members.flatMap((member) => member.rows.map((row) => ({ attributeId: row.id, version: row.version })));
}

// ---------------------------------------------------------------------------
// The checklist half
// ---------------------------------------------------------------------------

/** One checklist answer on one configuration. */
export type CommonSourceAnswer = {
  answerId: string | null;
  requirementId: string;
  prompt: string;
  jsonId: number | null;
  /** A readiness question's key into Matthew's matrix, which is also how its palette is found. */
  localKey?: string | null;
  value: string | null;
  qualifier: string | null;
  state: string;
  version: number | null;
};

export type CommonAnswerGroup = {
  requirementId: string;
  prompt: string;
  jsonId: number | null;
  localKey: string | null;
  status: "common" | "differs";
  /** The shared answer, on a common group only. */
  shared: { value: string | null; qualifier: string | null; state: string } | null;
  members: { recordId: string; number: string; variantLabel: string; answer: CommonSourceAnswer | null }[];
};

/**
 * Checklist questions answered IDENTICALLY — value, qualifier and state — on
 * every configuration, and the ones that are not.
 *
 * `missing` on all five is common: nobody has looked at any of them, and
 * answering once is exactly the fan-out that saves four visits (Access, which
 * is the same on every chair on the floor, is the proof). A question one
 * configuration has no row for — its category was changed, say — differs.
 */
export function readCommonAnswers(
  configurations: readonly { recordId: string; number: string; variantLabel: string; answers: CommonSourceAnswer[] }[],
): CommonAnswerGroup[] {
  if (configurations.length < 2) return [];
  const order: string[] = [];
  const byRequirement = new Map<
    string,
    { prompt: string; jsonId: number | null; localKey: string | null; answers: Map<string, CommonSourceAnswer> }
  >();
  for (const configuration of configurations) {
    for (const answer of configuration.answers) {
      let entry = byRequirement.get(answer.requirementId);
      if (!entry) {
        entry = { prompt: answer.prompt, jsonId: answer.jsonId, localKey: answer.localKey ?? null, answers: new Map() };
        byRequirement.set(answer.requirementId, entry);
        order.push(answer.requirementId);
      }
      entry.answers.set(configuration.recordId, answer);
    }
  }
  const text = (value: string | null) => (value ?? "").trim();
  return order.map((requirementId) => {
    const entry = byRequirement.get(requirementId)!;
    const members = configurations.map((configuration) => ({
      recordId: configuration.recordId,
      number: configuration.number,
      variantLabel: configuration.variantLabel,
      answer: entry.answers.get(configuration.recordId) ?? null,
    }));
    const reference = members[0]?.answer ?? null;
    const common =
      reference !== null &&
      members.every(
        (member) =>
          member.answer !== null &&
          member.answer.state === reference.state &&
          text(member.answer.value) === text(reference.value) &&
          text(member.answer.qualifier) === text(reference.qualifier),
      );
    return {
      requirementId,
      prompt: entry.prompt,
      jsonId: entry.jsonId,
      localKey: entry.localKey,
      status: common ? "common" : "differs",
      shared: common && reference ? { value: reference.value, qualifier: reference.qualifier, state: reference.state } : null,
      members,
    };
  });
}
