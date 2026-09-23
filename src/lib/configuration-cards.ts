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
  codeGroupFor,
  variantLettersByItem,
  namedConfigurationPlans,
  alreadyRecorded,
  crossPageClaims,
  stateToWrite,
  codeConfigurations,
  configurationEditSummary,
  FABRIC_SLOTS,
  METAL_SLOTS,
  TIMBER_SLOTS,
  type NamedConfiguration,
  type StagedDrawings,
  type DrawingItem,
  type DrawingObservation,
} from "@/lib/drawing-document";
import { parseDimensionFigure } from "@/lib/dimensions";
import { DIMENSION_SLOT_LABELS, type DimensionSlot } from "@/lib/spec-vocab";

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
  | { kind: "single"; id: string; page: number | null; pages: number[]; item: DrawingItem }
  | {
      kind: "configurations";
      id: string;
      /**
       * Whether these pages are SEVERAL THINGS TO MAKE, or one item described
       * more than once.
       *
       * The card is the same shape either way — one heading, the geometry once,
       * each page's own finishes below it — because reviewing a chair drawn on
       * its specification sheet and again on its shop drawing is the same job
       * as reviewing two fabric options. What changes is what it CLAIMS: a
       * split says two records will be created and the bill line will stop
       * exporting, and saying that about one armchair is the S-200 defect.
       *
       * False for a version 2 run the model called `one_item` or `unclear`, and
       * for any run where nothing allocated a variant letter.
       */
      split: boolean;
      /**
       * WHY these pages were put together, in the model's own words, quoting
       * them — or null on a version 1 run, where a page count decided it and
       * there is no reason to give.
       *
       * It is on the card because the grouping is the most consequential thing
       * the card asserts: split the wrong way and one armchair becomes several
       * BWS jobs, or several chairs collapse into one. A reviewer settles that
       * by reading this against the pages, which is the same job as checking a
       * dimension against its drawing.
       */
      groupedBecause: string | null;
      /** The folded code, which is what the grouping is keyed on. */
      code: string;
      /** The code as the first page printed it — what a chip says. */
      codeRaw: string;
      name: string | null;
      page: number | null;
      /** Every page this item is drawn on — see `pagesOfCard`. */
      pages: number[];
      members: ConfigurationMember<R>[];
      geometry: GeometryComparison;
      /**
       * A code whose pages NAME its configurations (schemaVersion 3): one tab
       * per configuration, named as the document names it. Null for a lettered
       * or one-item card, which keeps `members` and `geometry` as before.
       */
      named: NamedCardView | null;
      /** What the model said about these PAGES, or null on a version 1 run. */
      relationshipRead: "one_item" | "configurations" | "unclear" | null;
      /** The reviewer's own answer (brief C1), or null. */
      relationshipByReviewer: "one_item" | "configurations" | null;
    };

/** One row on a named configuration's tab — the SAME observation on every tab it lands on. */
export type NamedTabRow = {
  item: DrawingItem;
  observation: DrawingObservation;
  /** Every configuration this row lands on, in the code's order. */
  lands: string[];
};

export type NamedTab = {
  /** Folded, as stored: `TYPE 2`. */
  label: string;
  /** Its place in the code's list — what colours it. */
  index: number;
  /** Every wording the pages used for it. */
  namesRaw: string[];
  /** The rows that land on it, pending ones only, dimensions first. */
  rows: NamedTabRow[];
  /** Pending rows landing on it. */
  pending: number;
  /** Applied once every row that lands on it has been written or ignored. */
  state: MemberState;
};

export type NamedCardView = {
  configurations: NamedConfiguration[];
  tabs: NamedTab[];
  /**
   * Pending rows that land on NO configuration — theirs were removed by a
   * reviewer. On no tab, so the card lists them apart, above the tabs, where
   * they cannot be missed; each is a blocker until somebody places it.
   */
  undecided: NamedTabRow[];
  /** "Read as 4, you set 5 — …", or null when nobody has edited the list. */
  editSummary: string | null;
  /** The configurations as the model read them (empty on a v1/v2 run). */
  read: NamedConfiguration[];
  /**
   * Later-page rows that name the SAME finish, by the client's code, as an
   * earlier page's row in the same field (`crossPageClaims`): folded into that
   * row on the tab, and already recorded at confirm.
   */
  sameFinish: Record<string, { keptId: string; message: string }>;
};

/**
 * Every page of one item, in order.
 *
 * TWO SOURCES, UNIONED, because they answer the question differently and both
 * are true. The staged ITEMS say which pages produced observations; the
 * model's own CODE GROUP says which pages carry the code, including one that
 * staged nothing a reviewer has to rule on — a finishes sheet whose chips are
 * printed and whose figures are not. A swatch is cropped off whichever of them
 * prints the chip, so the picker has to offer both.
 *
 * DEFENSIVE about what it reads. `assertStagedDrawings` casts rather than
 * validates, so a group's `pages` is whatever was written on the day it was
 * staged; a page that is not a positive whole number is dropped rather than
 * offered as a button that cannot render.
 */
export function pagesOfCard(
  items: readonly DrawingItem[],
  doc?: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
): number[] {
  const pages = new Set<number>();
  const add = (page: unknown) => {
    if (typeof page === "number" && Number.isInteger(page) && page > 0) pages.add(page);
  };
  for (const item of items) {
    add(item.page);
    for (const page of (doc ? codeGroupFor(doc, item.itemCodeRaw)?.pages : null) ?? []) add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

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
/**
 * The tabs of a named card: one per configuration of the code, each carrying
 * every pending row that lands on it.
 *
 * A ROW IS LISTED ON EVERY TAB IT LANDS ON AND IS ONE OBSERVATION. The shared
 * geometry is on all five tabs; editing it on TYPE 2 edits it for all of them,
 * because it is one row and the confirm writes it to each. Only one tab is on
 * screen at a time, so there is still one input per observation.
 *
 * `rowsOf` is the SERVER'S landing when the resolution has arrived and the
 * local plan until then — both `namedConfigurationPlans` over the same items.
 */
export function namedTabs(
  pages: readonly DrawingItem[],
  configurations: readonly NamedConfiguration[],
  rowsOf: (item: DrawingItem) => Record<string, string[]> | undefined,
): NamedTab[] {
  const all = configurations.map((entry) => entry.label);
  // Shown in natural order; `index` stays the configuration's place in the
  // code's own list, which is what its colour and its reading are keyed on.
  const order = naturalConfigurationOrder(all);
  const tabs = configurations.map((configuration, index) => {
    const rows: NamedTabRow[] = [];
    let applied = 0;
    for (const item of pages) {
      const landing = rowsOf(item) ?? {};
      for (const observation of item.observations) {
        // `?? all` only for a row the plan never saw; `[]` lands nowhere.
        const lands = landing[observation.id] ?? all;
        if (!lands.includes(configuration.label)) continue;
        if (observation.reviewStatus === "applied") applied += 1;
        if (observation.reviewStatus !== "pending") continue;
        rows.push({ item, observation, lands });
      }
    }
    const state: MemberState = rows.length > 0 ? "pending" : applied > 0 ? "applied" : "ignored";
    return {
      label: configuration.label,
      index,
      namesRaw: configuration.namesRaw,
      rows,
      pending: rows.length,
      state,
    };
  });
  return order.map((label) => tabs.find((tab) => tab.label === label)!);
}

/**
 * THE ORDER A PERSON COUNTS IN, for display: "configuration one, configuration
 * two, configuration three" — not the order the page happened to mention them
 * (S-301's sheet lists "Type 1 & 5" first, so first mention read TYPE 1, TYPE 5,
 * TYPE 2 …).
 *
 * Numbered names first, numeric-aware (`TYPE 2` before `TYPE 10`), then single
 * letters A–Z, then anything else in the order the document gave it. DISPLAY
 * ONLY: the stored order, the confirm's order and the letters are unchanged.
 */
export function naturalConfigurationOrder(labels: readonly string[]): string[] {
  const numbered: { label: string; head: string; n: number; tail: string }[] = [];
  const letters: string[] = [];
  const rest: string[] = [];
  for (const label of labels) {
    const match = /^(.*?)(\d+)(.*)$/.exec(label);
    if (match) numbered.push({ label, head: match[1]!, n: Number(match[2]), tail: match[3]! });
    else if (/^[A-Z]$/.test(label)) letters.push(label);
    else rest.push(label);
  }
  numbered.sort((a, b) => a.head.localeCompare(b.head) || a.n - b.n || a.tail.localeCompare(b.tail));
  letters.sort();
  return [...numbered.map((entry) => entry.label), ...letters, ...rest];
}

/** What one tab shows of its measurements, when two pages state them. */
export type TabMeasurements = {
  /** Rows NOT shown: a later page stating the same measurement a row already on the tab states. */
  hidden: Set<string>;
  /** Kept row id -> the later pages that state the same. */
  sameOn: Map<string, number[]>;
  /** Row id -> "Page 1 and page 2 disagree about the width: …". */
  disagree: Map<string, string>;
};

/**
 * ONE ROW PER MEASUREMENT IN A TAB.
 *
 * S-301's sheet says WIDTH 550 and its shop drawing's front view says 550, and
 * both land on TYPE 1. Shown twice, the tab read as two widths and the composed
 * cell warned "two width values are recorded" four times — about one width.
 *
 * So where two PAGES give a configuration the same slot with the same figure in
 * millimetres and the same state — `alreadyRecorded`, the comparison the
 * confirm uses — the tab shows the first page's row and says the other page
 * states the same. The later row still confirms, as already recorded. Where
 * the figures DIFFER, both rows stay, each saying the pages disagree: that is
 * a real question, and averaging or picking one would answer it for somebody.
 *
 * A row nobody has ruled on (no state yet) is never hidden: it still needs
 * the person, and a hidden row cannot be seen to need anything.
 */
export function tabMeasurements(tab: Pick<NamedTab, "rows">): TabMeasurements {
  const out: TabMeasurements = { hidden: new Set(), sameOn: new Map(), disagree: new Map() };
  const bySlot = new Map<string, NamedTabRow[]>();
  for (const row of tab.rows) {
    const { observation } = row;
    if (observation.attrGroup !== "dimension" || !observation.dimensionSlot) continue;
    bySlot.set(observation.dimensionSlot, [...(bySlot.get(observation.dimensionSlot) ?? []), row]);
  }
  for (const [slot, rows] of bySlot) {
    const ordered = [...rows].sort((a, b) => (a.item.page ?? Number.MAX_SAFE_INTEGER) - (b.item.page ?? Number.MAX_SAFE_INTEGER));
    const kept = ordered[0]!;
    for (const later of ordered.slice(1)) {
      if (later.item.id === kept.item.id) continue; // one page twice: the card's own blocker says so
      const same =
        kept.observation.state !== null &&
        later.observation.state !== null &&
        alreadyRecorded(later.observation, {
          value: kept.observation.value ?? kept.observation.valueRaw,
          unit: kept.observation.unit,
          state: stateToWrite(kept.observation),
        });
      if (same) {
        out.hidden.add(later.observation.id);
        out.sameOn.set(kept.observation.id, [...(out.sameOn.get(kept.observation.id) ?? []), later.item.page ?? 0]);
        continue;
      }
      const name = (DIMENSION_SLOT_LABELS[slot as DimensionSlot] ?? slot).toLowerCase();
      const say = (row: NamedTabRow) =>
        `page ${row.item.page ?? "?"} says ${row.observation.value ?? row.observation.valueRaw ?? "nothing"}${row.observation.unit ?? ""}`;
      const message = `Page ${kept.item.page ?? "?"} and page ${later.item.page ?? "?"} disagree about the ${name}: ${say(kept)}, ${say(later)}. Correct one, or ignore it.`;
      out.disagree.set(kept.observation.id, message);
      out.disagree.set(later.observation.id, message);
    }
  }
  return out;
}

/** Pending rows of a named code that land on no configuration at all. */
export function undecidedRows(
  pages: readonly DrawingItem[],
  rowsOf: (item: DrawingItem) => Record<string, string[]> | undefined,
): NamedTabRow[] {
  const out: NamedTabRow[] = [];
  for (const item of pages) {
    const landing = rowsOf(item) ?? {};
    for (const observation of item.observations) {
      if (observation.reviewStatus !== "pending") continue;
      if (landing[observation.id]?.length === 0) out.push({ item, observation, lands: [] });
    }
  }
  return out;
}

/**
 * A BWS FIELD SKIPPED ON A CONFIGURATION — a warning, never a blocker.
 *
 * Staging claims COM 1, COM 2, COM 3 in order per configuration. A REVIEWER
 * who moves rows between configurations (brief C1), or who names the
 * configurations of a v2 card whose fabrics were claimed page-wide, can leave
 * `TYPE 2`'s only fabric in COM 2 with COM 1 empty — which exports as a fabric
 * in the second slot of a chair that has one. The card says so beside the row;
 * the reviewer moves it with the field control, which is theirs to decide.
 */
export function fieldSlotGaps(
  tabs: readonly NamedTab[],
  fields: readonly { id: string; json_id: number; name: string }[],
): Map<string, string> {
  const families = [FABRIC_SLOTS, TIMBER_SLOTS, METAL_SLOTS].map((slots) =>
    slots.map((jsonId) => fields.find((field) => field.json_id === jsonId)).filter(
      (field): field is { id: string; json_id: number; name: string } => Boolean(field),
    ),
  );
  const out = new Map<string, string>();
  for (const tab of tabs) {
    for (const family of families) {
      const used = new Set<number>();
      const placed: { id: string; index: number }[] = [];
      for (const row of tab.rows) {
        const index = family.findIndex((field) => field.id === row.observation.specFieldId);
        if (index === -1) continue;
        used.add(index);
        placed.push({ id: row.observation.id, index });
      }
      for (const entry of placed) {
        const free = family.findIndex((_, index) => index < entry.index && !used.has(index));
        if (free === -1 || out.has(entry.id)) continue;
        out.set(
          entry.id,
          `On ${tab.label} this is in ${family[entry.index]!.name}, but ${family[free]!.name} is free there.`,
        );
      }
    }
  }
  return out;
}

/** How a row says where else it lands: "shared by all 5", "shared with TYPE 1 · TYPE 5", or nothing. */
export function sharedWithSentence(lands: readonly string[], here: string, total: number): string | null {
  if (lands.length <= 1) return null;
  if (lands.length === total) return `shared by all ${total}`;
  return `shared with ${naturalConfigurationOrder(lands.filter((label) => label !== here)).join(" · ")}`;
}

export function configurationCards<
  R extends { variantLabel?: string | null; named?: { rows: Record<string, string[]> } | null },
>(
  items: readonly DrawingItem[],
  resolved: ReadonlyMap<string, R | undefined>,
  // The DOCUMENT, not only its items, because whether a repeated code is one
  // item or several things to make is the model's answer and lives on the
  // document. Optional so a version 1 run -- and every fixture written before
  // 2026-09-18 -- keeps the page-count reading it was staged under.
  doc?: Pick<StagedDrawings, "schemaVersion" | "codeGroups">,
): ReviewCard<R>[] {
  const letters = variantLettersByItem(items, doc);
  const groups = groupItemsByCode(items, doc);
  // Pages whose code NAMES its configurations. Such a code is a card of its own
  // even when it is drawn on ONE page: S-301's sheet alone is five chairs.
  const plans = namedConfigurationPlans(items, doc);
  const byCode = plans.size > 0 ? codeConfigurations(items, doc) : new Map<string, never>();
  const crossPage = plans.size > 0 ? crossPageClaims(items, doc) : new Map<string, never>();
  const cards: ReviewCard<R>[] = [];
  const grouped = new Set<string>();

  for (const [code, group] of groups) {
    const plan = group.map((item) => plans.get(item.id)).find(Boolean) ?? null;
    if (group.length < 2 && !plan) continue;
    for (const item of group) grouped.add(item.id);
    // TWO DIFFERENT LETTERS, AND KEEPING THEM APART IS THE POINT.
    //
    // The VARIANT letter is what the confirm writes: it creates `S-200 A` as a
    // record of its own and takes the bill line out of the export. It is null
    // unless the model said these pages are configurations.
    //
    // The DISPLAY letter is a position in this card — it colours the chip (A is
    // always sky, so a chip finds its own section), keys the geometry
    // comparison and names a band. Every member needs a distinct one whether or
    // not anything is being split, or two sources collide on one key and the
    // card compares a page with itself.
    // The SERVER'S answer first, exactly as `letter` below resolves it: the
    // resolution is what the confirm will act on, and a card whose sentence
    // disagreed with what the confirm does would be the worse of the two lies.
    const split = Boolean(plan) || group.some((item) => resolved.get(item.id)?.variantLabel ?? letters.get(item.id));
    const members: ConfigurationMember<R>[] = group.map((item, index) => ({
      item,
      // `resolution.variantLabel` is the server's answer and the one the
      // confirm will use; the local computation is the fallback for a screen
      // rendering before resolution has arrived. They agree by construction —
      // both are `variantLettersByItem` over the same items.
      letter:
        resolved.get(item.id)?.variantLabel ??
        letters.get(item.id) ??
        String.fromCharCode(65 + Math.min(index, 25)),
      resolution: resolved.get(item.id),
      pending: item.observations.filter((o) => o.reviewStatus === "pending"),
      state: stateOf(item),
    }));
    cards.push({
      kind: "configurations",
      id: `code:${code}`,
      split,
      groupedBecause: codeGroupFor(doc ?? { schemaVersion: 1 }, group[0]!.itemCodeRaw)?.evidence ?? null,
      relationshipRead: codeGroupFor(doc ?? { schemaVersion: 1 }, group[0]!.itemCodeRaw)?.relationship ?? null,
      relationshipByReviewer:
        group
          .map((item) => item.relationshipByReviewer)
          .find((answer): answer is "one_item" | "configurations" => answer === "one_item" || answer === "configurations") ??
        null,
      code,
      codeRaw: group[0]!.itemCodeRaw ?? code,
      name: group.find((item) => item.itemNameRaw)?.itemNameRaw ?? null,
      page: group[0]!.page ?? null,
      pages: pagesOfCard(group, doc),
      members,
      geometry: compareGeometry(members.filter((member) => member.state === "pending")),
      named: plan
        ? (() => {
            const rowsOf = (item: DrawingItem) => resolved.get(item.id)?.named?.rows ?? plans.get(item.id)?.rows;
            const entry = byCode.get(code);
            const sameFinish: Record<string, { keptId: string; message: string }> = {};
            for (const [id, claim] of crossPage) {
              if (claim.kind === "same_finish" && group.some((item) => item.observations.some((o) => o.id === id))) {
                sameFinish[id] = { keptId: claim.keptId, message: claim.message };
              }
            }
            return {
              configurations: plan.configurations,
              tabs: namedTabs(group, plan.configurations, rowsOf),
              undecided: undecidedRows(group, rowsOf),
              editSummary: configurationEditSummary(entry),
              read: entry?.read ?? [],
              sameFinish,
            };
          })()
        : null,
    });
  }

  for (const item of items) {
    if (grouped.has(item.id)) continue;
    cards.push({ kind: "single", id: item.id, page: item.page ?? null, pages: pagesOfCard([item], doc), item });
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
