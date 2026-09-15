// The controlled vocabularies of the spec model, as TypeScript constants.
//
// Each of these has a matching `check` constraint in db/migrations/0002. The
// constant and the constraint must agree, and changing either means a
// migration — not just an edit here. See .claude/skills/external-vocabulary-sync.

/**
 * The four states a spec answer can be in. These are genuinely four different
 * things and gate rules must read this value, never test whether a string is
 * empty:
 *   confirmed — a human has settled it
 *   tbc       — a human has actively said "not yet decided". This is an ANSWER.
 *               It blocks a gate. It is not the absence of one.
 *   missing   — nobody has looked yet
 *   na        — does not apply to this item
 *
 * Unrelated to NAME_DENYLIST's "tbc" in matching.ts, which is about an entity
 * name nobody filled in. Do not let the two meanings merge.
 */
export const ANSWER_STATES = ["confirmed", "tbc", "missing", "na"] as const;
export type AnswerState = (typeof ANSWER_STATES)[number];

export const ANSWER_STATE_LABELS: Record<AnswerState, string> = {
  confirmed: "Confirmed",
  tbc: "TBC",
  missing: "Missing",
  na: "N/A",
};

/** Whether a requirement's answer belongs in a BWS spec column, or nowhere. */
export const REQUIREMENT_KINDS = ["spec_field", "readiness"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Where an answer came from. `source_id` points at the row, per kind. */
export const ANSWER_SOURCES = ["manual", "document", "email"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

/**
 * The ref systems a client reference can belong to. The same item carries
 * different refs in different documents, which is why these are rows rather
 * than one column on the record.
 */
export const REF_SYSTEMS = ["boq_code", "design_code", "cos_code", "compound", "bws_job"] as const;
export type RefSystem = (typeof REF_SYSTEMS)[number];

export const SPLIT_REASONS = ["fabric", "configuration"] as const;
export type SplitReason = (typeof SPLIT_REASONS)[number];

/**
 * The life of an intake run. Matches `intake_runs_status_check` in 0006.
 *
 *   pending    registered; nobody has asked for it to be read. NOT queued work
 *              — a BOQ never rests here, and a spec document does until a human
 *              presses Extract, because that is the click that spends money.
 *   queued     a message is in flight for the current attempt
 *   parsing    a worker holds the claim, or a BOQ is being read inline
 *   parsed     staged and awaiting review
 *   confirmed  no pending proposals remain — applied or explicitly ignored.
 *              It does NOT mean every answer is settled; label it "Review
 *              complete".
 *   failed     terminal for this attempt
 */
export const INTAKE_STATUSES = ["pending", "queued", "parsing", "parsed", "confirmed", "failed"] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

/** Matches `intake_runs_source_kind_check`. */
export const INTAKE_SOURCE_KINDS = ["boq_xlsx", "spec_document"] as const;
export type IntakeSourceKindValue = (typeof INTAKE_SOURCE_KINDS)[number];

/**
 * What kind of specification document this is. DECLARED at upload, never
 * inferred: an FF&E schedule and a BOQ are both .xlsx, and a file extension
 * identifies bytes, not a workflow. It selects the prompt.
 *
 * Matches `intake_runs_document_kind_check`.
 */
export const DOCUMENT_KINDS = [
  "ffe_schedule",
  "spec_bible",
  "finishes_schedule",
  "fabric_schedule",
  "preamble",
  "shop_drawings",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  ffe_schedule: "FF&E schedule",
  spec_bible: "Specification bible",
  finishes_schedule: "Finishes schedule",
  fabric_schedule: "Fabric schedule",
  preamble: "Preamble",
  shop_drawings: "Shop drawings",
  other: "Other specification document",
};

/**
 * The document kinds whose model output does NOT depend on the app's registers,
 * and which therefore resolve to records at REVIEW time rather than in the
 * worker. A drawing observation becomes a new attribute row; there is no
 * existing value to snapshot, so the raw output stays valid however long the
 * BOQ takes to be confirmed. Extracting drawings before their BOQ is a normal
 * order of work, not an error, and re-resolving on read costs nothing whereas
 * re-extracting costs a model call.
 */
export const REGISTER_FREE_DOCUMENT_KINDS: readonly DocumentKind[] = ["preamble", "shop_drawings"];

export function isRegisterFreeKind(kind: DocumentKind): boolean {
  return REGISTER_FREE_DOCUMENT_KINDS.includes(kind);
}

/** The states a staged proposal can be in. Reviewed rows are kept, never removed. */
export const PROPOSAL_REVIEW_STATUSES = ["pending", "ignored", "applied"] as const;
export type ProposalReviewStatus = (typeof PROPOSAL_REVIEW_STATUSES)[number];

export const RECORD_STATUSES = ["draft", "active", "retired"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/**
 * Who a chase email can be addressed to. `designer` rows additionally carry a
 * `designer_code` that joins to `spec_records.designer`.
 */
export const CONTACT_ROLES = ["designer", "client", "internal"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/**
 * The life of a chase draft. Only `draft` is editable.
 *
 *   draft      — being prepared; nothing has been claimed
 *   sent       — a human attested they sent it. Its content is now history.
 *   voided     — that attestation was withdrawn. The content and send record
 *                are preserved; the questions stop reading as Waiting.
 *   superseded — regeneration replaced it. Kept rather than deleted so a stale
 *                tab gets a conflict it can explain instead of a 404.
 */
export const DRAFT_STATUSES = ["draft", "sent", "voided", "superseded"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/**
 * How a record attribute is grouped on screen and in the export. A drawing
 * page mixes all of these, and the group decides what the value means:
 * only a `dimension` may carry a unit, and only dimensions compose together
 * into the single BWS `Dimensions` field.
 *
 * Matches `record_attributes_group_check` in db/migrations/0007.
 */
export const ATTRIBUTE_GROUPS = ["dimension", "material", "finish", "hardware", "note", "other"] as const;
export type AttributeGroup = (typeof ATTRIBUTE_GROUPS)[number];

export const ATTRIBUTE_GROUP_LABELS: Record<AttributeGroup, string> = {
  dimension: "Dimensions",
  material: "Materials and fabrics",
  finish: "Finishes",
  hardware: "Hardware",
  note: "Notes",
  other: "Other",
};

/**
 * Two states, not four. An attribute exists because a document stated
 * something, so `missing` cannot arise (nothing was observed, so no row) and
 * `na` is a cheat-sheet answer about a question this table does not have.
 * `tbc` is the drawing literally saying "PIPING  TBC": an observation that the
 * client has not decided, which must reach the export as TBC and not as blank.
 *
 * Matches `record_attributes_state_check` in db/migrations/0007.
 */
export const ATTRIBUTE_STATES = ["confirmed", "tbc"] as const;
export type AttributeState = (typeof ATTRIBUTE_STATES)[number];

export const ATTRIBUTE_STATE_LABELS: Record<AttributeState, string> = {
  confirmed: "Stated",
  tbc: "TBC",
};

/**
 * Dimension units. The AP364 drawings print 190/79/72 for a sofa and 550/735
 * for a desk chair and name the unit on NEITHER page, so this is a controlled
 * vocabulary a human always chooses. Anything unrecognised normalises to null —
 * a wrong unit is worse than no unit, because a 550mm chair recorded as 550cm
 * looks like a real number.
 *
 * The model may now REPORT a unit, and only when the page prints one beside the
 * figure ("WIDTH 1800mm" on a Panther specification sheet). That is an
 * observation of what the document says, not a choice — it still arrives as
 * `unitRaw` text and is resolved here by `normaliseUnit`, which is the exact/
 * fuzzy split house convention 6 requires.
 *
 * Matches `record_attributes_unit_check` in db/migrations/0007 and
 * `projects_default_unit_check` in 0008 — the same four values serve a
 * project's `default_dimension_unit`, which is the fallback when a page states
 * nothing and its own figures do not agree. One vocabulary, three places that
 * must stay in step; see the `external-vocabulary-sync` skill.
 */
export const ATTRIBUTE_UNITS = ["mm", "cm", "m", "in"] as const;
export type AttributeUnit = (typeof ATTRIBUTE_UNITS)[number];

/**
 * Spelt out where there is room for it. On a review table `mm` is right beside
 * the figure and needs no gloss; in a project-level select, picking the wrong
 * one silently changes every dimension on the project, so it is worth the words.
 */
export const ATTRIBUTE_UNIT_LABELS: Record<AttributeUnit, string> = {
  mm: "Millimetres (mm)",
  cm: "Centimetres (cm)",
  m: "Metres (m)",
  in: "Inches (in)",
};

/** Returns null — never a guess — for anything not in the vocabulary. */
export function normaliseUnit(raw: unknown): AttributeUnit | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase().replace(/\.$/, "");
  const aliases: Record<string, AttributeUnit> = {
    mm: "mm",
    millimetre: "mm",
    millimetres: "mm",
    millimeter: "mm",
    millimeters: "mm",
    cm: "cm",
    centimetre: "cm",
    centimetres: "cm",
    centimeter: "cm",
    centimeters: "cm",
    m: "m",
    metre: "m",
    metres: "m",
    meter: "m",
    meters: "m",
    in: "in",
    inch: "in",
    inches: "in",
    '"': "in",
  };
  return aliases[value] ?? null;
}

/**
 * The five dimensions BWS field 3 can hold, and nothing else.
 *
 * Matthew's ruling, 2026-09-15: the cell is written `W*** x D*** x H***mm`,
 * everything in millimetres with the unit once at the end; seat height appended
 * as `SH***`; a round item written `Dia.***` IN PLACE OF `W*** x D***`.
 *
 * Before this, a dimension carried whatever label a document printed. One real
 * AP364 armchair page came back with 44 of them, and the Panther specification
 * sheets add WIDTH SEAT, DEPTH SEAT, WIDTH BACK, DEPTH BACK and ARM HEIGHT on
 * top of width/depth/height. Composed into one cell that is unreadable and
 * uncheckable. Every other measurement is still KEPT — as a `note`, with its
 * label, its value and its unit — it has just stopped claiming a BWS dimension.
 *
 * The stored token is the comparison key; `Dia.` is a rendering rule of one
 * external system and lives in the composer, not here. Comparing dimension
 * LABELS as strings is the `"sqm"` vs `"m"` failure the
 * `external-vocabulary-sync` skill is written around: two spellings of one
 * concept, matching nothing, erroring nowhere.
 *
 * Matches `record_attributes_dimension_slot_check` in db/migrations/0011.
 */
export const DIMENSION_SLOTS = ["W", "D", "H", "SH", "DIA"] as const;
export type DimensionSlot = (typeof DIMENSION_SLOTS)[number];

export const DIMENSION_SLOT_LABELS: Record<DimensionSlot, string> = {
  W: "Width",
  D: "Depth",
  H: "Height",
  SH: "Seat height",
  DIA: "Diameter",
};

/**
 * Returns null — never a guess — for anything not in the vocabulary.
 *
 * THE LOOKUP IS EXACT, ON THE WHOLE FOLDED LABEL, AND THAT IS THE POINT. A
 * substring rule reads `WIDTH SEAT` as a width and overwrites the item's real
 * width with a seat measurement; it reads `ARM HEIGHT` as a height and
 * overwrites the item's real height with 520. Both labels are printed verbatim
 * on the Panther S-100 sheet, beside the width and height it would destroy.
 *
 * Note the asymmetry, which looks like a bug and is not: `HEIGHT SEAT` maps to
 * `SH` because that is where that template prints the seat height Matthew wants,
 * while `WIDTH SEAT` maps to NOTHING because a seat-only width has no slot. Do
 * not "make these consistent".
 */
export function normaliseDimensionSlot(raw: unknown): DimensionSlot | null {
  if (typeof raw !== "string") return null;
  const folded = raw
    .toLowerCase()
    .replace(/[ø⌀]/g, "dia")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const aliases: Record<string, DimensionSlot> = {
    w: "W",
    width: "W",
    wide: "W",
    "overall width": "W",
    "width overall": "W",
    d: "D",
    depth: "D",
    deep: "D",
    "overall depth": "D",
    "depth overall": "D",
    h: "H",
    ht: "H",
    height: "H",
    high: "H",
    "overall height": "H",
    "height overall": "H",
    sh: "SH",
    "seat height": "SH",
    "height seat": "SH",
    "seat ht": "SH",
    "seat h": "SH",
    dia: "DIA",
    diameter: "DIA",
  };
  return aliases[folded] ?? null;
}

export function isDimensionSlot(value: unknown): value is DimensionSlot {
  return typeof value === "string" && (DIMENSION_SLOTS as readonly string[]).includes(value);
}

export function isAttributeState(value: unknown): value is AttributeState {
  return typeof value === "string" && (ATTRIBUTE_STATES as readonly string[]).includes(value);
}

export function isAttributeGroup(value: unknown): value is AttributeGroup {
  return typeof value === "string" && (ATTRIBUTE_GROUPS as readonly string[]).includes(value);
}

/**
 * Runs and notes are retired, never deleted: a run that turned out to be the
 * wrong BOQ revision still explains why records exist, and a mis-extracted
 * preamble note is evidence of what the document was read as.
 *
 * Matches `spec_runs_status_check` / `project_notes_status_check` in 0007.
 */
export const RUN_STATUSES = ["active", "retired"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * A project is archived, never deleted — and for a stronger reason than a run
 * is. A delivered project holds the client ref → BWS job number mapping, and
 * nothing else in the business holds it.
 *
 * `archived` hides a project from the default list. It does NOT make it
 * read-only; nothing revokes a write, and the screen has to say so rather than
 * showing a control that reads as a lock and is not one.
 *
 * Matches `projects_status_check` in db/migrations/0008.
 */
export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

export const NOTE_STATUSES = ["active", "retired"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export const ATTRIBUTE_STATUSES = ["active", "retired"] as const;
export type AttributeStatus = (typeof ATTRIBUTE_STATUSES)[number];

/** A draft is finished being edited once it leaves `draft`. */
export function isSettledDraft(status: DraftStatus): boolean {
  return status !== "draft";
}

export function isAnswerState(value: unknown): value is AnswerState {
  return typeof value === "string" && (ANSWER_STATES as readonly string[]).includes(value);
}

/**
 * A record is "complete" when nothing is missing and nothing is still TBC.
 * `na` counts as settled: the question was asked and answered "not applicable".
 */
export function isSettled(state: AnswerState): boolean {
  return state === "confirmed" || state === "na";
}
