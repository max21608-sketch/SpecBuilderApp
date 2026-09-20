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
};

export type FinishOptionGroup<Q> = {
  /** The finish option's own record. This is what a draft is written against. */
  recordId: string;
  /** A, B, C … */
  label: string;
  /** What a person says out loud: `S-301 A`. The ref is the client's, the letter is ours. */
  name: string;
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
          questions: [],
        };
        options.set(question.recordId, option);
      }
      option.questions.push(question);
    }
  }

  for (const [lineId, options] of optionsByLine) {
    const line = lines.get(lineId)!;
    line.options = [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
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

/** Every question on a line, its finish options included. */
export function allQuestions<Q>(line: FurnitureLine<Q>): Q[] {
  return [...line.own, ...line.options.flatMap((option) => option.questions)];
}

export type OutstandingCounts = {
  /** Spec-field questions that hold up a quotation. */
  toQuote: number;
  /** Everything else still outstanding, readiness questions included. */
  later: number;
  waiting: number;
};

/**
 * The two numbers a line prints.
 *
 * Readiness questions count as "also outstanding" rather than vanishing: they
 * are not selected by default and they are hidden by default, but they are
 * still outstanding, and a line that reported them as nothing would read as
 * finished when it is not.
 */
export function countOutstanding(questions: readonly GroupableQuestion[]): OutstandingCounts {
  let toQuote = 0;
  let later = 0;
  let waiting = 0;
  for (const question of questions) {
    if (question.tier === "to_quote" && question.requirementKind === "spec_field") toQuote += 1;
    else later += 1;
    if (question.waiting) waiting += 1;
  }
  return { toQuote, later, waiting };
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
  /** How many of the rows under it hold up a quote. Never all-or-nothing: a
   *  question can be TGQ on a hero item and later on a simple one. */
  toQuote: number;
  /** One row per (record, question). The screen's edit rows. */
  rows: Q[];
};

/** The key two categories asking the same thing share. */
export function questionGroupKey(question: QuestionGroupable): string {
  if (question.jsonId !== null && question.jsonId !== undefined) return `field:${question.jsonId}`;
  if (question.localKey) return `local:${question.localKey}`;
  const folded = question.prompt.replace(/\s+/g, " ").trim().toLowerCase();
  return folded ? `prompt:${folded}` : `requirement:${question.requirementId}`;
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
        rows: [],
      };
      groups.set(key, group);
    }
    if (!group.requirementSet.has(question.requirementId)) {
      group.requirementSet.add(question.requirementId);
      group.requirementIds.push(question.requirementId);
    }
    if (question.tier === "to_quote" && question.requirementKind === "spec_field") group.toQuote += 1;
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
      rows: group.rows,
    }))
    .sort((a, b) => {
      const blocking = (group: QuestionGroup<Q>) => (group.toQuote > 0 ? 0 : 1);
      return blocking(a) - blocking(b) || b.toQuote - a.toQuote || a.heading.localeCompare(b.heading);
    });
}
