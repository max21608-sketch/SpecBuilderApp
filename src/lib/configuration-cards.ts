// One card per CODE, not one card per page.
//
// ============================================================================
// WHAT A REVIEWER IS ACTUALLY LOOKING AT
//
// The AP364 set draws S-201 on two pages, S-200 on two, S-301 on four. Same
// chair, same geometry, different fabric and timber callouts; the bill has ONE
// line each. Those pages are CONFIGURATIONS of one item, and confirming them
// creates one variant record per page under the bill line (`variant-create.ts`).
//
// Rendered as one card per page, that truth was carried by a grey chip and a
// sentence, above four cards a reviewer had to hold in their head as related.
// Every card repeated the same four dimensions, so the same geometry was
// checked four times and the one thing that genuinely differs -- the fabric --
// was the part scrolled past.
//
// So: one card, one chip per configuration, the geometry once, and each
// configuration's own callouts below it in its own colour. Asked for directly
// by Max on 2026-09-16.
//
// ============================================================================
// THIS FILE DECIDES NOTHING. IT ONLY SHAPES.
//
// Every rule still lives where it lived: the letters come from
// `variantLettersByItem`, the grouping from `groupItemsByCode`, the row
// matching from `measuredKey`, the blockers from `drawingItemBlockers`. A
// second implementation of any of them would be a screen that groups cards one
// way while the confirm route writes them another -- which is the exact defect
// `configurationGroup` had, comparing `itemCodeRaw` raw while the letters
// folded it.
//
// Nothing here is stored, and nothing here crosses runs. Letters are per staged
// RUN because the confirm derives them from `run.staged.items`, so a code drawn
// once in each of two files of a pack is letter A in both and writes to the
// same variant. Grouping those two pages into one card would promise a split
// the confirm does not make; the pack screen's `duplicateTargets` banner is
// what reports that case, and it stays.
// ============================================================================
import {
  groupItemsByCode,
  measuredKey,
  measuredRows,
  variantLettersByItem,
  type DrawingItem,
  type DrawingObservation,
} from "@/lib/drawing-document";
import { parseDimensionFigure } from "@/lib/dimensions";
import type { DimensionSlot } from "@/lib/spec-vocab";

/** Where a configuration's page has got to. Letters ignore this entirely. */
export type MemberState = "pending" | "applied" | "ignored";

export type ConfigurationMember<R> = {
  item: DrawingItem;
  /** A, B, C… — derived from page order, never stored, never sent. */
  letter: string;
  resolution: R | undefined;
  pending: DrawingObservation[];
  state: MemberState;
};

/**
 * One line of the shared geometry table: the leader's row, and the row on
 * every other page that states the same measurement.
 */
export type SharedRow = {
  key: string;
  leader: DrawingObservation;
  /** itemId -> that page's matching row. The leader is in here too. */
  byMember: Record<string, DrawingObservation>;
  /** Letters whose page does not state this measurement at all. */
  missingOn: string[];
};

export type GeometryDifference = {
  slot: DimensionSlot;
  /** letter -> the figure and unit that page gives, or null where it gives none. */
  byLetter: Record<string, string | null>;
};

export type GeometryComparison =
  | {
      status: "shared";
      leaderId: string;
      rows: SharedRow[];
      /** itemId -> measured rows only that page states. */
      extras: Record<string, DrawingObservation[]>;
      /** Letters whose page measures nothing at all. */
      withoutGeometry: string[];
    }
  | { status: "disagree"; differences: GeometryDifference[] };

export type ReviewCard<R> =
  | { kind: "single"; id: string; page: number | null; item: DrawingItem }
  | {
      kind: "configurations";
      id: string;
      /** The folded code, which is what the grouping is keyed on. */
      code: string;
      /** The code as the first page printed it — what a chip says. */
      codeRaw: string;
      name: string | null;
      page: number | null;
      members: ConfigurationMember<R>[];
      geometry: GeometryComparison;
    };

function stateOf(item: DrawingItem): MemberState {
  if (item.observations.some((o) => o.reviewStatus === "pending")) return "pending";
  if (item.observations.some((o) => o.reviewStatus === "applied")) return "applied";
  return "ignored";
}

/**
 * How one page states its five slots: the figure and the unit, per slot.
 *
 * The comparison is over SLOTS, not over every measured row. Two pages of one
 * chair routinely differ by a radius or a stitch spacing the model read on one
 * and not the other, and failing the whole card into "these pages disagree"
 * over a 5mm reveal would put four full tables back on screen for nothing. The
 * slots are what BWS receives and what "the same item" means to a reviewer.
 */
function slotSignature(item: DrawingItem): Map<DimensionSlot, string> {
  const signature = new Map<DimensionSlot, string>();
  for (const observation of item.observations) {
    if (observation.reviewStatus !== "pending") continue;
    if (!observation.dimensionSlot) continue;
    const figure = parseDimensionFigure(observation.value ?? observation.valueRaw).figure;
    signature.set(observation.dimensionSlot, `${figure ?? "-"}${observation.unit ?? ""}`);
  }
  return signature;
}

const sameSignature = (a: Map<DimensionSlot, string>, b: Map<DimensionSlot, string>) =>
  a.size === b.size && [...a].every(([slot, value]) => b.get(slot) === value);

/**
 * Do these pages draw the same thing, and if so which rows are which?
 *
 * NEVER AVERAGED and never resolved. Two pages that disagree about the height
 * are either a configuration split — genuinely different sizes, which is a
 * real thing a bill line can be — or one of them is a misread. Both are a
 * person's call, so the card shows the figures side by side and says which is
 * which, and each page keeps its own.
 */
export function compareGeometry(members: readonly { item: DrawingItem; letter: string }[]): GeometryComparison {
  const measuring = members.filter((member) => measuredRows(member.item).length > 0);
  const withoutGeometry = members.filter((member) => measuredRows(member.item).length === 0).map((m) => m.letter);

  if (measuring.length === 0) {
    return { status: "shared", leaderId: members[0]?.item.id ?? "", rows: [], extras: {}, withoutGeometry };
  }

  const signatures = measuring.map((member) => ({ member, signature: slotSignature(member.item) }));
  const first = signatures[0]!;
  const disagreeing = signatures.filter((entry) => !sameSignature(entry.signature, first.signature));
  if (disagreeing.length > 0) {
    const slots = new Set<DimensionSlot>();
    for (const entry of signatures) for (const slot of entry.signature.keys()) slots.add(slot);
    const differences: GeometryDifference[] = [];
    for (const slot of slots) {
      const byLetter: Record<string, string | null> = {};
      const distinct = new Set<string | null>();
      for (const entry of signatures) {
        const value = entry.signature.get(slot) ?? null;
        byLetter[entry.member.letter] = value;
        distinct.add(value);
      }
      if (distinct.size > 1) differences.push({ slot, byLetter });
    }
    return { status: "disagree", differences };
  }

  // The leader's rows are the table; every other page's matching row rides
  // along so an edit can be written to each page's own observation.
  const leader = first.member;
  const rows: SharedRow[] = [];
  const claimed = new Map<string, Set<string>>();
  for (const row of measuredRows(leader.item)) {
    const key = measuredKey(row);
    if (key === null) continue;
    const byMember: Record<string, DrawingObservation> = { [leader.item.id]: row };
    const missingOn: string[] = [];
    (claimed.get(leader.item.id) ?? claimed.set(leader.item.id, new Set()).get(leader.item.id)!).add(row.id);
    for (const member of measuring) {
      if (member.item.id === leader.item.id) continue;
      const match = measuredRows(member.item).find((candidate) => measuredKey(candidate) === key);
      if (match) {
        byMember[member.item.id] = match;
        (claimed.get(member.item.id) ?? claimed.set(member.item.id, new Set()).get(member.item.id)!).add(match.id);
      } else {
        missingOn.push(member.letter);
      }
    }
    rows.push({ key, leader: row, byMember, missingOn });
  }

  const extras: Record<string, DrawingObservation[]> = {};
  for (const member of measuring) {
    if (member.item.id === leader.item.id) continue;
    const taken = claimed.get(member.item.id) ?? new Set<string>();
    const only = measuredRows(member.item).filter((row) => !taken.has(row.id));
    if (only.length > 0) extras[member.item.id] = only;
  }

  return { status: "shared", leaderId: leader.item.id, rows, extras, withoutGeometry };
}

/**
 * Every card one staged run's items produce, in page order.
 *
 * A code drawn once is a `single` and renders exactly as it always has. So is
 * a page with no code — it is its own item, it can never commit, and it opens
 * collapsed.
 */
export function configurationCards<R extends { variantLabel?: string | null }>(
  items: readonly DrawingItem[],
  resolved: ReadonlyMap<string, R | undefined>,
): ReviewCard<R>[] {
  const letters = variantLettersByItem(items);
  const groups = groupItemsByCode(items);
  const cards: ReviewCard<R>[] = [];
  const grouped = new Set<string>();

  for (const [code, group] of groups) {
    if (group.length < 2) continue;
    for (const item of group) grouped.add(item.id);
    const members: ConfigurationMember<R>[] = group.map((item) => ({
      item,
      // `resolution.variantLabel` is the server's answer and the one the
      // confirm will use; the local computation is the fallback for a screen
      // rendering before resolution has arrived. They agree by construction —
      // both are `variantLettersByItem` over the same items.
      letter: resolved.get(item.id)?.variantLabel ?? letters.get(item.id) ?? "",
      resolution: resolved.get(item.id),
      pending: item.observations.filter((o) => o.reviewStatus === "pending"),
      state: stateOf(item),
    }));
    cards.push({
      kind: "configurations",
      id: `code:${code}`,
      code,
      codeRaw: group[0]!.itemCodeRaw ?? code,
      name: group.find((item) => item.itemNameRaw)?.itemNameRaw ?? null,
      page: group[0]!.page ?? null,
      members,
      geometry: compareGeometry(members.filter((member) => member.state === "pending")),
    });
  }

  for (const item of items) {
    if (grouped.has(item.id)) continue;
    cards.push({ kind: "single", id: item.id, page: item.page ?? null, item });
  }

  return cards.sort(
    (a, b) => (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
  );
}

/** Is there anything left to review on this card? */
export function cardHasPending(card: ReviewCard<unknown>): boolean {
  const items = card.kind === "single" ? [card.item] : card.members.map((member) => member.item);
  return items.some((item) => item.observations.some((o) => o.reviewStatus === "pending"));
}

/**
 * Which runs the card applies to, across its configurations.
 *
 * ONE SET FOR THE CARD, because ticking a run is a statement about the CODE.
 * Per-configuration targets would let A apply to the VE run and B not, which
 * produces `S-201 A` under a bill line that has no B — a family nobody can
 * read and a quantity nobody can allocate.
 *
 * `mixed` is where the configurations currently disagree, which is a state the
 * screens can reach because targets were per page until now. It renders as an
 * indeterminate tick and one click settles it.
 */
export function sharedTargets<R>(members: readonly ConfigurationMember<R>[]): {
  ticked: Set<string>;
  mixed: Set<string>;
} {
  const pending = members.filter((member) => member.state === "pending");
  const counts = new Map<string, number>();
  for (const member of pending) {
    for (const recordId of new Set(member.resolution ? memberTargets(member) : [])) {
      counts.set(recordId, (counts.get(recordId) ?? 0) + 1);
    }
  }
  const ticked = new Set<string>();
  const mixed = new Set<string>();
  for (const [recordId, count] of counts) {
    if (count === pending.length) ticked.add(recordId);
    else mixed.add(recordId);
  }
  return { ticked, mixed };
}

function memberTargets<R>(member: ConfigurationMember<R>): string[] {
  const resolution = member.resolution as { targets?: string[] } | undefined;
  return resolution?.targets ?? [];
}
