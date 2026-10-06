// The vocabulary that says what a material IS, and where it goes.
//
// ============================================================================
// A LEAF, SO TWO READERS CAN SHARE ONE VOCABULARY
//
// `classifyCallout` (drawing-document.ts) reads a drawing's short caption;
// `suggestFinishKind` (finish-kind-guess.ts) reads a finishes-library row.
// They ask different questions of the same words, and a second copy of the
// lists is how the two start disagreeing about whether `WD-05` is a timber —
// the `composeDimensionCell` rule, applied to a word list.
//
// It lives here rather than in `drawing-document.ts` for the reason
// `record-refs.ts` exists: a cycle between two modules works right up until one
// is read at import time by the other, and then fails somewhere unrelated.
// Everything is re-exported from its old home, so no existing caller changed.
//
// ---- THE CALLOUT LISTS ARE FROZEN --------------------------------------
//
// Everything named `*_CALLOUT_WORDS` is EXACTLY what `classifyCallout` matched
// on before this file existed, moved and not edited. That path was verified
// against the real AP364 pack on 2026-09-17 and widening it silently would
// re-classify rows on packs already read, at read time, with nothing saying
// so. The library's extra vocabulary is additive and separate, and it is used
// by `suggestFinishKind` alone.
//
// ---- MATERIAL WORDS AND PART WORDS ARE NOT THE SAME LIST -------------------
//
// The timber list has always carried `feet`, `leg`, `legs` and `frame`. That is
// right for a drawing caption, where the LABEL is the part and "SOFA FEET" is
// the evidence the value is a timber. It is wrong for a library row, whose
// label is a CODE and whose value is a description: a fabric described as "for
// the legs" is not a timber. So the parts are split out, the drawings path
// keeps the combined list it has always used, and the library reads the
// material half only.
// ============================================================================

// ---- FROZEN: what classifyCallout has always matched on --------------------

export const FABRIC_CALLOUT_WORDS = [
  "fabric",
  "fabrics",
  "com",
  "com1",
  "com2",
  "com3",
  "upholstery",
  "upholstered",
  "leather",
  "textile",
  "weave",
  "velvet",
  "yarn",
  "boucle",
  "bouclé",
  "linen",
  "cotton",
  "wool",
  "mohair",
  "chenille",
  "tweed",
  "silk",
  "canvas",
  "suede",
  "hide",
  "vinyl",
] as const;

export const TIMBER_MATERIAL_WORDS = ["wood", "timber", "oak", "walnut", "veneer"] as const;

/**
 * Parts a timber finish is typically applied to.
 *
 * Evidence on a DRAWING, where the caption names the part it is labelling.
 * Never evidence in a library description, where "legs" says where the finish
 * goes and not what it is made of.
 */
export const TIMBER_PART_WORDS = ["feet", "leg", "legs", "frame"] as const;

/** What `classifyCallout` has always matched on: materials AND parts. */
export const TIMBER_CALLOUT_WORDS = [...TIMBER_MATERIAL_WORDS, ...TIMBER_PART_WORDS] as const;

export const METAL_WORDS = ["metal", "brass", "bronze", "steel", "chrome", "nickel"] as const;

export const HARDWARE_WORDS = [
  "hinge",
  "hinges",
  "runner",
  "runners",
  "castor",
  "castors",
  "mechanism",
  "glide",
  "glides",
] as const;

// ---- ADDITIVE: the library's own vocabulary, used by nothing else ----------
//
// A finishes-library row carries a DESCRIPTION written out in full ("Aissa
// Dione black/straw diamonds, raffia, Gorée"), where a drawing carries a short
// caption. There is more to read, and the kinds it has to choose between are
// finer: `FinishKind` separates leather from fabric, and has stone, glass and
// paint, none of which a BWS spec field distinguishes.

/** Hides, which `FinishKind` keeps apart from cloth and the callout path does not. */
export const LEATHER_WORDS = ["leather", "hide", "suede", "nubuck", "shagreen"] as const;

export const FABRIC_EXTRA_WORDS = ["raffia", "jute", "hessian", "damask", "twill", "herringbone"] as const;

export const TIMBER_EXTRA_WORDS = ["ash", "beech", "birch", "maple", "cerused", "ceruse", "limed"] as const;

export const METAL_EXTRA_WORDS = ["antiqued", "patinated", "gunmetal", "aluminium", "iron"] as const;

export const STONE_WORDS = ["marble", "stone", "granite", "travertine", "onyx", "quartz", "limestone"] as const;

export const GLASS_WORDS = ["glass", "mirror", "mirrored", "smoked-glass"] as const;

export const PAINT_WORDS = ["paint", "painted", "lacquer", "lacquered", "eggshell", "ral"] as const;

/**
 * The client's own finish code, read as evidence of what the callout IS.
 *
 * The page prints the code beside the swatch, so this is the page speaking
 * rather than a rule about furniture. `CH` is DELIBERATELY ABSENT: the Panther
 * set prints `CH-01.2` and nothing on any page says what CH stands for, and an
 * invented mapping is exactly the confidently wrong field `suggestSpecField`
 * refuses to produce. `mtl` precedes `mt`, so the longer prefix wins.
 */
export const CODE_PREFIXES: { prefix: string; kind: "fabric" | "timber" | "metal" }[] = [
  { prefix: "uph", kind: "fabric" },
  { prefix: "fab", kind: "fabric" },
  { prefix: "com", kind: "fabric" },
  { prefix: "tim", kind: "timber" },
  { prefix: "wd", kind: "timber" },
  { prefix: "mtl", kind: "metal" },
  { prefix: "mt", kind: "metal" },
];

// ---- a finish tag drawn as three stacked boxes ------------------------------

/**
 * The Aman drawings draw a finish tag as three stacked boxes — `GR` over `FAB`
 * over `04` — and a reader transcribes it `GR FAB 04`. The bill writes the same
 * finish `GR-FAB-04`. This reads the tag's LAYOUT back into the code: exactly
 * three groups, two to four letters, two to four letters, digits with an
 * optional letter and an optional point sub-code (`08.1`), separated by
 * whitespace and nothing else.
 *
 * ANCHORED TO THE WHOLE VALUE, and it is not a normaliser. `normaliseFinishCode`
 * stays case and whitespace only, because a rule clever enough to merge two
 * spellings is clever enough to merge two codes a client kept apart. This one
 * cannot: it fires on one shape, and `GR FAB 04 walnut`, `FAB 04` or
 * `CH 01 2` are not that shape.
 */
// A SUB-CODE is the same shape with a point: the finishes schedule files
// `GR-TIM-08.1` (2026-10-04), so a tag reading `GR TIM 08.1` is that code.
const STACKED_TAG = /^\s*([A-Za-z]{2,4})\s+([A-Za-z]{2,4})\s+(\d{1,4}[A-Za-z]?(?:\.\d{1,3})?)\s*$/;

export function stackedTagCode(raw: string | null | undefined): string | null {
  const match = STACKED_TAG.exec(raw ?? "");
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`.toUpperCase();
}

/**
 * What a THREE-PART project code says it is, by its middle group: `GR-FAB-04`
 * is a fabric, `GR-TIM-03` a timber, `PL-MTL-01` a metal. The first group is
 * where it is used (a floor, a room type), which is why a prefix test over the
 * whole code finds nothing in it.
 *
 * Exact on the middle group, and only through `CODE_PREFIXES` — so `GR-STN-04`
 * and `GR-CH-01` say nothing, as `CH-01.2` never has.
 */
const PROJECT_CODE = /^\s*[A-Za-z]{2,4}-([A-Za-z]{2,4})-\d{1,4}[A-Za-z]?\s*$/;

export function projectCodeKind(raw: string | null | undefined): (typeof CODE_PREFIXES)[number]["kind"] | null {
  const match = PROJECT_CODE.exec(raw ?? "");
  if (!match) return null;
  const middle = match[1]!.toLowerCase();
  return CODE_PREFIXES.find((entry) => entry.prefix === middle)?.kind ?? null;
}

// ---- a BILL's finish line: its own code shape, and one word ---------------------
//
// ADDITIVE AND BILL-ONLY, used by `readBillFinishKind` (bill-finish-kind.ts)
// and by nothing on the drawings path — deliberately NOT folded into
// `CODE_PREFIXES` or the `*_CALLOUT_WORDS` above, because `classifyCallout`
// runs again at READ time over every pack already staged
// (`upgradeCalloutGuesses`) and a widened reading there would re-classify rows
// nobody is looking at, with nothing saying so.
//
// A specifier's bill (2026-10-06) lists an item, then each of its finishes on
// a line of its own, coded `F-FA-05`, `F-MT-03`, `F-WD-02`, `F-TR-01`: a
// leading `F-` that says "finish" and the KIND in the SECOND group. The
// letters-only prefix test reads `ffa`, `fmt`, `fwd` and finds nothing, and
// the three-part project code wants a first group of two to four letters, so
// neither existing reading sees the kind the code states.

/**
 * What a bill finish code of the `F-<KIND>-<n>` shape says it is, by its
 * second group, matched EXACTLY: the drawings path's own prefixes
 * (`F-FAB-01`, `F-WD-02`, `F-MTL-01`) plus the two this shape adds — `FA`
 * (fabric, leather included: the bill files both under it) and `TR` (trim:
 * cord, gimp, bullion, rosette — a finish with no BWS field). Null for any
 * other shape, and for a group nothing here knows (`F-ST-01` says nothing).
 */
const BILL_FINISH_CODE = /^\s*F-([A-Za-z]{2,4})-\d{1,4}[A-Za-z]?(?:\.\d{1,3})?\s*$/i;

export const BILL_FINISH_CODE_GROUPS: { group: string; kind: "fabric" | "timber" | "metal" | "trim" }[] = [
  ...CODE_PREFIXES.map((entry) => ({ group: entry.prefix, kind: entry.kind })),
  { group: "fa", kind: "fabric" },
  { group: "tr", kind: "trim" },
];

export function billFinishCodeKind(raw: string | null | undefined): "fabric" | "timber" | "metal" | "trim" | null {
  const match = BILL_FINISH_CODE.exec(raw ?? "");
  if (!match) return null;
  const group = match[1]!.toLowerCase();
  return BILL_FINISH_CODE_GROUPS.find((entry) => entry.group === group)?.kind ?? null;
}

/**
 * The trade's own word for a client-supplied hide, read on a bill's UNCODED
 * finish line only. `COM` (customer's own material) has always been a fabric
 * word; `COL` is customer's own LEATHER, which a bill writes as "DESK - COL"
 * under the item. Not added to `FABRIC_CALLOUT_WORDS`: on a drawing, "col"
 * is as likely to be a column or a colour, and that list is frozen.
 */
export const BILL_FABRIC_WORDS = ["col"] as const;
