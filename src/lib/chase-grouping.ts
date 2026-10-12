// The chase screen is a list of FURNITURE LINES, not a list of questions.
//
// ============================================================================
// WHY THIS EXISTS
//
// The screen listed one row per outstanding question, grouped by the contact
// they would be asked of. On the pilot that is 823 rows under one name, and
// the first real run-through of it (2026-09-17) got no further than scrolling:
// every row repeats the item it is about, so twenty questions about one
// headboard read as twenty separate problems.
//
// A person works item by item. So the unit on screen is the bill line — code,
// what it is, how many specs are missing — collapsed, with its questions
// inside it. A line's FINISH OPTIONS (0024's variants: S-301 A, B, C, D) are
// its own level in between, because the whole reason they exist is that the
// fabric differs and the fabric is what the questions are about.
//
// Everything here is a pure function of what /api/drafts already returns, and
// none of it decides ELIGIBILITY -- which questions can be asked, and which
// half of the email they land in, is the server's answer and is untouched.
// ============================================================================
import type { AnswerState } from "@/lib/spec-vocab";
import type { QuestionTier } from "@/lib/tgq";
import { PROJECT_WIDE_SECTION } from "@/lib/checklist-sections";

// ============================================================================
// AN ITEM'S TGQ, DEFINED ONCE.
//
// Max, 2026-10-12, after the walk of pilot found TGQ meaning four counts on
// one project: Drawers read 44 on the phase table and 20 on the fill-in
// screen, 23 minutes apart, and Matthew quoted both. The phase table counted
// every question whose tier was `to_quote`; `countOutstanding` counted only
// the `spec_field` ones; and 450 of the 1,509 were fifteen PROJECT-WIDE
// questions (TOE agreement, sales folder, site access, …) repeated on thirty
// items. His ruling is the rule:
//
//   an item's TGQ = its outstanding questions whose tier is `to_quote`, of ANY
//   kind, MINUS the project-wide section.
//
// The project-wide ones still block every quote. They are counted ONCE, on
// the project, and answered there (`/api/projects/[id]/project-wide`).
//
// ---- WHAT THIS DOES NOT TOUCH -------------------------------------------
//
// A question's TIER. `questionTier` is unchanged and so is the tier stored on
// `email_draft_items`: re-tiering would stale every unsent draft, the
// `chased_at` trap. This is a rule about what is COUNTED as the item's own
// work, not about which half of an email a question lands in.
//
// The gates. `gateStatus` still requires a project-wide TGQ field to be
// answered before TGQ is met — the panel says it is answered on the project,
// and the satisfied verdict still waits for it.
//
// Every TypeScript screen counts through these. `project-summary.ts` carries
// the same rule in SQL, because the driver cannot share a fragment, and
// `tests/db/project-summary.test.ts` holds the two equal.
// ============================================================================

/** The part of a question the TGQ rule reads. `section` is REQUIRED, so a caller cannot forget it and count a project-wide question as the item's. */
export type TgqCountable = {
  tier: QuestionTier | null;
  section: string | null;
};

/** A question about the PROJECT, asked of every item that carries the section. */
export function isProjectWideQuestion(question: { section: string | null }): boolean {
  return question.section === PROJECT_WIDE_SECTION;
}

/** Counts in THIS ITEM's TGQ: blocks a quote, and is about the item. */
export function inItemTgq(question: TgqCountable): boolean {
  return question.tier === "to_quote" && !isProjectWideQuestion(question);
}

/** Blocks a quote, and is answered once on the project. */
export function inProjectWideTgq(question: TgqCountable): boolean {
  return question.tier === "to_quote" && isProjectWideQuestion(question);
}

/**
 * What a chase ASKS by default: the item's TGQ, specification questions only.
 * A readiness question is ours to record and is never chased (decision 19);
 * a project-wide one is answered once on the project, not asked per item.
 */
export function inChaseAsk(question: TgqCountable & { requirementKind: "spec_field" | "readiness" }): boolean {
  return inItemTgq(question) && question.requirementKind === "spec_field";
}

export type ItemTgqCounts = {
  /** The item's own TGQ — what every screen prints as its TGQ. */
  toQuote: number;
  /** Of those, the ones a chase asks (`spec_field`). */
  toChase: number;
  /** Project-wide TGQ questions this item still carries. Counted apart, never inside `toQuote`. */
  projectWide: number;
  /** Everything else outstanding: tier `later`. */
  later: number;
};

/**
 * One item's TGQ counts, or NULL where any outstanding question on it is
 * untiered (the fallback model with no level). Null is a dash, never a zero:
 * "nothing blocks a quote" and "nobody has said what kind of item this is"
 * are different answers.
 */
export function itemTgqCounts(
  questions: readonly (TgqCountable & { requirementKind: "spec_field" | "readiness" })[],
): ItemTgqCounts | null {
  const counts: ItemTgqCounts = { toQuote: 0, toChase: 0, projectWide: 0, later: 0 };
  for (const question of questions) {
    if (question.tier === null) return null;
    if (inItemTgq(question)) {
      counts.toQuote += 1;
      if (question.requirementKind === "spec_field") counts.toChase += 1;
    } else if (inProjectWideTgq(question)) counts.projectWide += 1;
    else counts.later += 1;
  }
  return counts;
}


/**
 * The shape this file needs from a question. Deliberately structural: the
 * screen's own `Question` type carries more (the prompt, the BWS field, the
 * waiting draft) and satisfies this without being imported here.
 */
export type GroupableQuestion = {
  recordId: string;
  requirementId: string;
  requirementKind: "spec_field" | "readiness";
  tier: QuestionTier | null;
  /** The cheat sheet's section. Read by the TGQ rule: the project-wide section never counts in an item's TGQ. */
  section: string | null;
  state: AnswerState;
  waiting: unknown | null;
  /** The client's own ref for this record. Empty on a finish option. */
  refs: string;
  itemDescription: string;
  level: string | null;
  qty: number | null;
  runId: string;
  runName: string;
  parentId: string | null;
  variantLabel: string | null;
  parentRefs: string;
  parentQty: number | null;
  groupNo: number;
  groupLabel: string;
  variantCount: number;
  /** 0039: `12.3`, the number a finish option reads by. Optional so a fixture need not know it. */
  recordShortLabel?: string;
  /** 0039: the 3 in 12.3 — what a line's finish options are ordered by. */
  variantOrdinal?: number | null;
};

export type FinishOptionGroup<Q> = {
  /** The finish option's own record. This is what a draft is written against. */
  recordId: string;
  /** A, B, C … */
  label: string;
  /** What a person says out loud: `S-301 A`. The ref is the client's, the letter is ours. */
  name: string;
  /**
   * `12.3` — its number under the line (0039), or null where the question did
   * not carry one. Printed beside the name, never instead of it: the name is
   * what the drawings say, the number is what the file carries.
   */
  number: string | null;
  /** 0039's ordinal, for the order the options are listed in. */
  ordinal: number | null;
  /**
   * THE FINISH OPTION'S OWN QUANTITY, AND NOTHING IS APPORTIONED TO GET IT.
   * A configuration is created with `qty = null` — the bill says 45 of S-201
   * and never says how many are fabric A — and `PATCH /api/records/[id]`'s
   * `details` has accepted one since 0028, so a person may have set it. Null
   * is therefore *not allocated*, which is a different statement from the
   * bill line's own *quantity not given*, and it is read off the record
   * rather than computed: dividing the parent's 45 is the one thing no screen
   * in this app may do.
   */
  qty: number | null;
  questions: Q[];
};

export type FurnitureLine<Q> = {
  /** The bill line's record id — its own, or its finish options' parent. */
  lineId: string;
  /** `AP364c-011`. */
  recordLabel: string;
  /** The client's ref: `S-301`. Unchanged by a split. */
  code: string;
  itemDescription: string;
  /** The bill's quantity. Never apportioned across finish options. */
  qty: number | null;
  runId: string;
  runName: string;
  level: string | null;
  /** Everybody a question on this line would be asked of. Usually one. */
  contactIds: string[];
  /**
   * Questions on the bill line ITSELF. A line with finish options is a
   * heading — but it can still hold questions of its own, and hiding them
   * because the line was split would silently drop them from every chase.
   */
  own: Q[];
  options: FinishOptionGroup<Q>[];
  /**
   * Live finish options, INCLUDING any with nothing outstanding. The count the
   * screen prints has to be the true one: "2 finish options" beside a single
   * visible option is a question about the data, and "1" would be a lie about
   * what exists.
   */
  optionCount: number;
};

/**
 * Bucket questions into their furniture line, keeping the order they arrive in.
 *
 * `loadOutstanding` already orders by the line's `record_no`, then its finish
 * options by letter, then the cheat sheet's own question order, so insertion
 * order IS bill order. Sorting again here would be a second opinion about
 * something the query already settled.
 */
export function groupIntoLines<Q extends GroupableQuestion>(questions: readonly Q[]): FurnitureLine<Q>[] {
  const lines = new Map<string, FurnitureLine<Q>>();
  const optionsByLine = new Map<string, Map<string, FinishOptionGroup<Q>>>();

  for (const question of questions) {
    // A finish option belongs to its parent's line; a bill line is its own.
    const lineId = question.parentId ?? question.recordId;
    let line = lines.get(lineId);
    if (!line) {
      line = {
        lineId,
        recordLabel: question.groupLabel,
        // Read through the parent on a finish option, which carries no ref of
        // its own. `S-201 A` and `S-201 B` are both still `S-201` to the client.
        code: (question.parentId ? question.parentRefs : question.refs).trim(),
        itemDescription: question.itemDescription,
        qty: question.parentId ? question.parentQty : question.qty,
        runId: question.runId,
        runName: question.runName,
        level: question.level,
        contactIds: [],
        own: [],
        options: [],
        optionCount: 0,
      };
      lines.set(lineId, line);
      optionsByLine.set(lineId, new Map());
    }

    // The bill line's own row is the authority on the line's identity: a finish
    // option only stood in for it because it had not been seen yet.
    if (!question.parentId) {
      line.recordLabel = question.groupLabel;
      line.code = question.refs.trim();
      line.qty = question.qty;
      line.level = question.level;
      line.optionCount = Math.max(line.optionCount, question.variantCount);
    }

    if (question.variantLabel === null) {
      line.own.push(question);
    } else {
      const options = optionsByLine.get(lineId)!;
      let option = options.get(question.recordId);
      if (!option) {
        option = {
          recordId: question.recordId,
          label: question.variantLabel,
          name: `${(question.parentRefs || line.code || line.recordLabel).trim()} ${question.variantLabel}`.trim(),
          number: question.recordShortLabel ?? null,
          ordinal: question.variantOrdinal ?? null,
          qty: question.qty,
          questions: [],
        };
        options.set(question.recordId, option);
      }
      option.questions.push(question);
    }
  }

  for (const [lineId, options] of optionsByLine) {
    const line = lines.get(lineId)!;
    // BY THEIR NUMBER UNDER THE LINE where they carry one (0039): as text,
    // `TYPE 10` sorts before `TYPE 2`. The name breaks a tie, and is the whole
    // order for a question that carried no number.
    line.options = [...options.values()].sort(
      (a, b) => (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) || a.label.localeCompare(b.label),
    );
    // A line whose bill row carried no outstanding questions never reported a
    // variant count, so fall back to what is actually on screen.
    line.optionCount = Math.max(line.optionCount, line.options.length);
  }

  for (const line of lines.values()) {
    const seen = new Set<string>();
    for (const question of allQuestions(line)) {
      const contactId = (question as { contactId?: string }).contactId;
      if (contactId && !seen.has(contactId)) {
        seen.add(contactId);
        line.contactIds.push(contactId);
      }
    }
  }

  return [...lines.values()];
}

/**
 * What a finish option's row says about its quantity, in ONE place.
 *
 * The infill line and the chase line print this beside the letter, and they
 * printed *quantity not allocated* unconditionally until 2026-09-22 — true
 * only for as long as nothing had set one, which 0028 has allowed since it
 * landed. The phase table says the same two things in its own Chip; three
 * screens wording one state two ways is how a reader comes to believe they
 * are two states, which is the whole of the finding behind this function.
 *
 * It reads a number and never derives one. `unallocatedQty` is what states
 * the GAP, on the screens that own that question, and it deliberately does
 * not clamp a negative.
 */
export function finishOptionQtyLabel(qty: number | null): string {
  return qty === null ? "quantity not allocated" : `qty ${qty}`;
}

/** Every question on a line, its finish options included. */
export function allQuestions<Q>(line: FurnitureLine<Q>): Q[] {
  return [...line.own, ...line.options.flatMap((option) => option.questions)];
}

export type OutstandingCounts = {
  /** The item's own TGQ (`inItemTgq`): any kind of question, minus the project-wide section. */
  toQuote: number;
  /** Project-wide TGQ questions on these items, answered once on the project. Apart, never inside `toQuote`. */
  projectWide: number;
  /** Everything else still outstanding: tier `later`, or untiered. */
  later: number;
  waiting: number;
};

/**
 * The numbers a line prints.
 *
 * `toQuote` is the item's TGQ by the one rule (`inItemTgq`), readiness
 * questions included — until 2026-10-12 this counted `spec_field` only and
 * the fill-in screen read 20 where the phase table read 44 for the same
 * drawers. The project-wide ones are counted apart, so a line never reads as
 * clear while the project still owes them. The three partition the input.
 */
export function countOutstanding(questions: readonly GroupableQuestion[]): OutstandingCounts {
  let toQuote = 0;
  let projectWide = 0;
  let later = 0;
  let waiting = 0;
  for (const question of questions) {
    if (inItemTgq(question)) toQuote += 1;
    else if (inProjectWideTgq(question)) projectWide += 1;
    else later += 1;
    if (question.waiting) waiting += 1;
  }
  return { toQuote, projectWide, later, waiting };
}

// ---------------------------------------------------------------------------
// The SECOND grouping: by question, then the items under it.
//
// ============================================================================
// "CAN YOU SHOW ME ALL THE JOBS WITH DIMENSIONS MISSING?"
//
// Matthew, 2026-09-18. The same outstanding questions, turned ninety degrees:
// the unit is the QUESTION and the items are inside it, because "who still owes
// me a metalwork finish" is a different job from "what does this chair still
// need" and walking the item list to answer it is how a whole afternoon goes.
//
// Same input as `groupIntoLines`, so the two views can never disagree about
// what is outstanding — that is the whole reason this lives beside it rather
// than in a loader of its own.
//
// ---- A QUESTION IS NOT A `requirements` ROW ------------------------------
//
// The obvious key is `requirementId`, and it is wrong, measured rather than
// argued: `requirements` is seeded PER CATEGORY, so "Dimensions" is seventeen
// rows — one per cheat sheet — and on the sandbox 300-line project it comes
// back as 166 records under one of them and 65 under another. Grouping by the
// row would print "Dimensions" as four separate headings, and somebody who
// cleared the first would believe they had done dimensions. That is the
// confidently-wrong answer this view exists to prevent.
//
// So a question is keyed by WHAT IT ASKS FOR, in the same order everything
// else in this app resolves a question: the BWS field it fills, then the local
// key a readiness row carries instead (0030's six id-less questions), then its
// own prompt folded for case and space. The requirement id is the last resort,
// and reaching it means the row has no field, no key and no prompt.
// ============================================================================

/** What this grouping needs beyond `GroupableQuestion`. */
export type QuestionGroupable = GroupableQuestion & {
  requirementId: string;
  prompt: string;
  fieldLabel: string | null;
  /** The BWS field, and the local key a readiness question carries instead. */
  jsonId?: number | null;
  localKey?: string | null;
  area?: string | null;
};

export type QuestionGroup<Q> = {
  /** Stable across categories: this is what makes one "Dimensions" heading. */
  key: string;
  /** Every `requirements` row folded into it, so a caller can scope a re-read. */
  requirementIds: string[];
  /** The heading. The BWS field's name where there is one — it is the shared half. */
  heading: string;
  fieldLabel: string | null;
  /** How many of the rows under it hold up a quote, by the item rule
   *  (`inItemTgq`). Never all-or-nothing: a question can be TGQ on a hero item
   *  and later on a simple one. */
  toQuote: number;
  /** How many rows are project-wide TGQ — the same question answered once on the project. */
  projectWide: number;
  /** One row per (record, question). The screen's edit rows. */
  rows: Q[];
};

/** The key two categories asking the same thing share. */
export function questionGroupKey(
  question: Pick<QuestionGroupable, "requirementId" | "prompt" | "jsonId" | "localKey">,
): string {
  if (question.jsonId !== null && question.jsonId !== undefined) return `field:${question.jsonId}`;
  if (question.localKey) return `local:${question.localKey}`;
  const folded = question.prompt.replace(/\s+/g, " ").trim().toLowerCase();
  return folded ? `prompt:${folded}` : `requirement:${question.requirementId}`;
}

/**
 * PROJECT-LEVEL TGQ: how many DISTINCT project-wide questions still block a
 * quote somewhere on the project. Keyed the way `groupByQuestion` keys a
 * question, because `requirements` is per category — "Access" is seventeen
 * rows and one question. This is the number the overview, the phase tab and
 * the projects list print beside the item TGQ ("· 2 project-wide").
 */
export function projectWideTgqKeys(
  questions: readonly (TgqCountable & Pick<QuestionGroupable, "requirementId" | "prompt" | "jsonId" | "localKey">)[],
): Set<string> {
  const keys = new Set<string>();
  for (const question of questions) {
    if (inProjectWideTgq(question)) keys.add(questionGroupKey(question));
  }
  return keys;
}

/**
 * One group per question, with the items that still owe it an answer.
 *
 * Insertion order inside a group is the order the loader returned, which is
 * bill order. The GROUPS are sorted to-quote first and then by heading, so the
 * questions holding up a quotation are the ones at the top of the screen.
 */
export function groupByQuestion<Q extends QuestionGroupable>(questions: readonly Q[]): QuestionGroup<Q>[] {
  const groups = new Map<string, QuestionGroup<Q> & { requirementSet: Set<string> }>();

  for (const question of questions) {
    const key = questionGroupKey(question);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        requirementIds: [],
        requirementSet: new Set<string>(),
        // The BWS field's name is what the two categories AGREE on; a prompt is
        // one sheet's wording of it. Where there is no field, the prompt is all
        // there is and the first one seen stands for the group.
        heading: question.fieldLabel?.trim() || question.prompt.trim() || "Unnamed question",
        fieldLabel: question.fieldLabel,
        toQuote: 0,
        projectWide: 0,
        rows: [],
      };
      groups.set(key, group);
    }
    if (!group.requirementSet.has(question.requirementId)) {
      group.requirementSet.add(question.requirementId);
      group.requirementIds.push(question.requirementId);
    }
    if (inItemTgq(question)) group.toQuote += 1;
    else if (inProjectWideTgq(question)) group.projectWide += 1;
    group.rows.push(question);
  }

  // The working set is dropped on the way out: it exists to keep
  // `requirementIds` free of duplicates in insertion order, and a Set on the
  // wire would serialise as `{}`.
  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      requirementIds: group.requirementIds,
      heading: group.heading,
      fieldLabel: group.fieldLabel,
      toQuote: group.toQuote,
      projectWide: group.projectWide,
      rows: group.rows,
    }))
    .sort((a, b) => {
      const blocking = (group: QuestionGroup<Q>) => (group.toQuote > 0 || group.projectWide > 0 ? 0 : 1);
      return blocking(a) - blocking(b) || b.toQuote - a.toQuote || a.heading.localeCompare(b.heading);
    });
}
