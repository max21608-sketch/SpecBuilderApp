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
