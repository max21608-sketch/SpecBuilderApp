// Which questions are outstanding, who to ask, and whether a sent draft still
// describes reality.
//
// The SQL here is the only I/O; everything that decides anything is a pure
// function below it, so it can be tested in the tier that actually runs in CI.
//
// ============================================================================
// WHY "WAITING" IS DERIVED RATHER THAN STORED
//
// The obvious design is a `chased_at` column on spec_answers. It is wrong:
// writing it fires bump_version, which silently invalidates every M2
// extraction snapshot pointing at that answer, for a reason that has nothing
// to do with the answer. See db/migrations/0005_chase_drafts.sql.
//
// So a question is Waiting when it is still outstanding AND some sent,
// tracking-eligible draft item still matches it -- same answer presence and
// version, same rendered context. That comparison is `isCoverageFresh` below,
// and it is the same function the send gate uses.
// ============================================================================
import { sql } from "@/lib/db";
import type { Row } from "@/lib/db";
import { type AnswerState, type ItemLevel, isSettled, normaliseItemLevel } from "@/lib/spec-vocab";
import { questionTierOrNull, type QuestionTier, type TgqMatrix } from "@/lib/tgq";
import { loadTgqMatrices } from "@/lib/gate-load";
import type { ChaseGroup } from "@/lib/chase-template";

/**
 * Either driver. `sql` from db.ts (HTTP, one request per call) and the
 * transaction-scoped executor from db-transaction.ts have the same shape, so a
 * loader can serve a screen read and a guarded write without being written
 * twice.
 */
export type SqlExecutor = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/** A question that still needs an answer, with everything needed to ask it. */
export type OutstandingQuestion = {
  /** Which project, so a multi-project load can be grouped back apart. */
  projectId: string;
  recordId: string;
  recordNo: number;
  recordLabel: string;
  recordStatus: string;
  recordVersion: number;
  itemDescription: string;
  area: string | null;
  /** Free text off the BOQ, e.g. "LCS". Normalised by `designerKey`. */
  designer: string | null;
  refs: string;
  categoryId: string | null;
  categoryName: string | null;
  /** simple | complex | hero, or null where nobody has decided. */
  level: ItemLevel | null;
  /** The levels at which this question must be answered before a quote. */
  tgqLevels: string[];
  /**
   * Whether this question holds up a quote — null when the record has no
   * level, which is a blocker rather than a default (see tgq.ts).
   */
  tier: QuestionTier | null;
  requirementId: string;
  requirementKind: "spec_field" | "readiness";
  prompt: string;
  /**
   * The block of the cheat sheet this question sits in ("Upholstery", "COM").
   * Null on a sheet that never grouped its questions. Display only: it is what
   * lets a list of 48 outstanding questions be read rather than scrolled.
   */
  section: string | null;
  sortOrder: number;
  fieldLabel: string | null;
  /**
   * The BWS field this question fills, and the local key a readiness question
   * carries instead. Both were already selected — `questionTierOrNull` reads
   * them — and were thrown away after the tier was computed.
   *
   * The infill screen needs them for the two things that decide how a gap is
   * FILLED rather than which half of an email it lands in: json_id 3 is the
   * composed dimensions cell, which is written as an attribute and never as an
   * answer, and the palette a question offers is looked up by field or by
   * local key exactly as the record screen looks it up.
   *
   * Safe to add: `contextSnapshot` is built field by field, so a column here
   * cannot make a sent draft read as stale.
   */
  jsonId: number | null;
  localKey: string | null;
  answerId: string | null;
  answerVersion: number | null;
  state: AnswerState;
  currentValue: string | null;
  // ---- where this question sits in the bill --------------------------------
  //
  // The chase screen groups by FURNITURE LINE, and a line's finish options
  // (0024's variants) sit under it. All of this is display grouping: none of it
  // reaches `contextSnapshot`, which is built field by field precisely so that
  // adding a column here cannot make every sent draft stale.
  /** The bill's quantity. Null on a finish option — the bill never split it. */
  qty: number | null;
  runId: string;
  runName: string;
  /** Set on a FINISH OPTION: the bill line it splits. Null on a bill line. */
  parentId: string | null;
  /** A, B, C … on a finish option; null on a bill line. */
  variantLabel: string | null;
  /** A finish option carries no client ref of its own, so it shows its parent's. */
  parentRefs: string;
  /** The bill line's quantity, read through the parent. */
  parentQty: number | null;
  /**
   * The `record_no` this row SORTS under — its parent's where it has one. A
   * finish option is allocated the next free number in the project, so
   * ordering on its own would land it pages from the line it belongs to.
   */
  groupNo: number;
  /** `AP364c-011` for the line this row sorts under — its parent's, or its own. */
  groupLabel: string;
  /** Live finish options under this record. One or more makes it a heading. */
  variantCount: number;
};

export type ProjectContact = {
  id: string;
  name: string;
  email: string | null;
  organisation: string | null;
  role: "designer" | "client" | "internal";
  designerCode: string | null;
  version: number;
  /** The modelled Capsule party, where this contact has been linked to one. */
  capsulePartyId?: number | null;
  capsulePartyType?: string | null;
  capsuleSyncedAt?: string | null;
};

/**
 * `spec_records.designer` is free text copied out of a BOQ: " lcs ", "LCS",
 * "Lcs" are one designer. Contacts store the code already normalised (a check
 * constraint enforces it), so this is the only place the two have to agree.
 */
export function designerKey(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

export function recordLabel(projectNumber: string, recordNo: number): string {
  return `${projectNumber}-${String(recordNo).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// The context an email actually stated about a question.
//
// spec_answers carries a version; `requirements` and `spec_record_refs` do
// not. So an edited prompt, a corrected client ref, or a record moved to
// another area would be invisible to a version-only staleness check. This
// snapshot is what closes that gap -- compare these normalised values, never
// rendered HTML.
// ---------------------------------------------------------------------------
export type ContextSnapshot = {
  v: 1;
  categoryName: string | null;
  designerKey: string | null;
  recordLabel: string;
  refs: string;
  itemDescription: string;
  area: string | null;
  prompt: string;
  kind: string;
  fieldLabel: string | null;
  state: AnswerState;
  currentValue: string | null;
};

function norm(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function contextSnapshot(question: OutstandingQuestion): ContextSnapshot {
  return {
    v: 1,
    categoryName: norm(question.categoryName),
    designerKey: designerKey(question.designer),
    recordLabel: question.recordLabel,
    refs: (question.refs ?? "").trim(),
    itemDescription: (question.itemDescription ?? "").trim(),
    area: norm(question.area),
    prompt: (question.prompt ?? "").trim(),
    kind: question.requirementKind,
    fieldLabel: norm(question.fieldLabel),
    state: question.state,
    currentValue: norm(question.currentValue),
  };
}

/** The stored half of a coverage row, as read back from email_draft_items. */
export type CoverageSnapshot = {
  recordId: string;
  requirementId: string;
  revisionNo: number;
  answerId: string | null;
  snapshotAnswerVersion: number | null;
  recordVersion: number;
  context: ContextSnapshot;
};

export type StaleReason =
  | "answerAppeared"
  | "answerRemoved"
  | "answerChanged"
  | "answerSettled"
  | "recordChanged"
  | "recordRetired"
  | "contextChanged"
  | "questionGone";

/**
 * Does this coverage row still describe the live question?
 *
 * Returns the reasons it does not, most specific first. An empty array means
 * fresh. Pure, so both the send gate and the Waiting query use exactly the
 * same rule and cannot drift apart.
 */
export function coverageStaleReasons(
  coverage: CoverageSnapshot,
  live: OutstandingQuestion | null,
): StaleReason[] {
  if (!live) return ["questionGone"];

  const reasons: StaleReason[] = [];

  if (live.recordStatus === "retired") reasons.push("recordRetired");
  if (live.recordVersion !== coverage.recordVersion) reasons.push("recordChanged");

  // An answer row appearing, vanishing, or moving all mean the same thing:
  // what the email said about this question is no longer what the app holds.
  if (coverage.answerId === null && live.answerId !== null) reasons.push("answerAppeared");
  else if (coverage.answerId !== null && live.answerId === null) reasons.push("answerRemoved");
  else if (coverage.answerId !== null && live.answerId !== coverage.answerId) reasons.push("answerChanged");
  else if (coverage.snapshotAnswerVersion !== null && live.answerVersion !== coverage.snapshotAnswerVersion) {
    reasons.push("answerChanged");
  }

  // The point of the chase is answered. Not an error -- but it is emphatically
  // not something to still be waiting on.
  if (isSettled(live.state)) reasons.push("answerSettled");

  const fresh = contextSnapshot(live);
  if (canonicalJson(fresh) !== canonicalJson(coverage.context)) reasons.push("contextChanged");

  return reasons;
}

/**
 * Stable stringification, with object keys sorted.
 *
 * A plain JSON.stringify comparison is WRONG here and fails in a way that
 * looks like a data problem rather than a bug: Postgres `jsonb` does not
 * preserve key insertion order (it sorts by key length, then bytes), so the
 * snapshot read back never matches the freshly computed one, and every draft
 * reads as stale the instant it is generated.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function isCoverageFresh(coverage: CoverageSnapshot, live: OutstandingQuestion | null): boolean {
  return coverageStaleReasons(coverage, live).length === 0;
}

export function questionKey(recordId: string, requirementId: string, revisionNo = 0): string {
  return `${recordId}:${requirementId}:${revisionNo}`;
}

/**
 * One covered question, as it will be both stored and rendered.
 *
 * Generation and editing both build this and then render from it, so the body
 * and the coverage rows cannot describe different things — they are the same
 * values, used twice, in one transaction.
 */
export type CoveredQuestion = {
  recordId: string;
  requirementId: string;
  answerId: string | null;
  answerVersion: number | null;
  recordVersion: number;
  context: ContextSnapshot;
  prompt: string;
  fieldLabel: string | null;
  currentValueText: string | null;
  /**
   * Which half of the email this question was in. Stored as its own column,
   * deliberately outside `context`: see db/migrations/0020_draft_item_tier.sql.
   */
  tier: QuestionTier;
  /** The order the email printed, kept so an edit re-renders the same email. */
  recordNo: number;
  requirementSort: number;
};

/**
 * A live question as a coverage row.
 *
 * Throws on a level-less record rather than inventing a tier. `groupByContact`
 * has already blocked those, and the generate route validates again, so
 * reaching here without a tier is a bug rather than a user error.
 */
export function coveredFromQuestion(question: OutstandingQuestion): CoveredQuestion {
  if (question.tier === null) {
    throw new Error(
      `${question.recordLabel} has no level, so no question on it can be sorted into what blocks a quote. It should have been blocked before this point.`,
    );
  }
  return {
    tier: question.tier,
    recordNo: question.recordNo,
    requirementSort: question.sortOrder,
    recordId: question.recordId,
    requirementId: question.requirementId,
    answerId: question.answerId,
    answerVersion: question.answerVersion,
    recordVersion: question.recordVersion,
    context: contextSnapshot(question),
    prompt: question.prompt,
    fieldLabel: question.fieldLabel,
    currentValueText: question.currentValue,
  };
}

/**
 * Renders covered questions into the template's per-record groups.
 *
 * Driven off the SNAPSHOT, not off live rows: the email must say what the
 * coverage says. Reading live values here is how the two would drift apart.
 */
export function groupsFromCovered(items: CoveredQuestion[]): ChaseGroup[] {
  const byRecord = new Map<string, ChaseGroup>();
  // Record order, then the cheat sheet's own question order. Stored on the row
  // so an edit rebuilds the same email: sorting by rendered label here made the
  // table re-order itself alphabetically after every edit, which reads to the
  // recipient as the email having changed.
  const ordered = [...items].sort(
    (a, b) => a.recordNo - b.recordNo || a.requirementSort - b.requirementSort,
  );
  for (const item of ordered) {
    const c = item.context;
    const question = {
      recordId: item.recordId,
      requirementId: item.requirementId,
      recordLabel: c.recordLabel,
      refs: c.refs,
      itemDescription: c.itemDescription,
      area: c.area,
      categoryName: c.categoryName,
      prompt: c.prompt,
      fieldLabel: c.fieldLabel,
      state: c.state,
      currentValue: c.currentValue,
      tier: item.tier,
    };
    // One group per record PER TIER: the email prints everything that blocks a
    // quote first, so a record with questions in both halves appears in both.
    const key = `${item.tier}:${item.recordId}`;
    const group = byRecord.get(key);
    if (group) {
      group.questions.push(question);
      continue;
    }
    byRecord.set(key, {
      recordId: item.recordId,
      recordLabel: c.recordLabel,
      refs: c.refs,
      itemDescription: c.itemDescription,
      area: c.area,
      categoryName: c.categoryName,
      tier: item.tier,
      questions: [question],
    });
  }
  return [...byRecord.values()];
}

// ---------------------------------------------------------------------------
// Grouping outstanding questions by who should be asked.
// ---------------------------------------------------------------------------
export type BlockedRecord = {
  recordId: string;
  recordLabel: string;
  itemDescription: string;
  designer: string | null;
  questionCount: number;
  reason: "no designer on the record" | "no contact for this designer" | "no level on the record";
};

export type ContactGroup = {
  contact: ProjectContact;
  questions: OutstandingQuestion[];
};

/**
 * Splits outstanding questions into groups that can be drafted and records
 * that cannot, with the reason. A record is never silently dropped: if there
 * is nobody to ask, that is a visible blocker with an action next to it.
 *
 * ============================================================================
 * A COLLEAGUE IS NOT ROUTED BY DESIGNER CODE
 *
 * Matthew, 2026-09-18: "You can send it to the CAM or to the sales system or
 * to production… It doesn't have to be an external e-mail." A designer is
 * reached through `spec_records.designer`, which is how the bill says whose
 * item a line is. An internal contact has no code and is not on a bill line at
 * all, so routing them that way would leave every colleague with an empty
 * chase.
 *
 * So a contact whose `role` is `internal` gets a group of their own holding
 * EVERY outstanding question on the project. Two things about it:
 *
 *   * A LEVEL IS STILL REQUIRED. No level, no tier, and the email could not
 *     say which half of it blocks the quote — which is the whole point of the
 *     message. Blocked with the reason, exactly as for a designer.
 *
 *   * `blocked` IS UNCHANGED, and that is deliberate. It describes the
 *     DESIGNER routing — "there is nobody to ask about this line" — and it is
 *     what the screen's Nobody assigned tab and its blockers panel are about.
 *     A colleague being askable about everything does not mean the line has a
 *     designer, and silently emptying that list would hide 31 unrouted
 *     questions behind a convenience.
 *
 * A question therefore appears in a designer's group AND in every colleague's.
 * The generate route already refuses one question selected for two recipients,
 * and the screen shows one contact's tab at a time.
 * ============================================================================
 */
export function groupByContact(
  questions: OutstandingQuestion[],
  contacts: ProjectContact[],
): { groups: ContactGroup[]; blocked: BlockedRecord[] } {
  const byCode = new Map<string, ProjectContact>();
  for (const contact of contacts) {
    if (contact.designerCode) byCode.set(contact.designerCode, contact);
  }
  const colleagues = contacts.filter((contact) => contact.role === "internal");

  const groups = new Map<string, ContactGroup>();
  const blockedByRecord = new Map<string, BlockedRecord>();

  const block = (question: OutstandingQuestion, reason: BlockedRecord["reason"]) => {
    const existing = blockedByRecord.get(question.recordId);
    if (existing) {
      existing.questionCount += 1;
      return;
    }
    blockedByRecord.set(question.recordId, {
      recordId: question.recordId,
      recordLabel: question.recordLabel,
      itemDescription: question.itemDescription,
      designer: question.designer,
      questionCount: 1,
      reason,
    });
  };

  for (const question of questions) {
    // A colleague can be asked about a line with no designer, so this runs
    // before the designer routing and is not affected by its refusals. The
    // level is the one thing it still needs, for the reason above.
    if (question.level !== null) {
      for (const colleague of colleagues) {
        const group = groups.get(colleague.id);
        if (group) group.questions.push(question);
        else groups.set(colleague.id, { contact: colleague, questions: [question] });
      }
    }

    const key = designerKey(question.designer);
    const contact = key ? byCode.get(key) : undefined;

    if (!contact) {
      block(question, key ? "no contact for this designer" : "no designer on the record");
      continue;
    }

    // A record with no level has no tier, so the email could not say which
    // half of it blocks the quote. That is the whole point of the message, so
    // the record is blocked with the reason rather than chased without it.
    if (question.level === null) {
      block(question, "no level on the record");
      continue;
    }

    // A colleague who also carries a designer code already has this question
    // through the path above, and pushing it again would list it twice in
    // their own chase.
    if (contact.role === "internal") continue;

    const group = groups.get(contact.id);
    if (group) group.questions.push(question);
    else groups.set(contact.id, { contact, questions: [question] });
  }

  return {
    // DESIGNERS FIRST, THEN COLLEAGUES, each by name. The strip on the chase
    // screen reads left to right and the external chase is the common one;
    // a colleague sorted into the middle of it by their first name would read
    // as another designer.
    groups: [...groups.values()].sort(
      (a, b) =>
        Number(a.contact.role === "internal") - Number(b.contact.role === "internal") ||
        a.contact.name.localeCompare(b.contact.name),
    ),
    blocked: [...blockedByRecord.values()].sort((a, b) => a.recordLabel.localeCompare(b.recordLabel)),
  };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * Every question that still needs an answer on this project.
 *
 * Driven from `requirements LEFT JOIN spec_answers`, like the completion view:
 * a requirement with NO answer row is `missing`, is the most common thing
 * worth chasing, and would be invisible if this drove off answers.
 *
 * Retired records are excluded. Records with no category produce no questions
 * and are surfaced separately by the caller, because 0 of 0 renders as
 * complete and is the opposite of the truth.
 */
/**
 * One project, or several.
 *
 * The projects LIST needs a Waiting count per project, and Waiting is derived
 * rather than stored: a question is waiting when it is still outstanding and a
 * sent draft item still matches it, with `isCoverageFresh` comparing a context
 * snapshot that no SQL expression can reproduce. Calling this once per project
 * would be two queries per row; taking an array makes it two queries for the
 * page, over the SAME rule the chase screen runs.
 *
 * ---- AND A SCOPE, FOR THE SCREENS THAT CANNOT SHIP THE WHOLE THING --------
 *
 * Measured on the sandbox 300-line project (`npm run measure:outstanding`,
 * 2026-09-20): 19,582 outstanding questions, 1,045 ms, and **18,976 KB** of
 * JSON if a route sends them all. The infill screen draws 407 collapsed lines
 * and opens one at a time, so it summarises the whole load server-side and
 * then re-reads ONE line's questions when somebody opens it.
 *
 * The scope is a WHERE clause on this query and not a second query, because
 * the predicates above it — the active record, the active phase, the split
 * bill line that is a heading — are the ones two screens have already
 * disagreed over. A second loader is how that happens a third time.
 */
export type OutstandingScope = {
  /**
   * Furniture lines: a record, or any finish option under it. Keyed the way
   * `groupIntoLines` keys a line, so "open this line" is one parameter.
   */
  lineIds?: string[];
  requirementIds?: string[];
};

export async function loadOutstanding(
  project: string | string[],
  scope?: OutstandingScope,
): Promise<OutstandingQuestion[]> {
  const projectIds = Array.isArray(project) ? project : [project];
  if (projectIds.length === 0) return [];
  // An ABSENT scope is everything; an EMPTY one is nothing, and the difference
  // matters — a caller that filtered its own list down to none must not be
  // handed the project. The flags are computed here so the SQL below binds a
  // boolean rather than testing an array for null, which Postgres reads as
  // unknown and silently drops every row.
  const lineIds = scope?.lineIds ?? null;
  const requirementIds = scope?.requirementIds ?? null;
  if (lineIds?.length === 0 || requirementIds?.length === 0) return [];
  const allLines = lineIds === null;
  const allRequirements = requirementIds === null;
  const rows = await sql`
    select
      r.project_id,
      r.id            as record_id,
      r.record_no,
      r.status        as record_status,
      r.version       as record_version,
      r.item_description,
      r.area,
      r.designer,
      r.level,
      r.qty,
      r.run_id,
      r.parent_id,
      r.variant_label,
      run.name as run_name,
      -- A FINISH OPTION SHOWS ITS PARENT'S CLIENT REF and its parent's
      -- quantity: S-201 A carries no ref of its own (copying it would make
      -- every drawing card for that code ambiguous) and no qty (the bill says
      -- 45 and never says how many are fabric A).
      coalesce((select string_agg(x.ref_value, ', ' order by x.ref_value)
                  from spec_record_refs x where x.record_id = r.parent_id), '') as parent_refs,
      (select p2.qty from spec_records p2 where p2.id = r.parent_id) as parent_qty,
      coalesce((select p2.record_no from spec_records p2 where p2.id = r.parent_id), r.record_no) as group_no,
      (select count(*) from spec_records v where v.parent_id = r.id and v.status = 'active') as variant_count,
      p.bws_project_number,
      coalesce((select string_agg(x.ref_value, ', ' order by x.ref_value)
                  from spec_record_refs x where x.record_id = r.id), '') as refs,
      c.id            as category_id,
      c.name          as category_name,
      q.id            as requirement_id,
      q.kind          as requirement_kind,
      q.prompt,
      q.section,
      q.sort_order,
      q.tgq_levels,
      -- The two ways a question reaches Matthew's matrix: the BWS field it
      -- fills, and the local key a readiness question carries instead.
      f.json_id       as field_json_id,
      q.local_key,
      f.name          as field_label,
      a.id            as answer_id,
      a.version       as answer_version,
      coalesce(a.state, 'missing') as state,
      a.value         as current_value
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    join item_categories c on c.id = r.category_id
    join requirements q on q.category_id = r.category_id
    left join spec_fields f on f.id = q.spec_field_id
    left join spec_answers a on a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
    where r.project_id = any(${projectIds}::uuid[])
      and r.status = 'active'
      and run.status = 'active'
      -- A SPLIT BILL LINE IS A HEADING, AND ITS QUESTIONS ARE NOBODY'S TO
      -- ANSWER. Its configurations are what the export ships (0024), so a
      -- question on the parent is a question about a record that will never
      -- reach BWS -- and chasing a designer for it asks them to decide
      -- something that does not exist.
      --
      -- Found on 2026-09-18 by the two screens disagreeing: the overview
      -- reported 167 to quote on the sandbox Panther project and this one
      -- reported 202, because loadProjectSummary carries this predicate and
      -- this query did not. That is the disagreement the check sheet exists to
      -- prevent, between two screens rather than between two files.
      --
      -- The predicate is loadExportScope's, word for word: a correlated
      -- not-exists on an ACTIVE configuration, never a stored has-been-split
      -- flag. Retire both configurations and the line is an item again, still
      -- on the bill, and chaseable. (No backticks in here: one closes the
      -- tagged template.)
      and not exists (
        select 1 from spec_records v
        where v.parent_id = r.id and v.status = 'active'
      )
      and coalesce(a.state, 'missing') in ('missing', 'tbc')
      -- THE SCOPE. Absent means everything, and the boolean is what says so:
      -- comparing an array against null inside the predicate would make the
      -- whole clause unknown and return no rows at all.
      and (${allLines}::boolean or coalesce(r.parent_id, r.id) = any(${lineIds ?? []}::uuid[]))
      and (${allRequirements}::boolean or q.id = any(${requirementIds ?? []}::uuid[]))
    -- Bill order, with each line's finish options directly under it. Ordering
    -- on the parent ID instead would put the groups in uuid order, which is no
    -- order at all -- the same rule as /api/records.
    order by group_no, r.parent_id nulls first, r.variant_label, q.sort_order
  `;
  // ONE load for the whole project, then one lookup per row. The tier is
  // computed here and nowhere else — the spec table, the chase screen, the
  // generate and edit routes and the email template all read it off this.
  const matrices = await loadTgqMatrices(sql);
  return rows.map((row) => toOutstandingQuestion(row, matrices));
}

function toOutstandingQuestion(row: Row, matrices: Map<string, TgqMatrix>): OutstandingQuestion {
  const recordNo = Number(row.record_no);
  const level = normaliseItemLevel(row.level);
  const tgqLevels = Array.isArray(row.tgq_levels) ? row.tgq_levels.map(String) : [];
  return {
    projectId: String(row.project_id),
    recordId: String(row.record_id),
    recordNo,
    recordLabel: recordLabel(String(row.bws_project_number), recordNo),
    recordStatus: String(row.record_status),
    recordVersion: Number(row.record_version),
    itemDescription: String(row.item_description ?? ""),
    area: row.area === null || row.area === undefined ? null : String(row.area),
    designer: row.designer === null || row.designer === undefined ? null : String(row.designer),
    refs: String(row.refs ?? ""),
    categoryId: row.category_id === null || row.category_id === undefined ? null : String(row.category_id),
    categoryName: row.category_name === null || row.category_name === undefined ? null : String(row.category_name),
    level,
    tgqLevels,
    // His matrix where he wrote one for this category, the 0019 placeholder
    // where he did not. Absent from the map is the discriminator, so a
    // category he has never covered is NOT read as "nothing blocks a quote".
    tier: questionTierOrNull(
      {
        tgqLevels,
        jsonId: row.field_json_id === null || row.field_json_id === undefined ? null : Number(row.field_json_id),
        localKey: row.local_key === null || row.local_key === undefined ? null : String(row.local_key),
      },
      level,
      row.category_id ? (matrices.get(String(row.category_id)) ?? null) : null,
    ),
    requirementId: String(row.requirement_id),
    requirementKind: String(row.requirement_kind) === "readiness" ? "readiness" : "spec_field",
    prompt: String(row.prompt ?? ""),
    section: row.section === null || row.section === undefined ? null : String(row.section),
    sortOrder: Number(row.sort_order ?? 0),
    fieldLabel: row.field_label === null || row.field_label === undefined ? null : String(row.field_label),
    jsonId: row.field_json_id === null || row.field_json_id === undefined ? null : Number(row.field_json_id),
    localKey: row.local_key === null || row.local_key === undefined ? null : String(row.local_key),
    answerId: row.answer_id === null || row.answer_id === undefined ? null : String(row.answer_id),
    answerVersion: row.answer_version === null || row.answer_version === undefined ? null : Number(row.answer_version),
    state: String(row.state) as AnswerState,
    currentValue: row.current_value === null || row.current_value === undefined ? null : String(row.current_value),
    qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
    runId: String(row.run_id),
    runName: String(row.run_name ?? ""),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    variantLabel: row.variant_label === null || row.variant_label === undefined ? null : String(row.variant_label),
    parentRefs: String(row.parent_refs ?? ""),
    parentQty: row.parent_qty === null || row.parent_qty === undefined ? null : Number(row.parent_qty),
    groupNo: Number(row.group_no ?? recordNo),
    groupLabel: recordLabel(String(row.bws_project_number), Number(row.group_no ?? recordNo)),
    variantCount: Number(row.variant_count ?? 0),
  };
}

/**
 * Live state for a specific set of questions, whatever their answer state.
 *
 * `loadOutstanding` filters to missing/tbc, so a question that has since been
 * ANSWERED disappears from it — and a staleness check against that list can
 * only report "questionGone", which is both imprecise and alarming when the
 * real news is good ("they replied"). This loads the covered questions
 * regardless of state so the diff can say `answerSettled` instead.
 */
export async function loadQuestionsByKey(
  keys: { recordId: string; requirementId: string }[],
  // Defaults to the HTTP driver for screen reads. The generate route and the
  // send gate pass their TRANSACTION's executor instead, so the rows they
  // validate against are the rows they hold locks on -- reading them over a
  // separate connection would reintroduce exactly the read-committed gap the
  // transaction exists to close.
  exec: SqlExecutor = sql,
): Promise<Map<string, OutstandingQuestion>> {
  if (keys.length === 0) return new Map();
  const recordIds = [...new Set(keys.map((k) => k.recordId))];
  const requirementIds = [...new Set(keys.map((k) => k.requirementId))];

  const rows = await exec`
    select
      r.project_id,
      r.id            as record_id,
      r.record_no,
      r.status        as record_status,
      r.version       as record_version,
      r.item_description,
      r.area,
      r.designer,
      r.level,
      r.qty,
      r.run_id,
      r.parent_id,
      r.variant_label,
      run.name as run_name,
      -- A FINISH OPTION SHOWS ITS PARENT'S CLIENT REF and its parent's
      -- quantity: S-201 A carries no ref of its own (copying it would make
      -- every drawing card for that code ambiguous) and no qty (the bill says
      -- 45 and never says how many are fabric A).
      coalesce((select string_agg(x.ref_value, ', ' order by x.ref_value)
                  from spec_record_refs x where x.record_id = r.parent_id), '') as parent_refs,
      (select p2.qty from spec_records p2 where p2.id = r.parent_id) as parent_qty,
      coalesce((select p2.record_no from spec_records p2 where p2.id = r.parent_id), r.record_no) as group_no,
      (select count(*) from spec_records v where v.parent_id = r.id and v.status = 'active') as variant_count,
      p.bws_project_number,
      coalesce((select string_agg(x.ref_value, ', ' order by x.ref_value)
                  from spec_record_refs x where x.record_id = r.id), '') as refs,
      c.id            as category_id,
      c.name          as category_name,
      q.id            as requirement_id,
      q.kind          as requirement_kind,
      q.prompt,
      q.section,
      q.sort_order,
      q.tgq_levels,
      -- The two ways a question reaches Matthew's matrix: the BWS field it
      -- fills, and the local key a readiness question carries instead.
      f.json_id       as field_json_id,
      q.local_key,
      f.name          as field_label,
      a.id            as answer_id,
      a.version       as answer_version,
      coalesce(a.state, 'missing') as state,
      a.value         as current_value
    from spec_records r
    join projects p on p.id = r.project_id
    -- run_id is not null on spec_records: a record on no run is on no tab and
    -- in no export scope, so this join can never drop a row.
    join spec_runs run on run.id = r.run_id
    left join item_categories c on c.id = r.category_id
    join requirements q on q.id = any(${requirementIds}::uuid[])
    left join spec_fields f on f.id = q.spec_field_id
    left join spec_answers a on a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
    where r.id = any(${recordIds}::uuid[])
  `;

  // Same single source for the tier as `loadOutstanding`. A second reading
  // here is how a draft's coverage rows come to disagree with the screen that
  // generated them about which half of the email a question belongs in.
  const matrices = await loadTgqMatrices(sql);
  const byKey = new Map<string, OutstandingQuestion>();
  for (const row of rows) {
    const question = toOutstandingQuestion(row, matrices);
    byKey.set(questionKey(question.recordId, question.requirementId, 0), question);
  }
  return byKey;
}

/**
 * Records that cannot be chased because they carry no category, so the app has
 * no checklist to measure them against. Reported alongside the blocked list
 * rather than counted as complete -- `0 of 0` renders green, which is exactly
 * backwards.
 */
export async function loadUncategorisedRecords(projectId: string): Promise<
  { recordId: string; recordLabel: string; itemDescription: string; version: number }[]
> {
  const rows = await sql`
    select r.id, r.record_no, r.item_description, r.version, p.bws_project_number
    from spec_records r
    join projects p on p.id = r.project_id
    where r.project_id = ${projectId} and r.status = 'active' and r.category_id is null
    order by r.record_no
  `;
  return rows.map((row) => ({
    recordId: String(row.id),
    recordLabel: recordLabel(String(row.bws_project_number), Number(row.record_no)),
    itemDescription: String(row.item_description ?? ""),
    // The optimistic lock, so a category can be SET from a list rather than
    // only from the record screen. The chase screen ignores it and links out.
    version: Number(row.version),
  }));
}

/**
 * Coverage rows from every sent draft on the project.
 *
 * Voided and superseded drafts are excluded: a voided send is explicitly no
 * longer claimed to have happened, and a superseded one was never sent at all.
 *
 * `tracking_eligible` used to be a third condition. Nothing ever wrote it
 * false: the case it was for -- recording a send whose coverage was already
 * stale -- is refused outright by the send gate, so the column described a
 * path that does not exist. Dropped from the predicate here; the column goes
 * in a later migration, once the screen has been accepted.
 */
/**
 * THE LINES a set of records belong to, for `OutstandingScope.lineIds`.
 *
 * `loadOutstanding`'s scope matches on `coalesce(r.parent_id, r.id)` -- the
 * LINE, not the record -- because a finish option is listed under its bill
 * line. So a caller holding record ids (a coverage row names a record, and
 * that record may be a configuration) cannot pass them straight through: a
 * variant's own id equals no line id, and every one of its questions would be
 * silently dropped. One lookup, and the caller passes what the scope means.
 *
 * Loading a line also loads its sibling configurations' questions, which is
 * harmless: every caller here looks each question up by its exact key.
 */
export async function lineIdsForRecords(recordIds: string[]): Promise<string[]> {
  if (recordIds.length === 0) return [];
  const rows = await sql`
    select distinct coalesce(parent_id, id) as line_id
      from spec_records where id = any(${recordIds}::uuid[])
  `;
  return rows.map((row) => String(row.line_id));
}

export async function loadSentCoverage(project: string | string[]): Promise<
  (CoverageSnapshot & { draftId: string; sentAt: string | null; contactName: string })[]
> {
  const projectIds = Array.isArray(project) ? project : [project];
  if (projectIds.length === 0) return [];
  const rows = await sql`
    select i.draft_id, i.record_id, i.requirement_id, i.revision_no,
           i.answer_id, i.snapshot_answer_version, i.record_version, i.context_snapshot,
           d.sent_at, c.name as contact_name
    from email_draft_items i
    join email_drafts d on d.id = i.draft_id
    join project_contacts c on c.id = d.contact_id
    where d.project_id = any(${projectIds}::uuid[])
      and d.status = 'sent'
    order by d.sent_at desc
  `;
  return rows.map((row) => ({
    draftId: String(row.draft_id),
    recordId: String(row.record_id),
    requirementId: String(row.requirement_id),
    revisionNo: Number(row.revision_no),
    answerId: row.answer_id === null || row.answer_id === undefined ? null : String(row.answer_id),
    snapshotAnswerVersion:
      row.snapshot_answer_version === null || row.snapshot_answer_version === undefined
        ? null
        : Number(row.snapshot_answer_version),
    recordVersion: Number(row.record_version),
    context: row.context_snapshot as ContextSnapshot,
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : String(row.sent_at),
    contactName: String(row.contact_name ?? ""),
  }));
}

export type WaitingInfo = { draftId: string; sentAt: string | null; contactName: string };

/**
 * For each outstanding question, the most recent still-valid send, if any.
 *
 * Coverage arrives newest-first, so the first match wins: undoing the latest
 * send falls back to an earlier one that is still valid, rather than dropping
 * the question out of Waiting entirely.
 */
export function waitingByQuestion(
  questions: OutstandingQuestion[],
  coverage: (CoverageSnapshot & { draftId: string; sentAt: string | null; contactName: string })[],
): Map<string, WaitingInfo> {
  // Keyed on all three parts, so a coverage row for a future revision cannot
  // be matched against the revision-0 question and read as fresh.
  const live = new Map(questions.map((q) => [questionKey(q.recordId, q.requirementId, 0), q]));
  const waiting = new Map<string, WaitingInfo>();

  for (const row of coverage) {
    const key = questionKey(row.recordId, row.requirementId, row.revisionNo);
    if (waiting.has(key)) continue;
    if (!isCoverageFresh(row, live.get(key) ?? null)) continue;
    waiting.set(key, { draftId: row.draftId, sentAt: row.sentAt, contactName: row.contactName });
  }
  return waiting;
}
