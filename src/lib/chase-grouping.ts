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
