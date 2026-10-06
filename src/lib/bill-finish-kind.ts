// What a bill's finish line IS, and which BWS field it fills — one decision,
// called by the BOQ confirm (what it writes) and the review GET (the sentence
// under each finish line), so the two cannot disagree about where a line goes.
//
// ============================================================================
// A FINISH LINE'S KIND DECIDES ITS SLOTS (2026-10-06).
//
// A specifier's bill lists an item and then every finish it carries on a line
// of its own: fabrics, leathers, a metal, a timber, a trim. Until this file
// the confirm wrote EVERY such line as a fabric into the next free COM — a
// polished-nickel metal in COM 2 labelled "Fabric", a timber in COM 3 — and
// the fourth line under one item refused the whole bill (`no_free_com`), so a
// bill whose items carry four to six finishes could not be confirmed at all.
//
// The rules, each a trap rather than a preference:
//
//   * THE KIND IS READ FROM THE LINE, NEVER FROM THE ITEM. A banquette is not
//     "probably fabric". The code first — the bill's own `F-<KIND>-<n>` shape
//     (`billFinishCodeKind`), because a code stating TR says trim whatever
//     the words beside it name — then `classifyCallout`, the ONE reading the
//     drawings path uses (its words, fabric before metal before timber, then
//     its code prefixes), so a bill and a drawing cannot disagree about
//     whether `WD-05` is a timber. Its last step, the caption naming the item
//     itself, is NOT reached: no item name is passed. Then the bill's own
//     `COL`. Else NO KIND, and no field.
//   * NOTHING IS DROPPED AND NOTHING REFUSES. A line whose kind has no free
//     slot (a fourth fabric), or no BWS field at all (a trim, hardware, a line
//     that does not say what it is), is still written — what a document said
//     is kept (M8 step 3) — with no `spec_field_id` and a label saying what it
//     is. A confidently wrong field is what this refuses to produce, not a
//     line.
//   * LEATHER IS A FABRIC FOR SLOTTING. BWS has COM 1–3 and no leather field;
//     `FinishKind` in the library may tell them apart, and that kind is
//     suggested to a person, never written here.
//   * THE GROUP AND LABEL MATCH THE DRAWINGS PATH: a fabric is `material`, a
//     timber or a metal `finish`, hardware `hardware`, anything else `other`
//     (`classifyCallout`'s own `reading`). The label is the kind in a word,
//     because a bill's finish line has no caption of its own.
// ============================================================================
import { classifyCallout, FABRIC_SLOTS, METAL_SLOTS, TIMBER_SLOTS } from "@/lib/drawing-document";
import { normaliseName } from "@/lib/matching";
import { fabricOwnCode } from "@/lib/boq-row-kinds";
import { BILL_FABRIC_WORDS, billFinishCodeKind } from "@/lib/material-words";

export type BillFinishKind = "fabric" | "timber" | "metal" | "hardware" | "trim" | null;

export type BillFinishReading = {
  kind: BillFinishKind;
  /** What decided it, in a reviewer's words; null where nothing did. */
  reason: string | null;
};

/** The kinds that have a BWS field, and the fields they fill in order. */
const SLOTS: Partial<Record<Exclude<BillFinishKind, null>, readonly number[]>> = {
  fabric: FABRIC_SLOTS,
  timber: TIMBER_SLOTS,
  metal: METAL_SLOTS,
};

/** The BWS field names for the slots a finish line can fill (`db/seed/0001_spec_fields.sql`). */
const SLOT_NAMES: Record<number, string> = {
  1: "COM 1",
  2: "COM 2",
  14: "COM 3",
  4: "Main timber finish",
  31: "Timber Finish 2",
  143: "Timber Finish 3",
  5: "Main metal finish",
  35: "Metal Finish 2",
};

/** Every json id a bill finish line can fill — what the confirm resolves to field ids. */
export const BILL_FINISH_SLOT_IDS: readonly number[] = [...FABRIC_SLOTS, ...TIMBER_SLOTS, ...METAL_SLOTS];

/** The row a finish line of each kind writes: group and label. */
export function billFinishShape(kind: BillFinishKind): { attrGroup: "material" | "finish" | "hardware" | "other"; label: string } {
  switch (kind) {
    case "fabric":
      return { attrGroup: "material", label: "Fabric" };
    case "timber":
      return { attrGroup: "finish", label: "Timber" };
    case "metal":
      return { attrGroup: "finish", label: "Metal" };
    case "hardware":
      return { attrGroup: "hardware", label: "Hardware" };
    case "trim":
      return { attrGroup: "other", label: "Trim" };
    default:
      return { attrGroup: "other", label: "Finish" };
  }
}

/**
 * The kind of a finish row a BILL wrote, read back from its group and label —
 * the inverse of `billFinishShape`, for a revision comparing what a record
 * already holds. A `material` row is a fabric whatever its label, which is
 * exactly what the revision rule read before kinds existed.
 */
export function heldBillFinishKind(row: { attrGroup: string; label: string }): BillFinishKind | undefined {
  if (row.attrGroup === "material") return "fabric";
  for (const kind of ["timber", "metal", "hardware", "trim", null] as const) {
    const shape = billFinishShape(kind);
    if (shape.attrGroup === row.attrGroup && shape.label === row.label) return kind;
  }
  return undefined;
}

/** The kind in a word, for sentences: "the fabric", "the trim", "the finish". */
export function billFinishNoun(kind: BillFinishKind): string {
  return kind ?? "finish";
}

/**
 * WHAT A FINISH LINE IS: the code, then the words, else nothing.
 *
 * `code` is the line's OWN code (`fabricOwnCode` — the item's code taken off);
 * `words` is what the line writes as its value, verbatim.
 */
export function readBillFinishKind(line: { code: string | null; words: string }): BillFinishReading {
  const code = line.code?.trim() || null;
  const fromBillCode = billFinishCodeKind(code);
  if (fromBillCode) return { kind: fromBillCode, reason: `the code ${code} says so` };

  // The drawings path's reading, unchanged: words (fabric, metal, timber,
  // hardware), then the client's code prefixes, then a three-part project code.
  // No item name, so its one inference — "the caption names the item" — is
  // never reached.
  const callout = classifyCallout({ labelRaw: null, valueRaw: line.words, materialCodeRaw: code });
  if (callout.kind) return { kind: callout.kind, reason: callout.reason };

  const tokens = normaliseName(line.words).split(" ");
  if (BILL_FABRIC_WORDS.some((word) => tokens.includes(word))) {
    return { kind: "fabric", reason: "COL — customer's own leather" };
  }
  return { kind: null, reason: null };
}

/** A staged finish line, as much of it as its kind is read from. */
export type BillFinishLine = {
  code: string | null;
  itemDescription?: string;
  /** Read only where `itemDescription` is absent (a plan over partial lines). */
  itemDescriptionRaw?: string | null;
  finishFor?: { code?: string | null } | null;
};

/** The words a finish line writes as its value: the description verbatim, or its code where it has none. */
export function billFinishLineWords(line: BillFinishLine): string {
  return (line.itemDescription ?? line.itemDescriptionRaw ?? "").trim() || (line.code ?? "").trim();
}

/**
 * WHAT A STAGED FINISH LINE IS — its own code (`fabricOwnCode`: the item's
 * code taken off) and its words. The ONE call the confirm, the review and
 * the description plan's "has a fabric line" all make.
 */
export function billFinishLineKind(line: BillFinishLine): BillFinishReading {
  return readBillFinishKind({
    code: fabricOwnCode({ code: line.code, finishFor: line.finishFor ? { code: line.finishFor.code ?? null } : null }),
    words: billFinishLineWords(line),
  });
}

/** Where one finish line goes, decided against the fields its item already holds. */
export type BillFinishPlacement = {
  kind: BillFinishKind;
  attrGroup: "material" | "finish" | "hardware" | "other";
  label: string;
  /** The BWS field it fills, as a json id, or null where it is kept with none. */
  jsonId: number | null;
  /** Why it is kept with no field: every slot of its kind is taken, or its kind has none. */
  kept: "full" | "no_field" | null;
};

/**
 * THE ONE SLOT DECISION. `taken` is the json ids of every slot the item
 * already holds — from any document, and from the finish lines above this one.
 * The first free slot of the line's kind, in order; none where all are taken,
 * or where the kind has no BWS field. Never an unrelated field.
 */
export function decideBillFinishSlot(kind: BillFinishKind, taken: ReadonlySet<number>): BillFinishPlacement {
  const shape = billFinishShape(kind);
  const slots = kind ? SLOTS[kind] : undefined;
  if (!slots) return { kind, ...shape, jsonId: null, kept: "no_field" };
  const free = slots.find((jsonId) => !taken.has(jsonId));
  if (free === undefined) return { kind, ...shape, jsonId: null, kept: "full" };
  return { kind, ...shape, jsonId: free, kept: null };
}

const FULL: Partial<Record<Exclude<BillFinishKind, null>, string>> = {
  fabric: "COM 1–3 are full",
  timber: "the three timber finishes are full",
  metal: "both metal finishes are full",
};

/** Where the review says the line goes: "→ COM 3", "→ kept, no BWS field (trim)". */
export function describeBillFinishSlot(placement: BillFinishPlacement): string {
  if (placement.jsonId !== null) return `→ ${SLOT_NAMES[placement.jsonId] ?? `field ${placement.jsonId}`}`;
  if (placement.kept === "full" && placement.kind) return `→ kept, ${FULL[placement.kind] ?? "its fields are full"}`;
  if (placement.kind === null) return "→ kept, no BWS field (its code and words do not say what it is)";
  return `→ kept, no BWS field (${placement.kind})`;
}
