// The WORDING a specification document's statements are recognised by — kept
// in one place so it can be re-checked against every new specifier's bill.
//
// ============================================================================
// WHY A LIST OF ITS OWN
//
// These are not rules about furniture; they are the words particular documents
// use. An email writes "Overall"; the Aman pricing document (plan
// any-bill, 2026-09-23) writes "Sizes (mm):", "Spec size:", "Finish: GR-TIM-09"
// and "Fabric: COM". Each entry below says which document it came from, so the
// next specifier's bill is read against a list somebody can see and question,
// rather than a rule hidden in a function. Add to it from VERIFIED wording only
// — a real document's label, read off the document — and never by widening a
// match: every list here is matched WHOLE, after folding, never as a substring.
//
// A LEAF: it imports nothing, so both readers (`spec-dimensions`,
// `spec-finishes`) can take from it without a cycle.
// ============================================================================

/**
 * Labels that mean "the overall size", where the VALUE carries the slots.
 * Matched on the WHOLE label, lower-cased, non-alphanumerics folded to one
 * space, after any bracket — the unit, "(mm)" — is taken off.
 *
 * None of these names a slot: "Overall" is not a width. A label here only
 * licenses reading the value as a combined line.
 *
 * NOT HERE, on purpose: "sizes fully reclined" (the Aman bill's "Sizes (cm) -
 * Fully reclined") measures the item in another position, and a reclined
 * length in W is a wrong width nothing downstream would question.
 */
export const SIZE_LABELS: readonly { label: string; from: string }[] = [
  { label: "overall", from: "held before 2026-09-23, for the email path" },
  { label: "overall dimensions", from: "held before 2026-09-23, for the email path" },
  { label: "overall dimension", from: "held before 2026-09-23, for the email path" },
  { label: "overall size", from: "held before 2026-09-23, for the email path" },
  { label: "overall sizes", from: "held before 2026-09-23, for the email path" },
  { label: "dimensions", from: "held before 2026-09-23, for the email path" },
  { label: "dimension", from: "held before 2026-09-23, for the email path" },
  { label: "dims", from: "held before 2026-09-23, for the email path" },
  { label: "size", from: "held before 2026-09-23, for the email path" },
  { label: "sizes", from: "held before 2026-09-23; also the Aman bill's \"Sizes (mm)\", \"Sizes(ft-in)\", 2026-09-23" },
  { label: "footprint", from: "held before 2026-09-23, for the email path" },
  { label: "spec size", from: "Aman bill, \"Spec size: D 460 X H 450 mm\", 2026-09-23" },
  { label: "spec sizes", from: "Aman bill, plural of the above, 2026-09-23" },
  { label: "sizes overall", from: "Aman bill, \"Sizes (cm) - Overall\", 2026-09-23" },
  { label: "size overall", from: "Aman bill, singular of the above, 2026-09-23" },
];

/**
 * Client finish codes that name a material NO BWS field holds, so a statement
 * carrying one is kept against the item and placed in no field — never pushed
 * into the nearest one. Matched on the code's LETTERS, zone taken off
 * (`GR-STN-02` reads as `STN`).
 *
 * The codes BWS fields DO hold — `UPH`/`FAB`/`COM` fabric, `TIM`/`WD` timber,
 * `MTL`/`MT` metal — are `CODE_PREFIXES` in `material-words.ts`, which the
 * drawings path reads too and which was not changed for this bill: `TIM` and
 * `MTL` were already there.
 */
export const NO_FIELD_CODE_PREFIXES: readonly { prefix: string; what: string | null; from: string }[] = [
  { prefix: "stn", what: "stone", from: "Aman bill, \"Finish: STN-02, MTL-01, TIM-03\", 2026-09-23" },
  // Printed beside finishes in the same bill; nothing in it says what SPF
  // stands for, so it is named as a code and nothing more.
  { prefix: "spf", what: null, from: "Aman bill, 2026-09-23" },
];

/**
 * A ZONE the document puts in front of its own finish code: `GR-TIM-09`,
 * `GR-MTL-03`. Two to four letters and a hyphen, then a code. Taken off before
 * the code's material letters are read, and kept on the code as written.
 * From the Aman bill, 2026-09-23 (`GR-`, `PL-`).
 */
export const ZONED_CODE = /^[A-Za-z]{2,4}-([A-Za-z]{2,4}[-\s.]?\d[\s\S]*)$/;

/**
 * A fabric's whole value meaning customer's own material. The CLIENT supplies
 * the cloth, so the statement names no fabric, and must not claim COM 1 on the
 * word "COM". Matched whole, lower-cased, every run of non-alphanumerics
 * folded to one space ("C.O.M." is "c o m"). The bill's own fabric LINE
 * under the item is what names the cloth. From the Aman bill ("Fabric: COM"),
 * 2026-09-23 — the meaning is the trade's, not the bill's.
 */
export const COM_ONLY_VALUES: readonly string[] = [
  "com",
  "c o m",
  "customers own material",
  "customer s own material",
  "client s own material",
  "clients own material",
];
